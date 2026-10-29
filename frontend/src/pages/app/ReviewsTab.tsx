import { Download, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { exportUrl, getOverview, listIssues, listReviews } from '../../api/client'
import { ReviewCard } from '../../components/ReviewCard'
import { Card } from '../../components/ui/Card'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorMessage, Skeleton } from '../../components/ui/States'
import { useMeta } from '../../context/meta'
import { useAsync } from '../../hooks/useAsync'
import { formatNumber, pluralize } from '../../lib/format'
import { SENTIMENT_LABELS, SENTIMENTS } from '../../lib/labels'
import type { ReviewQuery, ReviewSort } from '../../types'
import { useAppOutlet } from './appContext'
import { NoReviewsState } from './EmptyStates'

const PAGE_SIZE = 25
const FILTER_KEYS = ['q', 'rating', 'sentiment', 'category', 'issue_id', 'version', 'language', 'date_from', 'date_to'] as const

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'thumbs', label: 'Most helpful (thumbs up)' },
  { value: 'rating', label: 'Lowest rating first' },
]

export function ReviewsTab() {
  const { appId, app, dataVersion } = useAppOutlet()
  const { categories } = useMeta()
  const [params, setParams] = useSearchParams()
  const ids = {
    q: useId(),
    rating: useId(),
    sentiment: useId(),
    category: useId(),
    issue: useId(),
    version: useId(),
    language: useId(),
    from: useId(),
    to: useId(),
    sort: useId(),
    versions: useId(),
    languages: useId(),
  }
  const resultsRef = useRef<HTMLDivElement>(null)

  const get = (key: string) => params.get(key) ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const sort = (params.get('sort') as ReviewSort | null) ?? 'newest'

  const query: ReviewQuery = {
    q: get('q') || undefined,
    rating: get('rating') ? Number(get('rating')) : undefined,
    sentiment: get('sentiment') || undefined,
    category: get('category') || undefined,
    issue_id: get('issue_id') ? Number(get('issue_id')) : undefined,
    version: get('version') || undefined,
    language: get('language') || undefined,
    date_from: get('date_from') || undefined,
    date_to: get('date_to') || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  }
  const queryKey = JSON.stringify(query)
  const activeFilters = FILTER_KEYS.filter((k) => params.get(k))

  const reviews = useAsync((signal) => listReviews(appId, query, signal), [appId, queryKey, dataVersion])
  // Filter options (best effort — the filters still work as free text without them).
  const issues = useAsync(
    (signal) => (app.last_analyzed_at ? listIssues(appId, { include_inactive: true, sort: 'priority' }, signal) : Promise.resolve([])),
    [appId, dataVersion, app.last_analyzed_at],
  )
  const overview = useAsync((signal) => getOverview(appId, signal), [appId, dataVersion])

  // Debounced search box synced to the URL.
  const urlQ = get('q')
  const [qInput, setQInput] = useState(urlQ)
  const lastUrlQ = useRef(urlQ)
  useEffect(() => {
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ
      setQInput(urlQ)
    }
  }, [urlQ])

  const setFilter = (updates: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (qInput.trim() === urlQ) return
    const timer = window.setTimeout(() => {
      lastUrlQ.current = qInput.trim()
      setFilter({ q: qInput.trim() || null })
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])

  const clearAll = () => {
    lastUrlQ.current = ''
    setQInput('')
    const next = new URLSearchParams()
    if (params.get('sort')) next.set('sort', params.get('sort')!)
    setParams(next, { replace: true })
  }

  const [showFilters, setShowFilters] = useState(activeFilters.some((k) => k !== 'q'))

  const versionOptions = (overview.data?.version_breakdown ?? []).map((v) => v.version)
  const languageOptions = (overview.data?.languages ?? []).map((l) => l.key)

  if (app.review_count === 0 && !app.last_synced_at && reviews.data?.total === 0 && activeFilters.length === 0) {
    return <NoReviewsState />
  }

  const data = reviews.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Review evidence</h2>
          <p className="mt-0.5 text-sm text-slate-500">Search and filter the raw reviews behind every number.</p>
        </div>
        <div className="flex flex-col gap-1 text-xs text-slate-500 sm:items-end">
          <ExportLinks appId={appId} kind="reviews" label="Export reviews" />
          <ExportLinks appId={appId} kind="issues" label="Export issues" />
          <span className="text-[11px] text-slate-400">Exports contain all data for this app (filters not applied).</span>
        </div>
      </div>

      <Card className="space-y-3 p-3 sm:p-4">
        <form
          role="search"
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            lastUrlQ.current = qInput.trim()
            setFilter({ q: qInput.trim() || null })
          }}
        >
          <div className="relative flex-1">
            <label htmlFor={ids.q} className="sr-only">
              Search review text
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id={ids.q}
              type="search"
              className="input pl-9"
              placeholder="Search review text, e.g. “crash login”"
              maxLength={200}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 sm:w-52 sm:flex-none">
              <label htmlFor={ids.sort} className="sr-only">
                Sort reviews
              </label>
              <select
                id={ids.sort}
                className="input"
                value={sort}
                onChange={(e) => setFilter({ sort: e.target.value === 'newest' ? null : e.target.value })}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-slate-700 shadow-xs ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filters
              {activeFilters.filter((k) => k !== 'q').length > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-xs text-white">
                  {activeFilters.filter((k) => k !== 'q').length}
                </span>
              )}
            </button>
          </div>
        </form>

        {showFilters && (
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 md:grid-cols-4 lg:grid-cols-5">
            <div>
              <label htmlFor={ids.rating} className="label">
                Rating
              </label>
              <select id={ids.rating} className="input" value={get('rating')} onChange={(e) => setFilter({ rating: e.target.value })}>
                <option value="">Any rating</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r} star{r > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.sentiment} className="label">
                Sentiment
              </label>
              <select
                id={ids.sentiment}
                className="input"
                value={get('sentiment')}
                onChange={(e) => setFilter({ sentiment: e.target.value })}
              >
                <option value="">Any sentiment</option>
                {SENTIMENTS.map((s) => (
                  <option key={s} value={s}>
                    {SENTIMENT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.category} className="label">
                Category
              </label>
              <select
                id={ids.category}
                className="input"
                value={get('category')}
                onChange={(e) => setFilter({ category: e.target.value })}
              >
                <option value="">Any category</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 md:col-span-1 lg:col-span-2">
              <label htmlFor={ids.issue} className="label">
                Reported issue
              </label>
              <select
                id={ids.issue}
                className="input"
                value={get('issue_id')}
                onChange={(e) => setFilter({ issue_id: e.target.value })}
              >
                <option value="">Any issue</option>
                {get('issue_id') && !(issues.data ?? []).some((i) => String(i.id) === get('issue_id')) && (
                  <option value={get('issue_id')}>Issue #{get('issue_id')}</option>
                )}
                {(issues.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    #{i.id} · {i.title} ({formatNumber(i.review_count)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.version} className="label">
                App version
              </label>
              <input
                id={ids.version}
                className="input"
                list={ids.versions}
                placeholder="e.g. 2.24.1"
                defaultValue={get('version')}
                key={`v-${get('version')}`}
                onBlur={(e) => e.target.value.trim() !== get('version') && setFilter({ version: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    setFilter({ version: e.currentTarget.value.trim() })
                  }
                }}
              />
              <datalist id={ids.versions}>
                {versionOptions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={ids.language} className="label">
                Language
              </label>
              <input
                id={ids.language}
                className="input"
                list={ids.languages}
                placeholder="e.g. en"
                defaultValue={get('language')}
                key={`l-${get('language')}`}
                onBlur={(e) => e.target.value.trim() !== get('language') && setFilter({ language: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    setFilter({ language: e.currentTarget.value.trim() })
                  }
                }}
              />
              <datalist id={ids.languages}>
                {languageOptions.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={ids.from} className="label">
                From date
              </label>
              <input
                id={ids.from}
                type="date"
                className="input"
                value={get('date_from')}
                max={get('date_to') || undefined}
                onChange={(e) => setFilter({ date_from: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={ids.to} className="label">
                To date
              </label>
              <input
                id={ids.to}
                type="date"
                className="input"
                value={get('date_to')}
                min={get('date_from') || undefined}
                onChange={(e) => setFilter({ date_to: e.target.value })}
              />
            </div>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">Active filters:</span>
            {activeFilters.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === 'q') {
                    lastUrlQ.current = ''
                    setQInput('')
                  }
                  setFilter({ [k]: null })
                }}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                aria-label={`Remove filter ${filterLabel(k)}`}
              >
                {filterLabel(k)}: {filterValue(k, get(k), categories, issues.data)}
                <X className="size-3" aria-hidden />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="ml-1 text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline">
              Clear all
            </button>
          </div>
        )}
      </Card>

      <div ref={resultsRef} className="scroll-mt-4 space-y-3">
        {reviews.error !== null && !data ? (
          <ErrorMessage error={reviews.error} title="Could not load reviews" onRetry={reviews.reload} />
        ) : !data ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading reviews">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title={activeFilters.length > 0 ? 'No reviews match these filters' : 'No reviews yet'}
            description={
              activeFilters.length > 0 ? 'Try removing a filter or searching for a different phrase.' : 'Collect reviews to see them here.'
            }
            action={
              activeFilters.length > 0 && (
                <button type="button" onClick={clearAll} className="text-sm font-medium text-indigo-700 hover:underline">
                  Clear all filters
                </button>
              )
            }
          />
        ) : (
          <>
            <p className="text-xs text-slate-500" aria-live="polite">
              {pluralize(data.total, 'review')} {activeFilters.length > 0 ? 'match' : 'in total'}
            </p>
            <div className={`space-y-3 transition-opacity ${reviews.loading ? 'opacity-60' : ''}`}>
              {data.items.map((r) => (
                <ReviewCard key={r.id} review={r} appId={appId} query={query.q} />
              ))}
            </div>
            <Pagination
              page={data.page}
              pageSize={data.page_size}
              total={data.total}
              disabled={reviews.loading}
              onChange={(p) => {
                setFilter({ page: p > 1 ? String(p) : null }, false)
                resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}

function ExportLinks({ appId, kind, label }: { appId: string; kind: 'reviews' | 'issues'; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Download className="size-3.5" aria-hidden />
      {label}:
      <a href={exportUrl(appId, kind, 'csv')} download className="font-medium text-indigo-700 hover:underline">
        CSV
      </a>
      <a href={exportUrl(appId, kind, 'json')} download className="font-medium text-indigo-700 hover:underline">
        JSON
      </a>
    </span>
  )
}

const FILTER_LABELS: Record<string, string> = {
  q: 'Search',
  rating: 'Rating',
  sentiment: 'Sentiment',
  category: 'Category',
  issue_id: 'Issue',
  version: 'Version',
  language: 'Language',
  date_from: 'From',
  date_to: 'To',
}

const filterLabel = (key: string) => FILTER_LABELS[key] ?? key

function filterValue(
  key: string,
  value: string,
  categories: { key: string; label: string }[],
  issues: { id: number; title: string }[] | undefined,
): string {
  switch (key) {
    case 'rating':
      return `${value}★`
    case 'sentiment':
      return SENTIMENT_LABELS[value] ?? value
    case 'category':
      return categories.find((c) => c.key === value)?.label ?? value
    case 'issue_id': {
      const title = issues?.find((i) => String(i.id) === value)?.title
      return title ? (title.length > 40 ? `${title.slice(0, 40)}…` : title) : `#${value}`
    }
    case 'q':
      return `“${value}”`
    default:
      return value
  }
}
