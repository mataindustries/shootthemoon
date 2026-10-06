/**
 * Renders the YouTube film's graphics layer: one transparent 1920x1080 RGBA
 * frame per film frame, from filmScene.ts (youtubeTitles.cues.json is the
 * timing authority), drawn by the reel's own capture/titles/overlay.html with
 * the reel's own fonts. The overlay is reused unmodified: a small extension
 * script draws the film-only vector primitives (boards[]) underneath.
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/youtube/renderYoutubeTitles.mjs [--out=capture-final/youtube/titles] [--jobs=4]
 *       -> <out>/titles-track.mov       9,072 frames, 60 fps, qtrle argb, transparent where nothing is drawn
 *          <out>/titles-manifest.json   inputs, browser, per-frame hashes
 *
 *   ... --determinism=60,500,1500,4300,6200,8900 --out=<dir>
 *       renders each frame twice in fresh pages and fails unless identical
 *
 *   ... --thumbnails --clean=<reel-57s-1080-clean.mp4> --out=<dir>
 *       -> <dir>/thumbnail-0N.jpg (1280x720) from youtube-film.json `thumbnails`
 *
 * The reel's release pin (titlesRelease.json) is deliberately not used: it
 * pins the reel and loop cue sheets. This renderer records its own inputs,
 * browser and frame hashes instead. Set PLAYWRIGHT_CHROMIUM_PATH where the
 * pinned Playwright browser is not installed (capture/README.md).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { sceneAt } from '../titles/titles.ts'
import { drawnFilmFrames, filmSceneAt, resolveFilmCues } from './filmScene.ts'
import { TITLE_RENDER_INPUTS, validateFilm } from './youtubeFilm.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
const out = args.out ?? 'capture-final/youtube/titles'
const jobs = Number(args.jobs ?? 4)
const readJson = (file) => JSON.parse(readFileSync(path.join(repo, file), 'utf8'))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')


const film = readJson('capture/youtube/youtube-film.json')
const cues = readJson('capture/youtube/youtubeTitles.cues.json')
const problems = validateFilm(film, readJson('capture/youtube/media-sources.json'), readJson('capture/finalEdit.json'), cues, readJson('capture/youtube/vo-selects.json'))
if (problems.length > 0) {
  console.error(`youtube-film.json is not safe to render:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
const resolved = resolveFilmCues(cues)

const FONTS = [
  { file: 'Saira-VF.ttf', family: 'Saira', weight: '100 900', extra: 'font-stretch:50% 125%;' },
  { file: 'IBMPlexMono-Light.ttf', family: 'IBM Plex Mono', weight: '300' },
  { file: 'IBMPlexMono-Regular.ttf', family: 'IBM Plex Mono', weight: '400' },
  { file: 'IBMPlexMono-Medium.ttf', family: 'IBM Plex Mono', weight: '500' },
]
const fontDir = path.join(repo, 'capture/titles/fonts')
const fontBytes = Object.fromEntries(FONTS.map((font) => [font.file, readFileSync(path.join(fontDir, font.file))]))
const fontFaces = FONTS.map((font) =>
  `@font-face{font-family:'${font.family}';src:url(data:font/ttf;base64,${fontBytes[font.file].toString('base64')}) format('truetype');font-weight:${font.weight};${font.extra ?? ''}}`).join('\n')

/** Film primitives, drawn into <g id="film"> under the reel overlay's #gfx. No clocks, no animation. */
const FILM_EXTENSION = `<script>
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const base = window.drawScene;
  let film = null;
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); film.appendChild(e); return e; };
  window.drawScene = function (frame, ops, plate) {
    if (film === null) {
      film = document.createElementNS(NS, 'g');
      film.setAttribute('id', 'film');
      const gfx = document.getElementById('gfx');
      gfx.parentNode.insertBefore(film, gfx);
    }
    film.replaceChildren();
    const record = [];
    for (const op of ops) {
      if (op.op === 'fstroke') {
        const p = el('path', { d: op.d, fill: 'none', stroke: op.stroke, 'stroke-width': op.width, 'stroke-opacity': op.opacity, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        if (op.drawn < 1) { const L = p.getTotalLength(); p.setAttribute('stroke-dasharray', L + ' ' + L); p.setAttribute('stroke-dashoffset', String(L * (1 - op.drawn))); }
      } else if (op.op === 'fdot') el('circle', { cx: op.cx, cy: op.cy, r: op.r, fill: op.fill, 'fill-opacity': op.opacity });
      else if (op.op === 'fring') el('circle', { cx: op.cx, cy: op.cy, r: op.r, fill: 'none', stroke: op.stroke, 'stroke-width': op.width, 'stroke-opacity': op.opacity });
      else if (op.op === 'frrect') el('rect', { x: op.x, y: op.y, width: op.w, height: op.h, rx: op.r, ry: op.r, fill: 'none', stroke: op.stroke, 'stroke-width': op.width, 'stroke-opacity': op.opacity });
      else if (op.op === 'frect') el('rect', { x: op.x, y: op.y, width: op.w, height: op.h, fill: op.fill, 'fill-opacity': op.opacity });
      else record.push(op);
    }
    return base(frame, record, plate);
  };
})();
</script>`
const overlay = readFileSync(path.join(repo, 'capture/titles/overlay.html'), 'utf8')
const html = overlay.replace('/*FONTS*/', fontFaces).replace('</body>', `${FILM_EXTENSION}\n</body>`)
const FACE_CHECKS = [...new Set(Object.values(resolved.tokens.style).map((style) => `${style.wght} ${style.size}px '${style.family}'`))]
const { width, height, fps, frames } = resolved.source

