"""Review collection from Google Play via google-play-scraper.

Collection is batched, retried, idempotent (unique on app + source review ID) and
incremental: newest reviews are fetched first and collection stops once a batch
contains nothing new or reviews fall outside the requested window.
"""

import logging
import re
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from google_play_scraper import Sort, reviews as gp_reviews
from google_play_scraper import app as gp_app
from google_play_scraper.exceptions import NotFoundError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database.models import App, Review, utcnow
from pipeline.config import get_settings
from pipeline.preprocessing import preprocess

log = logging.getLogger(__name__)

PACKAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")
ProgressFn = Callable[[str, float], None]


class AppNotFound(Exception):
    pass


def parse_app_id(url_or_id: str) -> str:
    """Extract and validate a package ID from a Play Store URL or a bare ID."""
    value = url_or_id.strip()
    if "://" in value or value.startswith("play.google.com"):
        parsed = urlparse(value if "://" in value else f"https://{value}")
        if parsed.hostname not in {"play.google.com", "market.android.com"}:
            raise ValueError("URL must be a play.google.com app link")
        ids = parse_qs(parsed.query).get("id")
        if not ids:
            raise ValueError("Play Store URL has no ?id= parameter")
        value = ids[0]
    if not PACKAGE_RE.match(value) or len(value) > 255:
        raise ValueError(f"'{value}' is not a valid Android package ID")
    return value


def store_url(app_id: str) -> str:
    return f"https://play.google.com/store/apps/details?id={app_id}"


def review_source_url(app_id: str, source_review_id: str) -> str:
    return f"{store_url(app_id)}&reviewId={source_review_id}"


def _to_utc_naive(value: datetime | None) -> datetime | None:
    # google-play-scraper builds datetimes with fromtimestamp(), i.e. naive local time.
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def fetch_app_metadata(app_id: str, lang: str, country: str) -> dict:
    try:
        info = gp_app(app_id, lang=lang, country=country)
    except NotFoundError as exc:
        raise AppNotFound(f"App '{app_id}' was not found on Google Play ({country}/{lang})") from exc
    return {
        "title": info.get("title"),
        "developer": info.get("developer"),
        "icon_url": info.get("icon"),
        "genre": info.get("genre"),
        "store_rating": info.get("score"),
        "installs": info.get("installs"),
    }


def register_app(session: Session, url_or_id: str, lang: str | None = None, country: str | None = None) -> App:
    """Validate the app against the store and create or refresh its record."""
    settings = get_settings()
    app_id = parse_app_id(url_or_id)
    lang = (lang or settings.default_lang).lower()
    country = (country or settings.default_country).lower()
    meta = fetch_app_metadata(app_id, lang, country)
    app = session.get(App, app_id)
    if app is None:
        app = App(id=app_id, store_url=store_url(app_id), lang=lang, country=country)
        session.add(app)
    app.lang, app.country = lang, country
    for key, value in meta.items():
        setattr(app, key, value)
    session.flush()
    return app


def _fetch_batch(app: App, count: int, token, retries: int):
    """One page of reviews with exponential backoff on transient failures."""
    for attempt in range(retries + 1):
        try:
            batch, token = gp_reviews(
                app.id, lang=app.lang, country=app.country, sort=Sort.NEWEST,
                count=count, continuation_token=token,
            )
            # With a continuation token the library ignores `count` and reuses the first page size.
            return batch[:count], token
        except NotFoundError:
            raise
        except Exception as exc:  # network errors, throttling, parser changes
            if attempt == retries:
                raise
            wait = 2 ** attempt
            log.warning("Review fetch failed (%s); retrying in %ss", exc, wait)
            time.sleep(wait)


