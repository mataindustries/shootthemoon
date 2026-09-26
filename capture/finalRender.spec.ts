/**
 * The full final render: every selected clip, at its exact approved
 * capture/finalEdit.json window, true 60fps, real frames only. Resumable
 * (Phase C) and storage-gated (Phase D).
 *
 * Never invoke this directly without meaning to start the multi-hour run —
 * it refuses to do any work unless CAPTURE_FINAL_CONFIRM=RUN_FULL_RENDER is
 * set, which only capture/finalRender.mjs (the documented entry point) sets.
 * A bare `npx playwright test .../finalRender.spec.ts` (or a run that
 * happens to sweep up this file) skips every test instantly instead of
 * rendering anything.
 *
 * Filter with CAPTURE_FINAL_CLIP / CAPTURE_FINAL_ACT / CAPTURE_FINAL_PROFILE
 * (set by capture/finalRender.mjs's --clip/--act/--profile/--all).
 * CAPTURE_FINAL_FORCE=1 re-renders a clip even if already marked complete.
 */
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { test } from '@playwright/test'
import { type FinalEdit, type ShotIndexEntry } from './finalEdit.ts'
import { captureFinalRenderJob } from './finalRender/engine.ts'
import { buildFinalRenderJobs, type FinalRenderJob } from './finalRender/plan.ts'
import {
  directorySizeBytes,
  indicesNeedingRender,
  isFullyValid,
  isJobComplete,
  jobFrameDir,
  jobOutputDir,
  markJobComplete,
  validateJobFrames,
  writeJobMetadata,
  FINAL_RENDER_OUTPUT_ROOT,
  type RenderJobMetadata,
} from './finalRender/resume.ts'
import { buildFinalRenderSummary, formatFinalRenderSummary, type JobRunOutcome } from './finalRender/summary.ts'
import { checkStoragePreflight, estimateStorage } from './finalRender/storage.ts'
import { applyHudVisibility, preparePage } from './initCapture.ts'
import { SHOTS } from './manifest.ts'
import { PROFILES } from './profiles.ts'

const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const shotIndex: ShotIndexEntry[] = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const allJobs = buildFinalRenderJobs(edit, shotIndex)

function matchesEnvFilter(job: FinalRenderJob): boolean {
  const clip = process.env.CAPTURE_FINAL_CLIP
  const act = process.env.CAPTURE_FINAL_ACT
  const profile = process.env.CAPTURE_FINAL_PROFILE
  if (clip !== undefined && job.jobId !== clip) return false
  if (act !== undefined && job.act !== act) return false
  if (profile !== undefined && job.profile !== profile) return false
  return true
}

const selectedJobs = allJobs.filter(matchesEnvFilter)
const outcomes: JobRunOutcome[] = []
const runStartedAtMs = Date.now()
const forceRerender = process.env.CAPTURE_FINAL_FORCE === '1'

function metadataFor(job: FinalRenderJob, startedAtMs: number, extra: Partial<RenderJobMetadata>): RenderJobMetadata {
  return {
    jobId: job.jobId,
    shotId: job.shotId,
    profile: job.profile,
    expectedFrames: job.frames,
    renderedFrames: 0,
    status: 'in-progress',
    startedAtIso: new Date(startedAtMs).toISOString(),
    updatedAtIso: new Date().toISOString(),
    completedAtIso: null,
    error: null,
    ...extra,
  }
}

