"""Human-labelled benchmark: export a stratified sample, label it, then score the pipeline.

Label columns (fill in the exported CSV, leave blank to skip a row for that metric):
  sentiment_label  negative | neutral | positive
  category_label   a taxonomy key (see pipeline/taxonomy.py), e.g. crash_stability
  issue_group      any name; reviews describing the same problem share a name, "none" if no issue
"""

import random
from collections import defaultdict
from itertools import combinations

from sklearn.metrics import f1_score
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Issue, IssueReview, Review, ReviewPrediction

LABEL_COLUMNS = ("sentiment_label", "category_label", "issue_group")


def sample_for_labeling(session: Session, app_id: str, n: int = 400, seed: int = 42) -> list[dict]:
    """Stratified by star rating so 1-2 star complaints aren't drowned out by 5-star praise."""
    active_issue = (
        select(IssueReview.review_id, IssueReview.issue_id)
        .join(Issue, Issue.id == IssueReview.issue_id)
        .where(Issue.app_id == app_id, Issue.is_active.is_(True))
        .subquery()
    )
    rows = session.execute(
        select(Review, ReviewPrediction, active_issue.c.issue_id)
        .join(ReviewPrediction, ReviewPrediction.review_id == Review.id)
        .outerjoin(active_issue, active_issue.c.review_id == Review.id)
        .where(Review.app_id == app_id)
    ).all()
    by_rating: dict[int, list] = defaultdict(list)
    for row in rows:
        by_rating[row.Review.rating].append(row)
    rng = random.Random(seed)
    per_bucket = max(1, n // max(len(by_rating), 1))
    picked = [r for bucket in by_rating.values() for r in rng.sample(bucket, min(per_bucket, len(bucket)))]
    rng.shuffle(picked)
    return [
        {
            "review_id": r.Review.id,
            "rating": r.Review.rating,
            "text": r.Review.original_text,
            "predicted_sentiment": r.ReviewPrediction.sentiment,
            "predicted_category": r.ReviewPrediction.category,
            "predicted_issue_id": r.issue_id or "",
            **{col: "" for col in LABEL_COLUMNS},
        }
        for r in picked
    ]


def _macro_f1(rows: list[dict], label_col: str, pred_col: str) -> dict | None:
    pairs = [(r[label_col].strip(), (r[pred_col] or "").strip()) for r in rows if r.get(label_col, "").strip()]
    if not pairs:
        return None
    y_true, y_pred = zip(*pairs)
    return {"macro_f1": round(f1_score(y_true, y_pred, average="macro", zero_division=0), 3), "n": len(pairs)}


def _pairwise_clustering(rows: list[dict]) -> dict | None:
    """Pair precision: of review pairs we grouped together, how many truly describe the same issue."""
    labelled = [r for r in rows if r.get("issue_group", "").strip()]
    if len(labelled) < 2:
        return None
    tp = fp = fn = 0
    for a, b in combinations(labelled, 2):
        truth = a["issue_group"].strip().lower() == b["issue_group"].strip().lower() and a["issue_group"].strip().lower() != "none"
        pred = bool(a["predicted_issue_id"]) and str(a["predicted_issue_id"]) == str(b["predicted_issue_id"])
        tp += truth and pred
        fp += pred and not truth
        fn += truth and not pred
    return {
        "pair_precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "pair_recall": round(tp / (tp + fn), 3) if tp + fn else None,
        "n_reviews": len(labelled),
    }


def evaluate(rows: list[dict]) -> dict:
    return {
        "sentiment": _macro_f1(rows, "sentiment_label", "predicted_sentiment"),
        "category": _macro_f1(rows, "category_label", "predicted_category"),
        "clustering": _pairwise_clustering(rows),
    }
