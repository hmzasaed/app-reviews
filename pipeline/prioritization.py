"""Issue prioritization: P = 100 * (0.35F + 0.30S + 0.20R + 0.15G).

F = frequency, S = severity, R = recency, G = growth, each normalised to 0-1.
The weights are starting assumptions to validate with developers, not a standard.
Priority is kept separate from confidence (how coherent/well-supported the cluster is).
"""

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pipeline.taxonomy import severity_for

WEIGHTS = {"frequency": 0.35, "severity": 0.30, "recency": 0.20, "growth": 0.15}
LABEL_THRESHOLDS = [(80.0, "critical"), (60.0, "high"), (35.0, "medium"), (0.0, "low")]
GROWTH_WINDOW_DAYS = 14
RECENCY_HALF_LIFE_DAYS = 14
ABSOLUTE_COUNT_SATURATION = 100  # an issue with this many reviews gets full absolute-frequency credit
MIN_ISSUE_REVIEWS_FOR_GROWTH = 5
MIN_APP_REVIEWS_PER_WINDOW = 20

# Explicit severity rules: money lost or user data lost are always treated as severe.
SEVERE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(charged|deducted|debited|billed)\b.{0,20}\b(twice|double|again|without)\b",
        r"\b(money|amount|payment)\b.{0,25}\b(deducted|debited|taken|lost|gone|stuck|not (been )?refunded)\b",
        r"\bno refund\b|\bnot refunded\b|\brefund (not|never)\b",
        r"\b(lost|deleted|erased|wiped|disappeared)\b.{0,25}\b(data|photos?|files?|messages?|chats?|progress|notes|contacts|account|history)\b",
        r"\b(data|photos?|files?|messages?|chats?|progress|notes|contacts|account|history)\b.{0,25}\b(lost|deleted|erased|wiped|gone|disappeared)\b",
    )
]
SEVERE_SHARE_THRESHOLD = 0.2


@dataclass
class MemberFeature:
    rating: int
    review_date: datetime
    category: str | None
    text: str
    thumbs_up: int = 0


@dataclass
class PriorityContext:
    reference_date: datetime  # newest analysed review; makes scores reproducible for old datasets
    app_recent: int  # all analysed reviews in the recent growth window
    app_previous: int  # all analysed reviews in the previous growth window
    max_issue_count: int  # largest issue in the run, for relative frequency


@dataclass
class PriorityResult:
    score: float
    label: str
    severity: float
    confidence: float
    category: str | None
    trend: str
    breakdown: dict = field(default_factory=dict)


def label_for_score(score: float) -> str:
    for threshold, label in LABEL_THRESHOLDS:
        if score >= threshold:
            return label
    return "low"


def confidence_label(confidence: float) -> str:
    if confidence >= 0.7:
        return "high"
    if confidence >= 0.45:
        return "medium"
    return "low"


def is_severe_text(text: str) -> bool:
    return any(p.search(text) for p in SEVERE_PATTERNS)


def dominant_category(members: list[MemberFeature]) -> str | None:
    """Most common specific category, if it covers at least a quarter of the cluster.

    Individual zero-shot labels are noisy, but a cluster is one topic, so a clear minority
    of confident labels says more than a majority of 'other' (uncertain) predictions.
    """
    counts = Counter(m.category for m in members if m.category)
    if not counts:
        return None
    specific = [(key, n) for key, n in counts.most_common() if key != "other"]
    if specific and specific[0][1] >= 0.25 * len(members):
        return specific[0][0]
    return counts.most_common(1)[0][0]


def _frequency(count: int, max_count: int) -> float:
    relative = count / max_count if max_count else 0.0
    absolute = min(1.0, math.log1p(count) / math.log1p(ABSOLUTE_COUNT_SATURATION))
    return 0.5 * relative + 0.5 * absolute


