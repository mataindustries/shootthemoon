import { expect, test, type Page } from '@playwright/test'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots'

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

async function openReadyScene(page: Page): Promise<void> {
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

test('complete mobile First Outpost loop, persistence, screenshots, and budgets', async ({
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

  const storedMetrics = await readRenderMetrics(page)
  console.log('FIRST_OUTPOST_STORED_SURFACE_METRICS ' + JSON.stringify(storedMetrics))
  expect(storedMetrics.drawCalls).toBeLessThanOrEqual(80)
  expect(storedMetrics.triangles).toBeLessThanOrEqual(200_000)
  expect(storedMetrics.textures).toBeLessThanOrEqual(12)

  await page.getByRole('button', { name: 'DEPLOY MINER' }).click()
  await expect(main).toHaveAttribute('data-robot-state', 'deploying')
  await expect(main).toHaveAttribute('data-robot-state', 'idle', {
    timeout: 5_000,
  })
  await setSimulationPaused(page, true)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/06-capsule-opened-robot-deployed.png',
  })
  await setSimulationPaused(page, false)

  await tapProjectedPoint(
    page,
    'data-deposit-gamma-x',
    'data-deposit-gamma-y',
  )
  await expect(main).toHaveAttribute('data-selected-deposit', 'deposit-gamma')
  await expect(page.locator('.deposit-readout')).toContainText('LUNAR ORE')

  await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  await expect(main).toHaveAttribute('data-robot-state', 'mining', {
    timeout: 6_000,
  })
  await setSimulationPaused(page, true, 850)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/07-robot-mining.png',
  })
  await setSimulationPaused(page, false)
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
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/08-robot-returning-cargo.png',
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
  await setSimulationPaused(page, true, 850)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/09-extractor-construction.png',
  })
  await setSimulationPaused(page, false)
  await expect(main).toHaveAttribute('data-outpost-stage', 'extractor-active', {
    timeout: 5_000,
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/10-extractor-active.png',
  })

  const activeMetrics = await readRenderMetrics(page)
  console.log('FIRST_OUTPOST_ACTIVE_SURFACE_METRICS ' + JSON.stringify(activeMetrics))
  expect(activeMetrics.drawCalls).toBeLessThanOrEqual(80)
  expect(activeMetrics.triangles).toBeLessThanOrEqual(200_000)
  expect(activeMetrics.bufferWidth * activeMetrics.bufferHeight).toBeLessThanOrEqual(
    1_010_000,
  )

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 5_000 })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/11-orbital-outpost-signature.png',
  })

  await tapProjectedPoint(
    page,
    'data-outpost-signal-x',
    'data-outpost-signal-y',
  )
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  await expect(main).toHaveAttribute('data-phase', 'approach')
  await setCinematicProgress(page, 1)
  await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 5_000 })

  const oreBeforeRefresh = Number(await main.getAttribute('data-lunar-ore'))
  await page.reload()
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(main).toHaveAttribute('data-outpost-stage', 'extractor-active')
  await expect(main).toHaveAttribute('data-robot-state', 'idle')
  expect(Number(await main.getAttribute('data-lunar-ore'))).toBeGreaterThanOrEqual(
    oreBeforeRefresh,
  )
  await page.waitForTimeout(250)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/12-restored-outpost.png',
  })
  expect(
    await page.evaluate(
      () => localStorage.getItem('shoot-the-moon:first-outpost:v1') !== null,
    ),
  ).toBe(true)
  expect(errors).toEqual({ console: [], page: [] })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).click()
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await expect(main).toHaveAttribute('data-outpost-stage', 'none')
  expect(
    await page.evaluate(
      () => localStorage.getItem('shoot-the-moon:first-outpost:v1'),
    ),
  ).toBeNull()
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
  expect(secondLatitude).not.toBeCloseTo(firstLatitude, 2)
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
