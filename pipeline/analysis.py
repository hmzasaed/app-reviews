"""Analysis run: predictions -> embeddings -> clustering -> issue tracking -> ranking -> summaries."""

import logging
from collections import Counter
from collections.abc import Callable
from datetime import timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import App, Issue, Review, ReviewEmbedding, ReviewPrediction, utcnow
from pipeline.clustering import (
    build_clusters, cluster_labels, effective_min_cluster_size, match_clusters, merge_similar_labels,
)
from pipeline.config import get_settings
from pipeline.issues import (
    bytes_to_vec, context_to_dict, log_event, member_rows, rating_distribution, refresh_issue_metrics,
    set_membership, vec_to_bytes,
)
from pipeline.llm import LLMClient
from pipeline.nlp import NLPModels
from pipeline.preprocessing import word_count
from pipeline.prioritization import GROWTH_WINDOW_DAYS, PriorityContext
from pipeline.summarization import ClusterInput, ReviewSnippet, summarize_cluster
from pipeline.taxonomy import PROBLEM_KEYS

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, float], None]
MIN_WORDS_FOR_CLUSTERING = 4  # "worst app ever" carries no diagnostic detail
CHUNK = 64


def is_cluster_candidate(review: Review, prediction: ReviewPrediction) -> bool:
    """Reported problems and feature requests with enough text to describe something specific."""
    if word_count(review.normalized_text) < MIN_WORDS_FOR_CLUSTERING:
        return False
    if prediction.category == "feature_request":
        return True
    is_complaint = review.rating <= 3 or prediction.sentiment == "negative"
    return is_complaint and prediction.category in PROBLEM_KEYS


def _predict(session: Session, reviews: list[Review], models: NLPModels, progress: ProgressFn) -> int:
    existing = {
        p.review_id: p
        for p in session.scalars(
            select(ReviewPrediction).join(Review).where(Review.app_id == reviews[0].app_id)
        )
    }
    todo = [
        r for r in reviews
        if r.id not in existing
        or existing[r.id].sentiment_model != models.sentiment.name
        or existing[r.id].category_model != models.classifier.name
    ]
    for start in range(0, len(todo), CHUNK):
        batch = todo[start:start + CHUNK]
        texts = [r.normalized_text for r in batch]
        sentiments = models.sentiment.predict(texts)
        categories = models.classifier.predict(texts)
        for review, (sentiment, s_score), (category, c_score) in zip(batch, sentiments, categories):
            pred = existing.get(review.id) or ReviewPrediction(review_id=review.id)
            pred.sentiment, pred.sentiment_score = sentiment, round(s_score, 4)
            pred.category, pred.category_confidence = category, round(c_score, 4)
            pred.sentiment_model, pred.category_model = models.sentiment.name, models.classifier.name
            session.add(pred)
            existing[review.id] = pred
        session.commit()
        progress(f"Classified {min(start + CHUNK, len(todo))}/{len(todo)} reviews", 0.05 + 0.45 * (start + len(batch)) / len(todo))
    return len(todo)


def _embed(session: Session, reviews: list[Review], models: NLPModels, progress: ProgressFn) -> np.ndarray:
    name = models.embedder.name
    ids = [r.id for r in reviews]
    cached: dict[int, np.ndarray] = {}
    for start in range(0, len(ids), 1000):
        for e in session.scalars(select(ReviewEmbedding).where(ReviewEmbedding.review_id.in_(ids[start:start + 1000]))):
            if e.model == name:
                cached[e.review_id] = bytes_to_vec(e.vector)
    todo = [r for r in reviews if r.id not in cached]
    for start in range(0, len(todo), CHUNK * 4):
        batch = todo[start:start + CHUNK * 4]
        vectors = models.embedder.encode([r.normalized_text for r in batch])
        for review, vector in zip(batch, vectors):
            cached[review.id] = vector
            session.merge(ReviewEmbedding(review_id=review.id, model=name, vector=vec_to_bytes(vector)))
        session.commit()
        progress(f"Embedded {min(start + len(batch), len(todo))}/{len(todo)} complaints", 0.5 + 0.15 * (start + len(batch)) / len(todo))
    return np.stack([cached[r.id] for r in reviews]) if reviews else np.zeros((0, 1), dtype=np.float32)


