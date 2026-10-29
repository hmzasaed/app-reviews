import type { ConfidenceLabel, IssueStatus, IssueTrend, JobKind, PriorityLabel } from '../types'

export const PRIORITY_ORDER: PriorityLabel[] = ['critical', 'high', 'medium', 'low']

export const PRIORITY_LABELS: Record<PriorityLabel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** Badge classes per priority. Text label is always shown too, so color is never the only signal. */
export const PRIORITY_BADGE: Record<PriorityLabel, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/25',
  high: 'bg-orange-50 text-orange-700 ring-orange-600/25',
  medium: 'bg-amber-50 text-amber-800 ring-amber-600/30',
  low: 'bg-slate-100 text-slate-700 ring-slate-500/25',
}

export const PRIORITY_DOT: Record<PriorityLabel, string> = {
  critical: 'bg-red-600',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-400',
}

export const ISSUE_STATUSES: IssueStatus[] = ['new', 'investigating', 'confirmed', 'fixed', 'dismissed', 'merged']

/** Statuses a developer can pick by hand ("merged" is only set through the merge action). */
export const EDITABLE_STATUSES: IssueStatus[] = ['new', 'investigating', 'confirmed', 'fixed', 'dismissed']

/** Default "open" filter on the issue explorer. */
export const OPEN_STATUSES: IssueStatus[] = ['new', 'investigating', 'confirmed']

export const STATUS_LABELS: Record<IssueStatus, string> = {
  new: 'New',
  investigating: 'Investigating',
  confirmed: 'Confirmed by team',
  fixed: 'Fixed',
  dismissed: 'Dismissed',
  merged: 'Merged',
}

export const STATUS_BADGE: Record<IssueStatus, string> = {
  new: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  investigating: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  confirmed: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  fixed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  dismissed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  merged: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export const TREND_LABELS: Record<IssueTrend, string> = {
  new: 'New',
  rising: 'Rising',
  stable: 'Stable',
  falling: 'Falling',
  insufficient_data: 'Not enough data',
}

export const TREND_DESCRIPTIONS: Record<IssueTrend, string> = {
  new: 'First reported within the recent window',
  rising: 'More reports in the recent window than the previous one',
  stable: 'Report volume roughly unchanged between windows',
  falling: 'Fewer reports in the recent window than the previous one',
  insufficient_data: 'Too few reports to measure a trend',
}

export const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

export const CONFIDENCE_DESCRIPTION =
  'How sure the grouping is that these reviews describe the same problem (cluster cohesion and number of supporting reviews).'

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
export type Sentiment = (typeof SENTIMENTS)[number]

export const SENTIMENT_LABELS: Record<string, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
}

export const SENTIMENT_CHIP: Record<string, string> = {
  positive: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  neutral: 'bg-stone-100 text-stone-700 ring-stone-500/20',
  negative: 'bg-red-50 text-red-700 ring-red-600/20',
}

/** Chart fills (diverging blue <-> red, gray midpoint). Keep in sync with index.css @theme. */
export const SENTIMENT_COLORS: Record<Sentiment, string> = {
  positive: '#2a78d6',
  neutral: '#b8b7ad',
  negative: '#e34948',
}

/** 1★..5★ on the same diverging scale. */
export const RATING_COLORS: Record<string, string> = {
  '1': '#e34948',
  '2': '#ee9a96',
  '3': '#b8b7ad',
  '4': '#86b6ef',
  '5': '#2a78d6',
}

export const JOB_KIND_LABELS: Record<JobKind, { running: string; done: string; noun: string }> = {
  sync: { running: 'Collecting reviews', done: 'Review collection finished', noun: 'Review collection' },
  analyze: { running: 'Running analysis', done: 'Analysis finished', noun: 'Analysis' },
}

export const EVENT_LABELS: Record<string, string> = {
  created: 'Issue detected',
  review_count_changed: 'Report count changed',
  inactive: 'Marked inactive',
  merged_in: 'Another issue merged in',
  detected: 'Issue detected',
  status_changed: 'Status changed',
  status: 'Status changed',
  title_changed: 'Title edited',
  renamed: 'Title edited',
  title: 'Title edited',
  priority_override: 'Priority overridden',
  priority_overridden: 'Priority overridden',
  override_cleared: 'Priority override cleared',
  priority_override_cleared: 'Priority override cleared',
  priority_changed: 'Priority changed',
  merged: 'Merged',
  merged_into: 'Merged into another issue',
  merged_from: 'Another issue merged in',
  reviews_added: 'New reviews matched',
  updated: 'Updated by analysis',
  reactivated: 'Reactivated',
  deactivated: 'Marked inactive',
  summary_generated: 'Summary generated',
}
