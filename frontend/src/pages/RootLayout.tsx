import { BarChart3 } from 'lucide-react'
import { Link, Outlet, ScrollRestoration, useNavigation } from 'react-router'
import { useMeta } from '../context/meta'

export function RootLayout() {
  const navigation = useNavigation()
  const { meta } = useMeta()

  return (
    <div className="flex min-h-screen flex-col">
      {navigation.state !== 'idle' && (
        <div className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-indigo-500" role="progressbar" aria-label="Loading page" />
      )}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <BarChart3 className="size-4" aria-hidden />
            </span>
            <span className="text-sm sm:text-base">Review Intelligence</span>
          </Link>
          <nav aria-label="Main">
            <Link to="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Apps
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <p>Issues are inferred from user reviews. Root causes are not confirmed by this system.</p>
          {meta && (
            <p>
              Summaries: {meta.llm_provider}
              {meta.llm_model ? ` · ${meta.llm_model}` : ''}
            </p>
          )}
        </div>
      </footer>
      <ScrollRestoration />
    </div>
  )
}
