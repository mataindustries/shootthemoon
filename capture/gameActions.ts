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

/** Reads whichever mineral deposit's projected position is currently on the
 * canvas (data-deposit-<id>-x/y, from src/scene/MineralDeposits.tsx), if
 * any — null if the claimed site has none nearby. */
async function findProjectedDeposit(
  page: Page,
): Promise<{ readonly x: number; readonly y: number } | null> {
  const canvas = page.locator('.scene-canvas canvas')
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const xKey = Object.keys(element.dataset).find(
      (key) => key.startsWith('deposit') && key.endsWith('X'),
    )
    if (xKey === undefined) return null
    const yKey = xKey.slice(0, -1) + 'Y'
    return { x: Number(element.dataset[xKey]), y: Number(element.dataset[yKey]) }
  })
}

/**
 * From FRESH: claims the default (canvas-center) site and skips descent to
 * landed, then selects whichever deposit is projected onto the canvas
 * (mirrors e2e/moon-core.spec.ts's tapProjectedPoint), clicks MINE DEPOSIT,
 * and pauses the live simulation once the robot actually reaches 'mining' —
 * mirrors e2e/mining-asset-pass.spec.ts's holdState() (a MutationObserver
 * dispatching first-outpost:set-simulation-paused on the state transition).
 *
 * Not every canvas-center site has a deposit close enough to be projected
 * (e2e/moon-core.spec.ts's own working 'deposit-gamma' example only finds
 * one after dragging the camera first, which this harness's shots don't
 * do); repositioning the orbit view first via moon-core:set-orbit-view
 * before any player interaction was tried and made site selection itself
 * unreliable (`controls.enabled` looks to gate that handler and isn't
 * necessarily true yet at that point), so this deliberately does not
 * attempt that. If no deposit is present, this throws a clearly labeled
 * error rather than silently producing a shot that doesn't show mining —
 * capture.spec.ts will report the failure for this shot to be revisited by
 * hand (e.g. picking a specific known-deposit fixture) rather than this
 * generic helper guessing further.
 */
export async function reachMiningCloseup(page: Page): Promise<void> {
  await claimDefaultLandingSite(page)
  await setCinematicProgress(page, 1)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')

  const point = await findProjectedDeposit(page)
  if (point === null) {
    throw new Error(
      'No mineral deposit is projected onto the canvas at this landing site ' +
        '(claimDefaultLandingSite picks whichever site is nearest canvas ' +
        'center, which is not guaranteed to have one nearby).',
    )
  }
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('main')).toHaveAttribute('data-selected-deposit', /^deposit-/)

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
  await expect(page.locator('.scene-canvas canvas')).toHaveAttribute('data-mining-laser', 'contact')
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
  readonly outcome?: 'SUCCESS' | 'FAILURE'
}

/** Tracks the counterstrike and prioritizes the interceptor order (the same
 * setup reachCounterstrikeFireNow performs above), then pins the run to an
 * arbitrary status/progress via the same counterstrike:set-run test hook.
 * Generalizes reachCounterstrikeFireNow's single 'intercept-ready' pin to
 * any status e2e/counterstrike.spec.ts's own RunDetail supports (tracking,
 * intercept-ready, interceptor-launched, success, impact, ...). */
export async function reachCounterstrikeRun(
  page: Page,
  detail: CounterstrikeRunDetail,
): Promise<void> {
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-available', 'true')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await page.evaluate(
    (value) => window.dispatchEvent(new CustomEvent('counterstrike:set-run', { detail: value })),
    detail,
  )
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', detail.status)
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
