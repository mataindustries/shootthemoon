import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'

test.use({ trace: 'off', actionTimeout: 15_000 })
const stage = process.env.MINING_ASSET_EVIDENCE ?? 'after'
const directory = `artifacts/screenshots/mining-asset-pass/${stage}`

async function pause(page: Page, paused: boolean) {
  await page.evaluate(paused => window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused } })), paused)
}

async function enterDamagedSurface(page: Page) {
  await page.getByRole('button', { name: 'BACK TO OUTPOST', exact: true }).tap()
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-outpost-signal-x', /\d/)
  const signal = await canvas.evaluate(element => ({ x: Number(element.dataset.outpostSignalX), y: Number(element.dataset.outpostSignalY) }))
  await page.touchscreen.tap(signal.x, signal.y)
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
}

async function install(page: Page, damaged = false) {
  await mkdir(directory, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(damaged ? createAcceptedCounterstrikeSave('FAILURE') : createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 80
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (!localStorage.getItem(key)) localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
  await page.goto('/?e2e')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  if (damaged) await enterDamagedSurface(page)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')
  await page.waitForTimeout(1_500)
  return errors
}

async function capture(page: Page, name: string) {
  const canvas = page.locator('canvas')
  const metrics = await canvas.evaluate(element => ({ ...element.dataset }))
  await writeFile(`${directory}/${name}-metrics.json`, JSON.stringify(metrics, null, 2))
  const context = await canvas.evaluate(element => {
    const gl = element.getContext('webgl2')!
    return { lost: gl.isContextLost(), error: gl.getError() }
  })
  expect(context).toEqual({ lost: false, error: 0 })
  expect(Number(metrics.drawCalls)).toBeGreaterThan(0)
  expect(Number(metrics.triangles)).toBeGreaterThan(0)
  if (stage !== 'before') expect(Number(metrics.drawCalls)).toBeLessThanOrEqual(80)
  expect(Number(metrics.triangles)).toBeLessThanOrEqual(200_000)
  expect(Number(metrics.programs)).toBeLessThanOrEqual(24)
  expect(Number(metrics.textures)).toBeLessThanOrEqual(6)
  if (stage !== 'before' && /gantry|small|restored/.test(name)) {
    const bounds = JSON.parse(metrics.moduleBounds!) as number[]
    const size = page.viewportSize()!
    expect(bounds[0]).toBeGreaterThan(0)
    expect(bounds[1]).toBeGreaterThan(0)
    expect(bounds[2]).toBeLessThan(size.width)
    expect(bounds[3]).toBeLessThan(size.height)
  }
  await page.screenshot({ path: `${directory}/${name}.png` })
  // These supplemental inspection images retain the exact game camera. The
  // ordinary images keep all HUD/controls, including the existing large
  // Orbital Platform objective that covers most of the portrait scene.
  if (!name.includes('orbit')) {
    const style = await page.addStyleTag({ content: '.hud, .operations-panel, .outpost-panel { visibility: hidden !important }' })
    await page.screenshot({ path: `${directory}/${name}-assets.png` })
    await style.evaluate(element => element.remove())
  }
}

async function holdState(page: Page, target: 'mining' | 'returning') {
  await page.evaluate(target => {
    const main = document.querySelector('main')!
    const observer = new MutationObserver(() => {
      if (main.getAttribute('data-robot-state') !== target) return
      window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } }))
      observer.disconnect()
    })
    observer.observe(main, { attributes: true, attributeFilter: ['data-robot-state'] })
  }, target)
}

test('mining assets remain visible through working and cargo return', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = await install(page)
  const main = page.locator('main'), canvas = page.locator('canvas')
  await pause(page, true)
  await capture(page, '01-outpost-portrait')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1_000)
  await capture(page, '02-outpost-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await pause(page, false)
  if (stage !== 'before') {
    for (const [mode, count] of [['CONSERVE', 1], ['OVERDRIVE', 3], ['BALANCED', 2]] as const) {
      await page.getByRole('button', { name: mode, exact: true }).tap()
      await expect(main).toHaveAttribute('data-operation-active-robots', String(count))
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-worker-states')) ?? '[]').length).toBe(count)
    }
    const poses = await canvas.getAttribute('data-worker-poses')
    await expect.poll(() => canvas.getAttribute('data-worker-poses')).not.toBe(poses)
  }
  await page.waitForTimeout(500)
  const point = await canvas.evaluate(element => ({ x: Number(element.dataset.depositBetaX), y: Number(element.dataset.depositBetaY) }))
  await page.touchscreen.tap(point.x, point.y)
  await expect(main).toHaveAttribute('data-selected-deposit', 'deposit-beta')
  await holdState(page, 'mining')
  await page.locator('button[data-deposit-id="deposit-beta"]').tap()
  await expect(main).toHaveAttribute('data-robot-state', 'mining', { timeout: 20_000 })
  await expect(canvas).toHaveAttribute('data-mining-laser', 'contact')
  await page.waitForTimeout(2_000)
  await capture(page, '03-mining-portrait')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1_000)
  await capture(page, '04-mining-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await pause(page, false)
  await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20_000 })
  // A separate real job records cargo return: the long screenshot hold resumes
  // at wall time, as the existing presentation harness intentionally specifies.
  await holdState(page, 'returning')
  await page.locator('button[data-deposit-id="deposit-beta"]').tap()
  await expect(main).toHaveAttribute('data-robot-state', 'returning', { timeout: 20_000 })
  await page.waitForTimeout(1_000)
  await capture(page, '05-return-portrait')
  await pause(page, false)
  await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20_000 })
  expect(errors).toEqual([])
})

test('repair cradle construction and refresh retain their state and visibility', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = await install(page, true)
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  await expect(main).toHaveAttribute('data-production-damage-penalty', '0.15')
  await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
  await page.getByRole('button', { name: /^REPAIR GANTRY/ }).tap()
  await expect(main).toHaveAttribute('data-module-status', 'active')
  await pause(page, true)
  expect(Number(await main.getAttribute('data-module-repair-progress'))).toBeLessThan(1)
  await capture(page, '06-gantry-portrait')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1_000)
  await capture(page, '07-gantry-desktop')
  await page.setViewportSize({ width: 320, height: 568 })
  await page.waitForTimeout(800)
  await capture(page, '08-small-portrait')
  await page.setViewportSize({ width: 390, height: 844 })
  await pause(page, false)
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'INTACT', { timeout: 20_000 })
  await expect(main).toHaveAttribute('data-module-repair-progress', '1')
  await expect(main).toHaveAttribute('data-production-damage-penalty', '0')
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await enterDamagedSurface(page)
  await expect(main).toHaveAttribute('data-outpost-module', 'REPAIR_GANTRY')
  await expect(main).toHaveAttribute('data-module-status', 'active')
  await expect(main).toHaveAttribute('data-module-repair-progress', '1')
  await page.waitForTimeout(1_000)
  await capture(page, '09-restored')
  expect(errors).toEqual([])
})

test('orbit hides the surface mining system', async ({ page }) => {
  const errors = await install(page)
  const main = page.locator('main'), canvas = page.locator('canvas')
  await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 15_000 })
  await page.waitForTimeout(1_000)
  await expect(canvas).toHaveAttribute('data-base-details-visible', 'false')
  await capture(page, '10-orbit')
  expect(errors).toEqual([])
})
