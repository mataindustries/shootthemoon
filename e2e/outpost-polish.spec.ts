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
    // Hold the real mining transition so software rendering cannot advance
    // to return travel while the effect screenshot is being captured.
    await page.evaluate(() => {
      const main = document.querySelector('main')!
      const observer = new MutationObserver(() => {
        if (main.getAttribute('data-robot-state') !== 'mining') return
        window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } }))
        observer.disconnect()
      })
      observer.observe(main, { attributes: true, attributeFilter: ['data-robot-state'] })
    })
    await page.locator(`button[data-deposit-id="deposit-${id}"]`).tap()
    await expect(main).toHaveAttribute('data-robot-state', 'traveling')
    await expect(main).toHaveAttribute('data-robot-state', 'mining')
    await expect(canvas).toHaveAttribute('data-mining-laser', 'contact')
    await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-focus-mining')
    // Wait for contact framing to settle; effect animation may still render.
    // Sample pixels only then, so screenshot coordinates cannot lag the camera.
    await expect.poll(async () => {
      const before = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[] | undefined
      await page.waitForTimeout(500)
      const after = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[] | undefined
      return !!before && !!after && Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!) < 0.001
    }, { timeout: 20_000 }).toBe(true)
    const effects = JSON.parse((await canvas.getAttribute('data-hero-framing'))!) as Record<string, number[]>
    for (const name of ['mining-laser-beam', 'mining-contact-glow']) {
      expect(effects[name], name).toBeDefined()
      expect(Math.abs(effects[name]![0]!)).toBeLessThan(0.95)
      expect(Math.abs(effects[name]![1]!)).toBeLessThan(0.95)
      expect(effects[name]![2]!).toBeLessThan(1)
      const point = { x: (effects[name]![0]! + 1) * 195, y: (1 - effects[name]![1]!) * 422 }
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point), `${name} must clear the HUD`).toBe('CANVAS')
    }
    const shot = await page.screenshot()
    const contact = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[]
    const visibleGlowPixels = await page.evaluate(async ({ png, x, y }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      const sample = document.createElement('canvas')
      sample.width = 18
      sample.height = 18
      const context = sample.getContext('2d')!
      context.drawImage(image, Math.round(x) - 9, Math.round(y) - 9, 18, 18, 0, 0, 18, 18)
      const pixels = context.getImageData(0, 0, 18, 18).data
      let count = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 140 && pixels[i + 1]! > 110 && pixels[i + 2]! > 75 && pixels[i]! > pixels[i + 1]!) count++
      }
      return count
    }, { png: shot.toString('base64'), x: (contact[0]! + 1) * 195, y: (1 - contact[1]!) * 422 })
    expect(visibleGlowPixels, 'warm contact glow must remain visible over the translucent terrain').toBeGreaterThan(2)
    expect(Number(await canvas.getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80)
    expect(Number(await canvas.getAttribute('data-programs'))).toBeLessThanOrEqual(24)
    if (id === 'gamma') {
      await mkdir('artifacts/screenshots/outpost-polish', { recursive: true })
      await page.screenshot({ path: 'artifacts/screenshots/outpost-polish/laser-extraction.png' })
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: false } })))
    await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20_000 })
    await expect(canvas).toHaveAttribute('data-mining-laser', 'off')
    await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-laser-beam']).toBeUndefined()
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

test('focused Storage Silo clearance and touch targets survive construction and refresh', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 80
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (!localStorage.getItem(key)) localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
  await page.goto('/?e2e')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  const main = page.locator('main')
  const canvas = page.locator('canvas')
  await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
  await page.getByRole('button', { name: /^STORAGE SILO/ }).tap()
  await expect(main).toHaveAttribute('data-module-status', 'active')
  let socket = ''
  for (const refresh of [false, true]) {
    if (refresh) {
      await page.reload()
      await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    }
    await expect(main).toHaveAttribute('data-operation-storage-capacity', '400')
    await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
    await page.waitForTimeout(1_200)
    await expect(canvas).toHaveAttribute('data-module-socket', /\[/)
    if (refresh) expect(await canvas.getAttribute('data-module-socket')).toEqual(socket)
    else socket = (await canvas.getAttribute('data-module-socket'))!
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size)
      await page.waitForTimeout(300)
      const bounds = JSON.parse((await canvas.getAttribute('data-module-bounds'))!) as number[]
      expect(bounds[0]).toBeGreaterThan(0)
      expect(bounds[1]).toBeGreaterThan(0)
      expect(bounds[2]).toBeLessThan(size.width)
      expect(bounds[3]).toBeLessThan(size.height)
      for (const id of ['alpha', 'beta', 'gamma']) {
        const point = await canvas.evaluate((element, id) => ({
          x: Number(element.getAttribute(`data-deposit-${id}-x`)),
          y: Number(element.getAttribute(`data-deposit-${id}-y`)),
        }), id)
        const dx = Math.max(bounds[0]! - point.x, 0, point.x - bounds[2]!)
        const dy = Math.max(bounds[1]! - point.y, 0, point.y - bounds[3]!)
        expect(Math.hypot(dx, dy), `${id} silo / touch clearance`).toBeGreaterThan(22)
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS')
        await page.touchscreen.tap(point.x, point.y)
        await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await mkdir('artifacts/screenshots/hero-polish', { recursive: true })
    await page.screenshot({ path: `artifacts/screenshots/hero-polish/silo-${refresh ? 'refresh' : 'built'}.png` })
    expect(Number(await canvas.getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80)
    expect(Number(await canvas.getAttribute('data-textures'))).toBeLessThanOrEqual(6)
    expect(Number(await canvas.getAttribute('data-programs'))).toBeLessThanOrEqual(24)
    expect(Number(await canvas.getAttribute('data-triangles'))).toBeLessThanOrEqual(120_000)
  }
  expect(errors).toEqual([])
})
