import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { createStrikeReadySave } from './firstStrikeFixtures.ts'

const evidence = process.env.MINING_REPAIR_EVIDENCE ?? 'artifacts/screenshots/wave-defense-feedback'
async function open(page: Page, save?: string) {
  await page.clock.install()
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (save && !sessionStorage.getItem('repair-seeded')) {
      localStorage.setItem(key, save)
      sessionStorage.setItem('repair-seeded', 'true')
    }
  }, { key: OUTPOST_STORAGE_KEY, save })
  await page.goto('/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: /^(CONTINUE|BEGIN INVASION)$/ }).tap()
}
const step = async (page: Page, ms: number) => { await page.clock.fastForward(ms); await page.clock.runFor(32) }
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true })
  await page.screenshot({ path: `${evidence}/${name}.png` })
  return page.locator('canvas').evaluate(el => ({ calls: Number(el.dataset.drawCalls), triangles: Number(el.dataset.triangles),
    programs: Number(el.dataset.programs), textures: Number(el.dataset.textures),
    position: [el.dataset.cameraX, el.dataset.cameraY, el.dataset.cameraZ].map(Number),
    target: [el.dataset.cameraTargetX, el.dataset.cameraTargetY, el.dataset.cameraTargetZ].map(Number),
    fov: Number(el.dataset.cameraFov), radius: Number(el.dataset.cameraRadius),
    defense: JSON.parse(el.dataset.defenseFraming!), lander: JSON.parse(el.dataset.landerFraming!),
  }))
}
test('platform construction uses active defense in all three waves without changing outcomes', async ({ page }) => {
  test.setTimeout(150000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 230
  await open(page, JSON.stringify(raw))
  await page.getByRole('button', { name: /BUILD ORBITAL PLATFORM/ }).tap()
  const main = page.locator('main'), canvas = page.locator('canvas')
  const building = await saved(page)
  expect(building.outpost.lunarOre).toBe(170)
  await step(page, 6200)
  await page.getByRole('button', { name: /PRIORITIZE DEFENSE/ }).tap()
  await page.clock.runFor(1300)
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-focus-platform')
  const metrics: Record<string, unknown> = {}
  for (let wave = 0; wave < 3; wave++) {
    const elapsed = (await saved(page)).outpost.orbitalSiege.elapsedMs
    await step(page, [14400, 22400, 30400][wave]! + 700 - elapsed)
    await expect(main).toHaveAttribute('data-platform-defense', 'true')
    await expect(page.getByRole('region', { name: 'Orbital Platform defense' })).toBeVisible()
    await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'targeting')
    const frame = await capture(page, `platform-wave-${wave + 1}-targeting`)
    const panel = (await page.locator('.platform-defense-panel').boundingBox())!
    for (const point of Object.values(frame.defense) as number[][]) {
      expect(Math.abs(point[0]!)).toBeLessThan(.9)
      expect(point[1]).toBeLessThan(.92)
      expect((1 - point[1]!) * 422).toBeLessThan(panel.y - 8)
    }
    const action = page.getByRole('button', { name: 'FIRE DEFENSE', exact: false })
    const box = (await action.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(64)
    if (wave !== 1) {
      const before = (await saved(page)).outpost.orbitalSiege
      await page.touchscreen.tap(box.x + box.width - 8, box.y + box.height / 2)
      expect((await saved(page)).outpost.orbitalSiege).toEqual(before)
      await page.clock.runFor(96)
      await expect(canvas).toHaveAttribute('data-defense-burst-visible', 'true')
      await expect(canvas).toHaveAttribute('data-defense-beam-visible', 'true')
      const impact = await capture(page, `platform-wave-${wave + 1}-impact`)
      expect(impact.calls).toBeLessThanOrEqual(80)
      expect(impact.programs).toBeLessThanOrEqual(24)
      metrics[`wave-${wave + 1}`] = impact
      await step(page, 330)
      await capture(page, `platform-wave-${wave + 1}-debris`)
    } else {
      await step(page, 2050)
      await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'miss')
      await capture(page, 'platform-wave-2-miss')
    }
    await step(page, [18000, 26000, 34000][wave]! - (await saved(page)).outpost.orbitalSiege.elapsedMs + 50)
    await expect(main).toHaveAttribute('data-siege-waves', String(wave + 1))
    await expect(main).toHaveAttribute('data-siege-health', String(100 - (wave + 1) * 5))
    await expect(main).toHaveAttribute('data-siege-damage', '0')
  }
  await expect(main).toHaveAttribute('data-siege-status', 'operational')
  expect((await saved(page)).outpost.orbitalSiege).toMatchObject({ platformHealth: 85, outpostDamage: 0, oreLost: 0, energyLoss: 0, attempts: 1 })
  await writeFile(`${evidence}/platform-repair-metrics.json`, JSON.stringify(metrics, null, 2) + '\n')
  expect(errors).toEqual([])
})

