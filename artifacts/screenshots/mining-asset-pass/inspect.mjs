// Short production-preview probes; no game code or save schema overrides.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { createLegacyActiveExtractorSave } from '../../../e2e/rivalFixtures.ts'
import { createAcceptedCounterstrikeSave } from '../../../e2e/firstStrikeFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../../../src/persistence/outpostSave.ts'
const gantry = process.argv.includes('--gantry')
const low = process.argv.includes('--low')
const directory = 'artifacts/screenshots/mining-asset-pass/after'
await mkdir(directory, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const raw = JSON.parse(gantry ? createAcceptedCounterstrikeSave('FAILURE') : createLegacyActiveExtractorSave())
  if (gantry) {
    const now = Date.now()
    raw.outpost.module = { id: 'module-slot-01', kind: 'REPAIR_GANTRY', status: 'active', constructionStartedAtMs: now - 6000, completionTimestampMs: now - 3000, repairProgress: .2, lastRepairAtMs: now }
  }
  await page.addInitScript(({ key, save, low }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => low ? 4 : 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => low ? 4 : 8 })
    localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw), low })
  await page.goto('http://127.0.0.1:4173/?e2e')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  if (gantry) {
    await page.getByRole('button', { name: 'BACK TO OUTPOST', exact: true }).tap()
    await page.waitForFunction(() => document.querySelector('canvas').dataset.outpostSignalX)
    const point = await page.locator('canvas').evaluate(c => ({ x: +c.dataset.outpostSignalX, y: +c.dataset.outpostSignalY }))
    await page.touchscreen.tap(point.x, point.y)
    await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  }
  await page.waitForFunction(() => document.querySelector('main').dataset.phase === 'landed')
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } })))
  const name = `${gantry ? 'gantry-inspection' : 'system-inspection'}${low ? '-low' : ''}`
  const metrics = await page.locator('canvas').evaluate(c => ({ ...c.dataset }))
  const environment = await page.locator('canvas').evaluate(c => {
    const gl = c.getContext('webgl2')
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return { userAgent: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost(), glError: gl.getError() }
  })
  console.log(JSON.stringify({ name, calls: metrics.drawCalls, triangles: metrics.triangles, geometries: metrics.geometries, programs: metrics.programs, moduleBounds: metrics.moduleBounds, errors }))
  await writeFile(`${directory}/${name}.json`, JSON.stringify({ metrics, environment, browserVersion: browser.version(), errors }, null, 2))
  await page.screenshot({ path: `${directory}/${name}.png` })
  await page.addStyleTag({ content: '.hud, .operations-panel, .outpost-panel, .monument-entry { visibility: hidden !important }' })
  await page.screenshot({ path: `${directory}/${name}-assets.png` })
  if (errors.length) process.exitCode = 1
} finally { await browser.close() }
