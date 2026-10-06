import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { narrationPlan, NARRATION_RATE, validateSelects } from './narration.ts'

const out = path.resolve('capture-final/youtube'), qa = path.join(out, 'qa')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const fileSha = (p) => sha(readFileSync(p))
const selects = read('capture/youtube/vo-selects.json'), film = read('capture/youtube/youtube-film.json')
const manifest = read(path.join(out, 'audio/narration-manifest.json'))
const source = path.resolve(manifest.source.file)
const probe = (p) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p], { encoding: 'utf8' }))
const decode = (p, rate = 48000) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-ar', String(rate), '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 100_000_000 })
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
const report = { schema: 'shootthemoon.youtube-vo-qa/1', checks: {}, failures: [] }
const check = (name, ok, detail = {}) => {
  report.checks[name] = { ok, ...detail }
  if (!ok) report.failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}
check('raw source hash unchanged and selects pinned', fileSha(source) === film.narration.source.sha256 && manifest.source.sha256 === film.narration.source.sha256 && manifest.selects.sha256 === fileSha(film.narration.selects), { source: manifest.source })
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-f', 's16le', '-c:a', 'pcm_s16le', '-'], { maxBuffer: 100_000_000 })
let sourcePeak = 0, sourceClipped = 0
for (let i = 0; i < pcm.length; i += 2) { const s = pcm.readInt16LE(i); sourcePeak = Math.max(sourcePeak, Math.abs(s)); if (s >= 32767 || s <= -32768) sourceClipped++ }
check('source properties and zero clipping', sourceClipped === 0 && probe(source).streams[0].sample_rate === '44100' && pcm.length / 2 === 19128516, { peakDbfs: 20 * Math.log10(sourcePeak / 32768), clippedSamples: sourceClipped })
const ranges = manifest.lines.flatMap((l) => l.ranges.map((r) => ({ id: l.id, take: l.take, fromSample: r.fromSample, toSample: r.toSample, matchesSource: sha(pcm.subarray(r.fromSample * 2, r.toSample * 2)) === r.sourcePcmSha256 })))
check('every retained range resolves to original WAV samples', validateSelects(selects, pcm.length / 2).length === 0 && ranges.length === 24 && ranges.every((r) => r.matchesSource), { ranges })
const plans = narrationPlan(selects)
check('all 21 selected takes, wording and sample placements; no overlaps or padding', plans.length === manifest.lines.length && plans.every((p, i) => p.id === manifest.lines[i].id && p.take === manifest.lines[i].take && p.startSample === manifest.lines[i].startSample && p.endSample === manifest.lines[i].endSample && (i === 0 || p.startSample >= plans[i - 1].endSample)), { editedNarrationDurationS: manifest.exactEditedNarrationDurationS, firstLineS: manifest.firstLineS, lastLineEndS: manifest.lastLineEndS })
for (const [kind, output] of Object.entries(manifest.outputs)) {
  const file = path.join(out, 'audio', output.file)
  const p = probe(file), s = p.streams[0]
  check(`${kind} output remains pinned, mono 48kHz 24-bit PCM, at exact film length`,
    fileSha(file) === output.sha256 && p.streams.length === 1 && s.codec_name === 'pcm_s24le' && s.sample_rate === '48000' && s.channels === 1 &&
    Number(p.format.duration) === film.output.frames / 60 && output.samples === film.output.frames * NARRATION_RATE / 60,
    { file: output.file, sha256: output.sha256, durationS: Number(p.format.duration) })
}
const samples = decode(path.join(out, 'audio/narration-mix.wav'))
let peak = 0, clipped = 0
for (const s of samples) { peak = Math.max(peak, Math.abs(s)); if (Math.abs(s) >= 1) clipped++ }
check('mix is 48kHz mono 24-bit PCM and exact film length', probe(path.join(out, 'audio/narration-mix.wav')).streams[0].codec_name === 'pcm_s24le' && samples.length === film.output.frames * NARRATION_RATE / 60, { samples: samples.length, durationS: samples.length / NARRATION_RATE })
check('mixed narration has no clipped samples', clipped === 0, { peakDbfs: 20 * Math.log10(peak), clippedSamples: clipped })
const boundaries = []
for (const l of manifest.lines) {
  const points = [l.startSample, l.endSample]
  for (const r of l.ranges.slice(1)) { points.push(r.filmOutputSampleOffset, r.filmOutputSampleOffset + Math.round(r.crossfadeInSamples * NARRATION_RATE / 44100)) }
  for (const at of points) {
    const delta = Math.abs(samples[at] - samples[at - 1])
    boundaries.push({ id: l.id, outputSample: at, adjacentSampleStep: delta, stepDbfs: delta === 0 ? null : 20 * Math.log10(delta) })
  }
}
check('edit boundaries have no abrupt digital steps/clicks', boundaries.every((b) => b.adjacentSampleStep < 0.003), { limitAmplitude: 0.003, note: 'Measured exact line edges and both ends of each pause crossfade in the delivered PCM; human playback remains the final performance judgement.', boundaries })
const room = manifest.processing.roomTone
const gaps = plans.slice(1).map((p, i) => {
  const start = plans[i].endSample + 480, end = p.startSample - 480
  let power = 0
  for (let s = start; s < end; s++) power += samples[s] ** 2
  return { after: plans[i].id, before: p.id, rmsDbfs: 10 * Math.log10(power / (end - start)) }
})
check('original room tone remains continuous between narration lines', gaps.every((g) => Number.isFinite(g.rmsDbfs) && g.rmsDbfs > -100) && room.sourcePcmSha256 === sha(pcm.subarray(room.fromSample * 2, room.toSample * 2)), { gaps, roomTone: room })
const measure = (file, fromS, durationS) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...(fromS === undefined ? [] : ['-ss', String(fromS), '-t', String(durationS)]), '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 2_000_000 })
  if (r.status !== 0) throw new Error(`audio measurement failed: ${r.stderr}`)
  const summary = r.stderr.slice(r.stderr.lastIndexOf('Summary:'))
  return { integratedLufs: Number(/I:\s*([-\d.]+) LUFS/.exec(summary)?.[1]), truePeakDbfs: Number(/Peak:\s*([-\d.]+) dBFS/.exec(summary)?.[1]) }
}
const mixLevels = measure(path.join(out, 'audio/narration-mix.wav'))
const lineLevels = manifest.lines.map((l) => ({ id: l.id, take: l.take, ...measure(path.join(out, 'audio/narration-mix.wav'), l.startSample / NARRATION_RATE, l.outputSamples / NARRATION_RATE) }))
check('true peak remains below clipping without a limiter', mixLevels.truePeakDbfs < 0 && lineLevels.every((l) => l.truePeakDbfs < 0), { mix: mixLevels, lines: lineLevels })
for (const l of manifest.lines) check(`line file pinned: ${l.id}`, fileSha(path.join(out, 'audio', l.file)) === l.sha256)
check('processing restricted to selects, fades, tone, resampling and one 80Hz highpass', manifest.processing.dynamics === 'none' && manifest.processing.loudnessNormalization === 'none' && manifest.processing.music === false && manifest.processing.gameAudio === false && manifest.processing.pauseCrossfade.lines.join(',') === 'L07,L11,L15', { processing: manifest.processing })
const master = path.join(out, 'shoot-the-moon-vo-picture-lock.mp4')
if (existsSync(master)) {
  const streams = probe(master).streams, video = streams.find((s) => s.codec_type === 'video'), audio = streams.filter((s) => s.codec_type === 'audio')
  check('master has one 48kHz AAC narration stream, no music stream, and aligned audio/video duration', audio.length === 1 && audio[0].codec_name === 'aac' && audio[0].sample_rate === '48000' && audio[0].channels === 1 && Math.abs(Number(audio[0].duration) - Number(video.duration)) < 0.002, { audio, videoDurationS: video.duration })
  const decoded = decode(master), n = Math.min(decoded.length, samples.length)
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < n; i++) { ab += samples[i] * decoded[i]; aa += samples[i] ** 2; bb += decoded[i] ** 2 }
  const correlation = ab / Math.sqrt(aa * bb)
  check('master audio is the verified narration mix (AAC fidelity; no added music/audio)', correlation > 0.99, { correlation, decodedSamples: decoded.length, pcmSamples: samples.length })
  let masterPeak = 0, masterClips = 0
  for (const s of decoded) { masterPeak = Math.max(masterPeak, Math.abs(s)); if (Math.abs(s) >= 1) masterClips++ }
  const masterLevels = measure(master)
  check('encoded AAC narration has no sample or true-peak clipping', masterClips === 0 && masterLevels.truePeakDbfs < 0, { peakDbfs: 20 * Math.log10(masterPeak), clippedSamples: masterClips, ...masterLevels })
}
report.ok = report.failures.length === 0
writeFileSync(path.join(qa, 'vo-qa-report.json'), JSON.stringify(report, null, 2) + '\n')
process.exit(report.ok ? 0 : 1)