def _priority_context(reviews: list[Review], max_issue_count: int) -> PriorityContext:
    reference = max(r.review_date for r in reviews)
    recent_start = reference - timedelta(days=GROWTH_WINDOW_DAYS)
    previous_start = recent_start - timedelta(days=GROWTH_WINDOW_DAYS)
    return PriorityContext(
        reference_date=reference,
        app_recent=sum(1 for r in reviews if r.review_date > recent_start),
        app_previous=sum(1 for r in reviews if previous_start < r.review_date <= recent_start),
        max_issue_count=max(max_issue_count, 1),
    )


def _cluster_input(session: Session, issue: Issue) -> ClusterInput:
    rows = member_rows(session, issue.id)
    reviews = [r.Review for r in rows]
    dates = sorted(r.review_date for r in reviews)
    versions = Counter(r.app_version for r in reviews if r.app_version)
    return ClusterInput(
        category=issue.category,
        keywords=issue.keywords or [],
        review_count=len(reviews),
        rating_distribution=rating_distribution(reviews),
        date_range=(dates[0].date().isoformat(), dates[-1].date().isoformat()),
        top_versions=[v for v, _ in versions.most_common(5)],
        reviews=[
            ReviewSnippet(id=r.id, rating=r.rating, date=r.review_date.date().isoformat(), version=r.app_version, text=r.normalized_text)
            for r in reviews
        ],
    )


def _apply_summary(issue: Issue, summary) -> None:
    if issue.title_source != "user":
        issue.title, issue.title_source = summary.title, summary.title_source
    issue.summary = summary.summary
    issue.possible_impact = summary.possible_impact
    issue.suggested_investigation = summary.suggested_investigation
    issue.evidence_review_ids = summary.evidence_review_ids
    issue.summary_model = summary.model
    issue.summary_warnings = summary.warnings
    issue.root_cause_confirmed = False


