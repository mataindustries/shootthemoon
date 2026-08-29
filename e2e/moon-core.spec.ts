import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import {
  createInterruptedCinematicSave,
  createLegacyActiveExtractorSave,
  createScanAwaitingResponseSave,
} from './rivalFixtures.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots'
const SURFACE_AFTER_SCREENSHOT_DIRECTORY =
  SCREENSHOT_DIRECTORY + '/surface-presence-after'
const RIVAL_SCREENSHOT_DIRECTORY = SCREENSHOT_DIRECTORY + '/rival-signal'
const RIVAL_CAMERA_SCREENSHOT_DIRECTORY =
  RIVAL_SCREENSHOT_DIRECTORY + '/camera-reliability'
const RIVAL_RECORDING_DIRECTORY = 'artifacts/recordings/rival-signal'

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
  readonly bufferWidth: number
  readonly bufferHeight: number
}

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.console.push(message.text())
    }
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
  return errors
}

async function openReadyScene(
  page: Page,
  initialSave: string | null = null,
): Promise<void> {
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
  if (initialSave !== null) {
    await page.addInitScript(
      ({ key, value }) => {
        if (window.localStorage.getItem(key) === null) {
          window.localStorage.setItem(key, value)
        }
      },
      { key: OUTPOST_STORAGE_KEY, value: initialSave },
    )
  }
  await page.goto('/?e2e')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.scene-canvas canvas')).toHaveAttribute(
    'data-draw-calls',
    /\d+/,
  )
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('.scene-canvas canvas').boundingBox()

  if (bounds === null) {
    throw new Error('Shoot the Moon canvas has no browser layout bounds.')
  }

  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function dragTouch(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  pointerId = 1,
): Promise<void> {
  const session = await page.context().newCDPSession(page)
  const point = (x: number, y: number) => ({
    id: pointerId,
    x,
    y,
    radiusX: 5,
    radiusY: 5,
    force: 0.5,
  })

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(start.x, start.y)],
  })

  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        point(
          start.x + (end.x - start.x) * progress,
          start.y + (end.y - start.y) * progress,
        ),
      ],
    })
  }

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

async function pinchTouch(page: Page, expand: boolean): Promise<void> {
  const center = await canvasCenter(page)
  const session = await page.context().newCDPSession(page)
  const startGap = expand ? 32 : 78
  const endGap = expand ? 78 : 32
  const points = (gap: number) => [
    {
      id: 1,
      x: center.x - gap,
      y: center.y,
      radiusX: 5,
      radiusY: 5,
      force: 0.5,
    },
    {
      id: 2,
      x: center.x + gap,
      y: center.y,
      radiusX: 5,
      radiusY: 5,
      force: 0.5,
    },
  ]

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(startGap),
  })

  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(startGap + (endGap - startGap) * progress),
    })
  }

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

async function readRenderMetrics(page: Page): Promise<RenderMetrics> {
  return page.locator('.scene-canvas canvas').evaluate((canvas) => ({
    drawCalls: Number(canvas.dataset.drawCalls),
    triangles: Number(canvas.dataset.triangles),
    points: Number(canvas.dataset.points),
    geometries: Number(canvas.dataset.geometries),
    textures: Number(canvas.dataset.textures),
    programs: Number(canvas.dataset.programs),
    bufferWidth: Number(canvas.dataset.bufferWidth),
    bufferHeight: Number(canvas.dataset.bufferHeight),
  }))
}

async function readFrameCount(page: Page): Promise<number> {
  return Number(
    await page
      .locator('.scene-canvas canvas')
      .getAttribute('data-frame-count'),
  )
}

async function measureBrowserAnimationFrames(
  page: Page,
  durationMs: number,
): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        const startedAt = performance.now()
        let frames = 0
        const sample = (now: number) => {
          frames += 1

          if (now - startedAt >= duration) {
            resolve(frames)
            return
          }

          window.requestAnimationFrame(sample)
        }

        window.requestAnimationFrame(sample)
      }),
    durationMs,
  )
}

async function expectProjectedRobotVisible(page: Page): Promise<void> {
  const canvas = page.locator('.scene-canvas canvas')

  await expect
    .poll(async () => {
      const x = Number(await canvas.getAttribute('data-robot-x'))
      const y = Number(await canvas.getAttribute('data-robot-y'))
      return x >= 8 && x <= page.viewportSize()!.width - 8 &&
        y >= 100 && y <= page.viewportSize()!.height - 100
    })
    .toBe(true)
}

async function selectCanvasCenter(page: Page): Promise<void> {
  const center = await canvasCenter(page)
  await page.touchscreen.tap(center.x, center.y)
  await expect(page.locator('.site-panel')).toBeVisible()
}

async function setCinematicProgress(page: Page, progress: number): Promise<void> {
  await page.evaluate((value) => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: value },
      }),
    )
  }, progress)
}

async function setRivalPresentation(
  page: Page,
  phase: string,
  progress: number | null,
  replay = false,
): Promise<void> {
  await page.evaluate(
    (detail) => {
      window.dispatchEvent(
        new CustomEvent('rival-signal:set-presentation', { detail }),
      )
    },
    { phase, progress, replay },
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-rival-presentation',
    phase,
  )
  await page.waitForTimeout(100)
}

async function setOrbitView(
  page: Page,
  detail: {
    readonly latitudeRad: number
    readonly longitudeRad: number
    readonly distance?: number
  },
): Promise<void> {
  await page.evaluate((view) => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-orbit-view', { detail: view }),
    )
  }, detail)
  await page.waitForTimeout(100)
}

