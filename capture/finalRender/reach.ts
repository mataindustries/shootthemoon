/**
 * Per-shot "reach" functions for the final-render engine: everything each
 * shot's manifest.ts `run()` does BEFORE it starts sampling its own
 * (review-sized) capture window — dismissing the launch gate, seeding the
 * right in-game state, opening a reveal, arming/firing, tracking a
 * counterstrike, issuing a DEFEND order — copied verbatim from the matching
 * shot in capture/manifest.ts. Only the sampling itself differs: instead of
 * a fixed review window, the returned handle exposes a generic
 * `advance(value)` that final-render's engine drives across the exact
 * approved capture/finalEdit.json window (native units — normalized
 * progress or ms-since-origin) for however many frames the locked cut
 * actually needs.
 *
 * This is the literal implementation of the gap capture/README.md's Phase 3
 * section calls out: "today every run() hardcodes its review window."
 * Nothing in manifest.ts's own SHOTS/run() bodies changes; three small
 * helpers (`counterstrikeRunDispatcher`, `setupCounterstrikeTracking`,
 * `setupDividerFirstWave`) were exported (previously module-private) so this
 * file can reuse them instead of re-implementing the same dispatch/setup
 * logic a second time.
 */
import { expect, type Page } from '@playwright/test'
import {
  advanceStepperUntilAttribute,
  armFirstStrikeDialog,
  claimDefaultLandingSite,
  fireDefenseAction,
  openMonumentRevealAndReadOrigin,
  reachCounterstrikeFireNow,
  returnToOrbitIfNeeded,
  setCinematicProgress,
  setRivalPresentation,
  setStrikePresentation,
} from '../gameActions.ts'
import { dismissLaunchGate } from '../initCapture.ts'
import {
  counterstrikeRunDispatcher,
  setupCounterstrikeTracking,
  setupDividerFirstWave,
} from '../manifest.ts'
import { createClockStepper } from '../runner.ts'
import { REACH_KIND } from './reachKinds.ts'

export type ReachHandle =
  | { readonly clock: 'still' }
  | { readonly clock: 'progress'; readonly advance: (progress: number) => Promise<void> }
  | { readonly clock: 'elapsed-ms'; readonly advance: (elapsedMs: number) => Promise<void> }

export type ReachFn = (page: Page) => Promise<ReachHandle>

const STILL: ReachHandle = { clock: 'still' }
function progressReach(advance: (progress: number) => Promise<void>): ReachHandle {
  return { clock: 'progress', advance }
}
function elapsedMsReach(advance: (elapsedMs: number) => Promise<void>): ReachHandle {
  return { clock: 'elapsed-ms', advance }
}

const FAILED_IMPACT_DETAIL = {
  outcome: 'FAILURE',
  attemptNumber: 2,
  attemptsUsed: 2,
  judgement: 'LATE',
} as const

