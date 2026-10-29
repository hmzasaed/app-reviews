import { ExternalLink, FileCheck2, MessageSquareReply, Quote, ThumbsUp } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMeta } from '../context/meta'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import type { ReviewOut } from '../types'
import { CategoryChip, SentimentChip } from './IssueBadges'
import { Badge } from './ui/Badge'
import { Stars } from './ui/Stars'

function highlight(text: string, query?: string): ReactNode {
  const terms = (query ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return text
  const re = new RegExp(`(${terms.join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export function ReviewCard({
  review,
  appId,
  evidence = false,
  showIssue = true,
  query,
}: {
  review: ReviewOut
  /** Needed to link to the review's issue. */
  appId?: string
  /** Highlight as evidence cited by the issue summary. */
  evidence?: boolean
  showIssue?: boolean
  /** Search terms to highlight in the text. */
  query?: string
}) {
  const { categoryLabel } = useMeta()
  const isEvidence = evidence || review.is_evidence

  return (
    <article
      className={`rounded-lg border bg-white p-4 ${isEvidence ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
        <Stars rating={review.rating} />
        <time dateTime={review.review_date} title={formatDateTime(review.review_date)}>
          {formatDate(review.review_date)}
        </time>
        {review.app_version && <span>v{review.app_version}</span>}
        {review.language && review.language !== 'en' && <span className="uppercase">{review.language}</span>}
        <span className="inline-flex items-center gap-1" title="Users who found this review helpful">
          <ThumbsUp className="size-3.5" aria-hidden />
          <span className="tabular">{formatNumber(review.thumbs_up)}</span>
          <span className="sr-only">thumbs up</span>
        </span>
      </header>

      {(isEvidence || review.is_representative || review.sentiment || review.category) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isEvidence && (
            <Badge className="bg-indigo-600 text-white ring-indigo-600">
              <FileCheck2 className="size-3" aria-hidden />
              Evidence cited in summary
            </Badge>
          )}
          {review.is_representative && !isEvidence && (
            <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-600/20">
              <Quote className="size-3" aria-hidden />
              Representative
            </Badge>
          )}
          {review.sentiment && <SentimentChip sentiment={review.sentiment} />}
          {review.category && <CategoryChip label={categoryLabel(review.category)} />}
        </div>
      )}

      <p className="mt-2.5 text-sm leading-relaxed break-words whitespace-pre-line text-slate-800">
        {review.text ? highlight(review.text, query) : <span className="text-slate-400 italic">(No review text)</span>}
      </p>

      {review.developer_reply && (
        <details className="group mt-3 rounded-md bg-slate-50 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 select-none hover:text-slate-900">
            <MessageSquareReply className="size-3.5" aria-hidden />
            <span className="group-open:hidden">Show developer reply</span>
            <span className="hidden group-open:inline">Hide developer reply</span>
          </summary>
          <p className="border-t border-slate-200 px-3 py-2 break-words whitespace-pre-line text-slate-700">
            {review.developer_reply}
          </p>
        </details>
      )}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        {showIssue && review.issue_id && appId ? (
          <Link
            to={`/apps/${encodeURIComponent(appId)}/issues/${review.issue_id}`}
            className="min-w-0 truncate font-medium text-indigo-700 hover:underline"
          >
            Reported issue: {review.issue_title ?? `#${review.issue_id}`}
          </Link>
        ) : (
          <span />
        )}
        <a
          href={review.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-indigo-700 hover:underline"
        >
          View on Google Play
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </footer>
    </article>
  )
}