def _growth(members: list[MemberFeature], ctx: PriorityContext, notes: list[str]) -> tuple[float, str, dict]:
    recent_start = ctx.reference_date - timedelta(days=GROWTH_WINDOW_DAYS)
    previous_start = recent_start - timedelta(days=GROWTH_WINDOW_DAYS)
    recent = sum(1 for m in members if m.review_date > recent_start)
    previous = sum(1 for m in members if previous_start < m.review_date <= recent_start)
    counts = {"recent": recent, "previous": previous, "window_days": GROWTH_WINDOW_DAYS}

    if recent + previous < MIN_ISSUE_REVIEWS_FOR_GROWTH:
        notes.append(f"Growth not scored: fewer than {MIN_ISSUE_REVIEWS_FOR_GROWTH} reviews across both windows")
        return 0.0, "insufficient_data", counts
    if ctx.app_recent < MIN_APP_REVIEWS_PER_WINDOW or ctx.app_previous < MIN_APP_REVIEWS_PER_WINDOW:
        notes.append(
            f"Growth not scored: the app has fewer than {MIN_APP_REVIEWS_PER_WINDOW} analysed reviews "
            f"in one of the {GROWTH_WINDOW_DAYS}-day windows"
        )
        return 0.0, "insufficient_data", counts
    if previous == 0:
        notes.append("Newly emerging: no matching reviews in the previous window")
        return 1.0, "new", counts
    # Compare shares, not raw counts, so overall review volume changes don't look like growth.
    change = (recent / ctx.app_recent) / (previous / ctx.app_previous) - 1.0
    counts["share_change"] = round(change, 3)
    trend = "rising" if change > 0.25 else "falling" if change < -0.25 else "stable"
    return min(max(change / 2.0, 0.0), 1.0), trend, counts


def compute_priority(
    members: list[MemberFeature], ctx: PriorityContext, coherence: float, category: str | None = None
) -> PriorityResult:
    """``category`` overrides the member vote (e.g. when the LLM categorised the whole cluster)."""
    notes: list[str] = []
    count = len(members)
    category = category or dominant_category(members)

    frequency = _frequency(count, ctx.max_issue_count)

    low_rating_share = sum(1 for m in members if m.rating <= 2) / count if count else 0.0
    severe_share = sum(1 for m in members if is_severe_text(m.text)) / count if count else 0.0
    severity = 0.6 * severity_for(category) + 0.4 * low_rating_share
    if severe_share >= SEVERE_SHARE_THRESHOLD:
        severity = max(severity, 0.9)
        notes.append("Severity raised: reviews describe lost money or lost data")

    ages = [max((ctx.reference_date - m.review_date).total_seconds() / 86400, 0.0) for m in members]
    recency = sum(0.5 ** (age / RECENCY_HALF_LIFE_DAYS) for age in ages) / count if count else 0.0

    growth, trend, growth_counts = _growth(members, ctx, notes)

    components = {"frequency": frequency, "severity": severity, "recency": recency, "growth": growth}
    score = round(100 * sum(WEIGHTS[k] * v for k, v in components.items()), 1)

    confidence = 0.7 * min(max((coherence - 0.3) / 0.45, 0.0), 1.0) + 0.3 * min(count / 20, 1.0)
    if count < 5:
        notes.append("Low evidence: fewer than 5 supporting reviews")

    breakdown = {
        "score": score,
        "weights": WEIGHTS,
        "components": {k: round(v, 3) for k, v in components.items()},
        "counts": {
            "reviews": count,
            "low_rating_share": round(low_rating_share, 3),
            "severe_share": round(severe_share, 3),
            "thumbs_up": sum(m.thumbs_up for m in members),
            **growth_counts,
        },
        "coherence": round(coherence, 3),
        "reference_date": ctx.reference_date.date().isoformat(),
        "trend": trend,
        "notes": notes,
    }
    return PriorityResult(
        score=score,
        label=label_for_score(score),
        severity=round(severity, 3),
        confidence=round(confidence, 3),
        category=category,
        trend=trend,
        breakdown=breakdown,
    )