test('platform defense remains visible and tappable on a small portrait phone', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 320, height: 568 })
  const raw = JSON.parse(createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 230
  await open(page, JSON.stringify(raw))
  await page.getByRole('button', { name: /BUILD ORBITAL PLATFORM/ }).tap()
  await step(page, 6200)
  await page.getByRole('button', { name: /PRIORITIZE DEFENSE/ }).tap()
  await page.clock.runFor(1300)
  for (let wave = 0; wave < 3; wave++) {
    await step(page, [15100, 23100, 31100][wave]! - (await saved(page)).outpost.orbitalSiege.elapsedMs)
    const frame = await capture(page, `platform-small-wave-${wave + 1}-targeting`)
    const panel = (await page.locator('.platform-defense-panel').boundingBox())!
    const header = (await page.locator('.hud-header').boundingBox())!
    await expect(page.getByRole('region', { name: 'Outpost status' })).toBeHidden()
    for (const point of Object.values(frame.defense) as number[][]) {
      expect(Math.abs(point[0]!)).toBeLessThan(.95)
      expect((1 - point[1]!) * 284).toBeGreaterThan(header.y + header.height + 15)
      expect((1 - point[1]!) * 284).toBeLessThan(panel.y - 8)
    }
    const action = page.getByRole('button', { name: 'FIRE DEFENSE', exact: false })
    const box = (await action.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(64)
    expect(box.y + box.height).toBeLessThan(568)
    await page.touchscreen.tap(box.x + 8, box.y + box.height / 2)
    await page.clock.runFor(96)
    await expect(page.locator('canvas')).toHaveAttribute('data-defense-burst-visible', 'true')
    await capture(page, `platform-small-wave-${wave + 1}-impact`)
    if (wave < 2) {
      await step(page, [18100, 26100][wave]! - (await saved(page)).outpost.orbitalSiege.elapsedMs)
      await expect(page.getByRole('region', { name: 'Outpost status' })).toBeVisible()
    }
  }
  await step(page, 34100 - (await saved(page)).outpost.orbitalSiege.elapsedMs)
  await expect(page.locator('main')).toHaveAttribute('data-platform-defense', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('nuke confirmation uses final wording and keeps cancel and launch behavior', async ({ page }) => {
  await open(page, createStrikeReadySave())
  if (await page.locator('main').getAttribute('data-phase') === 'landed') {
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await step(page, 2600)
  }
  await page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }).tap()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('p')).toHaveText('Launching the warhead begins the strike on Null Meridian.')
  await expect(page.locator('.strike-ready p')).toHaveText('Launching the warhead begins the strike on Null Meridian.')
  await expect(dialog).not.toContainText(/prototype|placeholder|version/i)
  await expect(page.locator('.strike-ready')).not.toContainText(/prototype/i)
  await capture(page, 'nuke-confirmation')
  const armed = (await saved(page)).firstStrike
  await dialog.getByRole('button', { name: 'CANCEL', exact: true }).tap()
  await expect(dialog).toHaveCount(0)
  expect((await saved(page)).firstStrike).toEqual(armed)
  await page.getByRole('button', { name: /WARHEAD ARMED/ }).tap()
  await expect(dialog).not.toContainText(/prototype/i)
  await dialog.getByRole('button', { name: 'FIRE', exact: true }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-first-strike-status', 'LAUNCHING')
})

test('landing descends, touches down, holds and settles without camera or gameplay jumps', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await open(page)
  await page.touchscreen.tap(195, 410)
  await page.getByRole('button', { name: 'CLAIM LANDING SITE', exact: true }).tap()
  const main = page.locator('main'), canvas = page.locator('canvas')
  await expect(main).toHaveAttribute('data-phase', 'approach')
  await expect(canvas).toHaveAttribute('data-camera-input-locked', 'true')
  const frames: Record<string, unknown> = {}
  let elapsed = 0
  for (const [name, time] of [['descent', 4400], ['touchdown', 5400], ['hold', 5700], ['hold-end', 6060]] as const) {
    await step(page, time - elapsed)
    elapsed = time + 32
    await expect(main).toHaveAttribute('data-phase', 'approach')
    const frame = await capture(page, `landing-${name}`)
    expect(frame.radius).toBeGreaterThan(1)
    expect(frame.calls).toBeGreaterThan(3)
    expect(frame.lander).not.toBeNull()
    expect(Math.abs(frame.lander[0])).toBeLessThan(.95)
    expect(Math.abs(frame.lander[1])).toBeLessThan(.95)
    frames[name] = frame
  }
  await expect(canvas).toHaveAttribute('data-landing-beat', 'hold')
  const held = frames.hold as Awaited<ReturnType<typeof capture>>
  const last = frames['hold-end'] as typeof held
  expect(last.position).toEqual(held.position)
  expect(last.target).toEqual(held.target)
  await step(page, 400)
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  await expect(canvas).toHaveAttribute('data-camera-input-locked', 'false')
  const settled = await capture(page, 'landing-settled')
  expect(settled.position).toEqual(held.position)
  expect(settled.target).toEqual(held.target)
  expect(settled.fov).toBe(held.fov)
  expect((await saved(page)).outpost).toMatchObject({ lunarOre: 0, robot: { state: 'stored' }, monument: null, orbitalSiege: null })
  await expect(page.getByRole('button', { name: /DEPLOY MINER/ })).toBeEnabled()
  await writeFile(`${evidence}/landing-repair-metrics.json`, JSON.stringify({ ...frames, settled }, null, 2) + '\n')
  expect(errors).toEqual([])
})
