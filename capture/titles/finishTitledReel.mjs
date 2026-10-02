/**
 * Builds the titled ORBITAL RECORD reel from a finished clean reel, for when
 * the verified render intermediates are not at hand (the release path is
 * capture/ci/assembleFinalReel.mjs --titles=… --titles-cues=…, which applies
 * the same chains to the lossless sequence instead).
 *
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/titles/finishTitledReel.mjs \
 *       --clean=<reel-57s-1080.mp4 as released> \
 *       --titles=capture-final/titles/titles-track.mov \
 *       [--replace=c12:<re-captured still.png>] \
 *       --out=capture-final/titled
 *   -> <out>/reel-57s-1080.mp4        titled: plate pushes + titles, black end-card slot + E8
 *      <out>/reel-57s-1080-clean.mp4  the clean reel, byte-for-byte
 *      <out>/titled-manifest.json
 *
 * Every clean frame keeps its reel frame number: the clean reel is decoded to
 * the assembly's 4:4:4 BT.709 sequence, the end-card slot is black (as in
 * assembly without --end-card), a replaced still clip is rebuilt exactly as an
 * intermediate (same scale, same transitions via assembly's fadeFilter), then
 * titles.ts titledChains() and assembly's deliveryScale + heroReel encode.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deliveryScale, fadeFilter, parseEncode, planReel, SCALE_FLAGS, x264Args } from '../ci/assembly.ts'
import { drawnFrames, sceneAt, titledChains, validateCues } from './titles.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = {}
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  args[match[1]] = match[2]
}
for (const required of ['clean', 'titles', 'out']) if (!args[required]) throw new Error(`--${required}=… is required`)
const stop = (title, problems) => {
  console.error(`FINISH FAILED — ${title}:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const edit = JSON.parse(readFileSync(path.join(here, '..', 'finalEdit.json'), 'utf8'))
const cuesPath = args.cues ?? path.join(here, 'reel-titles.cues.json')
const cuesText = readFileSync(cuesPath, 'utf8')
const cues = JSON.parse(cuesText)
const cueProblems = validateCues(cues)
if (cueProblems.length > 0) stop('cue sheet', cueProblems)
const plan = planReel(edit)
const { fps } = plan
const { width, height } = edit.output
if (plan.frames !== cues.source.frames || fps !== cues.source.fps || width !== cues.source.width || height !== cues.source.height) {
  stop('cue sheet', [`cues are for ${cues.source.width}x${cues.source.height}@${cues.source.fps} ${cues.source.frames}f; the locked plan is ${width}x${height}@${fps} ${plan.frames}f`])
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const ffprobeJson = (file, extra = []) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...extra, '-print_format', 'json', '-show_streams', '-show_format', file]).toString())
const ffmpeg = (ffArgs) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...ffArgs], { stdio: 'inherit', maxBuffer: 1 << 30 })

// --- inputs ----------------------------------------------------------------
const cleanProbe = ffprobeJson(args.clean, ['-count_frames'])
const cleanVideo = cleanProbe.streams.filter((s) => s.codec_type === 'video')
if (cleanVideo.length !== 1 || cleanProbe.streams.length !== 1) stop('clean reel', ['must hold exactly one video stream and nothing else'])
if (Number(cleanVideo[0].nb_read_frames) !== plan.frames || cleanVideo[0].width !== width || cleanVideo[0].height !== height || cleanVideo[0].r_frame_rate !== `${fps}/1`) {
  stop('clean reel', [`${cleanVideo[0].width}x${cleanVideo[0].height} ${cleanVideo[0].r_frame_rate} ${cleanVideo[0].nb_read_frames}f; expected ${width}x${height} ${fps}/1 ${plan.frames}f`])
}
const titlesProbe = ffprobeJson(args.titles, ['-count_frames']).streams[0]
if (Number(titlesProbe.nb_read_frames) !== plan.frames || titlesProbe.width !== width || titlesProbe.height !== height || !/argb|rgba|bgra/.test(titlesProbe.pix_fmt)) {
  stop('titles track', [`${titlesProbe.width}x${titlesProbe.height} ${titlesProbe.pix_fmt} ${titlesProbe.nb_read_frames}f; expected ${width}x${height} with alpha, ${plan.frames}f`])
}

/** Segment layout with reel frame ranges. */
const layout = []
{
  let start = 0
  for (const segment of plan.segments) {
    layout.push({ segment, start, end: start + segment.frames - 1 })
    start += segment.frames
  }
}
const reelRange = (clipId) => {
  const item = layout.find((entry) => entry.segment.id === clipId)
  return [item.start, item.end]
}
const replacements = new Map()
for (const spec of (args.replace ?? '').split(',').filter(Boolean)) {
  const [clipId, file] = spec.split(':')
  const clip = edit.timeline.find((item) => item.id === clipId)
  if (clip === undefined || clip.kind !== 'shot' || clip.source.clock !== 'still' || clip.framing !== 'full-16x9') stop('replacement', [`${clipId} is not a full-16x9 still clip of the locked cut`])
  const [stream] = ffprobeJson(file).streams
  if (stream.width !== width || stream.height !== height) stop('replacement', [`${file} is ${stream.width}x${stream.height}, expected ${width}x${height}`])
  replacements.set(clipId, file)
}

