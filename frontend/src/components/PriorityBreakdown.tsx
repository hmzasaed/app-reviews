import { Info } from 'lucide-react'
import { formatCalendarDate, formatNumber, formatPercent, formatScore, humanize } from '../lib/format'
import type { PriorityBreakdown as Breakdown } from '../types'

const COMPONENT_ORDER = ['frequency', 'severity', 'recency', 'growth']

const COMPONENT_HELP: Record<string, string> = {
  frequency: 'How many users report it — relative to the largest issue of this app and in absolute terms.',
  severity: 'How damaging the reported problem type is (category severity and share of 1–2★ ratings).',
  recency: 'How recent the reports are; newer reports weigh more.',
  growth: 'Whether this issue’s share of reviews grew in the recent window compared with the one before.',
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Explains the priority score as weighted bars:
 * points = component value (0..1) × weight × 100. The track length is the max points (weight × 100).
 */
export function PriorityBreakdown({ breakdown, score }: { breakdown: Breakdown | null; score: number }) {
  if (!breakdown || !breakdown.weights || !breakdown.components) {
    return (
      <p className="text-sm text-slate-500">
        No score breakdown is available for this issue. It will appear after the next analysis run.
      </p>
    )
  }

  const weights = breakdown.weights
  const components = breakdown.components
  const keys = [
    ...COMPONENT_ORDER.filter((k) => k in weights || k in components),
    ...Object.keys(weights).filter((k) => !COMPONENT_ORDER.includes(k)),
  ]

  const rows = keys.map((key) => {
    const weight = isNum(weights[key]) ? weights[key] : 0
    const value = isNum(components[key]) ? Math.max(0, Math.min(1, components[key])) : 0
    return { key, weight, value, points: value * weight * 100, max: weight * 100 }
  })
  const total = rows.reduce((sum, r) => sum + r.points, 0)
  const counts = breakdown.counts ?? {}
  const notes = Array.isArray(breakdown.notes) ? breakdown.notes : []
  const shownScore = isNum(breakdown.score) ? breakdown.score : score

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-slate-600">
          Score <span className="text-2xl font-semibold text-slate-900">{formatScore(shownScore)}</span>
          <span className="text-slate-400"> / 100</span>
        </p>
        <p className="text-xs text-slate-500">points = signal × weight × 100</p>
      </div>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-slate-800" title={COMPONENT_HELP[row.key]}>
                {humanize(row.key)}
                <span className="ml-1.5 text-xs font-normal text-slate-500">weight {formatPercent(row.weight, 0)}</span>
              </span>
              <span className="tabular text-slate-700">
                <span className="font-semibold text-slate-900">{row.points.toFixed(1)}</span>
                <span className="text-slate-400"> / {row.max.toFixed(0)} pts</span>
              </span>
            </div>
            <div
              className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`${humanize(row.key)}: signal ${formatPercent(row.value, 0)}, ${row.points.toFixed(1)} of ${row.max.toFixed(0)} points`}
            >
              {/* The track width represents this component's weight within 100 points. */}
              <div className="relative h-full rounded-full bg-indigo-100" style={{ width: `${row.max}%` }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-indigo-600"
                  style={{ width: `${row.value * 100}%` }}
                />
              </div>
            </div>
            {COMPONENT_HELP[row.key] && <p className="mt-1 text-xs text-slate-500">{COMPONENT_HELP[row.key]}</p>}
          </li>
        ))}
      </ul>

      <p className="tabular border-t border-slate-100 pt-3 text-xs text-slate-500">
        {rows.map((r, i) => (
          <span key={r.key}>
            {i > 0 && ' + '}
            {r.points.toFixed(1)}
          </span>
        ))}{' '}
        = <span className="font-semibold text-slate-700">{total.toFixed(1)}</span> points
        {Math.abs(total - shownScore) > 0.6 && ` (stored score: ${formatScore(shownScore)})`}
      </p>

      {(isNum(counts.reviews) || isNum(counts.recent) || isNum(counts.low_rating_share)) && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
          {isNum(counts.reviews) && (
            <div>
              <dt className="text-slate-500">Reports</dt>
              <dd className="tabular text-sm font-semibold text-slate-900">{formatNumber(counts.reviews)}</dd>
            </div>
          )}
          {isNum(counts.recent) && (
            <div>
              <dt className="text-slate-500">Last {isNum(counts.window_days) ? `${counts.window_days} days` : 'window'}</dt>
              <dd className="tabular text-sm font-semibold text-slate-900">{formatNumber(counts.recent)}</dd>
            </div>
          )}
          {isNum(counts.previous) && (
            <div>
              <dt className="text-slate-500">
                Previous {isNum(counts.window_days) ? `${counts.window_days} days` : 'window'}
              </dt>
              <dd className="tabular text-sm font-semibold text-slate-900">{formatNumber(counts.previous)}</dd>
            </div>
          )}
          {isNum(counts.low_rating_share) && (
            <div>
              <dt className="text-slate-500">1–2★ share</dt>
              <dd className="tabular text-sm font-semibold text-slate-900">{formatPercent(counts.low_rating_share)}</dd>
            </div>
          )}
          {isNum(counts.severe_share) && counts.severe_share > 0 && (
            <div>
              <dt className="text-slate-500">Mention lost money/data</dt>
              <dd className="tabular text-sm font-semibold text-slate-900">{formatPercent(counts.severe_share)}</dd>
            </div>
          )}
        </dl>
      )}
      {typeof breakdown.reference_date === 'string' && (
        <p className="text-xs text-slate-400">Windows measured up to {formatCalendarDate(breakdown.reference_date)}.</p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1.5">
          {notes.map((note, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
              <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
