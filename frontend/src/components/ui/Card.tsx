import type { ReactNode } from 'react'

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-xs ${className}`}>{children}</section>
}

export function CardHeader({
  title,
  description,
  actions,
  id,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  id?: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`px-4 py-4 sm:px-5 ${className}`}>{children}</div>
}
