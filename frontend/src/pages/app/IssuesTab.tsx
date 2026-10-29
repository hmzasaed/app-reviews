import { Download, Info, ThumbsUp } from 'lucide-react'
import { useId } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { errorMessage, exportUrl, listIssues, updateIssue } from '../../api/client'
import {
  CategoryChip,
  ConfidenceBadge,
  PriorityBadge,
  StatusSelect,
  TrendIndicator,
} from '../../components/IssueBadges'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorMessage, Skeleton } from '../../components/ui/States'
import { useMeta } from '../../context/meta'
import { useToast } from '../../context/toast'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatNumber, formatRelative, pluralize } from '../../lib/format'
import { ISSUE_STATUSES, OPEN_STATUSES, STATUS_LABELS } from '../../lib/labels'
import type { IssueSort, IssueStatus, IssueSummaryOut } from '../../types'
import { appPath, useAppOutlet } from './appContext'
import { NoReviewsState, NotAnalyzedState } from './EmptyStates'

const SORTS: { value: IssueSort; label: string }[] = [
  { value: 'priority', label: 'Priority score' },
  { value: 'count', label: 'Number of reports' },
  { value: 'recent', label: 'Most recent' },
]

/** Parse the `status` search param: absent -> open statuses, "all" -> no filter. */
function parseStatuses(raw: string | null): IssueStatus[] {
  if (raw === null) return OPEN_STATUSES
  if (raw === 'all' || raw === '') return []
  return raw.split(',').filter((s): s is IssueStatus => (ISSUE_STATUSES as string[]).includes(s))
}

