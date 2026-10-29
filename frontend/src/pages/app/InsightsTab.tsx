import { getOverview } from '../../api/client'
import {
  AverageRatingChart,
  CategoryChart,
  CountBarList,
  RatingDistributionChart,
  SentimentDistribution,
  VersionNegativeChart,
} from '../../components/charts/Charts'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { ErrorMessage, Skeleton } from '../../components/ui/States'
import { useAsync } from '../../hooks/useAsync'
import { compareVersions, formatNumber, formatPercent, formatRating } from '../../lib/format'
import type { CategoryCount, VersionStat } from '../../types'
import { useAppOutlet } from './appContext'
import { NoReviewsState, NotAnalyzedNotice } from './EmptyStates'

const LANGUAGE_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

const languageName = (code: string) => {
  if (!code || code === 'unknown') return 'Unknown'
  try {
    return LANGUAGE_NAMES?.of(code) ?? code
  } catch {
    return code
  }
}

export function InsightsTab() {
  const { appId, app, dataVersion } = useAppOutlet()
  const { data, error, loading, reload } = useAsync((signal) => getOverview(appId, signal), [appId, dataVersion])

  if (error && !data) return <ErrorMessage error={error} title="Could not load insights" onRetry={reload} />
  if (!data) {
    return (
      <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading insights">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    )
  }
  if (data.total_reviews === 0) return <NoReviewsState />

  const analyzed = !!app.last_analyzed_at

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Sentiment &amp; topics</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          How users feel and what they talk about, across {formatNumber(data.total_reviews)} collected reviews (
          {formatNumber(data.analyzed_reviews)} analyzed).
        </p>
      </div>

      {!analyzed && <NotAnalyzedNotice />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sentiment distribution" description="Share of analyzed reviews by detected sentiment." />
          <CardBody>
            <SentimentDistribution distribution={data.sentiment_distribution} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Star rating distribution"
            description={`Average ${formatRating(data.average_rating)} ★ across collected reviews.`}
          />
          <CardBody>
            <RatingDistributionChart distribution={data.rating_distribution} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Topics users mention"
          description="Reviews per issue category, split into negative and other reviews. The label shows the negative share."
        />
        <CardBody>
          <CategoryChart categories={data.category_counts} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Average rating trend" description="Average star rating of reviews posted each week." />
        <CardBody>
          <AverageRatingChart data={data.timeline} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="App versions"
          description="Negative review share for the most-reviewed versions. A spike after a release can point to a regression."
        />
        <CardBody className="space-y-5">
          <VersionNegativeChart versions={data.version_breakdown} />
          {data.version_breakdown.length > 0 && <VersionTable versions={data.version_breakdown} />}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Where negativity concentrates"
            description="Categories with the highest share of negative reviews (at least 5 reviews)."
          />
          <CardBody>
            <NegativeTopics categories={data.category_counts} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Review languages" description="Detected language of collected reviews." />
          <CardBody>
            <CountBarList items={data.languages} formatKey={languageName} emptyMessage="No language information." />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function NegativeTopics({ categories }: { categories: CategoryCount[] }) {
  const rows = categories
    .filter((c) => c.count >= 5)
    .sort((a, b) => b.negative_share - a.negative_share)
    .slice(0, 8)
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Not enough categorized reviews yet.</p>
  }
  return (
    <ul className="space-y-2">
      {rows.map((c) => (
        <li key={c.category} className="grid grid-cols-[minmax(0,9rem)_1fr_5.5rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-700" title={c.label}>
            {c.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
            <span
              className="block h-full rounded-full bg-[#e34948]"
              style={{ width: `${Math.min(100, c.negative_share * 100)}%` }}
            />
          </span>
          <span className="tabular text-right text-xs text-slate-600">
            {formatPercent(c.negative_share, 0)} <span className="text-slate-400">of {formatNumber(c.count)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function VersionTable({ versions }: { versions: VersionStat[] }) {
  const rows = [...versions].sort((a, b) => b.reviews - a.reviews)
  // Most-reviewed versions, newest release first.
  const shown = rows.slice(0, 25).sort((a, b) => compareVersions(b.version, a.version))
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">Reviews, average rating and negative share by app version</caption>
        <thead className="bg-slate-50 text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2">
              Version
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Reviews
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Avg rating
            </th>
            <th scope="col" className="px-3 py-2">
              Negative share
            </th>
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-slate-100">
          {shown.map((v) => (
            <tr key={v.version}>
              <td className="px-3 py-2 font-mono text-xs text-slate-800">{v.version}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatNumber(v.reviews)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatRating(v.average_rating)} ★</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-[#e34948]"
                      style={{ width: `${Math.min(100, v.negative_share * 100)}%` }}
                    />
                  </span>
                  <span className="text-xs text-slate-700">{formatPercent(v.negative_share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          Showing the {shown.length} most-reviewed of {rows.length} versions.
        </p>
      )}
    </div>
  )
}
