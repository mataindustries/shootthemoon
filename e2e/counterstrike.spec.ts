import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import {
  createAcceptedCounterstrikeSave,
  createCompletedStrikeSave,
} from './firstStrikeFixtures.ts'
import { COUNTERSTRIKE_TIMING } from '../src/simulation/counterstrikeSimulation.ts'
import { COUNTERSTRIKE_IMPACT_CAMERA_TIMING } from '../src/camera/counterstrikeCameraPlan.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots/counterstrike'
const RECORDING_DIRECTORY = 'artifacts/recordings/counterstrike'

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
  readonly cameraClearance: number
  readonly cameraDistance: number
}

interface RunDetail {
  readonly status: string
  readonly progress?: number
  readonly attemptNumber?: 0 | 1 | 2
  readonly attemptsUsed?: 0 | 1 | 2
  readonly attemptElapsedMs?: number
  readonly attemptElapsedAtFireMs?: number | null
  readonly judgement?: 'EARLY' | 'VALID' | 'LATE' | null
  readonly outcome?: 'SUCCESS' | 'FAILURE' | null
  readonly replay?: boolean
}

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text())
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
  return errors
}

async function dismissLaunchGate(page: Page): Promise<void> {
  const entry = page.getByRole('button', {
    name: /^(BEGIN INVASION|CONTINUE)$/,
  })
  if (await entry.isVisible()) await entry.click()
  await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
}

async function openScene(
  page: Page,
  initialSave: string,
  harness = true,
): Promise<void> {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance)
    let frozenNow: number | null = null
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => frozenNow ?? realNow(),
    })
    Object.defineProperty(window, '__counterstrikeE2eClock', {
      configurable: true,
      value: {
        freeze: () => {
          frozenNow = realNow()
        },
      },
    })
  })
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
  await page.goto(harness ? '/?e2e' : '/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.scene-canvas canvas')).toHaveAttribute(
    'data-draw-calls',
    /\d+/,
  )
  await dismissLaunchGate(page)
}

async function setRun(page: Page, detail: RunDetail): Promise<void> {
  await page.evaluate(
    (next) => {
      const testWindow = window as typeof window & {
        __counterstrikeE2eClock?: { freeze: () => void }
      }
      testWindow.__counterstrikeE2eClock?.freeze()
      window.dispatchEvent(
        new CustomEvent('counterstrike:set-run', { detail: next }),
      )
    },
    detail,
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-state',
    detail.status,
  )
  await page.waitForTimeout(100)
}

async function advanceRun(page: Page, expectedStatus: string): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('counterstrike:advance')),
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-state',
    expectedStatus,
  )
}

async function setFireElapsed(page: Page, attemptElapsedMs: number): Promise<void> {
  const acknowledged = await page.evaluate((value) => {
    const detail = { attemptElapsedMs: value, acknowledged: false }
    window.dispatchEvent(
      new CustomEvent('counterstrike:set-fire-elapsed', {
        detail,
      }),
    )
    return detail.acknowledged
  }, attemptElapsedMs)
  expect(acknowledged).toBe(true)
}

async function readMetrics(page: Page): Promise<RenderMetrics> {
  return page.locator('.scene-canvas canvas').evaluate((canvas) => ({
    drawCalls: Number(canvas.dataset.drawCalls),
    triangles: Number(canvas.dataset.triangles),
    points: Number(canvas.dataset.points),
    geometries: Number(canvas.dataset.geometries),
    textures: Number(canvas.dataset.textures),
    programs: Number(canvas.dataset.programs),
    cameraClearance: Number(canvas.dataset.cameraClearance),
    cameraDistance: Number(canvas.dataset.cameraDistance),
  }))
}

