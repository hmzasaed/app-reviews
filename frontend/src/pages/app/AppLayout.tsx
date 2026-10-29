import { ArrowLeft, DownloadCloud, ExternalLink, Sparkles, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, getApp, getJob, listAppJobs, startAnalysis, startSync } from '../../api/client'
import { AppIcon } from '../../components/AppIcon'
import { AnalyzeDialog, SyncDialog } from '../../components/JobDialogs'
import { JobProgress } from '../../components/JobProgress'
import { Button } from '../../components/ui/Button'
import { ErrorMessage, Skeleton } from '../../components/ui/States'
import { useToast } from '../../context/toast'
import { useAsync } from '../../hooks/useAsync'
import { formatDateTime, formatNumber, formatRating, formatRelative, parseUtc } from '../../lib/format'
import { JOB_KIND_LABELS } from '../../lib/labels'
import type { AnalyzeRequest, JobOut, SyncRequest } from '../../types'
import { appPath, type AppOutletContext } from './appContext'

const POLL_INTERVAL_MS = 1500
const SHOW_RECENT_FAILURE_MS = 24 * 60 * 60 * 1000

const isActive = (job: JobOut | null | undefined): boolean => !!job && (job.status === 'queued' || job.status === 'running')

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'issues', label: 'Issues', end: false },
  { to: 'insights', label: 'Insights', end: false },
  { to: 'reviews', label: 'Reviews', end: false },
]

