import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createStrikeReadySave } from './firstStrikeFixtures.ts'
import { MONUMENT_KINDS, MONUMENTS, type MonumentKind } from '../src/domain/territoryMonument.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'

// Crater Crown QA regression: a monument sharing the landed outpost's anchor must not fill or
// intersect the close base-detail camera. This proves the shared monument-detail visibility
// policy (src/scene/monumentPresentation.ts) applies uniformly across all four monument kinds.
//
// The monument is seeded with workMs at its labor cap (full-size detail geometry, exactly as a
// completed monument would render it) but status "constructing", the only active status whose
// panel leaves "BACK TO OUTPOST" reachable ("command" and "wave" hide it until an order is
// chosen, by design). "Complete" status itself is unreachable from this close view in the shipped
// UI: a finished monument's own claim marker replaces the outpost's orbital signal, so the only
// interactive path back to it is the dedicated monument/claimed-orbit presentation, never the
// landed base camera. Unit coverage in src/scene/monumentPresentation.test.ts separately proves
// the policy is a pure function of camera radius, so it is exactly as blind to "complete" as it
// is to any other active status.
const EVIDENCE = 'artifacts/screenshots/monument-base-detail'
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
] as const

async function frameMetrics(page: Page) {
  const metrics = await page.locator('canvas').evaluate(el => {
    const d = el.dataset, gl = el.getContext('webgl2')!
    return { calls: Number(d.drawCalls), triangles: Number(d.triangles), geometries: Number(d.geometries),
      textures: Number(d.textures), programs: Number(d.programs),
      baseDetailsVisible: d.baseDetailsVisible, monumentDetailVisible: d.monumentDetailVisible,
      cameraMode: d.cameraMode, renderMode: document.querySelector('main')?.getAttribute('data-render-mode'),
      error: gl.getError(), contextLost: gl.isContextLost() }
  })
  expect(metrics.calls).toBeGreaterThan(0)
  expect(metrics.calls).toBeLessThanOrEqual(80)
  expect(metrics.triangles).toBeLessThanOrEqual(120_000)
  expect(metrics.programs).toBeLessThanOrEqual(24)
  expect(metrics.error).toBe(0)
  expect(metrics.contextLost).toBe(false)
  return metrics
}

for (const kind of MONUMENT_KINDS) for (const viewport of VIEWPORTS) {
  test(`${kind} landed outpost close-up at ${viewport.name}: monument detail stays clear of the base camera`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const raw = JSON.parse(createStrikeReadySave())
    raw.outpost.lunarOre = 230
    raw.outpost.monument = {
      kind, anchor: 'outpost', status: 'constructing', phaseElapsedMs: 0, workMs: MONUMENTS[kind as MonumentKind].laborMs,
      repairWorkMs: 0, health: 100, wavesResolved: 0, orders: [null, null, null],
      productionPenalty: 0, energyLoss: 0, oreLost: 0, completedAtMs: null, revealSeen: false,
    }
    await page.addInitScript(({ key, save }) => localStorage.setItem(key, save), { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
    await page.clock.install()
    await page.goto('/')
    const main = page.locator('main'), canvas = page.locator('canvas')
    await expect(main).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    // The first continue auto-opens the dedicated monument presentation; leave it for the base view under test.
    await expect(main).toHaveAttribute('data-monument-view', 'true')
    await expect(main).toHaveAttribute('data-monument-status', 'constructing')
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 2000))
    await expect(canvas).toHaveAttribute('data-monument-detail-visible', 'true')
    const backToOutpost = page.getByRole('button', { name: 'BACK TO OUTPOST', exact: true })
    await backToOutpost.scrollIntoViewIfNeeded()
    await backToOutpost.tap()
    await expect(main).toHaveAttribute('data-monument-view', 'false')
    await expect(main).toHaveAttribute('data-phase', 'landed')
    await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
    await page.clock.runFor(500)

    // The close landed-outpost/base-detail presentation: the monument sits at the same anchor,
    // so its detail geometry must be hidden while the base itself is the subject.
    await expect(canvas).toHaveAttribute('data-base-details-visible', 'true')
    await expect(canvas).toHaveAttribute('data-monument-detail-visible', 'false')
    const metrics = await frameMetrics(page)
    expect(metrics.cameraMode).toBe('surface-player')

    await mkdir(EVIDENCE, { recursive: true })
    await page.screenshot({ path: `${EVIDENCE}/${kind.toLowerCase()}-${viewport.name}.png` })

    // Gameplay/domain state is untouched by the presentation-only fix.
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
    expect(saved.outpost.monument).toMatchObject({ kind, anchor: 'outpost', status: 'constructing', health: 100 })
    expect(errors).toEqual([])
  })
}
