import type { ReactNode } from 'react'

/** Small pill. Pass color classes (bg/text/ring) via className. */
export function Badge({
  className = 'bg-slate-100 text-slate-700 ring-slate-500/20',
  children,
  title,
}: {
  className?: string
  children: ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  )
}
