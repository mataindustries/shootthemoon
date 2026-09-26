/**
 * Typed declarative shot manifest + per-shot orchestration.
 *
 * This is Phase 1: exactly four representative shots proving the
 * architecture (see capture/README.md), not the full reel. Expanding to the
 * complete reel means appending more `Shot` entries here — the runner in
 * capture/runner.ts and the test loop in capture/capture.spec.ts are
 * already generic over the manifest and need no changes per shot added.
 */
import type { Page } from '@playwright/test'
import { FIRST_STRIKE_PRESENTATION_DURATIONS_MS } from '../src/app/firstStrikePresentation.ts'
import type { FixtureId } from './fixtures.ts'
import {
  claimDefaultLandingSite,
  openMonumentRevealAndReadOrigin,
  reachCounterstrikeFireNow,
  returnToOrbitIfNeeded,
  setCinematicProgress,
  setStrikePresentation,
} from './gameActions.ts'
import { dismissLaunchGate } from './initCapture.ts'
import type { HudVisibility } from './initCapture.ts'
import type { CaptureProfileId } from './profiles.ts'
import {
  captureFrames,
  captureStill,
  createClockStepper,
  createProgressEventStepper,
  type CaptureFramesResult,
} from './runner.ts'

export interface ShotOutcome {
  readonly frameCount: number
  readonly frameFilenames: readonly string[]
  readonly nudgedFrames: readonly number[]
  readonly clockMode: 'fake-clock' | 'progress-event' | 'real-time-still'
  readonly startMs: number | null
  readonly endMs: number | null
  readonly fps: number | null
}

export interface Shot {
  readonly id: string
  readonly name: string
  readonly profile: CaptureProfileId
  readonly fixture: FixtureId
  readonly hud: HudVisibility
  readonly notes: string
  /** Runs once, before preparePage navigates — only clock-driven shots need
   * this, to install the fake clock ahead of the very first navigation. */
  readonly beforeGoto?: (page: Page) => Promise<void>
  /** Drives the game to the shot's target state and captures it. */
  readonly run: (page: Page, outDir: string) => Promise<ShotOutcome>
}

function frameResultToOutcome(
  result: CaptureFramesResult,
  clockMode: ShotOutcome['clockMode'],
  startMs: number,
  endMs: number,
  fps: number,
): ShotOutcome {
  return {
    frameCount: result.frameCount,
    frameFilenames: result.frameFilenames,
    nudgedFrames: result.nudgedFrames,
    clockMode,
    startMs,
    endMs,
    fps,
  }
}

/**
 * A: DESCENT / TOUCHDOWN — continuous animation, camera motion, dust, PLATE.
 *
 * APPROACH_DURATION_SECONDS (6.2s) is a private constant in
 * src/camera/CinematicClock.tsx (not exported); it is mirrored here as a
 * documented constant purely to convert progress <-> ms for fps-accurate
 * frame spacing. If that duration ever changes, this window's real-time
 * spacing drifts slightly but capture still succeeds (progress stays valid
 * in [0, 1] regardless). Window is 0.12-0.42 progress, safely clear of the
 * audited 55-85% descent texture (Moon/SurfacePatch LOD) handoff band.
 */
const DESCENT_APPROACH_DURATION_MS = 6_200
const descentShot: Shot = {
  id: 'descent-touchdown',
  name: 'Descent / touchdown — early approach',
  profile: 'PLATE',
  fixture: 'FRESH',
  hud: { mode: 'hidden' },
  notes:
    'Progress 0.12-0.42 of the approach cinematic: continuous camera motion ' +
    'and dust, clear of the known 55-85% descent texture handoff.',
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await claimDefaultLandingSite(page)
    const fps = 12
    const startMs = Math.round(0.12 * DESCENT_APPROACH_DURATION_MS)
    const endMs = Math.round(0.42 * DESCENT_APPROACH_DURATION_MS)
    const stepper = createProgressEventStepper(page, setCinematicProgress, (elapsedMs) =>
      elapsedMs / DESCENT_APPROACH_DURATION_MS,
    )
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

/**
 * B: FIRST STRIKE ORBITAL FLIGHT — cinematic state fixture, deterministic
 * frame stepping, PLATE, suitable for a future poster-frame pick.
 *
 * Sweeps the full 0-1 progress of the 'orbital-flight' phase (a real,
 * exported duration: FIRST_STRIKE_PRESENTATION_DURATIONS_MS['orbital-flight']).
 * The presentation event is purely visual and independent of the
 * underlying firstStrike reducer status, so a STRUCK (completed) fixture is
 * used without needing to re-run the arm/fire flow.
 */
const orbitalFlightShot: Shot = {
  id: 'first-strike-orbital-flight',
  name: 'First Strike — orbital flight',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: 'Full 0-1 sweep of the orbital-flight presentation phase.',
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['orbital-flight']!
    const fps = 5
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'orbital-flight', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

/**
 * C: COUNTERSTRIKE FIRE NOW — HUD profile, real interactive UI, still.
 *
 * A single still: the "FIRE NOW" reticle state is reached through real UI
 * clicks (TRACK COUNTERSTRIKE, PRIORITIZE INTERCEPTOR) plus one existing
 * test-hook dispatch to pin the intercept window, exactly as
 * e2e/counterstrike.spec.ts's own "Counterstrike success" test does.
 */
const counterstrikeFireNowShot: Shot = {
  id: 'counterstrike-fire-now',
  name: 'Counterstrike — FIRE NOW',
  profile: 'HUD',
  fixture: 'STRUCK',
  hud: { mode: 'visible' },
  notes: 'Real UI composition at 16:9; HUD fully visible and interactive.',
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await reachCounterstrikeFireNow(page)
    const filename = await captureStill(page, outDir)
    return {
      frameCount: 1,
      frameFilenames: [filename],
      nudgedFrames: [],
      clockMode: 'real-time-still',
      startMs: null,
      endMs: null,
      fps: null,
    }
  },
}

/**
 * D: HELIOS REVEAL — completed monument fixture, reveal timeline, emissive/
 * mechanical animation, PLATE.
 *
 * Driven by Playwright's fake clock (page.clock), the same
 * fastForward-then-runFor idiom e2e/helios-reactor.spec.ts already uses,
 * because the reveal timeline is computed from real performance.now()
 * deltas rather than an explicit progress-override event. The entry gate's
 * CSS fade is settled with one real-time wait first, per that same spec's
 * own comment: fake-clock stepping is not trustworthy across CSS
 * transitions.
 */
const heliosRevealShot: Shot = {
  id: 'helios-reveal',
  name: 'Helios Spire — monument reveal',
  profile: 'PLATE',
  fixture: 'MON_HELIOS_SPIRE',
  hud: { mode: 'hidden' },
  notes:
    'Reveal window +300ms to +1800ms from monument-view opening (post entry-gate CSS fade).',
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    // Real-time wait: settles the entry gate's CSS opacity fade before any
    // fake-clock stepping begins (see module doc comment above).
    await page.waitForTimeout(700)
    const fps = 10
    const startMs = 300
    const endMs = 1_800
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

export const SHOTS: readonly Shot[] = [
  descentShot,
  orbitalFlightShot,
  counterstrikeFireNowShot,
  heliosRevealShot,
]
