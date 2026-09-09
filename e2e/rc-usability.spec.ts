import { expect, test, type Page } from '@playwright/test'

async function finishCamera(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('moon-core:set-cinematic-progress', { detail: { progress: 1 } })))
}
async function begin(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).tap()
}
async function tapSignal(page: Page, name: string) {
  const point = await page.locator('canvas').evaluate((el, name) => ({
    x: Number(el.getAttribute(`data-${name}-x`)), y: Number(el.getAttribute(`data-${name}-y`)),
  }), name)
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS')
  await page.touchscreen.tap(point.x, point.y)
}

test('portrait first-run guidance, visible marker, mining, build and recovery', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  })
  await page.goto('/?e2e')
  await begin(page)
  const main = page.locator('main')
  const canvas = page.locator('canvas')
  await expect(page.locator('.first-run-objective')).toContainText('Select a site → claim → build → mine')
  await page.touchscreen.tap(195, 422)
  await expect(main).toHaveAttribute('data-phase', 'selected')
  // The orange ring and pale center must render in the central scene area.
  const shot = await page.screenshot()
  const colors = await page.evaluate(async png => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode()
    const c = document.createElement('canvas'); c.width = 80; c.height = 80
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 155, 382, 80, 80, 0, 0, 80, 80)
    const pixels = ctx.getImageData(0, 0, 80, 80).data
    let amber = 0; let pale = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! > 180 && pixels[i + 1]! < 150 && pixels[i + 2]! < 100) amber++
      if (pixels[i]! > 230 && pixels[i + 1]! > 220 && pixels[i + 2]! > 190) pale++
    }
    return { amber, pale }
  }, shot.toString('base64'))
  expect(colors.amber).toBeGreaterThan(15)
  expect(colors.pale).toBeGreaterThan(5)
  const claim = page.getByRole('button', { name: /CLAIM LANDING SITE/ })
  expect((await claim.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await claim.tap()
  await expect(page.locator('.context-prompt')).toHaveCount(0)
  await finishCamera(page)
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(page.locator('.context-prompt')).toContainText('Deploy your miner')
  await page.getByRole('button', { name: /DEPLOY MINER/ }).tap()
  await expect(main).toHaveAttribute('data-robot-state', 'idle')
  await expect(page.locator('.context-prompt')).toContainText('Tap an ore signal')
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.waitForTimeout(1200)
    await tapSignal(page, 'deposit-alpha')
    await expect(page.locator('.deposit-readout')).toContainText('SELECTED · ALPHA')
    await page.getByRole('button', { name: /MINE DEPOSIT/ }).tap()
    await expect(main).toHaveAttribute('data-robot-state', 'mining')
    await expect(page.locator('.robot-status')).toContainText('ALPHA')
    await expect(page.locator('.context-prompt')).toHaveCount(0)
    await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20000 })
  }
  await expect(page.locator('.context-prompt')).toContainText('mines automatically')
  // Hold at activation so capture cannot race the existing 2.2 s rival reveal.
  await page.evaluate(() => {
    const main = document.querySelector('main')!
    const observer = new MutationObserver(() => {
      if (main.getAttribute('data-extractor-status') !== 'active') return
      window.dispatchEvent(new CustomEvent('first-outpost:set-transitions-paused', { detail: { paused: true } }))
      observer.disconnect()
    })
    observer.observe(main, { attributes: true, attributeFilter: ['data-extractor-status'] })
  })
  await page.getByRole('button', { name: /CONSTRUCT EXTRACTOR/ }).tap()
  await expect(main).toHaveAttribute('data-extractor-status', 'active')
  await expect(page.locator('.active-deposit')).toContainText('ALPHA · AUTOMATIC MINING')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'artifacts/screenshots/rc-usability-first-outpost.png' })
  const ore = Number(await main.getAttribute('data-lunar-ore'))
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).tap()
  await finishCamera(page)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await expect(main).toHaveAttribute('data-selected-deposit', 'none')
  await page.reload(); await begin(page)
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  await expect(page.locator('.active-deposit')).toContainText('ALPHA')
  expect(Number(await main.getAttribute('data-lunar-ore'))).toBeGreaterThanOrEqual(ore)
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const button of await page.getByRole('button').all()) {
      if (!await button.isVisible()) continue
      await button.scrollIntoViewIfNeeded()
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      expect(await button.evaluate(el => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      })).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'RESET PROTOTYPE' }).tap()
  await begin(page)
  await expect(main).toHaveAttribute('data-outpost-stage', 'none')
  await expect(page.locator('.operations-panel')).toHaveCount(0)
  await page.touchscreen.tap(195, 422)
  await page.getByRole('button', { name: /CLAIM LANDING SITE/ }).tap()
  await finishCamera(page)
  await expect(main).toHaveAttribute('data-robot-state', 'stored')
  await expect(page.locator('.context-prompt')).toContainText('Deploy your miner')
  expect(errors).toEqual([])
})

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


test('portrait drag and pinch preserve selection and claim touch controls', async ({ page }) => {
  await page.goto('/?e2e'); await begin(page)
  const canvas = page.locator('canvas')
  const main = page.locator('main')
  const azimuth = Number(await canvas.getAttribute('data-camera-azimuth'))
  await dragTouch(page, { x: 150, y: 400 }, { x: 240, y: 425 })
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-azimuth'))).not.toBeCloseTo(azimuth, 2)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  const distance = Number(await canvas.getAttribute('data-camera-distance'))
  await pinchTouch(page, true)
  // Preserve the existing post-pinch accidental-selection guard.
  await page.waitForTimeout(450)
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).not.toBeCloseTo(distance, 2)
  await expect(main).toHaveAttribute('data-phase', 'orbit')
  await page.touchscreen.tap(195, 422)
  await expect(main).toHaveAttribute('data-phase', 'selected')
  await page.getByRole('button', { name: 'CLEAR SITE' }).tap()
  await page.touchscreen.tap(195, 422)
  await page.getByRole('button', { name: /CLAIM LANDING SITE/ }).tap()
  await finishCamera(page)
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(canvas).toHaveAttribute('data-camera-interacting', 'false')
})
async function canvasCenter(page: Page) {
  const bounds = (await page.locator('canvas').boundingBox())!
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}
