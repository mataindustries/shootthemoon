/**
 * Aggregates per-job outcomes from a final-render run into the clear
 * complete/incomplete/failed summary Phase C asks for.
 */
import type { FinalRenderJob } from './plan.ts'

export type JobOutcomeStatus = 'complete' | 'incomplete' | 'failed' | 'skipped-existing'

export interface JobRunOutcome {
  readonly job: FinalRenderJob
  readonly status: JobOutcomeStatus
  readonly framesRendered: number
  readonly bytesOnDisk: number
  readonly elapsedMs: number
  readonly error: string | null
}

export interface FinalRenderSummary {
  readonly totalJobs: number
  readonly complete: number
  readonly incomplete: number
  readonly failed: number
  readonly framesRendered: number
  readonly bytesOnDisk: number
  readonly elapsedMs: number
  readonly outcomes: readonly JobRunOutcome[]
}

export function buildFinalRenderSummary(outcomes: readonly JobRunOutcome[], elapsedMs: number): FinalRenderSummary {
  const isDone = (status: JobOutcomeStatus) => status === 'complete' || status === 'skipped-existing'
  return {
    totalJobs: outcomes.length,
    complete: outcomes.filter((outcome) => isDone(outcome.status)).length,
    incomplete: outcomes.filter((outcome) => outcome.status === 'incomplete').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    framesRendered: outcomes.reduce((sum, outcome) => sum + outcome.framesRendered, 0),
    bytesOnDisk: outcomes.reduce((sum, outcome) => sum + outcome.bytesOnDisk, 0),
    elapsedMs,
    outcomes,
  }
}

export function formatFinalRenderSummary(summary: FinalRenderSummary): string {
  const gb = (bytes: number) => (bytes / 1e9).toFixed(2)
  const minutes = (ms: number) => (ms / 60_000).toFixed(1)
  const lines = [
    'Final render summary',
    `  jobs: ${summary.totalJobs} (complete ${summary.complete}, incomplete ${summary.incomplete}, failed ${summary.failed})`,
    `  frames rendered: ${summary.framesRendered}`,
    `  disk consumed: ${gb(summary.bytesOnDisk)} GB`,
    `  elapsed: ${minutes(summary.elapsedMs)} min`,
  ]
  for (const outcome of summary.outcomes) {
    if (outcome.status === 'incomplete' || outcome.status === 'failed') {
      lines.push(`  [${outcome.status}] ${outcome.job.jobId} (${outcome.job.shotId})${outcome.error ? `: ${outcome.error}` : ''}`)
    }
  }
  return lines.join('\n')
}
