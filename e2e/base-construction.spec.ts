import { expect, test, type Browser, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'

const EVIDENCE = 'artifacts/screenshots/base-construction'

function activeSave(ore = 80): string {
  const raw = JSON.parse(createLegacyActiveExtractorSave()) as {
    outpost: { lunarOre: number }
  }
  raw.outpost.lunarOre = ore
  return JSON.stringify(raw)
}

async function installSave(page: Page, save: string) {
  await page.addInitScript(
    ({ key, value }) => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    },
    { key: OUTPOST_STORAGE_KEY, value: save },
  )
  await page.goto('/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
}

async function assertPortraitAndCapture(page: Page, name: string) {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` })
}

async function buildModule(page: Page, name: 'SOLAR WING' | 'STORAGE SILO' | 'REPAIR GANTRY') {
  const build = page.getByRole('button', { name: /BUILD MODULE/ })
  const bounds = await build.boundingBox()
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
  await build.click()
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

async function captureStorageEvidence(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await installSave(page, activeSave())
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await assertPortraitAndCapture(page, 'storage-silo-before')
  await buildModule(page, 'STORAGE SILO')
  await expect(main).toHaveAttribute('data-outpost-module', 'STORAGE_SILO')
  await expect(main).toHaveAttribute('data-module-status', 'active', { timeout: 8_000 })
  await expect(main).toHaveAttribute('data-operation-storage-capacity', '400')
  await expect(page.locator('.phase-label')).toHaveText('OUTPOST TIER 2')
  await assertPortraitAndCapture(page, 'storage-silo-after')
  await page.close()
}

test.beforeAll(async ({ request }) => {
  await mkdir(EVIDENCE, { recursive: true })
  expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
})

test('constructs Solar Wing once, resumes construction after refresh, and persists Tier 2', async ({ page, browser }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await installSave(page, activeSave())
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  const generatedBefore = Number(await page.locator('.operations-metrics > div').first().locator('strong').innerText().then((text) => text.replace(' KW', '')))
  await assertPortraitAndCapture(page, 'solar-wing-before')

  await buildModule(page, 'SOLAR WING')
  await expect(main).toHaveAttribute('data-outpost-module', 'SOLAR_WING')
  await expect(main).toHaveAttribute('data-module-status', 'constructing')
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE' }).tap()
  await expect(main).toHaveAttribute('data-outpost-module', 'SOLAR_WING')
  await expect(main).toHaveAttribute('data-module-status', 'active', { timeout: 8_000 })
  await expect(page.locator('.phase-label')).toHaveText('OUTPOST TIER 2')
  const generatedAfter = Number(await page.locator('.operations-metrics > div').first().locator('strong').innerText().then((text) => text.replace(' KW', '')))
  expect(generatedAfter).toBeCloseTo(generatedBefore * 1.25, 1)
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await assertPortraitAndCapture(page, 'solar-wing-after')
  expect(errors).toEqual([])

  // The independent silo capture creates another WebGL context. Release the
  // finished solar scene first, especially on software/mobile renderers.
  await page.close()
  await captureStorageEvidence(browser)
})

test('damaged outpost constructs Repair Gantry and completes powered gradual recovery', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(createAcceptedCounterstrikeSave('FAILURE')) as {
    outpost: { lunarOre: number }
  }
  raw.outpost.lunarOre = 80
  await installSave(page, JSON.stringify(raw))
  const main = page.locator('main')
  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  await assertPortraitAndCapture(page, 'repair-gantry-before')

  await buildModule(page, 'REPAIR GANTRY')
  await expect(main).toHaveAttribute('data-outpost-module', 'REPAIR_GANTRY')
  await expect(main).toHaveAttribute('data-module-status', 'active', { timeout: 8_000 })
  await assertPortraitAndCapture(page, 'repair-gantry-recovering')
  await expect.poll(async () => Number(await main.getAttribute('data-module-repair-progress'))).toBeGreaterThan(0)
  const partialProgress = Number(await main.getAttribute('data-module-repair-progress'))
  expect(partialProgress).toBeLessThan(1)
  expect(Number(await main.getAttribute('data-production-damage-penalty'))).toBeLessThan(0.15)
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'INTACT', { timeout: 20_000 })
  await expect(main).toHaveAttribute('data-module-repair-progress', '1')
  await expect(main).toHaveAttribute('data-production-damage-penalty', '0')
  await expect(main).toHaveAttribute('data-repairs-required', 'false')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await page.waitForTimeout(500)
  await assertPortraitAndCapture(page, 'repair-gantry-after')
  expect(errors).toEqual([])
})
