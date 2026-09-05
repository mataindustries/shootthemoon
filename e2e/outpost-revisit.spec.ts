import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { PerspectiveCamera } from 'three'
import { landingSiteToRenderTransform } from '../src/render/renderCoordinates.ts'
import { OUTPOST_STORAGE_KEY, deserializePrototypeSave } from '../src/persistence/outpostSave.ts'
import { calculateOutpostOperations } from '../src/simulation/outpostOperations.ts'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'

const EVIDENCE = 'artifacts/screenshots/outpost-operations'

async function saved(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY)
  const snapshot = deserializePrototypeSave(raw!, 1_000_000)!
  expect(snapshot).not.toBeNull()
  return snapshot
}

// Only active-surface production and its time baselines may change on a visit.
function stableFacts(snapshot: Awaited<ReturnType<typeof saved>>) {
  // Save normalization stamps these records on every write; authored event
  // timestamps (including the accepted outcome) remain part of the comparison.
  const { updatedAtMs: _rivalWrite, ...rival } = snapshot.rival
  const { updatedAtMs: _strikeWrite, ...firstStrike } = snapshot.firstStrike
  const { updatedAtMs: _updated, lunarOre: _ore, operations, extractor, ...outpost } = snapshot.outpost
  const { lastUpdatedAtMs: _operationTime, ...operatingSettings } = operations
  const { lastProductionAtMs: _productionTime, ...building } = extractor!
  return { ...snapshot, rival, firstStrike, outpost: { ...outpost, operations: operatingSettings, extractor: building } }
}

async function enterOperations(page: Page) {
  const main = page.locator('main')
  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  // Use the real saved-site camera journey, including in an ordinary build.
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  await expect(page.getByRole('region', { name: 'Outpost operations', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', 'surface-player')
  await expect(page.locator('.strike-complete-status')).toHaveCount(0)
}

async function cameraGesture(page: Page, pinch: boolean) {
  const session = await page.context().newCDPSession(page)
  const points = (step: number) => pinch
    ? [{ id: 1, x: 140 - step * 3, y: 310 }, { id: 2, x: 220 + step * 3, y: 310 }]
    : [{ id: 1, x: 160 + step * 6, y: 310 + step * 2 }]
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) })
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) })
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