export function IssuesTab() {
  const { appId, app, dataVersion } = useAppOutlet()
  const { categories } = useMeta()
  const { push } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const categoryId = useId()
  const sortId = useId()

  const statuses = parseStatuses(params.get('status'))
  const category = params.get('category') ?? ''
  const includeInactive = params.get('inactive') === '1'
  const sort = (params.get('sort') as IssueSort | null) ?? 'priority'
  const statusKey = statuses.join(',')

  const analyzed = !!app.last_analyzed_at
  const { data, error, loading, reload, setData } = useAsync(
    (signal) =>
      analyzed
        ? listIssues(
            appId,
            { status: statuses, include_inactive: includeInactive, category: category || undefined, sort },
            signal,
          )
        : Promise.resolve([] as IssueSummaryOut[]),
    [appId, statusKey, category, includeInactive, sort, dataVersion, analyzed],
  )

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const toggleStatus = (status: IssueStatus) => {
    const set = new Set(statuses)
    if (set.has(status)) set.delete(status)
    else set.add(status)
    const list = ISSUE_STATUSES.filter((s) => set.has(s))
    update('status', list.length === 0 ? 'all' : list.join(','))
  }

  const changeStatus = async (issue: IssueSummaryOut, status: IssueStatus) => {
    const previous = issue.status
    setData((list) => list?.map((i) => (i.id === issue.id ? { ...i, status } : i)))
    try {
      await updateIssue(issue.id, { status })
      push('success', `“${issue.title}” marked as ${STATUS_LABELS[status].toLowerCase()}`)
    } catch (err) {
      setData((list) => list?.map((i) => (i.id === issue.id ? { ...i, status: previous } : i)))
      push('error', `Could not update status: ${errorMessage(err)}`)
    }
  }

  if (!analyzed) {
    return app.review_count === 0 && !app.last_synced_at ? (
      <NoReviewsState />
    ) : (
      <NotAnalyzedState reviewCount={app.review_count} />
    )
  }

  const issueHref = (id: number) => appPath(appId, `issues/${id}`)
  const isDefaultFilter =
    params.get('status') === null && !category && !includeInactive && sort === 'priority'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Issue explorer</h2>
          <p className="mt-0.5 flex items-start gap-1.5 text-sm text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Reported issues are groups of similar user complaints — potential bugs, not confirmed defects.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Download className="size-3.5" aria-hidden />
          Export issues:
          <a href={exportUrl(appId, 'issues', 'csv')} download className="font-medium text-indigo-700 hover:underline">
            CSV
          </a>
          <a href={exportUrl(appId, 'issues', 'json')} download className="font-medium text-indigo-700 hover:underline">
            JSON
          </a>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <fieldset>
            <legend className="label">Status</legend>
            <div className="flex flex-wrap gap-1.5">
              {ISSUE_STATUSES.map((s) => {
                const active = statuses.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStatus(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      active
                        ? 'bg-indigo-600 text-white ring-indigo-600'
                        : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                )
              })}
              {statuses.length > 0 && (
                <button
                  type="button"
                  onClick={() => update('status', 'all')}
                  className="px-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
                >
                  Any status
                </button>
              )}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <div className="sm:w-48">
              <label htmlFor={categoryId} className="label">
                Category
              </label>
              <select
                id={categoryId}
                className="input"
                value={category}
                onChange={(e) => update('category', e.target.value || null)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:w-44">
              <label htmlFor={sortId} className="label">
                Sort by
              </label>
              <select
                id={sortId}
                className="input"
                value={sort}
                onChange={(e) => update('sort', e.target.value === 'priority' ? null : e.target.value)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="col-span-2 flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={includeInactive}
                onChange={(e) => update('inactive', e.target.checked ? '1' : null)}
              />
              Include inactive
            </label>
          </div>
        </div>
      </Card>

      {error !== null && !data ? (
        <ErrorMessage error={error} title="Could not load reported issues" onRetry={reload} />
      ) : !data ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading issues">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          title="No reported issues match these filters"
          description={
            isDefaultFilter
              ? 'No open issues were found in the analyzed reviews. Try including fixed/dismissed or inactive issues.'
              : 'Try widening the status filter or clearing the category.'
          }
          action={
            !isDefaultFilter && (
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
                className="text-sm font-medium text-indigo-700 hover:underline"
              >
                Reset filters
              </button>
            )
          }
        />
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <p className="text-xs text-slate-500" aria-live="polite">
            {pluralize(data.length, 'reported issue')}
          </p>

          {/* Desktop table */}
          <Card className="hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th scope="col" className="w-10 py-2.5 pr-2 pl-4 text-right">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Priority
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Reported issue
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      Reports
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      <span className="sr-only">Thumbs up</span>
                      <ThumbsUp className="ml-auto size-3.5" aria-hidden />
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Trend
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Confidence
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Status
                    </th>
                    <th scope="col" className="py-2.5 pr-4 pl-3">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((issue, index) => (
                    <tr
                      key={issue.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, select, button')) return
                        navigate(issueHref(issue.id))
                      }}
                      className={`cursor-pointer align-top hover:bg-slate-50 ${issue.is_active ? '' : 'opacity-60'}`}
                    >
                      <td className="tabular py-3 pr-2 pl-4 text-right text-xs font-semibold text-slate-400">
                        {index + 1}
                      </td>
                      <td className="px-3 py-3">
                        <PriorityBadge
                          priority={issue.effective_priority}
                          score={issue.priority_score}
                          overridden={issue.priority_override !== null}
                        />
                      </td>
                      <td className="max-w-md px-3 py-3">
                        <Link
                          to={issueHref(issue.id)}
                          className="font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                        >
                          {issue.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {issue.category_label && <CategoryChip label={issue.category_label} />}
                          {!issue.is_active && <Badge>Inactive</Badge>}
                        </div>
                      </td>
                      <td className="tabular px-3 py-3 text-right font-medium text-slate-900">
                        {formatNumber(issue.review_count)}
                      </td>
                      <td className="tabular px-3 py-3 text-right text-slate-600">
                        {formatNumber(issue.thumbs_up_total)}
                      </td>
                      <td className="px-3 py-3">
                        <TrendIndicator trend={issue.trend} />
                      </td>
                      <td className="px-3 py-3">
                        <ConfidenceBadge label={issue.confidence_label} value={issue.confidence} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusSelect
                          value={issue.status}
                          onChange={(s) => changeStatus(issue, s)}
                          label={`Status of ${issue.title}`}
                        />
                      </td>
                      <td className="py-3 pr-4 pl-3 text-xs whitespace-nowrap text-slate-500" title={formatDate(issue.last_seen_at)}>
                        {issue.last_seen_at ? formatRelative(issue.last_seen_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <ol className="space-y-2 lg:hidden">
            {data.map((issue, index) => (
              <li
                key={issue.id}
                className={`rounded-lg border border-slate-200 bg-white p-3 ${issue.is_active ? '' : 'opacity-70'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-xs font-semibold text-slate-400">#{index + 1}</span>
                    <PriorityBadge
                      priority={issue.effective_priority}
                      score={issue.priority_score}
                      overridden={issue.priority_override !== null}
                    />
                    <TrendIndicator trend={issue.trend} />
                  </div>
                  <StatusSelect value={issue.status} onChange={(s) => changeStatus(issue, s)} label={`Status of ${issue.title}`} />
                </div>
                <Link
                  to={issueHref(issue.id)}
                  className="mt-2 block font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                >
                  {issue.title}
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                  {issue.category_label && <CategoryChip label={issue.category_label} />}
                  <span className="tabular">{formatNumber(issue.review_count)} reports</span>
                  <span className="tabular inline-flex items-center gap-1">
                    <ThumbsUp className="size-3" aria-hidden />
                    {formatNumber(issue.thumbs_up_total)}
                    <span className="sr-only">thumbs up</span>
                  </span>
                  <ConfidenceBadge label={issue.confidence_label} value={issue.confidence} />
                  {!issue.is_active && <Badge>Inactive</Badge>}
                  {issue.last_seen_at && <span>last seen {formatRelative(issue.last_seen_at)}</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