async function readCameraContract(page: Page) {
  const canvas = page.locator('.scene-canvas canvas')

  return canvas.evaluate((element) => ({
    mode: element.dataset.cameraMode ?? null,
    radius: Number(element.dataset.cameraRadius),
    minimumRadius: Number(element.dataset.cameraPathMinimumRadius),
    position: [
      Number(element.dataset.cameraX),
      Number(element.dataset.cameraY),
      Number(element.dataset.cameraZ),
    ],
    target: [
      Number(element.dataset.cameraTargetX),
      Number(element.dataset.cameraTargetY),
      Number(element.dataset.cameraTargetZ),
    ],
  }))
}

async function expectSafeCameraContract(page: Page): Promise<void> {
  const sample = await readCameraContract(page)

  expect(Number.isFinite(sample.radius)).toBe(true)
  expect(Number.isFinite(sample.minimumRadius)).toBe(true)
  expect(sample.radius + 0.000002).toBeGreaterThanOrEqual(sample.minimumRadius)
  expect(sample.position.every(Number.isFinite)).toBe(true)
  expect(sample.target.every(Number.isFinite)).toBe(true)
}

async function advanceRivalPresentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('rival-signal:advance-presentation'),
    )
  })
  await page.waitForTimeout(120)
}

async function setSimulationPaused(
  page: Page,
  paused: boolean,
  visualOffsetMs = 0,
): Promise<void> {
  await page.evaluate((detail) => {
    window.dispatchEvent(
      new CustomEvent('first-outpost:set-simulation-paused', {
        detail,
      }),
    )
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: null },
      }),
    )
  }, { paused, visualOffsetMs })

  if (paused) {
    await page.waitForTimeout(220)
  }
}

async function setSimulationPausedAt(
  page: Page,
  absoluteNowMs: number,
): Promise<void> {
  await page.evaluate((fixedNowMs) => {
    window.dispatchEvent(
      new CustomEvent('first-outpost:set-simulation-paused', {
        detail: {
          paused: true,
          visualOffsetMs: fixedNowMs - Date.now(),
        },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: null },
      }),
    )
  }, absoluteNowMs)
  await page.waitForTimeout(220)
}

async function setTransitionsPaused(
  page: Page,
  paused: boolean,
): Promise<void> {
  await page.evaluate((value) => {
    window.dispatchEvent(
      new CustomEvent('first-outpost:set-transitions-paused', {
        detail: { paused: value },
      }),
    )
  }, paused)
}

async function pauseTransitionsWhenRobotState(
  page: Page,
  robotState: string,
): Promise<void> {
  await page.evaluate((targetState) => {
    const main = document.querySelector('main')

    if (main === null) {
      throw new Error('Shoot the Moon root was unavailable for transition pause.')
    }

    const pause = () => {
      window.dispatchEvent(
        new CustomEvent('first-outpost:set-transitions-paused', {
          detail: { paused: true },
        }),
      )
    }

    if ((main as HTMLElement).dataset.robotState === targetState) {
      pause()
      return
    }

    const observer = new MutationObserver(() => {
      if ((main as HTMLElement).dataset.robotState === targetState) {
        observer.disconnect()
        pause()
      }
    })
    observer.observe(main, {
      attributeFilter: ['data-robot-state'],
      attributes: true,
    })
  }, robotState)
}

async function tapProjectedPoint(
  page: Page,
  xAttribute: string,
  yAttribute: string,
): Promise<void> {
  const canvas = page.locator('.scene-canvas canvas')
  await expect(canvas).toHaveAttribute(xAttribute, /\d/)
  await expect(canvas).toHaveAttribute(yAttribute, /\d/)
  const x = Number(await canvas.getAttribute(xAttribute))
  const y = Number(await canvas.getAttribute(yAttribute))
  expect(Number.isFinite(x)).toBe(true)
  expect(Number.isFinite(y)).toBe(true)
  await page.touchscreen.tap(x, y)
}

