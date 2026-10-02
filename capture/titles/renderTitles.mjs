/**
 * Renders the ORBITAL RECORD titles layer: one transparent 1920x1080 RGBA
 * frame per reel frame, straight from titles.ts sceneAt() (the cue sheet is
 * the timing authority), drawn by overlay.html in Chromium.
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/titles/renderTitles.mjs [--out=capture-final/titles] [--jobs=4]
 *       -> <out>/titles-track.mov   full-length track: 3,456 frames, 60 fps,
 *                                   qtrle argb, transparent where nothing is drawn
 *          <out>/titles-manifest.json
 *
 *   ... renderTitles.mjs --stills=530:plate.png,3455:black --out=<dir>
 *       -> <out>/sf_0530.png ...    a frame over a plate (pushed like the reel)
 *                                   or black, for style-frame comparison
 *
 *   ... renderTitles.mjs --determinism=100,530,850 --out=<dir>
 *       renders each frame twice in fresh pages and fails unless identical
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH where the pinned Playwright browser is not
 * installed (see capture/README.md).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { checkTitlesProvenance, drawnFrames, plateMoveAt, plateScaleAt, sceneAt, TITLES_INPUT_FILES, validateCues } from './titles.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
const out = args.out ?? 'capture-final/titles'
const jobs = Number(args.jobs ?? 4)

const cuesPath = path.join(here, 'reel-titles.cues.json')
const cuesText = readFileSync(cuesPath, 'utf8')
const cues = JSON.parse(cuesText)
const problems = validateCues(cues)
if (problems.length > 0) {
  console.error(`reel-titles.cues.json is not safe to render:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const repo = path.join(here, '..', '..')
const releasePin = JSON.parse(readFileSync(path.join(here, 'titlesRelease.json'), 'utf8'))
const inputHashes = Object.fromEntries(TITLES_INPUT_FILES.map((file) => [file, sha256(readFileSync(path.join(repo, file)))]))
const pinProblems = checkTitlesProvenance(releasePin, inputHashes)
const playwrightVersion = JSON.parse(readFileSync(path.join(repo, 'node_modules/playwright-core/package.json'), 'utf8')).version
if (playwrightVersion !== releasePin.playwright) pinProblems.push(`Playwright ${playwrightVersion}, pinned ${releasePin.playwright}`)
if (pinProblems.length > 0) throw new Error(pinProblems.join('\n'))
const FONTS = [
  { file: 'Saira-VF.ttf', family: 'Saira', weight: '100 900', extra: 'font-stretch:50% 125%;' },
  { file: 'IBMPlexMono-Light.ttf', family: 'IBM Plex Mono', weight: '300' },
  { file: 'IBMPlexMono-Regular.ttf', family: 'IBM Plex Mono', weight: '400' },
  { file: 'IBMPlexMono-Medium.ttf', family: 'IBM Plex Mono', weight: '500' },
]
const fontBytes = Object.fromEntries(FONTS.map((font) => [font.file, readFileSync(path.join(here, 'fonts', font.file))]))
const fontFaces = FONTS.map((font) =>
  `@font-face{font-family:'${font.family}';src:url(data:font/ttf;base64,${fontBytes[font.file].toString('base64')}) format('truetype');font-weight:${font.weight};${font.extra ?? ''}}`).join('\n')
const html = readFileSync(path.join(here, 'overlay.html'), 'utf8').replace('/*FONTS*/', fontFaces)
/** Every face and weight the cue sheet's styles use, at their sizes. */
const FACE_CHECKS = [...new Set(Object.values(cues.tokens.style).map((style) => `${style.wght} ${style.size}px '${style.family}'`))]

async function openStage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate((faces) => Promise.all(faces.map((face) => document.fonts.load(face))), FACE_CHECKS)
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate((faces) => faces.map((face) => [face, document.fonts.check(face)]), FACE_CHECKS)
  const missing = loaded.filter(([, ok]) => !ok).map(([face]) => face)
  if (missing.length > 0) throw new Error(`fonts not loaded (no substitution allowed): ${missing.join(', ')}`)
  // Warm text layout so the first measured frame is stable.
  await page.evaluate(([f, ops]) => window.drawScene(f, ops, null), [3455, sceneAt(cues, 3455)])
  return { page, stage: await page.$('#stage') }
}

