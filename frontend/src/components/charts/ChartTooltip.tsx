import type { ReactNode } from 'react'

export interface TooltipEntry {
  name?: unknown
  value?: unknown
  color?: string
  fill?: string
  stroke?: string
  dataKey?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any
}

export interface TooltipRenderProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipEntry>
  label?: string | number
}

interface TooltipOptions {
  labelFormatter?: (label: string, row: Record<string, unknown> | undefined) => ReactNode
  valueFormatter?: (value: number, name: string, entry: TooltipEntry) => ReactNode
  /** Extra line(s) under the series rows, computed from the hovered datum. */
  footer?: (row: Record<string, unknown>) => ReactNode
  /** Reverse series order (stacked bars read top-down). */
  reverse?: boolean
}

/** Factory for a consistent Recharts tooltip: `content={chartTooltip({...})}`. */
export function chartTooltip(options: TooltipOptions = {}) {
  return function ChartTooltipContent({ active, payload, label }: TooltipRenderProps) {
    if (!active || !payload || payload.length === 0) return null
    const row = payload[0]?.payload as Record<string, unknown> | undefined
    const entries = options.reverse ? [...payload].reverse() : payload
    return (
      <div className="min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
        {label !== undefined && label !== '' && (
          <p className="mb-1.5 font-semibold text-slate-900">
            {options.labelFormatter ? options.labelFormatter(String(label), row) : String(label)}
          </p>
        )}
        <ul className="space-y-1">
          {entries.map((entry, i) => {
            const name = String(entry.name ?? entry.dataKey ?? '')
            const color = entry.color ?? entry.fill ?? entry.stroke
            const numeric = typeof entry.value === 'number' ? entry.value : Number(entry.value)
            return (
              <li key={`${name}-${i}`} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-slate-600">
                  {color && <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />}
                  {name}
                </span>
                <span className="tabular font-medium text-slate-900">
                  {options.valueFormatter ? options.valueFormatter(numeric, name, entry) : String(entry.value)}
                </span>
              </li>
            )
          })}
        </ul>
        {options.footer && row && <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-slate-500">{options.footer(row)}</div>}
      </div>
    )
  }
}
