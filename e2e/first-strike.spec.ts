import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import {
  createCompletedStrikeSave,
  createStrikeReadySave,
} from './firstStrikeFixtures.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots/first-strike'
const RECORDING_DIRECTORY = 'artifacts/recordings/first-strike'

interface BrowserErrors {
  readonly console: string[]
  readonly page: string[]
}

interface RenderMetrics {
  readonly drawCalls: number
  readonly triangles: number
  readonly points: number
  readonly geometries: number
  readonly textures: number
  readonly programs: number
}

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text())
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
  return errors
}

async function openReadyScene(page: Page, initialSave: string): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      get: () => 6,
    })
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => 8,
    })
  })
  await page.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value)
      }
    },
    { key: OUTPOST_STORAGE_KEY, value: initialSave },
  )
  await page.goto('/?e2e')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.scene-canvas canvas')).toHaveAttribute(
    'data-draw-calls',
    /\d+/,
  )
}

async function setStrikePresentation(
  page: Page,
  phase: string,
  progress: number | null,
): Promise<void> {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(
        new CustomEvent('first-strike:set-presentation', { detail }),
      ),
    { phase, progress },
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-first-strike-presentation',
    phase,
  )
  await page.waitForTimeout(80)
}

async function returnToOrbitIfNeeded(page: Page): Promise<void> {
  const main = page.locator('main')
  if ((await main.getAttribute('data-phase')) !== 'landed') return

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: 1 },
      }),
    ),
  )
  await expect(main).toHaveAttribute('data-phase', 'orbit')
}

async function advanceStrike(page: Page, expectedPhase: string): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('first-strike:advance-presentation'),
    ),
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-first-strike-presentation',
    expectedPhase,
  )
}

async function readMetrics(page: Page): Promise<RenderMetrics> {
  return page.locator('.scene-canvas canvas').evaluate((canvas) => ({
    drawCalls: Number(canvas.dataset.drawCalls),
    triangles: Number(canvas.dataset.triangles),
    points: Number(canvas.dataset.points),
    geometries: Number(canvas.dataset.geometries),
    textures: Number(canvas.dataset.textures),
    programs: Number(canvas.dataset.programs),
  }))
}

