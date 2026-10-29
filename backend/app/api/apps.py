import logging
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.app.deps import get_app_or_404, get_db
from backend.app.schemas import (
    AnalyzeRequest, AppCreate, AppOut, CategoryCount, CountItem, IssueSummaryOut, JobOut, OverviewOut, Page,
    ReviewOut, SyncRequest, TimelinePoint, VersionStat,
)
from backend.app.serializers import app_out, issue_summary, review_out, week_start
from database.models import App, Issue, IssueReview, Job, Review, ReviewPrediction
from pipeline.export import issue_rows, review_rows, to_csv, to_json
from pipeline.ingestion import AppNotFound, register_app
from pipeline.jobs import JobConflict, create_job, run_job
from pipeline.taxonomy import label_for

log = logging.getLogger(__name__)
router = APIRouter(prefix="/apps", tags=["apps"])

ISSUE_SORTS = {
    "priority": (Issue.priority_score.desc(),),
    "count": (Issue.review_count.desc(), Issue.priority_score.desc()),
    "recent": (Issue.last_seen_at.desc(), Issue.priority_score.desc()),
}
REVIEW_SORTS = {
    "newest": (Review.review_date.desc(),),
    "oldest": (Review.review_date.asc(),),
    "thumbs": (Review.thumbs_up.desc(), Review.review_date.desc()),
    "rating": (Review.rating.asc(), Review.review_date.desc()),
}


def _run_in_background(job_id: int) -> None:
    try:
        run_job(job_id)
    except Exception:  # already recorded on the job row
        log.exception("Background job %s failed", job_id)


def _start_job(session: Session, background: BackgroundTasks, app_id: str, kind: str, params: dict) -> JobOut:
    get_app_or_404(session, app_id)
    try:
        job = create_job(session, app_id, kind, params)
    except JobConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    session.commit()  # the background task reads the job from its own session
    background.add_task(_run_in_background, job.id)
    return JobOut.model_validate(job)


@router.get("", response_model=list[AppOut])
def list_apps(session: Session = Depends(get_db)):
    return [app_out(session, a) for a in session.scalars(select(App).order_by(App.created_at.desc()))]


@router.post("", response_model=AppOut, status_code=201)
def create_app(body: AppCreate, session: Session = Depends(get_db)):
    try:
        app = register_app(session, body.url_or_id, body.lang, body.country)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except AppNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:  # store unreachable / scraper failure
        log.exception("App lookup failed")
        raise HTTPException(502, f"Could not reach Google Play: {exc}") from exc
    return app_out(session, app)


@router.get("/{app_id}", response_model=AppOut)
def get_app(app_id: str, session: Session = Depends(get_db)):
    return app_out(session, get_app_or_404(session, app_id))


@router.delete("/{app_id}", status_code=204)
def delete_app(app_id: str, session: Session = Depends(get_db)):
    app = get_app_or_404(session, app_id)
    if session.scalar(select(Job.id).where(Job.app_id == app_id, Job.status.in_(("queued", "running")))):
        raise HTTPException(409, "Wait for the running job to finish before deleting this app")
    session.execute(delete(Issue).where(Issue.app_id == app_id))  # cascades to memberships and events
    session.delete(app)
    return Response(status_code=204)


@router.post("/{app_id}/sync", response_model=JobOut, status_code=202)
def sync_app(app_id: str, background: BackgroundTasks, body: SyncRequest | None = None, session: Session = Depends(get_db)):
    return _start_job(session, background, app_id, "sync", (body or SyncRequest()).model_dump())


@router.post("/{app_id}/analyze", response_model=JobOut, status_code=202)
def analyze(app_id: str, background: BackgroundTasks, body: AnalyzeRequest | None = None, session: Session = Depends(get_db)):
    if not session.scalar(select(Review.id).where(Review.app_id == app_id).limit(1)):
        get_app_or_404(session, app_id)
        raise HTTPException(409, "No reviews collected yet. Run a sync first.")
    return _start_job(session, background, app_id, "analyze", (body or AnalyzeRequest()).model_dump())


