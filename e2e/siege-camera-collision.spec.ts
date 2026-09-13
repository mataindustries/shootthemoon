import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createAcceptedCounterstrikeSave, createCompletedStrikeSave } from './firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { deserializePrototypeSave, OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createRivalRevealCameraPlan } from '../src/camera/rivalCameraPlan.ts'
import { getSurfaceCameraPose } from '../src/camera/touchdownCameraPlan.ts'
import { createSurfaceTerrainProfile } from '../src/render/surfaceTerrain.ts'
import { landingSiteToRenderTransform } from '../src/render/renderCoordinates.ts'
import { PerspectiveCamera, Vector3 } from 'three'

const evidence = 'artifacts/screenshots/siege-camera-collision'
async function open(page: Page, save: string) {
  await page.clock.install()
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: OUTPOST_STORAGE_KEY, value: save })
  await page.goto('/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  // Completed campaigns offer monuments before the older camera workflow.
  if (deserializePrototypeSave(save)!.firstStrike?.status === 'COMPLETE') {
    await page.getByRole('button', { name: 'Close Territory Monuments' }).click()
  }
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 2000))
}
async function step(page: Page, ms: number) {
  await page.clock.fastForward(ms)
  await page.clock.runFor(32)
}
async function pose(page: Page) {
  return page.locator('canvas').evaluate((canvas) => {
    const d = canvas.dataset
    return [d.cameraX, d.cameraY, d.cameraZ, d.cameraTargetX, d.cameraTargetY, d.cameraTargetZ, d.cameraUpX, d.cameraUpY, d.cameraUpZ].map(Number)
  })
}
async function drag(page: Page) {
  await page.mouse.move(180, 270)
  await page.mouse.down()
  await page.mouse.move(290, 310, { steps: 8 })
  await page.mouse.up()
}
function expectPose(actual: number[], expected: { position: { toArray(): number[] }; target: { toArray(): number[] }; up: { toArray(): number[] } }) {
  const values = [...expected.position.toArray(), ...expected.target.toArray(), ...expected.up.toArray()]
  actual.forEach((v, i) => expect(v).toBeCloseTo(values[i]!, 5))
}

test.beforeAll(async ({ request }) => {
  await mkdir(evidence, { recursive: true })
  expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
})

test('touchdown owns one transition, rejects drag, and settles on the normal outpost pose', async ({ page }) => {
  const save = createAcceptedCounterstrikeSave('SUCCESS')
  const outpost = deserializePrototypeSave(save)!.outpost
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await open(page, save)
  // Closing monuments returns to normal orbit; revisit through the saved claim beacon.
  const orbitalPose = await pose(page)
  const camera = new PerspectiveCamera(Number(await page.locator('canvas').getAttribute('data-camera-fov')), 390 / 844, .001, 80)
  camera.position.fromArray(orbitalPose.slice(0, 3))
  camera.up.fromArray(orbitalPose.slice(6, 9))
  camera.lookAt(new Vector3().fromArray(orbitalPose.slice(3, 6)))
  camera.updateMatrixWorld()
  const beacon = landingSiteToRenderTransform(outpost.site).position.multiplyScalar(1.00038).project(camera)
  await page.locator('canvas').click({ position: { x: (beacon.x + 1) * 195, y: (1 - beacon.y) * 422 } })
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'true')
  await step(page, 2400)
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', 'touchdown-transition')
  const middle = await pose(page)
  await drag(page)
  expect(await pose(page)).toEqual(middle)
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'true')
  await step(page, 3900)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'false')
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', 'surface-player')
  expectPose(await pose(page), getSurfaceCameraPose(outpost.site, createSurfaceTerrainProfile(outpost.site), 32))
  const settled = await pose(page)
  await step(page, 300)
  expect(await pose(page)).toEqual(settled)
  await page.screenshot({ path: `${evidence}/touchdown.png` })
  await drag(page)
  expect(await pose(page)).not.toEqual(settled)
  expect(errors).toEqual([])
})

test('enemy reveal uses the fixed installation pose and smoothly returns to its authored orbit', async ({ page }) => {
  const save = createLegacyActiveExtractorSave()
  const saved = deserializePrototypeSave(save)!
  const plan = createRivalRevealCameraPlan(saved.outpost.site, saved.rival.site, 390 / 844)
  await open(page, save)
  await drag(page)
  await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).click()
  await step(page, 2500)
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'warning')
  expectPose(await pose(page), plan.playerWidePose)
  await step(page, 2700)
  await step(page, 5900)
  await step(page, 4900)
  await step(page, 2700)
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'intro-transmission')
  expectPose(await pose(page), plan.rivalSurfacePose)
  const reveal = await pose(page)
  await drag(page)
  expect(await pose(page)).toEqual(reveal)
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'true')
  await page.screenshot({ path: `${evidence}/enemy-reveal.png` })
  await step(page, 7100)
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'dual-sites')
  await step(page, 3600)
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'idle')
  expectPose(await pose(page), plan.dualSitePose)
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-input-locked', 'false')
})

test('swept contact removes both rockets once, holds the collision camera and starts the explosion there', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await open(page, createCompletedStrikeSave())
  const main = page.locator('main'), canvas = page.locator('canvas')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /HARDEN OUTPOST/ }).click()
  await step(page, 1100)
  await step(page, 3300)
  await step(page, 5900)
  await page.getByRole('button', { name: /FIRE NOW.*FIRE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'VALID')
  const contactProgress = Number(await main.getAttribute('data-counterstrike-contact-progress'))
  expect(contactProgress).toBeGreaterThan(.5)
  expect(contactProgress).toBeLessThan(1)
  // Deliberately step from flight to beyond contact, as on a dropped mobile frame.
  await step(page, Math.floor(4600 * contactProgress) - 100)
  await expect(canvas).toHaveAttribute('data-counterstrike-threats', '1')
  await expect(canvas).toHaveAttribute('data-counterstrike-interceptors', '1')
  const before = await pose(page)
  await step(page, 120)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'success')
  await expect(canvas).toHaveAttribute('data-counterstrike-threats', '0')
  await expect(canvas).toHaveAttribute('data-counterstrike-interceptors', '0')
  await expect(canvas).toHaveAttribute('data-counterstrike-contact', 'contact')
  await expect(canvas).toHaveAttribute('data-counterstrike-camera-beat', 'interception-hold')
  const held = await pose(page)
  // No jump to a late endpoint after the authoritative collision.
  expect(Math.hypot(...held.slice(0, 3).map((v, i) => v - before[i]!))).toBeLessThan(.015)
  const point = await canvas.getAttribute('data-counterstrike-contact-point')
  expect(point?.split(',').every((v) => Number.isFinite(Number(v)))).toBe(true)
  await step(page, 300)
  expect(await pose(page)).toEqual(held)
  expect(await canvas.getAttribute('data-counterstrike-contact-point')).toBe(point)
  await page.screenshot({ path: `${evidence}/interceptor-contact.png` })
  await step(page, 6500)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', 'SUCCESS')
  expect(errors).toEqual([])
})