async function capture(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Outpost operations', exact: true })
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await panel.evaluate((panel) => Array.from(panel.querySelectorAll('.operations-metrics > div')).every((cell) => {
    const box = cell.getBoundingClientRect()
    return Array.from(cell.children).every((child) => {
      const text = child.getBoundingClientRect()
      return text.left >= box.left && text.right <= box.right && child.scrollWidth <= child.clientWidth
    })
  }))).toBe(true)
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` })
  const metrics = await page.locator('canvas').evaluate((canvas) => ({
    drawCalls: Number(canvas.dataset.drawCalls), triangles: Number(canvas.dataset.triangles),
    geometries: Number(canvas.dataset.geometries), textures: Number(canvas.dataset.textures),
    programs: Number(canvas.dataset.programs), cameraMode: canvas.dataset.cameraMode,
  }))
  console.log(`OUTPOST_REVISIT ${name} ${JSON.stringify(metrics)}`)
  expect(metrics.drawCalls).toBeGreaterThan(0)
  expect(metrics.drawCalls).toBeLessThanOrEqual(80)
  expect(metrics.triangles).toBeLessThanOrEqual(200_000)
  expect(metrics.programs).toBeLessThanOrEqual(24)
}

test.beforeAll(async ({ request }) => {
  await mkdir(EVIDENCE, { recursive: true })
  expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
})

for (const outcome of ['FAILURE', 'SUCCESS'] as const) {
  test(`accepted ${outcome} ending returns to persistent operations with real camera and touch`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const raw = JSON.parse(createAcceptedCounterstrikeSave(outcome))
    raw.outpost.lunarOre = 100.25
    raw.outpost.operations.mode = 'OVERDRIVE'
    raw.outpost.operations.storageCapacity = 320
    await page.addInitScript(({ key, value }) => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    }, { key: OUTPOST_STORAGE_KEY, value: JSON.stringify(raw) })
    await page.goto('/')
    await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: 'CONTINUE' }).tap()
    const initial = await saved(page)
    const expected = calculateOutpostOperations(initial.outpost, initial.counterstrike.outpostDamageState)
    await enterOperations(page)
    const main = page.locator('main')
    await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', outcome)
    await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
    await expect(main).toHaveAttribute('data-outpost-damage-state', outcome === 'FAILURE' ? 'DAMAGED' : 'INTACT')
    expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
    if (outcome === 'FAILURE') {
      await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-damage-field', 'persistent')
      await expect(page.getByText('OUTPOST DAMAGED · −30% PRODUCTION', { exact: true })).toBeVisible()
      expect(expected.productionPerMin).toBeCloseTo(calculateOutpostOperations(initial.outpost, 'INTACT').productionPerMin * 0.7, 10)
    } else {
      await expect(page.locator('.operations-damage')).toHaveCount(0)
      expect(expected.damageMultiplier).toBe(1)
    }
    const energy = await page.locator('.operations-metrics > div').first().innerText()
    const canvas = page.locator('canvas')
    await capture(page, `09-${outcome.toLowerCase()}-default-portrait`)
    const startFrame = Number(await canvas.getAttribute('data-frame-count'))
    await page.waitForTimeout(1_400)
    const idleFrames = Number(await canvas.getAttribute('data-frame-count')) - startFrame
    console.log(`OUTPOST_OPERATIONS_IDLE ${outcome} ${JSON.stringify({ frames: idleFrames, durationMs: 1400 })}`)
    expect(idleFrames).toBeLessThanOrEqual(16)
    const azimuth = await canvas.getAttribute('data-camera-azimuth')
    await cameraGesture(page, false)
    await page.waitForTimeout(1_200)
    await expect(canvas).not.toHaveAttribute('data-camera-azimuth', azimuth!)
    const distance = await canvas.getAttribute('data-camera-distance')
    await cameraGesture(page, true)
    await page.waitForTimeout(1_200)
    await expect(canvas).not.toHaveAttribute('data-camera-distance', distance!)
    await expect(main).toHaveAttribute('data-selected-deposit', 'none')
    await capture(page, `07-${outcome.toLowerCase()}-operations-portrait`)
    await page.setViewportSize({ width: 844, height: 390 })
    await capture(page, `08-${outcome.toLowerCase()}-operations-landscape`)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(stableFacts(await saved(page))).toEqual(stableFacts(initial))
    expect((await saved(page)).outpost.lunarOre).toBeGreaterThan(initial.outpost.lunarOre)

    // Refresh while at the outpost: restore the accepted ending, never a cinematic.
    // Capture the final persisted surface state in the browser's exit task;
    // production may legitimately tick between a Node snapshot and navigation.
    await page.evaluate((key) => {
      window.addEventListener('pagehide', () => {
        sessionStorage.setItem('revisit-exit-save', localStorage.getItem(key)!)
      }, { once: true })
    }, OUTPOST_STORAGE_KEY)
    await page.reload()
    await page.getByRole('button', { name: 'CONTINUE' }).tap()
    await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
    await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
    const refreshed = await saved(page)
    expect(stableFacts(refreshed)).toEqual(stableFacts(initial))
    const exitRaw = await page.evaluate(() => sessionStorage.getItem('revisit-exit-save'))
    const beforeRefresh = deserializePrototypeSave(exitRaw!, 1_000_000)!
    expect(stableFacts(beforeRefresh)).toEqual(stableFacts(initial))
    expect(refreshed.outpost.lunarOre).toBe(beforeRefresh.outpost.lunarOre)
    await page.waitForTimeout(1_200)
    expect((await saved(page)).outpost.lunarOre).toBe(refreshed.outpost.lunarOre)
    await enterOperations(page)
    expect(await page.locator('.operations-metrics > div').first().innerText()).toBe(energy)
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 15_000 })
    const inOrbit = await saved(page)
    await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
    // Ordinary sessions deliberately omit harness-only signal coordinates.
    const pose = await canvas.evaluate((element) => ({ ...element.dataset }))
    const viewport = page.viewportSize()!
    const camera = new PerspectiveCamera(58, viewport.width / viewport.height, 0.01, 80)
    camera.position.set(Number(pose.cameraX), Number(pose.cameraY), Number(pose.cameraZ))
    camera.lookAt(Number(pose.cameraTargetX), Number(pose.cameraTargetY), Number(pose.cameraTargetZ))
    camera.updateMatrixWorld()
    const sitePosition = landingSiteToRenderTransform(initial.outpost.site).position.multiplyScalar(1.00038)
    // A projected point alone can be on the far side of the Moon.
    expect(sitePosition.dot(camera.position)).toBeGreaterThan(sitePosition.lengthSq())
    const signal = sitePosition.project(camera)
    const x = (signal.x + 1) * viewport.width / 2
    const y = (1 - signal.y) * viewport.height / 2
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(viewport.width)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(viewport.height)
    await page.touchscreen.tap(x, y)
    await expect(main).toHaveAttribute('data-phase', 'selected')
    await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
    await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
    const revisited = await saved(page)
    expect(stableFacts(revisited)).toEqual(stableFacts(initial))
    expect(revisited.outpost.lunarOre - inOrbit.outpost.lunarOre).toBeLessThan(expected.productionPerMin / 60)
    await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
    await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
    expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
    expect(errors).toEqual([])
  })
}
