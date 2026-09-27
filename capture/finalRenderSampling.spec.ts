/**
 * Real-browser regression for run #4's c19 (divider-weapon-volley) failure:
 * "missing=0 corrupt=0 duplicate=24" after three attempts (68 and 42 before
 * that). Renders c19 exactly as the final render does — its real reach, its
 * real 108-frame final-render density (80..680ms of source time, 5.607ms
 * apart), the unchanged engine and 4K PLATE profile — into a scratch
 * directory, then asserts what the fix guarantees:
 *
 *   1. every frame rendered AT its requested source time (whole-ms tick
 *      rounding only), in strictly increasing order — run #4's sampler
 *      rendered on the next 16ms requestAnimationFrame grid point instead,
 *      then on the next 80ms simulation tick once the volley ended, and
 *      finished at +5952ms for a +680ms request;
 *   2. no two adjacent frames are byte-identical — the same frozen-frame rule
 *      capture/finalRender/resume.ts enforces, unrelaxed.
 *
 * ~5 minutes on a 4 vCPU machine. Run explicitly:
 *   npx playwright test --config=capture/playwright.capture.config.ts \
 *     capture/finalRenderSampling.spec.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { type FinalEdit, type ShotIndexEntry } from './finalEdit.ts'
import { captureFinalRenderJob } from './finalRender/engine.ts'
import { buildFinalRenderJobs } from './finalRender/plan.ts'
import { attemptCeilingMs } from './finalRender/timing.ts'
import { applyHudVisibility, preparePage } from './initCapture.ts'
import { SHOTS } from './manifest.ts'
import { PROFILES } from './profiles.ts'
import { frameFilename } from './runner.ts'

const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const shotIndex: ShotIndexEntry[] = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))

test('c19 at its real 108-frame density: exact source times, no frozen frames', async ({ browser }, testInfo) => {
  const job = buildFinalRenderJobs(edit, shotIndex).find((candidate) => candidate.jobId === 'c19')!
  expect(job.frames).toBe(108)
  expect(job.source).toEqual({ clock: 'elapsed-ms', origin: 'octogonal-fire', inMs: 80, outMs: 680 })
  test.setTimeout(attemptCeilingMs(job, job.frames))

  const shot = SHOTS.find((candidate) => candidate.id === job.shotId)!
  const profile = PROFILES[job.profile]
  const frameDir = testInfo.outputPath('frames')
  await rm(frameDir, { recursive: true, force: true })
  const context = await browser.newContext({
    viewport: { width: profile.cssWidth, height: profile.cssHeight },
    deviceScaleFactor: profile.deviceScaleFactor,
    reducedMotion: 'no-preference',
  })
  try {
    const page = await context.newPage()
    await preparePage(page, { profile, fixture: shot.fixture, ...(shot.beforeGoto ? { beforeGoto: shot.beforeGoto } : {}) })
    await applyHudVisibility(page, shot.hud)
    const result = await captureFinalRenderJob(page, job, frameDir)

    expect(result.frameOutcomes).toHaveLength(108)
    let previous = -Infinity
    for (const outcome of result.frameOutcomes) {
      const { index, requestedSource, renderedSourceMs } = outcome
      expect(renderedSourceMs, `frame ${index}`).toBeDefined()
      expect(renderedSourceMs! - requestedSource!, `frame ${index}`).toBeGreaterThanOrEqual(0)
      expect(renderedSourceMs! - requestedSource!, `frame ${index}`).toBeLessThan(1)
      expect(renderedSourceMs!, `frame ${index}`).toBeGreaterThan(previous)
      previous = renderedSourceMs!
    }
    // First and last land on the approved window's bounds (within the
    // fake clock's whole-ms tick), not ~16ms / ~5s past them.
    expect(result.frameOutcomes[0]!.renderedSourceMs! - 80).toBeLessThan(1)
    expect(result.frameOutcomes[107]!.renderedSourceMs! - 680).toBeLessThan(1)

    const hashes = await Promise.all(
      Array.from({ length: job.frames }, async (_, index) =>
        createHash('sha1').update(await readFile(path.join(frameDir, frameFilename(index)))).digest('hex'),
      ),
    )
    const duplicates = hashes.flatMap((hash, index) => (index > 0 && hash === hashes[index - 1] ? [index] : []))
    expect(duplicates, `byte-identical adjacent frames at ${duplicates.join(',')}`).toEqual([])
  } finally {
    await context.close()
  }
})