// --- graph -----------------------------------------------------------------
const inputs = ['-i', args.clean, '-i', args.titles]
const chains = []
const runs = [] // { kind: 'clean' | 'still' | 'black', from, to, label }
for (const item of layout) {
  const kind = item.segment.kind === 'end-card' ? 'black' : replacements.has(item.segment.id) ? 'still' : 'clean'
  const last = runs[runs.length - 1]
  if (kind === 'clean' && last?.kind === 'clean') last.to = item.end
  else runs.push({ kind, from: item.start, to: item.end, segment: item.segment })
}
const cleanRuns = runs.filter((run) => run.kind === 'clean')
chains.push(
  `[0:v]settb=1/${fps},setpts=N,scale=${width}:${height}:flags=${SCALE_FLAGS}:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv444p,setsar=1` +
    `,split=${cleanRuns.length}${cleanRuns.map((_, i) => `[c${i}]`).join('')}`,
)
runs.forEach((run, index) => {
  const label = `r${index}`
  const frames = run.to - run.from + 1
  if (run.kind === 'clean') {
    chains.push(`[c${cleanRuns.indexOf(run)}]trim=start_frame=${run.from}:end_frame=${run.to + 1},setpts=PTS-STARTPTS[${label}]`)
  } else if (run.kind === 'black') {
    chains.push(`color=c=black:s=${width}x${height}:r=${fps},format=yuv444p,trim=end_frame=${frames},settb=1/${fps},setpts=N[${label}]`)
  } else {
    // Exactly reelCi.ts planIntermediate() for a still, then the segment's own transitions.
    const input = inputs.filter((value) => value === '-i').length
    inputs.push('-loop', '1', '-framerate', String(fps), '-i', replacements.get(run.segment.id))
    const still = `[${input}:v]scale=${width}:${height}:flags=${SCALE_FLAGS}:out_color_matrix=bt709:out_range=tv,format=yuv444p,setsar=1,trim=end_frame=${frames},settb=1/${fps},setpts=N`
    const parts = []
    const head = run.segment.head?.frames ?? 0
    const tail = run.segment.tail?.frames ?? 0
    if (head > 0) parts.push({ start: 0, end: head, fade: fadeFilter(run.segment.head, 'head') })
    parts.push({ start: head, end: frames - tail, fade: null })
    if (tail > 0) parts.push({ start: frames - tail, end: frames, fade: fadeFilter(run.segment.tail, 'tail') })
    chains.push(`${still},split=${parts.length}${parts.map((_, i) => `[${label}p${i}]`).join('')}`)
    parts.forEach((part, i) => chains.push(`[${label}p${i}]trim=start_frame=${part.start}:end_frame=${part.end},setpts=PTS-STARTPTS${part.fade ? `,${part.fade}` : ''}[${label}q${i}]`))
    chains.push(`${parts.map((_, i) => `[${label}q${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[${label}]`)
  }
})
chains.push(`${runs.map((_, i) => `[r${i}]`).join('')}concat=n=${runs.length}:v=1:a=0,settb=1/${fps},setpts=N[seq]`)
chains.push(...titledChains(cues, 'seq', '1:v', 'titled', fps))
chains.push(`[titled]${deliveryScale(width, height)}[out]`)
const graph = chains.join(';')

mkdirSync(args.out, { recursive: true })
const titledPath = path.join(args.out, 'reel-57s-1080.mp4')
const cleanPath = path.join(args.out, 'reel-57s-1080-clean.mp4')
writeFileSync(path.join(args.out, 'titled-filtergraph.txt'), chains.join(';\n') + '\n')
const started = Date.now()
if (args['verify-only'] !== 'true') {
console.log(`titled reel: ${runs.length} runs (${runs.map((run) => `${run.kind} ${run.from}-${run.to}`).join(', ')}), ${cues.plateMoves.length} plate pushes …`)
ffmpeg([
  ...inputs,
  '-filter_complex', graph,
  '-map', '[out]', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
  '-r', String(fps), '-fps_mode', 'cfr',
  ...x264Args(parseEncode(edit.derivatives.heroReel), fps),
  titledPath,
])
copyFileSync(args.clean, cleanPath)
}

// --- verify ----------------------------------------------------------------
const problems = []
const titled = ffprobeJson(titledPath, ['-count_frames'])
const video = titled.streams[0]
if (titled.streams.length !== 1 || video.codec_type !== 'video') problems.push('titled reel must hold exactly one video stream (silent)')
if (Number(video.nb_read_frames) !== plan.frames) problems.push(`titled reel has ${video.nb_read_frames} frames, expected ${plan.frames}`)
if (video.width !== width || video.height !== height || video.r_frame_rate !== `${fps}/1` || video.pix_fmt !== 'yuv420p') problems.push(`titled reel is ${video.width}x${video.height} ${video.r_frame_rate} ${video.pix_fmt}`)
if (Math.abs(Number(titled.format.duration) - plan.frames / fps) > 0.001) problems.push(`titled reel lasts ${titled.format.duration}s, expected ${plan.frames / fps}s`)
if (video.color_space !== 'bt709' || video.color_range !== 'tv') problems.push(`titled reel is tagged ${video.color_space}/${video.color_range}`)

const thumbs = (file) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:36:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 })
const a = thumbs(cleanPath)
const b = thumbs(titledPath)
const px = 64 * 36
const titleFrames = new Set(drawnFrames(cues))
const declared = new Set(titleFrames)
for (const move of cues.plateMoves) for (let f = move.from; f <= move.to; f++) declared.add(f)
for (const item of layout) if (item.segment.kind === 'end-card' || replacements.has(item.segment.id)) for (let f = item.start; f <= item.end; f++) declared.add(f)
let worstUndeclared = { frame: -1, diff: 0 }
const changedClasses = {}
for (let f = 0; f < plan.frames; f++) {
  let sum = 0
  for (let i = 0; i < px; i++) sum += Math.abs(a[f * px + i] - b[f * px + i])
  const diff = sum / px
  if (!declared.has(f)) {
    if (diff > worstUndeclared.diff) worstUndeclared = { frame: f, diff }
    if (diff > 3) problems.push(`frame ${f}: differs from the clean reel by ${diff.toFixed(2)} levels but is not a declared title/push/end-card/replacement frame`)
  } else {
    const { segment } = layout.find((item) => f >= item.start && f <= item.end)
    const pushed = cues.plateMoves.some((move) => f >= move.from && f <= move.to)
    const cls = segment.kind === 'end-card' ? 'end card (E8 on black)'
      : replacements.has(segment.id) ? `${segment.id} re-capture + push`
      : pushed ? (titleFrames.has(f) ? 'push + titles' : 'push only')
      : 'titles only'
    changedClasses[cls] ??= { frames: 0, maxDiff: 0 }
    changedClasses[cls].frames += 1
    changedClasses[cls].maxDiff = Math.max(changedClasses[cls].maxDiff, Number(diff.toFixed(2)))
  }
}

// Titles alpha: exactly zero on every protected frame and outside every event.
const alphaMax = execFileSync('ffmpeg', ['-v', 'error', '-i', args.titles, '-vf', 'alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 })
  .toString().split('\n').filter((line) => line.includes('YMAX')).map((line) => Number(line.split('=')[1]))
if (alphaMax.length !== plan.frames) problems.push(`titles alpha read ${alphaMax.length} frames, expected ${plan.frames}`)
const drawn = titleFrames
let protectedAlpha = 0
for (let f = 0; f < alphaMax.length; f++) {
  const banned = cues.forbidden.find((range) => f >= range.from && f <= range.to)
  if (banned && alphaMax[f] !== 0) problems.push(`frame ${f}: titles alpha ${alphaMax[f]} on a protected frame (${banned.why})`)
  if (banned) protectedAlpha += 1
  if (!drawn.has(f) && alphaMax[f] !== 0) problems.push(`frame ${f}: titles alpha ${alphaMax[f]} outside every declared event`)
  // The last frame of a fade-out is drawn at ~0.2% opacity, which rounds to alpha 0.
  const visible = sceneAt(cues, f).some((op) => (op.fillOpacity ?? op.strokeOpacity ?? 1) >= 0.01)
  if (visible && alphaMax[f] === 0) problems.push(`frame ${f}: declared drawn but the track is empty`)
}

const manifest = {
  schema: 'shootthemoon.titled-reel/1',
  method: 'finish over the clean reel (render intermediates unavailable): decode -> 4:4:4 -> black end-card slot -> replacements -> plate pushes -> titles -> heroReel encode',
  clean: { file: path.basename(cleanPath), source: args.clean, sha256: sha256(cleanPath) },
  titled: { file: path.basename(titledPath), sha256: sha256(titledPath), frames: Number(video.nb_read_frames), durationSec: Number(titled.format.duration), codec: video.codec_name, profile: video.profile, pixFmt: video.pix_fmt },
  titles: { file: args.titles, sha256: sha256(args.titles) },
  cues: { file: path.relative(process.cwd(), cuesPath), sha256: createHash('sha256').update(cuesText).digest('hex') },
  replacements: Object.fromEntries([...replacements].map(([clipId, file]) => [clipId, { file, sha256: sha256(file), reelFrames: reelRange(clipId) }])),
  changedFrameClasses: changedClasses,
  undeclaredFrames: { count: plan.frames - declared.size, worstDiff: Number(worstUndeclared.diff.toFixed(3)), worstFrame: worstUndeclared.frame, tolerance: 3 },
  protectedFramesWithZeroAlpha: protectedAlpha,
  elapsedSec: Math.round((Date.now() - started) / 1000),
  problems,
}
writeFileSync(path.join(args.out, 'titled-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (problems.length > 0) stop('verification', problems.slice(0, 40))
console.log(JSON.stringify({ changedFrameClasses: changedClasses, undeclaredFrames: manifest.undeclaredFrames, protectedFramesWithZeroAlpha: protectedAlpha }, null, 2))
console.log(`TITLED REEL VERIFIED — ${titledPath} (${plan.frames} frames, ${manifest.elapsedSec}s); clean reel kept as ${cleanPath}`)