async function capture(
  page: Page,
  filename: string,
  samples: Array<{ name: string; metrics: RenderMetrics }>,
): Promise<void> {
  await page.waitForTimeout(160)
  await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/${filename}` })
  samples.push({ name: filename, metrics: await readMetrics(page) })
}

async function expectViewportSafe(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }))
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)

  const visiblePanel = page.locator(
    '.counterstrike-targeting:visible, .counterstrike-ending:visible, .counterstrike-warning:visible',
  ).first()
  await expect(visiblePanel).toBeVisible()
  const bounds = await visiblePanel.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(layout.viewportWidth)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(layout.viewportHeight)
}

async function expectCleanWebGl(page: Page): Promise<void> {
  const state = await page.locator('.scene-canvas canvas').evaluate((canvas) => {
    const context = canvas.getContext('webgl2')
    return {
      contextLost: context?.isContextLost() ?? null,
      error: context?.getError() ?? null,
    }
  })
  expect(state).toEqual({ contextLost: false, error: 0 })
}

async function dragFireButton(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /FIRE INTERCEPTOR/ })
  const bounds = await button.boundingBox()
  if (bounds === null) throw new Error('Interceptor control has no bounds.')
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 24, y, { steps: 5 })
  await page.mouse.up()
}

async function multiTouchFireButton(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /FIRE INTERCEPTOR/ })
  const bounds = await button.boundingBox()
  if (bounds === null) throw new Error('Interceptor control has no bounds.')
  const session = await page.context().newCDPSession(page)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const touch = (id: number, x: number) => ({
    id,
    x,
    y: centerY,
    radiusX: 5,
    radiusY: 5,
    force: 0.5,
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(31, centerX - 12), touch(32, centerX + 12)],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

async function driveReplaySuccess(page: Page): Promise<void> {
  await setRun(page, {
    status: 'intercept-ready',
    progress: 0.22,
    attemptNumber: 1,
    attemptsUsed: 0,
    attemptElapsedMs: 5_800,
    replay: true,
  })
  await setFireElapsed(page, 7_000)
  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).click()
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-judgement',
    'VALID',
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-attempt-elapsed-ms',
    '7000',
  )
  await advanceRun(page, 'success')
  await advanceRun(page, 'resolved')
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-replay',
    'true',
  )
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true })
})

test('ordinary production session does not register browser simulation controls', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  const envelope = JSON.parse(createCompletedStrikeSave()) as Record<string, unknown>
  envelope.testHarness = true
  if (typeof envelope.counterstrike === 'object' && envelope.counterstrike !== null) {
    Object.assign(envelope.counterstrike, { e2e: true, attemptElapsedMs: 7_000 })
  }
  await openScene(page, JSON.stringify(envelope), false)
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')

  const acknowledged = await page.evaluate(() => {
    const detail = { attemptElapsedMs: 7_000, acknowledged: false }
    window.dispatchEvent(
      new CustomEvent('counterstrike:set-fire-elapsed', { detail }),
    )
    window.dispatchEvent(
      new CustomEvent('counterstrike:set-run', {
        detail: { status: 'warning', progress: 0.5 },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('first-strike:set-presentation', {
        detail: { phase: 'arming', progress: 0.5 },
      }),
    )
    return detail.acknowledged
  })

  expect(acknowledged).toBe(false)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  expect(errors).toEqual({ console: [], page: [] })
})

test('Counterstrike success is touch-fair, persistent, idle, and within budget', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = watchBrowserErrors(page)
  const samples: Array<{ name: string; metrics: RenderMetrics }> = []
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await expect(main).toHaveAttribute('data-counterstrike-available', 'true')
  await expect(page.locator('.counterstrike-ready')).toContainText(
    'COUNTERSTRIKE AVAILABLE',
  )
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'warning')
  await setRun(page, { status: 'warning', progress: 0.48 })
  await expect(page.locator('.counterstrike-warning')).toContainText(
    'COUNTERSTRIKE DETECTED',
  )
  await capture(page, '01-counterstrike-warning.png', samples)

  await setRun(page, {
    status: 'tracking',
    progress: 0.52,
    attemptNumber: 1,
    attemptsUsed: 0,
    attemptElapsedMs: 2_600,
  })
  await expect(canvas).toHaveAttribute('data-counterstrike-threats', '1')
  await expect(canvas).toHaveAttribute('data-counterstrike-reticle', 'tracking')
  await expect(page.locator('.counterstrike-targeting')).toHaveAttribute(
    'data-intercept-cue',
    'TRACKING',
  )
  await expect(
    page.getByRole('button', { name: /TOO EARLY.*FIRE INTERCEPTOR/ }),
  ).toBeVisible()
  const cameraX = Number(await canvas.getAttribute('data-camera-x'))
  const canvasBounds = await canvas.boundingBox()
  if (canvasBounds === null) throw new Error('Canvas has no bounds.')
  await page.mouse.move(canvasBounds.x + 90, canvasBounds.y + 360)
  await page.mouse.down()
  await page.mouse.move(canvasBounds.x + 210, canvasBounds.y + 400, { steps: 8 })
  await page.mouse.up()
  expect(Number(await canvas.getAttribute('data-camera-x'))).toBeCloseTo(cameraX, 5)
  await capture(page, '02-orbital-tracking.png', samples)

  await setRun(page, {
    status: 'intercept-ready',
    progress: 0.3,
    attemptNumber: 1,
    attemptsUsed: 0,
  })
  await expect(canvas).toHaveAttribute('data-counterstrike-reticle', 'ready')
  await expect(page.locator('.counterstrike-targeting')).toHaveAttribute(
    'data-intercept-cue',
    'FIRE_NOW',
  )
  await expect(page.locator('.counterstrike-targeting')).toContainText(
    'FIRE NOW',
  )
  const fireNowBounds = await page
    .getByRole('button', { name: /FIRE NOW.*FIRE INTERCEPTOR/ })
    .boundingBox()
  expect(fireNowBounds).not.toBeNull()
  expect(fireNowBounds!.height).toBeGreaterThanOrEqual(96)
  expect(fireNowBounds!.width).toBeGreaterThanOrEqual(300)
  await expectViewportSafe(page)
  await dragFireButton(page)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'intercept-ready')
  await multiTouchFireButton(page)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'intercept-ready')
  await expect(main).toHaveAttribute('data-counterstrike-attempts', '0')
  await capture(page, '03-intercept-ready-window.png', samples)

  await setRun(page, {
    status: 'intercept-ready',
    progress: 0.3,
    attemptNumber: 1,
    attemptsUsed: 0,
    attemptElapsedMs: 5_800,
  })
  await setFireElapsed(page, 7_000)

  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute(
    'data-counterstrike-state',
    'interceptor-launched',
  )
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'VALID')
  await expect(main).toHaveAttribute(
    'data-counterstrike-attempt-elapsed-ms',
    '7000',
  )
  await expect(main).toHaveAttribute('data-counterstrike-attempts', '1')
  await setRun(page, {
    status: 'interceptor-launched',
    progress: 0.42,
    attemptNumber: 1,
    attemptsUsed: 1,
    judgement: 'VALID',
  })
  await expect(canvas).toHaveAttribute('data-counterstrike-interceptors', '1')
  await capture(page, '05-interceptor-launch.png', samples)

  await advanceRun(page, 'success')
  await setRun(page, {
    status: 'success',
    progress: 0.42,
    attemptNumber: 1,
    attemptsUsed: 1,
    judgement: 'VALID',
    outcome: 'SUCCESS',
  })
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-effect',
    'orbital-interception',
  )
  await expect(page.locator('.counterstrike-breakup')).toContainText(
    'INTERCEPTED',
  )
  await capture(page, '06-successful-interception.png', samples)

  await advanceRun(page, 'resolved')
  await expect(main).toHaveAttribute('data-counterstrike-outcome', 'SUCCESS')
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'SUCCESS',
  )
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'INTACT')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'COUNTERSTRIKE DEFEATED',
  )
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'OUTPOST SECURE',
  )
  await capture(page, '10-success-ending.png', samples)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-threats', /.+/)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-interceptors', /.+/)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-effect', /.+/)

  await page.waitForTimeout(700)
  const settledFrame = Number(await canvas.getAttribute('data-frame-count'))
  await page.waitForTimeout(900)
  expect(
    Number(await canvas.getAttribute('data-frame-count')) - settledFrame,
  ).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(180)
  await expectViewportSafe(page)
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/13-landscape-presentation.png`,
  })
  await page.setViewportSize({ width: 390, height: 844 })

  const persisted = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    OUTPOST_STORAGE_KEY,
  )
  expect(persisted.schemaVersion).toBe(4)
  expect(persisted.counterstrike).toMatchObject({
    acceptedOutcome: 'SUCCESS',
    interceptionSucceeded: true,
    outpostDamageState: 'INTACT',
    replayEligible: true,
    orbitalDebrisRecorded: true,
    repairsRequired: false,
    secondaryImpactSite: null,
  })
  expect(persisted.counterstrike).not.toHaveProperty('status')

  await page.reload()
  await dismissLaunchGate(page)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'SUCCESS',
  )
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(canvas).not.toHaveAttribute('data-counterstrike-threats', /.+/)
  await capture(page, '12-restored-outcome-after-refresh.png', samples)

  expect(Math.max(...samples.map((sample) => sample.metrics.drawCalls))).toBeLessThanOrEqual(45)
  expect(Math.max(...samples.map((sample) => sample.metrics.programs))).toBeLessThanOrEqual(24)
  await expectCleanWebGl(page)
  expect(errors).toEqual({ console: [], page: [] })
  console.log('COUNTERSTRIKE_SUCCESS_METRICS ' + JSON.stringify(samples))
})

