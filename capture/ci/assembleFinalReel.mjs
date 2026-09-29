#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * ASSEMBLY ONLY: turns a verified "Final reel render" run's 1080p60
 * intermediates into the release media. It never renders the game — its
 * only child processes are ffmpeg, ffprobe and git, and it imports nothing
 * that can reach a browser (capture/ci/assembly.test.ts enforces both).
 *
 *   1. verify    — reel-manifest.json + every clip.json (reelCi.ts
 *                  verifyReelRecords, the render workflow's own check) at
 *                  the rendered SHA, every intermediate re-hashed, every
 *                  locked clip present exactly once, ffprobe'd, and
 *                  capture/finalEdit.json byte-identical to the one the
 *                  footage was rendered from. Any problem: STOP.
 *   2. reel      — the whole locked timeline (assembly.ts planReel): the
 *                  25 clips in order at their exact frame counts, the edit's
 *                  head fade / flashes / dips / fade, the end-card slot
 *                  (black, or the designed still via --end-card),
 *                  derivatives.heroReel encode (+ the final mix via --audio),
 *                  and the declared RELEASE_FRAME_OVERRIDES /
 *                  RELEASE_INTERVAL_OVERRIDES for this footage (one-frame
 *                  repairs; whole portrait inserts covered frame for frame by
 *                  an adjacent 16:9 frame; whole 16:9 clips held on one of
 *                  their own verified frames; bound to the source run,
 *                  validated against the locked plan, never rendered,
 *                  smoothed or interpolated) — a retired override is
 *                  validated and reported (SUPERSEDED_FRAME_OVERRIDES)
 *   3. loop      — derivatives.loop's clips, silent, at its fps, 1280x720
 *   4. stills    — derivatives.poster's frame (from its verified clip) as
 *                  1280 JPEG + WebP, and its 1200x630 social crop
 *   5. check     — ffprobe/decode every output, frame-by-frame timeline
 *                  fidelity of reel and loop against their planned sources
 *                  (the reel's plan differs from the locked one in exactly
 *                  the declared override frames, each checked to hold its
 *                  replacement; every held interval measured to be one
 *                  stable picture), exact deliverable names; manifest.json +
 *                  SHA256SUMS
 *
 * Usage:
 *   node --experimental-strip-types --experimental-transform-types capture/ci/assembleFinalReel.mjs \
 *     --dir=capture-final/run-6 --source=capture-final/run-6/source-run.json \
 *     --out=capture-final/deliverables [--work=capture-final/assembly-work] \
 *     [--sha=<rendered sha, instead of --source>] [--end-card=<designed 1920x1080 still>] [--audio=<final mix>]
 */
import { copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyFrameOverrides,
  changedFrames,
  checkDeliverableNames,
  checkFrameOverrides,
  checkHeldInterval,
  checkImageOutput,
  checkIntermediate,
  checkTimelineFidelity,
  checkVideoOutput,
  declaredChangedFrames,
  DELIVERABLES,
  describeClipFrame,
  expandIntervalOverrides,
  expectedFrames,
  HELD_SCALE,
  intervalKind,
  intervalsForSource,
  loopFilterGraph,
  loopMaxBytes,
  loopOutputArgs,
  LOOP_SIZE,
  lockedShotClips,
  OG_SIZE,
  overridesForSource,
  parseAudio,
  parseEncode,
  planLoop,
  planReel,
  portraitReelFrames,
  POSTER_SIZE,
  reelFilterGraph,
  RELEASE_FRAME_OVERRIDES,
  RELEASE_INTERVAL_OVERRIDES,
  SCALE_FLAGS,
  selectPosterFrame,
  socialCrop,
  SUPERSEDED_FRAME_OVERRIDES,
  validateFrameOverrides,
  validateIntervalOverrides,
  validateSupersededOverrides,
  verifyAssemblyInputs,
  aacArgs,
  x264Args,
} from './assembly.ts'
import { readJson, run, runOrThrow, sha256File, toolVersion } from './io.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EDIT_PATH = 'capture/finalEdit.json'
const THUMB = { width: 64, height: 36 }
/** Mean |luma difference| per thumbnail frame allowed between an output
 * frame and its planned source frame (0-255 levels). Encode noise sits well
 * below 1; any wrong frame or misplaced fade is tens of levels. */
const FIDELITY_TOLERANCE = { reel: 3, loop: 4 }

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1], match[2]]
  }),
)
const dir = args.dir
const out = args.out ?? 'capture-final/deliverables'
const work = args.work ?? 'capture-final/assembly-work'
if (!dir) throw new Error('--dir=<downloaded render artifacts> is required')

