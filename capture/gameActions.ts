/**
 * Small, shot-specific page actions built on top of `initCapture.ts`.
 *
 * Every dispatched CustomEvent below is an existing production test hook
 * (gated behind the `?e2e` + VITE_E2E_HARNESS flag via
 * `src/testing/e2eHarness.ts`), copied verbatim from the matching pattern in
 * e2e/moon-core.spec.ts, e2e/first-strike.spec.ts, e2e/counterstrike.spec.ts,
 * and e2e/helios-reactor.spec.ts. None of it is new production surface.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { FrameStepper } from './runner.ts'

export async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('.scene-canvas canvas').boundingBox()
  if (bounds === null) throw new Error('Scene canvas has no layout bounds.')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

/** FRESH → orbit → tap the canvas center to select a site → claim it. Lands
 * on `data-phase="approach"`, the start of the descent cinematic. */
export async function claimDefaultLandingSite(page: Page): Promise<void> {
  const center = await canvasCenter(page)
  await page.mouse.click(center.x, center.y)
  await expect(page.locator('.site-panel')).toBeVisible()
  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'approach')
}

/** Pins the descent/return cinematic to an exact, normalized [0, 1]
 * progress — mirrors `setCinematicProgress` in e2e/moon-core.spec.ts. */
export async function setCinematicProgress(page: Page, progress: number): Promise<void> {
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent('moon-core:set-cinematic-progress', { detail: { progress: value } }),
      ),
    progress,
  )
}

/** Pins the First Strike presentation to an exact phase/progress — mirrors
 * `setStrikePresentation` in e2e/first-strike.spec.ts. Presentation is
 * purely visual and independent of the underlying firstStrike reducer
 * status, so it works from any landed fixture. */
export async function setStrikePresentation(
  page: Page,
  phase: string,
  progress: number | null,
): Promise<void> {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent('first-strike:set-presentation', { detail })),
    { phase, progress, replay: false },
  )
  await expect(page.locator('main')).toHaveAttribute('data-first-strike-presentation', phase)
}

/** Returns to orbit (skipping the return cinematic instantly) if a loaded
 * save starts landed — mirrors `returnToOrbitIfNeeded` in
 * e2e/first-strike.spec.ts. The First Strike presentation cinematics are
 * authored to play from orbit. */
export async function returnToOrbitIfNeeded(page: Page): Promise<void> {
  const main = page.locator('main')
  if ((await main.getAttribute('data-phase')) !== 'landed') return
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
}

/** From a STRUCK save: tracks the counterstrike, prioritizes the
 * interceptor order, then pins the run to the "FIRE NOW" reticle window —
 * mirrors the `setRun`/order-click sequence in e2e/counterstrike.spec.ts. */
export async function reachCounterstrikeFireNow(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-available', 'true')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('counterstrike:set-run', {
        detail: { status: 'intercept-ready', progress: 0.3, attemptNumber: 1, attemptsUsed: 0 },
      }),
    ),
  )
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', 'intercept-ready')
  await expect(page.locator('.counterstrike-targeting')).toHaveAttribute(
    'data-intercept-cue',
    'FIRE_NOW',
  )
}

/**
 * Freezes Date at a known instant, then dismisses the launch gate — the
 * same tap that (for a save with an unseen completed monument) triggers the
 * automatic monument reveal. Returns the faked `performance.now()` at the
 * moment the reveal view opened, the same "reveal origin" reading
 * e2e/helios-reactor.spec.ts's `openMonument()` returns, for callers to
 * offset HELIOS_* timeline constants against.
 *
 * Requires `page.clock.install()` to already have run (via preparePage's
 * `beforeGoto`) before this is called.
 */
export async function openMonumentRevealAndReadOrigin(page: Page): Promise<number> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000))
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await expect(page.locator('main')).toHaveAttribute('data-monument-view', 'true')
  return page.evaluate(() => performance.now())
}

// -- Act I: launch title / landing / mining ---------------------------------

/** Selects the default landing site (opens the site panel) without
 * confirming the claim — the pre-claim moment, the first half of
 * claimDefaultLandingSite above. */
export async function selectDefaultLandingSiteOnly(page: Page): Promise<void> {
  const center = await canvasCenter(page)
  await page.mouse.click(center.x, center.y)
  await expect(page.locator('.site-panel')).toBeVisible()
}

