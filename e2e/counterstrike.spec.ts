import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_SAVE_SCHEMA_VERSION, OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import {
  createAcceptedCounterstrikeSave,
  createCompletedStrikeSave,
} from './firstStrikeFixtures.ts'
import { COUNTERSTRIKE_TIMING } from '../src/simulation/counterstrikeSimulation.ts'
import { COUNTERSTRIKE_IMPACT_CAMERA_TIMING } from '../src/camera/counterstrikeCameraPlan.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots/counterstrike'
// Inside the settled damage framing at the end of the impact status.
const DAMAGE_HOLD_PROGRESS =
  (COUNTERSTRIKE_IMPACT_CAMERA_TIMING.damageArrivalProgress + 1) / 2
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
  readonly threatProgressStart?: number
  readonly threatProgressEnd?: number
  readonly interceptRouteProgress?: number
  readonly status: string
  readonly progress?: number
  readonly attemptNumber?: 0 | 1 | 2
  readonly attemptsUsed?: 0 | 1 | 2
  readonly attemptElapsedMs?: number
  readonly attemptElapsedAtFireMs?: number | null
  readonly judgement?: 'EARLY' | 'VALID' | 'LATE' | null
  readonly outcome?: 'SUCCESS' | 'FAILURE' | null
  readonly replay?: boolean
  readonly order?:
    | 'PRIORITIZE_INTERCEPTOR'
    | 'HARDEN_OUTPOST'
    | 'KEEP_EXTRACTING'
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
  await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-camera-beat', 'interception-hold')
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
    'SHE ANSWERED',
  )
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await setRun(page, {
    status: 'warning',
    progress: 0.48,
    order: 'PRIORITIZE_INTERCEPTOR',
  })
  await expect(page.locator('.counterstrike-warning')).toContainText(
    'RIVAL LAUNCH DETECTED',
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
  expect(persisted.schemaVersion).toBe(OUTPOST_SAVE_SCHEMA_VERSION)
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

  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', 'SUCCESS')
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
  // Isolate presentation/save invariants from the existing entry-time mining
  // tick. Simulation durations still use the independent performance clock.
  const fixtureNowMs = Date.now()
  await page.clock.setFixedTime(fixtureNowMs)
  await openScene(page, createCompletedStrikeSave(fixtureNowMs))
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    OUTPOST_STORAGE_KEY,
  )

  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /HARDEN OUTPOST/ }).click()
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
    progress: COUNTERSTRIKE_IMPACT_CAMERA_TIMING.wideHoldEndProgress / 2,
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
    progress: DAMAGE_HOLD_PROGRESS,
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

  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', 'FAILURE')
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
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await driveReplaySuccess(page)
  await expect(page.locator('.counterstrike-ending')).toContainText(
    'ACCEPT THIS ENDING?',
  )
  await expect(page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' })).toHaveCount(0)
  let persistedOutcome = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}').counterstrike.acceptedOutcome,
    OUTPOST_STORAGE_KEY,
  )
  expect(persistedOutcome).toBe('FAILURE')
  await page.getByRole('button', { name: 'KEEP CURRENT ENDING' }).click()
  await expect(main).toHaveAttribute('data-counterstrike-outcome', 'FAILURE')

  await page.getByRole('button', { name: 'REPLAY COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
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
  await page.getByRole('button', { name: 'NEW GAME' }).click()
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
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'warning')
  await page.evaluate(() => {
    const state = window as typeof window & {
      __counterstrikeVisibility?: DocumentVisibilityState
    }
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

// Regression for Territory Monuments auto-opening over an untracked but
// available Counterstrike: First Strike completion unlocks monuments and
// Counterstrike in the same frame, so the monument offer must defer instead
// of replacing the HUD that carries the TRACK COUNTERSTRIKE control.
test('Territory Monuments defer their auto-open until an urgent Counterstrike flow resolves', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')

  // Monuments are unlocked by the same First Strike completion that makes
  // Counterstrike available, so both become eligible on the same render.
  await expect(main).toHaveAttribute('data-counterstrike-available', 'true')
  await expect(main).toHaveAttribute('data-monument-view', 'false')
  await expect(page.locator('.counterstrike-ready')).toContainText(
    'SHE ANSWERED',
  )

  // Deferred, not suppressed: the manual entry point still reaches monuments.
  await expect(
    page.getByRole('button', { name: 'TERRITORY MONUMENTS', exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await expect(main).toHaveAttribute('data-monument-view', 'false')
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
  await expect(main).toHaveAttribute('data-monument-view', 'false')

  // Hand the run to the harness immediately (before the real warning timer
  // fires) and resolve it outright; the monument must stay off-screen for
  // the whole urgent presentation, not just its opening moment.
  await setRun(page, {
    status: 'resolved',
    progress: 1,
    attemptNumber: 1,
    attemptsUsed: 1,
    outcome: 'SUCCESS',
    order: 'PRIORITIZE_INTERCEPTOR',
    replay: false,
  })
  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'SUCCESS',
  )

  // Only once the urgent flow has actually concluded does the deferred
  // monument offer resurface, proving this is a defer and not a suppression.
  await expect(main).toHaveAttribute('data-monument-view', 'true')
  await expect(page.locator('.monument-heading')).toContainText(
    'TERRITORY MONUMENTS',
  )

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
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).click()
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
  await page.getByRole('button', { name: /HARDEN OUTPOST/ }).click()
  const startedAtMs = Date.now()
  await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved', {
    timeout: 45_000,
  })
  const durationMs = Date.now() - startedAtMs
  const unattendedFailureMs =
    COUNTERSTRIKE_TIMING.commandConfirmationMs +
    COUNTERSTRIKE_TIMING.warningMs +
    (COUNTERSTRIKE_TIMING.trackingMs +
      COUNTERSTRIKE_TIMING.readyMs +
      COUNTERSTRIKE_TIMING.missedMs) *
      COUNTERSTRIKE_TIMING.maximumAttempts +
    COUNTERSTRIKE_TIMING.impactMs
  expect(durationMs).toBeGreaterThanOrEqual(unattendedFailureMs - 2_000)
  // Video encoding can delay browser task delivery. The state-machine suite
  // owns the exact unattended production budget.
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

async function readCinematicFrame(page: Page) {
  return page.locator('canvas').evaluate((canvas) => ({
    beat: canvas.dataset.counterstrikeCameraBeat,
    frame: canvas.dataset.interceptorFrame,
    routeProgress: canvas.dataset.counterstrikeRouteProgress,
    cameraX: Number(canvas.dataset.cameraX),
    points: JSON.parse(canvas.dataset.heroFraming ?? '{}') as Record<string, number[]>,
    energy: JSON.parse(canvas.dataset.counterstrikeEnergy ?? '{}') as Record<string, number>,
    metrics: {
      drawCalls: Number(canvas.dataset.drawCalls),
      triangles: Number(canvas.dataset.triangles),
      points: Number(canvas.dataset.points),
      geometries: Number(canvas.dataset.geometries),
      textures: Number(canvas.dataset.textures),
      programs: Number(canvas.dataset.programs),
      cameraClearance: Number(canvas.dataset.cameraClearance),
      cameraDistance: Number(canvas.dataset.cameraDistance),
    },
  }))
}

for (const attemptNumber of [1, 2] as const) {
  test(`focused Counterstrike cinematic attempt ${attemptNumber}: collision hold and safe portrait aftermath`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors = watchBrowserErrors(page)
    await openScene(page, createCompletedStrikeSave())
    const canvas = page.locator('canvas')
    const samples: RenderMetrics[] = []
    await setRun(page, { status: 'intercept-ready', progress: 0.3, attemptNumber, attemptsUsed: attemptNumber === 1 ? 0 : 1 })
    await setFireElapsed(page, 7_000)
    await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).tap()
    await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', 'interceptor-launched')
    await expect(page.locator('main')).toHaveAttribute('data-counterstrike-judgement', 'VALID')
    const endpoint = attemptNumber === 1 ? 0.54 : 0.88
    for (const progress of [0, 0.15, 0.5, 0.95, 0.99]) {
      await setRun(page, {
        status: 'interceptor-launched', attemptNumber, attemptsUsed: attemptNumber,
        judgement: 'VALID', progress,
        threatProgressStart: endpoint - 0.045, threatProgressEnd: endpoint,
        interceptRouteProgress: endpoint,
      })
      await expect(canvas).toHaveAttribute('data-counterstrike-route-progress', (endpoint - 0.045 + progress * 0.045).toFixed(6))
      const frame = await readCinematicFrame(page)
      expect(frame.beat).toBe(progress < 0.25 ? 'interceptor-chase' : 'interception-approach')
      expect(frame.frame).toBe(progress < 0.38 ? 'visible' : 'hidden')
      for (const name of ['null-meridian-counterstrike-missile', 'player-orbital-interceptor']) {
        expect(frame.points[name], name).toBeDefined()
        expect(Math.abs(frame.points[name]![0]!)).toBeLessThan(0.85)
        expect(Math.abs(frame.points[name]![1]!)).toBeLessThan(0.8)
        expect(frame.points[name]![2]!).toBeLessThan(1)
        expect(frame.points[name]![2]!).toBeGreaterThan(-1)
      }
      samples.push(frame.metrics)
      if (progress === 0 || progress === 0.99) {
        await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/cinematic-${attemptNumber}-${progress}.png` })
      }
    }
    // Cross the production reducer's direct-hit boundary, with a fresh hold.
    await advanceRun(page, 'success')
    await expect(canvas).toHaveAttribute('data-counterstrike-camera-beat', 'interception-hold')
    const position = (await readCinematicFrame(page)).cameraX
    for (const progress of [0, 0.02, 1_000 / COUNTERSTRIKE_TIMING.successMs]) {
      await setRun(page, { status: 'success', judgement: 'VALID', outcome: 'SUCCESS', progress, interceptRouteProgress: endpoint })
      const frame = await readCinematicFrame(page)
      expect(frame.beat).toBe('interception-hold')
      expect(frame.cameraX).toBeCloseTo(position, 6)
      expect(Math.abs(frame.points['counterstrike-orbital-breakup']![0]!)).toBeLessThan(0.85)
      expect(Math.abs(frame.points['counterstrike-orbital-breakup']![1]!)).toBeLessThan(0.8)
      expect(frame.energy.core! > 0).toBe(progress < 180 / COUNTERSTRIKE_TIMING.successMs)
      expect(frame.energy.shellOpacity! > 0).toBe(progress < 760 / COUNTERSTRIKE_TIMING.successMs)
      expect(frame.energy.surfacePulse! > 0).toBe(progress < 420 / COUNTERSTRIKE_TIMING.successMs)
      samples.push(frame.metrics)
      if (progress === 0.02) {
        await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/cinematic-impact-${attemptNumber}-${progress}.png` })
      }
    }
    for (const progress of [0.3, 0.99]) {
      await setRun(page, { status: 'success', outcome: 'SUCCESS', progress, interceptRouteProgress: endpoint })
      const frame = await readCinematicFrame(page)
      expect(frame.beat).toBe('interception-pullback')
      expect(frame.metrics.cameraClearance).toBeGreaterThan(0.075)
      samples.push(frame.metrics)
    }
    await advanceRun(page, 'resolved')
    await expect(page.locator('main')).toHaveAttribute('data-render-mode', 'demand')
    const frame = await readCinematicFrame(page)
    expect(Math.abs(frame.points['orbital-outpost-signal']![0]!)).toBeLessThan(0.85)
    expect(Math.abs(frame.points['orbital-outpost-signal']![1]!)).toBeLessThan(0.8)
    console.log(`COUNTERSTRIKE_CINEMATIC_${attemptNumber}_METRICS ` + JSON.stringify(samples))
    expect(Math.max(...samples.map(sample => sample.drawCalls))).toBeLessThanOrEqual(45)
    expect(Math.max(...samples.map(sample => sample.triangles))).toBeLessThanOrEqual(120_000)
    expect(Math.max(...samples.map(sample => sample.textures))).toBeLessThanOrEqual(6)
    expect(Math.max(...samples.map(sample => sample.programs))).toBeLessThanOrEqual(24)
    await expectCleanWebGl(page)
    expect(errors).toEqual({ console: [], page: [] })
  })
}

test('focused hero scars retain depth and readable debris without circular fill', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('first-strike:set-presentation', {
    detail: { phase: 'scar-explore', progress: 1, replay: true },
  })))
  await mkdir('artifacts/screenshots/hero-polish', { recursive: true })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'artifacts/screenshots/hero-polish/lunar-scar.png' })
  await setRun(page, { status: 'impact', progress: DAMAGE_HOLD_PROGRESS, outcome: 'FAILURE', attemptsUsed: 2 })
  await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-camera-beat', 'damage-hold')
  await page.screenshot({ path: 'artifacts/screenshots/hero-polish/outpost-scar.png' })
  expect(Number(await page.locator('canvas').getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80)
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})
