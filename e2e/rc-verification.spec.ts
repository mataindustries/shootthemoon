import { expect, test, type Page } from '@playwright/test'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import {
  createCompletedStrikeSave,
  createStrikeReadySave,
} from './firstStrikeFixtures.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots'

interface BrowserErrors {
  readonly console: string[]
  readonly page: string[]
}

const SCAR_CAMERA_MINIMUM_CLEARANCE = 0.018

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

async function openScene(page: Page, initialSave: string): Promise<void> {
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
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    },
    { key: OUTPOST_STORAGE_KEY, value: initialSave },
  )
  await page.goto('/?e2e')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.scene-canvas canvas')).toHaveAttribute(
    'data-draw-calls',
    /\d+/,
  )
  await dismissLaunchGate(page)
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('.scene-canvas canvas').boundingBox()

  if (bounds === null) throw new Error('Canvas has no browser layout bounds.')

  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function pointerDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

async function dragTouch(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  pointerId = 41,
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
      id: 51,
      x: center.x - gap,
      y: center.y,
      radiusX: 5,
      radiusY: 5,
      force: 0.5,
    },
    {
      id: 52,
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

async function readCanvasNumber(page: Page, name: string): Promise<number> {
  return Number(
    await page.locator('.scene-canvas canvas').getAttribute(`data-${name}`),
  )
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

  const returnButton = page.getByRole('button', { name: 'RETURN TO ORBIT' })
  await expect(returnButton).toBeVisible()
  const bounds = await returnButton.boundingBox()

  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(layout.viewportWidth)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    layout.viewportHeight,
  )
}

function createInterruptedLaunchingSave(nowMs = Date.now()): string {
  const envelope = JSON.parse(createStrikeReadySave(nowMs)) as {
    savedAtMs: number
    firstStrike: Record<string, unknown>
  }
  const updatedAtMs = envelope.savedAtMs

  Object.assign(envelope.firstStrike, {
    status: 'LAUNCHING',
    updatedAtMs,
    armedAtMs: updatedAtMs - 300,
    launchConfirmedAtMs: updatedAtMs - 200,
    launchCompleted: true,
    launchCompletedAtMs: updatedAtMs - 100,
    finalVesperTransmissionCompleted: false,
    finalVesperTransmissionCompletedAtMs: null,
    impactCompleted: false,
    impactCompletedAtMs: null,
    rivalFootholdDamaged: false,
    permanentScarCreated: false,
    scar: null,
    endingCompleted: false,
    endingCompletedAtMs: null,
  })

  return JSON.stringify(envelope)
}

