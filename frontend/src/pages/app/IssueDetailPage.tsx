import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileSearch,
  GitMerge,
  Lightbulb,
  Pencil,
  ShieldQuestion,
  Tag,
  X,
} from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ApiError,
  errorMessage,
  getIssue,
  listIssueReviews,
  listIssues,
  mergeIssue,
  updateIssue,
} from '../../api/client'
import { CountBarList, IssueWeeklyTrendChart, RatingDistributionChart } from '../../components/charts/Charts'
import {
  CategoryChip,
  ConfidenceBadge,
  PriorityBadge,
  StatusBadge,
  StatusSelect,
  TrendIndicator,
} from '../../components/IssueBadges'
import { PriorityBreakdown } from '../../components/PriorityBreakdown'
import { ReviewCard } from '../../components/ReviewCard'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Pagination } from '../../components/ui/Pagination'
import { ErrorMessage, Notice, Skeleton, Spinner } from '../../components/ui/States'
import { useToast } from '../../context/toast'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatDateTime, formatNumber, formatPercent, formatRelative, humanize } from '../../lib/format'
import {
  EVENT_LABELS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_LABELS,
  TREND_DESCRIPTIONS,
} from '../../lib/labels'
import type { IssueDetailOut, IssueEventOut, IssueStatus, IssueUpdate, PriorityLabel } from '../../types'
import { appPath, useAppOutlet } from './appContext'

const MEMBER_PAGE_SIZE = 20

