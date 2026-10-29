/**
 * TypeScript mirror of the backend Pydantic schemas (backend/app/schemas.py).
 *
 * Datetimes are ISO-8601 strings in UTC *without* a timezone suffix
 * (e.g. "2026-10-20T11:20:00"); always parse them with `parseUtc()` from
 * `lib/format.ts`. "period" fields are ISO dates (week start, "YYYY-MM-DD").
 */

/** ISO datetime string, UTC, no timezone suffix. */
export type IsoDateTime = string
/** ISO date string, "YYYY-MM-DD". */
export type IsoDate = string

export type PriorityLabel = 'critical' | 'high' | 'medium' | 'low'
export type IssueStatus = 'new' | 'investigating' | 'confirmed' | 'fixed' | 'dismissed' | 'merged'
export type ConfidenceLabel = 'high' | 'medium' | 'low'
export type IssueTrend = 'new' | 'rising' | 'stable' | 'falling' | 'insufficient_data'
export type JobKind = 'sync' | 'analyze'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

/** Arbitrary JSON object (Pydantic `dict`). */
export type JsonObject = Record<string, unknown>

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

// ---------- Apps & jobs ----------

export interface AppCreate {
  url_or_id: string
  lang?: string | null
  country?: string | null
}

export interface AppOut {
  id: string
  title: string | null
  developer: string | null
  icon_url: string | null
  genre: string | null
  store_url: string
  store_rating: number | null
  installs: string | null
  lang: string
  country: string
  created_at: IsoDateTime
  last_synced_at: IsoDateTime | null
  last_analyzed_at: IsoDateTime | null
  review_count: number
}

export interface SyncRequest {
  /** 10..20000, backend default 1000 */
  max_reviews?: number
  /** 1..3650 — only collect reviews newer than this many days */
  since_days?: number | null
}

export interface AnalyzeRequest {
  /** 1..3650 — only analyze reviews newer than this many days */
  window_days?: number | null
}

export interface JobOut {
  id: number
  app_id: string
  kind: JobKind
  status: JobStatus
  stage: string | null
  /** 0..1 */
  progress: number
  params: JsonObject | null
  result: JsonObject | null
  model_versions: JsonObject | null
  review_count: number | null
  error_message: string | null
  created_at: IsoDateTime
  started_at: IsoDateTime | null
  completed_at: IsoDateTime | null
}

// ---------- Reviews ----------

export interface ReviewOut {
  id: number
  source_review_id: string
  text: string
  rating: number
  thumbs_up: number
  review_date: IsoDateTime
  app_version: string | null
  language: string | null
  developer_reply: string | null
  sentiment: string | null
  sentiment_score: number | null
  category: string | null
  category_confidence: number | null
  issue_id: number | null
  issue_title: string | null
  source_url: string
  membership_confidence: number | null
  is_representative: boolean
  is_evidence: boolean
}

// ---------- Issues ----------

export interface IssueEventOut {
  id: number
  event_type: string
  previous_value: string | null
  new_value: string | null
  note: string | null
  created_at: IsoDateTime
}

export interface IssueSummaryOut {
  id: number
  app_id: string
  title: string
  title_source: string
  summary: string | null
  category: string | null
  category_label: string | null
  keywords: string[]
  review_count: number
  thumbs_up_total: number
  priority_score: number
  /** computed from the score */
  priority_label: PriorityLabel
  /** developer override if set, else priority_label */
  effective_priority: PriorityLabel
  priority_override: PriorityLabel | null
  severity: number
  confidence: number
  confidence_label: ConfidenceLabel
  status: IssueStatus
  is_active: boolean
  trend: IssueTrend
  first_seen_at: IsoDateTime | null
  last_seen_at: IsoDateTime | null
}

export interface CountItem {
  key: string
  count: number
}

export interface TrendPoint {
  /** ISO date of the week start */
  period: IsoDate
  count: number
}

/**
 * Shape of `IssueDetailOut.priority_breakdown` (a free-form dict on the backend).
 * Every field is optional so the UI degrades gracefully if the backend changes it.
 */
export interface PriorityBreakdown {
  score?: number
  weights?: Partial<Record<string, number>>
  components?: Partial<Record<string, number>>
  counts?: {
    reviews?: number
    recent?: number
    previous?: number
    window_days?: number
    low_rating_share?: number
    severe_share?: number
    thumbs_up?: number
    share_change?: number
    [key: string]: unknown
  }
  reference_date?: string
  trend?: string
  notes?: string[]
  [key: string]: unknown
}

export interface IssueDetailOut extends IssueSummaryOut {
  possible_impact: string | null
  suggested_investigation: string[]
  evidence_review_ids: number[]
  root_cause_confirmed: boolean
  summary_model: string | null
  summary_warnings: string[]
  priority_breakdown: PriorityBreakdown | null
  override_reason: string | null
  merged_into_id: number | null
  /** keys "1".."5" */
  rating_distribution: Record<string, number>
  versions: CountItem[]
  weekly_trend: TrendPoint[]
  events: IssueEventOut[]
  representative_reviews: ReviewOut[]
}

export interface IssueUpdate {
  /** 3..500 chars */
  title?: string | null
  status?: IssueStatus | null
  /** send `null` explicitly to clear an override */
  priority_override?: PriorityLabel | null
  /** max 2000 chars */
  override_reason?: string | null
}

export interface IssueMerge {
  target_issue_id: number
}

// ---------- Overview ----------

export interface CategoryCount {
  category: string
  label: string
  count: number
  negative_share: number
}

export interface TimelinePoint {
  /** ISO date of the week start */
  period: IsoDate
  reviews: number
  average_rating: number
  positive: number
  neutral: number
  negative: number
}

export interface VersionStat {
  version: string
  reviews: number
  average_rating: number
  negative_share: number
}

export interface OverviewOut {
  app: AppOut
  total_reviews: number
  analyzed_reviews: number
  average_rating: number | null
  negative_share: number | null
  issue_count: number
  critical_issue_count: number
  high_issue_count: number
  rating_distribution: Record<string, number>
  sentiment_distribution: Record<string, number>
  category_counts: CategoryCount[]
  timeline: TimelinePoint[]
  version_breakdown: VersionStat[]
  languages: CountItem[]
  top_issues: IssueSummaryOut[]
  emerging_issues: IssueSummaryOut[]
  last_job: JobOut | null
}

export interface CategoryMeta {
  key: string
  label: string
  severity: number
}

export interface MetaOut {
  categories: CategoryMeta[]
  statuses: string[]
  priority_labels: string[]
  llm_provider: string
  llm_model: string | null
}

// ---------- Query parameter shapes (frontend-only) ----------

export type IssueSort = 'priority' | 'count' | 'recent'

export interface IssueQuery {
  status?: IssueStatus[]
  include_inactive?: boolean
  category?: string
  sort?: IssueSort
}

export type ReviewSort = 'newest' | 'oldest' | 'thumbs' | 'rating'

export interface ReviewQuery {
  q?: string
  rating?: number
  sentiment?: string
  category?: string
  issue_id?: number
  version?: string
  language?: string
  date_from?: IsoDate
  date_to?: IsoDate
  sort?: ReviewSort
  page?: number
  page_size?: number
}

export type ExportKind = 'issues' | 'reviews'
export type ExportFormat = 'csv' | 'json'
