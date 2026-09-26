/**
 * Typed declarative shot manifest + per-shot orchestration.
 *
 * Phase 1 proved the architecture with four representative shots (see git
 * history / capture/README.md). This is Phase 2: the complete reel
 * candidate manifest for the approved six-act ~58s master, expanded from
 * that proof set. Every shot here is still driven by the same generic
 * runner (capture/runner.ts) and the same generic test loop
 * (capture/capture.spec.ts) — neither changed to add these. Frame counts
 * are deliberately kept to *review* budgets (one hero frame to ~16 for a
 * complicated reveal), never full-duration 60fps 4K masters — see each
 * shot's `editorial.captureWindow`/`notes` for why that budget was chosen.
 *
 * Editorial metadata (`Shot.editorial`) carries everything the eventual
 * final-render pass and the edit itself need that isn't already implied by
 * the capture mechanics: act, proposed edit order, a working timecode
 * against the ~58s master, an intended edited duration snapped to the
 * approved 100bpm-grid values (0.6/1.2/1.8/2.4/3.0/4.8s), crop/reframe
 * guidance, an audio note, a transition/edit note, and a REQUIRED / ALT /
 * OPTIONAL priority. None of this feeds the runner — it is read only by
 * capture/reelContactSheets.mjs and by whoever cuts the final edit.
 */
import { expect, type Page } from '@playwright/test'
import { FIRST_STRIKE_PRESENTATION_DURATIONS_MS } from '../src/app/firstStrikePresentation.ts'
import { RIVAL_PRESENTATION_DURATIONS_MS } from '../src/app/rivalPresentation.ts'
import { COUNTERSTRIKE_IMPACT_CAMERA_TIMING } from '../src/camera/counterstrikeCameraPlan.ts'
import { CROWN_HELD_MS } from '../src/scene/craterCrownModel.ts'
import { HELIOS_REVEAL_LAUNCH_MS } from '../src/scene/heliosReactorModel.ts'
import { SIGNAL_HELD_MS } from '../src/scene/signalArrayModel.ts'
import {
  MONUMENT_FOUNDATION_MS,
  MONUMENT_REVEAL_MS,
  MONUMENTS,
} from '../src/domain/territoryMonument.ts'
import type { FixtureId } from './fixtures.ts'
import {
  advanceStepperUntilAttribute,
  armFirstStrikeDialog,
  chooseMonumentKind,
  claimDefaultLandingSite,
  fireDefenseAction,
  fireFirstStrike,
  freezeCounterstrikeClock,
  installCounterstrikeClockFreeze,
  issueDefendOrder,
  openMonumentRevealAndReadOrigin,
  reachCounterstrikeFireNow,
  reachCounterstrikeRun,
  reachMiningCloseup,
  returnToOrbitIfNeeded,
  selectDefaultLandingSiteOnly,
  setCinematicProgress,
  setRivalPresentation,
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
  type FrameStepper,
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

export type ReelAct =
  | 'ACT_I_ARRIVAL'
  | 'ACT_II_THE_RIVAL'
  | 'ACT_III_FIRST_STRIKE'
  | 'ACT_IV_SHE_ANSWERED'
  | 'ACT_V_THIRD_PARTY'
  | 'ACT_VI_THE_CLAIM'

export type ShotPriority = 'REQUIRED' | 'ALT' | 'OPTIONAL'

export type CaptureMethod =
  | 'progress-event-sweep'
  | 'clock-sweep'
  | 'clock-driven-sequence'
  | 'real-time-still'

/**
 * Everything the eventual final-render pass and the edit need beyond the
 * capture mechanics themselves. Read by capture/reelContactSheets.mjs and by
 * whoever cuts the final edit — never by runner.ts/capture.spec.ts.
 */
export interface EditorialMeta {
  /** Proposed absolute position in the full storyboard, 1-based. */
  readonly order: number
  readonly act: ReelAct
  /** Approximate placement against the ~58s master; a planning estimate, not
   * a constraint the game's own animation timing is forced to match. */
  readonly workingTimecode: string
  /** Intended edited duration, snapped to the approved 100bpm grid. */
  readonly editedDurationS: 0.6 | 1.2 | 1.8 | 2.4 | 3.0 | 4.8
  /** Human-readable summary of the page actions taken to reach this shot. */
  readonly setupActions: string
  /** The data-attribute/value (or button/dialog text) that gates/confirms
   * this shot's target state. */
  readonly stateAssertion: string
  readonly captureMethod: CaptureMethod
  /** Free-text description of the sampled window/moment. */
  readonly captureWindow: string
  readonly cropGuidance: string
  readonly audioNote: string
  readonly editNote: string
  readonly priority: ShotPriority
}

export interface Shot {
  readonly id: string
  readonly name: string
  readonly profile: CaptureProfileId
  readonly fixture: FixtureId
  readonly hud: HudVisibility
  readonly notes: string
  readonly editorial: EditorialMeta
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

function stillOutcome(filename: string): ShotOutcome {
  return {
    frameCount: 1,
    frameFilenames: [filename],
    nudgedFrames: [],
    clockMode: 'real-time-still',
    startMs: null,
    endMs: null,
    fps: null,
  }
}

/** Linear ramp from `start` to `end` progress over `durationMs` of a shot's
 * own elapsedMs clock — a capture-authored sampling range, not a real game
 * timer. Used for phases/statuses whose `progress` field is caller-supplied
 * narrative position rather than a driven animation duration (e.g.
 * Counterstrike's `tracking`/`impact`/`success` statuses). */
function linearProgress(start: number, end: number, durationMs: number) {
  return (elapsedMs: number) => start + (Math.min(elapsedMs, durationMs) / durationMs) * (end - start)
}

/** Dispatches counterstrike:set-run with a fixed status + arbitrary fields,
 * varying only `progress` — the progress-event stepper shape, reused for
 * Counterstrike the same way setStrikePresentation/setRivalPresentation
 * already are for First Strike/Rival.
 *
 * Freezes performance.now() (see installCounterstrikeClockFreeze in
 * gameActions.ts) immediately before every dispatch: 'impact' samples its
 * camera pose from real elapsed time since dispatch, and its whole duration
 * (4,400ms) is short enough that ordinary render/IPC latency under 4K
 * SwiftShader drifts the sampled progress well past what was requested —
 * confirmed empirically (see the comment on installCounterstrikeClockFreeze)
 * — so callers sweeping 'impact' must pass `beforeGoto:
 * installCounterstrikeClockFreeze` to preparePage first. */
function counterstrikeRunDispatcher(status: string, extra: Record<string, unknown> = {}) {
  return async (page: Page, progress: number): Promise<void> => {
    await freezeCounterstrikeClock(page)
    await page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('counterstrike:set-run', { detail })),
      { status, progress, ...extra },
    )
    await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', status)
  }
}

async function setupCounterstrikeTracking(page: Page): Promise<void> {
  await dismissLaunchGate(page)
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-available', 'true')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
}

// The one editorial choice of *which* monument kind demonstrates the
// DIVIDER wave-defense sequence (Act V) — independent of which kind each
// Act VI match-cut shot uses, since each of those is its own MON_<KIND>
// fixture/save. Chosen so no single kind carries both a DIVIDER-combat shot
// and its own Act VI showcase (avoids an obvious duplicate composition).
const DIVIDER_DEMO_KIND_TITLE = MONUMENTS.SIGNAL_ARRAY.title

/** Shared DIVIDER setup: opens the monument builder on a CLAIM_RICH save,
 * picks the demo kind, waits out construction, and issues the first wave's
 * DEFEND order. Returns the clock stepper (already anchored to reveal-open)
 * and the elapsedMs the DEFEND order landed at, for callers to keep
 * advancing from. */
async function setupDividerFirstWave(
  page: Page,
): Promise<{ stepper: FrameStepper; waveStartMs: number }> {
  const originMs = await openMonumentRevealAndReadOrigin(page)
  await chooseMonumentKind(page, DIVIDER_DEMO_KIND_TITLE)
  const stepper = createClockStepper(page, originMs)
  const commandMs = await advanceStepperUntilAttribute(
    stepper,
    page.locator('main'),
    'data-monument-status',
    'command',
    MONUMENT_FOUNDATION_MS,
    MONUMENT_FOUNDATION_MS + 1_500,
    100,
  )
  await issueDefendOrder(page)
  return { stepper, waveStartMs: commandMs }
}

// ============================================================================
// ACT I — ARRIVAL
// ============================================================================