async function openStage(browser) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate((config) => window.configureStage(config), { width, height, sigma: resolved.tokens.shadow?.sigma, dy: resolved.tokens.shadow?.dy, alphaFloor: resolved.tokens.alphaFloor })
  await page.evaluate((faces) => Promise.all(faces.map((face) => document.fonts.load(face))), FACE_CHECKS)
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate((faces) => faces.map((face) => [face, document.fonts.check(face)]), FACE_CHECKS)
  const missing = loaded.filter(([, ok]) => !ok).map(([face]) => face)
  if (missing.length > 0) throw new Error(`fonts not loaded (no substitution allowed): ${missing.join(', ')}`)
  const warm = frames - 1
  await page.evaluate(([f, ops]) => window.drawScene(f, ops, null), [warm, filmSceneAt(resolved, warm)])
  return { page, stage: await page.$('#stage') }
}

async function shoot(stage, page, frame, file, ops = filmSceneAt(resolved, frame), plate = null) {
  await page.evaluate(([f, o, p]) => window.drawScene(f, o, p), [frame, ops, plate])
  return stage.screenshot({ path: file, omitBackground: plate === null, animations: 'disabled', caret: 'hide' })
}

async function inParallel(items, count, work) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async (_, worker) => {
    while (next < items.length) {
      const index = next++
      await work(items[index], worker)
    }
  }))
}

