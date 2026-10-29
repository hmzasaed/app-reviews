import {
  ArrowDownRight,
  ArrowUpRight,
  CircleHelp,
  Minus,
  Sparkles,
  Pin,
  type LucideIcon,
} from 'lucide-react'
import { useId } from 'react'
import { formatScore, humanize } from '../lib/format'
import {
  CONFIDENCE_DESCRIPTION,
  CONFIDENCE_LABELS,
  EDITABLE_STATUSES,
  PRIORITY_BADGE,
  PRIORITY_DOT,
  PRIORITY_LABELS,
  SENTIMENT_CHIP,
  SENTIMENT_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  TREND_DESCRIPTIONS,
  TREND_LABELS,
} from '../lib/labels'
import type { ConfidenceLabel, IssueStatus, IssueTrend, PriorityLabel } from '../types'
import { Badge } from './ui/Badge'

export function PriorityBadge({
  priority,
  score,
  overridden = false,
  size = 'sm',
}: {
  priority: PriorityLabel
  score?: number
  overridden?: boolean
  size?: 'sm' | 'md'
}) {
  const sizeCls = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold whitespace-nowrap ring-1 ring-inset ${sizeCls} ${PRIORITY_BADGE[priority]}`}
      title={overridden ? 'Priority set manually by your team' : 'Priority computed from the score'}
    >
      <span className={`size-2 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden />
      {PRIORITY_LABELS[priority]}
      {score !== undefined && <span className="tabular font-normal opacity-80">{formatScore(score)}</span>}
      {overridden && (
        <>
          <Pin className="size-3" aria-hidden />
          <span className="sr-only">(manual override)</span>
        </>
      )}
    </span>
  )
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  return <Badge className={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
}

/** Inline status select. "merged" is shown read-only (merging happens through the merge action). */
export function StatusSelect({
  value,
  onChange,
  disabled,
  label = 'Status',
  hideLabel = true,
  className = '',
}: {
  value: IssueStatus
  onChange: (status: IssueStatus) => void
  disabled?: boolean
  label?: string
  hideLabel?: boolean
  className?: string
}) {
  const id = useId()
  if (value === 'merged') return <StatusBadge status="merged" />
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'label'}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as IssueStatus)}
        onClick={(e) => e.stopPropagation()}
        className={`rounded-md border-0 py-1 pr-7 pl-2 text-xs font-medium ring-1 ring-inset focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 ${STATUS_BADGE[value]}`}
      >
        {EDITABLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  )
}

const TREND_ICON: Record<IssueTrend, LucideIcon> = {
  new: Sparkles,
  rising: ArrowUpRight,
  stable: Minus,
  falling: ArrowDownRight,
  insufficient_data: CircleHelp,
}

const TREND_CLS: Record<IssueTrend, string> = {
  new: 'text-indigo-700',
  rising: 'text-red-700',
  stable: 'text-slate-600',
  falling: 'text-emerald-700',
  insufficient_data: 'text-slate-400',
}

export function TrendIndicator({ trend }: { trend: IssueTrend }) {
  const Icon = TREND_ICON[trend] ?? CircleHelp
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${TREND_CLS[trend] ?? 'text-slate-500'}`}
      title={TREND_DESCRIPTIONS[trend]}
    >
      <Icon className="size-3.5" aria-hidden />
      {TREND_LABELS[trend] ?? humanize(trend)}
    </span>
  )
}

const CONFIDENCE_CLS: Record<ConfidenceLabel, string> = {
  high: 'bg-white text-slate-700 ring-slate-300',
  medium: 'bg-white text-slate-600 ring-slate-300',
  low: 'bg-white text-slate-500 ring-slate-200 italic',
}

export function ConfidenceBadge({ label, value }: { label: ConfidenceLabel; value?: number }) {
  const bars = label === 'high' ? 3 : label === 'medium' ? 2 : 1
  return (
    <Badge
      className={CONFIDENCE_CLS[label]}
      title={`${CONFIDENCE_DESCRIPTION}${value !== undefined ? ` Score: ${Math.round(value * 100)}/100.` : ''}`}
    >
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-0.5 rounded-sm ${i <= bars ? 'bg-slate-500' : 'bg-slate-200'}`} style={{ height: 3 + i * 2 }} />
        ))}
      </span>
      {CONFIDENCE_LABELS[label]}
    </Badge>
  )
}

export function CategoryChip({ label }: { label: string }) {
  return <Badge className="bg-slate-50 text-slate-700 ring-slate-300/70">{label}</Badge>
}

export function SentimentChip({ sentiment }: { sentiment: string }) {
  return (
    <Badge className={SENTIMENT_CHIP[sentiment] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20'}>
      {SENTIMENT_LABELS[sentiment] ?? humanize(sentiment)}
    </Badge>
  )
}
