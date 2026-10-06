/**
 * Assembles the YouTube film from youtube-film.json: clean reel frames, the
 * four pinned captures and the pinned repo evidence for the picture, the
 * rendered title track and selected original narration.
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/youtube/assembleYoutubeFilm.mjs \
 *       --clean=<reel-57s-1080-clean.mp4> \
 *       --titles=capture-final/youtube/titles/titles-track.mov \
 *       [--out=capture-final/youtube] [--work=capture-final/youtube/work] [--remove-work]
 *     --picture-only   builds and encodes the clean picture lock alone (no title track needed)
 *     --adopt-work     reuse segments already in --work that predate fingerprints (an interrupted run of this same code)
 *
 * Segments are cached in --work by a fingerprint of everything that shapes their pixels (kind, source, frames,
 * push, board, asset and clean-reel hashes): a re-run rebuilds only what changed. --remove-work deletes the cache.
 *
 *   -> <out>/clean-picture-lock.mp4                picture only, no graphics (for VO recording and review)
 *      <out>/shoot-the-moon-vo-picture-lock.mp4     picture + ORBITAL RECORD graphics + narration
 *      <out>/voiceover-script.txt, music-cue-sheet.json, assembly-manifest.json
 *      <out>/qa/vo-reference-960.mp4                TEMPORARY narration reference (never the master)
 *
 * Fails closed: the edit must validate (validateFilm: clean sources only,
 * baked transitions with their neighbours, graphics off protected frames), the
 * clean reel and every asset must match their pinned sha256, and the title
 * track must come from the current cue sheet and renderer. Every picture
 * segment is built losslessly (x264 qp 0) and its frame count checked before
 * the single delivery encode, which uses the reel's own hero settings.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aacArgs, parseEncode, x264Args } from '../ci/assembly.ts'
import { platePushFilter, titlesOverlayChains } from '../titles/titles.ts'
import { TITLE_RENDER_INPUTS, validateFilm } from './youtubeFilm.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
const out = path.resolve(args.out ?? 'capture-final/youtube')
const work = path.resolve(args.work ?? path.join(out, 'work'))
const pictureOnly = args['picture-only'] === 'true'
if (!args.clean || (!args.titles && !pictureOnly)) throw new Error('usage: --clean=<reel-57s-1080-clean.mp4> --titles=<titles-track.mov> | --picture-only')
const clean = path.resolve(args.clean)
const titles = pictureOnly ? null : path.resolve(args.titles)

const readJson = (file) => JSON.parse(readFileSync(path.join(repo, file), 'utf8'))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const fileSha = (file) => sha256(readFileSync(file))
const ffmpeg = (argv) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1', '-stats_period', '30', ...argv], { stdio: ['ignore', 'inherit', 'inherit'] })
const probeFrames = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString().trim())

const film = readJson('capture/youtube/youtube-film.json')
const sources = readJson('capture/youtube/media-sources.json')
const cues = readJson('capture/youtube/youtubeTitles.cues.json')
const problems = validateFilm(film, sources, readJson('capture/finalEdit.json'), cues, readJson('capture/youtube/vo-selects.json'))
const narration = film.narration === undefined ? null : path.join(out, 'audio', 'narration-mix.wav')
const narrationManifest = narration === null ? null : JSON.parse(readFileSync(path.join(out, 'audio', 'narration-manifest.json'), 'utf8'))
if (narration !== null) {
  if (fileSha(narration) !== narrationManifest.outputs.mix.sha256) problems.push('narration mix differs from its provenance manifest')
  if (narrationManifest.source.sha256 !== film.narration.source.sha256 || fileSha(path.join(repo, film.narration.source.file)) !== film.narration.source.sha256) problems.push('raw WAV differs from verified source')
  if (narrationManifest.selects.sha256 !== fileSha(path.join(repo, film.narration.selects))) problems.push('VO selects changed since audio assembly')
  if (narrationManifest.outputs.mix.samples !== film.output.frames * 48000 / 60) problems.push('narration timeline duration differs from picture')
}

// Inputs: clean reel, assets and title track exactly as pinned.
const reelClean = sources.media.find((m) => m.id === 'reel-clean')
const cleanSha = fileSha(clean)
if (cleanSha !== reelClean.sha256) problems.push(`--clean is ${cleanSha}, not reel-clean ${reelClean.sha256} (titled or other media are never a source)`)
for (const [id, asset] of Object.entries(film.assets)) {
  const actual = fileSha(path.join(repo, asset.file))
  if (actual !== asset.sha256) problems.push(`asset ${id}: ${asset.file} is ${actual}, pinned ${asset.sha256}`)
}
const titlesManifestFile = titles === null ? null : path.join(path.dirname(titles), 'titles-manifest.json')
const titlesManifest = titlesManifestFile !== null && existsSync(titlesManifestFile) ? JSON.parse(readFileSync(titlesManifestFile, 'utf8')) : null
if (titlesManifest === null && !pictureOnly) problems.push(`no titles-manifest.json beside ${titles}`)
else if (!pictureOnly) {
  for (const file of TITLE_RENDER_INPUTS) if (titlesManifest.inputs?.[file] !== fileSha(path.join(repo, file))) problems.push(`title track is stale: ${file} changed since it was rendered`)
  if (titlesManifest.track?.sha256 !== fileSha(titles)) problems.push('title track hash differs from its manifest')
  if (titlesManifest.track?.frames !== film.output.frames || titlesManifest.track?.fps !== film.output.fps) problems.push('title track length/fps differs from the film')
}
if (problems.length > 0) {
  console.error(`refusing to assemble:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const { width: W, height: H, fps: FPS, frames: FRAMES } = film.output
const LOSSLESS = ['-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-an', '-fps_mode', 'cfr', '-r', String(FPS)]
const TO_709 = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p'
const RETIME = `settb=1/${FPS},setpts=N`
const LEGALIZE = "lutyuv=y='clip(val,16,235)':u='clip(val,16,240)':v='clip(val,16,240)'"
const moveFor = (seg) => {
  if (seg.push === undefined) return null
  const move = cues.plateMoves.find((m) => m.id === seg.push)
  return { ...move, from: 0, to: seg.frames - 1 }
}
const push = (seg) => {
  const move = moveFor(seg)
  return move === null ? '' : `,format=yuv444p,${platePushFilter(move, W, H)}`
}

/** Clean-reel input positioned so that trim's first frame is exactly `from` (seek lands half a frame early, never on a boundary). */
function reelInput(from) {
  const start = Math.max(0, from - 30)
  if (start === 0) return { input: ['-i', clean], skip: from }
  return { input: ['-ss', ((start + 0.5) / FPS).toFixed(6), '-i', clean], skip: from - (start + 1) }
}

