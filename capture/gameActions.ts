/**
 * Small, shot-specific page actions built on top of `initCapture.ts`.
 *
 * Every dispatched CustomEvent below is an existing production test hook
 * (gated behind the `?e2e` + VITE_E2E_HARNESS flag via
 * `src/testing/e2eHarness.ts`), copied verbatim from the matching pattern in
 * e2e/moon-core.spec.ts, e2e/first-strike.spec.ts, e2e/counterstrike.spec.ts,
 * and e2e/helios-reactor.spec.ts. None of it is new production surface.
 */
import { expect, type Page } from '@playwright/test'

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