@router.get("/{app_id}/jobs", response_model=list[JobOut])
def list_jobs(app_id: str, limit: int = Query(10, ge=1, le=100), session: Session = Depends(get_db)):
    get_app_or_404(session, app_id)
    return session.scalars(select(Job).where(Job.app_id == app_id).order_by(Job.created_at.desc(), Job.id.desc()).limit(limit)).all()


@router.get("/{app_id}/overview", response_model=OverviewOut)
def overview(app_id: str, session: Session = Depends(get_db)):
    app = get_app_or_404(session, app_id)
    rows = session.execute(
        select(Review.rating, Review.review_date, Review.app_version, Review.language,
               ReviewPrediction.sentiment, ReviewPrediction.category)
        .outerjoin(ReviewPrediction, ReviewPrediction.review_id == Review.id)
        .where(Review.app_id == app_id)
    ).all()
    analyzed = [r for r in rows if r.sentiment]

    ratings = Counter(r.rating for r in rows)
    sentiments = Counter(r.sentiment for r in analyzed)

    by_category: dict[str, list] = defaultdict(list)
    for r in analyzed:
        by_category[r.category or "other"].append(r)
    categories = sorted(
        (CategoryCount(category=k, label=label_for(k), count=len(v),
                       negative_share=sum(x.sentiment == "negative" for x in v) / len(v))
         for k, v in by_category.items()),
        key=lambda c: c.count, reverse=True,
    )

    weeks: dict[str, list] = defaultdict(list)
    for r in rows:
        weeks[week_start(r.review_date)].append(r)
    timeline = [
        TimelinePoint(
            period=week,
            reviews=len(items),
            average_rating=round(sum(i.rating for i in items) / len(items), 2),
            positive=sum(i.sentiment == "positive" for i in items),
            neutral=sum(i.sentiment == "neutral" for i in items),
            negative=sum(i.sentiment == "negative" for i in items),
        )
        for week, items in sorted(weeks.items())[-52:]
    ]

    by_version: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.app_version:
            by_version[r.app_version].append(r)
    versions = sorted(
        (VersionStat(
            version=v, reviews=len(items),
            average_rating=round(sum(i.rating for i in items) / len(items), 2),
            negative_share=(sum(i.sentiment == "negative" for i in items) / max(sum(bool(i.sentiment) for i in items), 1)),
        ) for v, items in by_version.items()),
        key=lambda v: v.reviews, reverse=True,
    )[:10]

    issues = session.scalars(
        select(Issue).where(Issue.app_id == app_id, Issue.is_active.is_(True), Issue.status.notin_(("dismissed", "merged")))
        .order_by(Issue.priority_score.desc())
    ).all()
    summaries = [issue_summary(i) for i in issues]
    last_job = session.scalars(select(Job).where(Job.app_id == app_id).order_by(Job.created_at.desc(), Job.id.desc()).limit(1)).first()

    return OverviewOut(
        app=app_out(session, app),
        total_reviews=len(rows),
        analyzed_reviews=len(analyzed),
        average_rating=round(sum(r.rating for r in rows) / len(rows), 2) if rows else None,
        negative_share=sentiments["negative"] / len(analyzed) if analyzed else None,
        issue_count=len(summaries),
        critical_issue_count=sum(s.effective_priority == "critical" for s in summaries),
        high_issue_count=sum(s.effective_priority == "high" for s in summaries),
        rating_distribution={str(s): ratings.get(s, 0) for s in range(1, 6)},
        sentiment_distribution={k: sentiments.get(k, 0) for k in ("positive", "neutral", "negative")},
        category_counts=categories,
        timeline=timeline,
        version_breakdown=versions,
        languages=[CountItem(key=k or "unknown", count=v) for k, v in Counter(r.language for r in rows).most_common(10)],
        top_issues=summaries[:5],
        emerging_issues=[s for s in summaries if s.trend in ("new", "rising")][:5],
        last_job=JobOut.model_validate(last_job) if last_job else None,
    )


