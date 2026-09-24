import { expect, test, type Page } from '@playwright/test'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'

const RAISED = 'BASTION ZIGGURAT RAISED · −25% SIEGE DAMAGE'
const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844, isMobile: true },
  { name: 'landscape', width: 844, height: 390, isMobile: true },
  { name: 'laptop', width: 1440, height: 900, isMobile: false },
  { name: 'desktop', width: 1920, height: 1080, isMobile: false },
] as const

async function frameMetrics(page: Page) {
  const metrics = await page.locator('canvas').evaluate(el => {
    const d = el.dataset, gl = el.getContext('webgl2')!
    return { calls: Number(d.drawCalls), triangles: Number(d.triangles), programs: Number(d.programs),
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

// The persisted id stays BASTION_OBELISK; everything the player reads is the Ziggurat.
for (const viewport of VIEWPORTS) test.describe(`Bastion Ziggurat ${viewport.name}`, () => {
  test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile })

  test('real flow: choice, construction, defense, damage, repair, reveal and claimed orbit', async ({ page }, info) => {
    test.setTimeout(150_000)
    const shot = async (name: string) => {
      await page.clock.runFor(32)
      await page.screenshot({ path: info.outputPath(`${viewport.name}-${name}.png`) })
    }
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS'))
    raw.outpost.lunarOre = 230
    await page.addInitScript(({ key, save }) => {
      if (!sessionStorage.getItem('ziggurat-seeded')) {
        localStorage.setItem(key, save)
        sessionStorage.setItem('ziggurat-seeded', 'true')
      }
    }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
    await page.clock.install()
    await page.goto('/')
    const main = page.locator('main')
    const heading = page.locator('.monument-heading h1')
    await expect(main).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await expect(main).toHaveAttribute('data-monument-view', 'true')
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))

    const choice = page.getByRole('button', { name: /BASTION ZIGGURAT/ })
    await expect(choice).toBeEnabled()
    await expect(choice).toContainText('Every step a wall. −25% siege damage · +50% repair · half production damage.')
    await expect(page.getByRole('button', { name: /BASTION OBELISK/ })).toHaveCount(0)
    await shot('choices')
    await choice.tap()
    await expect(main).toHaveAttribute('data-monument-kind', 'BASTION_OBELISK')
    await expect(main).toHaveAttribute('data-monument-status', 'constructing')
    await expect(heading).toContainText('BASTION ZIGGURAT')
    await page.clock.fastForward(1000)
    await shot('construction-early')
    await page.clock.fastForward(3200)
    await expect(main).toHaveAttribute('data-monument-status', 'command')
    await shot('command')

    // Accelerated labor reaches mid-construction before the three breaches.
    for (let wave = 0; wave < 3; wave++) {
      await expect(page.getByText(`WAVE ${wave + 1} / 3`, { exact: false })).toBeVisible()
      await page.getByRole('button', { name: /ACCELERATE CONSTRUCTION/ }).tap()
      await page.clock.fastForward(3200)
      if (wave === 0) await shot('defense-wave')
      await page.clock.fastForward(5000)
      await expect(main).toHaveAttribute('data-monument-waves', String(wave + 1))
      if (wave === 0) await shot(`construction-${Math.round(Number(await main.getAttribute('data-monument-work')) / 480)}pct`)
    }
    await expect(main).toHaveAttribute('data-monument-status', 'damaged')
    await expect(heading).toContainText('BASTION ZIGGURAT')
    await shot('damaged')
    await page.getByRole('button', { name: /REPAIR MONUMENT/ }).tap()
    await page.clock.fastForward(7200)
    await expect(main).toHaveAttribute('data-monument-status', 'repairing')
    await shot('repairing')
    await page.clock.fastForward(8500)
    await expect(main).toHaveAttribute('data-monument-status', 'complete')
    await expect(main).toHaveAttribute('data-monument-reveal', 'true')
    await expect(page.locator('.monument-panel [role="status"]')).toContainText(RAISED)
    await shot('reveal-start')
    await page.clock.runFor(2968)
    const reveal = await frameMetrics(page)
    await shot('reveal-mid')
    await page.clock.runFor(2500)
    await shot('reveal-end')
    await page.clock.fastForward(1000)
    await expect(main).toHaveAttribute('data-monument-reveal', 'false')
    await expect(heading).toContainText('BASTION ZIGGURAT')
    await expect(page.getByRole('status').filter({ hasText: RAISED })).toBeVisible()
    await shot('complete')

    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
    expect(saved.outpost.monument).toMatchObject({ kind: 'BASTION_OBELISK', status: 'complete', revealSeen: true })
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.clock.fastForward(2800)
    await expect(main).toHaveAttribute('data-phase', 'orbit')
    await expect(main).toHaveAttribute('data-monument-kind', 'BASTION_OBELISK')
    await expect(main).toHaveAttribute('data-territory-claimed', 'true')
    const orbit = await frameMetrics(page)
    await shot('claimed-orbit')
    await info.attach('metrics', { body: JSON.stringify({ reveal, orbit }), contentType: 'application/json' })
    console.info(`Bastion Ziggurat ${viewport.name} metrics:`, JSON.stringify({ reveal, orbit }))
    expect(errors).toEqual([])
  })
})
