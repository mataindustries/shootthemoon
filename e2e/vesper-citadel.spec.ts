import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { createStrikeReadySave } from './firstStrikeFixtures.ts'

const stage = process.env.VESPER_EVIDENCE ?? 'after'
const directory = `artifacts/vesper-citadel/${stage}`
test.use({ trace: 'off', actionTimeout: 30_000, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } })

async function setPresentation(page: Page, phase: string, progress: number | null) {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('rival-signal:set-presentation', { detail })), { phase, progress, replay: false })
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', phase)
  await page.clock.runFor(64)
}

async function advance(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('rival-signal:advance-presentation')))
  await page.clock.runFor(64)
}

async function capture(page: Page, prefix: string, name: string) {
  // SurfaceDetail enters via a React state update from the first camera frame.
  // Give that commit a task boundary, then render it before sampling counters.
  await page.waitForTimeout(80)
  await page.clock.runFor(64)
  await page.screenshot({ path: `${directory}/${prefix}-${name}.png` })
  const metrics = await page.locator('canvas').evaluate(element => {
    const gl = element.getContext('webgl2')!
    return { ...element.dataset, contextLost: gl.isContextLost(), webglError: gl.getError() }
  })
  await writeFile(`${directory}/${prefix}-${name}.json`, JSON.stringify(metrics, null, 2))
  expect(metrics.contextLost).toBe(false)
  expect(metrics.webglError).toBe(0)
  expect(Number(metrics.drawCalls)).toBeGreaterThan(0)
  expect(Number(metrics.triangles)).toBeLessThanOrEqual(220_000)
  expect(Number(metrics.programs)).toBeLessThanOrEqual(24)
  if (!name.includes('initial')) expect(Number(metrics.textures)).toBeLessThanOrEqual(6)
  console.log(`${prefix}-${name}: ${metrics.drawCalls} calls / ${metrics.triangles} triangles / ${metrics.geometries} geometries / ${metrics.textures} textures / ${metrics.programs} programs`)
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`Vesper initial inspection ${viewport.width}`, async ({ page }) => {
    test.skip(process.env.VESPER_QUICK !== '1')
    test.setTimeout(180_000)
    await mkdir(directory, { recursive: true })
    await page.setViewportSize(viewport)
    await page.addInitScript(({ key, save }) => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      localStorage.setItem(key, save)
    }, { key: OUTPOST_STORAGE_KEY, save: createStrikeReadySave() })
    await page.goto('/?e2e')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await page.waitForTimeout(900)
    const now = new Date()
    await page.clock.install({ time: now })
    await page.clock.pauseAt(new Date(now.getTime() + 32))
    await setPresentation(page, 'rival-focused', 1)
    await capture(page, `${viewport.width}x${viewport.height}`, '00-initial-focus')
  })
  test(`Vesper citadel reveal, focus, scan and orbit ${viewport.width}`, async ({ page }) => {
    test.skip(process.env.VESPER_QUICK === '1')
    test.setTimeout(300_000)
    await mkdir(directory, { recursive: true })
    await page.setViewportSize(viewport)
    const prefix = `${viewport.width}x${viewport.height}`
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.addInitScript(({ key, save }) => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      localStorage.setItem(key, save)
    }, { key: OUTPOST_STORAGE_KEY, save: createLegacyActiveExtractorSave() })
    await page.goto('/?e2e')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('moon-core:set-cinematic-progress', { detail: { progress: 1 } })))
    await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'warning')
    const now = new Date()
    await page.clock.install({ time: now })
    await page.clock.pauseAt(new Date(now.getTime() + 32))
    await setPresentation(page, 'impact', 0.92)
    await capture(page, prefix, '01-reveal-wide')
    await advance(page)
    await expect(page.locator('.rival-transmission')).toContainText('COMMANDER VESPER')
    await setPresentation(page, 'intro-transmission', 1)
    await capture(page, prefix, '02-introduction')
    await page.getByRole('button', { name: 'HOLD THE CHANNEL' }).tap()
    await setPresentation(page, 'dual-sites', 1)
    await capture(page, prefix, '03-two-claims')
    await advance(page)
    await expect(page.locator('main')).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
    await page.clock.runFor(500)
    await capture(page, prefix, '04-orbit')
    const canvas = page.locator('canvas')
    const marker = await canvas.evaluate(element => ({ x: Number(element.dataset.rivalSignalX), y: Number(element.dataset.rivalSignalY) }))
    await page.touchscreen.tap(marker.x, marker.y)
    await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'rival-focus')
    await setPresentation(page, 'rival-focus', 0.72)
    await capture(page, prefix, '05-approach')
    await setPresentation(page, 'rival-focus', 1)
    await advance(page)
    await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'rival-focused')
    await capture(page, prefix, '06-focus-idle')
    const hideHud = await page.addStyleTag({ content: '.hud, .rival-hud, .operations-panel, .outpost-panel { visibility: hidden !important }' })
    await page.screenshot({ path: `${directory}/${prefix}-06-focus-assets.png` })
    await hideHud.evaluate(element => element.remove())
    const scan = page.getByRole('button', { name: 'SCAN RIVAL SITE' })
    await expect(scan).toBeVisible()
    await scan.tap()
    await setPresentation(page, 'scanning', 0.52)
    await capture(page, prefix, '07-scan')
    await advance(page)
    await expect(page.locator('main')).toHaveAttribute('data-rival-scan-complete', 'true')
    await page.getByRole('button', { name: 'END TRANSMISSION' }).tap()
    await expect(page.locator('main')).toHaveAttribute('data-first-strike-status', 'READY')
    await expect(page.getByRole('button', { name: /ARM LUNAR WARHEAD/ })).toBeVisible()
    await setPresentation(page, 'contested', 1)
    await advance(page)
    await expect(page.locator('main')).toHaveAttribute('data-render-mode', 'demand')
    await page.clock.runFor(800)
    const startFrame = Number(await canvas.getAttribute('data-frame-count'))
    await page.clock.runFor(1_400)
    const orbitIdleFrames = Number(await canvas.getAttribute('data-frame-count')) - startFrame
    await writeFile(`${directory}/${prefix}-verification.json`, JSON.stringify({ errors, orbitIdleFrames, markerSelectable: true, scanCompleted: true, firstStrikeReady: true }, null, 2))
    expect(orbitIdleFrames).toBeLessThanOrEqual(14)
    expect(errors).toEqual([])
  })
}
