import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createAcceptedCounterstrikeSave } from './firstStrikeFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'

test('three mobile defense waves: hit, timeout miss, hit, saved claim and reveal replay', async ({ page, request }) => {
  test.setTimeout(180_000)
  const evidence = process.env.MINING_REPAIR_EVIDENCE ?? 'artifacts/screenshots/wave-defense-feedback'
  await mkdir(evidence, { recursive: true })
  expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS'))
  raw.outpost.lunarOre = 230
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    if (!sessionStorage.getItem('defense-seeded')) {
      localStorage.setItem(key, save)
      sessionStorage.setItem('defense-seeded', 'true')
    }
  }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
  await page.clock.install()
  await page.goto('/')
  const main = page.locator('main'), canvas = page.locator('canvas')
  const card = page.getByRole('region', { name: 'Territory Monuments', exact: true })
  const action = page.getByRole('button', { name: 'FIRE DEFENSE', exact: false })
  const save = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), OUTPOST_STORAGE_KEY)
  const step = async (ms: number) => { await page.clock.fastForward(ms); await page.clock.runFor(32) }
  const samples: Record<string, unknown> = {}
  const capture = async (name: string, active = false) => {
    const sample = await canvas.evaluate(el => ({ calls: Number(el.dataset.drawCalls), triangles: Number(el.dataset.triangles),
      geometries: Number(el.dataset.geometries), textures: Number(el.dataset.textures), programs: Number(el.dataset.programs),
      radius: Number(el.dataset.cameraRadius), position: [el.dataset.cameraX, el.dataset.cameraY, el.dataset.cameraZ].map(Number),
      framing: JSON.parse(el.dataset.defenseFraming!) as Record<string, number[]> }))
    expect(sample.calls).toBeLessThanOrEqual(45)
    expect(sample.triangles).toBeLessThanOrEqual(120000)
    expect(sample.textures).toBeLessThanOrEqual(6)
    expect(sample.programs).toBeLessThanOrEqual(24)
    expect(sample.radius).toBeGreaterThan(1.18)
    if (active) {
      const box = (await card.boundingBox())!
      const viewport = page.viewportSize()!
      expect(box.y).toBeGreaterThan(viewport.height * .5)
      for (const point of Object.values(sample.framing)) {
        expect(Math.abs(point[0]!)).toBeLessThan(.9)
        expect(point[1]).toBeLessThan(.93)
        expect((1 - point[1]!) * viewport.height / 2).toBeLessThan(box.y - 12)
        expect(Math.abs(point[2]!)).toBeLessThan(1)
      }
    }
    samples[name] = sample
    await page.screenshot({ path: `${evidence}/${name}.png` })
    return sample
  }
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: /HELIOS SPIRE/ }).tap()
  await step(4200)
  await expect(main).toHaveAttribute('data-monument-status', 'command')
  const initialPose = await capture('01-allocation')
  for (let wave = 0; wave < 3; wave++) {
    if (wave === 1) await page.setViewportSize({ width: 320, height: 568 })
    if (wave === 2) await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByText(`WAVE ${wave + 1} / 3`, { exact: false })).toBeVisible()
    await page.getByRole('button', { name: /^1 DEFEND/ }).tap()
    await expect(main).toHaveAttribute('data-monument-status', 'wave')
    await expect(action).toBeEnabled()
    await step(700)
    await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'targeting')
    const approach = await capture(`wave-${wave + 1}-targeting`, true)
    if (wave === 0) expect(approach.position).toEqual(initialPose.position)
    const bounds = (await action.boundingBox())!
    expect(bounds.height).toBeGreaterThanOrEqual(64)
    expect(bounds.width).toBeGreaterThanOrEqual(270)
    expect(await action.evaluate(el => {
      const b = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(b.right - 8, b.top + b.height / 2))
    })).toBe(true)
    if (wave === 1) {
      await step(2050)
      await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'miss')
      // Let the target escape: the baseline allocation still resolves the wave.
      await expect(page.getByRole('button', { name: 'TARGET ESCAPED', exact: false })).toBeDisabled()
      await step(96)
      await capture('wave-2-missed', true)
      expect((await save()).outpost.monument.defenseShots[1]).toBeNull()
    } else {
      // Hit the far edge of the actual button, not a test-only input hook.
      await page.touchscreen.tap(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2)
      await expect(page.locator('.wave-defense-card')).toHaveAttribute('data-phase', 'hit')
      // Surviving escorts jink, then still make their attack run; the copy must not claim they break off.
      await expect(page.locator('.wave-defense-result')).toContainText('DIVIDER LEAD DESTROYED')
      await expect(page.locator('.wave-defense-result')).toContainText('Escorts pressing the attack.')
      await page.clock.runFor(96)
      await expect(canvas).toHaveAttribute('data-defense-burst-visible', 'true')
      await expect(canvas).toHaveAttribute('data-defense-beam-visible', 'true')
      const impact = await capture(`wave-${wave + 1}-impact`, true)
      expect(Math.hypot(...impact.position.map((v, i) => v - approach.position[i]!))).toBeLessThan(.0012)
      await step(330)
      await expect(canvas).toHaveAttribute('data-defense-burst-visible', 'true')
      await capture(`wave-${wave + 1}-debris`, true)
      const shot = (await save()).outpost.monument.defenseShots[wave]
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      expect((await save()).outpost.monument.defenseShots[wave]).toBe(shot)
    }
    if (wave === 0) {
      const beforeReload = (await save()).outpost.monument
      await page.clock.resume()
      await page.reload()
      await expect(main).toHaveAttribute('data-scene-ready', 'true')
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
      await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
      expect((await save()).outpost.monument.defenseShots).toEqual(beforeReload.defenseShots)
      await expect(page.getByRole('button', { name: 'DEFENSE FIRED', exact: false })).toBeDisabled()
    }
    const elapsed = (await save()).outpost.monument.phaseElapsedMs
    await step(Math.max(0, 3800 - elapsed))
    await expect(canvas).toHaveAttribute('data-defense-burst-visible', 'false')
    // Survivors hold after the defense window, then make their attack run before the unchanged outcome boundary.
    await expect(canvas).toHaveAttribute('data-octogonals-visible', 'true')
    await expect(canvas).toHaveAttribute('data-octogonal-fire-visible', 'false')
    await expect(page.getByText('WAVE OUTCOME INCOMING', { exact: true })).toBeVisible()
    const strike = [6000, 7000, 8000][wave]!
    await step(strike - 1000 + 450 - (await save()).outpost.monument.phaseElapsedMs)
    await expect(canvas).toHaveAttribute('data-octogonal-fire-visible', 'true')
    await expect(canvas).toHaveAttribute('data-octogonal-impact-visible', 'true')
    await capture(`wave-${wave + 1}-attack`)
    expect((await save()).outpost.monument.wavesResolved).toBe(wave)
    await step(strike - (await save()).outpost.monument.phaseElapsedMs + 50)
    await expect(canvas).toHaveAttribute('data-octogonal-fire-visible', 'false')
    await expect(canvas).toHaveAttribute('data-octogonal-impact-visible', 'false')
    await expect(main).toHaveAttribute('data-monument-waves', String(wave + 1))
    await expect(main).toHaveAttribute('data-monument-health', String([99, 92, 87][wave]))
    await expect(page.getByTestId('wave-outcome')).toContainText(wave === 1 ? 'MISSED' : 'HIT · 4 HULL SAVED')
    // The attack presentation owns no frame loop: the allocation pause returns to demand rendering.
    if (wave < 2) await expect(main).toHaveAttribute('data-render-mode', 'demand')
    await capture(`wave-${wave + 1}-outcome`)
  }
  await step(4500)
  await expect(main).toHaveAttribute('data-monument-status', 'complete')
  await expect(main).toHaveAttribute('data-territory-claimed', 'true')
  await step(6500)
  const completed = await save()
  expect(completed.outpost.monument).toMatchObject({ orders: ['DEFEND', 'DEFEND', 'DEFEND'], health: 87, oreLost: 0, workMs: 36000, wavesResolved: 3 })
  expect(completed.counterstrike).toEqual(raw.counterstrike)
  expect(completed.firstStrike.scar).toEqual(raw.firstStrike.scar)
  await capture('claim')
  await page.getByRole('button', { name: 'REPLAY ORBITAL REVEAL', exact: true }).tap()
  await step(6500)
  expect((await save()).outpost.monument).toEqual(completed.outpost.monument)
  await page.clock.resume()
  await page.reload()
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await expect(main).toHaveAttribute('data-monument-health', '87')
  expect((await save()).outpost.monument).toEqual(completed.outpost.monument)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await writeFile(`${evidence}/metrics.json`, JSON.stringify(samples, null, 2) + '\n')
  expect(errors).toEqual([])
})
