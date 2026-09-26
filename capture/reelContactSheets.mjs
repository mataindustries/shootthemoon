#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Reel-level (multi-shot) contact sheets, grouped by editorial metadata from
 * the typed manifest (capture/manifest.ts) rather than by hand — adding a
 * shot to SHOTS automatically slots it into the right group here.
 *
 * This is separate from capture/contactSheet.mjs (one sheet per shot, zero
 * imports) because grouping needs the Shot.editorial metadata that only
 * lives in the manifest, not in a shot's own capture.json. Run after
 * capture.spec.ts has populated capture-output/<shot-id>/.
 *
 * Requires Node's native TypeScript support to import manifest.ts directly
 * (no build step, no ts-node/tsx dependency):
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/reelContactSheets.mjs
 *
 * Output (all under the already-gitignored capture-output/, same
 * temporary-output convention contactSheet.mjs already uses):
 *   capture-output/reel-sheets/act-<ACT_ID>.html        (one per act)
 *   capture-output/reel-sheets/monument-match-cut.html
 *   capture-output/reel-sheets/first-strike-candidates.html
 *   capture-output/reel-sheets/counterstrike-candidates.html
 *   capture-output/reel-sheets/divider-candidates.html
 *   capture-output/reel-sheets/mobile-proof.html
 *   capture-output/reel-sheets/storyboard.html            (full edit order)
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SHOTS } from './manifest.ts'

const OUTPUT_ROOT = 'capture-output'
const SHEETS_DIR = path.join(OUTPUT_ROOT, 'reel-sheets')

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

async function loadCapture(shotId) {
  const shotDir = path.join(OUTPUT_ROOT, shotId)
  try {
    const metadata = JSON.parse(await readFile(path.join(shotDir, 'capture.json'), 'utf8'))
    const frames = (await readdir(path.join(shotDir, 'frames')).catch(() => []))
      .filter((name) => name.endsWith('.png'))
      .sort()
    return { metadata, frames }
  } catch {
    return { metadata: null, frames: [] }
  }
}

function metaRow(label, value) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

async function shotSection(shot) {
  const { metadata, frames } = await loadCapture(shot.id)
  const shotDir = path.join('..', shot.id)
  const status = metadata === null ? '⚠ NOT CAPTURED YET' : `${frames.length} frame(s) captured`
  const tiles = frames
    .map(
      (file, index) => `
      <figure>
        <img src="${path.join(shotDir, 'frames', file)}" loading="lazy" alt="${escapeHtml(shot.id)} frame ${index}" />
        <figcaption>${escapeHtml(shot.id)} · ${escapeHtml(file)}</figcaption>
      </figure>`,
    )
    .join('\n')

  return `
  <section class="shot priority-${shot.editorial.priority.toLowerCase()}">
    <h2>#${shot.editorial.order} · ${escapeHtml(shot.name)} <span class="badge">${escapeHtml(shot.editorial.priority)}</span></h2>
    <p class="status">${escapeHtml(status)}</p>
    <table class="meta">
      ${metaRow('shot id', shot.id)}
      ${metaRow('act', shot.editorial.act)}
      ${metaRow('profile', shot.profile)}
      ${metaRow('fixture', shot.fixture)}
      ${metaRow('working timecode', shot.editorial.workingTimecode)}
      ${metaRow('intended edited duration', `${shot.editorial.editedDurationS}s`)}
      ${metaRow('setup actions', shot.editorial.setupActions)}
      ${metaRow('state assertion', shot.editorial.stateAssertion)}
      ${metaRow('capture method', shot.editorial.captureMethod)}
      ${metaRow('capture window', shot.editorial.captureWindow)}
      ${metaRow('crop/reframe guidance', shot.editorial.cropGuidance)}
      ${metaRow('audio note', shot.editorial.audioNote)}
      ${metaRow('edit note', shot.editorial.editNote)}
      ${metaRow('notes', shot.notes)}
    </table>
    <div class="grid">${tiles || '<p class="empty">No frames on disk — run capture.spec.ts first.</p>'}</div>
  </section>`
}