/**
 * Deterministic mining-closeup reach, from the EXTRACTOR capture fixture
 * (e2e/rivalFixtures.ts's `createLegacyActiveExtractorSave`, wired as
 * fixture id 'EXTRACTOR' in capture/fixtures.ts) — an already-landed save
 * whose extractor is already built on deposit-alpha, at the same
 * FIXTURE_SITE landing site e2e/firstStrikeFixtures.ts's own STRUCK/READY
 * fixtures share. Targets deposit-beta, the exact second deposit
 * e2e/mining-asset-pass.spec.ts's own 'mining assets remain visible...'
 * test already taps at this same site/fixture — proven to always project
 * onto the canvas (data-deposit-beta-x/y) and to still read "MINE DEPOSIT"
 * rather than "EXTRACTOR ACTIVE" (src/app/CinematicHud.tsx), since the
 * already-built extractor sits on the other deposit, deposit-alpha.
 *
 * Replaces an earlier FRESH + canvas-center-claim + "whichever deposit
 * happens to project" approach: the default (canvas-center) landing site is
 * not guaranteed to have a deposit nearby, so that approach could fail
 * outright depending on where canvas-center happened to land. This fixture
 * removes that gamble instead of searching around it.
 *
 * Pauses the live simulation once the robot actually reaches 'mining' —
 * mirrors e2e/mining-asset-pass.spec.ts's holdState() (a MutationObserver
 * dispatching first-outpost:set-simulation-paused on the state transition).
 * Callers dismiss the launch gate first (the EXTRACTOR save already lands
 * on data-phase="landed" without any claim/descent step).
 */
export async function reachMiningCloseup(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')

  const canvas = page.locator('.scene-canvas canvas')
  await expect(canvas).toHaveAttribute('data-deposit-beta-x', /\d/)
  const point = await canvas.evaluate((element: HTMLCanvasElement) => ({
    x: Number(element.dataset.depositBetaX),
    y: Number(element.dataset.depositBetaY),
  }))
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('main')).toHaveAttribute('data-selected-deposit', 'deposit-beta')

  await page.evaluate(() => {
    const main = document.querySelector('main')
    if (main === null) throw new Error('Shoot the Moon root was unavailable.')
    const observer = new MutationObserver(() => {
      if (main.getAttribute('data-robot-state') !== 'mining') return
      window.dispatchEvent(
        new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } }),
      )
      observer.disconnect()
    })
    observer.observe(main, { attributes: true, attributeFilter: ['data-robot-state'] })
  })
  await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-robot-state', 'mining', { timeout: 20_000 })
  await expect(canvas).toHaveAttribute('data-mining-laser', 'contact')
  await page.waitForTimeout(220)
}

// -- Act II: rival turn / Vesper reveal / TWO CLAIMS ------------------------

/** Pins the rival-signal cinematic presentation to an exact phase/progress —
 * mirrors setRivalPresentation in e2e/moon-core.spec.ts and
 * e2e/vesper-citadel.spec.ts. Purely visual and independent of the
 * underlying rival reducer status, so it works from any fixture where the
 * rival signal has already resolved (READY, STRUCK, CLAIM, MON_*). */
export async function setRivalPresentation(
  page: Page,
  phase: string,
  progress: number | null,
): Promise<void> {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent('rival-signal:set-presentation', { detail })),
    { phase, progress, replay: false },
  )
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', phase)
}

// -- Act III: First Strike arm / fire ----------------------------------------

/** From a READY save (orbit, pre-fire): opens the ARM confirmation dialog.
 * Mirrors e2e/first-strike.spec.ts's `ARM LUNAR WARHEAD` click, which opens
 * a dialog asking "LAUNCH AT NULL MERIDIAN?". */
export async function armFirstStrikeDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }).click()
  await expect(page.getByRole('dialog')).toContainText('LAUNCH AT NULL MERIDIAN?')
}

/** Confirms the already-open ARM dialog and fires — mirrors
 * e2e/first-strike.spec.ts's own CANCEL -> `WARHEAD ARMED` -> `FIRE`
 * sequence: CANCEL only closes the dialog (it does not revert the ARMED
 * status), which is required first — the dialog's backdrop otherwise
 * intercepts pointer events aimed at the WARHEAD ARMED button underneath.
 * Lands on data-first-strike-status="LAUNCHING": the explicit FIRE
 * confirmation moment, dialog dismissed, before any presentation-phase
 * override is dispatched. */
