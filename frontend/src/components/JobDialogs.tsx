import { useId, useState, type FormEvent } from 'react'
import { useMeta } from '../context/meta'
import type { AnalyzeRequest, SyncRequest } from '../types'
import { Button } from './ui/Button'
import { ErrorMessage } from './ui/States'
import { Modal } from './ui/Modal'

const clampInt = (raw: string, min: number, max: number) => {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN
}

export function SyncDialog({
  open,
  onClose,
  onStart,
}: {
  open: boolean
  onClose: () => void
  onStart: (body: SyncRequest) => Promise<void>
}) {
  const maxId = useId()
  const daysId = useId()
  const [maxReviews, setMaxReviews] = useState('1000')
  const [limitDays, setLimitDays] = useState(false)
  const [days, setDays] = useState('30')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const maxValid = /^\d+$/.test(maxReviews) && Number(maxReviews) >= 10 && Number(maxReviews) <= 20000
  const daysValid = !limitDays || (/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!maxValid || !daysValid) return
    setSubmitting(true)
    setError(null)
    try {
      await onStart({
        max_reviews: clampInt(maxReviews, 10, 20000),
        since_days: limitDays ? clampInt(days, 1, 3650) : null,
      })
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Collect reviews"
      description="Fetch the newest reviews from Google Play. Reviews already stored are updated, not duplicated."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={maxId} className="label">
            Maximum reviews to fetch
          </label>
          <input
            id={maxId}
            type="number"
            inputMode="numeric"
            min={10}
            max={20000}
            step={10}
            required
            className="input"
            value={maxReviews}
            onChange={(e) => setMaxReviews(e.target.value)}
            aria-invalid={!maxValid}
            aria-describedby={`${maxId}-hint`}
          />
          <p id={`${maxId}-hint`} className={`mt-1 text-xs ${maxValid ? 'text-slate-500' : 'text-red-600'}`}>
            Between 10 and 20,000. Larger collections take longer (Play Store rate limits apply).
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">Time window</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={limitDays}
              onChange={(e) => setLimitDays(e.target.checked)}
            />
            Only collect reviews from the last N days
          </label>
          {limitDays && (
            <div className="pl-6">
              <label htmlFor={daysId} className="label">
                Number of days
              </label>
              <input
                id={daysId}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                className="input max-w-32"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-invalid={!daysValid}
              />
              {!daysValid && <p className="mt-1 text-xs text-red-600">Enter a number between 1 and 3,650.</p>}
            </div>
          )}
        </fieldset>

        {error !== null && <ErrorMessage error={error} title="Could not start collection" />}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting} disabled={!maxValid || !daysValid}>
            Start collecting
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function AnalyzeDialog({
  open,
  onClose,
  onStart,
  reviewCount,
}: {
  open: boolean
  onClose: () => void
  onStart: (body: AnalyzeRequest) => Promise<void>
  reviewCount: number
}) {
  const { meta } = useMeta()
  const daysId = useId()
  const [limitDays, setLimitDays] = useState(false)
  const [days, setDays] = useState('90')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const daysValid = !limitDays || (/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!daysValid) return
    setSubmitting(true)
    setError(null)
    try {
      await onStart({ window_days: limitDays ? clampInt(days, 1, 3650) : null })
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run analysis"
      description="Label sentiment and issue category for each review, group complaints into reported issues, summarize them and rank them by priority."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-600">
          {reviewCount > 0
            ? `${new Intl.NumberFormat('en-US').format(reviewCount)} collected reviews are available.`
            : 'No reviews have been collected yet — collect reviews first.'}
          {meta && (
            <>
              {' '}
              Summaries use{' '}
              <span className="font-medium text-slate-800">
                {meta.llm_provider === 'none' ? 'no LLM (keyword titles only)' : meta.llm_provider}
                {meta.llm_model ? ` · ${meta.llm_model}` : ''}
              </span>
              .
            </>
          )}
        </p>

        <fieldset className="space-y-2">
          <legend className="sr-only">Time window</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={limitDays}
              onChange={(e) => setLimitDays(e.target.checked)}
            />
            Only analyze reviews from the last N days
          </label>
          {limitDays && (
            <div className="pl-6">
              <label htmlFor={daysId} className="label">
                Number of days
              </label>
              <input
                id={daysId}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                className="input max-w-32"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-invalid={!daysValid}
              />
              {!daysValid && <p className="mt-1 text-xs text-red-600">Enter a number between 1 and 3,650.</p>}
            </div>
          )}
        </fieldset>

        {error !== null && <ErrorMessage error={error} title="Could not start analysis" />}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting} disabled={!daysValid || reviewCount === 0}>
            Start analysis
          </Button>
        </div>
      </form>
    </Modal>
  )
}
