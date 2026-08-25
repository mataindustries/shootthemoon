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
    throw new Error('Moon Core canvas has no browser layout bounds.')
  }

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
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

test('mobile touch flow, landing cinematic, screenshots, and render budgets', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  await expect(page.locator('main')).toHaveAttribute('data-quality', 'medium')
  const canvas = page.locator('.scene-canvas canvas')
  const center = await canvasCenter(page)

  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/01-initial-orbit-mobile.png',
  })
  const orbitalMetrics = await readRenderMetrics(page)
  console.log('MOON_CORE_MOBILE_ORBIT_METRICS ' + JSON.stringify(orbitalMetrics))
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

  const distanceBefore = Number(
    await canvas.getAttribute('data-camera-distance'),
  )
  await pinchTouch(page, true)
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .not.toBeCloseTo(distanceBefore, 2)
  const distanceAfter = Number(
    await canvas.getAttribute('data-camera-distance'),
  )
  expect(distanceAfter).toBeGreaterThanOrEqual(2.11)
  expect(distanceAfter).toBeLessThanOrEqual(5.21)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.waitForTimeout(450)
  await selectCanvasCenter(page)
  const panel = page.locator('.site-panel')
  const latitude = Number(await panel.getAttribute('data-latitude-rad'))
  const longitude = Number(await panel.getAttribute('data-longitude-rad'))
  expect(Number.isFinite(latitude)).toBe(true)
  expect(Number.isFinite(longitude)).toBe(true)
  expect(Math.abs(latitude)).toBeLessThanOrEqual(Math.PI / 2)
  expect(Math.abs(longitude)).toBeLessThanOrEqual(Math.PI)

  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/02-selected-site-mobile.png',
  })

  await dragTouch(
    page,
    { x: center.x - 30, y: center.y + 20 },
    { x: center.x + 80, y: center.y + 260 },
    7,
  )
  expect(Number(await panel.getAttribute('data-latitude-rad'))).toBe(latitude)
  expect(Number(await panel.getAttribute('data-longitude-rad'))).toBe(longitude)

  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'approach')
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: 0.9 },
      }),
    )
  })
  await page.waitForTimeout(350)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/03-capsule-impact-mobile.png',
  })

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: 1 },
      }),
    )
  })

  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed', {
    timeout: 6_000,
  })
  await page.waitForTimeout(250)
  await page.screenshot({
    path: SCREENSHOT_DIRECTORY + '/04-close-surface-mobile.png',
  })

  const landingMetrics = await readRenderMetrics(page)
  console.log('MOON_CORE_MOBILE_LANDING_METRICS ' + JSON.stringify(landingMetrics))
  expect(landingMetrics.drawCalls).toBeLessThanOrEqual(50)
  expect(landingMetrics.triangles).toBeLessThanOrEqual(180_000)
  expect(landingMetrics.textures).toBeLessThanOrEqual(6)
  expect(landingMetrics.bufferWidth * landingMetrics.bufferHeight).toBeLessThanOrEqual(
    1_010_000,
  )
  const settledFrameCount = Number(
    await canvas.getAttribute('data-frame-count'),
  )
  await page.waitForTimeout(450)
  expect(Number(await canvas.getAttribute('data-frame-count'))).toBe(
    settledFrameCount,
  )

  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).click()
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: 1 },
      }),
    )
  })
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit', {
    timeout: 5_000,
  })
  await expect(page.locator('.site-panel')).toHaveCount(0)

  const returnedAzimuth = Number(
    await canvas.getAttribute('data-camera-azimuth'),
  )
  await dragTouch(
    page,
    { x: center.x - 44, y: center.y + 12 },
    { x: center.x + 62, y: center.y - 24 },
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(returnedAzimuth, 2)

  await selectCanvasCenter(page)
  const secondLatitude = Number(
    await panel.getAttribute('data-latitude-rad'),
  )
  const secondLongitude = Number(
    await panel.getAttribute('data-longitude-rad'),
  )
  expect(
    Math.hypot(secondLatitude - latitude, secondLongitude - longitude),
  ).toBeGreaterThan(0.05)

  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'approach')
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('moon-core:set-cinematic-progress', {
        detail: { progress: 1 },
      }),
    )
  })
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed', {
    timeout: 6_000,
  })
  expect(errors).toEqual({ console: [], page: [] })
})

test('surface selection remains valid at a limb, poles, and the longitude seam', async ({
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
      window.dispatchEvent(
        new CustomEvent('moon-core:set-orbit-view', { detail }),
      )
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
  const limbLatitude = Number(
    await limbPanel.getAttribute('data-latitude-rad'),
  )
  const limbLongitude = Number(
    await limbPanel.getAttribute('data-longitude-rad'),
  )
  expect(Number.isFinite(limbLatitude)).toBe(true)
  expect(Number.isFinite(limbLongitude)).toBe(true)
  expect(errors).toEqual({ console: [], page: [] })
})

test('clear site restores orbit controls and touch selection immediately', async ({
  page,
}) => {
  const errors = watchBrowserErrors(page)
  await openReadyScene(page)
  const canvas = page.locator('.scene-canvas canvas')
  const center = await canvasCenter(page)

  await selectCanvasCenter(page)
  await page.getByRole('button', { name: 'CLEAR SITE' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit')
  await expect(page.locator('.site-panel')).toHaveCount(0)

  const azimuthBefore = Number(
    await canvas.getAttribute('data-camera-azimuth'),
  )
  await dragTouch(
    page,
    { x: center.x - 50, y: center.y + 8 },
    { x: center.x + 58, y: center.y - 20 },
  )
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)

  await selectCanvasCenter(page)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'selected')
  expect(errors).toEqual({ console: [], page: [] })
})

test('desktop mouse orbit, wheel zoom, and selection sanity', async ({ browser }) => {
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
    throw new Error('Moon Core desktop canvas has no browser layout bounds.')
  }

  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  console.log(
    'MOON_CORE_BROWSER_RENDERER ' +
      JSON.stringify(
        await canvas.evaluate((element) => {
          const context = element.getContext('webgl2')

          return {
            metrics: { ...element.dataset },
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            width: element.width,
            height: element.height,
            contextLost: context?.isContextLost() ?? null,
            error: context?.getError() ?? null,
            renderer:
              context?.getParameter(context.RENDERER) ?? 'unavailable',
            version: context?.getParameter(context.VERSION) ?? 'unavailable',
          }
        }),
      ),
  )
  const azimuthBefore = Number(await canvas.getAttribute('data-camera-azimuth'))
  await page.mouse.move(x - 80, y)
  await page.mouse.down()
  await page.mouse.move(x + 80, y + 35, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
    .not.toBeCloseTo(azimuthBefore, 2)

  const distanceBefore = Number(
    await canvas.getAttribute('data-camera-distance'),
  )
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