function buildSegment(seg, file) {
  const N = seg.frames
  const src = seg.source
  if (seg.kind === 'reel') {
    const { input, skip } = reelInput(src.from)
    ffmpeg([...input, '-vf', `trim=start_frame=${skip}:end_frame=${skip + N},${RETIME}`, '-frames:v', String(N), ...LOSSLESS, file])
  } else if (seg.kind === 'hold') {
    const { input, skip } = reelInput(src.frame)
    ffmpeg([...input, '-vf', `trim=start_frame=${skip}:end_frame=${skip + 1},loop=loop=${N - 1}:size=1:start=0,${RETIME}${push(seg)}${seg.push === undefined ? '' : `,${LEGALIZE}`},format=yuv420p`, '-frames:v', String(N), ...LOSSLESS, file])
  } else if (seg.kind === 'video') {
    const asset = film.assets[src.asset]
    const crop = seg.sourceCrop === undefined ? '' : `crop=${seg.sourceCrop[2]}:${seg.sourceCrop[3]}:${seg.sourceCrop[0]}:${seg.sourceCrop[1]},scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int,${LEGALIZE},`
    ffmpeg(['-i', path.join(repo, asset.file), '-vf', `${crop}${RETIME},format=yuv420p`, '-frames:v', String(N), ...LOSSLESS, file])
  } else if (seg.kind === 'still') {
    const png = path.join(repo, film.assets[src.asset].file)
    // The push resamples after the conversion to limited range, and lanczos/cubic ringing on thin UI text overshoots it;
    // every pushed picture (still or held reel frame) is clamped back to BT.709 legal range.
    const chain = seg.push === undefined ? TO_709 : `scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv444p${push(seg)},${LEGALIZE},format=yuv420p`
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-i', png, '-vf', `${chain},${RETIME}`, '-frames:v', String(N), ...LOSSLESS, file])
  } else if (seg.kind === 'black') {
    ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`, '-vf', `format=yuv420p,${RETIME}`, '-frames:v', String(N), ...LOSSLESS, file])
  } else if (seg.kind === 'board') {
    buildBoard(seg, film.boards[seg.board], file)
  } else throw new Error(`${seg.id}: unknown kind ${seg.kind}`)
  const got = probeFrames(file)
  if (got !== N) throw new Error(`${seg.id}: built ${got} frames, expected ${N}`)
}

/** Picture boards: composed in RGB on black, converted once to BT.709 limited range. */
function buildBoard(seg, board, file) {
  const N = seg.frames
  const inputs = ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`]
  const chains = ['[0:v]format=rgb24[c0]']
  let current = 'c0'
  let index = 1
  const layerChain = (label, layer, prep) => {
    const enable = layer.from === undefined ? '' : `:enable='between(n,${layer.from},${layer.to})'`
    chains.push(`[${index}:v]${prep}scale=${layer.w}:${layer.h}:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24[${label}]`)
    chains.push(`[${current}][${label}]overlay=${layer.x}:${layer.y}:format=rgb:eof_action=repeat${enable}[c${index}]`)
    current = `c${index}`
    index++
  }
  for (const layer of board.layers ?? []) {
    const asset = film.assets[layer.asset]
    const assetPath = path.join(repo, asset.file)
    if (asset.kind === 'repo-recording') {
      const [t0, t1] = asset.window
      inputs.push('-ss', String(t0), '-t', String(t1 - t0), '-i', assetPath)
      // A Playwright recording carries no colour tags; VP8 is BT.601 limited range. Shown at its own cadence (frames repeat to 60).
      layerChain(`l${index}`, layer, `fps=${FPS},scale=in_color_matrix=bt601:in_range=tv,`)
    } else {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-i', assetPath)
      layerChain(`l${index}`, layer, '')
    }
  }
  if (board.grid) {
    const g = board.grid
    const gridPng = path.join(work, `${seg.board}-grid.png`)
    const frames = g.cells.map((c) => c.frame)
    if (frames.some((f, i) => i > 0 && f <= frames[i - 1])) throw new Error('grid cells must be in reel order')
    ffmpeg(['-i', clean, '-vf', `select='${frames.map((f) => `eq(n\\,${f})`).join('+')}',scale=${g.cellW}:${g.cellH}:in_color_matrix=bt709:in_range=tv:out_range=pc:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24,tile=${g.cols}x${g.rows}:padding=${g.gap}:margin=0:color=black`, '-frames:v', '1', '-update', '1', gridPng])
    inputs.push('-loop', '1', '-framerate', String(FPS), '-i', gridPng)
    layerChain(`l${index}`, { x: g.x, y: g.y, w: g.cols * g.cellW + (g.cols - 1) * g.gap, h: g.rows * g.cellH + (g.rows - 1) * g.gap }, '')
  }
  chains.push(`[${current}]${TO_709},${RETIME}[v]`)
  ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[v]', '-frames:v', String(N), ...LOSSLESS, file])
}

