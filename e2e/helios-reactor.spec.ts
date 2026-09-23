import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'
import { MONUMENTS } from '../src/domain/territoryMonument.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { HELIOS_LOOP_LIMIT_MS, HELIOS_LOOP_MS, HELIOS_REVEAL_LEAD_MS } from '../src/scene/heliosReactorModel.ts'

const stage = process.env.HELIOS_EVIDENCE ?? 'after'
// Evidence is review output, not source: keep it in the git-ignored results tree.
const directory = `test-results/helios-reactor/${stage}`
test.use({ trace: 'off', actionTimeout: 30_000, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } })

function heliosSave(revealSeen: boolean) {
  const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS'))
  raw.outpost.monument = {
    kind: 'HELIOS_SPIRE', anchor: 'outpost', status: 'complete', phaseElapsedMs: 0,
    workMs: MONUMENTS.HELIOS_SPIRE.laborMs, repairWorkMs: 0, health: 100, wavesResolved: 3,
    orders: ['DEFEND', 'DEFEND', 'DEFEND'], productionPenalty: 0, energyLoss: 0, oreLost: 0,
    completedAtMs: Date.now() - 1000, revealSeen,
  }
  return JSON.stringify(raw)
}

async function openMonument(page: Page, save: string, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(({ key, save }) => {
    if (!sessionStorage.getItem('helios-seeded')) {
      localStorage.setItem(key, save)
      sessionStorage.setItem('helios-seeded', 'true')
    }
  }, { key: OUTPOST_STORAGE_KEY, save })
  await page.clock.install()
  await page.goto('/')
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  // Freeze time before entering so the reveal start is an exact, readable clock value.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await expect(main).toHaveAttribute('data-monument-view', 'true')
  return page.evaluate(() => performance.now())
}

async function metrics(page: Page) {
  return page.locator('canvas').evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext('webgl2')!
    const d = element.dataset
    return {
      calls: Number(d.drawCalls), triangles: Number(d.triangles), programs: Number(d.programs),
      geometries: Number(d.geometries), textures: Number(d.textures), frames: Number(d.frameCount),
      contextLost: gl.isContextLost(), error: gl.getError(),
    }
  })
}

/** Land exactly on a clock time, rendering the final few frames up to it. */
async function seek(page: Page, atMs: number) {
  const now = await page.evaluate(() => performance.now())
  if (atMs - now > 96) await page.clock.fastForward(Math.floor(atMs - now - 64))
  const left = atMs - await page.evaluate(() => performance.now())
  if (left > 0) await page.clock.runFor(Math.ceil(left))
}

async function capture(page: Page, prefix: string, name: string, record: Record<string, unknown>) {
  await page.screenshot({ path: `${directory}/${prefix}-${name}.png` })
  const frame = await metrics(page)
  expect(frame.contextLost).toBe(false)
  expect(frame.error).toBe(0)
  expect(frame.calls).toBeGreaterThan(0)
  expect(frame.textures).toBeLessThanOrEqual(6)
  expect(frame.programs).toBeLessThanOrEqual(24)
  record[name] = frame
  console.log(`${prefix}-${name}: ${frame.calls} calls / ${frame.triangles} triangles / ${frame.programs} programs`)
  return frame
}

async function framesOver(page: Page, ms: number) {
  const start = (await metrics(page)).frames
  await page.clock.runFor(ms)
  return (await metrics(page)).frames - start
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`Helios reactor reveal, launch loop, held cap and orbit ${viewport.width}`, async ({ page }) => {
    test.setTimeout(300_000)
    await mkdir(directory, { recursive: true })
    await page.setViewportSize(viewport)
    const prefix = `${viewport.width}x${viewport.height}`
    const record: Record<string, unknown> = {}
    const errors: string[] = []
    const reveal = await openMonument(page, heliosSave(false), errors)
    await expect(page.locator('main')).toHaveAttribute('data-monument-reveal', 'true')
    // Reveal origin leads the reveal clock; loop two starts one loop later.
    const origin = reveal - HELIOS_REVEAL_LEAD_MS
    const loop = (t: number) => origin + HELIOS_LOOP_MS + t

    await seek(page, reveal + 300)
    // The title gate fades on a CSS transition; let it clear without advancing the scene clock.
    await page.waitForTimeout(700)
    await capture(page, prefix, '01-reveal-start', record)
    await seek(page, reveal + 2900)
    await capture(page, prefix, '02-reveal-indexing', record)
    await seek(page, reveal + 4250)
    await capture(page, prefix, '03-reveal-launch', record)
    await seek(page, loop(2000))
    await expect(page.locator('main')).toHaveAttribute('data-monument-reveal', 'false')
    const idle = await capture(page, prefix, '04-idle', record)
    record.heldLoopFramesPerSecond = await framesOver(page, 1000)
    await seek(page, loop(5000))
    await capture(page, prefix, '05-charging', record)
    await seek(page, loop(6000))
    await capture(page, prefix, '06-capacitors', record)
    await seek(page, loop(6700))
    await capture(page, prefix, '07-indexing', record)
    await seek(page, loop(7640))
    await capture(page, prefix, '08-midway', record)
    await seek(page, loop(7930))
    const launch = await capture(page, prefix, '09-launch', record)
    await seek(page, loop(8500))
    await capture(page, prefix, '10-exiting', record)
    await seek(page, loop(10000))
    await capture(page, prefix, '11-cooldown', record)
    await seek(page, origin + HELIOS_LOOP_LIMIT_MS + 1500)
    await capture(page, prefix, '12-held', record)
    record.heldCappedFramesPer2s = await framesOver(page, 2000)
    const hideHud = await page.addStyleTag({ content: '.monument-panel { visibility: hidden !important }' })
    await page.clock.runFor(32)
    await page.screenshot({ path: `${directory}/${prefix}-12-held-assets.png` })
    await hideHud.evaluate(element => (element as Element).remove())
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.clock.fastForward(2800)
    await page.clock.runFor(64)
    await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit')
    await capture(page, prefix, '13-orbit', record)
    record.orbitFramesPer2s = await framesOver(page, 2000)
    await writeFile(`${directory}/${prefix}-metrics.json`, JSON.stringify({ ...record, errors }, null, 2) + '\n')

    expect(errors).toEqual([])
    if (stage === 'before') return
    // The launch effects reuse programs compiled at mount: no new shader at the payoff.
    expect(launch.programs).toBe(idle.programs)
    expect(record.heldLoopFramesPerSecond).toBeGreaterThanOrEqual(30)
    // After three loops only the held view's pre-existing heartbeats remain (11 frames / 2 s without Helios).
    expect(record.heldCappedFramesPer2s).toBeLessThanOrEqual(12)
    expect(record.orbitFramesPer2s).toBeLessThanOrEqual(8)
  })
}

test('Helios reactor holds a static idle pose under reduced motion', async ({ page }) => {
  test.setTimeout(120_000)
  await mkdir(directory, { recursive: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  const now = await openMonument(page, heliosSave(true), errors)
  await expect(page.locator('main')).toHaveAttribute('data-monument-reveal', 'false')
  await seek(page, now + 500)
  const frames = await framesOver(page, 2000)
  await seek(page, now + 7900)
  await page.screenshot({ path: `${directory}/390x844-14-reduced-motion.png` })
  await writeFile(`${directory}/390x844-reduced-motion.json`, JSON.stringify({ frames, errors }, null, 2) + '\n')
  expect(errors).toEqual([])
  if (stage !== 'before') expect(frames).toBeLessThanOrEqual(12)
})
