import httpx
import pytest

from pipeline.config import Settings
from pipeline.llm import LLMClient, LLMError, parse_json_object
from pipeline.summarization import (
    ClusterInput, ReviewSnippet, build_payload, keyword_summary, summarize_cluster, validate_summary,
)


def cluster():
    return ClusterInput(
        category="crash_stability",
        keywords=["crashes", "startup", "update"],
        review_count=12,
        rating_distribution={"1": 10, "2": 2, "3": 0, "4": 0, "5": 0},
        date_range=("2026-10-01", "2026-10-15"),
        top_versions=["2.4.1"],
        reviews=[ReviewSnippet(id=i, rating=1, date="2026-10-10", version="2.4.1", text=f"crashes on startup {i}") for i in (101, 102, 103)],
    )


GOOD = {
    "title": "App crashes on startup",
    "category": "crash_stability",
    "summary": "Users report the app closes during launch after updating to 2.4.1.",
    "evidence_review_ids": [101, 102],
    "possible_impact": "Users may be unable to open the app.",
    "suggested_investigation": ["Check startup crash logs", "Compare affected versions"],
    "root_cause_confirmed": False,
}


def test_valid_summary_passes_without_warnings():
    payload = build_payload(cluster())
    result = validate_summary(GOOD, payload, {101, 102, 103}, "gemini:test")
    assert result.title == "App crashes on startup"
    assert result.category == "crash_stability"
    assert result.evidence_review_ids == [101, 102]
    assert result.warnings == []


def test_category_must_be_a_taxonomy_key():
    result = validate_summary({**GOOD, "category": "Crashes!!"}, build_payload(cluster()), {101}, "groq:test")
    assert result.category is None and any("unknown category" in w for w in result.warnings)
    assert validate_summary({**GOOD, "category": "praise"}, build_payload(cluster()), {101}, "groq:test").category is None


def test_fabricated_evidence_counts_and_root_cause_are_caught():
    bad = {**GOOD, "evidence_review_ids": [999], "summary": "Over 3000 users report crashes after the update.", "root_cause_confirmed": True}
    result = validate_summary(bad, build_payload(cluster()), {101, 102, 103}, "gemini:test")
    assert result.evidence_review_ids == [101, 102, 103]
    assert any("not in the supplied reviews" in w for w in result.warnings)
    assert any("3000" in w for w in result.warnings)
    assert any("root cause" in w for w in result.warnings)


def test_parse_json_object_handles_fences():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('Sure! {"a": 2} hope that helps') == {"a": 2}
    with pytest.raises(LLMError):
        parse_json_object("no json here")


def test_keyword_fallback_has_no_numbers():
    result = keyword_summary(cluster())
    assert result.title_source == "keywords"
    assert "crashes" in result.title
    assert not any(ch.isdigit() for ch in result.summary)


def test_summarize_uses_llm_then_cache(session, monkeypatch):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append(json)
        return httpx.Response(200, json={"choices": [{"message": {"content": __import__("json").dumps(GOOD)}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    llm = LLMClient(Settings(llm_provider="groq", groq_api_key="test", llm_min_interval_seconds=0))
    first = summarize_cluster(session, llm, cluster())
    session.commit()
    second = summarize_cluster(session, llm, cluster())
    assert first.title == second.title == "App crashes on startup"
    assert not first.cached and second.cached
    assert len(calls) == 1
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert "untrusted" in calls[0]["messages"][0]["content"]


def test_llm_failure_falls_back_to_keywords(session, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(401, text="bad key"))
    llm = LLMClient(Settings(llm_provider="mistral", mistral_api_key="x", llm_min_interval_seconds=0))
    result = summarize_cluster(session, llm, cluster())
    assert result.model == "keywords"
    assert result.warnings and "unavailable" in result.warnings[0]


def test_unconfigured_provider_is_unavailable():
    assert not LLMClient(Settings(llm_provider="gemini", gemini_api_key=None)).available
    assert not LLMClient(Settings(llm_provider="none")).available