test('fresh production entry presents the release-candidate title treatment', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await page.goto('/?e2e')
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(main).toHaveAttribute('data-entry-open', 'true')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(canvas).toHaveAttribute('data-frame-count', /\d+/)
  await expect(page.getByRole('heading', { name: 'SHOOT THE MOON' })).toBeVisible()
  await expect(page.getByText('FIRST STRIKE', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'BEGIN INVASION' }),
  ).toBeVisible()

  await page.waitForTimeout(600)
  const heldFrame = await readCanvasNumber(page, 'frame-count')
  await page.waitForTimeout(900)
  expect(
    (await readCanvasNumber(page, 'frame-count')) - heldFrame,
  ).toBeLessThanOrEqual(1)

  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/00-opening-title.png`,
  })

  await dismissLaunchGate(page)
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  expect(errors).toEqual({ console: [], page: [] })
})

async function expectNoTemporaryStrikeEffects(page: Page): Promise<void> {
  const canvas = page.locator('.scene-canvas canvas')

  await expect(canvas).not.toHaveAttribute('data-impact-effect-phase', /.+/)
  await expect(canvas).not.toHaveAttribute('data-strike-route-progress', /.+/)
  await expect(canvas).not.toHaveAttribute('data-warhead-radius', /.+/)
  await expect(page.locator('[data-impact-effect-phase]')).toHaveCount(0)
  await expect(page.locator('[data-strike-route-progress]')).toHaveCount(0)
}

test('restores a deliberately lost WebGL context without application errors', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')
  const frameBefore = await readCanvasNumber(page, 'frame-count')

  const supported = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement
    return Boolean(
      canvasElement
        .getContext('webgl2')
        ?.getExtension('WEBGL_lose_context'),
    )
  })
  test.skip(!supported, 'WEBGL_lose_context is unavailable in this browser.')

  const cycle = await canvas.evaluate(async (element) => {
    const canvasElement = element as HTMLCanvasElement
    const context = canvasElement.getContext('webgl2')
    const extension = context?.getExtension('WEBGL_lose_context')

    if (context === null || extension === null) {
      return { lost: false, restored: false }
    }

    return new Promise<{ lost: boolean; restored: boolean }>(
      (resolve, reject) => {
        let lost = false
        const timeout = window.setTimeout(
          () => reject(new Error('Timed out restoring the WebGL context.')),
          8_000,
        )

        canvasElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault()
            lost = true
            window.setTimeout(() => extension.restoreContext(), 50)
          },
          { once: true },
        )
        canvasElement.addEventListener(
          'webglcontextrestored',
          () => {
            window.clearTimeout(timeout)
            resolve({ lost, restored: true })
          },
          { once: true },
        )

        extension.loseContext()
      },
    )
  })

  expect(cycle).toEqual({ lost: true, restored: true })
  const queuedRecoveryErrors = await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2')
    const errors: number[] = []

    if (context === null) return errors

    for (let index = 0; index < 8; index += 1) {
      const error = context.getError()

      if (error === context.NO_ERROR) break
      errors.push(error)
    }

    return errors
  })
  console.log(
    'WEBGL_CONTEXT_RECOVERY_QUEUED_ERRORS ' +
      JSON.stringify(queuedRecoveryErrors),
  )
  expect(
    queuedRecoveryErrors.every(
      (error) => error === 1282 || error === 37442,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 391, height: 844 })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl2')
  await expect(canvas).toHaveCount(1)
  await expect
    .poll(() => readCanvasNumber(page, 'frame-count'))
    .toBeGreaterThan(frameBefore)

  const finalWebGlState = await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2')
    return {
      available: context !== null,
      contextLost: context?.isContextLost() ?? true,
      error: context?.getError() ?? null,
    }
  })
  expect(finalWebGlState).toEqual({
    available: true,
    contextLost: false,
    error: 0,
  })
  expect(errors).toEqual({ console: [], page: [] })
})

test('completed scar exploration keeps drag and pinch camera-safe and returns idle', async ({
  browserName,
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await page.screenshot({
    path: 'artifacts/screenshots/first-strike/11-restored-completed-state.png',
  })

  await page.getByRole('button', { name: 'EXPLORE SCAR' }).click()
  await expect(main).toHaveAttribute(
    'data-first-strike-presentation',
    'scar-explore',
  )
  await expect(canvas).toHaveAttribute('data-camera-mode', 'strike-scar-explore')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await page.screenshot({
    path: 'artifacts/screenshots/first-strike/13-scar-explore.png',
  })
  await expectViewportSafe(page)

  const center = await canvasCenter(page)
  const pointerAzimuthBefore = await readCanvasNumber(page, 'camera-azimuth')
  await pointerDrag(
    page,
    { x: center.x - 48, y: center.y - 10 },
    { x: center.x + 54, y: center.y + 28 },
  )
  await expect
    .poll(() => readCanvasNumber(page, 'camera-azimuth'))
    .not.toBeCloseTo(pointerAzimuthBefore, 2)

  if (browserName === 'chromium') {
    const touchAzimuthBefore = await readCanvasNumber(page, 'camera-azimuth')
    await dragTouch(
      page,
      { x: center.x + 44, y: center.y - 18 },
      { x: center.x - 52, y: center.y + 24 },
    )
    await expect
      .poll(() => readCanvasNumber(page, 'camera-azimuth'))
      .not.toBeCloseTo(touchAzimuthBefore, 2)

    const distanceBefore = await readCanvasNumber(page, 'camera-distance')
    await pinchTouch(page, true)
    await expect
      .poll(() => readCanvasNumber(page, 'camera-distance'))
      .not.toBeCloseTo(distanceBefore, 2)
  } else {
    test.info().annotations.push({
      type: 'touch-coverage',
      description: 'CDP multi-touch is only available in Chromium.',
    })
  }

  await expect
    .poll(() => readCanvasNumber(page, 'camera-clearance'))
    .toBeGreaterThanOrEqual(SCAR_CAMERA_MINIMUM_CLEARANCE)
  await expect(canvas).toHaveAttribute('data-camera-interacting', 'false')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await page.waitForTimeout(750)
  const settledFrame = await readCanvasNumber(page, 'frame-count')
  await page.waitForTimeout(900)
  expect(
    (await readCanvasNumber(page, 'frame-count')) - settledFrame,
  ).toBeLessThanOrEqual(1)
  await expect(main).toHaveAttribute('data-render-mode', 'demand')

  await page.setViewportSize({ width: 844, height: 390 })
  await expect(main).toHaveAttribute(
    'data-first-strike-presentation',
    'scar-explore',
  )
  await expectViewportSafe(page)

  const landscapeCenter = await canvasCenter(page)
  const landscapeAzimuthBefore = await readCanvasNumber(page, 'camera-azimuth')
  await pointerDrag(
    page,
    { x: landscapeCenter.x - 64, y: landscapeCenter.y - 8 },
    { x: landscapeCenter.x + 66, y: landscapeCenter.y + 18 },
  )
  await expect
    .poll(() => readCanvasNumber(page, 'camera-azimuth'))
    .not.toBeCloseTo(landscapeAzimuthBefore, 2)
  await expect
    .poll(() => readCanvasNumber(page, 'camera-clearance'))
    .toBeGreaterThanOrEqual(SCAR_CAMERA_MINIMUM_CLEARANCE)

  await page.setViewportSize({ width: 390, height: 844 })
  await expectViewportSafe(page)
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  expect(errors).toEqual({ console: [], page: [] })
})

test('reset invalidates an active replay timer and cannot resurrect strike phases', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createCompletedStrikeSave())
  const main = page.locator('main')

  await page.getByRole('button', { name: 'REPLAY STRIKE' }).click()
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'arming')
  await expect(main).toHaveAttribute('data-first-strike-replay', 'true')
  await expect(main).toHaveAttribute('data-render-mode', 'continuous')

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('first-strike:set-presentation', {
        detail: { phase: 'impact-flash', progress: null, replay: true },
      }),
    ),
  )
  await expect(main).toHaveAttribute(
    'data-first-strike-presentation',
    'impact-flash',
  )
  await expect(page.locator('[data-impact-effect-phase]')).toHaveCount(1)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).click()
  await expect(main).toHaveAttribute('data-entry-open', 'true')
  await expect(main).toHaveAttribute('data-first-strike-status', 'none')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-first-strike-replay', 'false')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expectNoTemporaryStrikeEffects(page)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY),
  ).toBeNull()

  // The interrupted impact timer is 1.3 s. Waiting past that boundary proves
  // its stale callback cannot advance the freshly reset presentation.
  await page.waitForTimeout(1_600)
  await expect(main).toHaveAttribute('data-entry-open', 'true')
  await expect(main).toHaveAttribute('data-first-strike-status', 'none')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expectNoTemporaryStrikeEffects(page)

  await dismissLaunchGate(page)
  await page.waitForTimeout(250)
  await expect(main).toHaveAttribute('data-first-strike-status', 'none')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  expect(errors).toEqual({ console: [], page: [] })
})

test('refresh normalizes an interrupted launch to one safe armed state', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = watchBrowserErrors(page)
  await openScene(page, createInterruptedLaunchingSave())
  const main = page.locator('main')
  const canvas = page.locator('.scene-canvas canvas')

  await expect(main).toHaveAttribute('data-first-strike-status', 'ARMED')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-first-strike-replay', 'false')
  await expect(main).toHaveAttribute('data-launch-complete', 'false')
  await expect(main).toHaveAttribute('data-impact-complete', 'false')
  await expect(main).toHaveAttribute('data-scar-created', 'false')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expectNoTemporaryStrikeEffects(page)

  await expect
    .poll(async () => {
      const saved = await page.evaluate(
        (key) => localStorage.getItem(key),
        OUTPOST_STORAGE_KEY,
      )
      return JSON.parse(saved ?? '{}').firstStrike?.status
    })
    .toBe('ARMED')

  await page.reload()
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(canvas).toHaveAttribute('data-draw-calls', /\d+/)
  await dismissLaunchGate(page)
  await expect(main).toHaveAttribute('data-first-strike-status', 'ARMED')
  await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  await expect(main).toHaveAttribute('data-launch-complete', 'false')
  await expect(main).toHaveAttribute('data-impact-complete', 'false')
  await expect(main).toHaveAttribute('data-scar-created', 'false')
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(canvas).toHaveCount(1)
  await expectNoTemporaryStrikeEffects(page)
  expect(errors).toEqual({ console: [], page: [] })
})
