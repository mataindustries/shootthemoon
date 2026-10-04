#!/usr/bin/env node
/** Decode the actual review media and alpha track; export reproducible QA proofs.
 * node --experimental-strip-types --experimental-transform-types capture/titles/qaTitledLoop.mjs --out=capture-final/loop-motion
 * Subject clearance and mobile reading are reviewed in the exported pictures;
 * they are not inferred from a passing state test.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { checkTitlesAlpha, platePushFilter } from './titles.ts'

const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='))
if (!outArg) throw new Error('--out=… is required')
const out = outArg.slice(6)
const qa = path.join(out, 'qa')
mkdirSync(qa, { recursive: true })
const video = path.join(out, 'loop-13s-1280-titled.mp4')
const track = path.join(out, 'titles/titles-track.mov')
const base = path.join(out, 'work/loop-plate.mkv')
const cues = JSON.parse(readFileSync(new URL('./loop-titles.cues.json', import.meta.url), 'utf8'))
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1', ...args], { maxBuffer: 512 * 1024 * 1024 })
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-threads', '1', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video]).toString())
const problems = []
const v = probe.streams[0]
if (probe.streams.length !== 1 || v.codec_type !== 'video' || v.codec_name !== 'h264' || v.profile !== 'High' || v.width !== 1280 || v.height !== 720 || v.r_frame_rate !== '30/1' || v.avg_frame_rate !== '30/1' || Number(v.nb_read_frames) !== 414 || v.pix_fmt !== 'yuv420p' || Number(probe.format.duration) !== 13.8 || statSync(video).size > 8_000_000) problems.push('Media target mismatch')
if (v.color_space !== 'bt709' || v.color_range !== 'tv' || v.color_transfer !== 'bt709' || v.color_primaries !== 'bt709') problems.push('Color metadata mismatch')
const pts = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'stream=time_base:frame=best_effort_timestamp,key_frame', '-of', 'json', video]).toString())
const [num, den] = pts.streams[0].time_base.split('/').map(Number)
if (pts.frames.length !== 414 || pts.frames.some((f, i) => Number(f.best_effort_timestamp) * num * 30 !== i * den)) problems.push('Decoded PTS differs from exact f0..f413')
if (pts.frames[0].key_frame !== 1) problems.push('First frame is not a keyframe')
const bytes = readFileSync(video), atoms = []
for (let offset = 0; offset + 8 <= bytes.length;) {
  const length = bytes.readUInt32BE(offset)
  atoms.push({ type: bytes.toString('ascii', offset + 4, offset + 8), offset })
  if (length < 8) break
  offset += length
}
const faststart = atoms.find((a) => a.type === 'moov')?.offset < atoms.find((a) => a.type === 'mdat')?.offset
if (!faststart) problems.push('moov is not before mdat')
ff(['-i', video, '-xerror', '-map', '0', '-f', 'null', '-'])

// All pixels on every decoded alpha frame, including the shadow. Independent
// locked ranges and envelope, rather than accepting a changed cue declaration.
const alphaFile = path.join(qa, 'titles-alpha.y8')
ff(['-i', track, '-vf', 'alphaextract', '-pix_fmt', 'gray', '-f', 'rawvideo', alphaFile])
const alpha = readFileSync(alphaFile), pixels = 1280 * 720
if (alpha.length !== 414 * pixels) throw new Error('Alpha track has the wrong decoded length')
const alphaFrames = []
let envelope = [1280, 720, -1, -1], outsidePixels = 0
for (let f = 0; f < 414; f++) {
  let max = 0, count = 0, box = [1280, 720, -1, -1]
  for (let i = 0; i < pixels; i++) {
    const a = alpha[f * pixels + i]
    if (!a) continue
    max = Math.max(max, a); count++
    const x = i % 1280, y = Math.floor(i / 1280)
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
    if (x < 64 || x > 462 || y < 545 || y > 636) outsidePixels++
  }
  const legal = (f >= 81 && f <= 125) || (f >= 216 && f <= 242) || (f >= 333 && f <= 377)
  if (legal !== (max > 0)) problems.push(`Frame ${f}: decoded alpha ${max} differs from the locked ranges`)
  if (count) envelope = [Math.min(envelope[0], box[0]), Math.min(envelope[1], box[1]), Math.max(envelope[2], box[2]), Math.max(envelope[3], box[3])]
  alphaFrames.push({ frame: f, max, pixels: count, box: count ? box : null })
}
problems.push(...checkTitlesAlpha(cues, alphaFrames.map((f) => f.max)))
if (outsidePixels) problems.push(`${outsidePixels} title pixels outside the safe envelope`)
writeFileSync(path.join(qa, 'alpha-frames.json'), JSON.stringify(alphaFrames, null, 2) + '\n')
const ranges = [[0, 80], [126, 215], [243, 332], [378, 413], [142, 146], [250, 254]].map(([from, to]) => ({ from, to, maxAlpha: Math.max(...alphaFrames.slice(from, to + 1).map((f) => f.max)) }))
const boundaryFrames = [80, 81, 125, 126, 215, 216, 242, 243, 332, 333, 377, 378]
ff(['-i', video, '-vf', `select='${boundaryFrames.map((f) => `eq(n,${f})`).join('+')}',scale=480:270:flags=lanczos,tile=4x3:nb_frames=12`, '-frames:v', '1', '-update', '1', path.join(qa, 'cue-boundaries.png')])

// Freeze the actual lossless f324. Independently compare the decoded endpoints
// against constant perspective transforms using normalized frame coordinates,
// with no frame counter and no use of plateScaleAt or platePushFilter.
const move = cues.plateMoves[0], freeze = 'trim=start_frame=324:end_frame=325,setpts=PTS-STARTPTS'
const frozen = path.join(qa, 'frozen-LP1.mkv')
ff(['-i', base, '-vf', `${freeze},loop=loop=89:size=1:start=0,settb=1/30,setpts=N,${platePushFilter(move, 1280, 720)}`, '-frames:v', '90', '-r', '30', '-fps_mode', 'cfr', '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2', '-pix_fmt', 'yuv444p', frozen])
const frozenY = ff(['-i', frozen, '-vf', 'extractplanes=y', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'])
if (frozenY.length !== pixels * 90) throw new Error('Frozen push did not decode 90 frames')
const lumaStepMotion = [], stepMotion = []
for (let f = 1; f < 90; f++) {
  let sum = 0
  for (let i = 0; i < pixels; i++) sum += Math.abs(frozenY[f * pixels + i] - frozenY[(f - 1) * pixels + i])
  lumaStepMotion.push(sum / pixels)
  // Independent radial Lucas–Kanade registration: measure displacement,
  // rather than the number of 8-bit luma values crossing a rounding boundary.
  // Fit dI = -ds * ((x-ax)Ix + (y-ay)Iy) over every second decoded pixel.
  // Central gradients use both frames; no cue scale or frame counter enters
  // this estimate. Repeated frames necessarily return zero motion.
  let numerator = 0, denominator = 0
  const a = (f - 1) * pixels, b = f * pixels
  for (let y = 2; y < 718; y += 2) for (let x = 2; x < 1278; x += 2) {
    const i = y * 1280 + x
    const gx = (frozenY[a + i + 1] - frozenY[a + i - 1] + frozenY[b + i + 1] - frozenY[b + i - 1]) / 4
    const gy = (frozenY[a + i + 1280] - frozenY[a + i - 1280] + frozenY[b + i + 1280] - frozenY[b + i - 1280]) / 4
    const jacobian = (x - 640) * gx + (y - 360) * gy
    numerator -= jacobian * (frozenY[b + i] - frozenY[a + i])
    denominator += jacobian * jacobian
  }
  stepMotion.push(numerator / denominator)
}
const minMotion = Math.min(...stepMotion), maxMotion = Math.max(...stepMotion), ratio = maxMotion / minMotion
if (minMotion <= 0 || ratio > 2) problems.push(`LP1 frozen motion has min ${minMotion}, max/min ${ratio}`)
const constantScale = (s) => [
  'scale=2560:1440:flags=lanczos+accurate_rnd+full_chroma_int', 'format=yuv444p',
  `perspective=x0='W*(1-1/${s})/2':y0='H*(1-1/${s})/2':x1='W*(1+1/${s})/2':y1='H*(1-1/${s})/2':x2='W*(1-1/${s})/2':y2='H*(1+1/${s})/2':x3='W*(1+1/${s})/2':y3='H*(1+1/${s})/2':interpolation=cubic:sense=source:eval=init`,
  'scale=1280:720:flags=lanczos+accurate_rnd+full_chroma_int', 'format=yuv444p', 'setsar=1', 'extractplanes=y',
].join(',')
const endpointChecks = []
for (const [frame, localFrame, expectedScale] of [[324, 0, 1], [413, 89, 1.025]]) {
  const candidates = []
  for (const s of [expectedScale - .001, expectedScale, expectedScale + .001]) {
    const reference = ff(['-i', base, '-vf', `${freeze},${constantScale(s)}`, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'])
    let sum = 0
    for (let i = 0; i < pixels; i++) sum += Math.abs(frozenY[localFrame * pixels + i] - reference[i])
    candidates.push({ scale: s, meanAbsDiff: sum / pixels })
  }
  const best = [...candidates].sort((a, b) => a.meanAbsDiff - b.meanAbsDiff)[0]
  if (best.scale !== expectedScale || best.meanAbsDiff > .01) problems.push(`LP1 f${frame}: independently measured endpoint differs`)
  endpointChecks.push({ frame, expectedScale, measuredScale: best.scale, tolerance: .001, candidates })
}
const meanMotion = stepMotion.reduce((sum, m) => sum + m, 0) / stepMotion.length
const phaseChecks = Array.from({ length: 11 }, (_, i) => i + 2).map((period) => {
  const phases = Array.from({ length: period }, (_, phase) => stepMotion.filter((_, i) => i % period === phase))
  const means = phases.map((p) => p.reduce((sum, m) => sum + m, 0) / p.length)
  return { period, maxMinRatio: Math.max(...means) / Math.min(...means) }
})
if (phaseChecks.some((p) => p.maxMinRatio > 2)) problems.push('Periodic frozen-motion stair-step')
writeFileSync(path.join(qa, 'LP1-motion.csv'), 'from,to,registered_radial_motion,mean_absolute_luma_difference\n' + stepMotion.map((motion, i) => `${324 + i},${325 + i},${motion},${lumaStepMotion[i]}`).join('\n') + '\n')

for (const f of [110, 236, 355, 221, 338]) {
  const full = path.join(qa, `f${f}.png`)
  ff(['-i', video, '-vf', `select='eq(n,${f})'`, '-frames:v', '1', '-update', '1', full])
  if ([110, 236, 355].includes(f)) for (const w of [600, 480, 400]) ff(['-i', full, '-vf', `scale=${w}:-1:flags=lanczos`, '-frames:v', '1', '-update', '1', path.join(qa, `f${f}-${w}w.png`)])
}
// Two rows: last ten frames, then first ten. Also retain a simple 480 px player.
const seamFilter = "split=2[tail][head];[tail]trim=start_frame=404:end_frame=414,setpts=PTS-STARTPTS[t];[head]trim=start_frame=0:end_frame=10,setpts=PTS-STARTPTS[h];[t][h]concat=n=2:v=1:a=0,scale=240:135:flags=lanczos,tile=10x2:nb_frames=20";
ff(['-i', video, '-filter_complex_threads', '1', '-filter_complex', seamFilter, '-frames:v', '1', '-update', '1', path.join(qa, 'seam-f404-f413-f0-f9.png')])
ff(['-i', video, '-vf', "select='between(n,216,242)',crop=640:220:0:490,scale=640:220,tile=3x9:nb_frames=27", '-frames:v', '1', '-update', '1', path.join(qa, 'L2-clearance-all-frames.png')])
ff(['-i', video, '-vf', "select='between(n,333,377)',crop=740:340:0:300,scale=592:272,tile=5x9:nb_frames=45", '-frames:v', '1', '-update', '1', path.join(qa, 'L3-clearance-all-frames.png')])
const seamY = ff(['-i', video, '-vf', "select='between(n,404,413)+between(n,0,9)',extractplanes=y", '-fps_mode', 'passthrough', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'])
const frameAt = (f) => seamY.subarray((f < 10 ? f : f - 394) * pixels, (f < 10 ? f + 1 : f - 393) * pixels)
const seamOrder = [...Array.from({ length: 10 }, (_, i) => 404 + i), ...Array.from({ length: 10 }, (_, i) => i)]
const seamMotion = []
for (let i = 1; i < seamOrder.length; i++) {
  const a = frameAt(seamOrder[i - 1]), b = frameAt(seamOrder[i])
  let sum = 0
  for (let p = 0; p < pixels; p++) sum += Math.abs(a[p] - b[p])
  seamMotion.push({ from: seamOrder[i - 1], to: seamOrder[i], meanAbsLumaDiff: sum / pixels, duplicate: a.equals(b) })
}
if (seamMotion.some((s) => s.duplicate)) problems.push('Duplicate frame in the seam strip')
const preview = '<!doctype html><html><meta charset="utf-8"><title>Shoot the Moon loop review</title><body style="margin:0;background:#111"><video src="loop-13s-1280-titled.mp4" width="480" muted loop playsinline autoplay></video></body></html>\n'
writeFileSync(path.join(out, 'review.html'), preview)
const report = {
  schema: 'shootthemoon.loop-motion-qa/1',
  media: { width: v.width, height: v.height, fps: v.r_frame_rate, frames: Number(v.nb_read_frames), durationSec: Number(probe.format.duration), codec: v.codec_name, profile: v.profile, pixFmt: v.pix_fmt, colorSpace: v.color_space, colorRange: v.color_range, audioStreams: probe.streams.filter((s) => s.codec_type === 'audio').length, bytes: statSync(video).size, faststart, exactPTS: pts.frames.length === 414, firstFrameKeyframe: pts.frames[0].key_frame === 1 },
  alpha: { decodedFrames: alphaFrames.length, nonemptyFrames: alphaFrames.filter((f) => f.max > 0).length, legalRanges: [[81, 125], [216, 242], [333, 377]], protected: ranges, boundaries: boundaryFrames.map((f) => alphaFrames[f]), boundaryProof: 'cue-boundaries.png (rows L1, L2, L3; before, start, last, clear)', envelope, requiredEnvelope: [64, 545, 462, 636], pixelsOutsideEnvelope: outsidePixels },
  LP1: { endpoints: endpointChecks, frozenSource: 'actual lossless loop plate f324', frames: 90, steps: 89, method: 'Independent radial Lucas–Kanade registration on decoded pixels; no cue scale values used', minMotion, maxMotion, maxMinRatio: ratio, zeroMotionSteps: stepMotion.filter((m) => m === 0).length, coefficientOfVariation: Math.sqrt(stepMotion.reduce((sum, m) => sum + (m - meanMotion) ** 2, 0) / stepMotion.length) / meanMotion, phaseChecks, stepMotion, lumaDiagnostic: { min: Math.min(...lumaStepMotion), max: Math.max(...lumaStepMotion), ratio: Math.max(...lumaStepMotion) / Math.min(...lumaStepMotion), note: 'Photometric diagnostic only: 8-bit rounding near identity changes the first luma-difference amplitude; displacement is measured independently above.', steps: lumaStepMotion } },
  mobile: { frames: [110, 236, 355], widths: [600, 480, 400], review: 'See the nine exported PNGs; reading is a visual review.' },
  clearance: { L2: 'L2-clearance-all-frames.png (all 27 frames)', L3: 'L3-clearance-all-frames.png (all 45 frames)' },
  seam: { frames: seamOrder, titleAlphaMax: 0, motion: seamMotion, contactStrip: 'seam-f404-f413-f0-f9.png' },
  problems,
}
writeFileSync(path.join(qa, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n')
if (problems.length) throw new Error(problems.join('\n'))
console.log(JSON.stringify({ media: report.media, protectedAlpha: ranges, envelope, LP1: { endpoints: endpointChecks, minMotion, maxMotion, maxMinRatio: ratio, zeroMotionSteps: 0 }, seam: seamMotion.find((s) => s.from === 413) }, null, 2))
console.log(`DECODED LOOP QA VERIFIED — proofs in ${qa}`)
