#!/usr/bin/env node
/**
 * Separate review derivative; never builds or replaces release media.
 * Reuses the clean loop's verified sources, edit, decimation, transitions,
 * delivery scale and encode. The working plate is lossless; only delivery
 * is lossy. Titles are composited after the shared perspective push.
 *
 * node --experimental-strip-types --experimental-transform-types capture/titles/assembleTitledLoop.mjs \
 *   --dir=capture-final/run-6 --source=capture-final/run-6/source-run.json \
 *   --clean=capture-final/approved-deliverables/loop-13s-1280.mp4 \
 *   --titles=capture-final/loop-motion/titles/titles-track.mov \
 *   --out=capture-final/loop-motion
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkIntermediate, checkLoopTitlesCues, deliveryScale, loopMaxBytes, loopOutputArgs, loopPlateFilterGraph, planLoop, verifyAssemblyInputs } from '../ci/assembly.ts'
import { checkTitlesAlpha, checkTitlesProvenance, drawnFrames, titledChains, titlesInputFiles } from './titles.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([^=]+)=(.+)$/.exec(arg)
  if (!match) throw new Error(`Unknown argument ${arg}`)
  return [match[1], match[2]]
}))
for (const key of ['dir', 'source', 'clean', 'titles', 'out']) if (!args[key]) throw new Error(`--${key}=… is required`)
const cuesFile = 'capture/titles/loop-titles.cues.json'
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const requireSafe = (label, problems) => { if (problems.length) throw new Error(`${label}:\n  ${problems.join('\n  ')}`) }
const ffmpeg = (argv) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...argv], { stdio: 'inherit' })
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-threads', '1', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString())
const edit = readJson(path.join(repo, 'capture/finalEdit.json'))
const loop = planLoop(edit)
const cues = readJson(path.join(repo, cuesFile))
requireSafe('loop cues', checkLoopTitlesCues(loop, cues))
const { width, height, fps, frames } = cues.source
const source = readJson(args.source)
const pin = readJson(path.join(repo, 'capture/ci/reelRelease.json'))
if (source.headSha !== pin.headSha || source.runId !== pin.runId || source.repository !== pin.repository) throw new Error('Source run differs from the pinned release footage')
const renderedEdit = execFileSync('git', ['rev-parse', `${source.headSha}:capture/finalEdit.json`], { cwd: repo }).toString().trim()
const currentEdit = execFileSync('git', ['hash-object', 'capture/finalEdit.json'], { cwd: repo }).toString().trim()
if (renderedEdit !== currentEdit) throw new Error('finalEdit.json differs from the one the footage was rendered from')
const found = readdirSync(args.dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
const find = (name) => found.filter((entry) => entry.name === name).map((entry) => path.join(entry.parentPath, entry.name))
const manifests = find('reel-manifest.json')
if (manifests.length !== 1) throw new Error('Expected exactly one source reel manifest')
const reelManifest = readJson(manifests[0])
const located = find('clip.json').map((file) => {
  const record = readJson(file)
  const dir = path.relative(args.dir, path.dirname(file)).split(path.sep).join('/')
  const media = path.join(path.dirname(file), record.output.file)
  return { record, dir, actualSha256: existsSync(media) ? sha256(media) : null }
})
const verified = verifyAssemblyInputs(edit, source.headSha, reelManifest, located, find('FAILED.json'))
requireSafe('source intermediates', verified.problems)
const inputs = [], shots = new Map()
for (const segment of loop.sequence.segments) {
  const file = path.join(args.dir, verified.clipFiles.get(segment.id))
  const data = probe(file)
  const streams = data.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, pixFmt: s.pix_fmt, width: s.width, height: s.height, fps: Number(s.r_frame_rate.split('/')[0]) / Number(s.r_frame_rate.split('/')[1]), frames: Number(s.nb_read_frames) }))
  requireSafe(segment.id, checkIntermediate(edit, edit.timeline.find((clip) => clip.id === segment.id), streams))
  shots.set(segment.id, `${shots.size}:v`)
  inputs.push('-threads', '1', '-i', file)
}
const auditedClean = '9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864'
if (sha256(args.clean) !== auditedClean) throw new Error('Clean comparison differs from the loop audited in LOOP_MOTION_TREATMENT.md')
const trackManifestFile = path.join(path.dirname(args.titles), 'titles-manifest.json')
const trackManifest = readJson(trackManifestFile)
const titlePin = readJson(path.join(repo, 'capture/titles/titlesRelease.json'))
const inputHashes = Object.fromEntries(titlesInputFiles(cuesFile).map((file) => [file, sha256(path.join(repo, file))]))
requireSafe('titles provenance', checkTitlesProvenance(titlePin, inputHashes, trackManifest, sha256(args.titles), { file: cuesFile, fps, frames }))
const track = probe(args.titles)
const tv = track.streams[0]
if (track.streams.length !== 1 || tv.codec_name !== 'qtrle' || tv.pix_fmt !== 'argb' || tv.width !== width || tv.height !== height || tv.r_frame_rate !== `${fps}/1` || Number(tv.nb_read_frames) !== frames) throw new Error('Titles track dimensions, timing or format differ from the loop cues')
const alphaMaxima = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', args.titles, '-vf', 'alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-']).toString().split('\n').filter((line) => line.includes('YMAX=')).map((line) => Number(line.split('=')[1]))
requireSafe('decoded titles alpha', checkTitlesAlpha(cues, alphaMaxima))

mkdirSync(args.out, { recursive: true })
const output = path.join(args.out, 'loop-13s-1280-titled.mp4')
const cleanCopy = path.join(args.out, 'loop-13s-1280.mp4')
if (existsSync(output) || existsSync(cleanCopy)) throw new Error('Loop review output already exists; refusing to overwrite it')
const work = path.join(args.out, 'work')
mkdirSync(work, { recursive: true })
const base = path.join(work, 'loop-plate.mkv')
const baseGraph = loopPlateFilterGraph(loop, { shots, endCard: null, width: edit.output.width, height: edit.output.height })
writeFileSync(path.join(work, 'plate-filtergraph.txt'), baseGraph + '\n')
console.log('Loop plate: verified source intermediates -> clean loop recipe -> lossless 4:4:4 working file')
ffmpeg([...inputs, '-filter_complex_threads', '2', '-filter_complex', baseGraph, '-map', '[loopplate]', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-frames:v', String(frames), '-r', String(fps), '-fps_mode', 'cfr', '-c:v', 'ffv1', '-level', '3', '-threads', '2', '-pix_fmt', 'yuv444p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', base])
const baseProbe = probe(base)
const bv = baseProbe.streams[0]
if (baseProbe.streams.length !== 1 || bv.codec_name !== 'ffv1' || bv.pix_fmt !== 'yuv444p' || bv.width !== width || bv.height !== height || bv.r_frame_rate !== `${fps}/1` || Number(bv.nb_read_frames) !== frames) throw new Error('Lossless loop plate differs from the planned sequence')
const graph = [`[0:v]settb=1/${fps},setpts=N,format=yuv444p[plate]`, ...titledChains(cues, 'plate', '1:v', 'titled', fps), `[titled]${deliveryScale(width, height)}[out]`].join(';')
writeFileSync(path.join(work, 'titled-filtergraph.txt'), graph + '\n')
console.log('Titled loop: LP1 perspective push -> screen-fixed titles -> loopOutputArgs')
ffmpeg(['-threads', '1', '-i', base, '-threads', '1', '-i', args.titles, '-filter_complex_threads', '2', '-filter_complex', graph, '-map', '[out]', '-map_metadata', '-1', '-map_chapters', '-1', '-frames:v', String(frames), '-r', String(fps), '-fps_mode', 'cfr', ...loopOutputArgs(edit), '-threads', '2', output])
copyFileSync(args.clean, cleanCopy)
const finished = probe(output)
const v = finished.streams[0]
const problems = []
if (finished.streams.length !== 1 || v.codec_type !== 'video' || v.codec_name !== 'h264' || v.profile !== 'High' || v.width !== width || v.height !== height || v.r_frame_rate !== `${fps}/1` || v.avg_frame_rate !== `${fps}/1` || Number(v.nb_read_frames) !== frames || v.pix_fmt !== 'yuv420p') problems.push('Output video format differs from the locked target')
if (Number(finished.format.duration) !== frames / fps) problems.push('Output duration differs from the exact loop duration')
if (v.color_space !== 'bt709' || v.color_range !== 'tv' || v.color_transfer !== 'bt709' || v.color_primaries !== 'bt709') problems.push('Output color metadata differs from BT.709 limited range')
if (statSync(output).size > loopMaxBytes(edit)) problems.push('Output exceeds the loop byte budget')
const thumbnail = (file) => execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', file, '-vf', 'extractplanes=y,scale=64:36:flags=area:in_range=tv:out_range=tv', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'])
const a = thumbnail(args.clean), b = thumbnail(output), pixels = 64 * 36
const declared = new Set(drawnFrames(cues))
for (const move of cues.plateMoves) for (let f = move.from; f <= move.to; f++) declared.add(f)
let worst = { frame: -1, diff: 0 }
const diffs = []
for (let f = 0; f < frames; f++) {
  let sum = 0
  for (let i = f * pixels; i < (f + 1) * pixels; i++) sum += Math.abs(a[i] - b[i])
  const diff = sum / pixels
  diffs.push(diff)
  if (!declared.has(f)) {
    if (diff > worst.diff) worst = { frame: f, diff }
    if (diff > 4) problems.push(`Undeclared frame ${f} differs from clean by ${diff.toFixed(3)} levels (limit 4)`)
  }
}
const manifest = {
  schema: 'shootthemoon.titled-loop/1', method: 'verified intermediates -> unchanged loop assembly -> FFV1 working plate -> LP1 perspective -> titles -> loopOutputArgs',
  source: { record: args.source, sha256: sha256(args.source), reelManifestSha256: sha256(manifests[0]), headSha: source.headSha, clipIds: edit.derivatives.loop.clipIds, intermediates: loop.sequence.segments.map((s) => ({ clipId: s.id, sha256: located.find((l) => l.record.clipId === s.id).actualSha256 })) },
  finalEdit: { file: 'capture/finalEdit.json', sha256: sha256(path.join(repo, 'capture/finalEdit.json')) },
  clean: { file: path.basename(cleanCopy), source: args.clean, sha256: sha256(cleanCopy), unchanged: sha256(cleanCopy) === auditedClean },
  output: { file: path.basename(output), sha256: sha256(output), bytes: statSync(output).size, width, height, fps, frames: Number(v.nb_read_frames), durationSec: Number(finished.format.duration), codec: v.codec_name, pixFmt: v.pix_fmt, colorSpace: v.color_space, colorRange: v.color_range, audioStreams: 0 },
  plate: { file: path.relative(args.out, base), sha256: sha256(base), codec: 'ffv1', lossy: false },
  cues: { file: cuesFile, sha256: sha256(path.join(repo, cuesFile)), events: cues.events.map(({ id, from, to }) => ({ id, from, to })), plateMoves: cues.plateMoves },
  titles: { track: args.titles, manifestSha256: sha256(trackManifestFile), ...trackManifest, alphaFramesChecked: alphaMaxima.length },
  fidelity: { thumbnail: '64x36 limited-range luma', undeclaredFrames: frames - declared.size, worst, tolerance: 4, flashes: [[142, 146], [250, 254]].map(([from, to]) => ({ from, to, maxDiff: Math.max(...diffs.slice(from, to + 1)) })) },
  verified: problems.length === 0, problems,
}
writeFileSync(path.join(args.out, 'loop-motion-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
requireSafe('rendered output', problems)
console.log(`TITLED LOOP VERIFIED — ${output}: ${frames} frames, ${frames / fps}s, ${statSync(output).size} bytes; clean comparison kept byte-for-byte`)