/** Thumbnail ops: the end card's wordmark elements, static, at the thumbnail's position and scale. */
function thumbnailOps(thumb) {
  const lockup = { ...resolved, events: [{ id: 'T', name: thumb.id, from: 0, to: 0, elements: thumb.elements }] }
  return sceneAt(lockup, 0)
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
const inputs = Object.fromEntries(TITLE_RENDER_INPUTS.map((file) => [file, sha256(readFileSync(path.join(repo, file)))]))
try {
  mkdirSync(out, { recursive: true })
  if (args.determinism) {
    const list = args.determinism.split(',').map(Number)
    const hashes = []
    for (let pass = 0; pass < 2; pass++) {
      const { page, stage } = await openStage(browser)
      const passHashes = []
      for (const frame of list) passHashes.push(sha256(await shoot(stage, page, frame, path.join(out, `det_${pass}_${frame}.png`))))
      hashes.push(passHashes)
      await page.close()
    }
    const differing = list.filter((_, i) => hashes[0][i] !== hashes[1][i])
    const report = { browser: `chromium ${browser.version()}`, frames: list.map((frame, i) => ({ frame, sha256: hashes[0][i], identical: hashes[0][i] === hashes[1][i] })) }
    writeFileSync(path.join(out, 'determinism.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(report.frames.map((r) => `${r.frame} ${r.sha256.slice(0, 16)} ${r.identical ? 'identical' : 'DIFFERS'}`).join('\n'))
    if (differing.length > 0) throw new Error(`non-deterministic frames: ${differing.join(', ')}`)
    console.log('DETERMINISM VERIFIED')
  } else if (args.preview) {
    // Layout check only: titles over an approximate plate (reel frame, still, or black; picture boards are not composed here).
    if (!args.clean) throw new Error('--preview needs --clean=<reel-57s-1080-clean.mp4>')
    const { page, stage } = await openStage(browser)
    for (const frame of args.preview.split(',').map(Number)) {
      const seg = film.timeline.find((s) => frame >= s.from && frame <= s.to)
      let plate = { black: true }
      const move = resolved.plateMoves.find((m) => frame >= m.from && frame <= m.to)
      const pushed = (file) => ({ href: `data:image/png;base64,${readFileSync(file).toString('base64')}`, scale: move ? move.scale[0] + (move.scale[1] - move.scale[0]) * (frame - move.from) / (move.to - move.from) : 1, ax: move ? move.anchor[0] : width / 2, ay: move ? move.anchor[1] : height / 2 })
      if (seg.source && ('from' in seg.source || 'frame' in seg.source)) {
        const reelFrame = 'from' in seg.source ? seg.source.from + (frame - seg.from) : seg.source.frame
        const plateFile = path.join(out, `plate_${frame}.png`)
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', args.clean, '-vf', `select=eq(n\\,${reelFrame}),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24`, '-frames:v', '1', '-update', '1', plateFile])
        plate = pushed(plateFile)
      } else if (seg.source && 'asset' in seg.source) plate = pushed(path.join(repo, film.assets[seg.source.asset].file))
      await shoot(stage, page, frame, path.join(out, `preview_${String(frame).padStart(4, '0')}.png`), filmSceneAt(resolved, frame), plate)
      console.log(`preview ${frame} (${seg.id})`)
    }
  } else if (args.thumbnails) {
    if (!args.clean) throw new Error('--thumbnails needs --clean=<reel-57s-1080-clean.mp4>')
    const { page, stage } = await openStage(browser)
    const workDir = path.join(out, 'qa', 'thumbnails')
    mkdirSync(workDir, { recursive: true })
    for (const [i, thumb] of film.thumbnails.entries()) {
      const plateFile = path.join(workDir, `${thumb.id}-plate.png`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', args.clean, '-vf', `select=eq(n\\,${thumb.reelFrame}),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24`, '-frames:v', '1', '-update', '1', plateFile])
      const plate = { href: `data:image/png;base64,${readFileSync(plateFile).toString('base64')}`, scale: 1, ax: width / 2, ay: height / 2 }
      const master = path.join(workDir, `${thumb.id}-1920.png`)
      await shoot(stage, page, 0, master, thumbnailOps(thumb), plate)
      const jpg = path.join(out, `thumbnail-${String(i + 1).padStart(2, '0')}.jpg`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', master, '-vf', 'scale=1280:720:flags=lanczos+accurate_rnd', '-q:v', '2', jpg])
      console.log(`thumbnail ${thumb.id}: reel frame ${thumb.reelFrame} -> ${jpg}`)
    }
  } else {
    const started = Date.now()
    const framesDir = path.join(out, 'frames')
    rmSync(framesDir, { recursive: true, force: true })
    mkdirSync(framesDir, { recursive: true })
    const drawn = drawnFilmFrames(resolved)
    const stages = []
    for (let i = 0; i < jobs; i++) stages.push(await openStage(browser))
    const frameHashes = {}
    frameHashes.blank = sha256(await shoot(stages[0].stage, stages[0].page, 0, path.join(framesDir, 'blank.png'), []))
    // Identical draw ops produce identical pixels. Render static holds once;
    // all entrances/exits/counters still render at every distinct state.
    const byOps = new Map()
    const unique = []
    const copies = []
    for (const frame of drawn) {
      const key = JSON.stringify(filmSceneAt(resolved, frame))
      const previous = byOps.get(key)
      if (previous === undefined) { byOps.set(key, frame); unique.push(frame) }
      else copies.push([frame, previous])
    }
    await inParallel(unique, jobs, async (frame, worker) => {
      const name = `${String(frame).padStart(6, '0')}.png`
      frameHashes[frame] = sha256(await shoot(stages[worker].stage, stages[worker].page, frame, path.join(framesDir, name)))
      if (frame % 500 === 0) console.log(`frame ${frame}`)
    })
    for (const [frame, previous] of copies) {
      symlinkSync(`${String(previous).padStart(6, '0')}.png`, path.join(framesDir, `${String(frame).padStart(6, '0')}.png`))
      frameHashes[frame] = frameHashes[previous]
    }
    const drawnSet = new Set(drawn)
    for (let frame = 0; frame < frames; frame++) {
      if (!drawnSet.has(frame)) symlinkSync('blank.png', path.join(framesDir, `${String(frame).padStart(6, '0')}.png`))
    }
    const track = path.join(out, 'titles-track.mov')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-start_number', '0', '-i', path.join(framesDir, '%06d.png'),
      '-frames:v', String(frames), '-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', String(fps), track], { stdio: 'inherit' })
    const manifest = {
      schema: 'shootthemoon.youtube-titles-track/1',
      inputs,
      validatedFilm: sha256(readFileSync(path.join(repo, 'capture/youtube/youtube-film.json'))),
      alpha: 'straight',
      playwright: JSON.parse(readFileSync(path.join(repo, 'node_modules/playwright-core/package.json'), 'utf8')).version,
      browser: `${browser.browserType().name()} ${browser.version()}`,
      fonts: Object.fromEntries(FONTS.map((font) => [font.file, sha256(fontBytes[font.file])])),
      track: { file: 'titles-track.mov', codec: 'qtrle', pixFmt: 'argb', width, height, fps, frames, sha256: sha256(readFileSync(track)) },
      drawnFrames: drawn.length,
      drawnRanges: drawn.reduce((ranges, frame) => {
        const last = ranges[ranges.length - 1]
        if (last && last[1] === frame - 1) last[1] = frame
        else ranges.push([frame, frame])
        return ranges
      }, []),
      blankFrameSha256: frameHashes.blank,
      frameSha256: Object.fromEntries(drawn.map((frame) => [frame, frameHashes[frame]])),
      elapsedSec: Math.round((Date.now() - started) / 1000),
    }
    writeFileSync(path.join(out, 'titles-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`YOUTUBE TITLES RENDERED — ${drawn.length} drawn frames of ${frames}, ${track} (${manifest.elapsedSec}s)`)
  }
} finally {
  await browser.close()
}
