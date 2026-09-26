#!/usr/bin/env node
/**
 * Zero-dependency HTML contact sheet for one or all capture-output shots.
 * Reads each shot's capture.json + frames/*.png and writes a static
 * contact-sheet.html next to them (relative <img> paths only — no image
 * processing, no new dependencies).
 *
 * Usage:
 *   node capture/contactSheet.mjs [shot-id]   # omit shot-id for all shots
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUTPUT_ROOT = 'capture-output'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

async function buildSheet(shotId) {
  const shotDir = path.join(OUTPUT_ROOT, shotId)
  const metadataPath = path.join(shotDir, 'capture.json')
  const framesDir = path.join(shotDir, 'frames')

  let metadata
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  } catch {
    console.warn(`Skipping ${shotId}: no capture.json (run capture.spec.ts first).`)
    return
  }

  const frameFiles = (await readdir(framesDir).catch(() => [])).filter((name) =>
    name.endsWith('.png'),
  )
  frameFiles.sort()

  const tiles = frameFiles
    .map(
      (file, index) => `
      <figure>
        <img src="frames/${escapeHtml(file)}" loading="lazy" alt="frame ${index}" />
        <figcaption>${escapeHtml(file)}</figcaption>
      </figure>`,
    )
    .join('\n')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Capture contact sheet — ${escapeHtml(metadata.shotId ?? shotId)}</title>
<style>
  body { background: #111; color: #eee; font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  pre { background: #1b1b1b; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
  figure { margin: 0; background: #1b1b1b; border-radius: 6px; overflow: hidden; }
  figure img { width: 100%; display: block; background: #000; }
  figcaption { font-size: 11px; padding: 4px 6px; color: #999; }
</style>
</head>
<body>
  <h1>${escapeHtml(metadata.name ?? shotId)}</h1>
  <pre>${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>
  <div class="grid">${tiles}</div>
</body>
</html>
`

  const sheetPath = path.join(shotDir, 'contact-sheet.html')
  await writeFile(sheetPath, html)
  console.log(`Wrote ${sheetPath} (${frameFiles.length} frame(s))`)
}

async function main() {
  const requested = process.argv[2]
  if (requested) {
    await buildSheet(requested)
    return
  }
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await buildSheet(entry.name)
    }
  }
}

main()
