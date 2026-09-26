/**
 * Generic capture runner: iterates the typed manifest (capture/manifest.ts)
 * and drives every shot through the same setup → capture → metadata
 * pipeline. Adding a shot to SHOTS is the only change needed to expand
 * coverage — nothing here is shot-specific.
 */
import path from 'node:path'
import { test } from '@playwright/test'
import { applyHudVisibility, preparePage } from './initCapture.ts'
import { SHOTS } from './manifest.ts'
import { PROFILES } from './profiles.ts'
import { assertCleanWebGl, CAPTURE_OUTPUT_ROOT, writeCaptureMetadata } from './runner.ts'

// Deliberately NOT describe.serial: each shot gets its own fresh browser
// context and fixture, so shots are independent. describe.serial would
// abort every remaining shot after the first failure (Playwright's default
// serial-mode behavior) — undesirable here, where we want one full pass
// across all shots reported every run. Single-worker sequential execution
// (never overlapping a 4K SwiftShader render with another) already comes
// from the config's `workers: 1` / `fullyParallel: false`.
test.describe('capture reel — phase 1 proof shots', () => {
  for (const shot of SHOTS) {
    test(shot.id, async ({ browser }) => {
      test.setTimeout(180_000)
      const profile = PROFILES[shot.profile]
      const outDir = path.join(CAPTURE_OUTPUT_ROOT, shot.id)

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
        const prepared = await preparePage(page, {
          profile,
          fixture: shot.fixture,
          ...(shot.beforeGoto ? { beforeGoto: shot.beforeGoto } : {}),
        })

        await applyHudVisibility(page, shot.hud)

        const outcome = await shot.run(page, outDir)

        await assertCleanWebGl(page, prepared.errors)

        await writeCaptureMetadata(outDir, {
          shotId: shot.id,
          name: shot.name,
          profile: shot.profile,
          cssViewport: { width: profile.cssWidth, height: profile.cssHeight },
          deviceScaleFactor: profile.deviceScaleFactor,
          actualBufferSize: prepared.actualBuffer,
          expectedDpr: prepared.expectedBuffer.dpr,
          requestedFps: outcome.fps,
          startMs: outcome.startMs,
          endMs: outcome.endMs,
          frameCount: outcome.frameCount,
          frameFilenames: outcome.frameFilenames,
          fixture: shot.fixture,
          hudMode: shot.hud.mode,
          clockMode: outcome.clockMode,
          fontReport: prepared.fontReport,
          pageErrors: prepared.errors.page,
          consoleErrors: prepared.errors.console,
          nudgedFrames: outcome.nudgedFrames,
          notes: shot.notes,
        })

        console.log(
          `[capture] ${shot.id}: ${outcome.frameCount} frame(s), ` +
            `${prepared.actualBuffer.width}x${prepared.actualBuffer.height} buffer, ` +
            `fixture=${shot.fixture}, hud=${shot.hud.mode}`,
        )
      } finally {
        await context.close()
      }
    })
  }
})
