"""FastAPI application. Run with: uvicorn backend.app.main:app --reload

Jobs run as in-process background tasks, so run a single worker process.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import apps, issues, misc
from database.session import init_db
from pipeline.config import get_settings
from pipeline.jobs import fail_interrupted_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if interrupted := fail_interrupted_jobs():
        log.warning("Marked %s interrupted job(s) as failed", interrupted)
    yield


app = FastAPI(title="Play Store Review Analysis API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (apps.router, issues.router, misc.router):
    app.include_router(router, prefix="/api/v1")
