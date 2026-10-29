import type {
  AnalyzeRequest,
  AppCreate,
  AppOut,
  ExportFormat,
  ExportKind,
  IssueDetailOut,
  IssueQuery,
  IssueSummaryOut,
  IssueUpdate,
  JobOut,
  MetaOut,
  OverviewOut,
  Page,
  ReviewOut,
  ReviewQuery,
  SyncRequest,
} from '../types'

/** Base URL of the FastAPI service, without a trailing slash. */
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '')

// ---------- Errors ----------

interface ValidationErrorItem {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

/** Error thrown for any non-2xx response (or network failure, with status 0). */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown
  /** Human-readable lines (one per validation error when detail is an array). */
  readonly messages: string[]

  constructor(status: number, detail: unknown, fallback: string) {
    const messages = detailToMessages(detail, fallback)
    super(messages.join('\n'))
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.messages = messages
  }
}

function detailToMessages(detail: unknown, fallback: string): string[] {
  if (typeof detail === 'string' && detail.trim()) return [detail]
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((item) => {
      if (typeof item === 'string') return item
      const v = item as ValidationErrorItem
      // Drop the leading "body"/"query"/"path" location segment for readability.
      const loc = (v.loc ?? []).filter((p, i) => !(i === 0 && ['body', 'query', 'path'].includes(String(p))))
      const field = loc.length ? `${loc.join('.')}: ` : ''
      return `${field}${v.msg ?? JSON.stringify(item)}`
    })
  }
  if (detail && typeof detail === 'object') return [JSON.stringify(detail)]
  return [fallback]
}

const STATUS_FALLBACKS: Record<number, string> = {
  400: 'The request was invalid.',
  404: 'Not found.',
  409: 'Another job is already running for this app.',
  422: 'Some of the values you entered are invalid.',
  500: 'The server hit an unexpected error.',
  502: 'The API is unreachable (bad gateway).',
  503: 'The API is temporarily unavailable.',
  504: 'The API took too long to respond.',
}

/** Turn anything thrown into a user-facing message. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// ---------- Low-level request helpers ----------

type QueryValue = string | number | boolean | null | undefined | (string | number)[]

/** Encode a single path segment (package names contain dots; keep everything safe). */
const seg = (value: string | number) => encodeURIComponent(String(value))

export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
    } else {
      search.set(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError(0, null, `Could not reach the API at ${API_BASE_URL}. Is the backend running?`)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data
    const fallback = STATUS_FALLBACKS[response.status] ?? `Request failed (HTTP ${response.status}).`
    // Plain-text/HTML error pages from proxies are not useful to show verbatim.
    const usableDetail = typeof detail === 'string' && /^\s*</.test(detail) ? null : detail
    throw new ApiError(response.status, usableDetail, fallback)
  }

  return data as T
}

// ---------- Meta ----------

export const getMeta = (signal?: AbortSignal) => request<MetaOut>('/meta', { signal })

// ---------- Apps ----------

export const listApps = (signal?: AbortSignal) => request<AppOut[]>('/apps', { signal })

export const createApp = (body: AppCreate) => request<AppOut>('/apps', { method: 'POST', body })

export const getApp = (appId: string, signal?: AbortSignal) => request<AppOut>(`/apps/${seg(appId)}`, { signal })

export const deleteApp = (appId: string) => request<void>(`/apps/${seg(appId)}`, { method: 'DELETE' })

export const getOverview = (appId: string, signal?: AbortSignal) =>
  request<OverviewOut>(`/apps/${seg(appId)}/overview`, { signal })

// ---------- Jobs ----------

export const startSync = (appId: string, body: SyncRequest) =>
  request<JobOut>(`/apps/${seg(appId)}/sync`, { method: 'POST', body })

export const startAnalysis = (appId: string, body: AnalyzeRequest) =>
  request<JobOut>(`/apps/${seg(appId)}/analyze`, { method: 'POST', body })

export const getJob = (jobId: number, signal?: AbortSignal) => request<JobOut>(`/jobs/${seg(jobId)}`, { signal })

export const listAppJobs = (appId: string, limit = 10, signal?: AbortSignal) =>
  request<JobOut[]>(`/apps/${seg(appId)}/jobs${buildQuery({ limit })}`, { signal })

// ---------- Issues ----------

export const listIssues = (appId: string, query: IssueQuery = {}, signal?: AbortSignal) =>
  request<IssueSummaryOut[]>(
    `/apps/${seg(appId)}/issues${buildQuery({
      status: query.status,
      include_inactive: query.include_inactive,
      category: query.category,
      sort: query.sort,
    })}`,
    { signal },
  )

export const getIssue = (issueId: number, signal?: AbortSignal) =>
  request<IssueDetailOut>(`/issues/${seg(issueId)}`, { signal })

export const listIssueReviews = (issueId: number, page = 1, pageSize = 20, signal?: AbortSignal) =>
  request<Page<ReviewOut>>(`/issues/${seg(issueId)}/reviews${buildQuery({ page, page_size: pageSize })}`, { signal })

/** PATCH an issue. Pass `priority_override: null` explicitly to clear an override. */
export const updateIssue = (issueId: number, body: IssueUpdate) =>
  request<IssueDetailOut>(`/issues/${seg(issueId)}`, { method: 'PATCH', body })

/** Merge `issueId` into `targetIssueId`; returns the target issue. */
export const mergeIssue = (issueId: number, targetIssueId: number) =>
  request<IssueDetailOut>(`/issues/${seg(issueId)}/merge`, {
    method: 'POST',
    body: { target_issue_id: targetIssueId },
  })

// ---------- Reviews ----------

export const listReviews = (appId: string, query: ReviewQuery = {}, signal?: AbortSignal) =>
  request<Page<ReviewOut>>(
    `/apps/${seg(appId)}/reviews${buildQuery({
      q: query.q?.trim(),
      rating: query.rating,
      sentiment: query.sentiment,
      category: query.category,
      issue_id: query.issue_id,
      version: query.version,
      language: query.language,
      date_from: query.date_from,
      date_to: query.date_to,
      sort: query.sort,
      page: query.page,
      page_size: query.page_size,
    })}`,
    { signal },
  )

// ---------- Export ----------

/** URL for a file download; use it as an `<a href download>` target. */
export const exportUrl = (appId: string, kind: ExportKind, format: ExportFormat) =>
  `${API_BASE_URL}/apps/${seg(appId)}/export${buildQuery({ kind, format })}`
