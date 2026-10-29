import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { EmptyState } from '../components/ui/States'

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for doesn't exist."
      action={
        <Link to="/" className="text-sm font-medium text-indigo-700 hover:underline">
          Back to your apps
        </Link>
      }
    />
  )
}

/** Route-level error boundary (unexpected render errors, failed lazy chunks). */
export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title="Something went wrong"
        description={<span className="break-words">{message}</span>}
        action={
          <>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Reload
            </button>
            <a href="/" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Go home
            </a>
          </>
        }
      />
    </div>
  )
}
