import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'

test.use({ trace: 'off' })

test('portrait deposit taps and mining survive Solar Wing construction and refresh', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (!localStorage.getItem(key)) localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save: createLegacyActiveExtractorSave() })
  await page.goto('/?e2e')
  const main = page.locator('main')
  const canvas = page.locator('canvas')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await expect(main).toHaveAttribute('data-phase', 'landed')

  async function selectAll() {
    for (const id of ['alpha', 'beta', 'gamma']) {
      await expect(canvas).toHaveAttribute(`data-deposit-${id}-x`, /\d/)
      const { x, y } = await canvas.evaluate((element, id) => ({
        x: Number(element.getAttribute(`data-deposit-${id}-x`)),
        y: Number(element.getAttribute(`data-deposit-${id}-y`)),
      }), id)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(390)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(844)
      // Real touch must reach the scene, not a covering HUD element.
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x, y })).toBe('CANVAS')
      await page.touchscreen.tap(x, y)
      await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
      const command = page.locator(`button[data-deposit-id="deposit-${id}"]`)
      if (id === 'alpha') await expect(command).toBeDisabled()
      else {
        await expect(command).toBeEnabled()
        expect((await command.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
    }
  }
  await selectAll()
  await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
  await page.getByRole('button', { name: /^SOLAR WING/ }).tap()
  await expect(main).toHaveAttribute('data-module-status', 'active')
  await selectAll()
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await expect(main).toHaveAttribute('data-module-status', 'active')
  await selectAll()
  for (const id of ['gamma', 'beta']) {
    await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
    // The camera eases back from the extraction close-up after idle starts.
    await page.waitForTimeout(1_200)
    const point = await canvas.evaluate((element, id) => ({
      x: Number(element.getAttribute(`data-deposit-${id}-x`)),
      y: Number(element.getAttribute(`data-deposit-${id}-y`)),
    }), id)
    await page.touchscreen.tap(point.x, point.y)
    await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
    await page.locator(`button[data-deposit-id="deposit-${id}"]`).tap()
    await expect(main).toHaveAttribute('data-robot-state', 'traveling')
    await expect(main).toHaveAttribute('data-robot-state', 'mining')
    if (id === 'gamma') {
      await mkdir('artifacts/screenshots/outpost-polish', { recursive: true })
      await page.screenshot({ path: 'artifacts/screenshots/outpost-polish/laser-extraction.png' })
    }
    await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20_000 })
  }
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  // Widen the inspection view using the existing camera controls.
  await page.mouse.move(195, 350)
  await page.mouse.wheel(0, 1_000)
  await page.mouse.down()
  await page.mouse.move(345, 310, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: 'artifacts/screenshots/outpost-polish/portrait.png' })
  expect(errors).toEqual([])
})