def _to_row(app: App, raw: dict) -> dict:
    content = raw.get("content") or ""
    return {
        "app_id": app.id,
        "source_review_id": raw["reviewId"],
        "original_text": content,
        "rating": int(raw.get("score") or 0),
        "thumbs_up": int(raw.get("thumbsUpCount") or 0),
        "review_date": _to_utc_naive(raw.get("at")),
        "app_version": raw.get("appVersion") or raw.get("reviewCreatedVersion"),
        "developer_reply": raw.get("replyContent"),
        "replied_at": _to_utc_naive(raw.get("repliedAt")),
        "collected_at": utcnow(),
        **preprocess(content, app.lang),
    }


def _existing_ids(session: Session, app_id: str, source_ids: list[str]) -> set[str]:
    if not source_ids:
        return set()
    stmt = select(Review.source_review_id).where(Review.app_id == app_id, Review.source_review_id.in_(source_ids))
    return set(session.scalars(stmt))


def _save(session: Session, rows: list[dict]) -> None:
    """Insert new reviews; refresh mutable fields (developer reply, thumbs up) of known ones."""
    by_id = {r["source_review_id"]: r for r in rows}
    known = {
        r.source_review_id: r
        for r in session.scalars(
            select(Review).where(Review.app_id == rows[0]["app_id"], Review.source_review_id.in_(list(by_id)))
        )
    }
    for source_id, row in by_id.items():
        existing = known.get(source_id)
        if existing is None:
            session.add(Review(**row))
        else:
            existing.thumbs_up = row["thumbs_up"]
            existing.developer_reply = row["developer_reply"]
            existing.replied_at = row["replied_at"]
    session.flush()


def sync_reviews(
    session: Session,
    app_id: str,
    max_reviews: int | None = None,
    since_days: int | None = None,
    progress: ProgressFn | None = None,
) -> dict:
    """Collect up to ``max_reviews`` newest reviews. Returns collection statistics."""
    settings = get_settings()
    app = session.get(App, app_id)
    if app is None:
        raise AppNotFound(f"App '{app_id}' is not registered")
    max_reviews = max_reviews or settings.default_max_reviews
    cutoff = utcnow() - timedelta(days=since_days) if since_days else None
    progress = progress or (lambda stage, pct: None)

    stored_before = session.scalar(select(func.count()).select_from(Review).where(Review.app_id == app.id))
    token = None
    fetched = new = 0
    stop_reason = "max_reviews reached"
    while fetched < max_reviews:
        count = min(settings.ingest_batch_size, max_reviews - fetched)
        batch, token = _fetch_batch(app, count, token, settings.ingest_max_retries)
        if not batch:
            stop_reason = "no more reviews available"
            break
        rows = [_to_row(app, r) for r in batch if r.get("reviewId") and r.get("at")]
        if cutoff:
            in_window = [r for r in rows if r["review_date"] >= cutoff]
            reached_cutoff = len(in_window) < len(rows)
            rows = in_window
        else:
            reached_cutoff = False
        fetched += len(batch)
        if rows:
            already = _existing_ids(session, app.id, [r["source_review_id"] for r in rows])
            new += len(rows) - len(already)
            _save(session, rows)
            session.commit()
            # Incremental sync: once we hit reviews collected earlier, older pages are already
            # stored too — unless this sync asks for a deeper history than we have.
            if len(already) == len(rows) and stored_before >= max_reviews:
                stop_reason = "reached previously collected reviews"
                break
        progress(f"Collected {fetched} reviews ({new} new)", min(fetched / max_reviews, 1.0))
        if reached_cutoff:
            stop_reason = f"reached reviews older than {since_days} days"
            break
        if token is None or getattr(token, "token", "") is None:
            stop_reason = "no more reviews available"
            break
        time.sleep(settings.ingest_batch_delay_seconds)

    app.last_synced_at = utcnow()
    total = session.scalar(select(func.count()).select_from(Review).where(Review.app_id == app.id))
    session.commit()
    return {"fetched": fetched, "new_reviews": new, "total_reviews": total, "stop_reason": stop_reason}