test('complete mobile First Outpost loop queues one Rival Signal after extractor activation', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  await expect(page.locator('main')).toHaveAttribute('data-quality', 'medium')
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')
  const center = await canvasCenter(page)

  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/01-initial-orbit-mobile.png',
  })
  const orbitalMetrics = await readRenderMetrics(page)
  console.log('FIRST_OUTPOST_MOBILE_ORBIT_METRICS ' + JSON.stringify(orbitalMetrics))
  expect(orbitalMetrics.drawCalls).toBeLessThanOrEqual(20)
  expect(orbitalMetrics.triangles).toBeLessThanOrEqual(120_000)

  const azimuthBefore = Number(await canvas.getAttribute('data-camera-azimuth'))
  await dragTouch(
    page,
    { x: center.x - 48, y: center.y - 10 },
    { x: center.x + 54, y: center.y + 28 },
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)

  const distanceBefore = Number(await canvas.getAttribute('data-camera-distance'))
  await pinchTouch(page, true)
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .not.toBeCloseTo(distanceBefore, 2)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.waitForTimeout(450)
  await selectCanvasCenter(page)
  const sitePanel = page.locator('.site-panel')
  const latitude = Number(await sitePanel.getAttribute('data-latitude-rad'))
  const longitude = Number(await sitePanel.getAttribute('data-longitude-rad'))
  expect(Number.isFinite(latitude)).toBe(true)
  expect(Number.isFinite(longitude)).toBe(true)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/02-selected-site-mobile.png',
  })

  await dragTouch(
    page,
    { x: center.x - 30, y: center.y + 20 },
    { x: center.x + 80, y: center.y + 260 },
    7,
  )
  expect(Number(await sitePanel.getAttribute('data-latitude-rad'))).toBe(latitude)
  expect(Number(await sitePanel.getAttribute('data-longitude-rad'))).toBe(longitude)

  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).click()
  await expect(main).toHaveAttribute('data-phase', 'approach')
  await setCinematicProgress(page, 0.9)
  await page.waitForTimeout(250)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/03-capsule-impact-mobile.png',
  })
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 6_000 })
  await expect(main).toHaveAttribute('data-robot-state', 'stored')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player', {
    timeout: 6_000,
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/04-landed-site-mobile.png',
  })
  await page.screenshot({
    path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/01-default-landed.png',
  })

  const storedMetrics = await readRenderMetrics(page)
  console.log('FIRST_OUTPOST_STORED_SURFACE_METRICS ' + JSON.stringify(storedMetrics))
  expect(storedMetrics.drawCalls).toBeLessThanOrEqual(80)
  expect(storedMetrics.triangles).toBeLessThanOrEqual(200_000)
  expect(storedMetrics.textures).toBeLessThanOrEqual(12)

  const deployBounds = await page
    .getByRole('button', { name: 'DEPLOY MINER' })
    .boundingBox()
  const orbitReturnBounds = await page
    .getByRole('button', { name: 'RETURN TO ORBIT' })
    .boundingBox()
  expect(deployBounds?.height ?? 0).toBeGreaterThanOrEqual(48)
  expect(orbitReturnBounds?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(orbitReturnBounds?.y ?? 900).toBeLessThan(824)

  const storedIdleFrame = await readFrameCount(page)
  await page.waitForTimeout(800)
  const storedIdleFrames = (await readFrameCount(page)) - storedIdleFrame
  console.log(
    'FIRST_OUTPOST_STORED_IDLE ' + JSON.stringify({ frames: storedIdleFrames, durationMs: 800 }),
  )
  expect(storedIdleFrames).toBeLessThanOrEqual(2)

  await page.setViewportSize({ width: 390, height: 780 })
  const compactReturnBounds = await page
    .getByRole('button', { name: 'RETURN TO ORBIT' })
    .boundingBox()
  expect(
    (compactReturnBounds?.y ?? 900) + (compactReturnBounds?.height ?? 0),
  ).toBeLessThanOrEqual(760)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)

  await setSimulationPaused(page, true)
  await page.getByRole('button', { name: 'DEPLOY MINER' }).click()
  await expect(main).toHaveAttribute('data-robot-state', 'deploying')
  await setSimulationPaused(page, true, 850)
  await expect(canvas).toHaveAttribute(
    'data-camera-mode',
    'surface-focus-deployment',
  )
  await page.waitForTimeout(650)
  await expectProjectedRobotVisible(page)
  await page.screenshot({
    path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/02-robot-deployment.png',
  })
  await setSimulationPaused(page, false)
  await expect(main).toHaveAttribute('data-robot-state', 'idle', {
    timeout: 5_000,
  })
  await page.waitForTimeout(850)
  await setSimulationPaused(page, true)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/06-capsule-opened-robot-deployed.png',
  })
  await setSimulationPaused(page, false)
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')

  const scannerIdleFrame = await readFrameCount(page)
  await page.waitForTimeout(1_000)
  const scannerIdleFrames = (await readFrameCount(page)) - scannerIdleFrame
  console.log(
    'FIRST_OUTPOST_SCANNER_IDLE ' +
      JSON.stringify({ frames: scannerIdleFrames, durationMs: 1_000 }),
  )
  expect(scannerIdleFrames).toBeLessThanOrEqual(10)

  await tapProjectedPoint(
    page,
    'data-deposit-gamma-x',
    'data-deposit-gamma-y',
  )
  await expect(main).toHaveAttribute('data-selected-deposit', 'deposit-gamma')
  await expect(page.locator('.deposit-readout')).toContainText('LUNAR ORE')

  await pauseTransitionsWhenRobotState(page, 'mining')
  await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  await expect(main).toHaveAttribute('data-robot-state', 'mining', {
    timeout: 6_000,
  })
  await expect(main).toHaveAttribute('data-render-mode', 'continuous')
  const miningFrame = await readFrameCount(page)
  const availableAnimationFrames = await measureBrowserAnimationFrames(page, 600)
  const renderedMiningFrames = (await readFrameCount(page)) - miningFrame
  console.log(
    'FIRST_OUTPOST_SUSTAINED_ANIMATION ' +
      JSON.stringify({ availableAnimationFrames, renderedMiningFrames }),
  )
  expect(availableAnimationFrames).toBeGreaterThanOrEqual(2)
  expect(renderedMiningFrames).toBeGreaterThan(3)
  expect(renderedMiningFrames).toBeGreaterThanOrEqual(
    Math.max(3, availableAnimationFrames - 2),
  )
  await setSimulationPaused(page, true, 850)
  await expect(canvas).toHaveAttribute(
    'data-camera-mode',
    'surface-focus-mining',
  )
  await page.waitForTimeout(650)
  await expectProjectedRobotVisible(page)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/07-robot-mining.png',
  })
  await page.screenshot({
    path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/03-mining-close-view.png',
  })
  await setSimulationPaused(page, false)
  await setTransitionsPaused(page, false)
  await expect(main).toHaveAttribute('data-robot-state', 'idle', {
    timeout: 8_000,
  })
  await expect(main).toHaveAttribute('data-lunar-ore', '35')

  await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  await expect(main).toHaveAttribute('data-robot-state', 'returning', {
    timeout: 9_000,
  })
  await setSimulationPaused(page, true, 720)
  await expect(canvas).toHaveAttribute(
    'data-camera-mode',
    'surface-focus-return',
  )
  await page.waitForTimeout(400)
  await expectProjectedRobotVisible(page)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/08-robot-returning-cargo.png',
  })
  await page.screenshot({
    path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/04-cargo-return.png',
  })
  await setSimulationPaused(page, false)
  await expect(main).toHaveAttribute('data-robot-state', 'idle', {
    timeout: 8_000,
  })
  await expect(main).toHaveAttribute('data-lunar-ore', '70')
  await expect(
    page.getByRole('button', { name: /CONSTRUCT EXTRACTOR/ }),
  ).toBeVisible()

  await setSimulationPaused(page, true)
  await page.getByRole('button', { name: /CONSTRUCT EXTRACTOR/ }).click()
  await expect(main).toHaveAttribute('data-extractor-status', 'constructing')
  await expect(page.locator('.phase-label')).toHaveText('EXTRACTOR ASSEMBLY')
  await setSimulationPaused(page, true, 1_700)
  await expect(canvas).toHaveAttribute(
    'data-camera-mode',
    'surface-focus-construction',
  )
  await page.waitForTimeout(600)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/09-extractor-construction.png',
  })
  await setSimulationPaused(page, false)
  await expect(main).toHaveAttribute('data-outpost-stage', 'extractor-active', {
    timeout: 5_000,
  })
  const activationTimestampMs = Number(
    await main.getAttribute('data-extractor-activation-at'),
  )
  expect(Number.isFinite(activationTimestampMs)).toBe(true)
  await setSimulationPausedAt(page, activationTimestampMs + 500)
  await expect(canvas).toHaveAttribute(
    'data-camera-mode',
    'surface-focus-activation',
  )
  await page.waitForTimeout(650)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/10-extractor-active.png',
  })
  await page.screenshot({
    path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/05-active-extractor.png',
  })

  const focusedExtractorMetrics = await readRenderMetrics(page)
  console.log(
    'FIRST_OUTPOST_FOCUSED_EXTRACTOR_METRICS ' +
      JSON.stringify(focusedExtractorMetrics),
  )

  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/01-player-outpost-before-interruption.png',
  })
  await setSimulationPaused(page, false)
  await expect(main).toHaveAttribute('data-rival-presentation', 'warning', {
    timeout: 5_000,
  })
  await setRivalPresentation(page, 'warning', 0.58)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/02-unidentified-signal-warning.png',
  })
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'CINEMATIC')
  await expect(main).toHaveAttribute('data-rival-signal-held', 'false')
  expect(errors).toEqual({ console: [], page: [] })
})

