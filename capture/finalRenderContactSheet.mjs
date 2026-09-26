#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Proof-pass contact sheet: one page, in final-edit order, showing the
 * first/mid/last frame capture/finalRenderProof.spec.ts wrote for every
 * selected clip, with its approved crop already baked in (the proof frames
 * are captured pre-cropped via Playwright's screenshot `clip`, so this is
 * zero-dependency HTML with plain <img> tags — same convention as
 * capture/contactSheet.mjs and capture/reelContactSheets.mjs).
 *
 * Run after capture/finalRenderProof.spec.ts has populated
 * capture-final/<clip>__<shot>/proof/frames/:
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRenderContactSheet.mjs
 *
 * Output: capture-final/proof-contact-sheet.html
 */
import { readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { buildFinalRenderJobs } from './finalRender/plan.ts'
import { jobOutputDir } from './finalRender/resume.ts'
import { SHOTS } from './manifest.ts'

const OUTPUT_ROOT = 'capture-final'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function describeSource(source) {
  if (source.clock === 'still') return 'still'
  if (source.clock === 'progress') return `progress ${source.phase} ${source.in} -> ${source.out}`
  return `elapsed-ms ${source.origin} +${source.inMs}ms -> +${source.outMs}ms`
}

async function loadProofFrames(job) {
  const dir = path.join(jobOutputDir(job), 'proof', 'frames')
  const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.png')).sort()
  const sized = await Promise.all(
    files.map(async (file) => ({ file, bytes: (await stat(path.join(dir, file))).size })),
  )
  return { dir, files: sized }
}

function labelFor(index, files) {
  if (files.length === 1) return 'only frame'
  if (index === 0) return 'first'
  if (index === files.length - 1) return 'last'
  return 'mid'
}

async function jobSection(job) {
  const { dir, files } = await loadProofFrames(job)
  const relDir = path.relative(OUTPUT_ROOT, dir)
  const status = files.length === 0 ? '⚠ NOT CAPTURED YET' : `${files.length} proof frame(s)`
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)

  const tiles = files
    .map(({ file, bytes }, index) => {
      const kb = (bytes / 1024).toFixed(0)
      return `
      <figure>
        <img src="${path.join(relDir, file)}" loading="lazy" alt="${escapeHtml(job.jobId)} ${labelFor(index, files)}" />
        <figcaption>${escapeHtml(labelFor(index, files))} · ${escapeHtml(file)} · ${kb} KB</figcaption>
      </figure>`
    })
    .join('\n')

  return {
    html: `
  <section class="job act-${escapeHtml(job.act.toLowerCase())}">
    <h2>#${job.order + 1} · ${escapeHtml(job.jobId)} <span class="badge">${escapeHtml(job.act)}</span></h2>
    <p class="status">${escapeHtml(status)} · ${(totalBytes / 1024).toFixed(0)} KB</p>
    <table class="meta">
      <tr><th>shot</th><td>${escapeHtml(job.shotId)}</td></tr>
      <tr><th>profile</th><td>${escapeHtml(job.profile)}</td></tr>
      <tr><th>frames (full render)</th><td>${job.frames}</td></tr>
      <tr><th>source window</th><td>${escapeHtml(describeSource(job.source))}</td></tr>
      <tr><th>crop</th><td>${job.crop.x},${job.crop.y} ${job.crop.w}x${job.crop.h}${job.cropEnd !== job.crop ? ` -> ${job.cropEnd.x},${job.cropEnd.y} ${job.cropEnd.w}x${job.cropEnd.h}` : ''}</td></tr>
    </table>
    <div class="grid">${tiles || '<p class="empty">No proof frames on disk — run finalRenderProof.spec.ts first.</p>'}</div>
  </section>`,
    frameCount: files.length,
    bytes: totalBytes,
  }
}

async function main() {
  const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8'))
  const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
  const jobs = buildFinalRenderJobs(edit, shotIndex)

  const sections = await Promise.all(jobs.map(jobSection))
  const capturedJobs = sections.filter((s) => s.frameCount > 0).length
  const totalFrames = sections.reduce((sum, s) => sum + s.frameCount, 0)
  const totalBytes = sections.reduce((sum, s) => sum + s.bytes, 0)
  const averageBytesPerFrame = totalFrames > 0 ? totalBytes / totalFrames : 0

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Final render — proof-pass contact sheet</title>
<style>
  :root { color-scheme: dark; }
  body { background: #111; color: #eee; font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .subtitle { color: #999; font-size: 13px; margin: 0 0 24px; }
  section.job { background: #181818; border-radius: 8px; padding: 16px; margin-bottom: 24px; border-left: 4px solid #555; }
  section.act-arrival { border-left-color: #4c8dff; }
  section.act-rival { border-left-color: #b34cff; }
  section.act-first_strike { border-left-color: #ff6b4c; }
  section.act-counterstrike { border-left-color: #ffcf4c; }
  section.act-divider { border-left-color: #cc4cff; }
  section.act-monuments { border-left-color: #4cffb0; }
  section.act-claimed_moon { border-left-color: #4cffe8; }
  section.act-derivatives { border-left-color: #888; }
  .badge { font-size: 10px; letter-spacing: .05em; padding: 2px 6px; border-radius: 3px; background: #333; color: #ccc; vertical-align: middle; }
  .status { font-size: 12px; color: #9adb9a; margin: 0 0 10px; }
  table.meta { border-collapse: collapse; font-size: 12px; margin-bottom: 12px; width: 100%; }
  table.meta th { text-align: left; color: #888; padding: 2px 10px 2px 0; vertical-align: top; white-space: nowrap; }
  table.meta td { color: #ddd; padding: 2px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  figure { margin: 0; background: #1b1b1b; border-radius: 6px; overflow: hidden; }
  figure img { width: 100%; display: block; background: #000; }
  figcaption { font-size: 10px; padding: 4px 6px; color: #999; }
  .empty { color: #a55; font-size: 12px; }
</style>
</head>
<body>
  <h1>Final render — proof-pass contact sheet</h1>
  <p class="subtitle">
    ${jobs.length} job(s) in final-edit order · ${capturedJobs}/${jobs.length} captured ·
    ${totalFrames} proof frame(s) · ${(totalBytes / 1e6).toFixed(2)} MB ·
    avg ${(averageBytesPerFrame / 1024).toFixed(0)} KB/frame
  </p>
  ${sections.map((s) => s.html).join('\n')}
</body>
</html>
`
  const sheetPath = path.join(OUTPUT_ROOT, 'proof-contact-sheet.html')
  await writeFile(sheetPath, html)
  console.log(`Wrote ${sheetPath} (${capturedJobs}/${jobs.length} jobs captured, ${totalFrames} frames, ${(totalBytes / 1e6).toFixed(2)} MB)`)
}

main()
