import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  compareVersions,
  formatCompact,
  formatNumber,
  formatPercent,
  formatRating,
  formatWeek,
  formatWeekLong,
  humanize,
} from '../../lib/format'
import { RATING_COLORS, SENTIMENT_COLORS, SENTIMENT_LABELS, SENTIMENTS } from '../../lib/labels'
import type { CategoryCount, CountItem, TimelinePoint, TrendPoint, VersionStat } from '../../types'
import { ChartLegend } from './ChartLegend'
import { chartTooltip } from './ChartTooltip'
import {
  ACCENT,
  AXIS_STROKE,
  AXIS_TICK,
  BAR_RADIUS_RIGHT,
  BAR_RADIUS_TOP,
  CURSOR_FILL,
  GRID_STROKE,
  MAX_BAR,
} from './theme'

const UNANALYZED_COLOR = '#e2e8f0'

function NoData({ message = 'No data yet.' }: { message?: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">{message}</div>
  )
}

// ---------------------------------------------------------------------------
// Weekly review volume, stacked by sentiment (+ separate average-rating chart)
// ---------------------------------------------------------------------------

/**
 * Weekly volume stacked by sentiment, with a second, x-aligned panel for the
 * average rating (two charts sharing a synced tooltip rather than a dual axis).
 */
export function WeeklySentimentChart({ data, showRating = true }: { data: TimelinePoint[]; showRating?: boolean }) {
  if (data.length === 0) return <NoData message="No reviews in the timeline yet." />

  const rows = data.map((p) => {
    const analyzed = p.positive + p.neutral + p.negative
    return {
      ...p,
      unanalyzed: Math.max(0, p.reviews - analyzed),
      rating: p.reviews > 0 ? p.average_rating : null,
    }
  })
  const hasUnanalyzed = rows.some((r) => r.unanalyzed > 0)
  const legend = [
    { label: 'Negative', color: SENTIMENT_COLORS.negative },
    { label: 'Neutral', color: SENTIMENT_COLORS.neutral },
    { label: 'Positive', color: SENTIMENT_COLORS.positive },
    ...(hasUnanalyzed ? [{ label: 'Not analyzed', color: UNANALYZED_COLOR }] : []),
  ]

  return (
    <div className="space-y-3">
      <ChartLegend items={legend} />
      <div className="h-60" role="img" aria-label="Weekly review volume stacked by sentiment">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} syncId="weekly-timeline" margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="period"
              tickFormatter={formatWeek}
              tick={AXIS_TICK}
              stroke={AXIS_STROKE}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis tick={AXIS_TICK} tickFormatter={formatCompact} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={CURSOR_FILL}
              content={chartTooltip({
                reverse: true,
                labelFormatter: (l) => formatWeekLong(l),
                valueFormatter: (v) => formatNumber(v),
                footer: (row) => `${formatNumber(row.reviews as number)} reviews in total`,
              })}
            />
            <Bar dataKey="negative" name="Negative" stackId="s" fill={SENTIMENT_COLORS.negative} maxBarSize={MAX_BAR} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="neutral" name="Neutral" stackId="s" fill={SENTIMENT_COLORS.neutral} maxBarSize={MAX_BAR} stroke="#fff" strokeWidth={1} />
            <Bar
              dataKey="positive"
              name="Positive"
              stackId="s"
              fill={SENTIMENT_COLORS.positive}
              maxBarSize={MAX_BAR}
              stroke="#fff"
              strokeWidth={1}
              radius={hasUnanalyzed ? undefined : BAR_RADIUS_TOP}
            />
            {hasUnanalyzed && (
              <Bar
                dataKey="unanalyzed"
                name="Not analyzed"
                stackId="s"
                fill={UNANALYZED_COLOR}
                maxBarSize={MAX_BAR}
                stroke="#fff"
                strokeWidth={1}
                radius={BAR_RADIUS_TOP}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {showRating && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Average rating per week</p>
          <AverageRatingChart data={data} height="h-32" syncId="weekly-timeline" />
        </div>
      )}
    </div>
  )
}

