"""End-to-end: analysis run with fake models, persistent tracking, and the HTTP API."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from database.models import Issue, IssueReview, Job, Review
from pipeline import jobs
from pipeline.analysis import analyze_app
from pipeline.config import Settings
from pipeline.llm import LLMClient
from tests.conftest import CRASH_TEXTS, FakeModels

NO_LLM = LLMClient(Settings(llm_provider="none"))


def _crash_issue(session):
    issues = session.scalars(select(Issue).where(Issue.is_active.is_(True))).all()
    return next(i for i in issues if i.category == "crash_stability")


def test_analysis_finds_ranked_issues_with_evidence(session, seeded_app):
    result = analyze_app(session, seeded_app.id, FakeModels(), NO_LLM, run_id=1)
    assert result["clusters"] >= 2
    assert result["new_issues"] == result["clusters"]

    issues = session.scalars(select(Issue).order_by(Issue.priority_score.desc())).all()
    crash = _crash_issue(session)
    assert crash.review_count == len(CRASH_TEXTS)
    assert crash.priority_breakdown["components"]["severity"] > 0
    assert crash.summary and crash.evidence_review_ids
    member_ids = set(session.scalars(select(IssueReview.review_id).where(IssueReview.issue_id == crash.id)))
    assert set(crash.evidence_review_ids) <= member_ids  # evidence is traceable to member reviews
    assert all(not i.root_cause_confirmed for i in issues)
    # praise reviews are never clustered as issues
    praise_ids = set(session.scalars(select(Review.id).where(Review.rating == 5)))
    assert not praise_ids & set(session.scalars(select(IssueReview.review_id)))


def test_rerun_keeps_issue_identity_and_developer_edits(session, seeded_app):
    analyze_app(session, seeded_app.id, FakeModels(), NO_LLM, run_id=1)
    crash = _crash_issue(session)
    crash.status, crash.title, crash.title_source = "investigating", "Camera crash", "user"
    session.commit()

    result = analyze_app(session, seeded_app.id, FakeModels(), NO_LLM, run_id=2)
    assert result["new_issues"] == 0 and result["predictions_computed"] == 0  # cached predictions reused
    again = _crash_issue(session)
    assert again.id == crash.id
    assert again.status == "investigating" and again.title == "Camera crash"


def test_llm_category_overrides_member_vote_and_rescoring(session, seeded_app, monkeypatch):
    import json

    import httpx

    reply = {"title": "Accounts suspended without reason", "category": "account_data", "summary": "Users report suspensions.",
             "evidence_review_ids": [], "possible_impact": "Users lose access.", "suggested_investigation": ["Review bans"]}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]}))
    llm = LLMClient(Settings(llm_provider="groq", groq_api_key="x", llm_min_interval_seconds=0))
    result = analyze_app(session, seeded_app.id, FakeModels(), llm, run_id=1)
    assert result["summaries_generated"] == result["clusters"]
    issues = session.scalars(select(Issue)).all()
    assert all(i.category == "account_data" and i.category_source == "llm" for i in issues)
    assert all(i.priority_breakdown["components"]["severity"] >= 0.6 * 0.95 for i in issues)
    assert all(i.title == "Accounts suspended without reason" and i.evidence_review_ids for i in issues)


@pytest.fixture()
def client(engine, monkeypatch):
    from backend.app.deps import get_db
    from backend.app.main import app
    from database.session import get_sessionmaker

    def test_db():
        session = get_sessionmaker()()  # the patched, per-test sessionmaker
        try:
            yield session
            session.commit()
        finally:
            session.close()

    app.dependency_overrides[get_db] = test_db
    monkeypatch.setattr(jobs, "get_models", lambda: FakeModels())
    original = jobs.run_job
    monkeypatch.setattr(
        "backend.app.api.apps.run_job",
        lambda job_id: original(job_id, models_factory=FakeModels, llm_factory=lambda: NO_LLM),
    )
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_api_end_to_end(client, session, seeded_app):
    assert client.get("/api/v1/apps").json()[0]["review_count"] > 0

    job = client.post(f"/api/v1/apps/{seeded_app.id}/analyze", json={}).json()
    assert job["status"] == "queued"
    job = client.get(f"/api/v1/jobs/{job['id']}").json()  # TestClient runs background tasks before returning
    assert job["status"] == "completed", job["error_message"]
    assert job["model_versions"]["llm"] == "none"

    overview = client.get(f"/api/v1/apps/{seeded_app.id}/overview").json()
    assert overview["total_reviews"] == overview["analyzed_reviews"] > 0
    assert overview["issue_count"] >= 2 and overview["top_issues"]
    assert sum(overview["rating_distribution"].values()) == overview["total_reviews"]

    issues = client.get(f"/api/v1/apps/{seeded_app.id}/issues").json()
    assert issues == sorted(issues, key=lambda i: i["priority_score"], reverse=True)
    top = issues[0]

    detail = client.get(f"/api/v1/issues/{top['id']}").json()
    assert detail["representative_reviews"] and detail["root_cause_confirmed"] is False
    assert set(detail["priority_breakdown"]["components"]) == {"frequency", "severity", "recency", "growth"}
    assert sum(detail["rating_distribution"].values()) == detail["review_count"]

    members = client.get(f"/api/v1/issues/{top['id']}/reviews?page_size=100").json()
    assert members["total"] == top["review_count"]

    # status, override (reason required), rename
    assert client.patch(f"/api/v1/issues/{top['id']}", json={"priority_override": "low"}).status_code == 422
    updated = client.patch(f"/api/v1/issues/{top['id']}", json={
        "status": "confirmed", "priority_override": "low", "override_reason": "Known, fix shipping", "title": "Renamed issue",
    }).json()
    assert updated["status"] == "confirmed" and updated["effective_priority"] == "low" and updated["title_source"] == "user"
    assert {e["event_type"] for e in updated["events"]} >= {"created", "status_changed", "priority_overridden", "renamed"}
    cleared = client.patch(f"/api/v1/issues/{top['id']}", json={"priority_override": None}).json()
    assert cleared["priority_override"] is None and cleared["effective_priority"] == cleared["priority_label"]

    # merge the second issue into the top one
    second = issues[1]
    merged = client.post(f"/api/v1/issues/{second['id']}/merge", json={"target_issue_id": top["id"]}).json()
    assert merged["review_count"] == top["review_count"] + second["review_count"]
    assert client.get(f"/api/v1/issues/{second['id']}").json()["status"] == "merged"
    assert second["id"] not in [i["id"] for i in client.get(f"/api/v1/apps/{seeded_app.id}/issues").json()]

    reviews = client.get(f"/api/v1/apps/{seeded_app.id}/reviews", params={"q": "crash", "rating": 1}).json()
    assert reviews["total"] == len(CRASH_TEXTS)
    assert all(r["issue_id"] == top["id"] for r in reviews["items"])
    assert reviews["items"][0]["source_url"].startswith("https://play.google.com/store/apps/details?id=")

    csv = client.get(f"/api/v1/apps/{seeded_app.id}/export", params={"kind": "issues", "format": "csv"})
    assert csv.status_code == 200 and csv.text.startswith("issue_id,title")
    assert "attachment" in csv.headers["content-disposition"]


def test_api_validation_and_conflicts(client, session, seeded_app):
    assert client.post("/api/v1/apps", json={"url_or_id": "not a package"}).status_code == 422
    assert client.get("/api/v1/apps/com.missing.app/overview").status_code == 404
    session.add(Job(app_id=seeded_app.id, kind="sync", status="running"))
    session.commit()
    assert client.post(f"/api/v1/apps/{seeded_app.id}/analyze", json={}).status_code == 409
    assert client.get("/api/v1/meta").json()["llm_provider"] == "none"


def test_interrupted_jobs_are_failed_on_startup(engine, session, seeded_app):
    session.add(Job(app_id=seeded_app.id, kind="analyze", status="running"))
    session.commit()
    assert jobs.fail_interrupted_jobs() == 1
    session.expire_all()
    assert session.scalars(select(Job)).one().status == "failed"
