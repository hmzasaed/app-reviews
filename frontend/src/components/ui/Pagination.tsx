import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '../../lib/format'
import { Button } from './Button'

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  disabled,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  disabled?: boolean
}) {
  if (total === 0) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p className="tabular">
        Showing <span className="font-medium text-slate-900">{formatNumber(from)}</span>–
        <span className="font-medium text-slate-900">{formatNumber(to)}</span> of{' '}
        <span className="font-medium text-slate-900">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={disabled || page <= 1}
          icon={<ChevronLeft className="size-4" aria-hidden />}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <span className="tabular text-xs text-slate-500">
          Page {formatNumber(page)} / {formatNumber(pages)}
        </span>
        <Button size="sm" onClick={() => onChange(page + 1)} disabled={disabled || page >= pages} aria-label="Next page">
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}
