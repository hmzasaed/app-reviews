"""Persistent issue tracking: membership, metrics, priority, history and merges.

Issue metrics are always derived from the stored membership, so the analysis run,
developer merges and re-runs all share one code path.
"""

from collections import Counter
from dataclasses import asdict
from datetime import datetime

import numpy as np
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from database.models import Issue, IssueEvent, IssueReview, Job, Review, ReviewEmbedding, ReviewPrediction
from pipeline.clustering import centroid_of, select_representatives
from pipeline.prioritization import MemberFeature, PriorityContext, compute_priority


def vec_to_bytes(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def bytes_to_vec(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=np.float32)


def log_event(session: Session, issue: Issue, event_type: str, previous=None, new=None, note: str | None = None) -> None:
    session.add(IssueEvent(
        issue_id=issue.id, event_type=event_type,
        previous_value=None if previous is None else str(previous),
        new_value=None if new is None else str(new),
        note=note,
    ))


def set_membership(session: Session, issue: Issue, review_ids: list[int]) -> None:
    session.execute(delete(IssueReview).where(IssueReview.issue_id == issue.id))
    session.add_all(IssueReview(issue_id=issue.id, review_id=rid) for rid in dict.fromkeys(review_ids))
    session.flush()


def _fixed_at(session: Session, issue: Issue) -> datetime | None:
    return session.scalar(
        select(func.max(IssueEvent.created_at)).where(
            IssueEvent.issue_id == issue.id, IssueEvent.event_type == "status_changed", IssueEvent.new_value == "fixed"
        )
    )


def refresh_issue_metrics(session: Session, issue: Issue, ctx: PriorityContext, embedding_model: str) -> None:
    """Recompute centroid, representatives, counts, priority and confidence from membership."""
    rows = session.execute(
        select(IssueReview, Review, ReviewPrediction.category)
        .join(Review, Review.id == IssueReview.review_id)
        .outerjoin(ReviewPrediction, ReviewPrediction.review_id == Review.id)
        .where(IssueReview.issue_id == issue.id)
    ).all()
    if not rows:
        issue.review_count = 0
        issue.is_active = False
        return

    vectors = {
        e.review_id: bytes_to_vec(e.vector)
        for e in session.scalars(
            select(ReviewEmbedding).where(
                ReviewEmbedding.review_id.in_([r.Review.id for r in rows]), ReviewEmbedding.model == embedding_model
            )
        )
    }
    with_vec = [r for r in rows if r.Review.id in vectors]
    coherence = 0.0
    for r in rows:
        r.IssueReview.is_representative = False
    if with_vec:
        matrix = np.stack([vectors[r.Review.id] for r in with_vec])
        centroid = centroid_of(matrix)
        sims = np.clip(matrix @ centroid, 0.0, 1.0)
        coherence = float(sims.mean())
        for r, sim in zip(with_vec, sims):
            r.IssueReview.membership_confidence = round(float(sim), 4)
        for pos in select_representatives(matrix, centroid):
            with_vec[pos].IssueReview.is_representative = True
        issue.centroid = vec_to_bytes(centroid)

    members = [
        MemberFeature(
            rating=r.Review.rating, review_date=r.Review.review_date, category=r.category,
            text=r.Review.normalized_text, thumbs_up=r.Review.thumbs_up,
        )
        for r in rows
    ]
    llm_category = issue.category if issue.category_source == "llm" else None
    result = compute_priority(members, ctx, coherence, category=llm_category)

    fixed_at = _fixed_at(session, issue) if issue.status == "fixed" else None
    if fixed_at:
        after_fix = sum(1 for m in members if m.review_date > fixed_at)
        if after_fix:
            result.breakdown["notes"].append(f"{after_fix} reviews were posted after this issue was marked fixed")

    if issue.id and issue.priority_label != result.label and issue.review_count:
        log_event(session, issue, "priority_changed", issue.priority_label, result.label)

    issue.review_count = len(members)
    issue.thumbs_up_total = sum(m.thumbs_up for m in members)
    issue.first_seen_at = min(m.review_date for m in members)
    issue.last_seen_at = max(m.review_date for m in members)
    issue.category = result.category
    issue.priority_score = result.score
    issue.priority_label = result.label
    issue.priority_breakdown = result.breakdown
    issue.severity = result.severity
    issue.confidence = result.confidence
    session.flush()


def member_rows(session: Session, issue_id: int):
    """(IssueReview, Review) pairs ordered representative-first, then by closeness to the centroid."""
    return session.execute(
        select(IssueReview, Review)
        .join(Review, Review.id == IssueReview.review_id)
        .where(IssueReview.issue_id == issue_id)
        .order_by(IssueReview.is_representative.desc(), IssueReview.membership_confidence.desc(), Review.id)
    ).all()


def rating_distribution(reviews: list[Review]) -> dict[str, int]:
    counts = Counter(r.rating for r in reviews)
    return {str(star): counts.get(star, 0) for star in range(1, 6)}


def context_from_job(session: Session, app_id: str) -> PriorityContext | None:
    """Priority context recorded by the latest completed analysis, with max issue size refreshed."""
    job = session.scalars(
        select(Job).where(Job.app_id == app_id, Job.kind == "analyze", Job.status == "completed")
        .order_by(Job.completed_at.desc()).limit(1)
    ).first()
    saved = (job.result or {}).get("priority_context") if job else None
    if not saved:
        return None
    max_count = session.scalar(
        select(func.max(Issue.review_count)).where(Issue.app_id == app_id, Issue.is_active.is_(True))
    ) or 1
    return PriorityContext(
        reference_date=datetime.fromisoformat(saved["reference_date"]),
        app_recent=saved["app_recent"],
        app_previous=saved["app_previous"],
        max_issue_count=max_count,
    )


def context_to_dict(ctx: PriorityContext) -> dict:
    data = asdict(ctx)
    data["reference_date"] = ctx.reference_date.isoformat()
    return data


def merge_issues(session: Session, source: Issue, target: Issue, embedding_model: str) -> Issue:
    """Move all of ``source``'s reviews into ``target`` and retire ``source``."""
    if source.id == target.id:
        raise ValueError("Cannot merge an issue into itself")
    if source.app_id != target.app_id:
        raise ValueError("Issues belong to different apps")
    if target.status == "merged":
        raise ValueError("Target issue has itself been merged; merge into its replacement instead")

    review_ids = list(session.scalars(select(IssueReview.review_id).where(IssueReview.issue_id.in_([source.id, target.id]))))
    set_membership(session, target, review_ids)
    session.execute(delete(IssueReview).where(IssueReview.issue_id == source.id))

    log_event(session, source, "merged", source.status, "merged", note=f"Merged into issue #{target.id}")
    log_event(session, target, "merged_in", None, str(source.id), note=f"Absorbed issue #{source.id}: {source.title}")
    source.status, source.merged_into_id, source.is_active, source.review_count = "merged", target.id, False, 0
    target.is_active = True

    ctx = context_from_job(session, target.app_id)
    if ctx is not None:
        ctx.max_issue_count = max(ctx.max_issue_count, len(set(review_ids)))
        refresh_issue_metrics(session, target, ctx, embedding_model)
    session.flush()
    return target
