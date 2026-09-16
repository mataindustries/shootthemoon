import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { createLegacyActiveExtractorSave } from '../../../e2e/rivalFixtures.ts'
import { OUTPOST_STORAGE_KEY, deserializePrototypeSave, serializePrototypeSave } from '../../../src/persistence/outpostSave.ts'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const raw = JSON.parse(serializePrototypeSave(deserializePrototypeSave(createLegacyActiveExtractorSave())))
  const now = Date.now()
  raw.outpost.lunarOre = 30
  raw.outpost.module = { id: 'module-slot-01', kind: 'SOLAR_WING', status: 'active', constructionStartedAtMs: now - 6000, completionTimestampMs: now - 3000, repairProgress: 1, lastRepairAtMs: now }
  await page.addInitScript(({ key, save }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    localStorage.setItem(key, save)
  }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
  await page.goto('http://127.0.0.1:4175/?e2e')
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  await page.waitForFunction(() => document.querySelector('main').dataset.outpostModule === 'SOLAR_WING')
  await page.waitForTimeout(1500)
  const point = await page.locator('canvas').evaluate(c => ({ x: +c.dataset.depositGammaX, y: +c.dataset.depositGammaY }))
  await page.touchscreen.tap(point.x, point.y)
  await page.evaluate(() => {
    const main = document.querySelector('main')
    const observer = new MutationObserver(() => {
      if (main.dataset.robotState !== 'mining') return
      window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } }))
      observer.disconnect()
    })
    observer.observe(main, { attributes: true, attributeFilter: ['data-robot-state'] })
  })
  await page.locator('button[data-deposit-id="deposit-gamma"]').tap()
  await page.waitForFunction(() => document.querySelector('main').dataset.robotState === 'mining')
  const frames = []
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500)
    const d = await page.locator('canvas').evaluate(c => ({ ...c.dataset }))
    const frame = { frames: d.frameCount, pose: [d.cameraX, d.cameraY, d.cameraZ, d.cameraTargetX, d.cameraTargetY, d.cameraTargetZ], hero: JSON.parse(d.heroFraming), laser: d.miningLaser }
    frames.push(frame)
    console.log(JSON.stringify(frame))
  }
  await writeFile('artifacts/screenshots/mining-asset-pass/validation/gamma-framing.json', JSON.stringify(frames, null, 2))
  await page.screenshot({ path: 'artifacts/screenshots/mining-asset-pass/after/11-gamma-full-hud.png' })
} finally { await browser.close() }
