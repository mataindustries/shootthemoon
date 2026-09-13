import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { PerspectiveCamera, Vector3 } from 'three'
import { createAcceptedCounterstrikeSave, createStrikeReadySave } from './firstStrikeFixtures.ts'
import { MONUMENT_KINDS, MONUMENTS } from '../src/domain/territoryMonument.ts'
import { deserializePrototypeSave, OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { landingSiteToRenderTransform } from '../src/render/renderCoordinates.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../src/render/octagonalKit.ts'
import { authorMonument } from '../src/scene/octagonalModels.ts'
import { territoryMonumentSite } from '../src/scene/monumentPresentation.ts'

const evidence = 'artifacts/screenshots/territory-visual-polish/orbital-repair'
const metrics: Record<string, unknown> = {}

test.afterAll(async () => {
  await mkdir('artifacts/territory-visual-polish', { recursive: true })
  await writeFile('artifacts/territory-visual-polish/orbital-repair-metrics.json', JSON.stringify(metrics, null, 2) + '\n')
})

async function readFrame(page: Page) {
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-monument-detail-visible', 'true')
  await expect(canvas).toHaveAttribute('data-claim-signal-visible', 'true')
  await expect(canvas).toHaveAttribute('data-base-details-visible', 'false')
  const frame = await canvas.evaluate(el => {
    const d = el.dataset, gl = el.getContext('webgl2')!
    return {
      position: [d.cameraX, d.cameraY, d.cameraZ].map(Number),
      target: [d.cameraTargetX, d.cameraTargetY, d.cameraTargetZ].map(Number),
      up: [d.cameraUpX, d.cameraUpY, d.cameraUpZ].map(Number),
      fov: Number(d.cameraFov), radius: Number(d.cameraRadius),
      calls: Number(d.drawCalls), triangles: Number(d.triangles), programs: Number(d.programs),
      frames: Number(d.frameCount), contextLost: gl.isContextLost(), error: gl.getError(),
    }
  })
  expect(frame.radius).toBeGreaterThan(1.18)
  expect(frame.calls).toBeGreaterThan(0)
  expect(frame.calls).toBeLessThanOrEqual(80)
  expect(frame.triangles).toBeGreaterThan(0)
  expect(frame.triangles).toBeLessThanOrEqual(120_000)
  expect(frame.programs).toBeLessThanOrEqual(24)
  expect(frame.contextLost).toBe(false)
  expect(frame.error).toBe(0)
  return frame
}

function expectSamePose(before: Awaited<ReturnType<typeof readFrame>>, after: Awaited<ReturnType<typeof readFrame>>) {
  for (const key of ['position', 'target', 'up'] as const) {
    expect(new Vector3().fromArray(before[key]).distanceTo(new Vector3().fromArray(after[key]))).toBeLessThan(.00002)
  }
  expect(after.fov).toBe(before.fov)
}

// Real production camera/control handoffs, including a pre-strike landing-basin
// claim whose close action runs the ordinary returning -> orbit phase transition.
for (const variant of [...MONUMENT_KINDS, 'CRATER_CROWN_LANDED'] as const) {
  test(`Orbital monument ${variant}: readable silhouette, continuous handoff and saved claim`, async ({ page }) => {
    test.setTimeout(150_000)
    const basin = variant === 'CRATER_CROWN_LANDED'
    const kind = basin ? 'CRATER_CROWN' : variant
    const raw = JSON.parse(basin ? createStrikeReadySave() : createAcceptedCounterstrikeSave('SUCCESS'))
    raw.outpost.monument = {
      kind, anchor: kind === 'CRATER_CROWN' && !basin ? 'impact-scar' : 'outpost',
      status: 'complete', phaseElapsedMs: 0, workMs: MONUMENTS[kind].laborMs,
      repairWorkMs: 0, health: 79, wavesResolved: 3, orders: ['DEFEND', 'DEFEND', 'DEFEND'],
      productionPenalty: 0, energyLoss: 0, oreLost: 0, completedAtMs: Date.now() - 1000, revealSeen: true,
    }
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.addInitScript(({ key, save }) => {
      if (!sessionStorage.getItem('orbital-monument-seeded')) {
        localStorage.setItem(key, save)
        sessionStorage.setItem('orbital-monument-seeded', 'true')
      }
    }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
    await page.clock.install()
    await page.goto('/')
    const main = page.locator('main')
    await expect(main).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await expect(main).toHaveAttribute('data-monument-view', 'true')
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000))
    const before = await readFrame(page)
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    for (const elapsed of [16, 80, 400]) {
      await page.clock.runFor(elapsed)
      const frame = await readFrame(page)
      expectSamePose(before, frame)
      // Keep the basin under its Crown throughout the returning phase.
      if (basin) expect(frame.triangles).toBeGreaterThanOrEqual(before.triangles)
    }
    await page.clock.fastForward(2500)
    await page.clock.runFor(32)
    expectSamePose(before, await readFrame(page))
    await expect(main).toHaveAttribute('data-phase', 'orbit')
    await expect(main).toHaveAttribute('data-monument-view', 'false')
    await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'false')
    const orbital = await readFrame(page)
    expect(orbital.frames).toBeGreaterThan(before.frames)

    // Project the actual authored mesh vertices through the production camera.
    // A visible group alone cannot prove it is on-screen or large enough to read.
    const prototype = deserializePrototypeSave(JSON.stringify(raw), Date.now())!
    const site = territoryMonumentSite(prototype.outpost!, prototype.firstStrike)
    const transform = landingSiteToRenderTransform(site)
    const camera = new PerspectiveCamera(orbital.fov, 390 / 844, .001, 80)
    camera.position.fromArray(orbital.position)
    camera.up.fromArray(orbital.up)
    camera.lookAt(new Vector3().fromArray(orbital.target))
    camera.updateMatrixWorld()
    const kit = createOctagonalKit()
    const batches = batchOctagonalModel(kit, add => authorMonument(kind, add))
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    const point = new Vector3()
    for (const batch of batches) {
      const positions = batch.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).multiplyScalar(basin ? .0005 : .001)
        point.y += .0007
        point.applyQuaternion(transform.orientation).add(transform.position).project(camera)
        minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z)
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
      }
      batch.geometry.dispose()
    }
    disposeOctagonalKit(kit)
    expect(minZ).toBeGreaterThan(-1)
    expect(maxZ).toBeLessThan(1)
    expect(minX).toBeGreaterThan(-.9)
    expect(maxX).toBeLessThan(.9)
    expect(minY).toBeGreaterThan(0)
    expect(maxY).toBeLessThan(.9)
    expect((maxX - minX) * 195).toBeGreaterThan(20)
    expect((maxY - minY) * 422).toBeGreaterThan(20)
    metrics[variant] = { ...orbital, silhouettePixels: [(maxX - minX) * 195, (maxY - minY) * 422] }
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: variant === 'HELIOS_SPIRE'
      ? `${evidence}/helios-spire-orbit.png` : `/tmp/${variant.toLowerCase()}-orbital-repair.png` })

    if (variant === 'SIGNAL_ARRAY') {
      await page.mouse.move(300, 410)
      await page.mouse.down()
      await page.mouse.move(290, 700, { steps: 12 })
      await page.mouse.up()
      await page.mouse.wheel(0, -10000)
      await page.clock.runFor(500)
      const inspected = await readFrame(page)
      expect(inspected.radius).toBeGreaterThanOrEqual(1.2)
      expect(inspected.position).not.toEqual(orbital.position)
      metrics['inspection-zoom-limit'] = inspected
    }

    // Closing early during a replay must also hand off without a camera snap.
    if (basin) {
      // The pre-strike HUD occupies the lower screen; reopen via the claim itself.
      const claim = new Vector3(0, .0297, 0).applyQuaternion(transform.orientation).add(transform.position).project(camera)
      await page.touchscreen.tap((claim.x + 1) * 195, (1 - claim.y) * 422)
    } else {
      await page.getByRole('button', { name: 'TERRITORY MONUMENTS', exact: true }).tap()
    }
    await page.getByRole('button', { name: 'REPLAY ORBITAL REVEAL', exact: true }).tap()
    await page.clock.runFor(100)
    const earlyReveal = await readFrame(page)
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.clock.runFor(32)
    expectSamePose(earlyReveal, await readFrame(page))
    await page.clock.resume()
    await page.reload()
    await expect(main).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await expect(main).toHaveAttribute('data-monument-view', 'true')
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000))
    await expect(main).toHaveAttribute('data-territory-claimed', 'true')
    await expect(main).toHaveAttribute('data-monument-reveal', 'false')
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.clock.fastForward(2800)
    await page.clock.runFor(32)
    expectSamePose(orbital, await readFrame(page))
    const reloaded = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
    expect(reloaded.outpost.monument).toEqual(saved.outpost.monument)
    expect(reloaded.firstStrike.scar).toEqual(saved.firstStrike.scar)
    expect(reloaded.counterstrike).toEqual(saved.counterstrike)
    expect(errors).toEqual([])
  })
}
