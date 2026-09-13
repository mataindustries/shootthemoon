import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from '../../e2e/rivalFixtures.ts'
import { deserializePrototypeSave, serializePrototypeSave, OUTPOST_STORAGE_KEY } from '../../src/persistence/outpostSave.ts'
import { MONUMENT_KINDS, MONUMENTS } from '../../src/domain/territoryMonument.ts'

// Ordinary production preview. Fixtures enter through the same validated save loader.
const origin = 'http://127.0.0.1:4173'
const evidence = 'artifacts/screenshots/territory-visual-polish'
await mkdir(evidence, { recursive: true })
assert.equal(await (await fetch(origin)).text(), await readFile('dist/index.html', 'utf8'))
const results = { frames: {}, assets: {}, errors: [] }
for (const name of await readdir('dist/assets')) {
  if (!/\.(js|css)$/.test(name)) continue
  const data = await readFile(`dist/assets/${name}`)
  results.assets[name] = { bytes: data.length, gzipBytes: gzipSync(data).length, sha256: createHash('sha256').update(data).digest('hex') }
}
assert.ok(Object.entries(results.assets).filter(([name]) => name.endsWith('.js')).reduce((n, [, asset]) => n + asset.gzipBytes, 0) <= 400 * 1024)
const browser = await chromium.launch()
async function open(save, { landscape = false, reducedMotion = 'no-preference', low = false } = {}) {
  const page = await browser.newPage({
    viewport: landscape ? { width: 844, height: 390 } : { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion,
  })
  page.on('pageerror', error => results.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()) })
  await page.addInitScript(({ key, save, low }) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => low ? 4 : 8 })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => low ? 4 : 6 })
    if (save) localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save, low })
  await page.clock.install()
  await page.goto(origin)
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true', { timeout: 30000 })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 800))
  return page
}
async function capture(page, name) {
  await page.clock.runFor(32)
  const metrics = await page.locator('canvas').evaluate(canvas => {
    const d = canvas.dataset, gl = canvas.getContext('webgl2')
    return { calls: +d.drawCalls, triangles: +d.triangles, geometries: +d.geometries,
      programs: +d.programs, textures: +d.textures, frameCount: +d.frameCount,
      buffer: [+d.bufferWidth, +d.bufferHeight], baseDetails: d.baseDetailsVisible,
      monumentDetails: d.monumentDetailVisible, platform: d.platformVisible, claim: d.claimSignalVisible,
      camera: [d.cameraX, d.cameraY, d.cameraZ, d.cameraTargetX, d.cameraTargetY, d.cameraTargetZ].map(Number),
      webglError: gl.getError(), contextLost: gl.isContextLost() }
  })
  assert.ok(metrics.calls > 0 && metrics.calls <= 80, `${name}: ${metrics.calls} calls`)
  assert.ok(metrics.triangles > 0 && metrics.triangles <= 200000, `${name}: triangle budget`)
  assert.ok(metrics.programs <= 24, `${name}: shader budget`)
  assert.ok(metrics.buffer[0] * metrics.buffer[1] <= 1000000)
  assert.equal(metrics.webglError, 0)
  assert.equal(metrics.contextLost, false)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: `${evidence}/${name}.png` })
  results.frames[name] = metrics
  process.stdout.write(`${name}: ${metrics.calls} draws, ${metrics.triangles} triangles\n`)
}
function monumentSave(kind, overrides = {}) {
  const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS'))
  raw.outpost.monument = { kind, anchor: kind === 'CRATER_CROWN' ? 'impact-scar' : 'outpost',
    status: 'complete', phaseElapsedMs: 0, workMs: MONUMENTS[kind].laborMs, repairWorkMs: 0,
    health: 79, wavesResolved: 3, orders: ['DEFEND', 'DEFEND', 'DEFEND'], productionPenalty: 0,
    energyLoss: 0, oreLost: 0, completedAtMs: Date.now() - 1000, revealSeen: true, ...overrides }
  return JSON.stringify(raw)
}
try {
  for (const landscape of [false, true]) {
    const page = await open(null, { landscape })
    await capture(page, `menu-${landscape ? 'landscape' : 'portrait'}`)
    const count = +await page.locator('canvas').getAttribute('data-frame-count')
    await page.clock.fastForward(1000)
    assert.ok(+await page.locator('canvas').getAttribute('data-frame-count') - count <= 1, 'Menu remains demand-idle')
    await page.getByRole('button', { name: 'BEGIN INVASION' }).tap()
    await capture(page, `fresh-orbit-${landscape ? 'landscape' : 'portrait'}`)
    await page.close()
  }
  for (const kind of MONUMENT_KINDS) {
    const page = await open(monumentSave(kind))
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await expect(page.locator('main')).toHaveAttribute('data-monument-view', 'true')
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), OUTPOST_STORAGE_KEY)
    await page.getByRole('button', { name: 'REPLAY ORBITAL REVEAL' }).tap()
    await capture(page, `${kind.toLowerCase()}-reveal-start`)
    await page.clock.fastForward(2900)
    await capture(page, `${kind.toLowerCase()}-reveal-mid`)
    await page.clock.fastForward(3300)
    await capture(page, `${kind.toLowerCase()}-complete`)
    const replayed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), OUTPOST_STORAGE_KEY)
    assert.deepEqual(replayed.outpost.monument, saved.outpost.monument)
    assert.deepEqual({ ...replayed.firstStrike, updatedAtMs: saved.firstStrike.updatedAtMs }, saved.firstStrike)
    assert.deepEqual(replayed.counterstrike, saved.counterstrike)
    await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
    await page.clock.runFor(500)
    await capture(page, `${kind.toLowerCase()}-claim-orbit`)
    await expect(page.locator('canvas')).toHaveAttribute('data-base-details-visible', 'false')
    await expect(page.locator('canvas')).toHaveAttribute('data-monument-detail-visible', 'true')
    await expect(page.locator('canvas')).toHaveAttribute('data-claim-signal-visible', 'true')
    await page.close()
  }
  for (let wave = 0; wave < 3; wave++) {
    const page = await open(monumentSave('HELIOS_SPIRE', { status: 'command', completedAtMs: null,
      workMs: 20000, wavesResolved: wave, orders: [0, 1, 2].map(i => i < wave ? 'DEFEND' : null), revealSeen: false }))
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    await capture(page, `octogonals-lane-${wave + 1}`)
    await page.getByRole('button', { name: /^1 DEFEND/ }).tap()
    await page.clock.fastForward(2300)
    await capture(page, `octogonals-lane-${wave + 1}-inbound`)
    await page.close()
  }
  const legacy = deserializePrototypeSave(createLegacyActiveExtractorSave())
  for (const status of ['operational', 'waves', 'damaged']) {
    const platformHealth = status === 'damaged' ? 16 : 85
    const orbitalSiege = { status, elapsedMs: status === 'waves' ? 17600 : 34000, progress: 1,
      order: 'MINE', wavesResolved: status === 'waves' ? 0 : 3, platformHealth,
      outpostDamage: status === 'damaged' ? 36 : 0, oreLost: 0, energyLoss: 0, attempts: 1 }
    const save = serializePrototypeSave({ ...legacy, outpost: { ...legacy.outpost, orbitalSiege } })
    const page = await open(save)
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
    if (status === 'operational') await page.getByRole('button', { name: 'BACK TO OUTPOST' }).tap()
    await capture(page, `platform-${status}-portrait`)
    await page.setViewportSize({ width: 844, height: 390 })
    await capture(page, `platform-${status}-landscape`)
    await page.close()
  }
  const basinSave = serializePrototypeSave({ ...legacy, outpost: { ...legacy.outpost,
    monument: { ...JSON.parse(monumentSave('CRATER_CROWN')).outpost.monument, anchor: 'outpost' } } })
  const basinPage = await open(basinSave)
  await basinPage.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await basinPage.getByRole('button', { name: 'REPLAY ORBITAL REVEAL' }).tap()
  await capture(basinPage, 'crater-crown-outpost-basin')
  await basinPage.close()
  const page = await open(monumentSave('SIGNAL_ARRAY'), { landscape: true, reducedMotion: 'reduce', low: true })
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await page.getByRole('button', { name: 'REPLAY ORBITAL REVEAL' }).tap()
  await capture(page, 'signal-array-low-reduced-motion-landscape')
  const pose = results.frames['signal-array-low-reduced-motion-landscape'].camera
  await page.clock.runFor(1000)
  await capture(page, 'signal-array-low-reduced-motion-held')
  assert.deepEqual(results.frames['signal-array-low-reduced-motion-held'].camera, pose)
  await page.close()
  assert.deepEqual(results.errors, [])
} finally {
  await writeFile('artifacts/territory-visual-polish/metrics.json', JSON.stringify(results, null, 2) + '\n')
  await browser.close()
}
