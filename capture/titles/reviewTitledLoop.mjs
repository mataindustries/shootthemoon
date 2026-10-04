#!/usr/bin/env node
/** Real-time browser repetition proof. The player itself has no review UI.
 * node capture/titles/reviewTitledLoop.mjs --out=capture-final/loop-motion
 * Requires Chromium with H.264 playback; runs eleven wraps so at least ten
 * whole loops have played after the first observed restart.
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const arg = process.argv.slice(2).find((value) => value.startsWith('--out='))
if (!arg) throw new Error('--out=… is required')
const out = arg.slice(6), qa = path.join(out, 'qa')
mkdirSync(qa, { recursive: true })
const video = readFileSync(path.join(out, 'loop-13s-1280-titled.mp4'))
const html = '<!doctype html><html><meta charset="utf-8"><title>Shoot the Moon loop review</title><body style="margin:0;background:#111"><video src="loop-13s-1280-titled.mp4" width="480" muted loop playsinline autoplay></video></body></html>\n'
writeFileSync(path.join(out, 'review.html'), html)
const server = createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return }
  if (req.url !== '/loop-13s-1280-titled.mp4') { res.writeHead(404); res.end(); return }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${video.length}`
  res.writeHead(range ? 206 : 200, headers); res.end(video.subarray(start, end + 1))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 520, height: 300 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const samples = new Set()
  await page.exposeFunction('sampleReview', async (sample) => {
    if (samples.has(sample.name)) return
    samples.add(sample.name)
    await page.locator('video').screenshot({ path: path.join(qa, `playback-${sample.name}.png`) })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(() => {
    const video = document.querySelector('video')
    const stats = window.reviewStats = { started: performance.now(), wraps: 0, completeLoops: 0, framesObserved: 0, loops: [], stalls: 0, errors: [], samples: [] }
    let previous = -1, loopStarted = performance.now(), loopFrames = 0
    video.addEventListener('waiting', () => stats.stalls++)
    video.addEventListener('error', () => stats.errors.push(video.error?.message ?? 'video error'))
    const sampleFrames = { L1: 110, L2: 236, L3: 355, tail: 410, restart: 4 }
    const seen = new Set()
    const sample = (now, metadata) => {
      const t = metadata.mediaTime
      if (previous > 13 && t < .3) {
        stats.wraps++
        stats.loops.push({ wrap: stats.wraps, durationMs: now - loopStarted, observedFrames: loopFrames })
        if (stats.wraps > 1) stats.completeLoops++
        loopStarted = now; loopFrames = 0
      }
      previous = t; loopFrames++; stats.framesObserved++
      stats.currentTime = t; stats.elapsedMs = now - stats.started
      for (const [name, frame] of Object.entries(sampleFrames)) if (!seen.has(name) && t >= frame / 30 && t < (frame + 3) / 30) {
        seen.add(name); stats.samples.push({ name, mediaTime: t }); window.sampleReview({ name })
      }
      if (stats.completeLoops < 10) video.requestVideoFrameCallback(sample)
    }
    video.requestVideoFrameCallback(sample)
  })
  await page.waitForFunction(() => document.querySelector('video').currentTime > .3 || document.querySelector('video').error, null, { timeout: 15_000 })
  const format = await page.evaluate(() => {
    const v = document.querySelector('video'), box = v.getBoundingClientRect()
    return { codecSupport: v.canPlayType('video/mp4; codecs="avc1.64001f"'), width: box.width, height: box.height, duration: v.duration, muted: v.muted, loop: v.loop, playsInline: v.playsInline, autoplay: v.autoplay, error: v.error?.message ?? null }
  })
  if (format.error || format.width !== 480 || format.duration !== 13.8) throw new Error(`Player mismatch: ${JSON.stringify(format)}`)
  console.log('480 px muted/autoplay/playsinline player running; observing ten complete real-time loops.')
  await page.waitForFunction(() => window.reviewStats.completeLoops >= 10 || window.reviewStats.errors.length, null, { timeout: 190_000, polling: 1000 })
  const stats = await page.evaluate(() => {
    const quality = document.querySelector('video').getVideoPlaybackQuality()
    return { ...window.reviewStats, playbackQuality: { totalVideoFrames: quality.totalVideoFrames, droppedVideoFrames: quality.droppedVideoFrames, corruptedVideoFrames: quality.corruptedVideoFrames } }
  })
  const report = { schema: 'shootthemoon.loop-repetition/1', browser: `chromium ${browser.version()}`, player: format, ...stats, pageErrors: errors, visualAssessment: 'Inspect playback-L1/L2/L3, tail and restart PNGs together with the decoded seam and mobile proofs. This file records actual playback, not a human viewing claim.' }
  writeFileSync(path.join(qa, 'repetition-report.json'), JSON.stringify(report, null, 2) + '\n')
  if (stats.completeLoops < 10 || stats.errors.length || errors.length) throw new Error('Ten-loop playback failed')
  console.log(JSON.stringify({ completeLoops: stats.completeLoops, wraps: stats.wraps, elapsedSec: stats.elapsedMs / 1000, framesObserved: stats.framesObserved, playbackQuality: stats.playbackQuality, pageErrors: errors }, null, 2))
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