export async function fireFirstStrike(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'CANCEL' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /WARHEAD ARMED/ }).click()
  await page.getByRole('button', { name: 'FIRE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-first-strike-status', 'LAUNCHING')
}

// -- Act IV: Counterstrike run states -----------------------------------------

export interface CounterstrikeRunDetail {
  readonly status: string
  readonly progress: number
  readonly attemptNumber?: number
  readonly attemptsUsed?: number
  readonly judgement?: 'EARLY' | 'VALID' | 'LATE'
  readonly outcome?: 'SUCCESS' | 'FAILURE'
}

/**
 * Installs the exact `performance.now()`-freeze test hook
 * e2e/counterstrike.spec.ts's own `openScene()` sets up
 * (`window.__counterstrikeE2eClock`), as a `beforeGoto` for any Counterstrike
 * shot that pins an exact progress inside the short, real-time-derived
 * `impact` status (4,400ms — see COUNTERSTRIKE_TIMING.impactMs).
 *
 * Root cause this works around: `counterstrikeRun`'s camera pose is sampled
 * every frame from `performance.now() - phaseStartedAtMs`, not from the raw
 * `progress` argument passed to `counterstrike:set-run` (that argument only
 * sets the initial `phaseStartedAtMs` anchor). The FIRST render of the
 * `impact` status also has to compile brand-new geometry (crater, ejecta
 * shards/grains) that nothing earlier in the run instantiates, and under 4K
 * SwiftShader that first compile can itself take longer than the whole
 * 4,400ms window. Left unfrozen, that real wall-clock delay is exactly what
 * `getCounterstrikeRunProgress` measures, so by the time a screenshot lands,
 * the sampled progress has already drifted to (or past) the end of the
 * phase — every requested moment collapses onto the same final
 * "damage-hold" pose (confirmed empirically: pinning progress 0.39 and 0.97
 * both rendered the identical settled-crater frame without this fix).
 * Freezing `performance.now()` right after each dispatch pins the sampled
 * progress exactly at the requested value regardless of render latency —
 * not a production hook, purely a browser-global override installed by test
 * tooling, the same trick e2e/counterstrike.spec.ts already relies on.
 */
export async function installCounterstrikeClockFreeze(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance)
    let frozenNow: number | null = null
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => frozenNow ?? realNow(),
    })
    Object.defineProperty(window, '__counterstrikeE2eClock', {
      configurable: true,
      value: {
        freeze: () => {
          frozenNow = realNow()
        },
      },
    })
  })
}

/** Freezes the clock installed by installCounterstrikeClockFreeze, if
 * present — a no-op on any page that didn't install it via beforeGoto. */
export async function freezeCounterstrikeClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __counterstrikeE2eClock?: { freeze: () => void }
    }
    testWindow.__counterstrikeE2eClock?.freeze()
  })
}

async function readCounterstrikeFrameCount(page: Page): Promise<number> {
  return page.locator('.scene-canvas canvas').evaluate((canvas: HTMLCanvasElement) => {
    const value = canvas.dataset.frameCount
    return value === undefined ? Number.NaN : Number(value)
  })
}

/** Waits for the R3F frame counter to advance past its pre-dispatch value —
 * confirms a real frame has actually committed at the just-frozen progress
 * before a still screenshot is taken. Mirrors the same "wait for the
 * framebuffer" guarantee runner.ts's captureFrames already makes for sweeps,
 * needed here because captureStill only does a fixed real-time wait. */
async function waitForNextCounterstrikeFrame(
  page: Page,
  previousCount: number,
): Promise<void> {
  const deadline = Date.now() + 8_000
  let current = await readCounterstrikeFrameCount(page)
  while ((Number.isNaN(current) || current <= previousCount) && Date.now() < deadline) {
    await page.waitForTimeout(50)
    current = await readCounterstrikeFrameCount(page)
  }
}

/** Tracks the counterstrike and prioritizes the interceptor order (the same
 * setup reachCounterstrikeFireNow performs above), then pins the run to an
 * arbitrary status/progress via the same counterstrike:set-run test hook.
 * Generalizes reachCounterstrikeFireNow's single 'intercept-ready' pin to
 * any status e2e/counterstrike.spec.ts's own RunDetail supports (tracking,
 * intercept-ready, interceptor-launched, success, impact, ...).
 *
 * Freezes the page's performance.now() (see installCounterstrikeClockFreeze)
 * immediately before dispatching and waits for a fresh frame to land before
 * returning — required for 'impact', whose short real-time-derived duration
 * is otherwise vulnerable to render-latency drift (see that function's
 * comment); harmless for every other status, where it's a no-op freeze call
 * plus a cheap frame-count poll. Callers that need this precision must pass
 * `beforeGoto: installCounterstrikeClockFreeze` to preparePage first. */