const titleScreenShot: Shot = {
  id: 'title-screen',
  name: 'Launch title screen',
  profile: 'HUD',
  fixture: 'FRESH',
  hud: { mode: 'visible' },
  notes:
    'The real launch gate before dismissal (data-entry-open="true"): ' +
    '.launch-gate__title ("SHOOT" / "THE MOON"), kicker, FIRST STRIKE badge, ' +
    'and the BEGIN INVASION CTA. No dismiss click.',
  editorial: {
    order: 1,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:00.0-0:00.6',
    editedDurationS: 0.6,
    setupActions: 'preparePage only — no gate dismiss.',
    stateAssertion: 'main[data-entry-open="true"], .launch-gate__title visible',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, page load settle',
    cropGuidance: 'none — full 16:9 title composition',
    audioNote: 'silent card; music sting lands in edit',
    editNote: 'opens the reel; hard cut to landing-site-panel',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const landingSitePanelShot: Shot = {
  id: 'landing-site-panel',
  name: 'Landing site selected — pre-claim panel',
  profile: 'HUD',
  fixture: 'FRESH',
  hud: { mode: 'visible' },
  notes: 'Site panel open, CLAIM LANDING SITE button visible, before the claim click.',
  editorial: {
    order: 2,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:00.6-0:01.2',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate, tap canvas center to select the default site.',
    stateAssertion: '.site-panel visible, CLAIM LANDING SITE button present',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, post-select settle',
    cropGuidance: 'none',
    audioNote: 'UI confirm tick lands in edit',
    editNote: 'quick beat before claim-confirmed; can compress to a flash cut',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await selectDefaultLandingSiteOnly(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const claimConfirmedShot: Shot = {
  id: 'claim-confirmed',
  name: 'Claim confirmed — descent begins',
  profile: 'PLATE',
  fixture: 'FRESH',
  hud: { mode: 'hidden' },
  notes:
    'Progress 0-0.12 of the approach cinematic: the moment right after CLAIM ' +
    'LANDING SITE, before the descent-touchdown shot picks up at 0.12.',
  editorial: {
    order: 3,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:01.2-0:02.4',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, claimDefaultLandingSite.',
    stateAssertion: 'main[data-phase="approach"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'moon-core:set-cinematic-progress 0.00-0.12',
    cropGuidance: 'none',
    audioNote: 'engine ignition SFX cue point',
    editNote: 'leads directly into descent-touchdown — same camera language, cut on motion',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await claimDefaultLandingSite(page)
    const fps = 5
    const startMs = 0
    const endMs = Math.round(0.12 * DESCENT_APPROACH_DURATION_MS)
    const stepper = createProgressEventStepper(page, setCinematicProgress, (elapsedMs) =>
      elapsedMs / DESCENT_APPROACH_DURATION_MS,
    )
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

/**
 * DESCENT / TOUCHDOWN — continuous animation, camera motion, dust, PLATE.
 * Unchanged from Phase 1 (see git history) beyond the added `editorial`
 * field — already proven, not re-tuned.
 *
 * APPROACH_DURATION_SECONDS (6.2s) is a private constant in
 * src/camera/CinematicClock.tsx (not exported); it is mirrored here as a
 * documented constant purely to convert progress <-> ms for fps-accurate
 * frame spacing. Window is 0.12-0.42 progress, safely clear of the audited
 * 55-85% descent texture (Moon/SurfacePatch LOD) handoff band.
 */
export const DESCENT_APPROACH_DURATION_MS = 6_200
const descentShot: Shot = {
  id: 'descent-touchdown',
  name: 'Descent / touchdown — early approach',
  profile: 'PLATE',
  fixture: 'FRESH',
  hud: { mode: 'hidden' },
  notes:
    'Progress 0.12-0.42 of the approach cinematic: continuous camera motion ' +
    'and dust, clear of the known 55-85% descent texture handoff.',
  editorial: {
    order: 4,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:02.4-0:05.4',
    editedDurationS: 3.0,
    setupActions: 'dismissLaunchGate, claimDefaultLandingSite.',
    stateAssertion: 'main[data-phase="approach"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'moon-core:set-cinematic-progress 0.12-0.42 (clear of 0.55-0.85 AVOID band)',
    cropGuidance: 'none',
    audioNote: 'descent thruster rumble bed',
    editNote: 'the reel’s establishing motion beat; cut on the dust before touchdown-dust',
    priority: 'REQUIRED',
  },
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

const touchdownDustShot: Shot = {
  id: 'touchdown-dust',
  name: 'Touchdown — dust settling',
  profile: 'PLATE',
  fixture: 'FRESH',
  hud: { mode: 'hidden' },
  notes:
    'Progress 0.86-0.97: ImpactEffects dust opacity follows sin(impactAge*PI) ' +
    'peaking near 0.93 and returning to 0 exactly at progress=1.0 (still ' +
    "phase='approach' throughout this window — landed forces progress to 1 " +
    'and the dust is already gone by then, so this window is the only place ' +
    'to catch it). Clear of the 0.55-0.85 AVOID band.',
  editorial: {
    order: 5,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:05.4-0:06.6',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, claimDefaultLandingSite.',
    stateAssertion: 'main[data-phase="approach"] (still), dust opacity mid-fade',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'moon-core:set-cinematic-progress 0.86-0.97',
    cropGuidance: 'none',
    audioNote: 'thruster cutoff + settle whoosh',
    editNote: 'button on the descent; hard cut to mining-laser-closeup',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await claimDefaultLandingSite(page)
    const fps = 10
    const startMs = Math.round(0.86 * DESCENT_APPROACH_DURATION_MS)
    const endMs = Math.round(0.97 * DESCENT_APPROACH_DURATION_MS)
    const stepper = createProgressEventStepper(page, setCinematicProgress, (elapsedMs) =>
      elapsedMs / DESCENT_APPROACH_DURATION_MS,
    )
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

const miningLaserCloseupShot: Shot = {
  id: 'mining-laser-closeup',
  name: 'Mining laser — close-up',
  profile: 'HUD',
  fixture: 'EXTRACTOR',
  hud: { mode: 'visible' },
  notes:
    'EXTRACTOR fixture (createLegacyActiveExtractorSave, e2e/rivalFixtures.ts) ' +
    '— an already-landed save with a built extractor on deposit-alpha at a ' +
    'fixed known site, reused unmodified from the existing e2e fixture ' +
    'architecture. Targets deposit-beta, the exact second deposit ' +
    "e2e/mining-asset-pass.spec.ts's own passing test already taps at this " +
    'same site/fixture (proven to always project onto the canvas and to ' +
    'still read "MINE DEPOSIT" rather than "EXTRACTOR ACTIVE", since the ' +
    'built extractor sits on the other deposit). Clicks MINE DEPOSIT and ' +
    'pauses the live simulation the instant data-robot-state="mining". ' +
    "Camera auto-frames a close-up via CameraRig's surface-focus-mining " +
    'mode — no manual zoom. Replaces an earlier FRESH + canvas-center-claim ' +
    'approach whose default site was not guaranteed to have a deposit ' +
    'nearby — this fixture removes that gamble instead of searching around ' +
    'it (see the full history on reachMiningCloseup in gameActions.ts).',
  editorial: {
    order: 6,
    act: 'ACT_I_ARRIVAL',
    workingTimecode: '0:06.6-0:07.8',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, reachMiningCloseup (select deposit-beta, MINE DEPOSIT).',
    stateAssertion:
      'main[data-robot-state="mining"], canvas[data-mining-laser="contact"], ' +
      'canvas[data-camera-mode="surface-focus-mining"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, simulation paused on mining entry',
    cropGuidance: 'none — camera already frames tight',
    audioNote: 'laser hum + ore-crack SFX',
    editNote: 'closes Act I; hard cut to rival-night-turn opens Act II',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await reachMiningCloseup(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

// ============================================================================
// ACT II — THE RIVAL
// ============================================================================
// AVOID (approved): the 'capsule-approach' phase — "nearly-black early
// Vesper capsule approach". Never dispatched below.

const rivalNightTurnShot: Shot = {
  id: 'rival-night-turn',
  name: 'Night-side turn — tracing the rival signal',
  profile: 'PLATE',
  fixture: 'READY',
  hud: { mode: 'hidden' },
  notes:
    "rival-signal:set-presentation phase='orbital-transition' (5,800ms), the " +
    'camera path plan.orbitalTransition sweep. READY already has the rival ' +
    'signal fully revealed/scanned, so this is reachable without replaying ' +
    'the cinematic chain live.',
  editorial: {
    order: 7,
    act: 'ACT_II_THE_RIVAL',
    workingTimecode: '0:07.8-0:10.2',
    editedDurationS: 2.4,
    setupActions: 'dismissLaunchGate, setRivalPresentation("orbital-transition", p).',
    stateAssertion: 'main[data-rival-presentation="orbital-transition"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 5,800ms orbital-transition phase',
    cropGuidance: 'none',
    audioNote: 'RivalHud caption "TRACING SIGNAL BEYOND LOCAL HORIZON" — VO candidate',
    editNote: 'opens Act II; cut on camera motion into vesper-citadel-reveal',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const durationMs = RIVAL_PRESENTATION_DURATIONS_MS['orbital-transition']!
    const fps = 1.5
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setRivalPresentation(p, 'orbital-transition', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const vesperCitadelRevealShot: Shot = {
  id: 'vesper-citadel-reveal',
  name: 'Vesper Citadel — hero reveal',
  profile: 'PLATE',
  fixture: 'READY',
  hud: { mode: 'hidden' },
  notes:
    "rival-signal:set-presentation phase='impact' (2,600ms), sweeping the " +
    'late 0.75-1.0 sub-range — the widest/hero framing, matching the pattern ' +
    "e2e/vesper-citadel.spec.ts's own 01-reveal-wide pin (progress 0.92) " +
    'uses. Several nearby candidates generated around that reference point ' +
    'rather than a single arbitrary sample.',
  editorial: {
    order: 8,
    act: 'ACT_II_THE_RIVAL',
    workingTimecode: '0:10.2-0:12.6',
    editedDurationS: 2.4,
    setupActions: 'dismissLaunchGate, setRivalPresentation("impact", p).',
    stateAssertion: 'main[data-rival-presentation="impact"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: "'impact' phase, sub-range progress 0.75-1.0 (candidates around ~0.92)",
    cropGuidance: 'none — wide hero framing is the point',
    audioNote: 'Citadel drone reveal sting',
    editNote: 'poster-frame candidate for Act II card; cut to vesper-transmission on VO start',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const fps = 6
    const durationMs = 1_400
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setRivalPresentation(p, 'impact', progress),
      linearProgress(0.75, 1.0, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const vesperTransmissionShot: Shot = {
  id: 'vesper-transmission',
  name: 'Commander Vesper — transmission',
  profile: 'HUD',
  fixture: 'READY',
  hud: { mode: 'visible' },
  notes:
    "rival-signal:set-presentation phase='intro-transmission' (7,000ms). HUD " +
    'visible since the .rival-transmission "COMMANDER VESPER" text is the ' +
    'point; sampled mid-phase where the text is settled, not mid-fade-in.',
  editorial: {
    order: 9,
    act: 'ACT_II_THE_RIVAL',
    workingTimecode: '0:12.6-0:13.8',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, setRivalPresentation("intro-transmission", p).',
    stateAssertion: 'main[data-rival-presentation="intro-transmission"], .rival-transmission text',
    captureMethod: 'progress-event-sweep',
    captureWindow: "'intro-transmission' phase, sub-range progress 0.30-0.50 (text settled)",
    cropGuidance: 'none',
    audioNote: 'Vesper VO line plays here',
    editNote: 'short beat; cut on dialogue end into two-claims-one-moon',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const fps = 5
    const durationMs = 600
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setRivalPresentation(p, 'intro-transmission', progress),
      linearProgress(0.3, 0.5, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const twoClaimsOneMoonShot: Shot = {
  id: 'two-claims-one-moon',
  name: 'TWO CLAIMS · ONE MOON',
  profile: 'HUD',
  fixture: 'READY',
  hud: { mode: 'visible' },
  notes:
    "rival-signal:set-presentation phase='dual-sites' (3,500ms) — the exact " +
    'banner text from CINEMATIC_CAPTIONS[\'dual-sites\']. Sampled where the ' +
    'banner is fully held, matching e2e/vesper-citadel.spec.ts\'s own ' +
    '03-two-claims pin (progress 1).',
  editorial: {
    order: 10,
    act: 'ACT_II_THE_RIVAL',
    workingTimecode: '0:13.8-0:15.0',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, setRivalPresentation("dual-sites", p).',
    stateAssertion:
      'main[data-rival-presentation="dual-sites"], .rival-cinematic-caption--dual-sites',
    captureMethod: 'progress-event-sweep',
    captureWindow: "'dual-sites' phase, sub-range progress 0.6-1.0 (banner fully held)",
    cropGuidance: 'none',
    audioNote: 'stinger on banner landing',
    editNote: 'closes Act II on the thesis statement; hard cut to first-strike-arm-dialog',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const fps = 5
    const durationMs = 500
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setRivalPresentation(p, 'dual-sites', progress),
      linearProgress(0.6, 1.0, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

// ============================================================================
// ACT III — FIRST STRIKE
// ============================================================================

const firstStrikeArmDialogShot: Shot = {
  id: 'first-strike-arm-dialog',
  name: 'First Strike — arm confirmation dialog',
  profile: 'HUD',
  fixture: 'READY',
  hud: { mode: 'visible' },
  notes:
    'Real UI: ARM LUNAR WARHEAD click opens the "LAUNCH AT NULL MERIDIAN?" ' +
    'confirmation dialog. READY (pre-fire) is required — STRUCK has already ' +
    'fired and no longer has this dialog.',
  editorial: {
    order: 11,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:15.0-0:15.6',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, armFirstStrikeDialog.',
    stateAssertion: 'role=dialog containing "LAUNCH AT NULL MERIDIAN?"',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, dialog open',
    cropGuidance: 'none',
    audioNote: 'UI arm tone',
    editNote: 'the explicit arm beat; cuts directly to first-strike-fire-confirmed',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    await armFirstStrikeDialog(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const firstStrikeFireConfirmedShot: Shot = {
  id: 'first-strike-fire-confirmed',
  name: 'First Strike — FIRE confirmed',
  profile: 'HUD',
  fixture: 'READY',
  hud: { mode: 'visible' },
  notes:
    'Real UI: WARHEAD ARMED -> FIRE click sequence. Lands on ' +
    'data-first-strike-status="LAUNCHING" — the explicit FIRE confirmation ' +
    'the approved plan calls out, dialog dismissed, before any presentation ' +
    'phase overrides the view.',
  editorial: {
    order: 12,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:15.6-0:16.2',
    editedDurationS: 0.6,
    setupActions:
      'dismissLaunchGate, returnToOrbitIfNeeded, armFirstStrikeDialog, fireFirstStrike.',
    stateAssertion: 'main[data-first-strike-status="LAUNCHING"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, immediately post-FIRE click',
    cropGuidance: 'none',
    audioNote: 'FIRE confirm SFX + low rumble start',
    editNote: 'punch beat; hard cut to first-strike-liftoff',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    await armFirstStrikeDialog(page)
    await fireFirstStrike(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const firstStrikeLiftoffShot: Shot = {
  id: 'first-strike-liftoff',
  name: 'First Strike — liftoff',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "first-strike:set-presentation phase='launch' (3,200ms). Sweeps only the " +
    'first 75% of the phase — AVOID: the empty-ground tail after the warhead ' +
    'leaves frame in the last quarter.',
  editorial: {
    order: 13,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:16.2-0:18.0',
    editedDurationS: 1.8,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("launch", p).',
    stateAssertion: 'main[data-first-strike-presentation="launch"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: "'launch' phase, sub-range progress 0-0.75 (AVOID the empty-ground tail)",
    cropGuidance: 'none',
    audioNote: 'launch roar',
    editNote: 'cut on the warhead exiting frame into first-strike-orbital-flight',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['launch']!
    const fps = 3
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'launch', progress),
      linearProgress(0, 0.75, durationMs * 0.75),
    )
    const endMs = Math.round(durationMs * 0.75)
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, endMs, fps)
  },
}

/**
 * FIRST STRIKE ORBITAL FLIGHT — unchanged from Phase 1 beyond the added
 * `editorial` field. Already proven and already dense enough (20 frames
 * across the full 3,800ms sweep) to serve as the poster-frame source for
 * "orbital warhead crossing the illuminated lunar limb" — no need to
 * duplicate it with a narrower shot.
 */
const orbitalFlightShot: Shot = {
  id: 'first-strike-orbital-flight',
  name: 'First Strike — orbital flight',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: 'Full 0-1 sweep of the orbital-flight presentation phase.',
  editorial: {
    order: 14,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:18.0-0:20.4',
    editedDurationS: 2.4,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("orbital-flight", p).',
    stateAssertion: 'main[data-first-strike-presentation="orbital-flight"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 3,800ms orbital-flight phase (20 frames, dense poster-frame source)',
    cropGuidance: 'none',
    audioNote: 'orbital transit hum, building tension',
    editNote: 'leading poster-frame candidate for the whole reel; cut to first-strike-target-approach',
    priority: 'REQUIRED',
  },
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

const firstStrikeTargetApproachShot: Shot = {
  id: 'first-strike-target-approach',
  name: 'First Strike — target approach',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: "first-strike:set-presentation phase='target-approach' (2,200ms), full sweep.",
  editorial: {
    order: 15,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:20.4-0:22.2',
    editedDurationS: 1.8,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("target-approach", p).',
    stateAssertion: 'main[data-first-strike-presentation="target-approach"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 2,200ms target-approach phase',
    cropGuidance: 'none',
    audioNote: 'accelerating descent whine',
    editNote: 'cut on final descent into first-strike-impact-flash',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['target-approach']!
    const fps = 3
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'target-approach', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const firstStrikeImpactFlashShot: Shot = {
  id: 'first-strike-impact-flash',
  name: 'First Strike — impact flash',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: "first-strike:set-presentation phase='impact-flash' (1,300ms), full sweep.",
  editorial: {
    order: 16,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:22.2-0:22.8',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("impact-flash", p).',
    stateAssertion: 'main[data-first-strike-presentation="impact-flash"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 1,300ms impact-flash phase',
    cropGuidance: 'none',
    audioNote: 'detonation boom',
    editNote: 'single-frame-feel flash cut into first-strike-ejecta',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['impact-flash']!
    const fps = 4
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'impact-flash', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const firstStrikeEjectaShot: Shot = {
  id: 'first-strike-ejecta',
  name: 'First Strike — ejecta',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: "first-strike:set-presentation phase='ejecta' (3,400ms), full sweep.",
  editorial: {
    order: 17,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:22.8-0:25.2',
    editedDurationS: 2.4,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("ejecta", p).',
    stateAssertion: 'main[data-first-strike-presentation="ejecta"], data-scar-created="true"',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 3,400ms ejecta phase',
    cropGuidance: 'none',
    audioNote: 'debris rumble, decaying',
    editNote: 'cut on settling debris into first-strike-crater-reveal',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['ejecta']!
    const fps = 2.5
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'ejecta', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const firstStrikeCraterRevealShot: Shot = {
  id: 'first-strike-crater-reveal',
  name: 'First Strike — crater formation',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes: "first-strike:set-presentation phase='crater-reveal' (2,600ms), full sweep.",
  editorial: {
    order: 18,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:25.2-0:27.6',
    editedDurationS: 2.4,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("crater-reveal", p).',
    stateAssertion: 'main[data-first-strike-presentation="crater-reveal"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: 'full 0-1 sweep of the 2,600ms crater-reveal phase',
    cropGuidance: 'none',
    audioNote: 'reveal swell',
    editNote: 'cut on camera settle into first-strike-scar-settled',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const durationMs = FIRST_STRIKE_PRESENTATION_DURATIONS_MS['crater-reveal']!
    const fps = 3
    const stepper = createProgressEventStepper(
      page,
      (p, progress) => setStrikePresentation(p, 'crater-reveal', progress),
      (elapsedMs) => elapsedMs / durationMs,
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const firstStrikeScarSettledShot: Shot = {
  id: 'first-strike-scar-settled',
  name: 'First Strike — settled scar',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    'No presentation override at all (phase stays "idle") — STRUCK already ' +
    'represents the settled, healed-over crater with no transient effects, ' +
    'exactly as e2e/first-strike.spec.ts\'s own "completed fixture restores a ' +
    'static scar" test proves (data-impact-complete, canvas ' +
    'data-scar-facing-camera="true", no transient effect attributes).',
  editorial: {
    order: 19,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:27.6-0:28.8',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate, returnToOrbitIfNeeded (no presentation dispatch).',
    stateAssertion:
      'main[data-first-strike-status="COMPLETE"], data-impact-complete="true", ' +
      'canvas[data-scar-facing-camera="true"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, idle presentation',
    cropGuidance: 'none',
    audioNote: 'quiet hold, wind bed',
    editNote: 'hero hold before Act IV; cut to counterstrike-missile-limb',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const firstStrikeEndingTextShot: Shot = {
  id: 'first-strike-ending-text',
  name: 'First Strike — THE MOON REMEMBERS',
  profile: 'HUD',
  fixture: 'STRUCK',
  hud: { mode: 'visible' },
  notes:
    "first-strike:set-presentation phase='ending' — the .strike-ending card " +
    '("THE MOON REMEMBERS") only renders in this transient phase, not in the ' +
    'settled scar state. No fixed duration exists for \'ending\' (progress is ' +
    'ignored once duration is null), so this is a single still, not a sweep.',
  editorial: {
    order: 20,
    act: 'ACT_III_FIRST_STRIKE',
    workingTimecode: '0:28.8-0:29.4',
    editedDurationS: 0.6,
    setupActions:
      'dismissLaunchGate, returnToOrbitIfNeeded, setStrikePresentation("ending", 1).',
    stateAssertion: 'main[data-first-strike-presentation="ending"], .strike-ending text',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, ending phase',
    cropGuidance: 'none',
    audioNote: 'card sting',
    editNote: 'ALT text-card insert if the edit wants an explicit title card here',
    priority: 'ALT',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    await setStrikePresentation(page, 'ending', 1)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

// ============================================================================
// ACT IV — SHE ANSWERED (Counterstrike)
// ============================================================================
// AVOID (approved): the first ~20% of the interception sequence where the
// orange interceptor form fills the frame — interception-success below
// starts its sweep at progress 0.25.

const counterstrikeMissileLimbShot: Shot = {
  id: 'counterstrike-missile-limb',
  name: 'Counterstrike — cyan missile over the limb',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "counterstrike:set-run status='tracking' — the rival's cyan missile in " +
    'transit (object null-meridian-counterstrike-missile, VISUAL_PALETTE.' +
    'rivalCyanEmissive). No canonical "limb-crossing" progress constant ' +
    'exists, so this sweeps a capture-authored early-tracking range to give ' +
    'several nearby candidates to pick a poster frame from.',
  editorial: {
    order: 21,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:29.4-0:31.2',
    editedDurationS: 1.8,
    setupActions: 'setupCounterstrikeTracking (dismiss gate, TRACK COUNTERSTRIKE, PRIORITIZE INTERCEPTOR).',
    stateAssertion: 'main[data-counterstrike-state="tracking"], canvas[data-counterstrike-reticle="tracking"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: "status='tracking', capture-authored progress range 0.10-0.40",
    cropGuidance: 'none',
    audioNote: 'RIVAL LAUNCH DETECTED warning tone',
    editNote: 'poster-frame candidate; cut to counterstrike-fire-now-hud',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await setupCounterstrikeTracking(page)
    const fps = 6
    const durationMs = 1_200
    const stepper = createProgressEventStepper(
      page,
      counterstrikeRunDispatcher('tracking', { attemptNumber: 1, attemptsUsed: 0 }),
      linearProgress(0.1, 0.4, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

/**
 * COUNTERSTRIKE FIRE NOW — unchanged from Phase 1 beyond the added
 * `editorial` field.
 */
const counterstrikeFireNowShot: Shot = {
  id: 'counterstrike-fire-now',
  name: 'Counterstrike — FIRE NOW',
  profile: 'HUD',
  fixture: 'STRUCK',
  hud: { mode: 'visible' },
  notes: 'Real UI composition at 16:9; HUD fully visible and interactive.',
  editorial: {
    order: 22,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:31.2-0:31.8',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate, reachCounterstrikeFireNow.',
    stateAssertion: 'main[data-counterstrike-state="intercept-ready"], .counterstrike-targeting[data-intercept-cue="FIRE_NOW"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, intercept-ready reticle window',
    cropGuidance: 'none',
    audioNote: 'FIRE NOW alert tone',
    editNote: 'the desktop/16:9 half of the mobile-motif pair with counterstrike-fire-now-port',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await reachCounterstrikeFireNow(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const counterstrikeFireNowPortShot: Shot = {
  id: 'counterstrike-fire-now-port',
  name: 'Counterstrike — FIRE NOW (mobile)',
  profile: 'PORT',
  fixture: 'STRUCK',
  hud: { mode: 'visible' },
  notes:
    'Same reachCounterstrikeFireNow flow as counterstrike-fire-now, at real ' +
    '390x844 PORT viewport — CounterstrikeHud has no separate portrait ' +
    'component, only base mobile-first CSS, confirmed by ' +
    'e2e/counterstrike.spec.ts running the identical selectors at this exact ' +
    'viewport. Mobile motif requirement #1.',
  editorial: {
    order: 23,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:31.8-0:32.4',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate, reachCounterstrikeFireNow (PORT viewport).',
    stateAssertion: 'main[data-counterstrike-state="intercept-ready"], .counterstrike-targeting[data-intercept-cue="FIRE_NOW"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, intercept-ready reticle window',
    cropGuidance: 'none — real device frame is the point (mobile-motif proof)',
    audioNote: 'FIRE NOW alert tone',
    editNote:
      '16:9 -> PORT -> 16:9 mobile motif: pairs with counterstrike-fire-now-hud immediately before/after',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await reachCounterstrikeFireNow(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const counterstrikeTerminalDiveShot: Shot = {
  id: 'counterstrike-terminal-dive',
  name: 'Counterstrike — terminal dive',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "counterstrike:set-run status='impact' (attemptNumber 2, attemptsUsed 2, " +
    "judgement LATE, outcome FAILURE — the only combination 'impact' is ever " +
    'legitimately reached with in production; both attempts miss before it), ' +
    "sweeping the 'wide' camera beat (progress 0 -> wideHoldEndProgress) — " +
    "the beat e2e/counterstrike.spec.ts itself names " +
    "'08a-terminal-wide-shot.png' at wideHoldEndProgress/2. Requires " +
    'installCounterstrikeClockFreeze (beforeGoto) + freezeCounterstrikeClock ' +
    "per dispatch: 'impact' samples its camera pose from real elapsed time " +
    'since dispatch, and its whole duration (4,400ms) is short enough that ' +
    'ordinary render/IPC latency under 4K SwiftShader drifts the sampled ' +
    'progress well past every requested value otherwise — confirmed the ' +
    'unfrozen dispatch was the bug: every progress in the sweep rendered the ' +
    'same settled/final "damage-hold" pose instead of the requested "wide" ' +
    'beat. Previously judged one of the strongest kinetic images in the ' +
    'project, so several nearby candidates are generated rather than one ' +
    'sample.',
  editorial: {
    order: 24,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:32.4-0:34.8',
    editedDurationS: 2.4,
    setupActions: 'setupCounterstrikeTracking.',
    stateAssertion: 'main[data-counterstrike-state="impact"], canvas[data-counterstrike-camera-beat="wide"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: "status='impact', progress 0-wideHoldEndProgress ('wide' beat)",
    cropGuidance: 'none — full-frame kinetic composition',
    audioNote: 'incoming warhead roar, building',
    editNote: 'strongest kinetic candidate in the reel; cut to counterstrike-impact-contact',
    priority: 'REQUIRED',
  },
  beforeGoto: installCounterstrikeClockFreeze,
  async run(page, outDir) {
    await setupCounterstrikeTracking(page)
    const fps = 8
    const durationMs = 1_200
    const stepper = createProgressEventStepper(
      page,
      counterstrikeRunDispatcher('impact', {
        outcome: 'FAILURE',
        attemptNumber: 2,
        attemptsUsed: 2,
        judgement: 'LATE',
      }),
      linearProgress(0, COUNTERSTRIKE_IMPACT_CAMERA_TIMING.wideHoldEndProgress, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const counterstrikeImpactContactShot: Shot = {
  id: 'counterstrike-impact-contact',
  name: 'Counterstrike — impact contact',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "counterstrike:set-run status='impact' (attemptNumber 2, attemptsUsed 2, " +
    'judgement LATE, outcome FAILURE — the only legitimate way to reach ' +
    "'impact'), progress=contactProgress+0.045 — the exact 'contact' beat " +
    "e2e/counterstrike.spec.ts itself names '08-rival-impact-near-outpost.png' " +
    '(data-counterstrike-impact-effect="structural-impact"). A single precise ' +
    'still, not a sweep, since the test suite already verified this is the ' +
    'right frame. Requires installCounterstrikeClockFreeze (beforeGoto) — see ' +
    'the note on counterstrike-terminal-dive for why: without it this ' +
    'progress rendered the identical settled "damage-hold" frame as ' +
    'counterstrike-failed-impact-alt instead of the contact-beat explosion.',
  editorial: {
    order: 25,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:34.8-0:35.4',
    editedDurationS: 0.6,
    setupActions: 'reachCounterstrikeRun({status:"impact", progress: contactProgress+0.045}).',
    stateAssertion: 'canvas[data-counterstrike-impact-effect="structural-impact"]',
    captureMethod: 'real-time-still',
    captureWindow: "status='impact', progress = contactProgress + 0.045 (single verified frame)",
    cropGuidance: 'none',
    audioNote: 'impact crack',
    editNote: 'flash-cut punch; cut to counterstrike-interception-success',
    priority: 'REQUIRED',
  },
  beforeGoto: installCounterstrikeClockFreeze,
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await reachCounterstrikeRun(page, {
      status: 'impact',
      progress: COUNTERSTRIKE_IMPACT_CAMERA_TIMING.contactProgress + 0.045,
      outcome: 'FAILURE',
      attemptNumber: 2,
      attemptsUsed: 2,
      judgement: 'LATE',
    })
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const counterstrikeInterceptionSuccessShot: Shot = {
  id: 'counterstrike-interception-success',
  name: 'Counterstrike — successful interception',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "counterstrike:set-run status='success' (orbital-interception effect, " +
    '"INTERCEPTED" breakup text). AVOID: the first ~20% of this sequence, ' +
    'where the orange interceptor form fills the frame — sweep starts at ' +
    'progress 0.25.',
  editorial: {
    order: 26,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: '0:35.4-0:37.2',
    editedDurationS: 1.8,
    setupActions: 'setupCounterstrikeTracking.',
    stateAssertion: 'main[data-counterstrike-state="success"], canvas[data-counterstrike-effect="orbital-interception"]',
    captureMethod: 'progress-event-sweep',
    captureWindow: "status='success', progress 0.25-1.0 (AVOID first ~20% orange-fill)",
    cropGuidance: 'none',
    audioNote: 'interception boom + relief sting',
    editNote: 'payoff beat; closes Act IV, cut to monument-selection-port opens Act V',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await setupCounterstrikeTracking(page)
    const fps = 6
    const durationMs = 1_200
    const stepper = createProgressEventStepper(
      page,
      counterstrikeRunDispatcher('success', { attemptNumber: 1, attemptsUsed: 0 }),
      linearProgress(0.25, 1.0, durationMs),
    )
    const result = await captureFrames({ page, outDir, fps, startMs: 0, endMs: durationMs, stepper })
    return frameResultToOutcome(result, 'progress-event', 0, durationMs, fps)
  },
}

const counterstrikeFailedImpactAltShot: Shot = {
  id: 'counterstrike-failed-impact-alt',
  name: 'Counterstrike — failed impact (alternate)',
  profile: 'PLATE',
  fixture: 'STRUCK',
  hud: { mode: 'hidden' },
  notes:
    "counterstrike:set-run status='impact', outcome='FAILURE' (attemptNumber " +
    "2, attemptsUsed 2, judgement LATE — the real end state of the two-miss " +
    "path 'impact' is only ever reached through), progress=" +
    '(damageArrivalProgress+1)/2 — the settled damage-hold beat, matching ' +
    "e2e/counterstrike.spec.ts's own '09-damaged-outpost.png'. Requires " +
    'installCounterstrikeClockFreeze (beforeGoto) — see the note on ' +
    'counterstrike-terminal-dive for why: without it this shot and ' +
    'counterstrike-impact-contact both drifted onto this exact same ' +
    'damage-hold frame regardless of their different requested progress, ' +
    'making this shot an accidental duplicate rather than a distinct ' +
    'failure-impact alternate. data-outpost-damage-state/data-repairs-' +
    "required only flip on real acceptance (after 'resolved'), not during " +
    "presentation-only 'impact', so the state assertion below uses the " +
    "transient attributes that actually gate this beat instead. Alternate " +
    'footage only — the approved plan keeps SUCCESS as the primary beat.',
  editorial: {
    order: 27,
    act: 'ACT_IV_SHE_ANSWERED',
    workingTimecode: 'n/a (alternate, not in master timeline)',
    editedDurationS: 0.6,
    setupActions: 'reachCounterstrikeRun({status:"impact", outcome:"FAILURE", progress: damageHoldProgress}).',
    stateAssertion:
      'main[data-counterstrike-state="impact"], canvas[data-counterstrike-camera-beat="damage-hold"], canvas[data-counterstrike-damage-field="persistent"]',
    captureMethod: 'real-time-still',
    captureWindow: 'status=impact, outcome=FAILURE, damage-hold beat (single verified frame)',
    cropGuidance: 'none',
    audioNote: 'n/a — alternate footage',
    editNote: 'OPTIONAL alternate to counterstrike-interception-success if the edit wants stakes/failure beat',
    priority: 'OPTIONAL',
  },
  beforeGoto: installCounterstrikeClockFreeze,
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const damageHoldProgress = (COUNTERSTRIKE_IMPACT_CAMERA_TIMING.damageArrivalProgress + 1) / 2
    await reachCounterstrikeRun(page, {
      status: 'impact',
      attemptNumber: 2,
      attemptsUsed: 2,
      judgement: 'LATE',
      progress: damageHoldProgress,
      outcome: 'FAILURE',
    })
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

// ============================================================================
// ACT V — THIRD PARTY (monument build + DIVIDER)
// ============================================================================

const monumentSelectionPortShot: Shot = {
  id: 'monument-selection-port',
  name: 'LEAVE A PERMANENT MARK — monument selection (mobile)',
  profile: 'PORT',
  fixture: 'CLAIM',
  hud: { mode: 'visible' },
  notes:
    'Dismissing the launch gate on an un-built CLAIM save lands directly on ' +
    'the monument-choice panel (h1 "LEAVE A PERMANENT MARK" per ' +
    'TerritoryMonumentHud.tsx) — no separate "open builder" step needed. ' +
    'Mobile motif requirement #3.',
  editorial: {
    order: 28,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:37.2-0:37.8',
    editedDurationS: 0.6,
    setupActions: 'dismissLaunchGate (CLAIM save with no monument yet).',
    stateAssertion: 'main[data-monument-view="true"], .monument-choices buttons visible',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, choice panel open',
    cropGuidance: 'none — real device frame is the point (mobile-motif proof)',
    audioNote: 'UI open whoosh',
    editNote: 'opens Act V on the mobile motif; cut to divider-incoming-formation (16:9)',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const dividerIncomingFormationShot: Shot = {
  id: 'divider-incoming-formation',
  name: 'DIVIDER — incoming formation',
  profile: 'PLATE',
  fixture: 'CLAIM_RICH',
  hud: { mode: 'visible' },
  notes:
    'Wave-defense targeting phase (.wave-defense-card[data-phase="targeting"]) ' +
    'reached via the real construction -> command -> DEFEND-order flow, ' +
    'mirroring e2e/wave-defense-feedback.spec.ts. Octogonals visible, no fire ' +
    'yet. Demo kind: SIGNAL ARRAY (see DIVIDER_DEMO_KIND_TITLE).',
  editorial: {
    order: 29,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:37.8-0:39.0',
    editedDurationS: 1.2,
    setupActions:
      'openMonumentRevealAndReadOrigin, chooseMonumentKind(SIGNAL ARRAY), ' +
      'advance to command, issueDefendOrder, advance to targeting.',
    stateAssertion: 'main[data-monument-status="wave"], .wave-defense-card[data-phase="targeting"], canvas[data-octogonals-visible="true"]',
    captureMethod: 'clock-driven-sequence',
    captureWindow: 'targeting-phase window, ~400ms burst',
    cropGuidance: '~2x editorial punch-in centered on the octogonal formation (framing stays small at native 16:9)',
    audioNote: 'DIVIDER RAID INBOUND alert',
    editNote: 'cut to divider-fire-defense-port (mobile decision)',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    const { stepper, waveStartMs } = await setupDividerFirstWave(page)
    const targetingMs = await advanceStepperUntilAttribute(
      stepper,
      page.locator('.wave-defense-card'),
      'data-phase',
      'targeting',
      waveStartMs,
      waveStartMs + 2_000,
      100,
    )
    // +80ms: createClockStepper.advanceTo computes `atMs - now` against
    // whatever elapsedMs it was last called with (advanceStepperUntilAttribute
    // just left it at targetingMs) — starting captureFrames at that exact
    // same value makes its first internal advanceTo a zero-length step, so
    // no new render ever lands and the frame-count poll stalls. A small
    // positive offset guarantees a genuinely new point on the timeline.
    const fps = 8
    const startMs = targetingMs + 80
    const endMs = startMs + 400
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

const dividerFireDefensePortShot: Shot = {
  id: 'divider-fire-defense-port',
  name: 'DIVIDER — FIRE DEFENSE (mobile decision)',
  profile: 'PORT',
  fixture: 'CLAIM_RICH',
  hud: { mode: 'visible' },
  notes:
    'Same targeting-phase moment as divider-incoming-formation, at real ' +
    'PORT viewport — TerritoryMonumentHud/WaveDefenseHud have no separate ' +
    'portrait component, only a narrow-viewport media query, confirmed by ' +
    "e2e/wave-defense-feedback.spec.ts's own mid-test resize to 390x844. " +
    'Mobile motif requirement #2.',
  editorial: {
    order: 30,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:39.0-0:39.6',
    editedDurationS: 0.6,
    setupActions:
      'openMonumentRevealAndReadOrigin, chooseMonumentKind(SIGNAL ARRAY), ' +
      'advance to command, issueDefendOrder, advance to targeting (PORT viewport).',
    stateAssertion: 'main[data-monument-status="wave"], .wave-defense-card[data-phase="targeting"], FIRE DEFENSE button visible',
    captureMethod: 'clock-driven-sequence',
    captureWindow: 'single moment, targeting phase reached',
    cropGuidance: 'none — real device frame is the point (mobile-motif proof)',
    audioNote: 'targeting lock tone',
    editNote: '16:9 -> PORT -> 16:9 mobile motif: player decision beat between the two 16:9 DIVIDER shots',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    const { stepper, waveStartMs } = await setupDividerFirstWave(page)
    await advanceStepperUntilAttribute(
      stepper,
      page.locator('.wave-defense-card'),
      'data-phase',
      'targeting',
      waveStartMs,
      waveStartMs + 2_000,
      100,
    )
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

const dividerWeaponVolleyShot: Shot = {
  id: 'divider-weapon-volley',
  name: 'DIVIDER — weapon deployment / violet volley',
  profile: 'PLATE',
  fixture: 'CLAIM_RICH',
  hud: { mode: 'visible' },
  notes:
    "The enemy's attack run (octogonal-fire-visible + octogonal-impact-" +
    'visible, violet octogonalViolet material) — happens regardless of the ' +
    'player firing, so this shot lets the targeting window pass undefended ' +
    'to isolate the enemy volley on its own.',
  editorial: {
    order: 31,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:39.6-0:41.4',
    editedDurationS: 1.8,
    setupActions:
      'openMonumentRevealAndReadOrigin, chooseMonumentKind(SIGNAL ARRAY), ' +
      'advance to command, issueDefendOrder, advance past the defense window ' +
      'to the wave-1 strike moment (no FIRE DEFENSE tap).',
    stateAssertion: 'canvas[data-octogonal-fire-visible="true"], canvas[data-octogonal-impact-visible="true"]',
    captureMethod: 'clock-driven-sequence',
    captureWindow: 'wave-1 strike-time window, ~500ms burst',
    cropGuidance: '~2x editorial punch-in centered on the octogonal fire arc (framing stays small at native 16:9)',
    audioNote: 'violet weapons-fire SFX',
    editNote: 'cut to divider-defense-interaction (player answers)',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    const { stepper, waveStartMs } = await setupDividerFirstWave(page)
    const fireMs = await advanceStepperUntilAttribute(
      stepper,
      page.locator('.scene-canvas canvas'),
      'data-octogonal-fire-visible',
      'true',
      waveStartMs + 3_800,
      waveStartMs + 8_000,
      150,
    )
    // +80ms offset: see the comment in dividerIncomingFormationShot above —
    // avoids re-targeting the exact elapsedMs advanceStepperUntilAttribute
    // already reached, which would make captureFrames' first step a no-op.
    const fps = 6
    const startMs = fireMs + 80
    const endMs = startMs + 500
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

const dividerDefenseInteractionShot: Shot = {
  id: 'divider-defense-interaction',
  name: 'DIVIDER — cyan defense interaction',
  profile: 'PLATE',
  fixture: 'CLAIM_RICH',
  hud: { mode: 'visible' },
  notes:
    "The player's own defense beam/burst (data-defense-beam-visible / " +
    'data-defense-burst-visible) right after a real FIRE DEFENSE tap lands a ' +
    'hit — mirrors e2e/wave-defense-feedback.spec.ts\'s wave-1-impact / ' +
    'wave-1-debris beats.',
  editorial: {
    order: 32,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:41.4-0:43.8',
    editedDurationS: 2.4,
    setupActions:
      'openMonumentRevealAndReadOrigin, chooseMonumentKind(SIGNAL ARRAY), ' +
      'advance to command, issueDefendOrder, advance to targeting, ' +
      'fireDefenseAction (real tap at the button’s far edge).',
    stateAssertion: '.wave-defense-card[data-phase="hit"], canvas[data-defense-beam-visible="true"], canvas[data-defense-burst-visible="true"]',
    captureMethod: 'clock-driven-sequence',
    captureWindow: 'post-hit window, ~600ms burst (beam through debris)',
    cropGuidance: '~2x editorial punch-in centered on the beam contact point',
    audioNote: 'cyan defense beam SFX + hull-saved confirm',
    editNote: 'cut to divider-monument-survives',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    const { stepper, waveStartMs } = await setupDividerFirstWave(page)
    const targetingMs = await advanceStepperUntilAttribute(
      stepper,
      page.locator('.wave-defense-card'),
      'data-phase',
      'targeting',
      waveStartMs,
      waveStartMs + 2_000,
      100,
    )
    await fireDefenseAction(page)
    // +80ms offset: see the comment in dividerIncomingFormationShot above.
    const fps = 8
    const startMs = targetingMs + 80
    const endMs = startMs + 600
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'progress-event', startMs, endMs, fps)
  },
}

const dividerMonumentSurvivesShot: Shot = {
  id: 'divider-monument-survives',
  name: 'DIVIDER — monument survives',
  profile: 'PLATE',
  fixture: 'DIVIDER_SURVIVED',
  hud: { mode: 'visible' },
  notes:
    'RECOVERED to PLATE/4K. Previously played through all three live ' +
    'DIVIDER waves before screenshotting, which left the scene carrying ' +
    'three waves’ worth of accumulated live wave-defense VFX (missile fire, ' +
    'defense beams, debris) — expensive enough that a 4K screenshot ' +
    'readback exceeded even a 60s ceiling under SwiftShader, so the shot was ' +
    'downgraded to HUD/1080p. Root cause: that accumulated cost came from ' +
    'the LIVE combat session, not from the completed-monument state itself. ' +
    'The DIVIDER_SURVIVED fixture (capture/fixtures.ts) seeds the exact same ' +
    'domain end state directly — SIGNAL ARRAY (the manifest’s own ' +
    'DIVIDER_DEMO_KIND), status="complete", wavesResolved=3, all DEFEND, no ' +
    'losses, the identical shape buildMonumentClaimSave already proves valid ' +
    'for every MON_<KIND> Act VI reveal shot — with revealSeen=true so ' +
    'dismissing the launch gate auto-opens the monument view straight onto ' +
    'the settled "complete" camera pose (data-monument-reveal="false", no ' +
    'cinematic sweep) instead of playing the fight that produced it. ' +
    'Confirmed empirically: 7 draw calls / ~46k triangles (vs. a busy combat ' +
    'scene) and a ~6s 4K screenshot readback, well inside budget, and the ' +
    'same "TERRITORY CLAIMED · PERMANENT" / "HULL 100% · 3/3 WAVES" ' +
    'composition the live sequence produced.',
  editorial: {
    order: 33,
    act: 'ACT_V_THIRD_PARTY',
    workingTimecode: '0:43.8-0:45.0',
    editedDurationS: 1.2,
    setupActions: 'dismissLaunchGate (DIVIDER_SURVIVED auto-opens the completed monument view).',
    stateAssertion:
      'main[data-monument-status="complete"], data-territory-claimed="true", ' +
      'data-monument-reveal="false", canvas[data-camera-mode="territory-monument"]',
    captureMethod: 'real-time-still',
    captureWindow: 'single moment, post-auto-open settle',
    cropGuidance: 'none — held wide is the point',
    audioNote: 'claim secured sting',
    editNote: 'closes Act V; cut to the Act VI monument match-cut montage',
    priority: 'REQUIRED',
  },
  async run(page, outDir) {
    await dismissLaunchGate(page)
    await expect(page.locator('main')).toHaveAttribute('data-monument-view', 'true', { timeout: 10_000 })
    await expect(page.locator('main')).toHaveAttribute('data-monument-status', 'complete')
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

// ============================================================================
// ACT VI — THE CLAIM (monument match-cut + final wide)
// ============================================================================

/**
 * HELIOS SPIRE — early reveal. Unchanged from Phase 1 beyond the added
 * `editorial` field. Serves as the "early reveal" beat of the Helios
 * match-cut triptych (mechanical peak + held hero are new, below).
 */
const heliosRevealShot: Shot = {
  id: 'helios-reveal',
  name: 'Helios Spire — early reveal',
  profile: 'PLATE',
  fixture: 'MON_HELIOS_SPIRE',
  hud: { mode: 'hidden' },
  notes:
    'Reveal window +300ms to +1800ms from monument-view opening (post entry-gate CSS fade).',
  editorial: {
    order: 34,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:45.0-0:46.2',
    editedDurationS: 1.2,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_HELIOS_SPIRE fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +300ms to +1800ms',
    cropGuidance: 'none',
    audioNote: 'reveal swell',
    editNote: 'first beat of the monument match-cut montage (early reveal x4 kinds)',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 10
    const startMs = 300
    const endMs = 1_800
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const heliosMechanicalPeakShot: Shot = {
  id: 'helios-mechanical-peak',
  name: 'Helios Spire — mass-driver fire',
  profile: 'PLATE',
  fixture: 'MON_HELIOS_SPIRE',
  hud: { mode: 'hidden' },
  notes:
    'Mass-driver fire moment: HELIOS_REVEAL_LAUNCH_MS (4,200ms from reveal-' +
    'open) — bracketed with margin either side.',
  editorial: {
    order: 35,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:46.2-0:47.4',
    editedDurationS: 1.2,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_HELIOS_SPIRE fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: `reveal-open +${HELIOS_REVEAL_LAUNCH_MS - 300}ms to +${HELIOS_REVEAL_LAUNCH_MS + 300}ms (bracketing the mass-driver fire)`,
    cropGuidance: 'none',
    audioNote: 'mass-driver fire SFX',
    editNote: 'mechanical/action-peak beat of the Helios triptych',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 10
    const startMs = HELIOS_REVEAL_LAUNCH_MS - 300
    const endMs = HELIOS_REVEAL_LAUNCH_MS + 300
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const heliosHeldHeroShot: Shot = {
  id: 'helios-held-hero',
  name: 'Helios Spire — held hero',
  profile: 'PLATE',
  fixture: 'MON_HELIOS_SPIRE',
  hud: { mode: 'hidden' },
  notes:
    'Later in the same 12s loop, well past the first fire — a settled hero ' +
    'pose (the loop continues for up to HELIOS_LOOP_LIMIT_MS=36,000ms, so ' +
    'this is not fully static, just past the mechanical peak).',
  editorial: {
    order: 36,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:47.4-0:48.0',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_HELIOS_SPIRE fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +9000ms to +9600ms',
    cropGuidance: 'none',
    audioNote: 'ambient hold',
    editNote: 'held hero beat of the Helios triptych; matches the other 3 kinds’ held-hero beats for the match-cut',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 5
    const startMs = 9_000
    const endMs = 9_600
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const signalArrayEarlyRevealShot: Shot = {
  id: 'signal-array-early-reveal',
  name: 'Signal Array — early reveal',
  profile: 'PLATE',
  fixture: 'MON_SIGNAL_ARRAY',
  hud: { mode: 'hidden' },
  notes: 'sampleSignalArray: early deploy window before the yaw sweep/vane deployment completes.',
  editorial: {
    order: 37,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:48.0-0:48.6',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_SIGNAL_ARRAY fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +300ms to +1200ms',
    cropGuidance: 'none',
    audioNote: 'servo whir start',
    editNote: 'first beat of Signal Array’s triptych in the match-cut montage',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 6
    const startMs = 300
    const endMs = 1_200
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const signalArrayMechanicalPeakShot: Shot = {
  id: 'signal-array-mechanical-peak',
  name: 'Signal Array — articulated deployment / aperture peak',
  profile: 'PLATE',
  fixture: 'MON_SIGNAL_ARRAY',
  hud: { mode: 'hidden' },
  notes:
    'sampleSignalArray: glow/emitter peak (~1,950-2,750ms), the vanes fully ' +
    'deployed and the aperture flare at its brightest.',
  editorial: {
    order: 38,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:48.6-0:49.8',
    editedDurationS: 1.2,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_SIGNAL_ARRAY fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +1900ms to +2750ms (glow/emitter peak)',
    cropGuidance: 'none',
    audioNote: 'aperture charge + chime',
    editNote: 'mechanical/action-peak beat of the Signal Array triptych',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 9
    const startMs = 1_900
    const endMs = 2_750
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const signalArrayHeldHeroShot: Shot = {
  id: 'signal-array-held-hero',
  name: 'Signal Array — held hero',
  profile: 'PLATE',
  fixture: 'MON_SIGNAL_ARRAY',
  hud: { mode: 'hidden' },
  notes: `Settled pose near SIGNAL_HELD_MS (${SIGNAL_HELD_MS}ms), fully deployed and held.`,
  editorial: {
    order: 39,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:49.8-0:50.4',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_SIGNAL_ARRAY fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: `reveal-open +${SIGNAL_HELD_MS - 400}ms to +${SIGNAL_HELD_MS}ms`,
    cropGuidance: 'none',
    audioNote: 'ambient hold',
    editNote: 'held hero beat of the Signal Array triptych',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 5
    const startMs = SIGNAL_HELD_MS - 400
    const endMs = SIGNAL_HELD_MS
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const craterCrownEarlyRevealShot: Shot = {
  id: 'crater-crown-early-reveal',
  name: 'Crater Crown — early reveal',
  profile: 'PLATE',
  fixture: 'MON_CRATER_CROWN',
  hud: { mode: 'hidden' },
  notes: 'sampleCraterCrown: early window before the bore retracts.',
  editorial: {
    order: 40,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:50.4-0:51.0',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_CRATER_CROWN fixture).',
    stateAssertion: 'main[data-monument-view="true"], canvas[data-scar-visible="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +300ms to +1200ms',
    cropGuidance: 'none',
    audioNote: 'industrial servo start',
    editNote: 'first beat of Crater Crown’s triptych in the match-cut montage',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 6
    const startMs = 300
    const endMs = 1_200
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const craterCrownMechanicalPeakShot: Shot = {
  id: 'crater-crown-mechanical-peak',
  name: 'Crater Crown — bore/glow peak',
  profile: 'PLATE',
  fixture: 'MON_CRATER_CROWN',
  hud: { mode: 'hidden' },
  notes: 'sampleCraterCrown: bore fully retracted, glow flare (~1,900-2,200ms), bracketed with margin.',
  editorial: {
    order: 41,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:51.0-0:51.6',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_CRATER_CROWN fixture).',
    stateAssertion: 'main[data-monument-view="true"], canvas[data-scar-visible="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +1700ms to +2300ms (bore/glow peak)',
    cropGuidance: 'none',
    audioNote: 'glow flare SFX',
    editNote: 'mechanical/action-peak beat of the Crater Crown triptych',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 10
    const startMs = 1_700
    const endMs = 2_300
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const craterCrownHeldHeroScarShot: Shot = {
  id: 'crater-crown-held-hero-scar',
  name: 'Crater Crown — held hero, scar unmistakable',
  profile: 'PLATE',
  fixture: 'MON_CRATER_CROWN',
  hud: { mode: 'hidden' },
  notes:
    `Settled pose near CROWN_HELD_MS (${CROWN_HELD_MS}ms). anchor='impact-scar' ` +
    'renders the Crown at the same transform as PermanentLunarScar, and the ' +
    'scar is already asserted visible during the reveal itself ' +
    '(data-scar-visible, e2e/territory-monuments.spec.ts:86-89) — the ' +
    'explicit task requirement that the surrounding First Strike scar be ' +
    'unmistakable in this frame.',
  editorial: {
    order: 42,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:51.6-0:52.2',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_CRATER_CROWN fixture).',
    stateAssertion: 'main[data-monument-view="true"], canvas[data-scar-visible="true"], canvas[data-claim-signal-visible="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: `reveal-open +${CROWN_HELD_MS - 200}ms to +${CROWN_HELD_MS + 200}ms`,
    cropGuidance: 'none — frame wide enough to keep the scar clearly in view',
    audioNote: 'ambient hold',
    editNote: 'held hero beat of the Crater Crown triptych; the explicit "scar unmistakable" frame',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 8
    const startMs = CROWN_HELD_MS - 200
    const endMs = CROWN_HELD_MS + 200
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const bastionEarlyRevealShot: Shot = {
  id: 'bastion-early-reveal',
  name: 'Bastion Ziggurat — early reveal',
  profile: 'PLATE',
  fixture: 'MON_BASTION_OBELISK',
  hud: { mode: 'hidden' },
  notes:
    'Bastion has no per-kind mechanical animation (pure static geometry — ' +
    'confirmed no sample*()/pose function exists, unlike the other three ' +
    'kinds); its only motion is the shared camera pullback over ' +
    'MONUMENT_REVEAL_MS. Early window = pullback just beginning.',
  editorial: {
    order: 43,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:52.2-0:52.8',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_BASTION_OBELISK fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +300ms to +1200ms (camera pullback beginning)',
    cropGuidance: 'none',
    audioNote: 'reveal swell',
    editNote: 'first beat of Bastion’s triptych in the match-cut montage',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 6
    const startMs = 300
    const endMs = 1_200
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const bastionMechanicalPeakShot: Shot = {
  id: 'bastion-mechanical-peak',
  name: 'Bastion Ziggurat — silhouette + claim beacon',
  profile: 'PLATE',
  fixture: 'MON_BASTION_OBELISK',
  hud: { mode: 'hidden' },
  notes:
    'No mechanical event exists for Bastion, so this substitutes the camera ' +
    'pullback’s mid-progress framing (best view of the stepped silhouette ' +
    'and centered claim beacon) for the "action peak" beat.',
  editorial: {
    order: 44,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:52.8-0:53.4',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_BASTION_OBELISK fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: 'reveal-open +2400ms to +3600ms (camera pullback mid-progress)',
    cropGuidance: 'none — centered claim beacon should stay frame-centered',
    audioNote: 'ambient swell',
    editNote: 'substitute "action peak" beat of the Bastion triptych (no mechanical animation exists for this kind)',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 6
    const startMs = 2_400
    const endMs = 3_600
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const bastionHeldHeroShot: Shot = {
  id: 'bastion-held-hero',
  name: 'Bastion Ziggurat — held hero',
  profile: 'PLATE',
  fixture: 'MON_BASTION_OBELISK',
  hud: { mode: 'hidden' },
  notes: `Settled pose near MONUMENT_REVEAL_MS (${MONUMENT_REVEAL_MS}ms), pullback complete.`,
  editorial: {
    order: 45,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:53.4-0:54.0',
    editedDurationS: 0.6,
    setupActions: 'openMonumentRevealAndReadOrigin (MON_BASTION_OBELISK fixture).',
    stateAssertion: 'main[data-monument-view="true"]',
    captureMethod: 'clock-sweep',
    captureWindow: `reveal-open +${MONUMENT_REVEAL_MS - 1_000}ms to +${MONUMENT_REVEAL_MS - 400}ms`,
    cropGuidance: 'none',
    audioNote: 'ambient hold',
    editNote: 'held hero beat of the Bastion triptych; leads into final-claimed-moon-wide',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const fps = 5
    const startMs = MONUMENT_REVEAL_MS - 1_000
    const endMs = MONUMENT_REVEAL_MS - 400
    const stepper = createClockStepper(page, originMs)
    const result = await captureFrames({ page, outDir, fps, startMs, endMs, stepper })
    return frameResultToOutcome(result, 'fake-clock', startMs, endMs, fps)
  },
}

const finalClaimedMoonWideShot: Shot = {
  id: 'final-claimed-moon-wide',
  name: 'Final wide — claimed Moon',
  profile: 'PLATE',
  fixture: 'MON_BASTION_OBELISK',
  hud: { mode: 'hidden' },
  notes:
    'Dismisses the reveal (RETURN TO ORBIT) and settles into the orbit ' +
    'camera over the claimed territory (data-camera-mode="orbit", ' +
    'data-territory-claimed="true"). Bastion chosen deliberately — anchor=' +
    '\'outpost\' keeps it on the lit hemisphere with the player base, unlike ' +
    'Crater Crown (anchor=\'impact-scar\', dark hemisphere, explicitly ' +
    'AVOIDed as the final wide). This is the approved closing visual. A ' +
    'single still, not a frame sweep: once the orbit camera settles, ' +
    "data-render-mode reverts to 'demand' and nothing re-renders on its own " +
    '(correct game behavior), so a captureFrames sweep across a static held ' +
    'shot has nothing new to capture and stalls waiting for a frame that ' +
    'will never come.',
  editorial: {
    order: 46,
    act: 'ACT_VI_THE_CLAIM',
    workingTimecode: '0:54.0-0:58.0',
    editedDurationS: 4.8,
    setupActions: 'openMonumentRevealAndReadOrigin, advance past reveal, click RETURN TO ORBIT, settle.',
    stateAssertion: 'canvas[data-camera-mode="orbit"], main[data-territory-claimed="true"]',
    captureMethod: 'real-time-still',
    captureWindow: 'reveal-open + MONUMENT_REVEAL_MS + ~700ms (post RETURN TO ORBIT settle)',
    cropGuidance: 'none — full wide is the point',
    audioNote: 'closing theme swell, holds through the end card',
    editNote: 'closes the master reel; hard cut to the END CARD',
    priority: 'REQUIRED',
  },
  beforeGoto: async (page) => {
    await page.clock.install()
  },
  async run(page, outDir) {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const stepper = createClockStepper(page, originMs)
    await stepper.advanceTo(MONUMENT_REVEAL_MS + 200)
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).click()
    await stepper.advanceTo(MONUMENT_REVEAL_MS + 700)
    const filename = await captureStill(page, outDir)
    return stillOutcome(filename)
  },
}

export const SHOTS: readonly Shot[] = [
  // Act I
  titleScreenShot,
  landingSitePanelShot,
  claimConfirmedShot,
  descentShot,
  touchdownDustShot,
  miningLaserCloseupShot,
  // Act II
  rivalNightTurnShot,
  vesperCitadelRevealShot,
  vesperTransmissionShot,
  twoClaimsOneMoonShot,
  // Act III
  firstStrikeArmDialogShot,
  firstStrikeFireConfirmedShot,
  firstStrikeLiftoffShot,
  orbitalFlightShot,
  firstStrikeTargetApproachShot,
  firstStrikeImpactFlashShot,
  firstStrikeEjectaShot,
  firstStrikeCraterRevealShot,
  firstStrikeScarSettledShot,
  firstStrikeEndingTextShot,
  // Act IV
  counterstrikeMissileLimbShot,
  counterstrikeFireNowShot,
  counterstrikeFireNowPortShot,
  counterstrikeTerminalDiveShot,
  counterstrikeImpactContactShot,
  counterstrikeInterceptionSuccessShot,
  counterstrikeFailedImpactAltShot,
  // Act V
  monumentSelectionPortShot,
  dividerIncomingFormationShot,
  dividerFireDefensePortShot,
  dividerWeaponVolleyShot,
  dividerDefenseInteractionShot,
  dividerMonumentSurvivesShot,
  // Act VI
  heliosRevealShot,
  heliosMechanicalPeakShot,
  heliosHeldHeroShot,
  signalArrayEarlyRevealShot,
  signalArrayMechanicalPeakShot,
  signalArrayHeldHeroShot,
  craterCrownEarlyRevealShot,
  craterCrownMechanicalPeakShot,
  craterCrownHeldHeroScarShot,
  bastionEarlyRevealShot,
  bastionMechanicalPeakShot,
  bastionHeldHeroShot,
  finalClaimedMoonWideShot,
]
