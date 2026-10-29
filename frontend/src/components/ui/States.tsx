import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError, errorMessage } from '../../api/client'
import { Button } from './Button'

export function Spinner({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 py-10 text-sm text-slate-500 ${className}`}>
      <Loader2 className="size-5 animate-spin text-indigo-500" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

/** Shimmering placeholder block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />
}

/** Friendly rendering of an API error (FastAPI `detail` string or validation list). */
export function ErrorMessage({
  error,
  title = 'Something went wrong',
  onRetry,
  className = '',
}: {
  error: unknown
  title?: string
  onRetry?: () => void
  className?: string
}) {
  const lines = error instanceof ApiError ? error.messages : [errorMessage(error)]
  return (
    <div role="alert" className={`rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {lines.length === 1 ? (
            <p className="mt-1 break-words text-red-700">{lines[0]}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-700">
              {lines.map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {onRetry && (
            <Button size="sm" className="mt-3" onClick={onRetry} icon={<RotateCw className="size-3.5" aria-hidden />}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center ${className}`}
    >
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <div className="mt-1 max-w-md text-sm text-slate-500">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

const NOTICE_TONES = {
  info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
}

export function Notice({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className = '',
}: {
  tone?: keyof typeof NOTICE_TONES
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm ${NOTICE_TONES[tone]} ${className}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1 basis-48">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
