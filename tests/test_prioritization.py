from datetime import datetime, timedelta

from pipeline.prioritization import (
    MemberFeature, PriorityContext, compute_priority, confidence_label, is_severe_text, label_for_score,
)

REF = datetime(2026, 10, 15)


def members(n, category="crash_stability", rating=1, days_ago=lambda i: i, text="it crashes"):
    return [MemberFeature(rating=rating, review_date=REF - timedelta(days=days_ago(i)), category=category, text=text) for i in range(n)]


def ctx(max_count=50, recent=200, previous=200):
    return PriorityContext(reference_date=REF, app_recent=recent, app_previous=previous, max_issue_count=max_count)


def test_labels_follow_thresholds():
    assert [label_for_score(s) for s in (95, 80, 79.9, 60, 35, 34.9, 0)] == ["critical", "critical", "high", "high", "medium", "low", "low"]
    assert confidence_label(0.8) == "high" and confidence_label(0.5) == "medium" and confidence_label(0.1) == "low"


def test_score_is_weighted_sum_of_components():
    result = compute_priority(members(20), ctx(), coherence=0.7)
    comps = result.breakdown["components"]
    expected = 100 * (0.35 * comps["frequency"] + 0.30 * comps["severity"] + 0.20 * comps["recency"] + 0.15 * comps["growth"])
    assert abs(result.score - expected) < 0.2
    assert 0 <= result.score <= 100


def test_payment_issue_outranks_larger_cosmetic_issue():
    payments = compute_priority(members(30, "payment_billing", text="charged twice no refund"), ctx(max_count=50), 0.7)
    cosmetic = compute_priority(members(50, "ui_usability", rating=3, text="the new layout is different"), ctx(max_count=50), 0.7)
    assert payments.score > cosmetic.score


def test_severe_text_raises_severity():
    assert is_severe_text("They deducted money twice and no refund")
    assert is_severe_text("All my photos disappeared after the update")
    assert not is_severe_text("The colors are ugly")
    result = compute_priority(members(10, "ui_usability", rating=3, text="all my notes were deleted"), ctx(), 0.7)
    assert result.severity >= 0.9
    assert any("lost money or lost data" in n for n in result.breakdown["notes"])


def test_cluster_category_prefers_clear_specific_minority_over_uncertain():
    mixed = members(6, "other") + members(3, "account_data") + members(1, "login_auth")
    assert compute_priority(mixed, ctx(), 0.7).category == "account_data"
    mostly_uncertain = members(9, "other") + members(1, "account_data")
    assert compute_priority(mostly_uncertain, ctx(), 0.7).category == "other"
    assert compute_priority(mostly_uncertain, ctx(), 0.7, category="payment_billing").category == "payment_billing"


def test_recent_complaints_score_higher_recency():
    fresh = compute_priority(members(10, days_ago=lambda i: 1), ctx(), 0.7)
    stale = compute_priority(members(10, days_ago=lambda i: 90), ctx(), 0.7)
    assert fresh.breakdown["components"]["recency"] > stale.breakdown["components"]["recency"]


def test_growth_requires_enough_data():
    result = compute_priority(members(3), ctx(), 0.7)
    assert result.trend == "insufficient_data" and result.breakdown["components"]["growth"] == 0
    thin_app = compute_priority(members(10, days_ago=lambda i: i * 2), ctx(recent=5, previous=5), 0.7)
    assert thin_app.trend == "insufficient_data"


def test_growth_detects_rising_and_new_issues():
    # 8 reviews in the recent window, 2 in the previous one, with equal app volume -> rising
    rising = compute_priority(members(10, days_ago=lambda i: 1 if i < 8 else 20), ctx(), 0.7)
    assert rising.trend == "rising" and rising.breakdown["components"]["growth"] > 0
    new = compute_priority(members(6, days_ago=lambda i: 2), ctx(), 0.7)
    assert new.trend == "new" and new.breakdown["components"]["growth"] == 1.0
    falling = compute_priority(members(10, days_ago=lambda i: 1 if i < 2 else 20), ctx(), 0.7)
    assert falling.trend == "falling" and falling.breakdown["components"]["growth"] == 0


def test_absolute_count_matters_on_small_datasets():
    # Same relative size (the largest issue) but very different absolute evidence.
    tiny = compute_priority(members(3), ctx(max_count=3), 0.7)
    large = compute_priority(members(80), ctx(max_count=80), 0.7)
    assert large.breakdown["components"]["frequency"] > tiny.breakdown["components"]["frequency"]
    assert any("Low evidence" in n for n in tiny.breakdown["notes"])
