import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDateTime, formatNumber, formatPercent, formatRelative, humanize } from '../lib/format'
import { JOB_KIND_LABELS } from '../lib/labels'
import type { JobOut } from '../types'

function resultSummary(result: JobOut['result']): { key: string; value: string }[] {
  if (!result) return []
  return Object.entries(result)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    .slice(0, 6)
    .map(([k, v]) => ({ key: humanize(k), value: typeof v === 'number' ? formatNumber(v) : String(v) }))
}

/** Live progress (queued/running) or the outcome (completed/failed) of a sync/analyze job. */
export function JobProgress({
  job,
  onDismiss,
  pollError,
  action,
}: {
  job: JobOut
  onDismiss?: () => void
  pollError?: boolean
  /** Optional follow-up action shown when the job completed (e.g. "Run analysis"). */
  action?: ReactNode
}) {
  const labels = JOB_KIND_LABELS[job.kind] ?? { running: humanize(job.kind), done: `${humanize(job.kind)} finished`, noun: humanize(job.kind) }
  const active = job.status === 'queued' || job.status === 'running'
  const progress = Math.max(0, Math.min(1, job.progress ?? 0))

  if (active) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="flex items-center gap-2 font-medium text-indigo-900">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {job.status === 'queued' ? `${labels.noun} queued…` : `${labels.running}…`}
          </p>
          <p className="tabular text-xs text-indigo-800">
            {formatPercent(progress, 0)}
            {job.started_at && <span className="text-indigo-600"> · started {formatRelative(job.started_at)}</span>}
          </p>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-indigo-100"
          role="progressbar"
          aria-label={labels.running}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={job.stage ?? undefined}
        >
          <div
            className={`h-full rounded-full bg-indigo-600 transition-[width] duration-500 ${job.status === 'queued' ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.max(progress * 100, job.status === 'queued' ? 4 : 2)}%` }}
          />
        </div>
        <p className="mt-1.5 truncate text-xs text-indigo-800">
          {job.stage
            ? /\s/.test(job.stage)
              ? job.stage
              : humanize(job.stage)
            : job.status === 'queued'
              ? 'Waiting for a worker…'
              : 'Working…'}
          {pollError && <span className="ml-2 text-amber-700">Connection issue — retrying…</span>}
        </p>
      </div>
    )
  }

  if (job.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-900">{labels.noun} failed</p>
            <p className="mt-0.5 break-words whitespace-pre-line text-red-800">
              {job.error_message || 'The job failed without an error message. Check the backend logs.'}
            </p>
            {job.completed_at && <p className="mt-1 text-xs text-red-700">{formatDateTime(job.completed_at)}</p>}
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-700"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    )
  }

  const summary = resultSummary(job.result)
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-emerald-900">{labels.done}</p>
          {summary.length > 0 ? (
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-800">
              {summary.map((s) => (
                <div key={s.key} className="flex gap-1">
                  <dt>{s.key}:</dt>
                  <dd className="tabular font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            job.review_count !== null && (
              <p className="mt-0.5 text-xs text-emerald-800">{formatNumber(job.review_count)} reviews processed.</p>
            )
          )}
          {action && <div className="mt-2">{action}</div>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-800"
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
