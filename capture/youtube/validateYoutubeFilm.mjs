/**
 * QA for the assembled YouTube film. Every check reads the delivered files.
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/youtube/validateYoutubeFilm.mjs \
 *       --clean=<reel-57s-1080-clean.mp4> --titled=<reel-57s-1080.mp4> [--out=capture-final/youtube]
 *
 * Writes <out>/qa/: qa-report.json, contact-sheet.jpg (the whole film),
 * readability-480.jpg and readability-1080/ (every graphic at its hold),
 * timeline.md. Exits non-zero if any check fails.
 *
 * Checks:
 *  - format: H.264 High, 1920x1080, 60/1, exactly 9,072 frames, yuv420p,
 *    BT.709 limited-range tags, moov before mdat (faststart), no audio stream;
 *  - picture fidelity: every reel/hold/still frame of the picture lock matches
 *    its planned clean source (luma 192x108), and wherever the titled reel
 *    differs from the clean one, the film is the clean frame (no titled pixels);
 *  - cuts: every cut changes picture (no accidental repeat at a boundary);
 *  - titles: decoded alpha is zero on every protected and undeclared frame,
 *    present wherever a graphic is declared, and inside the 40 px safe frame;
 *  - composite: wherever the title alpha is zero the first cut equals the picture lock;
 *  - luma range inside BT.709 limited range;
 *  - provenance: the assembly manifest pins the clean reel, assets and title inputs.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawnFilmFrames, filmSceneAt, resolveFilmCues } from './filmScene.ts'
import { mediaById, titledAlterations } from './mediaPriority.ts'
import { TITLE_RENDER_INPUTS, validateFilm } from './youtubeFilm.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
if (!args.clean || !args.titled) throw new Error('usage: --clean=<reel-57s-1080-clean.mp4> --titled=<reel-57s-1080.mp4> [--out=...]')
const out = path.resolve(args.out ?? 'capture-final/youtube')
const qa = path.join(out, 'qa')
mkdirSync(path.join(qa, 'readability-1080'), { recursive: true })
const readJson = (file) => JSON.parse(readFileSync(path.join(repo, file), 'utf8'))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const fileSha = (file) => sha256(readFileSync(file))

const film = readJson('capture/youtube/youtube-film.json')
const sources = readJson('capture/youtube/media-sources.json')
const cues = readJson('capture/youtube/youtubeTitles.cues.json')
const resolved = resolveFilmCues(cues)
const { frames: FRAMES, fps: FPS } = film.output
const firstCut = path.join(out, 'shoot-the-moon-youtube-first-cut.mp4')
const pictureLock = path.join(out, 'clean-picture-lock.mp4')
const titleTrack = path.join(out, 'titles', 'titles-track.mov')
const report = { schema: 'shootthemoon.youtube-film-qa/1', checks: {}, failures: [] }
const check = (name, ok, detail) => {
  report.checks[name] = { ok, ...detail }
  if (!ok) report.failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

// --- edit decision and provenance -------------------------------------------------
const filmProblems = validateFilm(film, sources, readJson('capture/finalEdit.json'), cues)
check('edit decision validates (clean sources only, protected frames, VO pace)', filmProblems.length === 0, { problems: filmProblems })
const manifest = JSON.parse(readFileSync(path.join(out, 'assembly-manifest.json'), 'utf8'))
const titlesManifest = JSON.parse(readFileSync(path.join(out, 'titles', 'titles-manifest.json'), 'utf8'))
const reelClean = mediaById(sources, 'reel-clean')
const reelTitled = mediaById(sources, 'reel-titled')
const provenance = []
if (fileSha(args.clean) !== reelClean.sha256) provenance.push('--clean is not reel-clean')
if (fileSha(args.titled) !== reelTitled.sha256) provenance.push('--titled is not reel-titled (reference only, used here to prove absence)')
if (manifest.sources.reelClean.sha256 !== reelClean.sha256) provenance.push('assembly did not read reel-clean')
if (manifest.film.sha256 !== fileSha(path.join(repo, 'capture/youtube/youtube-film.json'))) provenance.push('youtube-film.json changed since assembly')
for (const file of TITLE_RENDER_INPUTS) if (titlesManifest.inputs[file] !== fileSha(path.join(repo, file))) provenance.push(`title input changed since render: ${file}`)
if (titlesManifest.track.sha256 !== fileSha(titleTrack)) provenance.push('title track differs from its manifest')
if (manifest.outputs.firstCut.sha256 !== fileSha(firstCut)) provenance.push('first cut differs from the assembly manifest')
if (manifest.outputs.pictureLock.sha256 !== fileSha(pictureLock)) provenance.push('picture lock differs from the assembly manifest')
for (const [id, asset] of Object.entries(film.assets)) if (fileSha(path.join(repo, asset.file)) !== asset.sha256) provenance.push(`asset ${id} changed`)
check('provenance: every source and output pinned by sha256', provenance.length === 0, { problems: provenance, firstCut: manifest.outputs.firstCut, pictureLock: manifest.outputs.pictureLock, titleTrack: titlesManifest.track })

// --- format -----------------------------------------------------------------------
function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,nb_read_packets:format=duration', '-of', 'json', file]).toString())
  const buf = readFileSync(file)
  const moov = buf.indexOf('moov'), mdat = buf.indexOf('mdat')
  return { streams: j.streams, duration: Number(j.format.duration), faststart: moov > 0 && moov < mdat }
}
for (const [name, file] of [['first cut', firstCut], ['picture lock', pictureLock]]) {
  const p = probe(file)
  const v = p.streams.filter((s) => s.codec_type === 'video')
  const a = p.streams.filter((s) => s.codec_type === 'audio')
  const s = v[0] ?? {}
  const ok = v.length === 1 && a.length === 0 && s.codec_name === 'h264' && s.profile === 'High' && s.width === 1920 && s.height === 1080 && s.r_frame_rate === '60/1' &&
    Number(s.nb_read_packets) === FRAMES && s.pix_fmt === 'yuv420p' && s.color_range === 'tv' && s.color_space === 'bt709' && s.color_transfer === 'bt709' && s.color_primaries === 'bt709' &&
    Math.abs(p.duration - FRAMES / FPS) < 0.02 && p.faststart
  check(`format: ${name} is H.264 High 1080p60, ${FRAMES} frames, BT.709 tv, faststart, silent`, ok, { stream: s, audioStreams: a.length, durationS: p.duration, faststart: p.faststart })
}

// --- decode helpers ---------------------------------------------------------------
const TW = 192, TH = 108, TS = TW * TH
function grayFrames(file, vf = '') {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${vf}${vf ? ',' : ''}scale=${TW}:${TH}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(`decode failed: ${file}\n${r.stderr}`)
  return r.stdout
}
const diff = (a, ai, b, bi) => { let s = 0; for (let k = 0; k < TS; k++) s += Math.abs(a[ai * TS + k] - b[bi * TS + k]); return s / TS }
const pic = grayFrames(pictureLock)
const cut = grayFrames(firstCut)
const cleanReel = grayFrames(args.clean)
const titledReel = grayFrames(args.titled)
if (pic.length !== FRAMES * TS || cut.length !== FRAMES * TS) throw new Error('decoded frame count mismatch')

// --- picture fidelity ---------------------------------------------------------------
const fidelity = []
const titledWindows = titledAlterations(JSON.parse(readFileSync(path.join(repo, 'capture/titles/reel-titles.cues.json'), 'utf8')))
let titledProbes = 0, titledHits = 0
for (const seg of film.timeline) {
  if (seg.kind !== 'reel' && seg.kind !== 'hold') continue
  let worst = 0
  for (let f = seg.from; f <= seg.to; f++) {
    // A pushed hold is compared on its first frame only (scale 1.000); later frames are deliberately moved.
    if (seg.push !== undefined && f > seg.from) break
    const src = seg.kind === 'reel' ? seg.source.from + (f - seg.from) : seg.source.frame
    const d = diff(pic, f, cleanReel, src)
    worst = Math.max(worst, d)
    if (titledWindows.some((w) => src >= w.from && src <= w.to)) {
      const dTitled = diff(pic, f, titledReel, src)
      if (diff(cleanReel, src, titledReel, src) > 0.3) {
        titledProbes++
        if (dTitled <= d) titledHits++
      }
    }
  }
  fidelity.push({ segment: seg.id, shot: seg.shot, worstMeanLumaDiff: Number(worst.toFixed(3)) })
}
const fidelityFail = fidelity.filter((r) => r.worstMeanLumaDiff > 1.5)
check('picture fidelity: every reel/hold frame is its planned clean-reel frame (mean |Δluma| ≤ 1.5 at 192x108)', fidelityFail.length === 0, { segments: fidelity })
check('no titled pixels: where the titled reel differs, every film frame is closer to the clean frame', titledProbes > 0 && titledHits === 0, { framesCompared: titledProbes, framesCloserToTitled: titledHits })

// Stills: first frame against the pinned PNG.
const stillRows = []
for (const seg of film.timeline.filter((s) => s.kind === 'still')) {
  const png = path.join(repo, film.assets[seg.source.asset].file)
  const ref = grayFrames(png, 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p')
  stillRows.push({ segment: seg.id, asset: seg.source.asset, firstFrameMeanLumaDiff: Number(diff(pic, seg.from, ref, 0).toFixed(3)) })
}
check('stills: first frame of each capture matches its pinned PNG', stillRows.every((r) => r.firstFrameMeanLumaDiff < 2.5), { stills: stillRows })

// --- cuts ---------------------------------------------------------------------------
const cuts = []
for (let i = 1; i < film.timeline.length; i++) {
  const a = film.timeline[i - 1], b = film.timeline[i]
  const d = diff(pic, a.to, pic, b.from)
  cuts.push({ at: b.from, from: a.id, to: b.id, meanLumaDiff: Number(d.toFixed(3)) })
}
// Cutting into black (a card, or the end card out of a dip) may be black on both sides; every other cut must change picture.
const sameAtCut = cuts.filter((c) => c.meanLumaDiff < 0.25 && film.timeline.find((s) => s.id === c.to).kind !== 'black')
check('cuts: every cut changes picture (no repeated frame across a boundary)', sameAtCut.length === 0, { cuts, repeated: sameAtCut })

// --- titles alpha -------------------------------------------------------------------
function alphaStats(file) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'alphaextract,signalstats,bbox=min_val=1,metadata=print:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 })
  const text = r.stdout.toString()
  const stats = []
  let current = null
  for (const line of text.split('\n')) {
    const frame = /^frame:(\d+)/.exec(line)
    if (frame) { current = { frame: Number(frame[1]), max: 0, box: null }; stats.push(current); continue }
    const max = /lavfi\.signalstats\.YMAX=(\d+)/.exec(line)
    if (max && current) current.max = Number(max[1])
    const box = /lavfi\.bbox\.(x1|y1|x2|y2)=(\d+)/.exec(line)
    if (box && current) { current.box ??= {}; current.box[box[1]] = Number(box[2]) }
  }
  return stats
}
const alpha = alphaStats(titleTrack)
const drawn = new Set(drawnFilmFrames(resolved))
const alphaProblems = []
const SAFE = { x0: 40, y0: 40, x1: 1880, y1: 1040 }
const unsafe = []
if (alpha.length !== FRAMES) alphaProblems.push(`decoded ${alpha.length} alpha frames, expected ${FRAMES}`)
for (const a of alpha) {
  const protectedFrame = film.protected.find((r) => a.frame >= r.from && a.frame <= r.to)
  if ((protectedFrame || !drawn.has(a.frame)) && a.max !== 0) alphaProblems.push(`frame ${a.frame}: alpha ${a.max} on a ${protectedFrame ? `protected frame (${protectedFrame.why})` : 'frame with nothing declared'}`)
  const visible = filmSceneAt(resolved, a.frame).some((op) => ('fillOpacity' in op ? op.fillOpacity : 'strokeOpacity' in op ? op.strokeOpacity : 'opacity' in op ? op.opacity : 1) >= 0.05)
  if (visible && a.max === 0) alphaProblems.push(`frame ${a.frame}: declared graphic is missing`)
  if (a.box && (a.box.x1 < SAFE.x0 || a.box.y1 < SAFE.y0 || a.box.x2 > SAFE.x1 || a.box.y2 > SAFE.y1)) unsafe.push({ frame: a.frame, box: a.box })
}
const protectedMax = film.protected.map((r) => ({ ...r, maxAlpha: Math.max(0, ...alpha.filter((a) => a.frame >= r.from && a.frame <= r.to).map((a) => a.max)) }))
check('titles: zero alpha on every protected and undeclared frame; every declared graphic drawn', alphaProblems.length === 0, { protected: protectedMax, problems: alphaProblems.slice(0, 50), drawnFrames: drawn.size })
const unsafeRuns = []
for (const u of unsafe) {
  const last = unsafeRuns[unsafeRuns.length - 1]
  if (last && last.to === u.frame - 1) { last.to = u.frame; last.x1 = Math.min(last.x1, u.box.x1); last.y1 = Math.min(last.y1, u.box.y1); last.x2 = Math.max(last.x2, u.box.x2); last.y2 = Math.max(last.y2, u.box.y2) }
  else unsafeRuns.push({ from: u.frame, to: u.frame, ...u.box })
}
check('titles: nothing clipped or outside the 40 px safe frame', unsafe.length === 0, { safe: SAFE, outsideRuns: unsafeRuns })

// --- composite -------------------------------------------------------------------------
let compositeWorst = 0
for (const a of alpha) if (a.max === 0) compositeWorst = Math.max(compositeWorst, diff(cut, a.frame, pic, a.frame))
check('composite: where the title alpha is zero, the first cut equals the picture lock', compositeWorst < 1.0, { worstMeanLumaDiff: Number(compositeWorst.toFixed(3)) })

// --- luma range ----------------------------------------------------------------------------
// Levels are judged on the lossless picture (work/picture.mkv, before the delivery encode) so codec ringing at sharp
// text edges is not mistaken for a range error. The approved clean reel itself carries super-black/white, so:
//  - unpushed reel frames must carry exactly their source frame's Y range (proof that nothing converted range);
//  - pushed holds are resampled pictures, clamped to legal range 16-235 like every generated frame;
//  - frames this pipeline generates (captures, boards, cards) sit inside BT.709 limited range 16-235;
//  - the delivered first cut's black level is exactly 16 on the black cards before their text appears.
function lumaRange(file) {
  const text = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 }).stdout.toString()
  const rows = []
  let cur = null
  for (const line of text.split('\n')) {
    const fr = /^frame:(\d+)/.exec(line)
    if (fr) { cur = { frame: Number(fr[1]) }; rows.push(cur); continue }
    const lo = /signalstats\.YMIN=(\d+)/.exec(line); if (lo && cur) cur.min = Number(lo[1])
    const hi = /signalstats\.YMAX=(\d+)/.exec(line); if (hi && cur) cur.max = Number(hi[1])
  }
  return rows
}
const losslessPicture = path.join(out, 'work', 'picture.mkv')
if (!existsSync(losslessPicture)) check('BT.709 limited range (lossless picture)', false, { problem: `${losslessPicture} is missing: re-run the assembler without --remove-work` })
else {
  const picY = lumaRange(losslessPicture)
  const sourceY = lumaRange(args.clean)
  const reelMismatch = [], pushedWide = [], generated = []
  for (const seg of film.timeline) {
    for (let f = seg.from; f <= seg.to; f++) {
      const y = picY[f]
      if (seg.kind === 'reel' || seg.kind === 'hold') {
        const src = sourceY[seg.kind === 'reel' ? seg.source.from + (f - seg.from) : seg.source.frame]
        if (seg.push === undefined) { if (y.min !== src.min || y.max !== src.max) reelMismatch.push({ frame: f, segment: seg.id, picture: [y.min, y.max], source: [src.min, src.max] }) }
        // A push resamples (ringing on thin UI text), so every pushed picture is clamped to legal range by the assembler.
        else if (y.min < 16 || y.max > 235) pushedWide.push({ frame: f, segment: seg.id, picture: [y.min, y.max], source: [src.min, src.max] })
      } else if (y.min < 16 || y.max > 235) generated.push({ frame: f, segment: seg.id, y: [y.min, y.max] })
    }
  }
  const cutY = lumaRange(firstCut)
  const blackProbe = film.timeline.filter((s) => s.kind === 'black').map((s) => {
    const firstDrawn = [...drawn].filter((f) => f >= s.from && f <= s.to).sort((a, b) => a - b)[0] ?? s.to + 1
    const frames = cutY.slice(s.from, Math.min(firstDrawn, s.to + 1))
    return { segment: s.id, frames: frames.length, ymin: Math.min(...frames.map((r) => r.min)), ymax: Math.max(...frames.map((r) => r.max)) }
  }).filter((b) => b.frames > 0)
  const blackOk = blackProbe.every((b) => b.ymin >= 15 && b.ymax <= 17)
  check('BT.709 limited range: unpushed reel frames carry their source levels exactly; pushed and generated frames inside 16-235; black at 16', reelMismatch.length === 0 && pushedWide.length === 0 && generated.length === 0 && blackOk, {
    reelLevelMismatch: reelMismatch.slice(0, 20), pushedHoldsOutsideLegal: pushedWide.slice(0, 20),
generatedOutside: generated.slice(0, 20), blackLevel: blackProbe,
    sourceExcursions: { framesBelow16: sourceY.filter((r) => r.min < 16).length, framesAbove235: sourceY.filter((r) => r.max > 235).length, note: 'present in the approved clean reel itself; carried through unchanged' },
    deliveredFirstCut: { ymin: Math.min(...cutY.map((r) => r.min)), ymax: Math.max(...cutY.map((r) => r.max)), note: 'includes source excursions and normal H.264 ringing at sharp title edges' },
  })
}

// --- contact sheet and readability -------------------------------------------------------------
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', firstCut, '-vf', `select='not(mod(n\\,60))',scale=240:135:flags=lanczos,drawtext=fontfile='${path.join(repo, 'capture/titles/fonts/IBMPlexMono-Regular.ttf')}':text='%{eif\\:n*60\\:d}':x=4:y=4:fontsize=11:fontcolor=yellow,tile=8x19:padding=4:color=0x202020`, '-frames:v', '1', '-q:v', '3', path.join(qa, 'contact-sheet.jpg')])
const holds = resolved.events.map((ev) => {
  // The fully built frame: the last frame before the event's first exit begins (or its last frame).
  const exits = ev.elements.flatMap((el) => (el.out ? [el.out.f] : []))
  return { id: ev.id, frame: Math.min(ev.to, exits.length > 0 ? Math.min(...exits) - 1 : ev.to) }
})
for (const h of holds) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', firstCut, '-vf', `select=eq(n\\,${h.frame})`, '-frames:v', '1', '-update', '1', path.join(qa, 'readability-1080', `${h.id}-${h.frame}.png`)])
}
const sel = holds.map((h) => `eq(n\\,${h.frame})`).join('+')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', firstCut, '-vf', `select='${sel}',scale=480:270:flags=area,tile=4x${Math.ceil(holds.length / 4)}:padding=6:color=0x303030`, '-frames:v', '1', '-q:v', '2', path.join(qa, 'readability-480.jpg')])
report.readability = { note: 'every graphic at its most complete frame, at 1080p (readability-1080/) and downscaled to 480x270 (readability-480.jpg): reviewed by eye', frames: holds }

// --- timeline -------------------------------------------------------------------------------------------
const tc = (f) => { const s = f / FPS; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}` }
writeFileSync(path.join(qa, 'timeline.md'), ['| Segment | Act | Film frames | Time | Source |', '|---|---|---|---|---|',
  ...film.timeline.map((s) => `| ${s.id} ${s.shot ?? s.board ?? s.kind} | ${s.act} | ${s.from}–${s.to} | ${tc(s.from)}–${tc(s.to + 1)} | ${s.source ? JSON.stringify(s.source) : (s.board ?? 'black')} |`)].join('\n') + '\n')

report.ok = report.failures.length === 0
writeFileSync(path.join(qa, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(report.ok ? 'QA PASSED' : `QA FAILED: ${report.failures.join('; ')}`)
process.exit(report.ok ? 0 : 1)
