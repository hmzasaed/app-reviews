import { ChevronRight, ThumbsUp } from 'lucide-react'
import { Link } from 'react-router'
import { formatNumber, formatRelative } from '../lib/format'
import type { IssueSummaryOut } from '../types'
import { PriorityBadge, TrendIndicator } from './IssueBadges'

/** Compact ranked list of reported issues; each row links to the issue detail. */
export function IssueRankList({
  appId,
  issues,
  showRank = true,
  emptyMessage = 'No reported issues.',
}: {
  appId: string
  issues: IssueSummaryOut[]
  showRank?: boolean
  emptyMessage?: string
}) {
  if (issues.length === 0) return <p className="px-4 py-8 text-center text-sm text-slate-500 sm:px-5">{emptyMessage}</p>
  return (
    <ol className="divide-y divide-slate-100">
      {issues.map((issue, index) => (
        <li key={issue.id}>
          <Link
            to={`/apps/${encodeURIComponent(appId)}/issues/${issue.id}`}
            className="group flex items-start gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5"
          >
            {showRank && (
              <span className="tabular mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-slate-400">
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PriorityBadge
                  priority={issue.effective_priority}
                  score={issue.priority_score}
                  overridden={issue.priority_override !== null}
                />
                <TrendIndicator trend={issue.trend} />
              </div>
              <p className="mt-1 text-sm font-medium text-slate-900 group-hover:text-indigo-700">{issue.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                {issue.category_label && <span>{issue.category_label}</span>}
                <span className="tabular">{formatNumber(issue.review_count)} reports</span>
                <span className="tabular inline-flex items-center gap-1">
                  <ThumbsUp className="size-3" aria-hidden />
                  {formatNumber(issue.thumbs_up_total)}
                  <span className="sr-only">thumbs up</span>
                </span>
                {issue.last_seen_at && <span>last seen {formatRelative(issue.last_seen_at)}</span>}
              </p>
            </div>
            <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300 group-hover:text-slate-500" aria-hidden />
          </Link>
        </li>
      ))}
    </ol>
  )
}