test('Rival Signal camera is invariant across controlled starting orientations', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = watchBrowserErrors(page)
  const starts = [
    { latitudeRad: 0.1, longitudeRad: 0.2, distance: 2.12 },
    { latitudeRad: 1.36, longitudeRad: Math.PI - 0.02, distance: 4.7 },
    { latitudeRad: -1.31, longitudeRad: -Math.PI + 0.03, distance: 5.8 },
  ] as const
  let referenceMidpoint: Awaited<ReturnType<typeof readCameraContract>> | null =
    null

  await openReadyScene(page, createLegacyActiveExtractorSave())

  for (const [index, start] of starts.entries()) {
    if (index > 0) {
      await page.evaluate(
        ({ key, value }) => window.localStorage.setItem(key, value),
        {
          key: OUTPOST_STORAGE_KEY,
          value: createLegacyActiveExtractorSave(),
        },
      )
      await page.reload()
      await expect(page.locator('main')).toHaveAttribute(
        'data-scene-ready',
        'true',
      )
    }

    const main = page.locator('main')
    await expect(main).toHaveAttribute(
      'data-rival-reveal-state',
      'AWAITING_SAFE_MOMENT',
    )
    await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
    await setCinematicProgress(page, 1)
    await expect(main).toHaveAttribute('data-phase', 'orbit')
    await expect(main).toHaveAttribute('data-rival-presentation', 'warning')
    await setRivalPresentation(page, 'warning', 0.5)
    await setOrbitView(page, start)
    const controlledStart = await readCameraContract(page)
    expect(controlledStart.radius).toBeCloseTo(start.distance, 4)

    await advanceRivalPresentation(page)
    await setRivalPresentation(page, 'orbital-transition', 0)
    await expectSafeCameraContract(page)
    const normalizedStart = await readCameraContract(page)
    expect(normalizedStart.radius).toBeCloseTo(4.7, 4)

    for (const progress of [0.5, 1]) {
      await setRivalPresentation(
        page,
        'orbital-transition',
        progress,
      )
      await expectSafeCameraContract(page)
    }

    await setRivalPresentation(page, 'orbital-transition', 0.5)
    const midpoint = await readCameraContract(page)

    if (referenceMidpoint === null) {
      referenceMidpoint = midpoint
    } else {
      expect(midpoint.position).toEqual(referenceMidpoint.position)
      expect(midpoint.target).toEqual(referenceMidpoint.target)
      expect(midpoint.radius).toBe(referenceMidpoint.radius)
    }

    if (index === 0) {
      for (const phase of ['capsule-approach', 'impact', 'dual-sites'] as const) {
        await setRivalPresentation(page, phase, 0.5)
        await expectSafeCameraContract(page)
      }

      await setRivalPresentation(page, 'capsule-approach', 0.55)
      await page.setViewportSize({ width: 844, height: 390 })
      await page.waitForTimeout(180)
      await expectSafeCameraContract(page)
      expect((await readCameraContract(page)).mode).toBe(
        'rival-capsule-approach',
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(180)
      await expectSafeCameraContract(page)
    }
  }

  expect(errors).toEqual({ console: [], page: [] })
})