test('Counterstrike failure preserves progress and replay replacement is deliberate', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const errors = watchBrowserErrors(page)
  const samples: Array<{ name: string; metrics: RenderMetrics }> = []
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    OUTPOST_STORAGE_KEY,
  )

  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await setRun(page, {
    status: 'tracking',
    progress: 0.24,
    attemptNumber: 1,
    attemptsUsed: 0,
    attemptElapsedMs: 2_000,
  })
  await setFireElapsed(page, 2_000)
  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'EARLY')
  await expect(main).toHaveAttribute(
    'data-counterstrike-attempt-elapsed-ms',
    '2000',
  )
  await expect(main).toHaveAttribute('data-counterstrike-attempts', '1')
  await setRun(page, {
    status: 'interceptor-launched',
    progress: 0.76,
    attemptNumber: 1,
    attemptsUsed: 1,
    judgement: 'EARLY',
  })
  await capture(page, '04-early-near-miss.png', samples)
  await advanceRun(page, 'missed')
  await expect(page.locator('.counterstrike-missed')).toContainText('NEAR MISS')
  await advanceRun(page, 'tracking')
  await expect(main).toHaveAttribute('data-counterstrike-attempt-number', '2')
  await expect(page.locator('.counterstrike-targeting')).toContainText(
    'SECOND VECTOR ACQUIRED',
  )

  await setRun(page, {
    status: 'intercept-ready',
    progress: 0.16,
    attemptNumber: 2,
    attemptsUsed: 1,
    attemptElapsedMs: COUNTERSTRIKE_TIMING.validWindowStartMs,
  })
  await expect(page.locator('.counterstrike-targeting')).toContainText(
    'FINAL ATTEMPT',
  )
  await expect(
    page.getByRole('button', { name: /FIRE NOW.*FIRE INTERCEPTOR/ }),
  ).toBeVisible()
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/04b-second-fire-now.png`,
  })

  await setRun(page, {
    status: 'intercept-ready',
    progress: 0.78,
    attemptNumber: 2,
    attemptsUsed: 1,
    attemptElapsedMs: COUNTERSTRIKE_TIMING.validWindowEndMs + 400,
  })
  await setFireElapsed(page, COUNTERSTRIKE_TIMING.validWindowEndMs + 400)
  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'LATE')
  await expect(main).toHaveAttribute(
    'data-counterstrike-attempt-elapsed-ms',
    String(COUNTERSTRIKE_TIMING.validWindowEndMs + 400),
  )
  await expect(main).toHaveAttribute('data-counterstrike-attempts', '2')
  await setRun(page, {
    status: 'interceptor-launched',
    progress: 0.72,
    attemptNumber: 2,
    attemptsUsed: 2,
    judgement: 'LATE',
    attemptElapsedAtFireMs: COUNTERSTRIKE_TIMING.validWindowEndMs + 400,
  })
  await capture(page, '07-late-miss.png', samples)
  await advanceRun(page, 'missed')
  await expect(page.locator('.counterstrike-missed')).toContainText(
    'HOSTILE TERMINAL APPROACH',
  )
  await advanceRun(page, 'impact')
  await setRun(page, {
    status: 'impact',
    progress: 0.18,
    attemptNumber: 2,
    attemptsUsed: 2,
    judgement: 'LATE',
    outcome: 'FAILURE',
  })
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-camera-beat',
    'wide',
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-damage-field',
    'hidden',
  )
  await expect(canvas).not.toHaveAttribute(
    'data-counterstrike-impact-effect',
    /.+/,
  )
  await capture(page, '08a-terminal-wide-shot.png', samples)

  await setRun(page, {
    status: 'impact',
    progress: COUNTERSTRIKE_IMPACT_CAMERA_TIMING.contactProgress + 0.045,
    attemptNumber: 2,
    attemptsUsed: 2,
    judgement: 'LATE',
    outcome: 'FAILURE',
  })
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-camera-beat',
    'contact',
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-impact-effect',
    'structural-impact',
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-damage-field',
    'persistent',
  )
  const impactX = Number(await canvas.getAttribute('data-secondary-impact-x'))
  const impactZ = Number(await canvas.getAttribute('data-secondary-impact-z'))
  expect(Math.hypot(impactX, impactZ)).toBeGreaterThan(15)
  expect(Math.hypot(impactX, impactZ)).toBeLessThan(35)
  await capture(page, '08-rival-impact-near-outpost.png', samples)
  await setRun(page, {
    status: 'impact',
    progress: 0.78,
    attemptNumber: 2,
    attemptsUsed: 2,
    judgement: 'LATE',
    attemptElapsedAtFireMs: COUNTERSTRIKE_TIMING.validWindowEndMs + 400,
    outcome: 'FAILURE',
  })
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-camera-beat',
    'damage-hold',
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-damage-field',
    'persistent',
  )
  await expect(canvas).toHaveAttribute('data-counterstrike-ejecta-count', '25')
  await expect(canvas).not.toHaveAttribute(
    'data-counterstrike-impact-effect',
    /.+/,
  )
  await capture(page, '09-damaged-outpost.png', samples)

  await advanceRun(page, 'resolved')
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'FAILURE',
  )
  await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  await expect(main).toHaveAttribute('data-repairs-required', 'true')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'COUNTERSTRIKE SURVIVED',
  )
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'OUTPOST DAMAGED',
  )
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'REPAIRS REQUIRED',
  )
  await expect(canvas).not.toHaveAttribute(
    'data-counterstrike-impact-effect',
    /.+/,
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-camera-beat',
    'damage-hold',
  )
  await expect(canvas).toHaveAttribute('data-counterstrike-ejecta-count', '25')
  await capture(page, '11-failure-ending.png', samples)
  const failureCardBounds = await page
    .locator('.counterstrike-ending--failure')
    .boundingBox()
  expect(failureCardBounds).not.toBeNull()
  expect(failureCardBounds!.y).toBeGreaterThan(844 * 0.5)

  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    OUTPOST_STORAGE_KEY,
  )
  expect(after.outpost.lunarOre).toBe(before.outpost.lunarOre)
  expect(after.outpost.deposits).toEqual(before.outpost.deposits)
  expect(after.canonicalLanding).toEqual(before.canonicalLanding)
  expect(after.outpost).toMatchObject({
    id: before.outpost.id,
    stage: before.outpost.stage,
  })
  expect(after.outpost.robot).toMatchObject({
    id: before.outpost.robot.id,
    state: before.outpost.robot.state,
    targetDepositId: before.outpost.robot.targetDepositId,
    carriedOre: before.outpost.robot.carriedOre,
  })
  expect(after.outpost.robot.stateStartedAtMs).toBeGreaterThanOrEqual(
    before.outpost.robot.stateStartedAtMs,
  )
  expect(after.outpost.extractor.status).toBe('active')
  expect(after.firstStrike.scar).toEqual(before.firstStrike.scar)
  const { updatedAtMs: beforeRivalUpdatedAtMs, ...beforeRivalFacts } =
    before.rival
  const { updatedAtMs: afterRivalUpdatedAtMs, ...afterRivalFacts } = after.rival
  expect(afterRivalFacts).toEqual(beforeRivalFacts)
  expect(afterRivalUpdatedAtMs).toBeGreaterThanOrEqual(
    beforeRivalUpdatedAtMs,
  )
  expect(after.counterstrike).toMatchObject({
    acceptedOutcome: 'FAILURE',
    interceptionSucceeded: false,
    outpostDamageState: 'DAMAGED',
    replayEligible: true,
    repairsRequired: true,
  })
  expect(after.counterstrike.secondaryImpactSite).not.toBeNull()

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(180)
  await expectViewportSafe(page)
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/14-failure-landscape.png`,
  })
  const landscapeFailureCardBounds = await page
    .locator('.counterstrike-ending--failure')
    .boundingBox()
  expect(landscapeFailureCardBounds).not.toBeNull()
  expect(landscapeFailureCardBounds!.x).toBeGreaterThan(844 * 0.5)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(180)

  await page.reload()
  await dismissLaunchGate(page)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'FAILURE',
  )
  await expect(canvas).toHaveAttribute(
    'data-counterstrike-damage-field',
    'persistent',
  )
  await expect(canvas).toHaveAttribute('data-counterstrike-ejecta-count', '25')
  await expect(canvas).not.toHaveAttribute(
    'data-counterstrike-impact-effect',
    /.+/,
  )
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/12b-restored-failure-outcome.png`,
  })

  await page.getByRole('button', { name: 'REPLAY COUNTERSTRIKE' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'warning')
  await expect(canvas).toHaveAttribute('data-counterstrike-threats', '1')
  await driveReplaySuccess(page)
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'ACCEPT THIS ENDING?',
  )
  let persistedOutcome = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}').counterstrike.acceptedOutcome,
    OUTPOST_STORAGE_KEY,
  )
  expect(persistedOutcome).toBe('FAILURE')
  await page.getByRole('button', { name: 'KEEP CURRENT ENDING' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-outcome', 'FAILURE')

  await page.getByRole('button', { name: 'REPLAY COUNTERSTRIKE' }).click()
  await expect(canvas).toHaveAttribute('data-counterstrike-threats', '1')
  await driveReplaySuccess(page)
  await page.getByRole('button', { name: 'ACCEPT NEW OUTCOME' }).click()
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'SUCCESS',
  )
  persistedOutcome = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}').counterstrike.acceptedOutcome,
    OUTPOST_STORAGE_KEY,
  )
  expect(persistedOutcome).toBe('SUCCESS')
  await expect(canvas).not.toHaveAttribute('data-counterstrike-threats', /.+/)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-interceptors', /.+/)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(180)
  await expectViewportSafe(page)
  await page.setViewportSize({ width: 390, height: 844 })
  console.log('COUNTERSTRIKE_FAILURE_METRICS ' + JSON.stringify(samples))
  expect(Math.max(...samples.map((sample) => sample.metrics.drawCalls))).toBeLessThanOrEqual(45)
  expect(Math.max(...samples.map((sample) => sample.metrics.programs))).toBeLessThanOrEqual(24)
  await expectCleanWebGl(page)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-counterstrike-available', 'false')
  await expect(main).toHaveAttribute('data-outpost-stage', 'none')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY),
  ).toBeNull()
  expect(errors).toEqual({ console: [], page: [] })
})

test('Counterstrike warning and timing pause across visibility loss', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  await page.evaluate(() => {
    const state = window as typeof window & {
      __counterstrikeVisibility?: DocumentVisibilityState
    }
    const begin = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('TRACK COUNTERSTRIKE'),
    )
    begin?.click()
    state.__counterstrikeVisibility = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.__counterstrikeVisibility,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(main).toHaveAttribute('data-rival-clock-running', 'false')
  await new Promise((resolve) => setTimeout(resolve, 3_800))
  await expect(main).toHaveAttribute('data-counterstrike-state', 'warning')

  await page.evaluate(() => {
    const state = window as typeof window & {
      __counterstrikeVisibility?: DocumentVisibilityState
    }
    state.__counterstrikeVisibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(main).toHaveAttribute('data-rival-clock-running', 'true')
  await page.waitForTimeout(300)
  await expect(main).toHaveAttribute('data-counterstrike-state', 'warning')
  await expect(main).toHaveAttribute('data-render-mode', 'continuous')

  await page.evaluate(() => {
    delete (window as typeof window & { __counterstrikeVisibility?: string })
      .__counterstrikeVisibility
    delete (document as Document & { visibilityState?: string }).visibilityState
  })
  expect(errors).toEqual({ console: [], page: [] })
})

test('accepted Counterstrike fixture never resumes a transient projectile', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openScene(page, createAcceptedCounterstrikeSave('FAILURE'))
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'FAILURE',
  )
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(canvas).not.toHaveAttribute('data-counterstrike-threats', /.+/)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-interceptors', /.+/)
  await expect(canvas).not.toHaveAttribute('data-counterstrike-impact-effect', /.+/)
  expect(errors).toEqual({ console: [], page: [] })
})

test('records a paced successful Counterstrike', async ({ page }) => {
  test.skip(
    process.env.COUNTERSTRIKE_RECORDING !== '1',
    'Set COUNTERSTRIKE_RECORDING=1 to capture Counterstrike recordings.',
  )
  test.setTimeout(120_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave(), false)
  const main = page.locator('main')
  await page.evaluate(() => {
    let fireScheduled = false
    const fireWhenVisible = () => {
      const targeting = document.querySelector<HTMLElement>(
        '.counterstrike-targeting[data-intercept-cue="FIRE_NOW"]',
      )
      const button = document.querySelector<HTMLButtonElement>(
        'button[data-fire-cue="FIRE_NOW"]',
      )
      if (
        targeting === null ||
        button === null ||
        button.disabled ||
        button.getClientRects().length === 0 ||
        fireScheduled
      ) {
        return false
      }
      fireScheduled = true
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (
            button.isConnected &&
            !button.disabled &&
            button.dataset.fireCue === 'FIRE_NOW' &&
            button.getClientRects().length > 0
          ) {
            button.click()
          }
        }, 0)
      })
      return true
    }
    const observer = new MutationObserver(() => {
      if (fireWhenVisible()) observer.disconnect()
    })
    observer.observe(document.body, {
      attributeFilter: ['data-intercept-cue', 'data-fire-cue'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    if (fireWhenVisible()) observer.disconnect()
  })
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  const startedAtMs = Date.now()
  // Video encoding can stall the Node-to-browser actionability round trip for
  // longer than the real 2.4-second window. The one-shot observer above allows
  // one painted FIRE NOW frame, then clicks only the visible, enabled production
  // control; the real clock and strict VALID assertion remain authoritative.
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'VALID', {
    timeout: 16_000,
  })
  const fireElapsedMs = Number(
    await main.getAttribute('data-counterstrike-attempt-elapsed-ms'),
  )
  expect(fireElapsedMs).toBeGreaterThanOrEqual(
    COUNTERSTRIKE_TIMING.validWindowStartMs,
  )
  expect(fireElapsedMs).toBeLessThanOrEqual(
    COUNTERSTRIKE_TIMING.validWindowEndMs,
  )
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved', {
    timeout: 30_000,
  })
  await expect(main).toHaveAttribute('data-counterstrike-outcome', 'SUCCESS')
  const durationMs = Date.now() - startedAtMs
  expect(durationMs).toBeGreaterThanOrEqual(20_000)
  // SwiftShader video encoding can delay browser timers; the authoritative
  // production phase budget remains covered by the simulation unit suite.
  expect(durationMs).toBeLessThanOrEqual(60_000)
  expect(errors).toEqual({ console: [], page: [] })
  console.log(`COUNTERSTRIKE_SUCCESS_RECORDING_DURATION ${durationMs}`)

  const video = page.video()
  if (video !== null) {
    await mkdir(RECORDING_DIRECTORY, { recursive: true })
    await page.close()
    await video.saveAs(`${RECORDING_DIRECTORY}/counterstrike-success.webm`)
  }
})

test('records a paced survived Counterstrike', async ({ page }) => {
  test.skip(
    process.env.COUNTERSTRIKE_RECORDING !== '1',
    'Set COUNTERSTRIKE_RECORDING=1 to capture Counterstrike recordings.',
  )
  test.setTimeout(90_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave(), false)
  const main = page.locator('main')
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  const startedAtMs = Date.now()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved', {
    timeout: 45_000,
  })
  const durationMs = Date.now() - startedAtMs
  expect(durationMs).toBeGreaterThanOrEqual(30_000)
  // Video encoding can delay browser task delivery. The state-machine suite
  // owns the exact 31-second unattended production budget.
  expect(durationMs).toBeLessThanOrEqual(45_000)
  await expect(main).toHaveAttribute('data-counterstrike-outcome', 'FAILURE')
  expect(errors).toEqual({ console: [], page: [] })
  console.log(`COUNTERSTRIKE_FAILURE_RECORDING_DURATION ${durationMs}`)

  const video = page.video()
  if (video !== null) {
    await mkdir(RECORDING_DIRECTORY, { recursive: true })
    await page.close()
    await video.saveAs(`${RECORDING_DIRECTORY}/counterstrike-failure.webm`)
  }
})