function stop(title, problems) {
  console.error(`STOP — ${title} (${problems.length}):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const ffmpeg = (argv) => runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...argv])

async function findFiles(root, name) {
  const found = []
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) found.push(path.join(entry.parentPath, entry.name))
  }
  return found.sort()
}

function ratio(value) {
  const [num, den] = String(value).split('/').map(Number)
  return num / (den || 1)
}

/** Every stream, with decoded video frame counts. */
async function probe(file) {
  const { stdout } = await runOrThrow('ffprobe', [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration',
    '-of', 'json', file,
  ])
  const data = JSON.parse(stdout)
  const streams = data.streams.map((stream) => ({
    type: stream.codec_type,
    codec: stream.codec_name,
    profile: stream.profile,
    pixFmt: stream.pix_fmt,
    width: stream.width,
    height: stream.height,
    fps: stream.codec_type === 'video' ? ratio(stream.r_frame_rate) : undefined,
    frames: stream.nb_read_frames === undefined ? undefined : Number(stream.nb_read_frames),
    sampleRate: stream.sample_rate === undefined ? undefined : Number(stream.sample_rate),
    channels: stream.channels,
  }))
  return { streams, durationSec: Number(data.format?.duration ?? Number.NaN) }
}

/** Raw 8-bit luma thumbnails (THUMB size) of every frame of a video, in
 * the video's own limited-range levels (the fade targets 16/235 are in
 * those levels; an untagged gray scale would expand them to 0/255). */
async function lumaThumbnails(file, name) {
  const target = path.join(work, `${name}.y8`)
  await ffmpeg(['-i', file, '-map', '0:v:0', '-vf', `extractplanes=y,scale=${THUMB.width}:${THUMB.height}:flags=area:in_range=tv:out_range=tv`, '-f', 'rawvideo', '-pix_fmt', 'gray', target])
  return new Uint8Array(await readFile(target))
}

async function fileSummary(file) {
  return { file: path.basename(file), bytes: (await stat(file)).size, sha256: await sha256File(file) }
}

async function main() {
  const started = Date.now()
  const editText = readFileSync(path.join(REPO_ROOT, EDIT_PATH), 'utf8')
  const edit = JSON.parse(editText)
  const { width, height, fps } = edit.output

  // --- source / expected SHA ------------------------------------------------
  const source = args.source ? await readJson(args.source) : null
  if (args.source && source === null) stop('source run record', [`${args.source} is unreadable`])
  const sha = source?.headSha ?? args.sha
  if (!sha || (args.sha && source && args.sha !== source.headSha)) stop('rendered SHA', ['pass --source=<source-run.json> (or --sha=<rendered sha>); they must agree'])

  // The footage was rendered from finalEdit.json at `sha`; assembling it
  // against any other edit would silently re-time it.
  const editProblems = []
  const renderedBlob = await run('git', ['rev-parse', `${sha}:${EDIT_PATH}`], { cwd: REPO_ROOT })
  const currentBlob = await run('git', ['hash-object', EDIT_PATH], { cwd: REPO_ROOT })
  if (renderedBlob.code !== 0) editProblems.push(`cannot read ${EDIT_PATH} at ${sha} (full git history needed): ${renderedBlob.stderr.trim()}`)
  else if (renderedBlob.stdout.trim() !== currentBlob.stdout.trim()) editProblems.push(`${EDIT_PATH} differs from the one ${sha} was rendered from`)
  if (editProblems.length > 0) stop('locked edit', editProblems)

  // --- 1. verify inputs -----------------------------------------------------
  const manifests = await findFiles(dir, 'reel-manifest.json')
  if (manifests.length !== 1) stop('reel manifest', [`expected exactly one reel-manifest.json under ${dir}, found ${manifests.length}`])
  const manifestPath = manifests[0]
  const manifest = await readJson(manifestPath)
  const located = []
  for (const file of await findFiles(dir, 'clip.json')) {
    const record = await readJson(file)
    if (record === null) stop('clip metadata', [`${file} is unreadable`])
    const clipDir = path.dirname(file)
    located.push({
      record,
      dir: path.relative(dir, clipDir).split(path.sep).join('/'),
      actualSha256: await sha256File(path.join(clipDir, record.output.file)).catch(() => null),
    })
  }
  const failures = []
  for (const file of await findFiles(dir, 'FAILED.json')) failures.push(`${path.relative(dir, file)}: ${(await readJson(file))?.error ?? 'unknown'}`)
  const inputs = verifyAssemblyInputs(edit, sha, manifest, located, failures)
  if (inputs.problems.length > 0) stop('render intermediates failed verification — nothing is rendered to fill a gap', inputs.problems)

  const clipPath = (clipId) => path.join(dir, inputs.clipFiles.get(clipId))
  const probeProblems = []
  for (const clip of lockedShotClips(edit)) probeProblems.push(...checkIntermediate(edit, clip, (await probe(clipPath(clip.id))).streams))
  if (probeProblems.length > 0) stop('intermediates failed ffprobe', probeProblems)
  console.log(`verified ${inputs.clipFiles.size} locked clips from ${sha} (reel manifest ${path.relative(dir, manifestPath)})`)

  // Declared repairs of this footage (assembly.ts RELEASE_FRAME_OVERRIDES:
  // one-frame repairs, RELEASE_INTERVAL_OVERRIDES: whole portrait inserts
  // covered by an adjacent 16:9 frame): bound to the source run, validated
  // against the locked plan. Anything unconfirmed stops; nothing is rendered
  // to repair. An interval is the same per-frame override, so one plan check
  // covers both.
  const reelPlan = planReel(edit)
  const bound = overridesForSource(RELEASE_FRAME_OVERRIDES, sha, source, inputs.clipFiles)
  const boundIntervals = intervalsForSource(RELEASE_INTERVAL_OVERRIDES, sha, source, inputs.clipFiles)
  if (bound.problems.length > 0 || boundIntervals.problems.length > 0) stop('release frame overrides', [...bound.problems, ...boundIntervals.problems])
  const intervalOverrides = boundIntervals.intervals
  const singleOverrides = bound.overrides
  const frameOverrides = [...singleOverrides, ...expandIntervalOverrides(intervalOverrides)].sort((a, b) => a.reelFrame - b.reelFrame)
  const overrideProblems = [...validateIntervalOverrides(edit, reelPlan, intervalOverrides), ...validateFrameOverrides(edit, reelPlan, frameOverrides)]
  if (overrideProblems.length > 0) stop('release frame overrides', overrideProblems)
  const lockedReelFrames = expectedFrames(reelPlan)
  const reelFrames = applyFrameOverrides(lockedReelFrames, frameOverrides)
  // A hold's no-op frame (already the held frame in the locked plan) changes
  // nothing, so the plan must differ from the locked one in exactly the
  // declared frames that change.
  const overriddenFrames = changedFrames(lockedReelFrames, reelFrames)
  const declaredChanged = declaredChangedFrames(lockedReelFrames, frameOverrides)
  if (overriddenFrames.join(',') !== declaredChanged.join(',')) {
    stop('release frame overrides', [`plan differs from the locked plan at ${overriddenFrames.length} frames, declared ${declaredChanged.length} changing frames`])
  }
  // A retired one-frame override must have nothing left to do: its reel frame
  // lies inside the interval that replaced it and it is no longer declared.
  const superseded = SUPERSEDED_FRAME_OVERRIDES.filter((entry) => entry.override.source.headSha === sha)
  const supersededProblems = validateSupersededOverrides(reelPlan, superseded, intervalOverrides, frameOverrides)
  if (supersededProblems.length > 0) stop('superseded frame overrides', supersededProblems)
  // Where the release declares portrait covers, the reel stays 16:9 throughout.
  const portraitFrames = intervalOverrides.length > 0 ? portraitReelFrames(edit, reelFrames) : []
  if (portraitFrames.length > 0) stop('portrait frames remain in the reel', [`reel frames ${portraitFrames[0]}-${portraitFrames[portraitFrames.length - 1]} (${portraitFrames.length}) still show a pillarbox-portrait clip`])
  for (const { reelFrame, original, replacement, reason } of singleOverrides) {
    console.log(`frame override: reel frame ${reelFrame} (${(reelFrame / fps).toFixed(3)}s) ${original.clipId}#${original.frame} -> ${replacement.clipId}#${replacement.frame} — ${reason}`)
  }
  for (const interval of intervalOverrides) {
    const { reelFrame, frames, original, hold, reason } = interval
    const last = reelFrame + frames - 1
    console.log(
      `interval override: reel frames ${reelFrame}-${last} (${(reelFrame / fps).toFixed(3)}-${((last + 1) / fps).toFixed(3)}s, ${frames} frames) ` +
        `${original.clipId}#${original.frame}-${original.frame + frames - 1} -> ${hold.clipId}#${hold.frame} held — ${reason}`,
    )
    const transition = lockedReelFrames.slice(reelFrame, reelFrame + frames).filter((frame) => frame.fade !== null)
    if (transition.length > 0) {
      console.log(`  replaces ${transition.length} frame(s) of the locked ${transition[0].fade.color} transition into ${original.clipId} with the held frame at full level (the neighbouring clip's half of the transition is untouched)`)
    }
  }
  for (const { override, supersededBy, why } of superseded) {
    const { reelFrame, original, replacement } = override
    console.log(
      `frame override superseded: reel frame ${reelFrame} (${(reelFrame / fps).toFixed(3)}s) ${original.clipId}#${original.frame} -> ${replacement.clipId}#${replacement.frame} is retired, ` +
        `not applied; interval override reel frames ${supersededBy.reelFrame}-${supersededBy.reelFrame + supersededBy.frames - 1} replaces it — ${why}`,
    )
  }

  // Optional finished inputs the edit calls for but the repo does not hold.
  let endCard = null
  if (args['end-card']) {
    const { streams } = await probe(args['end-card'])
    if (streams.length !== 1 || streams[0].width !== width || streams[0].height !== height) stop('end card', [`${args['end-card']} must be one ${width}x${height} image`])
    endCard = args['end-card']
  }
  const timelineSec = edit.timeline[edit.timeline.length - 1].destOutMs / 1000
  let audio = null
  if (args.audio) {
    const probed = await probe(args.audio)
    const streams = probed.streams.filter((stream) => stream.type === 'audio')
    if (streams.length !== 1 || probed.streams.length !== 1) stop('audio', [`${args.audio} must hold exactly one audio stream`])
    if (Math.abs(probed.durationSec - timelineSec) > 0.05) stop('audio', [`${args.audio} is ${probed.durationSec}s; the locked timeline is ${timelineSec}s`])
    audio = args.audio
  }

  const existing = await readdir(out).catch(() => [])
  if (existing.length > 0) stop('output', [`${out} is not empty — assembly never overwrites an earlier delivery`])
  await mkdir(out, { recursive: true })
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const outPath = (name) => path.join(out, name)

  // --- 2. reel --------------------------------------------------------------
  const heroEncode = parseEncode(edit.derivatives.heroReel)
  const heroAudio = audio === null ? null : parseAudio(edit.derivatives.heroReel)
  {
    const inputArgs = []
    const shots = new Map()
    for (const segment of reelPlan.segments) {
      if (segment.kind !== 'shot') continue
      shots.set(segment.id, `${shots.size}:v`)
      inputArgs.push('-i', clipPath(segment.id))
    }
    let next = shots.size
    // A covered portrait clip is read from a second input of its covering clip.
    const covers = new Map()
    for (const { original, hold } of intervalOverrides) {
      covers.set(original.clipId, `${next++}:v`)
      inputArgs.push('-i', clipPath(hold.clipId))
    }
    const endCardLabel = endCard === null ? null : `${next++}:v`
    if (endCard !== null) inputArgs.push('-loop', '1', '-framerate', String(fps), '-i', endCard)
    const audioIndex = audio === null ? null : next++
    if (audio !== null) inputArgs.push('-i', audio)
    const graph = reelFilterGraph(edit, reelPlan, { shots, endCard: endCardLabel, width, height, covers }, frameOverrides)
    console.log(`reel: ${reelPlan.segments.length} segments, ${reelPlan.frames} frames @ ${fps}fps …`)
    await ffmpeg([
      ...inputArgs,
      '-filter_complex', graph,
      '-map', '[out]',
      ...(audioIndex === null ? ['-an'] : ['-map', `${audioIndex}:a:0`, ...aacArgs(heroAudio)]),
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-r', String(fps), '-fps_mode', 'cfr',
      ...x264Args(heroEncode, fps),
      outPath(DELIVERABLES.reel),
    ])
  }

  // --- 3. loop --------------------------------------------------------------
  const loopPlan = planLoop(edit)
  {
    const inputArgs = []
    const shots = new Map()
    for (const segment of loopPlan.sequence.segments) {
      shots.set(segment.id, `${shots.size}:v`)
      inputArgs.push('-i', clipPath(segment.id))
    }
    console.log(`loop: ${edit.derivatives.loop.clipIds.join(' ')} -> ${loopPlan.frames} frames @ ${loopPlan.fps}fps …`)
    await ffmpeg([
      ...inputArgs,
      '-filter_complex', loopFilterGraph(loopPlan, { shots, endCard: null, width, height }),
      '-map', '[out]',
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-r', String(loopPlan.fps), '-fps_mode', 'cfr',
      ...loopOutputArgs(edit),
      outPath(DELIVERABLES.loop),
    ])
  }

  // --- 4. poster + social crop ---------------------------------------------
  // RGB masters stay in the work dir; only the encoded stills are delivered.
  const poster = selectPosterFrame(edit)
  const og = socialCrop(width, height)
  const toRgb = (w, h) => `scale=${w}:${h}:flags=${SCALE_FLAGS}:in_color_matrix=bt709:in_range=tv,format=rgb24`
  const pick = `select='eq(n,${poster.frame})'`
  const posterMaster = path.join(work, 'poster-master.png')
  const ogMaster = path.join(work, 'og-master.png')
  await ffmpeg(['-i', clipPath(poster.clipId), '-vf', `${pick},${toRgb(POSTER_SIZE.width, POSTER_SIZE.height)}`, '-frames:v', '1', '-update', '1', posterMaster])
  await ffmpeg(['-i', clipPath(poster.clipId), '-vf', `${pick},crop=${og.w}:${og.h}:${og.x}:${og.y},${toRgb(OG_SIZE.width, OG_SIZE.height)}`, '-frames:v', '1', '-update', '1', ogMaster])
  // JFIF is BT.601 full range; WebP gets RGB and does its own conversion.
  const jpeg = (master, name) =>
    ffmpeg(['-i', master, '-vf', 'scale=out_color_matrix=bt601:out_range=pc,format=yuvj420p', '-c:v', 'mjpeg', '-q:v', '2', '-frames:v', '1', '-f', 'image2', '-update', '1', outPath(name)])
  await jpeg(posterMaster, DELIVERABLES.posterJpg)
  await jpeg(ogMaster, DELIVERABLES.og)
  await ffmpeg(['-i', posterMaster, '-c:v', 'libwebp', '-lossless', '0', '-quality', '90', '-compression_level', '6', '-frames:v', '1', '-f', 'image2', '-update', '1', outPath(DELIVERABLES.posterWebp)])
  console.log(`poster: ${poster.clipId} frame ${poster.frame} (${poster.clock} ${poster.sampled} for requested ${poster.requested}, ${poster.deltaSourceMs.toFixed(3)} ms source)`)

  // --- 5. check ------------------------------------------------------------
  const problems = []
  const outputs = []
  const decodes = async (file, frames) => {
    const full = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', file, '-map', '0', '-f', 'null', '-'])
    if (full.code !== 0 || full.stderr.trim() !== '') problems.push(`${path.basename(file)}: decode errors: ${full.stderr.trim().slice(0, 300)}`)
    if (frames === null) return
    const ends = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `select='eq(n,0)+eq(n,${frames - 1})'`, '-fps_mode', 'passthrough', '-f', 'framemd5', '-'])
    const decoded = ends.stdout.split('\n').filter((line) => line && !line.startsWith('#')).length
    if (ends.code !== 0 || decoded !== 2) problems.push(`${path.basename(file)}: first/last frame decode returned ${decoded} frame(s)`)
  }

  const endThumb = new Uint8Array(THUMB.width * THUMB.height * reelPlan.segments.find((segment) => segment.kind === 'end-card').frames)
  if (endCard === null) endThumb.fill(16)
  else {
    const one = path.join(work, 'end-card.y8')
    await ffmpeg(['-i', endCard, '-frames:v', '1', '-vf', `scale=${width}:${height}:flags=${SCALE_FLAGS}:out_color_matrix=bt709:out_range=tv,format=yuv444p,extractplanes=y,scale=${THUMB.width}:${THUMB.height}:flags=area:in_range=tv:out_range=tv`, '-f', 'rawvideo', '-pix_fmt', 'gray', one])
    const frame = new Uint8Array(await readFile(one))
    for (let offset = 0; offset < endThumb.length; offset += frame.length) endThumb.set(frame, offset)
  }
  const sourceThumbs = new Map([['end', endThumb]])
  for (const clip of lockedShotClips(edit)) sourceThumbs.set(clip.id, await lumaThumbnails(clipPath(clip.id), clip.id))

  const verifyVideo = async (name, expect, expected, tolerance, overrides = []) => {
    const file = outPath(name)
    const summary = await fileSummary(file)
    const probed = await probe(file)
    problems.push(...checkVideoOutput({ file: name, ...expect }, probed.streams, probed.durationSec, summary.bytes))
    await decodes(file, expect.frames)
    const thumbs = await lumaThumbnails(file, name)
    const fidelity = checkTimelineFidelity(expected, thumbs, sourceThumbs, THUMB.width * THUMB.height, tolerance)
    problems.push(...fidelity.problems.map((problem) => `${name}: ${problem}`))
    const overrideChecks = checkFrameOverrides(overrides, thumbs, sourceThumbs, THUMB.width * THUMB.height, tolerance)
    problems.push(...overrideChecks.flatMap((check) => check.problems.map((problem) => `${name}: ${problem}`)))
    const video = probed.streams.find((stream) => stream.type === 'video')
    const audioStreams = probed.streams.filter((stream) => stream.type === 'audio')
    outputs.push({
      ...summary,
      kind: 'video',
      width: video?.width, height: video?.height, fps: video?.fps, frames: video?.frames,
      durationSec: probed.durationSec,
      codec: `${video?.codec} ${video?.profile}`, pixFmt: video?.pixFmt,
      audio: audioStreams.length > 0,
      audioStreams: audioStreams.length,
      audioCodec: audioStreams[0]?.codec ?? null,
      timelineFidelity: { thumbnail: `${THUMB.width}x${THUMB.height} luma`, frames: fidelity.frames, meanAbsDiff: fidelity.meanAbsDiff, maxAbsDiff: fidelity.maxAbsDiff, worst: fidelity.worst, tolerance },
      ...(overrides.length > 0 ? { frameOverrideChecks: overrideChecks } : {}),
    })
    return overrideChecks
  }
  const reelOverrideChecks = await verifyVideo(DELIVERABLES.reel, { width, height, fps, frames: reelPlan.frames, audio: heroAudio }, reelFrames, FIDELITY_TOLERANCE.reel, frameOverrides)

  // A held interval must be ONE picture: measured at HELD_SCALE luma (finer
  // than the 64x36 timeline thumbnails) on the finished reel, against the
  // source frame it holds — and against the clip's own frames it replaced.
  const heldPixels = HELD_SCALE.width * HELD_SCALE.height
  const heldLuma = async (file, name, select) => {
    const target = path.join(work, `${name}.y8`)
    await ffmpeg(['-i', file, '-map', '0:v:0', '-vf', `${select},extractplanes=y,scale=${HELD_SCALE.width}:${HELD_SCALE.height}:flags=area:in_range=tv:out_range=tv`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', target])
    return new Uint8Array(await readFile(target))
  }
  const heldChecks = []
  for (const interval of intervalOverrides.filter((entry) => intervalKind(entry) === 'hold')) {
    const { reelFrame, frames, original, hold } = interval
    const between = (from, count) => `select='between(n,${from},${from + count - 1})'`
    const output = await heldLuma(outPath(DELIVERABLES.reel), `held-${original.clipId}-reel`, between(reelFrame, frames))
    const heldSource = await heldLuma(clipPath(hold.clipId), `held-${hold.clipId}-source`, `select='eq(n,${hold.frame})'`)
    const replaced = await heldLuma(clipPath(original.clipId), `held-${original.clipId}-replaced`, between(original.frame, frames))
    const check = checkHeldInterval(interval, output, heldSource, replaced, heldPixels)
    problems.push(...check.problems)
    heldChecks.push(check)
  }
  await verifyVideo(DELIVERABLES.loop, { width: LOOP_SIZE.width, height: LOOP_SIZE.height, fps: loopPlan.fps, frames: loopPlan.frames, audio: null }, expectedFrames(loopPlan.sequence, loopPlan.step), FIDELITY_TOLERANCE.loop)
  const loopBytes = outputs.find((output) => output.file === DELIVERABLES.loop).bytes
  if (loopBytes > loopMaxBytes(edit)) problems.push(`${DELIVERABLES.loop}: ${loopBytes} bytes, over the loop's ${loopMaxBytes(edit)} byte budget`)

  for (const [name, codec, size] of [
    [DELIVERABLES.posterJpg, 'mjpeg', POSTER_SIZE],
    [DELIVERABLES.posterWebp, 'webp', POSTER_SIZE],
    [DELIVERABLES.og, 'mjpeg', OG_SIZE],
  ]) {
    const file = outPath(name)
    const summary = await fileSummary(file)
    const handle = await open(file, 'r')
    const head = new Uint8Array(12)
    await handle.read(head, 0, 12, 0)
    await handle.close()
    const probed = await probe(file)
    problems.push(...checkImageOutput({ file: name, codec, ...size }, head, probed.streams, summary.bytes))
    await decodes(file, null)
    const stream = probed.streams[0]
    outputs.push({ ...summary, kind: 'image', width: stream?.width, height: stream?.height, codec: stream?.codec, pixFmt: stream?.pixFmt, audio: false, audioStreams: 0 })
  }

  // --- provenance -----------------------------------------------------------
  await copyFile(manifestPath, outPath('source-reel-manifest.json'))
  const deliveryManifest = {
    schema: 'shootthemoon.reel-deliverables/1',
    generatedAtIso: new Date().toISOString(),
    assemblySeconds: Math.round((Date.now() - started) / 1000),
    renderedFramesThisRun: 0,
    source: source ?? { headSha: sha },
    sourceReelManifest: { file: 'source-reel-manifest.json', sha256: await sha256File(manifestPath), verified: manifest.verified, clipCount: manifest.clipCount },
    finalEdit: { path: EDIT_PATH, sha256: await sha256File(path.join(REPO_ROOT, EDIT_PATH)), gitBlob: currentBlob.stdout.trim(), timelineMs: timelineSec * 1000, fps },
    intermediates: lockedShotClips(edit).map((clip) => ({ clipId: clip.id, file: inputs.clipFiles.get(clip.id), sha256: located.find((entry) => entry.record.clipId === clip.id).record.output.sha256 })),
    reel: {
      segments: reelPlan.segments,
      endCard: endCard === null
        ? 'black — no end-card still was passed; pass --end-card=<designed 1920x1080 still> to fill the locked 52.8-57.6s slot'
        : { file: path.basename(endCard), sha256: await sha256File(endCard), slot: reelPlan.segments.find((segment) => segment.kind === 'end-card') },
      frameOverrides: singleOverrides.map((override) => ({
        reelFrame: override.reelFrame,
        reelTimeSec: override.reelFrame / fps,
        original: describeClipFrame(edit, override.original),
        replacement: describeClipFrame(edit, override.replacement),
        reason: override.reason,
        source: override.source,
        intermediate: { file: inputs.clipFiles.get(override.original.clipId), sha256: located.find((entry) => entry.record.clipId === override.original.clipId).record.output.sha256 },
        check: reelOverrideChecks.find((check) => check.reelFrame === override.reelFrame),
      })),
      intervalOverrides: intervalOverrides.map((interval) => {
        const checks = reelOverrideChecks.filter((check) => check.reelFrame >= interval.reelFrame && check.reelFrame < interval.reelFrame + interval.frames)
        const last = interval.reelFrame + interval.frames - 1
        const held = heldChecks.find((check) => check.reelFrame === interval.reelFrame)
        const transition = lockedReelFrames.slice(interval.reelFrame, interval.reelFrame + interval.frames).filter((frame) => frame.fade !== null)
        return {
          kind: intervalKind(interval),
          reelFrames: { first: interval.reelFrame, last, count: interval.frames },
          reelTimeSec: { start: interval.reelFrame / fps, end: (last + 1) / fps },
          original: { ...describeClipFrame(edit, interval.original), throughFrame: interval.original.frame + interval.frames - 1 },
          replacement: { ...describeClipFrame(edit, interval.hold), heldFrames: interval.frames },
          reason: interval.reason,
          source: interval.source,
          intermediates: { original: inputs.clipFiles.get(interval.original.clipId), replacement: inputs.clipFiles.get(interval.hold.clipId) },
          lockedTransitionFramesReplaced: { count: transition.length, color: transition[0]?.fade?.color ?? null },
          check: { frames: checks.length, maxLevelsFromReplacement: Math.max(...checks.map((check) => check.toReplacement)), minLevelsFromOriginal: Math.min(...checks.map((check) => check.toOriginal)) },
          ...(held === undefined ? {} : { held: { scale: `${HELD_SCALE.width}x${HELD_SCALE.height} luma`, maxLevelsFromFirstFrame: held.maxFromFirstFrame, firstFrameLevelsFromHeldSource: held.firstToHeldSource, replacedSourceLevelsFromHeld: held.sourceFromHeld } }),
        }
      }),
      supersededFrameOverrides: superseded.map(({ override, supersededBy, why }) => ({
        applied: false,
        reelFrame: override.reelFrame,
        reelTimeSec: override.reelFrame / fps,
        original: describeClipFrame(edit, override.original),
        replacement: describeClipFrame(edit, override.replacement),
        reason: override.reason,
        source: override.source,
        supersededBy: { ...supersededBy, reelFrames: { first: supersededBy.reelFrame, last: supersededBy.reelFrame + supersededBy.frames - 1 } },
        why,
      })),
      portraitFramesRemaining: portraitReelFrames(edit, reelFrames).length,
      framesDifferingFromLockedPlan: overriddenFrames,
      audio: audio === null ? 'none — no final mix exists in the repo; finalEdit.json holds the cue map only. Pass --audio=<final mix> to mux it per derivatives.heroReel.audio' : path.basename(audio),
      encode: edit.derivatives.heroReel.encode,
    },
    loop: { clipIds: edit.derivatives.loop.clipIds, fps: loopPlan.fps, frames: loopPlan.frames, durationMs: loopPlan.durationMs, size: `${LOOP_SIZE.width}x${LOOP_SIZE.height}`, encode: `derivatives.webReel: ${edit.derivatives.webReel.encode}`, silent: true },
    poster: { ...poster, crop: edit.derivatives.poster.crop, size: `${POSTER_SIZE.width}x${POSTER_SIZE.height}` },
    og: { crop: og, size: `${OG_SIZE.width}x${OG_SIZE.height}`, typography: 'none — no title treatment is specified; the right third is left clean for it' },
    tools: { ffmpeg: await toolVersion('ffmpeg', ['-version']), ffprobe: await toolVersion('ffprobe', ['-version']), node: process.version },
    outputs,
    verified: problems.length === 0,
    problems,
  }
  await writeFile(outPath('manifest.json'), JSON.stringify(deliveryManifest, null, 2) + '\n')
  const sums = []
  for (const name of [...Object.values(DELIVERABLES), 'manifest.json', 'source-reel-manifest.json']) sums.push(`${await sha256File(outPath(name))}  ${name}`)
  await writeFile(outPath('SHA256SUMS'), sums.join('\n') + '\n')
  problems.push(...checkDeliverableNames(await readdir(out)))

  console.log('')
  console.log('| file | size | duration | codec | audio | bytes | sha256 |')
  console.log('|---|---|---|---|---|---|---|')
  for (const output of outputs) {
    const duration = output.durationSec === undefined ? '' : `${output.durationSec}s (${output.frames} fr @ ${output.fps})`
    console.log(`| ${output.file} | ${output.width}x${output.height} | ${duration} | ${output.codec} ${output.pixFmt} | ${output.audioStreams} | ${output.bytes} | ${output.sha256} |`)
  }
  for (const output of outputs.filter((entry) => entry.timelineFidelity)) {
    const { meanAbsDiff, maxAbsDiff, frames } = output.timelineFidelity
    console.log(`timeline fidelity ${output.file}: ${frames} frames, mean ${meanAbsDiff.toFixed(3)} / max ${maxAbsDiff.toFixed(3)} levels`)
    for (const check of (output.frameOverrideChecks ?? []).filter((entry) => singleOverrides.some((override) => override.reelFrame === entry.reelFrame))) {
      console.log(`  frame override @ ${check.reelFrame}: ${check.toReplacement.toFixed(3)} levels from its replacement, ${check.toOriginal.toFixed(3)} from the original${check.problems.length > 0 ? ' — FAILED' : ''}`)
    }
    for (const check of heldChecks.filter(() => output.file === DELIVERABLES.reel)) {
      console.log(
        `  held interval @ ${check.reelFrame}-${check.reelFrame + check.frames - 1}: ${check.frames} frames, max ${check.maxFromFirstFrame.toFixed(3)} levels from the first frame, ` +
          `first frame ${check.firstToHeldSource.toFixed(3)} from its source frame (replaced source frames were up to ${check.sourceFromHeld.max.toFixed(3)}, mean ${check.sourceFromHeld.mean.toFixed(3)} levels from it)${check.problems.length > 0 ? ' — FAILED' : ''}`,
      )
    }
    for (const interval of intervalOverrides.filter(() => output.file === DELIVERABLES.reel)) {
      const checks = (output.frameOverrideChecks ?? []).filter((entry) => entry.reelFrame >= interval.reelFrame && entry.reelFrame < interval.reelFrame + interval.frames)
      const failed = checks.filter((entry) => entry.problems.length > 0).length
      console.log(
        `  interval override @ ${interval.reelFrame}-${interval.reelFrame + interval.frames - 1}: ${checks.length} frames, max ${Math.max(...checks.map((entry) => entry.toReplacement)).toFixed(3)} levels from ` +
          `${interval.hold.clipId}#${interval.hold.frame}, min ${Math.min(...checks.map((entry) => entry.toOriginal)).toFixed(3)} from ${interval.original.clipId}${failed > 0 ? ` — ${failed} FAILED` : ''}`,
      )
    }
  }
  if (problems.length > 0) {
    console.error(`ASSEMBLY VERIFICATION FAILED (${problems.length}):\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
  } else {
    console.log(`ASSEMBLY VERIFIED — ${Object.keys(DELIVERABLES).length} deliverables in ${out} (${Math.round((Date.now() - started) / 1000)}s, 0 frames rendered, ${frameOverrides.length} declared frame override(s): ${singleOverrides.length} single, ${intervalOverrides.length} interval(s))`)
  }
}

await main()