test('Rival Signal cinematic clock pauses across visibility loss', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createLegacyActiveExtractorSave())
  const main = page.locator('main')

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-rival-presentation', 'warning')
  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute(
    'data-rival-presentation',
    'orbital-transition',
  )
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    const state = window as typeof window & {
      __testVisibilityState?: DocumentVisibilityState
    }
    state.__testVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.__testVisibilityState,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(main).toHaveAttribute('data-rival-clock-running', 'false')
  await new Promise((resolve) => setTimeout(resolve, 6_500))
  await page.evaluate(() => {
    const state = window as typeof window & {
      __testVisibilityState?: DocumentVisibilityState
    }
    state.__testVisibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(500)
  await expect(main).toHaveAttribute(
    'data-rival-presentation',
    'orbital-transition',
  )
  await expect(main).toHaveAttribute('data-rival-clock-running', 'true')
  await expectSafeCameraContract(page)
  await page.evaluate(() => {
    delete (window as typeof window & { __testVisibilityState?: string })
      .__testVisibilityState
    delete (document as Document & { visibilityState?: string })
      .visibilityState
  })
  expect(errors).toEqual({ console: [], page: [] })
})

test('complete paced Rival Signal reveal restores controllable orbit', async ({
  page,
}) => {
  test.setTimeout(75_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createLegacyActiveExtractorSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-rival-presentation', 'warning')
  await page.evaluate(() => {
    const root = document.querySelector('main') as HTMLElement | null

    if (root === null) {
      throw new Error('Rival phase timeline root was unavailable.')
    }

    const state = window as typeof window & {
      __rivalCameraTimeline?: {
        phases: Array<{ phase: string; atMs: number }>
        minimumMargin: number
      }
    }
    state.__rivalCameraTimeline = {
      phases: [
        {
          phase: root.dataset.rivalPresentation ?? 'unknown',
          atMs: performance.now(),
        },
      ],
      minimumMargin: Number.POSITIVE_INFINITY,
    }
    const observer = new MutationObserver(() => {
      const timeline = state.__rivalCameraTimeline

      if (timeline === undefined) {
        return
      }

      timeline.phases.push({
        phase: root.dataset.rivalPresentation ?? 'unknown',
        atMs: performance.now(),
      })

      if (root.dataset.rivalPresentation === 'idle') {
        observer.disconnect()
      }
    })
    observer.observe(root, {
      attributeFilter: ['data-rival-presentation'],
      attributes: true,
    })

    const sampleCamera = () => {
      const timeline = state.__rivalCameraTimeline
      const canvas = document.querySelector(
        '.scene-canvas canvas',
      ) as HTMLCanvasElement | null

      if (timeline === undefined || canvas === null) {
        return
      }

      const radius = Number(canvas.dataset.cameraRadius)
      const minimumRadius = Number(canvas.dataset.cameraPathMinimumRadius)

      if (Number.isFinite(radius) && Number.isFinite(minimumRadius)) {
        timeline.minimumMargin = Math.min(
          timeline.minimumMargin,
          radius - minimumRadius,
        )
      }

      if (root.dataset.rivalPresentation !== 'idle') {
        window.requestAnimationFrame(sampleCamera)
      }
    }
    window.requestAnimationFrame(sampleCamera)
  })
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle', {
    timeout: 40_000,
  })
  const timeline = await page.evaluate(() => {
    const state = window as typeof window & {
      __rivalCameraTimeline?: {
        phases: Array<{ phase: string; atMs: number }>
        minimumMargin: number
      }
    }

    return state.__rivalCameraTimeline ?? null
  })
  expect(timeline).not.toBeNull()
  const phases = timeline?.phases.map((entry) => entry.phase) ?? []
  expect(phases).toEqual([
    'warning',
    'orbital-transition',
    'capsule-approach',
    'impact',
    'intro-transmission',
    'dual-sites',
    'idle',
  ])
  const revealDurationMs =
    (timeline?.phases.at(-1)?.atMs ?? 0) -
    (timeline?.phases[0]?.atMs ?? 0)
  expect(revealDurationMs).toBeGreaterThanOrEqual(25_000)
  expect(revealDurationMs).toBeLessThanOrEqual(40_000)
  expect(timeline?.minimumMargin ?? -1).toBeGreaterThanOrEqual(-0.000002)
  console.log(
    'RIVAL_SIGNAL_PACED_REVEAL ' +
      JSON.stringify({
        durationMs: revealDurationMs,
        minimumRadiusMargin: timeline?.minimumMargin ?? null,
        phases,
      }),
  )
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/07-final-controllable-orbit.png',
  })

  const azimuthBefore = Number(await canvas.getAttribute('data-camera-azimuth'))
  const center = await canvasCenter(page)
  await dragTouch(
    page,
    { x: center.x - 52, y: center.y - 12 },
    { x: center.x + 58, y: center.y + 24 },
    31,
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)
  expect(errors).toEqual({ console: [], page: [] })

  const video = page.video()

  if (video !== null && process.env.RIVAL_RECORDING === '1') {
    await mkdir(RIVAL_RECORDING_DIRECTORY, { recursive: true })
    await page.close()
    await video.saveAs(
      RIVAL_RECORDING_DIRECTORY + '/corrected-rival-signal-reveal.webm',
    )
  }
})