const started = Date.now()
mkdirSync(out, { recursive: true })
mkdirSync(path.join(out, 'qa'), { recursive: true })
mkdirSync(work, { recursive: true })

// 1. Picture segments (cached by fingerprint).
/** Bump when buildSegment/buildBoard change the pixels they produce. */
const SEGMENT_REVISION = 2
function segmentFingerprint(seg) {
  const move = seg.push === undefined ? null : cues.plateMoves.find((m) => m.id === seg.push)
  const board = seg.kind === 'board' ? film.boards[seg.board] : null
  const assetIds = [...(seg.source?.asset ? [seg.source.asset] : []), ...(board?.layers ?? []).map((l) => l.asset)]
  const readsClean = seg.kind === 'reel' || seg.kind === 'hold' || board?.grid !== undefined
  return sha256(JSON.stringify({
    revision: SEGMENT_REVISION,
    segment: { kind: seg.kind, source: seg.source ?? null, sourceCrop: seg.sourceCrop ?? null, frames: seg.frames, board: seg.board ?? null },
    move: move === null ? null : { scale: move.scale, anchor: move.anchor },
    board,
    assets: assetIds.map((id) => film.assets[id].sha256),
    clean: readsClean ? cleanSha : null,
    output: { W, H, FPS },
    ...(seg.push !== undefined ? { legalize: LEGALIZE } : {}),
  }))
}
const segmentFiles = []
const fingerprints = []
for (const seg of film.timeline) {
  const file = path.join(work, `${seg.id}.mkv`)
  const fpFile = `${file}.fingerprint`
  const fp = segmentFingerprint(seg)
  const cached = existsSync(file) && probeFrames(file) === seg.frames &&
    ((existsSync(fpFile) && readFileSync(fpFile, 'utf8') === fp) || (args['adopt-work'] === 'true' && !existsSync(fpFile)))
  if (!cached) buildSegment(seg, file)
  writeFileSync(fpFile, fp)
  segmentFiles.push(file)
  fingerprints.push(fp)
  console.log(`${seg.id} ${seg.kind.padEnd(5)} ${String(seg.from).padStart(5)}-${String(seg.to).padStart(5)} ${(seg.shot ?? seg.board ?? '').padEnd(9)} ${cached ? 'cached' : 'built'}`)
}
const pictureFingerprint = sha256(fingerprints.join('\n'))
writeFileSync(path.join(work, 'segments.txt'), segmentFiles.map((f) => `file '${f}'`).join('\n') + '\n')
const picture = path.join(work, 'picture.mkv')
ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'segments.txt'), '-c', 'copy', picture])
if (probeFrames(picture) !== FRAMES) throw new Error(`picture lock is ${probeFrames(picture)} frames, expected ${FRAMES}`)