const FINAL_RENDER_REACH_IMPL: Readonly<Record<string, ReachFn>> = Object.freeze({
  'descent-touchdown': async (page) => {
    await dismissLaunchGate(page)
    await claimDefaultLandingSite(page)
    return progressReach((p) => setCinematicProgress(page, p))
  },
  'touchdown-dust': async (page) => {
    await dismissLaunchGate(page)
    await claimDefaultLandingSite(page)
    return progressReach((p) => setCinematicProgress(page, p))
  },
  'vesper-citadel-reveal': async (page) => {
    await dismissLaunchGate(page)
    return progressReach((p) => setRivalPresentation(page, 'impact', p))
  },
  'vesper-transmission': async (page) => {
    await dismissLaunchGate(page)
    return progressReach((p) => setRivalPresentation(page, 'intro-transmission', p))
  },
  'first-strike-arm-dialog': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    await armFirstStrikeDialog(page)
    return STILL
  },
  'first-strike-liftoff': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    return progressReach((p) => setStrikePresentation(page, 'launch', p))
  },
  'first-strike-orbital-flight': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    return progressReach((p) => setStrikePresentation(page, 'orbital-flight', p))
  },
  'first-strike-target-approach': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    return progressReach((p) => setStrikePresentation(page, 'target-approach', p))
  },
  'first-strike-impact-flash': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    return progressReach((p) => setStrikePresentation(page, 'impact-flash', p))
  },
  'first-strike-ejecta': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    return progressReach((p) => setStrikePresentation(page, 'ejecta', p))
  },
  'first-strike-ending-text': async (page) => {
    await dismissLaunchGate(page)
    await returnToOrbitIfNeeded(page)
    await setStrikePresentation(page, 'ending', 1)
    return STILL
  },
  'counterstrike-fire-now': async (page) => {
    await dismissLaunchGate(page)
    await reachCounterstrikeFireNow(page)
    return STILL
  },
  'counterstrike-fire-now-port': async (page) => {
    await dismissLaunchGate(page)
    await reachCounterstrikeFireNow(page)
    return STILL
  },
  // Requires beforeGoto: installCounterstrikeClockFreeze — already set on
  // both shots' manifest.ts entries, reused automatically since the engine
  // reads shot.beforeGoto straight from SHOTS. See counterstrikeRunDispatcher
  // (freezes performance.now() before every dispatch) for why this matters:
  // without it, 'impact' status's short real-time-derived camera pose drifts
  // onto the same settled frame regardless of the requested progress.
  'counterstrike-terminal-dive': async (page) => {
    await setupCounterstrikeTracking(page)
    const dispatch = counterstrikeRunDispatcher('impact', FAILED_IMPACT_DETAIL)
    return progressReach((p) => dispatch(page, p))
  },
  'counterstrike-impact-contact': async (page) => {
    await dismissLaunchGate(page)
    const dispatch = counterstrikeRunDispatcher('impact', FAILED_IMPACT_DETAIL)
    return progressReach((p) => dispatch(page, p))
  },
  'divider-incoming-formation': async (page) => {
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
    // `stepper` stays anchored at the original reveal-open origin
    // (setupDividerFirstWave's own createClockStepper call) — `targetingMs`
    // is itself only a relative elapsedMs *within that same anchor*, not a
    // fresh absolute performance.now() reading, so finalEdit.json's
    // origin="wave-targeting" window is reached by adding its ms onto
    // targetingMs and re-using the SAME stepper, never by anchoring a new
    // one at targetingMs (which would treat a small relative offset as if
    // it were an absolute clock reading and never actually advance).
    return elapsedMsReach((ms) => stepper.advanceTo(targetingMs + ms))
  },
  'divider-fire-defense-port': async (page) => {
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
    return STILL
  },
  'divider-weapon-volley': async (page) => {
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
    // See divider-incoming-formation above: reuse the same reveal-open
    // -anchored stepper, offset by fireMs, rather than anchoring a new one
    // at the (relative, not absolute) fireMs value.
    return elapsedMsReach((ms) => stepper.advanceTo(fireMs + ms))
  },
  'divider-defense-interaction': async (page) => {
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
    // See divider-incoming-formation above.
    return elapsedMsReach((ms) => stepper.advanceTo(targetingMs + ms))
  },
  'divider-monument-survives': async (page) => {
    await dismissLaunchGate(page)
    await expect(page.locator('main')).toHaveAttribute('data-monument-view', 'true', { timeout: 10_000 })
    await expect(page.locator('main')).toHaveAttribute('data-monument-status', 'complete')
    return STILL
  },
  // Helios/Signal Array/Crater Crown/Bastion all share the exact same
  // reach shape (openMonumentRevealAndReadOrigin + a clock stepper); what
  // differs is the fixture (MON_<KIND>), already carried by each shot's own
  // SHOTS entry and applied generically by the engine via preparePage.
  'helios-mechanical-peak': async (page) => {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const stepper = createClockStepper(page, originMs)
    return elapsedMsReach((ms) => stepper.advanceTo(ms))
  },
  'signal-array-mechanical-peak': async (page) => {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const stepper = createClockStepper(page, originMs)
    return elapsedMsReach((ms) => stepper.advanceTo(ms))
  },
  'crater-crown-early-reveal': async (page) => {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const stepper = createClockStepper(page, originMs)
    return elapsedMsReach((ms) => stepper.advanceTo(ms))
  },
  // Phase B prerequisite #2: supports the full approved +300ms..+6000ms
  // pull-back (MONUMENT_REVEAL_MS) — the manifest's own bastionHeldHeroShot
  // only ever samples a narrow +5000..+5600ms review slice, but this reach
  // function (like every other elapsed-ms shot here) hands the engine a
  // stepper that can be driven across the clip's own finalEdit.json window,
  // whatever it is, without touching the Bastion or its camera.
  'bastion-held-hero': async (page) => {
    const originMs = await openMonumentRevealAndReadOrigin(page)
    const stepper = createClockStepper(page, originMs)
    return elapsedMsReach((ms) => stepper.advanceTo(ms))
  },
  'monument-selection-port': async (page) => {
    await dismissLaunchGate(page)
    return STILL
  },
})

/** Looks up and runs a shot's reach function, asserting its returned clock
 * kind matches the statically-declared REACH_KIND table (a cheap guard
 * against the registry and the table drifting apart). */
export async function reachFinalRenderState(page: Page, shotId: string): Promise<ReachHandle> {
  const reachFn = FINAL_RENDER_REACH_IMPL[shotId]
  if (reachFn === undefined) {
    throw new Error(`No final-render reach function registered for shot "${shotId}".`)
  }
  const handle = await reachFn(page)
  const declared = REACH_KIND[shotId]
  if (handle.clock !== declared) {
    throw new Error(
      `Final-render reach for "${shotId}" returned clock "${handle.clock}" but REACH_KIND declares "${String(declared)}".`,
    )
  }
  return handle
}

export const FINAL_RENDER_SHOT_IDS: readonly string[] = Object.keys(FINAL_RENDER_REACH_IMPL)
