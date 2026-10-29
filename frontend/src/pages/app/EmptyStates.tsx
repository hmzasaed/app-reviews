import { DownloadCloud, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState, Notice } from '../../components/ui/States'
import { formatNumber } from '../../lib/format'
import { useAppOutlet } from './appContext'

/** Shown when the app has no collected reviews yet. */
export function NoReviewsState() {
  const { openSync, jobActive } = useAppOutlet()
  return (
    <EmptyState
      icon={<DownloadCloud className="size-6" aria-hidden />}
      title="No reviews collected yet"
      description="Start by collecting reviews from Google Play. Once they're in, run an analysis to find reported issues and rank what to fix first."
      action={
        <Button variant="primary" onClick={openSync} disabled={jobActive}>
          {jobActive ? 'A job is running…' : 'Collect reviews'}
        </Button>
      }
    />
  )
}

/** Shown when reviews exist but no analysis has been run. */
export function NotAnalyzedState({ reviewCount }: { reviewCount: number }) {
  const { openAnalyze, jobActive } = useAppOutlet()
  return (
    <EmptyState
      icon={<Sparkles className="size-6" aria-hidden />}
      title="Reviews collected — analysis not run yet"
      description={`${formatNumber(reviewCount)} reviews are ready. Run an analysis to label sentiment and categories, group complaints into reported issues and rank them by priority.`}
      action={
        <Button variant="primary" onClick={openAnalyze} disabled={jobActive}>
          {jobActive ? 'A job is running…' : 'Run analysis'}
        </Button>
      }
    />
  )
}

/** Compact banner version for pages that still show partial (rating-only) data. */
export function NotAnalyzedNotice() {
  const { openAnalyze, jobActive } = useAppOutlet()
  return (
    <Notice
      tone="info"
      icon={<Sparkles className="size-4 text-indigo-600" aria-hidden />}
      title="Analysis not run yet"
      action={
        <Button size="sm" variant="primary" onClick={openAnalyze} disabled={jobActive}>
          Run analysis
        </Button>
      }
    >
      Ratings are shown below, but sentiment, categories and reported issues appear only after an analysis run.
    </Notice>
  )
}
