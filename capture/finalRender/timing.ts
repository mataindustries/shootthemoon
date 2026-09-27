/**
 * How long one final-render attempt at a clip may run before it is judged
 * pathologically slow — the Playwright test timeout capture/finalRender.spec.ts
 * sets, unless the CI orchestrator (capture/ci/renderGroup.mjs) passes a
 * smaller one via CAPTURE_FINAL_TIMEOUT_MS because its runner job has less
 * time left than that.
 *
 * This replaces a flat 30-minute test timeout. Run #4 (GitHub Actions run
 * 36305258099, 4 vCPU ubuntu-latest) showed healthy progress-event clips
 * needing 33-54 minutes (c04 c06 c07 c08 c09 c15 all timed out at 30 min
 * and only finished on a resumed attempt; c01 c02 c03 c10 c16 exhausted
 * three 30-minute attempts), while elapsed-ms clips finished in 2-23
 * minutes. A clip's cost is set by its frame count and source clock, so the
 * ceiling is derived from exactly those.
 *
 * A truly STUCK render never relies on this ceiling: every frame already has
 * its own watchdogs (capture/finalRender/engine.ts: frame-counter advance
 * <= 15s, screenshot <= 60/120s plus one 150s retry; capture/runner.ts's
 * exact sampler throws at once if no frame renders), so a wedged page fails
 * within minutes whatever this allows.
 */
import type { SourceWindow } from '../finalEdit.ts'
import type { FinalRenderJob } from './plan.ts'

export type SourceClock = SourceWindow['clock']

/** Fixed allowance per attempt: harness page load + reach (<= ~1 min
 * observed), the first frame's shader compile (engine.ts allows 120s + a
 * 150s retry) and context teardown. */
export const ATTEMPT_FIXED_ALLOWANCE_MS = 10 * 60_000

/**
 * Hard per-frame ceiling, by source clock: twice the worst run #4 AVERAGE
 * for that clock (not a typical frame) — beyond this a render is not
 * "slow", it is broken.
 *   progress   : c06 averaged 45.8 s/frame (72 frames, 55.0 min over two
 *                attempts, reach included); c02/c03/c10/c16 were >= 38
 *                s/frame (unfinished after 92 min)                -> 90 s
 *   elapsed-ms : c25 averaged 3.2 s/frame (432 frames, 22.8 min),
 *                c19 2.9 s/frame; exact sampling adds a few 1ms settle
 *                steps per frame                                  -> 20 s
 *   still      : one frame, covered by the fixed allowance         ->  0 s
 */
export const HARD_SEC_PER_FRAME: Readonly<Record<SourceClock, number>> = {
  progress: 90,
  'elapsed-ms': 20,
  still: 0,
}

/** The ceiling for one attempt that still has `framesToRender` frames of
 * `job` to capture. */
export function attemptCeilingMs(job: Pick<FinalRenderJob, 'source'>, framesToRender: number): number {
  return ATTEMPT_FIXED_ALLOWANCE_MS + Math.max(0, framesToRender) * HARD_SEC_PER_FRAME[job.source.clock] * 1000
}

/** The attempt timeout finalRender.spec.ts applies: an explicit
 * CAPTURE_FINAL_TIMEOUT_MS (the CI orchestrator's budget-capped value) when
 * set, else the derived ceiling. */
export function attemptTimeoutMs(
  job: Pick<FinalRenderJob, 'source'>,
  framesToRender: number,
  envValue: string | undefined,
): number {
  if (envValue !== undefined && envValue !== '') {
    const explicit = Number(envValue)
    if (!Number.isFinite(explicit) || explicit <= 0) {
      throw new Error(`CAPTURE_FINAL_TIMEOUT_MS must be a positive number of milliseconds, got "${envValue}"`)
    }
    return Math.round(explicit)
  }
  return attemptCeilingMs(job, framesToRender)
}

/**
 * Whether a clip must be (re)rendered in a single page session rather than
 * resumed index by index. Progress-event frames are pinned by their
 * dispatched progress value, so a frame rendered in a later attempt shows
 * the same moment it would have in the first. An elapsed-ms clip's timeline
 * is anchored by its reach (e.g. c19's octogonal-fire moment), and that
 * anchor lands up to one requestAnimationFrame grid step (16ms of source
 * time, ~3 frames of c19's 5.6ms spacing) differently from one page session
 * to the next — measured: c19's first sample landed at wave-phase
 * 5352-5360ms across five sessions. Splicing frames from two sessions would
 * put a visible stutter in a slow-motion clip, so an incomplete elapsed-ms
 * clip is always re-rendered whole (they are cheap: 2-23 min).
 */
export function rendersInOneSession(job: Pick<FinalRenderJob, 'source'>): boolean {
  return job.source.clock === 'elapsed-ms'
}
