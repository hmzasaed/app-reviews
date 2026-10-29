"""ORM -> response schema conversion."""

from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.schemas import (
    AppOut, CountItem, IssueDetailOut, IssueEventOut, IssueSummaryOut, ReviewOut, TrendPoint,
)
from database.models import App, Issue, IssueEvent, Review, ReviewPrediction
from pipeline.ingestion import review_source_url
from pipeline.issues import member_rows, rating_distribution
from pipeline.prioritization import confidence_label
from pipeline.taxonomy import label_for


def app_out(session: Session, app: App) -> AppOut:
    count = session.scalar(select(func.count()).select_from(Review).where(Review.app_id == app.id)) or 0
    return AppOut.model_validate(app).model_copy(update={"review_count": count})


def review_out(
    review: Review,
    prediction: ReviewPrediction | None,
    issue: Issue | None = None,
    membership_confidence: float | None = None,
    is_representative: bool = False,
    evidence_ids: set[int] | None = None,
) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        source_review_id=review.source_review_id,
        text=review.original_text,
        rating=review.rating,
        thumbs_up=review.thumbs_up,
        review_date=review.review_date,
        app_version=review.app_version,
        language=review.language,
        developer_reply=review.developer_reply,
        sentiment=prediction.sentiment if prediction else None,
        sentiment_score=prediction.sentiment_score if prediction else None,
        category=prediction.category if prediction else None,
        category_confidence=prediction.category_confidence if prediction else None,
        issue_id=issue.id if issue else None,
        issue_title=issue.title if issue else None,
        source_url=review_source_url(review.app_id, review.source_review_id),
        membership_confidence=membership_confidence,
        is_representative=is_representative,
        is_evidence=bool(evidence_ids and review.id in evidence_ids),
    )


def issue_summary(issue: Issue) -> IssueSummaryOut:
    return IssueSummaryOut(**_summary_fields(issue))


def _summary_fields(issue: Issue) -> dict:
    return {
        "id": issue.id,
        "app_id": issue.app_id,
        "title": issue.title,
        "title_source": issue.title_source,
        "summary": issue.summary,
        "category": issue.category,
        "category_label": label_for(issue.category),
        "keywords": issue.keywords or [],
        "review_count": issue.review_count,
        "thumbs_up_total": issue.thumbs_up_total,
        "priority_score": issue.priority_score,
        "priority_label": issue.priority_label,
        "effective_priority": issue.priority_override or issue.priority_label,
        "priority_override": issue.priority_override,
        "severity": issue.severity,
        "confidence": issue.confidence,
        "confidence_label": confidence_label(issue.confidence),
        "status": issue.status,
        "is_active": issue.is_active,
        "trend": (issue.priority_breakdown or {}).get("trend", "insufficient_data"),
        "first_seen_at": issue.first_seen_at,
        "last_seen_at": issue.last_seen_at,
    }


def week_start(value: datetime) -> str:
    return (value - timedelta(days=value.weekday())).date().isoformat()


def issue_detail(session: Session, issue: Issue) -> IssueDetailOut:
    rows = member_rows(session, issue.id)
    reviews = [r.Review for r in rows]
    predictions = {
        p.review_id: p
        for p in session.scalars(select(ReviewPrediction).where(ReviewPrediction.review_id.in_([r.id for r in reviews])))
    } if reviews else {}
    evidence = set(issue.evidence_review_ids or [])

    weekly = Counter(week_start(r.review_date) for r in reviews)
    versions = Counter(r.app_version or "unknown" for r in reviews)
    # Representatives first; make sure every cited evidence review is included.
    shown = [r for r in rows if r.IssueReview.is_representative or r.Review.id in evidence]
    events = session.scalars(
        select(IssueEvent).where(IssueEvent.issue_id == issue.id).order_by(IssueEvent.created_at.desc(), IssueEvent.id.desc())
    )
    return IssueDetailOut(
        **_summary_fields(issue),
        possible_impact=issue.possible_impact,
        suggested_investigation=issue.suggested_investigation or [],
        evidence_review_ids=issue.evidence_review_ids or [],
        root_cause_confirmed=False,
        summary_model=issue.summary_model,
        summary_warnings=issue.summary_warnings or [],
        priority_breakdown=issue.priority_breakdown,
        override_reason=issue.override_reason,
        merged_into_id=issue.merged_into_id,
        rating_distribution=rating_distribution(reviews),
        versions=[CountItem(key=k, count=v) for k, v in versions.most_common(10)],
        weekly_trend=[TrendPoint(period=k, count=v) for k, v in sorted(weekly.items())],
        events=[IssueEventOut.model_validate(e) for e in events],
        representative_reviews=[
            review_out(r.Review, predictions.get(r.Review.id), issue, r.IssueReview.membership_confidence,
                       r.IssueReview.is_representative, evidence)
            for r in sorted(shown, key=lambda r: (r.Review.id not in evidence, -r.IssueReview.membership_confidence))
        ],
    )