export function AverageRatingChart({
  data,
  height = 'h-56',
  syncId,
}: {
  data: TimelinePoint[]
  height?: string
  syncId?: string
}) {
  if (data.length === 0) return <NoData message="No ratings in the timeline yet." />
  const rows = data.map((p) => ({ period: p.period, reviews: p.reviews, rating: p.reviews > 0 ? p.average_rating : null }))
  return (
    <div className={height} role="img" aria-label="Average star rating per week">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} syncId={syncId} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="period"
            tickFormatter={formatWeek}
            tick={AXIS_TICK}
            stroke={AXIS_STROKE}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip
            content={chartTooltip({
              labelFormatter: (l) => formatWeekLong(l),
              valueFormatter: (v) => `${formatRating(v)} ★`,
              footer: (row) => `${formatNumber(row.reviews as number)} reviews`,
            })}
          />
          <Line
            type="monotone"
            dataKey="rating"
            name="Average rating"
            stroke={ACCENT}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sentiment distribution (HTML proportion bar)
// ---------------------------------------------------------------------------

export function SentimentDistribution({ distribution }: { distribution: Record<string, number> }) {
  const keys = [...SENTIMENTS, ...Object.keys(distribution).filter((k) => !(SENTIMENTS as readonly string[]).includes(k))]
  const total = keys.reduce((sum, k) => sum + (distribution[k] ?? 0), 0)
  if (total === 0) return <NoData message="No sentiment labels yet — run an analysis." />
  return (
    <div className="space-y-4">
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Sentiment distribution">
        {keys.map((k) => {
          const count = distribution[k] ?? 0
          if (!count) return null
          return (
            <div
              key={k}
              title={`${SENTIMENT_LABELS[k] ?? humanize(k)}: ${formatNumber(count)} (${formatPercent(count / total)})`}
              style={{ width: `${(count / total) * 100}%`, backgroundColor: SENTIMENT_COLORS[k as keyof typeof SENTIMENT_COLORS] ?? '#94a3b8' }}
            />
          )
        })}
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {keys.map((k) => {
          const count = distribution[k] ?? 0
          return (
            <div key={k}>
              <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: SENTIMENT_COLORS[k as keyof typeof SENTIMENT_COLORS] ?? '#94a3b8' }}
                  aria-hidden
                />
                {SENTIMENT_LABELS[k] ?? humanize(k)}
              </dt>
              <dd className="mt-0.5">
                <span className="text-lg font-semibold text-slate-900">{formatPercent(count / total)}</span>
                <span className="tabular ml-1.5 text-xs text-slate-500">{formatNumber(count)}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Star rating distribution
// ---------------------------------------------------------------------------

export function RatingDistributionChart({
  distribution,
  height = 'h-48',
}: {
  distribution: Record<string, number>
  height?: string
}) {
  const total = ['1', '2', '3', '4', '5'].reduce((sum, k) => sum + (distribution[k] ?? 0), 0)
  if (total === 0) return <NoData message="No ratings yet." />
  const rows = ['5', '4', '3', '2', '1'].map((k) => {
    const count = distribution[k] ?? 0
    return { key: k, label: `${k}★`, count, share: count / total }
  })
  return (
    <div className={height} role="img" aria-label="Star rating distribution">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: -20 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            cursor={CURSOR_FILL}
            content={chartTooltip({
              valueFormatter: (v, _n, entry) =>
                `${formatNumber(v)} (${formatPercent((entry.payload as { share: number }).share)})`,
            })}
          />
          <Bar dataKey="count" name="Reviews" maxBarSize={18} radius={BAR_RADIUS_RIGHT}>
            {rows.map((r) => (
              <Cell key={r.key} fill={RATING_COLORS[r.key]} />
            ))}
            <LabelList
              dataKey="share"
              position="right"
              formatter={(v: unknown) => formatPercent(Number(v), 0)}
              style={{ fontSize: 11, fill: '#475569' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category counts, split into negative vs other reviews
// ---------------------------------------------------------------------------

export function CategoryChart({ categories }: { categories: CategoryCount[] }) {
  if (categories.length === 0) return <NoData message="No categories yet — run an analysis." />
  const rows = [...categories]
    .sort((a, b) => b.count - a.count)
    .map((c) => {
      const negative = Math.round(c.count * c.negative_share)
      return { ...c, negative, other: Math.max(0, c.count - negative) }
    })
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Negative reviews', color: SENTIMENT_COLORS.negative },
          { label: 'Other reviews', color: '#cbd5e1' },
        ]}
      />
      <div style={{ height: Math.max(160, rows.length * 34 + 16) }} role="img" aria-label="Reviews per category">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={formatCompact} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={118}
              interval={0}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              content={chartTooltip({
                valueFormatter: (v) => formatNumber(v),
                footer: (row) =>
                  `${formatNumber(row.count as number)} total · ${formatPercent(row.negative_share as number)} negative`,
              })}
            />
            <Bar dataKey="negative" name="Negative" stackId="c" fill={SENTIMENT_COLORS.negative} maxBarSize={18} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="other" name="Other" stackId="c" fill="#cbd5e1" maxBarSize={18} radius={BAR_RADIUS_RIGHT} stroke="#fff" strokeWidth={1}>
              <LabelList
                dataKey="negative_share"
                position="right"
                formatter={(v: unknown) => `${formatPercent(Number(v), 0)} neg.`}
                style={{ fontSize: 11, fill: '#475569' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Negative share by app version
// ---------------------------------------------------------------------------

export function VersionNegativeChart({ versions, limit = 12 }: { versions: VersionStat[]; limit?: number }) {
  if (versions.length === 0) return <NoData message="No version information in the reviews." />
  // The most-reviewed versions, shown in release order so a regression after an update stands out.
  const rows = [...versions]
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, limit)
    .sort((a, b) => compareVersions(a.version, b.version))
  return (
    <div className="h-56" role="img" aria-label="Negative review share by app version">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="version" tick={AXIS_TICK} stroke={AXIS_STROKE} tickLine={false} minTickGap={8} />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v: number) => formatPercent(v, 0)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={CURSOR_FILL}
            content={chartTooltip({
              labelFormatter: (l) => `Version ${l}`,
              valueFormatter: (v) => formatPercent(v),
              footer: (row) =>
                `${formatNumber(row.reviews as number)} reviews · avg ${formatRating(row.average_rating as number)} ★`,
            })}
          />
          <Bar dataKey="negative_share" name="Negative share" fill={SENTIMENT_COLORS.negative} maxBarSize={MAX_BAR} radius={BAR_RADIUS_TOP} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issue-level charts
// ---------------------------------------------------------------------------

export function IssueWeeklyTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <NoData message="No weekly data for this issue." />
  return (
    <div className="h-48" role="img" aria-label="Reports per week for this issue">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="period" tickFormatter={formatWeek} tick={AXIS_TICK} stroke={AXIS_STROKE} tickLine={false} minTickGap={20} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={formatCompact} />
          <Tooltip
            cursor={CURSOR_FILL}
            content={chartTooltip({ labelFormatter: (l) => formatWeekLong(l), valueFormatter: (v) => formatNumber(v) })}
          />
          <Bar dataKey="count" name="Reports" fill={ACCENT} maxBarSize={MAX_BAR} radius={BAR_RADIUS_TOP} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CountBarList({
  items,
  limit = 8,
  labelPrefix = '',
  emptyMessage = 'No data.',
  formatKey = (k: string) => k,
}: {
  items: CountItem[]
  limit?: number
  labelPrefix?: string
  emptyMessage?: string
  formatKey?: (key: string) => string
}) {
  if (items.length === 0) return <NoData message={emptyMessage} />
  const sorted = [...items].sort((a, b) => b.count - a.count)
  const shown = sorted.slice(0, limit)
  const rest = sorted.slice(limit)
  const total = sorted.reduce((sum, i) => sum + i.count, 0)
  const max = Math.max(...shown.map((i) => i.count), 1)
  return (
    <ul className="space-y-2">
      {shown.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,7rem)_1fr_6.5rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-700" title={`${labelPrefix}${formatKey(item.key)}`}>
            {labelPrefix}
            {formatKey(item.key)}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="tabular text-right text-xs text-slate-600">
            {formatNumber(item.count)} <span className="text-slate-400">({formatPercent(item.count / total, 0)})</span>
          </span>
        </li>
      ))}
      {rest.length > 0 && (
        <li className="text-xs text-slate-500">
          + {rest.length} more ({formatNumber(rest.reduce((s, i) => s + i.count, 0))} reviews)
        </li>
      )}
    </ul>
  )
}