export function IssueDetailPage() {
  const { appId, dataVersion } = useAppOutlet()
  const params = useParams()
  const issueId = Number(params.issueId)
  const { push } = useToast()

  const { data, error, reload, setData } = useAsync(
    (signal) => (Number.isFinite(issueId) ? getIssue(issueId, signal) : Promise.reject(new ApiError(404, 'Invalid issue id.', ''))),
    [issueId, dataVersion],
  )

  /** PATCH and replace local state with the fresh detail. Throws so callers can show inline errors. */
  const save = async (body: IssueUpdate, successMessage: string) => {
    const updated = await updateIssue(issueId, body)
    setData(updated)
    push('success', successMessage)
  }

  if (error && (!data || data.id !== issueId)) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="space-y-4">
        <BackToIssues appId={appId} />
        <ErrorMessage
          error={error}
          title={notFound ? 'Reported issue not found' : 'Could not load this issue'}
          onRetry={notFound ? undefined : reload}
        />
      </div>
    )
  }
  if (!data || data.id !== issueId) return <DetailSkeleton />

  const issue = data
  const merged = issue.status === 'merged'

  return (
    <div className="space-y-6">
      <BackToIssues appId={appId} />

      {/* ---------- Header ---------- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge
            priority={issue.effective_priority}
            score={issue.priority_score}
            overridden={issue.priority_override !== null}
            size="md"
          />
          {issue.category_label && <CategoryChip label={issue.category_label} />}
          <TrendIndicator trend={issue.trend} />
          <ConfidenceBadge label={issue.confidence_label} value={issue.confidence} />
          {!issue.is_active && (
            <Badge title="Not matched by the latest analysis run">Inactive</Badge>
          )}
        </div>

        <EditableTitle issue={issue} disabled={merged} onSave={(title) => save({ title }, 'Title updated')} />

        <div className="flex flex-wrap items-center gap-3">
          {merged ? (
            <StatusBadge status="merged" />
          ) : (
            <StatusField
              value={issue.status}
              onChange={(status) => save({ status }, `Status set to ${STATUS_LABELS[status].toLowerCase()}`)}
            />
          )}
          <span className="text-xs text-slate-500">Issue #{issue.id}</span>
        </div>

        {merged && (
          <Notice tone="neutral" icon={<GitMerge className="size-4 text-slate-500" aria-hidden />} title="This issue was merged">
            {issue.merged_into_id ? (
              <>
                Its reports now belong to{' '}
                <Link
                  to={appPath(appId, `issues/${issue.merged_into_id}`)}
                  className="font-medium text-indigo-700 hover:underline"
                >
                  issue #{issue.merged_into_id}
                </Link>
                .
              </>
            ) : (
              'Its reports were moved into another issue.'
            )}
          </Notice>
        )}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4">
          <Stat label="User reports" value={formatNumber(issue.review_count)} />
          <Stat label="Thumbs up on reports" value={formatNumber(issue.thumbs_up_total)} />
          <Stat
            label="First seen"
            value={formatDate(issue.first_seen_at)}
            title={formatDateTime(issue.first_seen_at)}
          />
          <Stat
            label="Last seen"
            value={issue.last_seen_at ? formatRelative(issue.last_seen_at) : '—'}
            title={formatDateTime(issue.last_seen_at)}
          />
        </dl>
      </header>

      {/* ---------- Summary + priority ---------- */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="What users are reporting"
            description={
              issue.summary_model === 'keywords'
                ? 'Keyword summary of the grouped reviews. Configure a free LLM provider for a written summary.'
                : issue.summary_model
                  ? `AI summary generated by ${issue.summary_model} from the grouped reviews.`
                  : 'Summary of the grouped reviews.'
            }
          />
          <CardBody className="space-y-5">
            {!issue.root_cause_confirmed && (
              <Notice
                tone="warning"
                icon={<ShieldQuestion className="size-4 text-amber-600" aria-hidden />}
                title="Root cause not confirmed — based on user reports"
              >
                This is a potential bug inferred from what users wrote. Verify it with logs, crash reports or a
                reproduction before treating it as a confirmed defect.
              </Notice>
            )}

            {issue.summary ? (
              <p className="text-sm leading-relaxed text-slate-800">{issue.summary}</p>
            ) : (
              <p className="text-sm text-slate-500 italic">
                No AI summary for this issue yet. Summaries are generated for the larger groups during analysis — the
                evidence reviews below show what users report.
              </p>
            )}

            {issue.summary_warnings.length > 0 && (
              <Notice tone="warning" icon={<AlertTriangle className="size-4 text-amber-600" aria-hidden />} title="Summary warnings">
                <ul className="list-disc space-y-0.5 pl-4">
                  {issue.summary_warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Notice>
            )}

            {issue.possible_impact && (
              <section>
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Possible impact</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-800">{issue.possible_impact}</p>
              </section>
            )}

            {issue.suggested_investigation.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <Lightbulb className="size-3.5" aria-hidden />
                  Suggested investigation
                </h3>
                <ol className="mt-2 space-y-1.5">
                  {issue.suggested_investigation.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-slate-800">
                      <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {i + 1}
                      </span>
                      <span className="pt-px">{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {issue.keywords.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <Tag className="size-3.5" aria-hidden />
                  Keywords
                </h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {issue.keywords.map((k) => (
                    <li key={k}>
                      <Badge className="bg-white font-mono text-slate-700 ring-slate-300">{k}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="text-xs text-slate-500">
              Trend: {TREND_DESCRIPTIONS[issue.trend]?.toLowerCase() ?? humanize(issue.trend)}. Severity{' '}
              {formatPercent(issue.severity, 0)}, grouping confidence {formatPercent(issue.confidence, 0)}.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Priority" description="Why this issue ranks where it does." />
          <CardBody className="space-y-5">
            <PriorityOverride issue={issue} disabled={merged} onSave={save} />
            <div className="border-t border-slate-100 pt-4">
              <PriorityBreakdown breakdown={issue.priority_breakdown} score={issue.priority_score} />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ---------- Charts ---------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Reports per week" />
          <CardBody>
            <IssueWeeklyTrendChart data={issue.weekly_trend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Star ratings of these reports" />
          <CardBody>
            <RatingDistributionChart distribution={issue.rating_distribution} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Affected app versions" description="Version reported with each review." />
          <CardBody>
            <CountBarList
              items={issue.versions}
              formatKey={(k) => (k === 'unknown' ? 'Unknown' : `v${k}`)}
              emptyMessage="No version information in these reviews."
            />
          </CardBody>
        </Card>
      </div>

      {/* ---------- Evidence + history ---------- */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EvidenceReviews issue={issue} appId={appId} />
          <MemberReviews key={issue.id} issueId={issue.id} appId={appId} total={issue.review_count} version={dataVersion} />
        </div>
        <div className="space-y-6">
          <HistoryTimeline events={issue.events} />
          {!merged && <MergePanel issue={issue} appId={appId} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function BackToIssues({ appId }: { appId: string }) {
  return (
    <Link to={appPath(appId, 'issues')} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" aria-hidden />
      All reported issues
    </Link>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="bg-white px-4 py-3" title={title}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular mt-0.5 text-base font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

function StatusField({ value, onChange }: { value: IssueStatus; onChange: (s: IssueStatus) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const { push } = useToast()
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-500" aria-hidden>
        Status
      </span>
      <StatusSelect
        value={value}
        disabled={saving}
        label="Issue status"
        onChange={async (s) => {
          setSaving(true)
          try {
            await onChange(s)
          } catch (err) {
            push('error', `Could not update status: ${errorMessage(err)}`)
          } finally {
            setSaving(false)
          }
        }}
      />
    </div>
  )
}

function EditableTitle({
  issue,
  disabled,
  onSave,
}: {
  issue: IssueDetailOut
  disabled?: boolean
  onSave: (title: string) => Promise<void>
}) {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const trimmed = value.trim()
  const valid = trimmed.length >= 3 && trimmed.length <= 500

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    if (trimmed === issue.title) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{issue.title}</h1>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              setValue(issue.title)
              setError(null)
              setEditing(true)
            }}
            className="mt-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Edit title"
            title="Edit title"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
        {issue.title_source === 'user' && <span className="mt-2 shrink-0 text-xs text-slate-400">(edited)</span>}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={inputId} className="sr-only">
        Issue title
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          className="input text-base font-semibold"
          value={value}
          maxLength={500}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          aria-invalid={!valid}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={saving} disabled={!valid} icon={<Check className="size-4" aria-hidden />}>
            Save
          </Button>
          <Button onClick={() => setEditing(false)} icon={<X className="size-4" aria-hidden />}>
            Cancel
          </Button>
        </div>
      </div>
      {!valid && <p className="text-xs text-red-600">Title must be between 3 and 500 characters.</p>}
      {error !== null && <ErrorMessage error={error} title="Could not save the title" />}
    </form>
  )
}

function PriorityOverride({
  issue,
  disabled,
  onSave,
}: {
  issue: IssueDetailOut
  disabled?: boolean
  onSave: (body: IssueUpdate, message: string) => Promise<void>
}) {
  const selectId = useId()
  const reasonId = useId()
  const [editing, setEditing] = useState(false)
  const [priority, setPriority] = useState<PriorityLabel>(issue.priority_override ?? issue.priority_label)
  const [reason, setReason] = useState(issue.override_reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const overridden = issue.priority_override !== null
  const reasonValid = reason.trim().length > 0 && reason.length <= 2000

  const run = async (body: IssueUpdate, message: string) => {
    setSaving(true)
    setError(null)
    try {
      await onSave(body, message)
      setEditing(false)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!reasonValid) return
    run(
      { priority_override: priority, override_reason: reason.trim() },
      `Priority overridden to ${PRIORITY_LABELS[priority].toLowerCase()}`,
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={issue.effective_priority} overridden={overridden} size="md" />
        <span className="text-xs text-slate-500">
          {overridden ? (
            <>
              Set by your team · computed: <span className="font-medium">{PRIORITY_LABELS[issue.priority_label]}</span>
            </>
          ) : (
            'Computed from the score'
          )}
        </span>
      </div>

      {overridden && issue.override_reason && !editing && (
        <blockquote className="rounded-md border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {issue.override_reason}
        </blockquote>
      )}

      {!editing && !disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setPriority(issue.priority_override ?? issue.priority_label)
              setReason(issue.override_reason ?? '')
              setError(null)
              setEditing(true)
            }}
          >
            {overridden ? 'Change override' : 'Override priority'}
          </Button>
          {overridden && (
            <Button
              size="sm"
              variant="ghost"
              loading={saving}
              onClick={() => run({ priority_override: null, override_reason: null }, 'Priority override cleared')}
            >
              Clear override
            </Button>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div>
            <label htmlFor={selectId} className="label">
              Priority
            </label>
            <select
              id={selectId}
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as PriorityLabel)}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                  {p === issue.priority_label ? ' (computed)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={reasonId} className="label">
              Reason <span className="text-red-600">*</span>
            </label>
            <textarea
              id={reasonId}
              className="input min-h-20"
              value={reason}
              maxLength={2000}
              required
              placeholder="e.g. Affects checkout for paying users; escalated by support."
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!reasonValid}
              aria-describedby={`${reasonId}-hint`}
            />
            <p id={`${reasonId}-hint`} className="mt-1 text-xs text-slate-500">
              Required — explain why the computed priority is overridden.
            </p>
          </div>
          {error !== null && <ErrorMessage error={error} title="Could not save the override" />}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!reasonValid}>
              Save override
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!editing && error !== null && <ErrorMessage error={error} title="Could not update priority" />}
    </div>
  )
}

function EvidenceReviews({ issue, appId }: { issue: IssueDetailOut; appId: string }) {
  const evidenceIds = new Set(issue.evidence_review_ids)
  const reviews = [...issue.representative_reviews].sort((a, b) => {
    const ea = evidenceIds.has(a.id) || a.is_evidence ? 1 : 0
    const eb = evidenceIds.has(b.id) || b.is_evidence ? 1 : 0
    return eb - ea
  })
  return (
    <Card>
      <CardHeader
        title="Evidence: representative reviews"
        description={
          evidenceIds.size > 0
            ? 'Reviews closest to the center of this issue. Highlighted ones are cited in the summary.'
            : 'Reviews closest to the center of this issue.'
        }
        actions={
          <Link
            to={`${appPath(appId, 'reviews')}?issue_id=${issue.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
          >
            <FileSearch className="size-3.5" aria-hidden />
            Search these reviews
          </Link>
        }
      />
      <CardBody>
        {reviews.length === 0 ? (
          <p className="text-sm text-slate-500">No representative reviews were selected for this issue.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <ReviewCard key={r.id} review={r} appId={appId} evidence={evidenceIds.has(r.id)} showIssue={false} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MemberReviews({ issueId, appId, total, version }: { issueId: number; appId: string; total: number; version: number }) {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAsync(
    (signal) => listIssueReviews(issueId, page, MEMBER_PAGE_SIZE, signal),
    [issueId, page, version],
  )
  const headingId = useId()

  return (
    <Card>
      <CardHeader
        id={headingId}
        title={`All reports (${formatNumber(data?.total ?? total)})`}
        description="Every review grouped into this issue."
      />
      <CardBody className="space-y-4">
        {error !== null && !data ? (
          <ErrorMessage error={error} title="Could not load the reviews" onRetry={reload} />
        ) : !data ? (
          <Spinner label="Loading reviews…" />
        ) : data.items.length === 0 ? (
          <p className="text-sm text-slate-500">No reviews are linked to this issue.</p>
        ) : (
          <>
            <div className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((r) => (
                <ReviewCard key={r.id} review={r} appId={appId} showIssue={false} />
              ))}
            </div>
            <Pagination
              page={data.page}
              pageSize={data.page_size}
              total={data.total}
              disabled={loading}
              onChange={(p) => {
                setPage(p)
                document.getElementById(headingId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          </>
        )}
      </CardBody>
    </Card>
  )
}

function formatEventValue(value: string | null): string {
  if (value === null || value === '') return '—'
  if (value in STATUS_LABELS) return STATUS_LABELS[value as IssueStatus]
  if (value in PRIORITY_LABELS) return PRIORITY_LABELS[value as PriorityLabel]
  return value
}

function HistoryTimeline({ events }: { events: IssueEventOut[] }) {
  const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <Card>
      <CardHeader title="History" description="Changes by your team and by analysis runs." />
      <CardBody>
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No history yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {sorted.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute top-1 -left-[25px] flex size-2.5 rounded-full bg-white ring-2 ring-indigo-400" aria-hidden />
                <p className="text-sm font-medium text-slate-800">{EVENT_LABELS[ev.event_type] ?? humanize(ev.event_type)}</p>
                {(ev.previous_value !== null || ev.new_value !== null) && (
                  <p className="mt-0.5 text-xs break-words text-slate-600">
                    {ev.previous_value !== null && (
                      <>
                        <span className="line-through decoration-slate-400">{formatEventValue(ev.previous_value)}</span>
                        {' → '}
                      </>
                    )}
                    <span className="font-medium">{formatEventValue(ev.new_value)}</span>
                  </p>
                )}
                {ev.note && <p className="mt-0.5 text-xs break-words text-slate-500 italic">{ev.note}</p>}
                <time className="mt-0.5 block text-xs text-slate-400" dateTime={ev.created_at} title={formatDateTime(ev.created_at)}>
                  {formatRelative(ev.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

function MergePanel({ issue, appId }: { issue: IssueDetailOut; appId: string }) {
  const selectId = useId()
  const navigate = useNavigate()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<unknown>(null)

  const { data: candidates, error, loading, reload } = useAsync(
    (signal) =>
      open
        ? listIssues(appId, { include_inactive: true, sort: 'priority' }, signal)
        : Promise.resolve(undefined),
    [appId, open],
  )
  const options = (candidates ?? []).filter((c) => c.id !== issue.id && c.status !== 'merged')
  const targetIssue = options.find((c) => String(c.id) === target)

  const merge = async () => {
    if (!targetIssue) return
    const ok = window.confirm(
      `Merge “${issue.title}” into “${targetIssue.title}”?\n\nAll ${issue.review_count} reports move to the target issue and this issue is marked as merged.`,
    )
    if (!ok) return
    setMerging(true)
    setMergeError(null)
    try {
      const result = await mergeIssue(issue.id, targetIssue.id)
      push('success', `Merged into “${result.title}”`)
      navigate(appPath(appId, `issues/${result.id}`))
    } catch (err) {
      setMergeError(err)
    } finally {
      setMerging(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Merge into another issue"
        description="Use when two reported issues describe the same problem."
      />
      <CardBody className="space-y-3">
        {!open ? (
          <Button size="sm" icon={<GitMerge className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            Choose target issue…
          </Button>
        ) : error !== null ? (
          <ErrorMessage error={error} title="Could not load issues" onRetry={reload} />
        ) : loading && !candidates ? (
          <Spinner label="Loading issues…" className="py-4" />
        ) : options.length === 0 ? (
          <p className="text-sm text-slate-500">There are no other issues to merge into.</p>
        ) : (
          <>
            <div>
              <label htmlFor={selectId} className="label">
                Target issue
              </label>
              <select id={selectId} className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select an issue…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} · {PRIORITY_LABELS[c.effective_priority]} · {c.title} ({formatNumber(c.review_count)})
                    {c.is_active ? '' : ' — inactive'}
                  </option>
                ))}
              </select>
            </div>
            {targetIssue && (
              <p className="text-xs text-slate-600">
                {formatNumber(issue.review_count)} reports from this issue will be added to “{targetIssue.title}”. This
                issue will be marked as merged.
              </p>
            )}
            {mergeError !== null && <ErrorMessage error={mergeError} title="Merge failed" />}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={!targetIssue}
                loading={merging}
                icon={<GitMerge className="size-4" aria-hidden />}
                onClick={merge}
              >
                Merge
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading issue">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  )
}