export function AppLayout() {
  const { appId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { push } = useToast()

  const appState = useAsync((signal) => getApp(appId, signal), [appId])
  const { data: app, error: appError, reload: reloadApp } = appState

  const [dataVersion, setDataVersion] = useState(0)
  const [trackedJob, setJob] = useState<JobOut | null>(null)
  // Only show a job that belongs to the app on screen (the layout stays mounted across apps).
  const job = trackedJob && trackedJob.app_id === appId ? trackedJob : null
  const [pollError, setPollError] = useState(false)
  // A freshly registered app (navigated here with state.justAdded) opens the collection dialog right away.
  const [dialog, setDialog] = useState<'sync' | 'analyze' | null>(() =>
    (location.state as { justAdded?: boolean } | null)?.justAdded ? 'sync' : null,
  )

  // Resume tracking a running job (or surface a recent failure) when the app page opens.
  useEffect(() => {
    const controller = new AbortController()
    listAppJobs(appId, 1, controller.signal)
      .then((jobs) => {
        const latest = jobs[0]
        if (!latest) return
        if (isActive(latest)) {
          setJob(latest)
        } else if (latest.status === 'failed') {
          const finished = parseUtc(latest.completed_at ?? latest.created_at)
          if (finished && Date.now() - finished.getTime() < SHOW_RECENT_FAILURE_MS) setJob(latest)
        }
      })
      .catch(() => {
        /* non-critical: the page works without job status */
      })
    return () => controller.abort()
  }, [appId])

  // Poll the active job until it finishes.
  useEffect(() => {
    if (!job || !isActive(job)) return
    const jobId = job.id
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const next = await getJob(jobId)
        if (cancelled) return
        setPollError(false)
        setJob(next)
        if (!isActive(next)) {
          const labels = JOB_KIND_LABELS[next.kind]
          if (next.status === 'completed') {
            push('success', labels?.done ?? 'Job finished')
            reloadApp()
            setDataVersion((v) => v + 1)
          } else {
            push('error', `${labels?.noun ?? 'Job'} failed${next.error_message ? `: ${next.error_message}` : ''}`)
          }
        }
      } catch {
        if (cancelled) return
        setPollError(true)
        setJob((current) => (current ? { ...current } : current)) // schedule another attempt
      }
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [job, push, reloadApp])

  // Clear the one-shot "justAdded" navigation state so a reload doesn't reopen the dialog.
  useEffect(() => {
    if ((location.state as { justAdded?: boolean } | null)?.justAdded) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  const startJob = useCallback(
    async (kind: 'sync' | 'analyze', body: SyncRequest | AnalyzeRequest) => {
      try {
        const started = kind === 'sync' ? await startSync(appId, body as SyncRequest) : await startAnalysis(appId, body as AnalyzeRequest)
        setPollError(false)
        setJob(started)
        push('info', `${JOB_KIND_LABELS[kind].noun} started`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Another job is already running for this app: resume tracking it instead.
          const jobs = await listAppJobs(appId, 1).catch(() => [] as JobOut[])
          if (isActive(jobs[0] ?? null)) {
            setJob(jobs[0])
            push('info', 'A job is already running for this app — showing its progress.')
            return
          }
        }
        throw err
      }
    },
    [appId, push],
  )

  const jobActive = isActive(job)
  const openSync = useCallback(() => setDialog('sync'), [])
  const openAnalyze = useCallback(() => setDialog('analyze'), [])

  const outletContext = useMemo<AppOutletContext | null>(
    () => (app ? { appId, app, dataVersion, jobActive, openSync, openAnalyze } : null),
    [app, appId, dataVersion, jobActive, openSync, openAnalyze],
  )

  if (appError && !app) {
    const notFound = appError instanceof ApiError && appError.status === 404
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorMessage
          error={appError}
          title={notFound ? 'This app is not registered' : 'Could not load the app'}
          onRetry={notFound ? undefined : reloadApp}
        />
        {notFound && (
          <p className="text-sm text-slate-600">
            <Link to="/" className="font-medium text-indigo-700 hover:underline">
              Go back to your apps
            </Link>{' '}
            and add it from there.
          </p>
        )}
      </div>
    )
  }

  if (!app || app.id !== appId || !outletContext) return <HeaderSkeleton />

  const title = app.title ?? app.id
  const syncedSinceAnalysis =
    !!app.last_synced_at &&
    (!app.last_analyzed_at || (parseUtc(app.last_synced_at)?.getTime() ?? 0) > (parseUtc(app.last_analyzed_at)?.getTime() ?? 0))

  return (
    <div className="space-y-5">
      <BackLink />

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <AppIcon src={app.icon_url} title={title} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
              {app.developer && <span>{app.developer}</span>}
              {app.genre && <span className="text-slate-500">{app.genre}</span>}
              {app.store_rating !== null && (
                <span className="inline-flex items-center gap-1" title="Current Play Store rating">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {formatRating(app.store_rating)}
                  <span className="sr-only">store rating</span>
                </span>
              )}
              {app.installs && <span className="text-slate-500">{app.installs} installs</span>}
              <a
                href={app.store_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
              >
                Google Play
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{app.id}</code>
              <span>
                {app.lang.toUpperCase()} · {app.country.toUpperCase()}
              </span>
              <span className="tabular">{formatNumber(app.review_count)} reviews stored</span>
              <span title={formatDateTime(app.last_synced_at)}>
                Collected {app.last_synced_at ? formatRelative(app.last_synced_at) : 'never'}
              </span>
              <span title={formatDateTime(app.last_analyzed_at)}>
                Analyzed {app.last_analyzed_at ? formatRelative(app.last_analyzed_at) : 'never'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            onClick={openSync}
            disabled={jobActive}
            icon={<DownloadCloud className="size-4" aria-hidden />}
            title={jobActive ? 'Wait for the running job to finish' : 'Fetch the latest reviews from Google Play'}
          >
            Collect reviews
          </Button>
          <Button
            variant="primary"
            onClick={openAnalyze}
            disabled={jobActive || app.review_count === 0}
            icon={<Sparkles className="size-4" aria-hidden />}
            title={
              app.review_count === 0
                ? 'Collect reviews first'
                : jobActive
                  ? 'Wait for the running job to finish'
                  : 'Find and rank reported issues'
            }
          >
            Run analysis
          </Button>
        </div>
      </header>

      {job && (
        <JobProgress
          job={job}
          pollError={pollError}
          onDismiss={jobActive ? undefined : () => setJob(null)}
          action={
            job.status === 'completed' && job.kind === 'sync' && syncedSinceAnalysis ? (
              <Button size="sm" variant="primary" onClick={openAnalyze} icon={<Sparkles className="size-3.5" aria-hidden />}>
                Run analysis on the new reviews
              </Button>
            ) : undefined
          }
        />
      )}

      <nav aria-label="App sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max min-w-full gap-1 shadow-[inset_0_-1px_0_0_var(--color-slate-200)]">
          {TABS.map((tab) => (
            <li key={tab.label}>
              <NavLink
                to={appPath(appId, tab.to)}
                end={tab.end}
                className={({ isActive: active }) =>
                  `inline-flex items-center border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet context={outletContext} />

      <SyncDialog
        key={`sync-${dialog === 'sync'}`}
        open={dialog === 'sync'}
        onClose={() => setDialog(null)}
        onStart={(body) => startJob('sync', body)}
      />
      <AnalyzeDialog
        key={`analyze-${dialog === 'analyze'}`}
        open={dialog === 'analyze'}
        onClose={() => setDialog(null)}
        onStart={(body) => startJob('analyze', body)}
        reviewCount={app.review_count}
      />
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" aria-hidden />
      All apps
    </Link>
  )
}

function HeaderSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading app">
      <Skeleton className="h-4 w-20" />
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  )
}
