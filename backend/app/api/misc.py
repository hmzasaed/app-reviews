from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.deps import get_db
from backend.app.schemas import CategoryMeta, JobOut, MetaOut
from database.models import Job
from pipeline.llm import LLMClient
from pipeline.prioritization import LABEL_THRESHOLDS
from pipeline.taxonomy import CATEGORIES, OTHER

router = APIRouter(tags=["meta"])


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, session: Session = Depends(get_db)):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, f"Job {job_id} not found")
    return job


@router.get("/meta", response_model=MetaOut)
def meta():
    llm = LLMClient()
    return MetaOut(
        categories=[CategoryMeta(key=c.key, label=c.label, severity=c.severity) for c in [*CATEGORIES, OTHER]],
        statuses=["new", "investigating", "confirmed", "fixed", "dismissed", "merged"],
        priority_labels=[label for _, label in LABEL_THRESHOLDS],
        llm_provider=llm.provider_name if llm.available else "none",
        llm_model=llm.model if llm.available else None,
    )


@router.get("/health")
def health():
    return {"status": "ok"}
