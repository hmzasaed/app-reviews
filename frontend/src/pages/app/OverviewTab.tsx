import { AlertOctagon, ListChecks, MessageSquareText, Star, ThumbsDown } from 'lucide-react'
import { Link } from 'react-router'
import { getOverview } from '../../api/client'
import { WeeklySentimentChart } from '../../components/charts/Charts'
import { IssueRankList } from '../../components/IssueRankList'
import { KpiCard } from '../../components/KpiCard'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { ErrorMessage, Skeleton } from '../../components/ui/States'
import { useAsync } from '../../hooks/useAsync'
import { formatNumber, formatPercent, formatRating } from '../../lib/format'
import { appPath, useAppOutlet } from './appContext'
import { NoReviewsState, NotAnalyzedNotice } from './EmptyStates'

export function OverviewTab() {
  const { appId, app, dataVersion } = useAppOutlet()
  const { data, error, loading, reload } = useAsync((signal) => getOverview(appId, signal), [appId, dataVersion])

  if (error && !data) return <ErrorMessage error={error} title="Could not load the overview" onRetry={reload} />
  if (!data) return <OverviewSkeleton />
  if (data.total_reviews === 0) return <NoReviewsState />

  const analyzed = !!app.last_analyzed_at
  const criticalHigh = data.critical_issue_count + data.high_issue_count

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      {!analyzed && <NotAnalyzedNotice />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <KpiCard
          label="Total reviews"
          value={formatNumber(data.total_reviews)}
          sub={`${formatNumber(data.analyzed_reviews)} analyzed`}
          icon={<MessageSquareText className="size-4" aria-hidden />}
        />
        <KpiCard
          label="Average rating"
          value={
            <span className="inline-flex items-baseline gap-1">
              {formatRating(data.average_rating)}
              <span className="text-base text-slate-400">/ 5</span>
            </span>
          }
          sub={data.app.store_rating !== null ? `Store rating ${formatRating(data.app.store_rating)}` : 'Across collected reviews'}
          icon={<Star className="size-4" aria-hidden />}
        />
        <KpiCard
          label="Negative reviews"
          value={formatPercent(data.negative_share)}
          sub={analyzed ? 'Share of analyzed reviews' : 'Needs analysis'}
          icon={<ThumbsDown className="size-4" aria-hidden />}
        />
        <KpiCard
          label="Active reported issues"
          value={formatNumber(data.issue_count)}
          sub={
            <Link to={appPath(appId, 'issues')} className="font-medium text-indigo-700 hover:underline">
              Open issue explorer
            </Link>
          }
          icon={<ListChecks className="size-4" aria-hidden />}
        />
        <KpiCard
          label="Critical + high priority"
          value={formatNumber(criticalHigh)}
          tone={data.critical_issue_count > 0 ? 'alert' : 'default'}
          sub={`${formatNumber(data.critical_issue_count)} critical · ${formatNumber(data.high_issue_count)} high`}
          icon={<AlertOctagon className="size-4" aria-hidden />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="What to fix first"
            description="Reported issues ranked by priority score (frequency, severity, recency, growth)."
            actions={
              <Link to={appPath(appId, 'issues')} className="text-xs font-medium text-indigo-700 hover:underline">
                View all
              </Link>
            }
          />
          <IssueRankList
            appId={appId}
            issues={data.top_issues}
            emptyMessage={analyzed ? 'No reported issues found in the analyzed reviews.' : 'Run an analysis to find reported issues.'}
          />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Emerging issues" description="New or rising reports in the most recent window." />
          <IssueRankList
            appId={appId}
            issues={data.emerging_issues}
            showRank={false}
            emptyMessage={analyzed ? 'Nothing new or rising right now.' : 'Run an analysis to detect emerging issues.'}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Weekly review volume"
          description="Reviews per week stacked by sentiment, with the average star rating below on the same timeline."
        />
        <CardBody>
          <WeeklySentimentChart data={data.timeline} />
        </CardBody>
      </Card>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 lg:col-span-3" />
        <Skeleton className="h-72 lg:col-span-2" />
      </div>
      <Skeleton className="h-80" />
    </div>
  )
}