// 2. Delivery encodes: the reel's hero settings; narration only in the master.
const encode = ['-an', '-sn', '-dn', ...x264Args(parseEncode({ file: 'youtube film', encode: film.output.encode }), FPS)]
const pictureLock = path.join(out, 'clean-picture-lock.mp4')
const lockFp = path.join(work, 'clean-picture-lock.fingerprint')
const lockCached = existsSync(pictureLock) && probeFrames(pictureLock) === FRAMES &&
  ((existsSync(lockFp) && readFileSync(lockFp, 'utf8') === pictureFingerprint) || (args['adopt-work'] === 'true' && !existsSync(lockFp)))
if (!lockCached) ffmpeg(['-i', picture, '-vf', RETIME, '-frames:v', String(FRAMES), ...encode, pictureLock])
writeFileSync(lockFp, pictureFingerprint)
console.log(`picture lock ${lockCached ? 'cached' : 'encoded'}`)
if (pictureOnly) {
  console.log(`PICTURE LOCK ASSEMBLED — ${FRAMES} frames, ${pictureLock} (${Math.round((Date.now() - started) / 1000)}s); segments cached in ${work}`)
  process.exit(0)
}
const firstCut = path.join(out, narration === null ? 'shoot-the-moon-youtube-first-cut.mp4' : 'shoot-the-moon-vo-picture-lock.mp4')
const composite = [`[0:v]format=yuv444p,${RETIME}[pic]`, ...titlesOverlayChains('1:v', 'pic', 'titled', FPS), '[titled]format=yuv420p[v]']
ffmpeg(['-i', picture, '-i', titles, ...(narration === null ? [] : ['-i', narration]), '-filter_complex', composite.join(';'), '-map', '[v]', '-frames:v', String(FRAMES),
  ...encode.filter((x) => narration === null || x !== '-an'),
  ...(narration === null ? [] : ['-map', '2:a:0', ...aacArgs({ bitrateKbps: 192, sampleRate: 48000, channels: 1 }), '-t', String(FRAMES / FPS)]), firstCut])