async function capture(
  page: Page,
  filename: string,
  metrics: Array<{ phase: string; metrics: RenderMetrics }>,
): Promise<void> {
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/${filename}` })
  metrics.push({
    phase: filename.replace(/\.png$/, ''),
    metrics: await readMetrics(page),
  })
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true })
})

test('complete First Strike production loop, restoration, orientation, and reset', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = watchBrowserErrors(page)
  const metrics: Array<{ phase: string; metrics: RenderMetrics }> = []
  await openReadyScene(page, createStrikeReadySave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await returnToOrbitIfNeeded(page)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await expect(main).toHaveAttribute('data-first-strike-status', 'READY')
  await expect(page.locator('.strike-ready')).toContainText(
    'FIRST STRIKE PROTOCOL AVAILABLE',
  )
  await expect(
    page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }),
  ).toBeVisible()
  await capture(page, '01-first-strike-unlocked.png', metrics)

  await page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }).click()
  await expect(main).toHaveAttribute('data-first-strike-status', 'ARMED')
  await expect(page.getByRole('dialog')).toContainText(
    'LAUNCH AT NULL MERIDIAN?',
  )
  await capture(page, '02-launch-system-armed.png', metrics)

  const saveBeforeCancel = await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY)
  await page.getByRole('button', { name: 'CANCEL' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(main).toHaveAttribute('data-first-strike-status', 'ARMED')
  const saveAfterCancel = await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY)
  expect(JSON.parse(saveAfterCancel ?? '{}').firstStrike.status).toBe('ARMED')
  expect(JSON.parse(saveBeforeCancel ?? '{}').firstStrike.status).toBe('ARMED')

  await page.getByRole('button', { name: /WARHEAD ARMED/ }).click()
  await page.getByRole('button', { name: 'FIRE' }).click()
  await expect(main).toHaveAttribute('data-first-strike-status', 'LAUNCHING')
  await setStrikePresentation(page, 'arming', 0.72)

  await advanceStrike(page, 'launch')
  await setStrikePresentation(page, 'launch', 0.48)
  await expect(canvas).toHaveAttribute('data-warhead-radius', /\d+/)
  await capture(page, '03-warhead-launch.png', metrics)

  await advanceStrike(page, 'orbital-flight')
  await setStrikePresentation(page, 'orbital-flight', 0.55)
  await expect(canvas).toHaveAttribute('data-camera-path-minimum-radius', /\d+/)
  await expect(canvas).toHaveAttribute('data-strike-route-progress', /0\./)
  await capture(page, '04-orbital-flight.png', metrics)

  await advanceStrike(page, 'vesper-transmission')
  await setStrikePresentation(page, 'vesper-transmission', 0.46)
  await expect(page.locator('.strike-vesper-transmission')).toContainText(
    'Null Meridian survives—and I remember who fired.',
  )
  await capture(page, '05-vesper-final-response.png', metrics)

  await advanceStrike(page, 'target-approach')
  await setStrikePresentation(page, 'target-approach', 0.82)
  await advanceStrike(page, 'impact-flash')
  await setStrikePresentation(page, 'impact-flash', 0.28)
  await capture(page, '06-impact-flash.png', metrics)

  await advanceStrike(page, 'ejecta')
  await expect(main).toHaveAttribute('data-impact-complete', 'true')
  await expect(main).toHaveAttribute('data-rival-damaged', 'true')
  await expect(main).toHaveAttribute('data-scar-created', 'true')
  await setStrikePresentation(page, 'ejecta', 0.46)
  await capture(page, '07-ejecta-and-debris.png', metrics)

  await advanceStrike(page, 'crater-reveal')
  await setStrikePresentation(page, 'crater-reveal', 0.7)
  await capture(page, '08-fresh-crater.png', metrics)

  await advanceStrike(page, 'orbital-pullback')
  await setStrikePresentation(page, 'orbital-pullback', 0.82)
  await capture(page, '09-final-scar-from-orbit.png', metrics)

  await advanceStrike(page, 'ending')
  await expect(main).toHaveAttribute('data-first-strike-status', 'COMPLETE')
  await expect(main).toHaveAttribute('data-ending-complete', 'true')
  await expect(main).toHaveAttribute('data-final-vesper-complete', 'true')
  await expect(page.locator('.strike-ending')).toContainText(
    'THE MOON REMEMBERS.',
  )
  await capture(page, '10-mvp-ending.png', metrics)

  const scarLatitude = await main.getAttribute('data-scar-latitude')
  const scarLongitude = await main.getAttribute('data-scar-longitude')
  const completedSaveBeforeReplayCancel = await page.evaluate(
    (key) => localStorage.getItem(key),
    OUTPOST_STORAGE_KEY,
  )
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'PLAY AGAIN' }).click()
  await expect(main).toHaveAttribute('data-first-strike-status', 'COMPLETE')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY),
  ).toBe(completedSaveBeforeReplayCancel)

  await page.getByRole('button', { name: 'EXPLORE THE SCAR' }).click()
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await page.waitForTimeout(700)
  const settledFrame = Number(await canvas.getAttribute('data-frame-count'))
  await page.waitForTimeout(900)
  expect(Number(await canvas.getAttribute('data-frame-count')) - settledFrame).toBeLessThanOrEqual(1)

  await page.reload()
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(main).toHaveAttribute('data-first-strike-status', 'COMPLETE')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-scar-latitude', scarLatitude ?? '')
  await expect(main).toHaveAttribute('data-scar-longitude', scarLongitude ?? '')
  await expect(canvas).toHaveAttribute('data-scar-facing-camera', 'true')
  await expect(page.locator('.strike-ending')).toHaveCount(0)
  await capture(page, '11-restored-completed-state.png', metrics)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(250)
  await expect(page.locator('.strike-complete-status')).toBeVisible()
  await capture(page, '12-landscape-completed-state.png', metrics)

  expect(await canvas.getAttribute('data-renderer')).toBe('webgl2')
  expect(Math.max(...metrics.map((entry) => entry.metrics.programs))).toBeLessThanOrEqual(24)
  expect((await readMetrics(page)).textures).toBeLessThanOrEqual(6)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).click()
  await expect(main).toHaveAttribute('data-first-strike-status', 'none')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'none')
  await expect(main).toHaveAttribute('data-outpost-stage', 'none')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY),
  ).toBeNull()

  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await canvas.boundingBox()
  if (bounds === null) throw new Error('Canvas did not have bounds after reset.')
  await page.touchscreen.tap(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  await expect(page.locator('.site-panel')).toBeVisible()
  expect(errors).toEqual({ console: [], page: [] })

  const peak = metrics.reduce((current, entry) => ({
    drawCalls: Math.max(current.drawCalls, entry.metrics.drawCalls),
    triangles: Math.max(current.triangles, entry.metrics.triangles),
    points: Math.max(current.points, entry.metrics.points),
    geometries: Math.max(current.geometries, entry.metrics.geometries),
    textures: Math.max(current.textures, entry.metrics.textures),
    programs: Math.max(current.programs, entry.metrics.programs),
  }), {
    drawCalls: 0,
    triangles: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  })
  console.log('FIRST_STRIKE_METRICS ' + JSON.stringify({ peak, frames: metrics }))
})

test('completed fixture restores a static scar without temporary effects', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await expect(main).toHaveAttribute('data-first-strike-status', 'COMPLETE')
  await expect(main).toHaveAttribute('data-impact-complete', 'true')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(canvas).toHaveAttribute('data-scar-facing-camera', 'true')
  await expect(canvas).not.toHaveAttribute('data-impact-effect-phase', /.+/)
  await expect(canvas).not.toHaveAttribute('data-strike-route-progress', /.+/)
  expect((await readMetrics(page)).programs).toBeLessThanOrEqual(24)
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/11-restored-completed-state.png`,
  })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(250)
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/12-landscape-completed-state.png`,
  })
  expect(errors).toEqual({ console: [], page: [] })
})

test('records the complete paced launch-to-ending sequence', async ({ page }) => {
  test.skip(
    process.env.FIRST_STRIKE_RECORDING !== '1',
    'Set FIRST_STRIKE_RECORDING=1 to capture the inspection recording.',
  )
  test.setTimeout(60_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createStrikeReadySave())
  const main = page.locator('main')

  await returnToOrbitIfNeeded(page)
  await page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }).click()
  await page.getByRole('button', { name: 'FIRE' }).click()
  const startedAtMs = Date.now()
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'ending', {
    timeout: 35_000,
  })
  const durationMs = Date.now() - startedAtMs
  expect(durationMs).toBeGreaterThanOrEqual(25_000)
  expect(durationMs).toBeLessThanOrEqual(30_000)
  expect(errors).toEqual({ console: [], page: [] })

  const video = page.video()
  if (video !== null) {
    await mkdir(RECORDING_DIRECTORY, { recursive: true })
    await page.close()
    await video.saveAs(`${RECORDING_DIRECTORY}/first-strike-launch-to-ending.webm`)
  }
})
