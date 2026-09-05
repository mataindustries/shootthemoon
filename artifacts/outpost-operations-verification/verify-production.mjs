import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../../src/persistence/outpostSave.ts'

const origin = 'http://127.0.0.1:4173'
const html = await readFile('dist/index.html', 'utf8')
assert.equal(await (await fetch(origin)).text(), html)
// Walk files only: dist/assets/moon is a directory, never a payload.
async function filesUnder(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) files.push(...await filesUnder(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}
const hashes = {}
const sizes = {}
for (const path of await filesUnder('dist')) {
  const asset = path.slice('dist'.length)
  const local = await readFile(path)
  const response = await fetch(`${origin}${asset}`)
  assert.equal(response.status, 200)
  const served = Buffer.from(await response.arrayBuffer())
  assert.deepEqual(served, local)
  hashes[asset] = createHash('sha256').update(served).digest('hex')
  sizes[asset] = { bytes: local.length, gzip9Bytes: gzipSync(local, { level: 9 }).length }
}
const javascriptGzipBytes = Object.entries(sizes)
  .filter(([path]) => path.endsWith('.js'))
  .reduce((sum, [, size]) => sum + size.gzip9Bytes, 0)
assert.ok(javascriptGzipBytes <= 400 * 1024)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, save), {
    key: OUTPOST_STORAGE_KEY, save: createAcceptedCounterstrikeSave('FAILURE'),
  })
  await page.goto(`${origin}/?e2e`)
  await page.waitForFunction(() => document.querySelector('main')?.dataset.sceneReady === 'true')
  await page.getByRole('button', { name: 'CONTINUE' }).tap()
  const before = await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY)
  const acknowledged = await page.evaluate(() => {
    const detail = { attemptElapsedMs: 7000, acknowledged: false }
    window.dispatchEvent(new CustomEvent('counterstrike:set-fire-elapsed', { detail }))
    window.dispatchEvent(new CustomEvent('counterstrike:set-run', { detail: { status: 'warning', progress: 0.5 } }))
    window.dispatchEvent(new CustomEvent('first-strike:set-presentation', { detail: { phase: 'arming', progress: 0.5 } }))
    window.dispatchEvent(new CustomEvent('moon-core:set-cinematic-progress', { detail: { progress: 1 } }))
    return detail.acknowledged
  })
  assert.equal(acknowledged, false)
  assert.equal(await page.locator('main').getAttribute('data-counterstrike-state'), 'resolved')
  assert.equal(await page.locator('main').getAttribute('data-first-strike-presentation'), 'idle')
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), OUTPOST_STORAGE_KEY), before)
  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', 'surface-player')
  await expect(page.getByText('OUTPOST DAMAGED · −30% PRODUCTION', { exact: true })).toBeVisible()
  const canvas = page.locator('canvas')
  await page.waitForTimeout(1_000)
  const startFrame = Number(await canvas.getAttribute('data-frame-count'))
  await page.waitForTimeout(1_400)
  const idleFrames = Number(await canvas.getAttribute('data-frame-count')) - startFrame
  assert.ok(idleFrames <= 16)
  const surfaceMetrics = await canvas.evaluate((element) => ({
    drawCalls: Number(element.dataset.drawCalls), triangles: Number(element.dataset.triangles),
    programs: Number(element.dataset.programs),
  }))
  assert.ok(surfaceMetrics.drawCalls <= 80 && surfaceMetrics.triangles <= 200_000 && surfaceMetrics.programs <= 24)
  await page.screenshot({ path: 'artifacts/screenshots/outpost-operations/10-ordinary-production-portrait.png' })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.screenshot({ path: 'artifacts/screenshots/outpost-operations/10-ordinary-production-landscape.png' })
  assert.deepEqual(errors, [])
  const result = { ordinaryBuildHarnessRejectedEvenWithQuery: true, currentPreviewAssetsVerified: hashes, artifactSizes: sizes, javascriptGzipBytes, browserErrors: errors, surfaceMetrics, idleFrames, idleDurationMs: 1400 }
  await writeFile('artifacts/outpost-operations-verification/ordinary-build-check.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