async function writeSheet(filename, title, shots) {
  await mkdir(SHEETS_DIR, { recursive: true })
  const sections = (await Promise.all(shots.map(shotSection))).join('\n')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { background: #111; color: #eee; font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .subtitle { color: #999; font-size: 13px; margin: 0 0 24px; }
  section.shot { background: #181818; border-radius: 8px; padding: 16px; margin-bottom: 24px; border-left: 4px solid #555; }
  section.priority-required { border-left-color: #4c8dff; }
  section.priority-alt { border-left-color: #d9a441; }
  section.priority-optional { border-left-color: #888; }
  .badge { font-size: 10px; letter-spacing: .05em; padding: 2px 6px; border-radius: 3px; background: #333; color: #ccc; vertical-align: middle; }
  .status { font-size: 12px; color: #9adb9a; margin: 0 0 10px; }
  table.meta { border-collapse: collapse; font-size: 12px; margin-bottom: 12px; width: 100%; }
  table.meta th { text-align: left; color: #888; padding: 2px 10px 2px 0; vertical-align: top; white-space: nowrap; }
  table.meta td { color: #ddd; padding: 2px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  figure { margin: 0; background: #1b1b1b; border-radius: 6px; overflow: hidden; }
  figure img { width: 100%; display: block; background: #000; }
  figcaption { font-size: 10px; padding: 4px 6px; color: #999; }
  .empty { color: #a55; font-size: 12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${shots.length} shot(s) · generated from capture/manifest.ts editorial metadata</p>
  ${sections}
</body>
</html>
`
  const sheetPath = path.join(SHEETS_DIR, filename)
  await writeFile(sheetPath, html)
  console.log(`Wrote ${sheetPath} (${shots.length} shot(s))`)
}

const ACT_TITLES = {
  ACT_I_ARRIVAL: 'Act I — Arrival',
  ACT_II_THE_RIVAL: 'Act II — The Rival',
  ACT_III_FIRST_STRIKE: 'Act III — First Strike',
  ACT_IV_SHE_ANSWERED: 'Act IV — She Answered',
  ACT_V_THIRD_PARTY: 'Act V — Third Party',
  ACT_VI_THE_CLAIM: 'Act VI — The Claim',
}

async function main() {
  const byOrder = [...SHOTS].sort((a, b) => a.editorial.order - b.editorial.order)

  // 1. One contact sheet per act.
  for (const [act, title] of Object.entries(ACT_TITLES)) {
    const shots = byOrder.filter((shot) => shot.editorial.act === act)
    await writeSheet(`act-${act}.html`, title, shots)
  }

  // 2. Monument match-cut sheet (the 4-kind triptychs + the final wide).
  const monumentIds = new Set([
    'helios-reveal', 'helios-mechanical-peak', 'helios-held-hero',
    'signal-array-early-reveal', 'signal-array-mechanical-peak', 'signal-array-held-hero',
    'crater-crown-early-reveal', 'crater-crown-mechanical-peak', 'crater-crown-held-hero-scar',
    'bastion-early-reveal', 'bastion-mechanical-peak', 'bastion-held-hero',
    'final-claimed-moon-wide',
  ])
  await writeSheet(
    'monument-match-cut.html',
    'Monument match-cut — Helios / Signal Array / Crater Crown / Bastion',
    byOrder.filter((shot) => monumentIds.has(shot.id)),
  )

  // 3-5. First Strike / Counterstrike / DIVIDER candidate sheets.
  await writeSheet(
    'first-strike-candidates.html',
    'First Strike — candidate sheet',
    byOrder.filter((shot) => shot.id.startsWith('first-strike-')),
  )
  await writeSheet(
    'counterstrike-candidates.html',
    'Counterstrike — candidate sheet',
    byOrder.filter((shot) => shot.id.startsWith('counterstrike-')),
  )
  await writeSheet(
    'divider-candidates.html',
    'DIVIDER — candidate sheet',
    byOrder.filter((shot) => shot.id.startsWith('divider-')),
  )

  // 6. Mobile-proof sheet — every PORT-profile shot.
  await writeSheet(
    'mobile-proof.html',
    'Mobile-proof sheet — real PORT captures',
    byOrder.filter((shot) => shot.profile === 'PORT'),
  )

  // 7. Complete storyboard, full proposed edit order.
  await writeSheet('storyboard.html', 'Complete storyboard — proposed edit order', byOrder)
}

main()
