import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { capsuleServiceBay, WORKER_RADIUS_M } from '../src/scene/miningPresentation.ts'

const evidence = process.env.MINING_REPAIR_EVIDENCE ?? 'artifacts/screenshots/mining-repair/after'
async function open(page: Page, save: string, harness = false) {
  await page.clock.install()
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (!sessionStorage.getItem('mining-repair-seeded')) {
      localStorage.setItem(key, save); sessionStorage.setItem('mining-repair-seeded', 'true')
    }
  }, { key: OUTPOST_STORAGE_KEY, save })
  await page.goto(harness ? '/?e2e' : '/')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true', { timeout: 30000 })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
}
const step = async (page: Page, ms: number) => { await page.clock.fastForward(ms); await page.clock.runFor(32) }
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true })
  await page.screenshot({ path: `${evidence}/${name}.png` })
  if (name.includes('docking') || name === 'normal-working') {
    const style = await page.addStyleTag({ content: '.hud,.operations-panel,.outpost-panel,.monument-entry {visibility:hidden!important}' })
    await page.screenshot({ path: `${evidence}/${name}-assets.png` })
    await style.evaluate(element => element.remove())
  }
}

test('both construction paths share the active tracking turret, laser and single wave resolution', async ({ browser }) => {
  test.setTimeout(180000)
  for (const kind of ['platform', 'monument'] as const) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      const raw = JSON.parse(kind === 'platform' ? createLegacyActiveExtractorSave() : createAcceptedCounterstrikeSave('SUCCESS'))
      raw.outpost.lunarOre = 230
      await open(page, JSON.stringify(raw))
      await page.getByRole('button', { name: kind === 'platform' ? /BUILD ORBITAL PLATFORM/ : /HELIOS SPIRE/ }).tap()
      await step(page, kind === 'platform' ? 6200 : 4200)
      await page.getByRole('button', { name: kind === 'platform' ? /PRIORITIZE DEFENSE/ : /^1 DEFEND/ }).tap()
      if (kind === 'platform') await step(page, 15100 - (await saved(page)).outpost.orbitalSiege.elapsedMs)
      else await step(page, 700)
      const canvas = page.locator('canvas')
      await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'targeting')
      await capture(page, `${kind}-shared-targeting`)
      const before = (await saved(page)).outpost
      await page.getByRole('button', { name: 'FIRE DEFENSE', exact: false }).tap()
      const fired = (await saved(page)).outpost
      await page.clock.runFor(96)
      await expect(canvas).toHaveAttribute('data-defense-beam-visible', 'true')
      await expect(canvas).toHaveAttribute('data-defense-burst-visible', 'true')
      await capture(page, `${kind}-shared-laser`)
      expect(fired.lunarOre).toBeCloseTo(before.lunarOre, 1)
      if (kind === 'platform') expect(fired.orbitalSiege).toEqual(before.orbitalSiege)
      else {
        expect(fired.monument.wavesResolved).toBe(before.monument.wavesResolved)
        expect(fired.monument.defenseShots[0]).not.toBeNull()
      }
      if (kind === 'platform') await step(page, 18100 - (await saved(page)).outpost.orbitalSiege.elapsedMs)
      else await step(page, 6100 - (await saved(page)).outpost.monument.phaseElapsedMs)
      await expect(page.locator('main')).toHaveAttribute(kind === 'platform' ? 'data-siege-waves' : 'data-monument-waves', '1')
      const resolved = (await saved(page)).outpost
      await step(page, 500)
      const held = (await saved(page)).outpost
      if (kind === 'platform') {
        expect(held.orbitalSiege.platformHealth).toBe(95)
        expect(held.orbitalSiege.wavesResolved).toBe(resolved.orbitalSiege.wavesResolved)
      } else {
        expect(held.monument.health).toBe(resolved.monument.health)
        expect(held.monument.wavesResolved).toBe(resolved.monument.wavesResolved)
      }
      expect(errors).toEqual([])
    } finally { await page.close() }
  }
})

for (const damaged of [false, true]) test(`worker docking and continuous ${damaged ? 'damaged → repair → recovered' : 'normal'} navigation`, async ({ page }) => {
  test.setTimeout(240000)
  const raw = JSON.parse(damaged ? createAcceptedCounterstrikeSave('FAILURE') : createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 80
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page, JSON.stringify(raw), true)
  const main = page.locator('main'), canvas = page.locator('canvas')
  if (damaged) {
    await page.getByRole('button', { name: 'BACK TO OUTPOST', exact: true }).tap()
    await step(page, 2600)
    const signal = await canvas.evaluate(c => [Number(c.dataset.outpostSignalX), Number(c.dataset.outpostSignalY)])
    await page.touchscreen.tap(signal[0]!, signal[1]!)
    await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
    await step(page, 6500)
  }
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(canvas).toHaveAttribute('data-worker-dock', 'capsule-service-dock')
  const metrics: unknown[] = []
  const read = () => canvas.evaluate(c => ({ poses: JSON.parse(c.dataset.workerPoses!) as number[][],
    states: JSON.parse(c.dataset.workerStates!) as string[], revision: Number(c.dataset.workerRouteRevision) }))
  for (const [mode, count] of [['CONSERVE', 1], ['OVERDRIVE', 3]] as const) {
    await page.getByRole('button', { name: mode, exact: true }).tap()
    await page.clock.runFor(32)
    await expect(main).toHaveAttribute('data-operation-active-robots', String(count))
    const state = await read()
    expect(state.poses).toHaveLength(count)
    for (let i=0;i<count;i++) if(state.states[i]==='servicing') {
      const bay=capsuleServiceBay()
      expect(Math.hypot(state.poses[i]![0]!-bay.xM,state.poses[i]![1]!-bay.zM)).toBeLessThan(.001)
    }
  }
  await capture(page, damaged ? 'damaged-docking' : 'normal-docking')
  if (damaged) {
    await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
    await page.getByRole('button', { name: /^REPAIR GANTRY/ }).tap()
    await step(page, 4500)
    await expect(main).toHaveAttribute('data-module-status', 'active')
    await capture(page, 'repair-docking')
  }
  let previous=await read(), moved=0
  const revisions=new Set([previous.revision])
  for(let sample=0;sample<65;sample++) {
    await step(page,200)
    const current=await read()
    revisions.add(current.revision)
    for(let i=0;i<current.poses.length;i++) {
      expect(current.poses[i]!.every(Number.isFinite)).toBe(true)
      const delta=Math.hypot(current.poses[i]![0]!-previous.poses[i]![0]!,current.poses[i]![1]!-previous.poses[i]![1]!)
      expect(delta).toBeLessThan(.65)
      moved+=delta
      for(let j=i+1;j<current.poses.length;j++) expect(Math.hypot(current.poses[i]![0]!-current.poses[j]![0]!,current.poses[i]![1]!-current.poses[j]![1]!)).toBeGreaterThan(WORKER_RADIUS_M*2)
    }
    metrics.push(current);previous=current
  }
  expect(moved).toBeGreaterThan(1)
  expect(revisions.size).toBeLessThanOrEqual(damaged ? 2 : 1)
  if(damaged) {
    await expect(main).toHaveAttribute('data-outpost-damage-state','INTACT')
    await expect(main).toHaveAttribute('data-module-repair-progress','1')
  }
  await capture(page, damaged ? 'recovered-docking' : 'normal-working')
  await writeFile(`${evidence}/${damaged?'repair':'normal'}-browser-navigation.json`,JSON.stringify(metrics,null,2)+'\n')
  expect(errors).toEqual([])
})
