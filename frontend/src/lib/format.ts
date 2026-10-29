/**
 * Formatting helpers. The backend sends naive UTC datetimes ("2026-10-20T11:20:00"),
 * so they must be parsed as UTC explicitly — `new Date()` would treat them as local time.
 */

const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parse a backend datetime (UTC without suffix) or ISO date into a Date. */
export function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  let iso = value.trim()
  if (DATE_ONLY.test(iso)) iso = `${iso}T00:00:00Z`
  else if (!HAS_TZ.test(iso)) iso = `${iso.replace(' ', 'T')}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const numberFmt = new Intl.NumberFormat('en-US')
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const weekFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const weekLongFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const relativeFmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

/** 12345 -> "12,345". */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return numberFmt.format(value)
}

/** 12345 -> "12.3K" (for axis ticks). */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return compactFmt.format(value)
}

/** Share in 0..1 -> "42.5%" (0–1 decimals). */
export function formatPercent(share: number | null | undefined, maxDecimals = 1): string {
  if (share === null || share === undefined || Number.isNaN(share)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(share)
}

/** 4.234 -> "4.2". */
export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(1)
}

/** Priority score -> "72.4". */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(1)
}

/** "Oct 20, 2026" in the viewer's local timezone. */
export function formatDate(value: string | null | undefined): string {
  const date = parseUtc(value)
  return date ? dateFmt.format(date) : '—'
}

/** "Oct 20, 2026, 11:20 AM" in the viewer's local timezone. */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseUtc(value)
  return date ? dateTimeFmt.format(date) : '—'
}

/** Week-start ISO date -> "Oct 12" (calendar date, no timezone shift). */
export function formatWeek(value: string): string {
  const date = parseUtc(value)
  return date ? weekFmt.format(date) : value
}

/** ISO calendar date ("2026-10-12") -> "Oct 12, 2026" (no timezone shift). */
export function formatCalendarDate(value: string | null | undefined): string {
  const date = parseUtc(value)
  return date ? weekLongFmt.format(date) : (value ?? '—')
}

/** Week-start ISO date -> "Week of Oct 12, 2026". */
export function formatWeekLong(value: string): string {
  const date = parseUtc(value)
  return date ? `Week of ${weekLongFmt.format(date)}` : value
}

/** "3 hours ago", "yesterday", "in 2 days". */
export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  const date = parseUtc(value)
  if (!date) return '—'
  const seconds = Math.round((date.getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ]
  let unit: Intl.RelativeTimeFormatUnit = 'minute'
  let divisor = 60
  for (const [u, d] of units) {
    if (abs >= d) {
      unit = u
      divisor = d
    }
  }
  return relativeFmt.format(Math.round(seconds / divisor), unit)
}

/** "crash_stability" -> "Crash stability". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  const text = value.replace(/[_-]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

/** Compare dotted version strings numerically ("5.10.0" > "5.9.2"); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-_]/)
  const pb = b.split(/[.\-_]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const nx = Number(x)
    const ny = Number(y)
    const diff = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y)
    if (diff !== 0) return diff
  }
  return 0
}
