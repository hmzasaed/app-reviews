"""Pydantic request/response schemas — the API contract used by the React dashboard."""

from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")

PriorityLabel = Literal["critical", "high", "medium", "low"]
IssueStatus = Literal["new", "investigating", "confirmed", "fixed", "dismissed", "merged"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------- Apps & jobs ----------

class AppCreate(BaseModel):
    url_or_id: str = Field(..., description="Play Store URL or package ID, e.g. com.example.app")
    lang: str | None = None
    country: str | None = None


class AppOut(ORMModel):
    id: str
    title: str | None
    developer: str | None
    icon_url: str | None
    genre: str | None
    store_url: str
    store_rating: float | None
    installs: str | None
    lang: str
    country: str
    created_at: datetime
    last_synced_at: datetime | None
    last_analyzed_at: datetime | None
    review_count: int = 0


class SyncRequest(BaseModel):
    max_reviews: int = Field(1000, ge=10, le=20000)
    since_days: int | None = Field(None, ge=1, le=3650, description="Only collect reviews newer than this")


class AnalyzeRequest(BaseModel):
    window_days: int | None = Field(None, ge=1, le=3650, description="Only analyze reviews newer than this")


class JobOut(ORMModel):
    id: int
    app_id: str
    kind: Literal["sync", "analyze"]
    status: Literal["queued", "running", "completed", "failed"]
    stage: str | None
    progress: float
    params: dict | None
    result: dict | None
    model_versions: dict | None
    review_count: int | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


# ---------- Reviews ----------

class ReviewOut(BaseModel):
    id: int
    source_review_id: str
    text: str
    rating: int
    thumbs_up: int
    review_date: datetime
    app_version: str | None
    language: str | None
    developer_reply: str | None
    sentiment: str | None
    sentiment_score: float | None
    category: str | None
    category_confidence: float | None
    issue_id: int | None = None
    issue_title: str | None = None
    source_url: str
    membership_confidence: float | None = None
    is_representative: bool = False
    is_evidence: bool = False


# ---------- Issues ----------

class IssueEventOut(ORMModel):
    id: int
    event_type: str
    previous_value: str | None
    new_value: str | None
    note: str | None
    created_at: datetime


class IssueSummaryOut(BaseModel):
    id: int
    app_id: str
    title: str
    title_source: str
    summary: str | None
    category: str | None
    category_label: str | None
    keywords: list[str]
    review_count: int
    thumbs_up_total: int
    priority_score: float
    priority_label: PriorityLabel  # computed from the score
    effective_priority: PriorityLabel  # developer override if set, else priority_label
    priority_override: PriorityLabel | None
    severity: float
    confidence: float
    confidence_label: Literal["high", "medium", "low"]
    status: IssueStatus
    is_active: bool
    trend: Literal["new", "rising", "stable", "falling", "insufficient_data"]
    first_seen_at: datetime | None
    last_seen_at: datetime | None


class CountItem(BaseModel):
    key: str
    count: int


class TrendPoint(BaseModel):
    period: str  # ISO date of the week start
    count: int


class IssueDetailOut(IssueSummaryOut):
    possible_impact: str | None
    suggested_investigation: list[str]
    evidence_review_ids: list[int]
    root_cause_confirmed: bool
    summary_model: str | None
    summary_warnings: list[str]
    priority_breakdown: dict | None
    override_reason: str | None
    merged_into_id: int | None
    rating_distribution: dict[str, int]
    versions: list[CountItem]
    weekly_trend: list[TrendPoint]
    events: list[IssueEventOut]
    representative_reviews: list[ReviewOut]


class IssueUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=500)
    status: IssueStatus | None = None
    priority_override: PriorityLabel | None = None  # send null explicitly to clear an override
    override_reason: str | None = Field(None, max_length=2000)


class IssueMerge(BaseModel):
    target_issue_id: int


# ---------- Overview ----------

class CategoryCount(BaseModel):
    category: str
    label: str
    count: int
    negative_share: float


class TimelinePoint(BaseModel):
    period: str  # ISO date of the week start
    reviews: int
    average_rating: float
    positive: int
    neutral: int
    negative: int


class VersionStat(BaseModel):
    version: str
    reviews: int
    average_rating: float
    negative_share: float


class OverviewOut(BaseModel):
    app: AppOut
    total_reviews: int
    analyzed_reviews: int
    average_rating: float | None
    negative_share: float | None
    issue_count: int
    critical_issue_count: int
    high_issue_count: int
    rating_distribution: dict[str, int]
    sentiment_distribution: dict[str, int]
    category_counts: list[CategoryCount]
    timeline: list[TimelinePoint]
    version_breakdown: list[VersionStat]
    languages: list[CountItem]
    top_issues: list[IssueSummaryOut]
    emerging_issues: list[IssueSummaryOut]
    last_job: JobOut | None


class CategoryMeta(BaseModel):
    key: str
    label: str
    severity: float


class MetaOut(BaseModel):
    categories: list[CategoryMeta]
    statuses: list[str]
    priority_labels: list[str]
    llm_provider: str
    llm_model: str | None