async function shoot(stage, page, frame, file, plate = null) {
  await page.evaluate(([f, ops, p]) => window.drawScene(f, ops, p), [frame, sceneAt(cues, frame), plate])
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

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
try {
  if (browser.version() !== releasePin.chromium) throw new Error(`Chromium ${browser.version()}, pinned ${releasePin.chromium}`)
  mkdirSync(out, { recursive: true })
  if (args.stills) {
    const { page, stage } = await openStage(browser)
    for (const spec of args.stills.split(',')) {
      const [f, source] = spec.split(':')
      const frame = Number(f)
      let plate = { black: true }
      if (source !== 'black') {
        const move = plateMoveAt(cues, frame)
        plate = {
          href: `data:image/png;base64,${readFileSync(source).toString('base64')}`,
          scale: move ? plateScaleAt(move, frame) : 1,
          ax: move ? move.anchor[0] : 960,
          ay: move ? move.anchor[1] : 540,
        }
      }
      await shoot(stage, page, frame, path.join(out, `sf_${String(frame).padStart(4, '0')}.png`), plate)
      console.log(`still ${frame}`)
    }
  } else if (args.determinism) {
    const frames = args.determinism.split(',').map(Number)
    const hashes = []
    for (let pass = 0; pass < 2; pass++) {
      const { page, stage } = await openStage(browser)
      const passHashes = []
      // One page draws one frame at a time: drawScene and its screenshot must not interleave.
      for (const frame of frames) passHashes.push(sha256(await shoot(stage, page, frame, path.join(out, `det_${pass}_${frame}.png`))))
      hashes.push(passHashes)
      await page.close()
    }
    const differing = frames.filter((_, i) => hashes[0][i] !== hashes[1][i])
    if (new Set(hashes[0]).size !== frames.length) throw new Error('distinct frames rendered identical images')
    console.log(frames.map((frame, i) => `${frame} ${hashes[0][i].slice(0, 16)} ${hashes[0][i] === hashes[1][i] ? 'identical' : 'DIFFERS'}`).join('\n'))
    if (differing.length > 0) throw new Error(`non-deterministic frames: ${differing.join(', ')}`)
    console.log('DETERMINISM VERIFIED')
  } else {
    const started = Date.now()
    const framesDir = path.join(out, 'frames')
    rmSync(framesDir, { recursive: true, force: true })
    mkdirSync(framesDir, { recursive: true })
    const drawn = drawnFrames(cues)
    const stages = []
    for (let i = 0; i < jobs; i++) stages.push(await openStage(browser))
    const frameHashes = {}
    const blankFile = path.join(framesDir, 'blank.png')
    frameHashes.blank = sha256(await shoot(stages[0].stage, stages[0].page, 0, blankFile))
    await inParallel(drawn, jobs, async (frame, worker) => {
      const name = `${String(frame).padStart(6, '0')}.png`
      frameHashes[frame] = sha256(await shoot(stages[worker].stage, stages[worker].page, frame, path.join(framesDir, name)))
      if (frame % 100 === 0) console.log(`frame ${frame}`)
    })
    const drawnSet = new Set(drawn)
    for (let frame = 0; frame < cues.source.frames; frame++) {
      if (!drawnSet.has(frame)) symlinkSync('blank.png', path.join(framesDir, `${String(frame).padStart(6, '0')}.png`))
    }
    const track = path.join(out, 'titles-track.mov')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(cues.source.fps), '-start_number', '0', '-i', path.join(framesDir, '%06d.png'),
      '-frames:v', String(cues.source.frames), '-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', String(cues.source.fps), track], { stdio: 'inherit' })
    const manifest = {
      schema: 'shootthemoon.reel-titles-track/1',
      inputs: inputHashes,
      alpha: 'straight',
      playwright: playwrightVersion,
      cues: { file: 'capture/titles/reel-titles.cues.json', sha256: sha256(cuesText), status: cues.status },
      fonts: Object.fromEntries(FONTS.map((font) => [font.file, sha256(fontBytes[font.file])])),
      browser: `${browser.browserType().name()} ${browser.version()}`,
      track: { file: 'titles-track.mov', codec: 'qtrle', pixFmt: 'argb', fps: cues.source.fps, frames: cues.source.frames, sha256: sha256(readFileSync(track)) },
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
    console.log(`TITLES RENDERED — ${drawn.length} drawn frames of ${cues.source.frames}, ${track} (${manifest.elapsedSec}s)`)
  }
} finally {
  await browser.close()
}
