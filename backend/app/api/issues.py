from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.deps import get_db, get_issue_or_404
from backend.app.schemas import IssueDetailOut, IssueMerge, IssueUpdate, Page, ReviewOut
from backend.app.serializers import issue_detail, review_out
from database.models import IssueReview, ReviewPrediction
from pipeline.config import get_settings
from pipeline.issues import log_event, member_rows, merge_issues

router = APIRouter(prefix="/issues", tags=["issues"])


@router.get("/{issue_id}", response_model=IssueDetailOut)
def get_issue(issue_id: int, session: Session = Depends(get_db)):
    return issue_detail(session, get_issue_or_404(session, issue_id))


@router.get("/{issue_id}/reviews", response_model=Page[ReviewOut])
def issue_reviews(
    issue_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    session: Session = Depends(get_db),
):
    issue = get_issue_or_404(session, issue_id)
    total = session.scalar(select(func.count()).select_from(IssueReview).where(IssueReview.issue_id == issue_id))
    rows = member_rows(session, issue_id)[(page - 1) * page_size: page * page_size]
    predictions = {
        p.review_id: p
        for p in session.scalars(select(ReviewPrediction).where(ReviewPrediction.review_id.in_([r.Review.id for r in rows])))
    }
    evidence = set(issue.evidence_review_ids or [])
    return Page(
        items=[
            review_out(r.Review, predictions.get(r.Review.id), issue, r.IssueReview.membership_confidence,
                       r.IssueReview.is_representative, evidence)
            for r in rows
        ],
        total=total, page=page, page_size=page_size,
    )


@router.patch("/{issue_id}", response_model=IssueDetailOut)
def update_issue(issue_id: int, body: IssueUpdate, session: Session = Depends(get_db)):
    issue = get_issue_or_404(session, issue_id)
    fields = body.model_fields_set

    if "title" in fields and body.title and body.title != issue.title:
        log_event(session, issue, "renamed", issue.title, body.title)
        issue.title, issue.title_source = body.title.strip(), "user"

    if "status" in fields and body.status and body.status != issue.status:
        if body.status == "merged" or issue.status == "merged":
            raise HTTPException(422, "Use the merge endpoint to merge issues; merged issues cannot change status")
        log_event(session, issue, "status_changed", issue.status, body.status)
        issue.status = body.status

    if "priority_override" in fields:
        if body.priority_override is None:
            if issue.priority_override is not None:
                log_event(session, issue, "priority_override_cleared", issue.priority_override, None)
            issue.priority_override, issue.override_reason = None, None
        else:
            reason = (body.override_reason or "").strip()
            if not reason:
                raise HTTPException(422, "override_reason is required when overriding priority")
            log_event(session, issue, "priority_overridden", issue.priority_override or issue.priority_label,
                      body.priority_override, note=reason)
            issue.priority_override, issue.override_reason = body.priority_override, reason

    session.flush()
    return issue_detail(session, issue)


@router.post("/{issue_id}/merge", response_model=IssueDetailOut)
def merge(issue_id: int, body: IssueMerge, session: Session = Depends(get_db)):
    source = get_issue_or_404(session, issue_id)
    target = get_issue_or_404(session, body.target_issue_id)
    try:
        merge_issues(session, source, target, get_settings().embedding_model)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return issue_detail(session, target)