test.describe('final render — full locked-cut render', () => {
  test.beforeAll(async () => {
    if (process.env.CAPTURE_FINAL_CONFIRM !== 'RUN_FULL_RENDER') {
      test.skip(
        true,
        'The full final render requires CAPTURE_FINAL_CONFIRM=RUN_FULL_RENDER, only set by ' +
          'capture/finalRender.mjs. This prevents an accidental multi-hour render from a bare test run.',
      )
      return
    }
    await mkdir(FINAL_RENDER_OUTPUT_ROOT, { recursive: true })
    const estimate = estimateStorage(selectedJobs)
    const preflight = await checkStoragePreflight(estimate.estimatedBytes, FINAL_RENDER_OUTPUT_ROOT)
    console.log(
      `[final-render] plan: ${selectedJobs.length} job(s), ${estimate.frames} frame(s), ` +
        `~${(estimate.estimatedBytes / 1e9).toFixed(2)} GB estimated`,
    )
    if (!preflight.ok) {
      throw new Error(`Storage preflight refused to start:\n${preflight.reasons.join('\n')}`)
    }
  })

  for (const job of selectedJobs) {
    test(`${job.jobId} ${job.shotId} [${job.act}/${job.profile}]`, async ({ browser }) => {
      test.setTimeout(30 * 60_000)
      const jobStartedAtMs = Date.now()
      const frameDir = jobFrameDir(job)

      if (!forceRerender && (await isJobComplete(job))) {
        outcomes.push({
          job,
          status: 'skipped-existing',
          framesRendered: job.frames,
          bytesOnDisk: await directorySizeBytes(jobOutputDir(job)),
          elapsedMs: 0,
          error: null,
        })
        test.skip(true, `${job.jobId} is already complete (resume) — pass --force to re-render.`)
        return
      }

      const validationBefore = await validateJobFrames(job)
      const indicesToRender = indicesNeedingRender(validationBefore)

      let outcome: JobRunOutcome
      let thrown: Error | null = null
      try {
        if (indicesToRender.length > 0) {
          const shot = SHOTS.find((candidate) => candidate.id === job.shotId)
          if (shot === undefined) throw new Error(`Shot "${job.shotId}" not found in manifest.`)
          const profile = PROFILES[job.profile]

          await writeJobMetadata(
            job,
            metadataFor(job, jobStartedAtMs, { renderedFrames: job.frames - indicesToRender.length }),
          )

          const context = await browser.newContext({
            viewport: { width: profile.cssWidth, height: profile.cssHeight },
            deviceScaleFactor: profile.deviceScaleFactor,
            isMobile: profile.isMobile,
            hasTouch: profile.hasTouch,
            reducedMotion: 'no-preference',
            ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
          })
          try {
            const page = await context.newPage()
            await preparePage(page, {
              profile,
              fixture: shot.fixture,
              ...(shot.beforeGoto ? { beforeGoto: shot.beforeGoto } : {}),
            })
            await applyHudVisibility(page, shot.hud)
            await captureFinalRenderJob(page, job, frameDir, { indices: indicesToRender })
          } finally {
            await context.close()
          }
        }

        const validationAfter = await validateJobFrames(job)
        const bytesOnDisk = await directorySizeBytes(jobOutputDir(job))
        const elapsedMs = Date.now() - jobStartedAtMs

        if (isFullyValid(job, validationAfter)) {
          await markJobComplete(job, metadataFor(job, jobStartedAtMs, { renderedFrames: job.frames }))
          outcome = { job, status: 'complete', framesRendered: job.frames, bytesOnDisk, elapsedMs, error: null }
        } else {
          const problem =
            `missing=${validationAfter.missingIndices.length} ` +
            `corrupt=${validationAfter.corruptIndices.length} ` +
            `duplicate=${validationAfter.duplicateIndices.length}`
          await writeJobMetadata(
            job,
            metadataFor(job, jobStartedAtMs, {
              renderedFrames: validationAfter.validIndices.size,
              status: 'failed',
              error: problem,
            }),
          )
          outcome = { job, status: 'incomplete', framesRendered: validationAfter.validIndices.size, bytesOnDisk, elapsedMs, error: problem }
          thrown = new Error(`${job.jobId}: ${problem}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeJobMetadata(job, metadataFor(job, jobStartedAtMs, { status: 'failed', error: message }))
        outcome = {
          job,
          status: 'failed',
          framesRendered: 0,
          bytesOnDisk: await directorySizeBytes(jobOutputDir(job)).catch(() => 0),
          elapsedMs: Date.now() - jobStartedAtMs,
          error: message,
        }
        thrown = error instanceof Error ? error : new Error(message)
      }

      outcomes.push(outcome)
      // One failed/incomplete clip must not stop the rest: this describe
      // block is deliberately not .serial (see capture/capture.spec.ts's own
      // comment), so re-throwing here only fails THIS test, and the runner
      // moves on to the next clip.
      if (thrown) throw thrown
    })
  }

  test.afterAll(() => {
    if (outcomes.length === 0) return
    console.log(formatFinalRenderSummary(buildFinalRenderSummary(outcomes, Date.now() - runStartedAtMs)))
  })
})
