"""SQLAlchemy models. All timestamps are stored as naive UTC.

Raw review records (``reviews``) are kept separate from derived AI output
(``review_predictions``, ``review_embeddings``, ``issues``) so that analysis can
be re-run without touching collected data.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

BigId = BigInteger().with_variant(Integer, "sqlite")
Json = JSON().with_variant(JSONB, "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class App(Base):
    __tablename__ = "apps"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)  # package name
    title: Mapped[str | None] = mapped_column(String(500))
    developer: Mapped[str | None] = mapped_column(String(500))
    icon_url: Mapped[str | None] = mapped_column(Text)
    genre: Mapped[str | None] = mapped_column(String(255))
    store_url: Mapped[str] = mapped_column(Text)
    store_rating: Mapped[float | None] = mapped_column(Float)
    installs: Mapped[str | None] = mapped_column(String(100))
    lang: Mapped[str] = mapped_column(String(10), default="en")
    country: Mapped[str] = mapped_column(String(10), default="us")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("app_id", "source_review_id", name="uq_reviews_app_source"),
        Index("ix_reviews_app_date", "app_id", "review_date"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(ForeignKey("apps.id", ondelete="CASCADE"))
    source_review_id: Mapped[str] = mapped_column(String(255))
    original_text: Mapped[str] = mapped_column(Text, default="")
    normalized_text: Mapped[str] = mapped_column(Text, default="")
    rating: Mapped[int] = mapped_column(Integer)
    thumbs_up: Mapped[int] = mapped_column(Integer, default=0)
    review_date: Mapped[datetime] = mapped_column(DateTime)
    app_version: Mapped[str | None] = mapped_column(String(100))
    language: Mapped[str | None] = mapped_column(String(10))
    developer_reply: Mapped[str | None] = mapped_column(Text)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime)
    is_empty: Mapped[bool] = mapped_column(Boolean, default=False)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    prediction: Mapped["ReviewPrediction | None"] = relationship(
        back_populates="review", uselist=False, cascade="all, delete-orphan"
    )


class ReviewPrediction(Base):
    __tablename__ = "review_predictions"

    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True)
    sentiment: Mapped[str | None] = mapped_column(String(20))
    sentiment_score: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(50))
    category_confidence: Mapped[float | None] = mapped_column(Float)
    sentiment_model: Mapped[str | None] = mapped_column(String(255))
    category_model: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    review: Mapped[Review] = relationship(back_populates="prediction")


class ReviewEmbedding(Base):
    __tablename__ = "review_embeddings"

    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True)
    model: Mapped[str] = mapped_column(String(255))
    vector: Mapped[bytes] = mapped_column(LargeBinary)  # float32 bytes, L2-normalised


class Issue(Base):
    __tablename__ = "issues"
    __table_args__ = (Index("ix_issues_app_active", "app_id", "is_active"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(ForeignKey("apps.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500))
    title_source: Mapped[str] = mapped_column(String(20), default="keywords")  # keywords | llm | user
    summary: Mapped[str | None] = mapped_column(Text)
    possible_impact: Mapped[str | None] = mapped_column(Text)
    suggested_investigation: Mapped[list | None] = mapped_column(Json)
    evidence_review_ids: Mapped[list | None] = mapped_column(Json)
    root_cause_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    summary_model: Mapped[str | None] = mapped_column(String(255))
    summary_warnings: Mapped[list | None] = mapped_column(Json)
    keywords: Mapped[list | None] = mapped_column(Json)
    category: Mapped[str | None] = mapped_column(String(50))
    category_source: Mapped[str] = mapped_column(String(20), default="members")  # members | llm

    review_count: Mapped[int] = mapped_column(Integer, default=0)
    thumbs_up_total: Mapped[int] = mapped_column(Integer, default=0)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    priority_label: Mapped[str] = mapped_column(String(20), default="low")
    priority_breakdown: Mapped[dict | None] = mapped_column(Json)
    priority_override: Mapped[str | None] = mapped_column(String(20))
    override_reason: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    status: Mapped[str] = mapped_column(String(20), default="new")
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("issues.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    centroid: Mapped[bytes | None] = mapped_column(LargeBinary)
    last_run_id: Mapped[int | None] = mapped_column(BigId)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class IssueReview(Base):
    __tablename__ = "issue_reviews"

    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True, index=True)
    membership_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    is_representative: Mapped[bool] = mapped_column(Boolean, default=False)


class IssueEvent(Base):
    __tablename__ = "issue_events"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(50))
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Job(Base):
    """A review sync or an analysis run. Analysis jobs double as the analysis_runs record."""

    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_app_created", "app_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(ForeignKey("apps.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # sync | analyze
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | completed | failed
    stage: Mapped[str | None] = mapped_column(String(100))
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    params: Mapped[dict | None] = mapped_column(Json)
    result: Mapped[dict | None] = mapped_column(Json)
    model_versions: Mapped[dict | None] = mapped_column(Json)
    review_count: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class LLMCache(Base):
    __tablename__ = "llm_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(255))
    response: Mapped[dict] = mapped_column(Json)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