export async function reachCounterstrikeRun(
  page: Page,
  detail: CounterstrikeRunDetail,
): Promise<void> {
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-available', 'true')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  const previousCount = await readCounterstrikeFrameCount(page)
  await freezeCounterstrikeClock(page)
  await page.evaluate(
    (value) => window.dispatchEvent(new CustomEvent('counterstrike:set-run', { detail: value })),
    detail,
  )
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', detail.status)
  await waitForNextCounterstrikeFrame(page, previousCount)
}

// -- Act V: monument construction / DIVIDER wave defense ----------------------

// Opening the monument builder on a CLAIM(_RICH) save with no monument yet is
// the exact same dismiss-launch-gate/read-origin flow as
// openMonumentRevealAndReadOrigin above — dismissing the gate lands directly
// on data-monument-view="true", showing the kind-choice panel ("LEAVE A
// PERMANENT MARK") instead of an existing monument's reveal dialog, per
// e2e/territory-monuments.spec.ts:28-29. Reuse that same function.

/** Picks a monument kind from the choice panel by its title (e.g. 'SIGNAL
 * ARRAY') — mirrors the `getByRole('button', { name: /HELIOS SPIRE/ })`
 * pattern both e2e/wave-defense-feedback.spec.ts and
 * e2e/territory-monuments.spec.ts use. */
export async function chooseMonumentKind(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.locator('main')).toHaveAttribute('data-monument-status', 'constructing')
}

/** Issues the DEFEND allocation for the wave currently awaiting an order —
 * mirrors the `/^1 DEFEND/` button both e2e/wave-defense-feedback.spec.ts
 * and e2e/territory-monuments.spec.ts use. A short real-time wait settles
 * the order panel's own CSS entrance transition first — page.clock's fake
 * timers don't drive the compositor thread that runs it (the same caveat
 * documented for the Helios reveal's entry-gate fade). The click itself
 * uses `force: true`: a later wave's order button carries a continuous
 * urgency-pulse CSS animation that keeps Playwright's actionability check
 * ("visible, enabled, stable") from ever settling even once the element is
 * genuinely clickable — confirmed via trace inspection that the locator
 * resolves correctly and nothing else covers it. */
export async function issueDefendOrder(page: Page): Promise<void> {
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: /^1 DEFEND/ }).click({ force: true })
  await expect(page.locator('main')).toHaveAttribute('data-monument-status', 'wave')
}

/** Taps the real FIRE DEFENSE button at its far edge — not a test-only input
 * hook — exactly as e2e/wave-defense-feedback.spec.ts:92 does, to register a
 * genuine hit during the targeting window. */
export async function fireDefenseAction(page: Page): Promise<void> {
  const action = page.getByRole('button', { name: 'FIRE DEFENSE', exact: false })
  const bounds = await action.boundingBox()
  if (bounds === null) throw new Error('FIRE DEFENSE button has no layout bounds.')
  await page.mouse.click(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2)
  await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'hit')
}

/** Advances a page.clock-driven timeline (via `stepper`) in bounded
 * increments until `getAttribute(attr)` on `locator` equals `expected`, or
 * throws once `maxMs` is exceeded. Generalizes the exact-elapsed-ms
 * calculations e2e/wave-defense-feedback.spec.ts performs by reading
 * `phaseElapsedMs` back out of the save — review capture doesn't need that
 * precision, just a bounded search for the moment an attribute flips. */
export async function advanceStepperUntilAttribute(
  stepper: FrameStepper,
  locator: Locator,
  attr: string,
  expected: string,
  fromMs: number,
  maxMs: number,
  stepMs = 150,
): Promise<number> {
  for (let elapsedMs = fromMs; elapsedMs <= maxMs; elapsedMs += stepMs) {
    await stepper.advanceTo(elapsedMs)
    if ((await locator.getAttribute(attr)) === expected) return elapsedMs
  }
  throw new Error(`${attr} never became "${expected}" by ${maxMs}ms (from ${fromMs}ms).`)
}