def analyze_app(
    session: Session,
    app_id: str,
    models: NLPModels,
    llm: LLMClient | None = None,
    window_days: int | None = None,
    run_id: int | None = None,
    progress: ProgressFn | None = None,
) -> dict:
    settings = get_settings()
    progress = progress or (lambda stage, pct: None)
    llm = llm or LLMClient(settings)
    app = session.get(App, app_id)
    if app is None:
        raise ValueError(f"App '{app_id}' is not registered")

    query = select(Review).where(Review.app_id == app_id, Review.is_empty.is_(False))
    if window_days:
        query = query.where(Review.review_date >= utcnow() - timedelta(days=window_days))
    all_reviews = list(session.scalars(query.order_by(Review.review_date)))
    supported_langs = {lang.lower() for lang in settings.supported_languages}
    reviews = [r for r in all_reviews if (r.language or app.lang).lower() in supported_langs]
    if not reviews:
        raise ValueError("No reviews in a supported language to analyze. Collect reviews first.")

    progress("Classifying sentiment and issue categories", 0.05)
    predicted = _predict(session, reviews, models, progress)
    predictions = {
        p.review_id: p
        for p in session.scalars(select(ReviewPrediction).join(Review).where(Review.app_id == app_id))
    }
    candidates = [r for r in reviews if is_cluster_candidate(r, predictions[r.id])]

    progress("Embedding complaints", 0.5)
    embeddings = _embed(session, candidates, models, progress)

    progress("Clustering related complaints", 0.66)
    min_size = effective_min_cluster_size(len(candidates), settings.min_cluster_size)
    labels = cluster_labels(
        embeddings, settings.clustering_method, min_size, settings.agglomerative_distance_threshold
    ) if candidates else np.zeros(0, dtype=int)
    if settings.cluster_merge_threshold <= 1 and len(labels):
        labels = merge_similar_labels(embeddings, labels, settings.cluster_merge_threshold)
    clusters = build_clusters(embeddings, labels, [r.normalized_text for r in candidates]) if candidates else []

    progress("Updating tracked issues", 0.72)
    ctx = _priority_context(reviews, max((len(c.members) for c in clusters), default=1))
    existing = {
        i.id: i
        for i in session.scalars(select(Issue).where(Issue.app_id == app_id, Issue.status != "merged"))
        if i.centroid is not None
    }
    matches = match_clusters(
        [c.centroid for c in clusters], {i: bytes_to_vec(v.centroid) for i, v in existing.items()},
        settings.issue_match_threshold,
    )
    run_issues: list[Issue] = []
    created = 0
    for idx, cluster in enumerate(clusters):
        issue = existing.get(matches.get(idx, -1))
        previous_count = issue.review_count if issue else 0
        if issue is None:
            issue = Issue(app_id=app_id, title="Untitled issue", status="new")
            session.add(issue)
            session.flush()
            log_event(session, issue, "created", note=f"Detected in analysis run #{run_id}" if run_id else None)
            created += 1
        set_membership(session, issue, [candidates[i].id for i in cluster.members])
        issue.keywords = cluster.keywords
        issue.is_active = True
        issue.last_run_id = run_id
        refresh_issue_metrics(session, issue, ctx, models.embedder.name)
        if previous_count and previous_count != issue.review_count:
            log_event(session, issue, "review_count_changed", previous_count, issue.review_count)
        run_issues.append(issue)

    matched_ids = {i.id for i in run_issues}
    for issue in existing.values():
        if issue.id not in matched_ids and issue.is_active:
            issue.is_active = False
            log_event(session, issue, "inactive", note="No matching complaints in the latest analysis")
    session.commit()

    progress("Summarizing top issues", 0.8)
    run_issues.sort(key=lambda i: i.priority_score, reverse=True)
    to_summarize = [i for i in run_issues if i.review_count >= settings.min_reviews_for_summary][: settings.max_summaries_per_run]
    disabled = _DisabledLLM()
    generated = cached = consecutive_failures = 0
    for n, issue in enumerate(to_summarize, start=1):
        # Stop calling the provider after repeated failures (bad key, exhausted free quota).
        client = llm if consecutive_failures < 2 else disabled
        summary = summarize_cluster(session, client, _cluster_input(session, issue))
        if client.available:
            if summary.model == "keywords":
                consecutive_failures += 1
            elif summary.cached:
                consecutive_failures, cached = 0, cached + 1
            else:
                consecutive_failures, generated = 0, generated + 1
        # Keep an earlier LLM summary rather than replacing it with a keyword fallback.
        if summary.model != "keywords" or issue.summary_model in (None, "keywords"):
            _apply_summary(issue, summary)
        # The LLM sees the whole cluster, so its category beats the noisy per-review vote;
        # severity (and so priority) depends on the category, so recompute.
        if summary.category and summary.category != issue.category:
            log_event(session, issue, "category_changed", issue.category, summary.category, note="Categorised by LLM")
            issue.category, issue.category_source = summary.category, "llm"
            refresh_issue_metrics(session, issue, ctx, models.embedder.name)
        session.commit()
        progress(f"Summarized {n}/{len(to_summarize)} issues", 0.8 + 0.18 * n / len(to_summarize))
    summarized_ids = {i.id for i in to_summarize}
    for issue in run_issues:
        if issue.id not in summarized_ids and not issue.summary:
            _apply_summary(issue, summarize_cluster(session, disabled, _cluster_input(session, issue)))

    app.last_analyzed_at = utcnow()
    session.commit()
    return {
        "reviews_considered": len(all_reviews),
        "reviews_analyzed": len(reviews),
        "skipped_unsupported_language": len(all_reviews) - len(reviews),
        "predictions_computed": predicted,
        "cluster_candidates": len(candidates),
        "clusters": len(clusters),
        "unclustered": int((labels == -1).sum()) if len(candidates) else 0,
        "min_cluster_size": min_size,
        "new_issues": created,
        "updated_issues": len(run_issues) - created,
        "summaries_generated": generated,
        "summaries_from_cache": cached,
        "llm": llm.describe(),
        "llm_disabled_after_failures": consecutive_failures >= 2,
        "priority_context": context_to_dict(ctx),
    }


class _DisabledLLM:
    """Stand-in that makes summarize_cluster fall back to keyword summaries."""

    available = False
