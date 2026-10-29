import type { ReactNode } from 'react'

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'alert'
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-xs ${tone === 'alert' ? 'border-red-200' : 'border-slate-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
