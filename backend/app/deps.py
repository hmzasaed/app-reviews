from collections.abc import Iterator

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import App, Issue
from database.session import get_sessionmaker


def get_db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_app_or_404(session: Session, app_id: str) -> App:
    app = session.get(App, app_id)
    if app is None:
        raise HTTPException(404, f"App '{app_id}' is not registered")
    return app


def get_issue_or_404(session: Session, issue_id: int) -> Issue:
    issue = session.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(404, f"Issue {issue_id} not found")
    return issue
