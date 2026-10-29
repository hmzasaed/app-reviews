"""Job lifecycle shared by the CLI and the API (which runs jobs in the background)."""

import logging
import traceback
from collections.abc import Callable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from database.models import Job, utcnow
from database.session import session_scope
from pipeline.analysis import analyze_app
from pipeline.ingestion import sync_reviews
from pipeline.llm import LLMClient
from pipeline.nlp import NLPModels, get_models

log = logging.getLogger(__name__)

ACTIVE_STATES = ("queued", "running")


class JobConflict(Exception):
    pass


def active_job(session: Session, app_id: str) -> Job | None:
    return session.scalars(
        select(Job).where(Job.app_id == app_id, Job.status.in_(ACTIVE_STATES)).order_by(Job.created_at.desc())
    ).first()


def create_job(session: Session, app_id: str, kind: str, params: dict) -> Job:
    running = active_job(session, app_id)
    if running is not None:
        raise JobConflict(f"A {running.kind} job (#{running.id}) is already {running.status} for this app")
    job = Job(app_id=app_id, kind=kind, params=params, status="queued", progress=0.0)
    session.add(job)
    session.flush()
    return job


def fail_interrupted_jobs() -> int:
    """Jobs left queued/running by a previous process can never finish; mark them failed."""
    with session_scope() as session:
        result = session.execute(
            update(Job).where(Job.status.in_(ACTIVE_STATES))
            .values(status="failed", error_message="Interrupted by a server restart", completed_at=utcnow())
        )
        return result.rowcount or 0


def _set_progress(job_id: int, stage: str, progress: float) -> None:
    with session_scope() as session:
        session.execute(update(Job).where(Job.id == job_id).values(stage=stage[:100], progress=round(min(progress, 1.0), 3)))


def run_job(
    job_id: int,
    models_factory: Callable[[], NLPModels] = get_models,
    llm_factory: Callable[[], LLMClient] = LLMClient,
) -> Job:
    with session_scope() as session:
        job = session.get(Job, job_id)
        job.status, job.started_at, job.stage = "running", utcnow(), "Starting"
        kind, app_id, params = job.kind, job.app_id, dict(job.params or {})

    def progress(stage: str, pct: float) -> None:
        _set_progress(job_id, stage, pct)

    try:
        with session_scope() as session:
            if kind == "sync":
                result, versions = sync_reviews(session, app_id, progress=progress, **params), None
            elif kind == "analyze":
                progress("Loading NLP models", 0.01)
                models = models_factory()
                llm = llm_factory()
                result = analyze_app(session, app_id, models, llm, window_days=params.get("window_days"),
                                     run_id=job_id, progress=progress)
                versions = {**models.versions(), "llm": llm.describe()}
            else:
                raise ValueError(f"Unknown job kind '{kind}'")
    except Exception as exc:
        log.error("Job %s failed: %s", job_id, traceback.format_exc())
        with session_scope() as session:
            job = session.get(Job, job_id)
            job.status, job.error_message, job.completed_at = "failed", str(exc)[:2000], utcnow()
        raise

    with session_scope() as session:
        job = session.get(Job, job_id)
        job.status, job.stage, job.progress, job.completed_at = "completed", "Done", 1.0, utcnow()
        job.result, job.model_versions = result, versions
        job.review_count = result.get("reviews_analyzed", result.get("total_reviews"))
        session.flush()
        session.expunge(job)
    return job
