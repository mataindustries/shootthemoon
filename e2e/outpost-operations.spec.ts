import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import {
  OUTPOST_STORAGE_KEY,
  deserializePrototypeSave,
} from '../src/persistence/outpostSave.ts'
import {
  createLandingSite,
  createLunarLocation,
} from '../src/domain/lunarCoordinates.ts'
import { analyzeLandingSite, calculateOutpostOperations } from '../src/simulation/outpostOperations.ts'
import {
  createActiveExtractorSaveForSite,
  createLegacyActiveExtractorSave,
} from './rivalFixtures.ts'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots/outpost-operations'

interface BrowserErrors {
  console: string[]
  page: string[]
}

function watchErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text())
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
  return errors
}

async function openScene(page: Page, save: string | null = null) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  })
  if (save !== null) {
    await page.addInitScript(
      ({ key, value }) => {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
      },
      { key: OUTPOST_STORAGE_KEY, value: save },
    )
  }
  await page.goto('/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).click()
  await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
}

async function expectViewportSafe(page: Page) {
  const safe = await page.evaluate(() => {
    const panel = document.querySelector('.operations-panel')
    if (!(panel instanceof HTMLElement)) return false
    const bounds = panel.getBoundingClientRect()
    const metricsFit = Array.from(panel.querySelectorAll('.operations-metrics > div')).every((cell) => {
      const box = cell.getBoundingClientRect()
      return Array.from(cell.children).every((child) => {
        const text = child.getBoundingClientRect()
        return text.left >= box.left && text.right <= box.right && child.scrollWidth <= child.clientWidth
      })
    })
    return (
      metricsFit &&
      document.documentElement.scrollWidth <= window.innerWidth &&
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= window.innerWidth &&
      bounds.bottom <= window.innerHeight
    )
  })
  expect(safe).toBe(true)
}

test.beforeAll(async ({ request }) => {
  expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true })
})

test('landing preview reports deterministic real site qualities', async ({ page }) => {
  const errors = watchErrors(page)
  await openScene(page)
  const canvas = page.locator('.scene-canvas canvas')
  const bounds = await canvas.boundingBox()
  if (bounds === null) throw new Error('Canvas has no bounds.')

  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const panel = page.locator('.site-panel')
  await expect(panel).toBeVisible()
  const latitude = Number(await panel.getAttribute('data-latitude-rad'))
  const longitude = Number(await panel.getAttribute('data-longitude-rad'))
  const expected = analyzeLandingSite(
    createLandingSite(createLunarLocation(latitude, longitude, 0)),
  )
  const qualities = panel.locator('.site-qualities strong')

  await expect(qualities).toHaveText([
    expected.solarQuality.toUpperCase(),
    expected.extractionQuality.toUpperCase(),
    expected.logisticsQuality.toUpperCase(),
  ])
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/01-site-comparison.png` })

  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.getByRole('button', { name: 'CLAIM LANDING SITE' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(errors).toEqual({ console: [], page: [] })
})

test('live HUD supports all modes, touch sizing, persistence, and demand rendering', async ({ page }) => {
  const errors = watchErrors(page)
  await openScene(page, createLegacyActiveExtractorSave())
  const main = page.locator('main')
  const panel = page.locator('.operations-panel')
  await expect(panel).toBeVisible()
  await expect(main).toHaveAttribute('data-operating-mode', 'BALANCED')
  await expectViewportSafe(page)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/02-live-operational-hud.png` })

  const rates: number[] = []
  for (const mode of ['CONSERVE', 'BALANCED', 'OVERDRIVE'] as const) {
    const button = page.getByRole('button', { name: mode, exact: true })
    const box = await button.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await button.tap()
    await expect(main).toHaveAttribute('data-operating-mode', mode)
    rates.push(Number(await main.getAttribute('data-operation-rate')))
  }
  expect(rates[0]!).toBeLessThan(rates[1]!)
  expect(rates[1]!).toBeLessThanOrEqual(rates[2]!)
  await expect(main).toHaveAttribute('data-render-mode', 'demand')

  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE' }).click()
  await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  await page.setViewportSize({ width: 844, height: 390 })
  await expectViewportSafe(page)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/03-live-hud-landscape.png` })
  expect(errors).toEqual({ console: [], page: [] })
})

test('low energy throttling is explicit in both orientations', async ({ page }) => {
  const errors = watchErrors(page)
  const lowEnergySite = createLandingSite(
    createLunarLocation((40 * Math.PI) / 180, (50 * Math.PI) / 180, 0),
  )
  await openScene(page, createActiveExtractorSaveForSite(lowEnergySite))
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-operation-status', 'LOW ENERGY')
  expect(Number(await main.getAttribute('data-operation-energy-throttle'))).toBeLessThan(1)
  expect(Number(await main.getAttribute('data-operation-rate'))).toBeGreaterThan(0)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04-low-energy.png` })

  await page.setViewportSize({ width: 844, height: 390 })
  await expectViewportSafe(page)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04b-low-energy-landscape.png` })
  expect(errors).toEqual({ console: [], page: [] })
})

test('full storage stays stopped across ticks and refresh in both orientations', async ({ page }) => {
  const errors = watchErrors(page)
  const main = page.locator('main')
  const fullRaw = JSON.parse(createLegacyActiveExtractorSave()) as {
    outpost: { lunarOre: number; operations?: { storageCapacity: number } }
  }
  fullRaw.outpost.lunarOre = 240
  if (fullRaw.outpost.operations !== undefined) {
    fullRaw.outpost.operations.storageCapacity = 240
  }
  await openScene(page, JSON.stringify(fullRaw))
  await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  await expect(main).toHaveAttribute('data-operation-active-robots', '0')
  await expect(main).toHaveAttribute('data-operation-rate', '0')
  await expectViewportSafe(page)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05-storage-full.png` })
  await page.setViewportSize({ width: 844, height: 390 })
  await expectViewportSafe(page)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05b-storage-full-landscape.png` })
  await page.waitForTimeout(1_200)
  await expect(main).toHaveAttribute('data-lunar-ore', '240')
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE' }).click()
  await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  await expect(main).toHaveAttribute('data-lunar-ore', '240')
  await expect(main).toHaveAttribute('data-operation-rate', '0')
  expect(errors).toEqual({ console: [], page: [] })
})

test('accepted Counterstrike damage produces the exact persistent penalty', async ({ page }) => {
  const errors = watchErrors(page)
  const save = createAcceptedCounterstrikeSave('FAILURE')
  const restored = deserializePrototypeSave(save, Date.now())!
  const expected = calculateOutpostOperations(restored.outpost, 'DAMAGED')
  const intact = calculateOutpostOperations(restored.outpost, 'INTACT')
  await openScene(page, save)
  const main = page.locator('main')

  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(
    expected.productionPerMin,
    8,
  )
  expect(expected.productionPerMin).toBeCloseTo(
    intact.productionPerMin * 0.7,
    10,
  )
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/06-damaged-production.png` })
  expect(errors).toEqual({ console: [], page: [] })
})
