import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import { applyHudVisibility, preparePage, assertBufferMatches } from '../initCapture.ts'
import { captureFinalRenderJob } from '../finalRender/engine.ts'
import { SHOTS } from '../manifest.ts'
import { PROFILES } from '../profiles.ts'
import { assertCleanWebGl } from '../runner.ts'

test('Helios Spire: continuous reveal, charge, mass-driver fire and recovery', async ({ browser }) => {
  const shot = SHOTS.find((s) => s.id === 'helios-mechanical-peak')!
  // HUD's 1080p backing buffer, with the shot's existing hidden-HUD policy.
  // The game and camera remain the manifest shot's own MON_HELIOS_SPIRE setup.
  const profile = PROFILES.HUD
  const out = path.resolve('capture-final/youtube/captures/helios-mass-driver')
  const framesDir = path.join(out, 'frames')
  const captureStartedAtIso = new Date().toISOString()
  mkdirSync(framesDir, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: profile.cssWidth, height: profile.cssHeight },
    deviceScaleFactor: profile.deviceScaleFactor,
    reducedMotion: 'no-preference',
  })
  try {
    const page = await context.newPage()
    const prepared = await preparePage(page, { profile, fixture: shot.fixture, beforeGoto: shot.beforeGoto! })
    assertBufferMatches(prepared.actualBuffer, { width: 1920, height: 1080 }, 'YouTube Helios')
    await applyHudVisibility(page, shot.hud)
    const crop = { x: 0, y: 0, w: 1920, h: 1080 }
    const job = {
      jobId: 'youtube-helios-mass-driver', shotId: shot.id, profile: profile.id,
      act: 'MONUMENTS' as const, frames: 792, order: 0,
      // A continuous natural-rate pass. First fire at +4200ms. Ends before
      // the next fire (+16200ms); no replay or artificial looping.
      source: { clock: 'elapsed-ms' as const, origin: 'reveal-open', inMs: 300, outMs: 300 + 791 * 1000 / 60 },
      crop, cropEnd: crop,
    }
    const result = await captureFinalRenderJob(page, job, framesDir)
    await assertCleanWebGl(page, prepared.errors)
    const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
    const frames = result.frameOutcomes.map((f) => ({ ...f, sha256: hash(readFileSync(path.join(framesDir, f.filename))) }))
    writeFileSync(path.join(out, 'frames.sha256'), frames.map((f) => `${f.sha256}  frames/${f.filename}`).join('\n') + '\n')
    const file = path.join(out, 'helios-mass-driver-clean.mkv')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-i', path.join(framesDir, '%06d.png'),
      '-frames:v', '792', '-vf', "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,lutyuv=y='clip(val,16,235)':u='clip(val,16,240)':v='clip(val,16,240)'",
      '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '60', '-fps_mode', 'cfr',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-an', file], { stdio: 'inherit' })
    const inputFiles = ['capture/youtube/captureMassDriver.spec.ts', 'capture/youtube/playwright.youtube.config.ts', 'capture/playwright.capture.config.ts', 'capture/manifest.ts', 'capture/profiles.ts', 'capture/initCapture.ts', 'capture/gameActions.ts', 'capture/runner.ts', 'capture/finalRender/engine.ts', 'capture/finalRender/plan.ts', 'capture/finalRender/reach.ts', 'src/scene/heliosReactorModel.ts']
    const js = execFileSync('bash', ['-c', "rg --files dist/assets -g '*.js'"], { encoding: 'utf8' }).trim().split('\n')
    const manifest = {
      schema: 'shootthemoon.youtube-mass-driver-capture/1',
      authorized: 'Fourth and final new capture, explicitly authorized for VO/picture lock.',
      command: 'npx playwright test --config=capture/youtube/playwright.youtube.config.ts',
      gitCommitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      captureStartedAtIso,
      capturedAtIso: new Date().toISOString(),
      browser: {
        name: browser.browserType().name(), version: browser.version(),
        playwrightVersion: JSON.parse(readFileSync(new URL('../../node_modules/playwright-core/package.json', import.meta.url), 'utf8')).version,
        renderer: 'existing capture config: ANGLE SwiftShader',
      },
      shotId: shot.id, name: shot.name, fixture: shot.fixture,
      profile: 'HUD backing buffer with existing hidden-HUD policy',
      cssViewport: { width: profile.cssWidth, height: profile.cssHeight },
      actualBuffer: prepared.actualBuffer, deviceScaleFactor: profile.deviceScaleFactor,
      hud: shot.hud, clockMode: 'exact elapsed-ms via captureFinalRenderJob/sampleClockAt',
      trace: 'off; source/time hashes and frame-counter guards retained',
      job, frames, sequenceSha256: hash(frames.map((f) => f.sha256).join('\n')),
      inputs: Object.fromEntries(inputFiles.map((f) => [f, hash(readFileSync(f))])),
      harnessBuild: Object.fromEntries(js.map((f) => [f, hash(readFileSync(f))])),
      pageErrors: prepared.errors.page, consoleErrors: prepared.errors.console,
      source: { file: path.relative(process.cwd(), file), sha256: hash(readFileSync(file)), frames: 792, fps: 60, durationS: 13.2, width: 1920, height: 1080, audio: false, bakedTitles: false },
    }
    writeFileSync(path.join(out, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n')
  } finally {
    if (browser.isConnected()) await context.close()
  }
})