test('complete migrated-save Rival Signal loop, restoration, reset, and performance', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createLegacyActiveExtractorSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(main).toHaveAttribute(
    'data-rival-reveal-state',
    'AWAITING_SAFE_MOMENT',
  )
  await expect(main).toHaveAttribute('data-rival-signal-held', 'true')
  await page.waitForTimeout(500)
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 5_000 })
  await expect(main).toHaveAttribute('data-rival-presentation', 'warning', {
    timeout: 5_000,
  })
  await setRivalPresentation(page, 'warning', 0.58)

  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute(
    'data-rival-presentation',
    'orbital-transition',
  )
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/01-transition-start.png',
  })
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 5_000 })
  await setRivalPresentation(page, 'orbital-transition', 0.52)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/03-orbital-transition.png',
  })
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/02-orbital-midpoint.png',
  })
  const orbitalTransitionMetrics = await readRenderMetrics(page)
  console.log(
    'RIVAL_SIGNAL_ORBITAL_TRANSITION_METRICS ' +
      JSON.stringify(orbitalTransitionMetrics),
  )

  await advanceRivalPresentation(page)
  await setRivalPresentation(page, 'capsule-approach', 0.78)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/04-rival-capsule-approach.png',
  })
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/03-capsule-approach.png',
  })
  const capsuleMetrics = await readRenderMetrics(page)
  console.log('RIVAL_SIGNAL_CAPSULE_METRICS ' + JSON.stringify(capsuleMetrics))

  await advanceRivalPresentation(page)
  await setRivalPresentation(page, 'impact', 0.72)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/05-rival-impact.png',
  })
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/04-impact.png',
  })
  const impactMetrics = await readRenderMetrics(page)
  console.log('RIVAL_SIGNAL_IMPACT_METRICS ' + JSON.stringify(impactMetrics))
  expect(impactMetrics.drawCalls).toBeLessThanOrEqual(100)
  expect(impactMetrics.triangles).toBeLessThanOrEqual(220_000)

  await advanceRivalPresentation(page)
  await expect(page.locator('.rival-transmission')).toContainText(
    'COMMANDER VESPER',
  )
  await expect(page.locator('.rival-transmission')).toContainText(
    'something to lose',
  )
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/05-vesper-introduction.png',
  })
  await page.getByRole('button', { name: 'HOLD THE CHANNEL' }).click()
  await expect(main).toHaveAttribute('data-rival-presentation', 'dual-sites')
  await setRivalPresentation(page, 'dual-sites', 1)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/06-both-sites-visible.png',
  })
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/06-dual-site-reveal.png',
  })
  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
  await expect(main).toHaveAttribute('data-rival-stage', 'LANDED')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  await page.screenshot({
    path: RIVAL_CAMERA_SCREENSHOT_DIRECTORY + '/07-final-controllable-orbit.png',
  })

  const contestedOrbitMetrics = await readRenderMetrics(page)
  console.log(
    'RIVAL_SIGNAL_BOTH_SIGNATURES_METRICS ' +
      JSON.stringify(contestedOrbitMetrics),
  )
  expect(contestedOrbitMetrics.drawCalls).toBeLessThanOrEqual(30)
  expect(contestedOrbitMetrics.triangles).toBeLessThanOrEqual(120_000)

  await tapProjectedPoint(
    page,
    'data-rival-signal-x',
    'data-rival-signal-y',
  )
  await expect(main).toHaveAttribute('data-rival-presentation', 'rival-focus')
  await setRivalPresentation(page, 'rival-focus', 1)
  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute('data-rival-presentation', 'rival-focused')
  await expect(page.getByRole('button', { name: 'SCAN RIVAL SITE' })).toBeVisible()
  const scanButtonBounds = await page
    .getByRole('button', { name: 'SCAN RIVAL SITE' })
    .boundingBox()
  expect(scanButtonBounds?.height ?? 0).toBeGreaterThanOrEqual(48)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/07-rival-focused.png',
  })
  const rivalFocusedMetrics = await readRenderMetrics(page)
  console.log(
    'RIVAL_SIGNAL_FOCUSED_METRICS ' + JSON.stringify(rivalFocusedMetrics),
  )
  expect(rivalFocusedMetrics.drawCalls).toBeLessThanOrEqual(45)
  expect(rivalFocusedMetrics.triangles).toBeLessThanOrEqual(90_000)

  const rivalFocusAzimuthBefore = Number(
    await canvas.getAttribute('data-camera-azimuth'),
  )
  const rivalCenter = await canvasCenter(page)
  await dragTouch(
    page,
    { x: rivalCenter.x - 42, y: rivalCenter.y - 16 },
    { x: rivalCenter.x + 52, y: rivalCenter.y + 22 },
    19,
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(rivalFocusAzimuthBefore, 2)
  await expect(main).toHaveAttribute('data-rival-scan-complete', 'false')

  await page.getByRole('button', { name: 'SCAN RIVAL SITE' }).click()
  await setRivalPresentation(page, 'scanning', 0.52)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/08-scan-in-progress.png',
  })
  const scanMetrics = await readRenderMetrics(page)
  console.log('RIVAL_SIGNAL_SCAN_METRICS ' + JSON.stringify(scanMetrics))
  expect(scanMetrics.drawCalls).toBeLessThanOrEqual(55)
  expect(scanMetrics.triangles).toBeLessThanOrEqual(100_000)

  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute('data-rival-stage', 'ESTABLISHING')
  await expect(main).toHaveAttribute('data-rival-scan-complete', 'true')
  await expect(page.locator('.rival-transmission')).toContainText(
    'You found me. Good.',
  )
  await page.getByRole('button', { name: 'END TRANSMISSION' }).click()
  await expect(main).toHaveAttribute('data-rival-presentation', 'contested')
  await expect(main).toHaveAttribute('data-rival-response-complete', 'true')
  await setRivalPresentation(page, 'contested', 1)
  await expect(page.locator('.rival-contested')).toContainText(
    'The Moon has room for two claims. I do not.',
  )
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/09-final-contested-moon.png',
  })
  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(main).toHaveAttribute('data-lunar-control', 'contested')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')

  await page.waitForTimeout(400)
  const contestedIdleFrame = await readFrameCount(page)
  await page.waitForTimeout(1_400)
  const contestedIdleFrames =
    (await readFrameCount(page)) - contestedIdleFrame
  console.log(
    'RIVAL_SIGNAL_CONTESTED_IDLE ' +
      JSON.stringify({ frames: contestedIdleFrames, durationMs: 1_400 }),
  )
  expect(contestedIdleFrames).toBeLessThanOrEqual(14)

  const orbitAzimuthBefore = Number(
    await canvas.getAttribute('data-camera-azimuth'),
  )
  const orbitCenter = await canvasCenter(page)
  await dragTouch(
    page,
    { x: orbitCenter.x - 52, y: orbitCenter.y - 12 },
    { x: orbitCenter.x + 58, y: orbitCenter.y + 24 },
    21,
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(orbitAzimuthBefore, 2)

  await tapProjectedPoint(
    page,
    'data-outpost-signal-x',
    'data-outpost-signal-y',
  )
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 5_000 })
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')

  const activeMetrics = await readRenderMetrics(page)
  console.log(
    'RIVAL_SIGNAL_PLAYER_SURFACE_METRICS ' + JSON.stringify(activeMetrics),
  )
  expect(activeMetrics.drawCalls).toBeLessThanOrEqual(60)
  expect(activeMetrics.triangles).toBeLessThanOrEqual(60_000)
  expect(activeMetrics.geometries).toBeLessThanOrEqual(55)
  expect(activeMetrics.textures).toBeLessThanOrEqual(6)
  expect(activeMetrics.programs).toBeLessThanOrEqual(24)

  const activeIdleFrame = await readFrameCount(page)
  await page.waitForTimeout(1_400)
  const activeIdleFrames = (await readFrameCount(page)) - activeIdleFrame
  console.log(
    'RIVAL_SIGNAL_PLAYER_SURFACE_IDLE ' +
      JSON.stringify({ frames: activeIdleFrames, durationMs: 1_400 }),
  )
  expect(activeIdleFrames).toBeLessThanOrEqual(16)

  const oreBeforeRefresh = Number(await main.getAttribute('data-lunar-ore'))
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 5_000 })
  await tapProjectedPoint(
    page,
    'data-rival-signal-x',
    'data-rival-signal-y',
  )
  await setRivalPresentation(page, 'rival-focus', 1)
  await advanceRivalPresentation(page)
  await expect(page.getByRole('button', { name: 'REVIEW SIGNAL' })).toBeVisible()
  await page.getByRole('button', { name: 'REVIEW SIGNAL' }).click()
  await expect(page.getByRole('button', { name: 'SKIP REVIEW' })).toBeVisible()
  await page.getByRole('button', { name: 'SKIP REVIEW' }).click()
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')

  await page.reload()
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(main).toHaveAttribute('data-outpost-stage', 'extractor-active')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
  await expect(main).toHaveAttribute('data-rival-stage', 'ESTABLISHING')
  await expect(main).toHaveAttribute('data-rival-scan-complete', 'true')
  await expect(main).toHaveAttribute('data-rival-response-complete', 'true')
  await expect(page.locator('.rival-transmission')).toHaveCount(0)
  expect(Number(await main.getAttribute('data-lunar-ore'))).toBeGreaterThanOrEqual(
    oreBeforeRefresh,
  )
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 5_000 })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/10-restored-contested-moon.png',
  })
  await expect(canvas).toHaveAttribute('data-rival-signal-x', /\d/)
  await expect(canvas).toHaveAttribute('data-outpost-signal-x', /\d/)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(350)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: RIVAL_SCREENSHOT_DIRECTORY + '/11-landscape-contested.png',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)

  expect(
    await page.evaluate(
      () => localStorage.getItem('shoot-the-moon:first-outpost:v1') !== null,
    ),
  ).toBe(true)
  const mobileWebglState = await canvas.evaluate((element) => {
    const context = element.getContext('webgl2')
    return {
      contextLost: context?.isContextLost() ?? null,
      error: context?.getError() ?? null,
    }
  })
  expect(mobileWebglState).toEqual({ contextLost: false, error: 0 })
  expect(errors).toEqual({ console: [], page: [] })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).click()
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await expect(main).toHaveAttribute('data-outpost-stage', 'none')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'none')
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(main).toHaveAttribute('data-rival-signal-held', 'false')
  expect(
    await page.evaluate(
      () => localStorage.getItem('shoot-the-moon:first-outpost:v1'),
    ),
  ).toBeNull()
})

