import { ChevronDown, Clock, MessageSquareText, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, createApp, deleteApp, errorMessage, listApps } from '../api/client'
import { AppIcon } from '../components/AppIcon'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState, ErrorMessage, Skeleton } from '../components/ui/States'
import { useToast } from '../context/toast'
import { useAsync } from '../hooks/useAsync'
import { formatDateTime, formatNumber, formatRelative } from '../lib/format'
import type { AppOut } from '../types'
import { appPath } from './app/appContext'

export function AppsHome() {
  const apps = useAsync((signal) => listApps(signal), [])

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Play Store review intelligence</h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          Turn Google Play reviews into decisions: what users report as broken, how many are affected, what to fix first —
          with the actual reviews as evidence.
        </p>
      </section>

      <AddAppForm onCreated={(app) => apps.setData((list) => [app, ...(list ?? []).filter((a) => a.id !== app.id)])} />

      <section aria-labelledby="apps-heading" className="space-y-3">
        <h2 id="apps-heading" className="text-sm font-semibold text-slate-900">
          Your apps
          {apps.data && <span className="ml-1.5 font-normal text-slate-500">({apps.data.length})</span>}
        </h2>
        {apps.error !== null && !apps.data ? (
          <ErrorMessage error={apps.error} title="Could not load your apps" onRetry={apps.reload} />
        ) : !apps.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading apps">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : apps.data.length === 0 ? (
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="No apps yet"
            description="Paste a Google Play link or package ID above to start collecting and analyzing reviews."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.data.map((app) => (
              <li key={app.id}>
                <AppCard
                  app={app}
                  onDeleted={() => apps.setData((list) => list?.filter((a) => a.id !== app.id))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AddAppForm({ onCreated }: { onCreated: (app: AppOut) => void }) {
  const navigate = useNavigate()
  const { push } = useToast()
  const urlId = useId()
  const langId = useId()
  const countryId = useId()
  const [value, setValue] = useState('')
  const [lang, setLang] = useState('')
  const [country, setCountry] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const input = value.trim()
    if (!input) {
      setError(new Error('Enter a Google Play URL or a package ID such as com.example.app.'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const app = await createApp({
        url_or_id: input,
        lang: lang.trim() || null,
        country: country.trim() || null,
      })
      onCreated(app)
      push('success', `Added ${app.title ?? app.id}`)
      navigate(appPath(app.id), { state: { justAdded: true } })
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  const errorTitle =
    error instanceof ApiError && error.status === 404
      ? 'App not found on Google Play'
      : error instanceof ApiError && error.status === 422
        ? 'Please check what you entered'
        : 'Could not add the app'

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} noValidate className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Analyze a new app</h2>
          <p className="mt-0.5 text-xs text-slate-500">Any public app on Google Play — yours or a competitor’s.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <label htmlFor={urlId} className="sr-only">
              Google Play URL or package ID
            </label>
            <input
              id={urlId}
              className="input"
              placeholder="https://play.google.com/store/apps/details?id=com.example.app  or  com.example.app"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error !== null}
              required
            />
          </div>
          <Button type="submit" variant="primary" loading={submitting} icon={<Plus className="size-4" aria-hidden />}>
            Add app
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ChevronDown className={`size-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden />
          Language &amp; country (optional)
        </button>
        {showAdvanced && (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <div>
              <label htmlFor={langId} className="label">
                Review language
              </label>
              <input
                id={langId}
                className="input"
                placeholder="en"
                maxLength={10}
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={countryId} className="label">
                Store country
              </label>
              <input
                id={countryId}
                className="input"
                placeholder="us"
                maxLength={10}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>
        )}

        {error !== null && <ErrorMessage error={error} title={errorTitle} />}
      </form>
    </Card>
  )
}

function AppCard({ app, onDeleted }: { app: AppOut; onDeleted: () => void }) {
  const { push } = useToast()
  const [deleting, setDeleting] = useState(false)
  const title = app.title ?? app.id

  const remove = async () => {
    if (
      !window.confirm(
        `Delete ${title}?\n\nThis removes the app with all collected reviews, reported issues and analysis history from the dashboard.`,
      )
    )
      return
    setDeleting(true)
    try {
      await deleteApp(app.id)
      push('success', `Deleted ${title}`)
      onDeleted()
    } catch (err) {
      push('error', `Could not delete ${title}: ${errorMessage(err)}`)
      setDeleting(false)
    }
  }

  return (
    <div className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3 pr-8">
        <AppIcon src={app.icon_url} title={title} />
        <div className="min-w-0">
          <Link
            to={appPath(app.id)}
            className="block truncate font-semibold text-slate-900 after:absolute after:inset-0 after:content-[''] hover:text-indigo-700"
          >
            {title}
          </Link>
          <p className="truncate font-mono text-xs text-slate-500">{app.id}</p>
          {app.developer && <p className="truncate text-xs text-slate-500">{app.developer}</p>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="flex items-center gap-1 text-slate-500">
            <MessageSquareText className="size-3" aria-hidden />
            Reviews
          </dt>
          <dd className="tabular mt-0.5 font-semibold text-slate-900">{formatNumber(app.review_count)}</dd>
        </div>
        <div title={formatDateTime(app.last_synced_at)}>
          <dt className="flex items-center gap-1 text-slate-500">
            <Clock className="size-3" aria-hidden />
            Collected
          </dt>
          <dd className="mt-0.5 font-medium text-slate-700">
            {app.last_synced_at ? formatRelative(app.last_synced_at) : 'Never'}
          </dd>
        </div>
        <div title={formatDateTime(app.last_analyzed_at)}>
          <dt className="flex items-center gap-1 text-slate-500">
            <Sparkles className="size-3" aria-hidden />
            Analyzed
          </dt>
          <dd className="mt-0.5 font-medium text-slate-700">
            {app.last_analyzed_at ? formatRelative(app.last_analyzed_at) : 'Never'}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="absolute top-3 right-3 z-10 rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 focus-visible:text-red-600 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={`Delete ${title}`}
        title="Delete app"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  )
}