// 3. Narration and music hand-off files.
const tc = (f) => { const s = f / FPS; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}` }
const script = [
  `SHOOT THE MOON — YOUTUBE LAUNCH FILM — ${narration === null ? 'VOICEOVER SCRIPT (first cut)' : 'SELECTED RECORDED VO (OPTION A)'}`,
  `Runtime ${tc(FRAMES)} (${FRAMES} frames at ${FPS} fps). ${film.voiceover.reduce((n, l) => n + l.words, 0)} words.`,
  narration === null ? 'Each line has a window. Read naturally; if a line finishes early, leave the silence. Numbers are checked against the code: keep them exactly.' : 'These are the selected recorded performances, placed at exact source-derived sample times. See audio/narration-manifest.json for take/range provenance. No new recording is required for this build.',
  '',
  ...film.voiceover.flatMap((l) => [`[${tc(l.from)} – ${tc(l.to)}]  ${l.id} · ${l.act} · ${l.words} words`, l.text, '']),
].join('\n')
writeFileSync(path.join(out, 'voiceover-script.txt'), script)
writeFileSync(path.join(out, 'music-cue-sheet.json'), JSON.stringify({
  schema: 'shootthemoon.youtube-music-cues/1',
  film: path.basename(firstCut),
  status: 'Future music handoff markers only; no music in this build.',
  frames: FRAMES, fps: FPS, durationS: FRAMES / FPS, bpm: film.tempo.bpm, framesPerBeat: film.tempo.framesPerBeat, bars: film.tempo.bars,
  hardSync: film.music.filter((m) => m.kind === 'impact'),
  markers: film.music,
  narration: film.voiceover.map(({ id, from, to }) => ({ id, from, to })),
}, null, 2) + '\n')

// 4. TEMPORARY narration reference: the first cut at 960x540 with each line burned in at its window. QA only, never the master.
const font = path.join(repo, 'capture/titles/fonts/IBMPlexMono-Regular.ttf').replace(/:/g, '\\:')
const voDir = path.join(work, 'vo')
mkdirSync(voDir, { recursive: true })
const draw = film.voiceover.map((l) => {
  const textFile = path.join(voDir, `${l.id}.txt`)
  const words = l.text.split(' ')
  const lines = []
  let line = ''
  for (const w of words) { if ((line + ' ' + w).trim().length > 64) { lines.push(line.trim()); line = w } else line += ' ' + w }
  lines.push(line.trim())
  writeFileSync(textFile, `${l.id}  ${lines.join('\n')}`)
  return `drawtext=fontfile='${font}':textfile='${textFile}':x=24:y=h-th-24:fontsize=17:line_spacing=6:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=10:enable='between(n,${l.from},${l.to})'`
})
const stamp = `drawtext=fontfile='${font}':text='TEMP VO REFERENCE  %{frame_num}  %{pts\\:hms}':start_number=0:x=w-tw-16:y=14:fontsize=14:fontcolor=white@0.8`
if (narration === null) ffmpeg(['-i', firstCut, '-vf', `scale=960:540:flags=lanczos,${draw.join(',')},${stamp}`, '-an', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', path.join(out, 'qa', 'vo-reference-960.mp4')])

// 5. Provenance.
const tool = (cmd) => execFileSync(cmd, ['-version']).toString().split('\n')[0]
const describe = (file) => ({ file: path.relative(out, file), bytes: readFileSync(file).length, sha256: fileSha(file), frames: probeFrames(file) })
const manifest = {
  schema: 'shootthemoon.youtube-film-assembly/1',
  status: film.status,
  film: { file: 'capture/youtube/youtube-film.json', sha256: fileSha(path.join(repo, 'capture/youtube/youtube-film.json')) },
  cues: { file: 'capture/youtube/youtubeTitles.cues.json', sha256: fileSha(path.join(repo, 'capture/youtube/youtubeTitles.cues.json')) },
  sources: {
    reelClean: { sha256: cleanSha, register: 'capture/youtube/media-sources.json' },
    assets: film.assets,
    titleTrack: { sha256: titlesManifest.track.sha256, browser: titlesManifest.browser, drawnFrames: titlesManifest.drawnFrames, inputs: titlesManifest.inputs },
    ...(narrationManifest === null ? {} : { narration: narrationManifest }),
  },
  sourcePolicy: 'reel frames from reel-clean only (validateFilm/checkTimelineSources); no titled media read',
  tools: { ffmpeg: tool('ffmpeg'), node: process.version },
  encode: film.output.encode,
  audio: film.output.audio,
  segments: film.timeline.map((s) => ({ id: s.id, kind: s.kind, from: s.from, to: s.to, source: s.source ?? (s.board ? { board: s.board } : null), sourceCrop: s.sourceCrop ?? null, push: s.push ?? null })),
  outputs: {
    pictureLock: describe(pictureLock),
    firstCut: describe(firstCut),
    ...(narration === null ? { voReference: { ...describe(path.join(out, 'qa', 'vo-reference-960.mp4')), note: 'temporary narration reference; burned-in captions; never a master' } } : {}),
  },
  elapsedSec: Math.round((Date.now() - started) / 1000),
}
writeFileSync(path.join(out, 'assembly-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (args['remove-work'] === 'true') rmSync(work, { recursive: true, force: true })
console.log(`YOUTUBE FILM ASSEMBLED — ${FRAMES} frames, ${firstCut} (${manifest.elapsedSec}s)`)