test('interrupted cinematic normalizes to a held, resumable reveal', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createInterruptedCinematicSave())
  const main = page.locator('main')

  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'QUEUED')
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(main).toHaveAttribute('data-rival-signal-held', 'true')
  await expect(page.locator('.rival-transmission')).toHaveCount(0)

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-rival-presentation', 'warning')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'CINEMATIC')
  await page.waitForTimeout(120)
  await page.reload()

  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(main).toHaveAttribute('data-rival-reveal-state', 'QUEUED')
  await expect(main).toHaveAttribute('data-rival-presentation', 'idle')
  await expect(main).toHaveAttribute('data-rival-signal-held', 'true')
  await expect(page.locator('.rival-transmission')).toHaveCount(0)
  expect(errors).toEqual({ console: [], page: [] })
})

test('restored completed scan resumes its one pending rival response', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page, createScanAwaitingResponseSave())
  const main = page.locator('main')

  await expect(main).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
  await expect(main).toHaveAttribute('data-rival-stage', 'ESTABLISHING')
  await expect(main).toHaveAttribute('data-rival-scan-complete', 'true')
  await expect(main).toHaveAttribute('data-rival-response-complete', 'false')
  await expect(page.locator('.rival-transmission')).toHaveCount(0)

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await tapProjectedPoint(
    page,
    'data-rival-signal-x',
    'data-rival-signal-y',
  )
  await setRivalPresentation(page, 'rival-focus', 1)
  await advanceRivalPresentation(page)
  await expect(main).toHaveAttribute('data-rival-presentation', 'scan-response')
  await expect(page.locator('.rival-transmission')).toContainText(
    'You found me. Good.',
  )
  await page.getByRole('button', { name: 'END TRANSMISSION' }).click()
  await expect(main).toHaveAttribute('data-rival-response-complete', 'true')
  expect(errors).toEqual({ console: [], page: [] })
})

