"""CSV / JSON exports of ranked issues and analysed reviews."""

import csv
import io
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Issue, IssueReview, Review, ReviewPrediction
from pipeline.ingestion import review_source_url
from pipeline.taxonomy import label_for


def issue_rows(session: Session, app_id: str, include_inactive: bool = False) -> list[dict]:
    query = select(Issue).where(Issue.app_id == app_id, Issue.status != "merged")
    if not include_inactive:
        query = query.where(Issue.is_active.is_(True))
    rows = []
    for issue in session.scalars(query.order_by(Issue.priority_score.desc())):
        rows.append({
            "issue_id": issue.id,
            "title": issue.title,
            "category": label_for(issue.category),
            "priority": issue.priority_override or issue.priority_label,
            "priority_score": issue.priority_score,
            "priority_overridden": issue.priority_override is not None,
            "status": issue.status,
            "review_count": issue.review_count,
            "thumbs_up_total": issue.thumbs_up_total,
            "confidence": issue.confidence,
            "trend": (issue.priority_breakdown or {}).get("trend"),
            "first_seen_at": issue.first_seen_at.isoformat() if issue.first_seen_at else None,
            "last_seen_at": issue.last_seen_at.isoformat() if issue.last_seen_at else None,
            "summary": issue.summary,
            "possible_impact": issue.possible_impact,
            "suggested_investigation": " | ".join(issue.suggested_investigation or []),
            "evidence_review_ids": ",".join(str(i) for i in issue.evidence_review_ids or []),
            "keywords": ", ".join(issue.keywords or []),
            "root_cause_confirmed": False,
        })
    return rows


def review_rows(session: Session, app_id: str) -> list[dict]:
    active_issue = (
        select(IssueReview.review_id, IssueReview.issue_id)
        .join(Issue, Issue.id == IssueReview.issue_id)
        .where(Issue.app_id == app_id, Issue.is_active.is_(True))
        .subquery()
    )
    query = (
        select(Review, ReviewPrediction, active_issue.c.issue_id)
        .outerjoin(ReviewPrediction, ReviewPrediction.review_id == Review.id)
        .outerjoin(active_issue, active_issue.c.review_id == Review.id)
        .where(Review.app_id == app_id)
        .order_by(Review.review_date.desc())
    )
    rows = []
    for review, pred, issue_id in session.execute(query):
        rows.append({
            "review_id": review.id,
            "source_review_id": review.source_review_id,
            "review_date": review.review_date.isoformat(),
            "rating": review.rating,
            "thumbs_up": review.thumbs_up,
            "app_version": review.app_version,
            "language": review.language,
            "text": review.original_text,
            "sentiment": pred.sentiment if pred else None,
            "category": label_for(pred.category) if pred else None,
            "issue_id": issue_id,
            "developer_reply": review.developer_reply,
            "source_url": review_source_url(app_id, review.source_review_id),
        })
    return rows


def to_csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    if rows:
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return buffer.getvalue()


def to_json(rows: list[dict]) -> str:
    return json.dumps(rows, ensure_ascii=False, indent=2, default=str)
