/**
 * The final-render capture loop: for one job (capture/finalRender/plan.ts),
 * drives its reach handle (capture/finalRender/reach.ts) across the exact
 * approved capture/finalEdit.json window and writes one real, uncropped-only
 * -at-the-source PNG per requested frame index. Reuses runner.ts's own
 * frame-counter guard (never silently duplicate a frame) and adds a
 * timeout/retry policy sized for the heaviest observed 4K SwiftShader
 * frames (Phase B prerequisite #3).
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PROFILES } from '../profiles.ts'
import { frameFilename, readFrameCount, waitForFrameCountAbove } from '../runner.ts'
import { frameProgressAt, interpolateCrop, sourceValueAt, toCssClip, type FinalRenderJob } from './plan.ts'
import { reachFinalRenderState } from './reach.ts'

/** Ceiling for an ordinary frame's screenshot readback. */
const SCREENSHOT_TIMEOUT_MS = 60_000
/** A clip's first captured frame often has to compile geometry/shaders
 * nothing earlier in the session instantiated (confirmed empirically: a 4K
 * DIVIDER volley frame took 71.5s, over the ordinary ceiling) — give it
 * more room before falling back to a retry. */
const FIRST_FRAME_SCREENSHOT_TIMEOUT_MS = 120_000
/** One retry, at an even more generous ceiling, before giving up on a frame
 * entirely. A single slow frame must not corrupt or duplicate the
 * sequence: screenshots are written to a temp path and only renamed onto
 * the real filename after they fully land, so a timed-out attempt never
 * leaves a partial/corrupt PNG at the frame's real path — Phase C's resume
 * validation then sees that index as simply missing, not broken. */
const SCREENSHOT_RETRY_TIMEOUT_MS = 150_000
/** Ceiling for waiting on the R3F frame counter to advance past a dispatch —
 * generous for the same reason FIRST_FRAME_SCREENSHOT_TIMEOUT_MS is. */
const FRAME_ADVANCE_TIMEOUT_MS = 15_000

async function screenshotAtomic(
  page: Page,
  filePath: string,
  clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  timeoutMs: number,
): Promise<void> {
  // The temp path deliberately keeps a .png suffix (not just filename.tmp):
  // Playwright's screenshot() infers the image MIME type from `path`'s
  // extension, and a bare `.tmp` extension fails with "unsupported mime
  // type null" — confirmed empirically, not a guess.
  const tmpPath = `${filePath}.tmp.png`
  await page.screenshot({ path: tmpPath, type: 'png', clip, timeout: timeoutMs })
  await rename(tmpPath, filePath)
}

async function screenshotWithRetry(
  page: Page,
  filePath: string,
  clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  isFirstFrame: boolean,
): Promise<{ readonly retried: boolean }> {
  const firstTimeout = isFirstFrame ? FIRST_FRAME_SCREENSHOT_TIMEOUT_MS : SCREENSHOT_TIMEOUT_MS
  try {
    await screenshotAtomic(page, filePath, clip, firstTimeout)
    return { retried: false }
  } catch (firstError) {
    try {
      await screenshotAtomic(page, filePath, clip, SCREENSHOT_RETRY_TIMEOUT_MS)
      return { retried: true }
    } catch (retryError) {
      await rm(`${filePath}.tmp.png`, { force: true })
      const message = retryError instanceof Error ? retryError.message : String(retryError)
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
      throw new Error(`Screenshot failed twice for ${filePath}: first="${firstMessage}" retry="${message}"`)
    }
  }
}

export interface FrameCaptureOutcome {
  readonly index: number
  readonly filename: string
  readonly tookMs: number
  readonly retried: boolean
}

export interface JobCaptureResult {
  readonly jobId: string
  readonly frameOutcomes: readonly FrameCaptureOutcome[]
}

/**
 * Captures exactly the requested frame `indices` of `job` (all of them, by
 * default) into `frameDir`. Assumes the caller has already run
 * preparePage()/applyHudVisibility() for the job's shot — this function only
 * runs the shot's reach (setup) and then samples its window.
 *
 * Indices not in the requested set are never visited at all (not even their
 * `advance()` call): both stepping mechanisms this codebase uses — a direct
 * progress-event dispatch, and Playwright's fake clock stepped forward via
 * `advanceTo` — are safe to jump to an arbitrary target without having
 * visited every intermediate value, which is what makes resuming a partial
 * clip (Phase C) cheap: only the missing/invalid indices are re-driven.
 */
export async function captureFinalRenderJob(
  page: Page,
  job: FinalRenderJob,
  frameDir: string,
  options: { readonly indices?: readonly number[] } = {},
): Promise<JobCaptureResult> {
  await mkdir(frameDir, { recursive: true })
  const reach = await reachFinalRenderState(page, job.shotId)
  const deviceScaleFactor = PROFILES[job.profile].deviceScaleFactor
  const indices = options.indices ?? Array.from({ length: job.frames }, (_, index) => index)
  const frameOutcomes: FrameCaptureOutcome[] = []

  if (reach.clock === 'still') {
    await page.waitForTimeout(160)
    for (const index of indices) {
      const startedAt = Date.now()
      const filename = frameFilename(index)
      const clip = toCssClip(job.crop, deviceScaleFactor)
      const { retried } = await screenshotWithRetry(page, path.join(frameDir, filename), clip, index === 0)
      frameOutcomes.push({ index, filename, tookMs: Date.now() - startedAt, retried })
    }
    return { jobId: job.jobId, frameOutcomes }
  }

  const advance = reach.advance
  let previousFrameCount = await readFrameCount(page)
  for (const index of indices) {
    const t = frameProgressAt(index, job.frames)
    const value = sourceValueAt(job.source, t)
    const beforeStep = previousFrameCount
    const startedAt = Date.now()
    await advance(value)

    const currentFrameCount = await waitForFrameCountAbove(page, beforeStep, FRAME_ADVANCE_TIMEOUT_MS)
    if (Number.isNaN(currentFrameCount) || currentFrameCount <= beforeStep) {
      throw new Error(
        `${job.jobId} (${job.shotId}) frame ${index}: frame counter stalled at ${beforeStep} ` +
          `within ${FRAME_ADVANCE_TIMEOUT_MS}ms (value=${value}).`,
      )
    }
    previousFrameCount = currentFrameCount

    const crop = interpolateCrop(job.crop, job.cropEnd, t)
    const clip = toCssClip(crop, deviceScaleFactor)
    const filename = frameFilename(index)
    const { retried } = await screenshotWithRetry(page, path.join(frameDir, filename), clip, index === 0)
    frameOutcomes.push({ index, filename, tookMs: Date.now() - startedAt, retried })
  }
  return { jobId: job.jobId, frameOutcomes }
}
