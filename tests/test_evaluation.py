from pipeline.analysis import analyze_app
from pipeline.config import Settings
from pipeline.evaluation import evaluate, sample_for_labeling
from pipeline.llm import LLMClient
from tests.conftest import FakeModels


def row(pred_sent, pred_cat, pred_issue, sent="", cat="", group=""):
    return {"predicted_sentiment": pred_sent, "predicted_category": pred_cat, "predicted_issue_id": pred_issue,
            "sentiment_label": sent, "category_label": cat, "issue_group": group}


def test_evaluate_metrics():
    rows = [
        row("negative", "crash_stability", "1", "negative", "crash_stability", "crash"),
        row("negative", "crash_stability", "1", "negative", "crash_stability", "crash"),
        row("negative", "login_auth", "1", "negative", "login_auth", "otp"),  # wrongly grouped with crashes
        row("positive", "praise", "", "positive", "praise", "none"),
        row("positive", "praise", "", "neutral", "", ""),  # sentiment-only label
    ]
    result = evaluate(rows)
    assert result["category"] == {"macro_f1": 1.0, "n": 4}
    assert result["sentiment"]["n"] == 5 and result["sentiment"]["macro_f1"] < 1.0
    # predicted same-issue pairs: (0,1) correct, (0,2) and (1,2) wrong -> precision 1/3; recall 1/1
    assert result["clustering"]["pair_precision"] == 0.333
    assert result["clustering"]["pair_recall"] == 1.0


def test_unlabelled_sample_scores_nothing(session, seeded_app):
    analyze_app(session, seeded_app.id, FakeModels(), LLMClient(Settings(llm_provider="none")))
    sample = sample_for_labeling(session, seeded_app.id, n=10)
    assert sample and {"sentiment_label", "category_label", "issue_group"} <= set(sample[0])
    assert {r["rating"] for r in sample} == {1, 2, 5}  # every rating bucket represented
    assert evaluate(sample) == {"sentiment": None, "category": None, "clustering": None}