@router.get("/{app_id}/issues", response_model=list[IssueSummaryOut])
def list_issues(
    app_id: str,
    status: str | None = Query(None, description="Comma-separated statuses"),
    category: str | None = None,
    include_inactive: bool = False,
    sort: str = Query("priority", pattern="^(priority|count|recent)$"),
    session: Session = Depends(get_db),
):
    get_app_or_404(session, app_id)
    query = select(Issue).where(Issue.app_id == app_id)
    if status:
        query = query.where(Issue.status.in_([s.strip() for s in status.split(",") if s.strip()]))
    else:
        query = query.where(Issue.status != "merged")
    if category:
        query = query.where(Issue.category == category)
    if not include_inactive:
        query = query.where(Issue.is_active.is_(True))
    return [issue_summary(i) for i in session.scalars(query.order_by(*ISSUE_SORTS[sort]))]


@router.get("/{app_id}/reviews", response_model=Page[ReviewOut])
def list_reviews(
    app_id: str,
    q: str | None = Query(None, max_length=200),
    rating: int | None = Query(None, ge=1, le=5),
    sentiment: str | None = None,
    category: str | None = None,
    issue_id: int | None = None,
    version: str | None = None,
    language: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = Query("newest", pattern="^(newest|oldest|thumbs|rating)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    session: Session = Depends(get_db),
):
    get_app_or_404(session, app_id)
    active_issue = (
        select(IssueReview.review_id, Issue.id.label("issue_id"))
        .join(Issue, Issue.id == IssueReview.issue_id)
        .where(Issue.app_id == app_id, Issue.is_active.is_(True))
        .subquery()
    )
    query = (
        select(Review, ReviewPrediction, active_issue.c.issue_id)
        .outerjoin(ReviewPrediction, ReviewPrediction.review_id == Review.id)
        .outerjoin(active_issue, active_issue.c.review_id == Review.id)
        .where(Review.app_id == app_id)
    )
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(Review.original_text.ilike(f"%{escaped}%", escape="\\"))
    if rating:
        query = query.where(Review.rating == rating)
    if sentiment:
        query = query.where(ReviewPrediction.sentiment == sentiment)
    if category:
        query = query.where(ReviewPrediction.category == category)
    if issue_id:
        query = query.where(Review.id.in_(select(IssueReview.review_id).where(IssueReview.issue_id == issue_id)))
    if version:
        query = query.where(Review.app_version == version)
    if language:
        query = query.where(Review.language == language)
    if date_from:
        query = query.where(Review.review_date >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(Review.review_date < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    total = session.scalar(select(func.count()).select_from(query.subquery()))
    rows = session.execute(query.order_by(*REVIEW_SORTS[sort], Review.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    issues = {i.id: i for i in session.scalars(select(Issue).where(Issue.id.in_({r.issue_id for r in rows if r.issue_id})))}
    return Page(
        items=[review_out(r.Review, r.ReviewPrediction, issues.get(r.issue_id)) for r in rows],
        total=total, page=page, page_size=page_size,
    )


@router.get("/{app_id}/export")
def export(
    app_id: str,
    kind: str = Query("issues", pattern="^(issues|reviews)$"),
    format: str = Query("csv", pattern="^(csv|json)$"),
    session: Session = Depends(get_db),
):
    get_app_or_404(session, app_id)
    rows = issue_rows(session, app_id) if kind == "issues" else review_rows(session, app_id)
    content = to_csv(rows) if format == "csv" else to_json(rows)
    media = "text/csv" if format == "csv" else "application/json"
    filename = f"{app_id}_{kind}.{format}"
    return Response(content, media_type=f"{media}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