test('surface selection remains valid at a limb, poles, and longitude seam', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  const center = await canvasCenter(page)
  const targetViews = [
    { name: 'near side', latitudeRad: 0, longitudeRad: 0 },
    { name: 'north pole', latitudeRad: 1.47, longitudeRad: 0.4 },
    { name: 'south pole', latitudeRad: -1.47, longitudeRad: -0.8 },
    { name: 'east seam', latitudeRad: 0.18, longitudeRad: Math.PI - 0.012 },
    { name: 'west seam', latitudeRad: -0.2, longitudeRad: -Math.PI + 0.012 },
  ] as const

  for (const target of targetViews) {
    await page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent('moon-core:set-orbit-view', { detail }))
    }, target)
    await page.waitForTimeout(80)
    await page.touchscreen.tap(center.x, center.y)
    const panel = page.locator('.site-panel')
    await expect(panel, target.name).toBeVisible()
    const latitude = Number(await panel.getAttribute('data-latitude-rad'))
    const longitude = Number(await panel.getAttribute('data-longitude-rad'))
    expect(Number.isFinite(latitude), target.name).toBe(true)
    expect(Number.isFinite(longitude), target.name).toBe(true)
    expect(Math.abs(latitude), target.name).toBeLessThanOrEqual(Math.PI / 2)
    expect(Math.abs(longitude), target.name).toBeLessThanOrEqual(Math.PI)

    if (target.name === 'east seam' || target.name === 'west seam') {
      const wrappedDifference = Math.abs(
        Math.atan2(
          Math.sin(longitude - target.longitudeRad),
          Math.cos(longitude - target.longitudeRad),
        ),
      )
      expect(wrappedDifference, target.name).toBeLessThan(0.08)
    }
  }

  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('moon-core:set-orbit-view', { detail }))
  }, { latitudeRad: 0.15, longitudeRad: 0.5, distance: 4.5 })
  await page.waitForTimeout(80)
  await page.touchscreen.tap(center.x + 142, center.y)
  const limbPanel = page.locator('.site-panel')
  await expect(limbPanel).toBeVisible()
  expect(Number.isFinite(Number(await limbPanel.getAttribute('data-latitude-rad')))).toBe(
    true,
  )
  expect(errors).toEqual({ console: [], page: [] })
})

test('clear and aborted descent preserve repeat landing-site selection', async ({ page }) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  const canvas = page.locator('.scene-canvas canvas')
  const center = await canvasCenter(page)

  await selectCanvasCenter(page)
  await page.getByRole('button', { name: 'CLEAR SITE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit')

  const azimuthBefore = Number(await canvas.getAttribute('data-camera-azimuth'))
  await dragTouch(
    page,
    { x: center.x - 50, y: center.y + 8 },
    { x: center.x + 58, y: center.y - 20 },
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)

  await selectCanvasCenter(page)
  const firstLatitude = Number(
    await page.locator('.site-panel').getAttribute('data-latitude-rad'),
  )
  const firstLongitude = Number(
    await page.locator('.site-panel').getAttribute('data-longitude-rad'),
  )
  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).click()
  await page.getByRole('button', { name: 'ABORT DESCENT' }).click()
  await setCinematicProgress(page, 1)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit')

  await dragTouch(
    page,
    { x: center.x - 42, y: center.y + 12 },
    { x: center.x + 70, y: center.y - 18 },
  )
  await selectCanvasCenter(page)
  const secondLatitude = Number(
    await page.locator('.site-panel').getAttribute('data-latitude-rad'),
  )
  const secondLongitude = Number(
    await page.locator('.site-panel').getAttribute('data-longitude-rad'),
  )
  const coordinateDot =
    Math.sin(firstLatitude) * Math.sin(secondLatitude) +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.cos(secondLongitude - firstLongitude)
  const angularSeparation = Math.acos(Math.max(-1, Math.min(1, coordinateDot)))
  expect(angularSeparation).toBeGreaterThan(0.001)
  expect(errors).toEqual({ console: [], page: [] })
})

test('desktop mouse orbit, wheel zoom, selection, and WebGL sanity', async ({ browser }) => {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  const canvas = page.locator('.scene-canvas canvas')
  const bounds = await canvas.boundingBox()

  if (bounds === null) {
    throw new Error('Shoot the Moon desktop canvas has no layout bounds.')
  }

  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  const browserRenderer = await canvas.evaluate((element) => {
    const context = element.getContext('webgl2')
    return {
      metrics: { ...element.dataset },
      contextLost: context?.isContextLost() ?? null,
      error: context?.getError() ?? null,
      renderer: context?.getParameter(context.RENDERER) ?? 'unavailable',
      version: context?.getParameter(context.VERSION) ?? 'unavailable',
    }
  })
  console.log('FIRST_OUTPOST_BROWSER_RENDERER ' + JSON.stringify(browserRenderer))
  expect(browserRenderer.contextLost).toBe(false)
  expect(browserRenderer.error).toBe(0)

  const azimuthBefore = Number(await canvas.getAttribute('data-camera-azimuth'))
  await page.mouse.move(x - 80, y)
  await page.mouse.down()
  await page.mouse.move(x + 80, y + 35, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)

  const distanceBefore = Number(await canvas.getAttribute('data-camera-distance'))
  await page.mouse.move(x, y)
  await page.mouse.wheel(0, 360)
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .not.toBeCloseTo(distanceBefore, 2)
  await page.mouse.click(x, y)
  await expect(page.locator('.site-panel')).toBeVisible()
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/05-desktop-selected.png',
  })
  expect(errors).toEqual({ console: [], page: [] })
  await context.close()
})
