/**
 * Proof-frame mode (Phase B prerequisite #4): renders ONLY the first,
 * midpoint, and last frame of each selected final-render clip — the
 * mandatory, cheap gate before committing to the full ~6h SwiftShader
 * render. Filter with CAPTURE_FINAL_CLIP / CAPTURE_FINAL_ACT /
 * CAPTURE_FINAL_PROFILE (set by capture/finalRender.mjs's
 * --clip/--act/--profile/--all), or leave all three unset to proof every
 * selected clip.
 *
 * Run directly via:
 *   npx playwright test --config=capture/playwright.capture.config.ts \
 *     capture/finalRenderProof.spec.ts
 * or through the CLI wrapper (adds env-var filtering):
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --proof --all
 */
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from '@playwright/test'
import { isShotClip, type FinalEdit, type ShotIndexEntry } from './finalEdit.ts'
import { captureFinalRenderJob } from './finalRender/engine.ts'
import { buildFinalRenderJobs, type FinalRenderJob } from './finalRender/plan.ts'
import { jobOutputDir } from './finalRender/resume.ts'
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

/** first/mid/last, deduplicated (a 1- or 2-frame job doesn't need 3 copies). */
export function proofIndices(frames: number): number[] {
  const indices = [0, Math.floor((frames - 1) / 2), frames - 1]
  return [...new Set(indices)].filter((index) => index >= 0 && index < frames)
}

test.describe('final render — proof-frame gate', () => {
  for (const job of selectedJobs) {
    test(`${job.jobId} ${job.shotId} [${job.act}/${job.profile}]`, async ({ browser }) => {
      test.setTimeout(180_000)
      const shot = SHOTS.find((candidate) => candidate.id === job.shotId)
      if (shot === undefined) throw new Error(`Shot "${job.shotId}" not found in manifest.`)
      const profile = PROFILES[job.profile]
      const proofDir = path.join(jobOutputDir(job), 'proof', 'frames')
      await mkdir(proofDir, { recursive: true })

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

        const indices = proofIndices(job.frames)
        const result = await captureFinalRenderJob(page, job, proofDir, { indices })

        console.log(
          `[proof] ${job.jobId} (${job.shotId}): ${result.frameOutcomes.length}/${job.frames} frame(s) ` +
            `at ${proofDir} [${indices.join(',')}]`,
        )
      } finally {
        await context.close()
      }
    })
  }
})

test('plan sanity: every proof job traces back to a real timeline/derivative reference', () => {
  const referenced = new Set(edit.timeline.filter(isShotClip).map((clip) => clip.shotId))
  const { poster, stills, mobileScreenshots } = edit.derivatives
  for (const item of [poster, ...stills, ...mobileScreenshots]) referenced.add(item.shotId)
  for (const job of allJobs) {
    if (!referenced.has(job.shotId)) throw new Error(`Job ${job.jobId} references unreferenced shot ${job.shotId}`)
  }
})
