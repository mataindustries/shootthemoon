/** Option A only. Reads the original WAV without writing to it. No loudness
 * normalization, dynamics, denoise, pitch processing, music, or generated VO. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { INTERNAL_FADE_SAMPLES, joinKeepRanges, narrationPlan, NARRATION_RATE, SOURCE_RATE, validateSelects } from './narration.ts'

const source = path.resolve('capture-final/youtube/audio/source/shoot-the-moon-vo-session-01.wav')
const expectedHash = 'b1f9519450c98ab8792f63e355028476b21e16c065e278cb3aa8ad64209b96d8'
const out = path.resolve('capture-final/youtube/audio')
const hash = (buf) => createHash('sha256').update(buf).digest('hex')
const sourceHash = hash(readFileSync(source))
if (sourceHash !== expectedHash) throw new Error('raw WAV hash changed; refuse to edit')
const selectPath = 'capture/youtube/vo-selects.json'
const selects = JSON.parse(readFileSync(selectPath, 'utf8'))
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { encoding: 'utf8' }))
const stream = probe.streams[0]
if (probe.streams.length !== 1 || stream.codec_name !== 'pcm_s16le' || stream.channels !== 1 || stream.sample_rate !== '44100' || stream.duration_ts !== 19128516) throw new Error('raw WAV properties differ from verified session')
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-f', 's16le', '-c:a', 'pcm_s16le', '-'], { maxBuffer: 100_000_000 })
const problems = validateSelects(selects, pcm.length / 2)
if (problems.length) throw new Error(problems.join('\n'))
const plan = narrationPlan(selects)
const frames = selects.placements.A.frames * NARRATION_RATE / 60
const selected = new Float32Array(frames)
const mix = new Float32Array(frames)
const floats = (start, end) => {
  const f = new Float32Array(end - start)
  for (let i = 0; i < f.length; i++) f[i] = pcm.readInt16LE((start + i) * 2) / 32768
  return f
}
const asBuffer = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength)
const resample = (f) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(SOURCE_RATE), '-ac', '1', '-i', 'pipe:0',
    '-af', `aresample=${NARRATION_RATE}:resampler=soxr:precision=33`, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], { input: asBuffer(f), maxBuffer: 30_000_000 })
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
mkdirSync(path.join(out, 'lines'), { recursive: true })
const lines = []
for (let index = 0; index < selects.lines.length; index++) {
  const line = selects.lines[index], p = plan[index]
  const parts = line.select.keep.map((r) => floats(r.fromSample, r.toSample))
  const raw = new Float32Array(p.sourceSamples)
  let cursor = 0
  for (const part of parts) { raw.set(part, cursor); cursor += part.length }
  selected.set(resample(raw), p.startSample)
  const edit = joinKeepRanges(parts)
  const gain = 10 ** (line.clipGainDb / 20)
  const fadeIn = Math.round(0.010 * SOURCE_RATE), fadeOut = Math.round(0.030 * SOURCE_RATE)
  for (let i = 0; i < edit.length; i++) {
    const envelope = Math.min(1, i / (fadeIn - 1), (edit.length - 1 - i) / (fadeOut - 1))
    edit[i] *= gain * envelope
  }
  const conformed = resample(edit)
  // soxr's flush may round by a sample. Conform its tail only, never move
  // words or scale time. The selected tail is room tone, already faded out.
  const shaped = new Float32Array(p.outputSamples)
  shaped.set(conformed.subarray(0, shaped.length))
  mix.set(shaped, p.startSample)
  const lineFile = path.join(out, 'lines', `${line.id}-take-${p.take}.wav`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(NARRATION_RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'pcm_s24le', lineFile], { input: asBuffer(shaped) })
  let lineOffset = 0
  const ranges = line.select.keep.map((r, i) => {
    const offset = lineOffset - (i ? INTERNAL_FADE_SAMPLES : 0)
    lineOffset = offset + r.toSample - r.fromSample
    return { ...r, semantics: '[fromSample,toSample)', sourcePcmSha256: hash(pcm.subarray(r.fromSample * 2, r.toSample * 2)),
      editedLineSourceSampleOffset: offset, crossfadeInSamples: i ? INTERNAL_FADE_SAMPLES : 0,
      filmOutputSampleOffset: p.startSample + Math.round(offset * NARRATION_RATE / SOURCE_RATE) }
  })
  lines.push({ ...p, text: line.selectedText, clipGainDb: line.clipGainDb, ranges,
    soxrTailAdjustmentSamples: p.outputSamples - conformed.length,
    file: path.relative(out, lineFile), sha256: hash(readFileSync(lineFile)) })
  console.log(`${line.id} take ${p.take}: ${(p.outputSamples / NARRATION_RATE).toFixed(6)}s at ${(p.startSample / NARRATION_RATE).toFixed(3)}s`)
}

// Continuous original room tone under the narration span. Repeated tone is
// joined with 200ms equal-power crossfades; no noise gate or synthetic fill.
const toneIn = Math.round(selects.roomTone.sourceIn * SOURCE_RATE), toneOut = Math.round(selects.roomTone.sourceOut * SOURCE_RATE)
const tone = resample(floats(toneIn, toneOut))
const crossfade = Math.round(0.2 * NARRATION_RATE)
const toneStart = plan[0].startSample - Math.round(0.5 * NARRATION_RATE)
const toneEnd = plan.at(-1).endSample + Math.round(0.5 * NARRATION_RATE)
const bed = new Float32Array(toneEnd - toneStart)
bed.set(tone.subarray(0, bed.length))
for (let start = tone.length - crossfade; start < bed.length; start += tone.length - crossfade) {
  for (let i = 0; i < Math.min(tone.length, bed.length - start); i++) {
    if (i < crossfade) {
      const a = i * Math.PI / (2 * (crossfade - 1))
      bed[start + i] = bed[start + i] * Math.cos(a) + tone[i] * Math.sin(a)
    } else bed[start + i] = tone[i]
  }
}
for (let i = 0; i < bed.length; i++) mix[toneStart + i] += bed[i] * Math.min(1, i / 479, (bed.length - 1 - i) / 1439)

const writeWav = (name, samples, filter) => {
  const file = path.join(out, name)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(NARRATION_RATE), '-ac', '1', '-i', 'pipe:0',
    ...(filter ? ['-af', filter] : []), '-c:a', 'pcm_s24le', file], { input: asBuffer(samples), maxBuffer: 50_000_000 })
  return { file: name, bytes: readFileSync(file).length, sha256: hash(readFileSync(file)), samples: samples.length, durationS: samples.length / NARRATION_RATE }
}
const outputs = {
  selected: writeWav('narration-selected.wav', selected),
  mix: writeWav('narration-mix.wav', mix, 'highpass=f=80:p=2'),
}
if (hash(readFileSync(source)) !== expectedHash) throw new Error('source changed during assembly')
const manifest = {
  schema: 'shootthemoon.youtube-narration/1', option: 'A',
  source: { file: path.relative(process.cwd(), source), sha256: sourceHash, pcmSha256: hash(pcm), frames: pcm.length / 2, sampleRate: SOURCE_RATE, bitDepth: 16, channels: 1, durationS: pcm.length / 2 / SOURCE_RATE,
    selectsContainer: 'FLAC hash in vo-selects.json refers to the earlier lossless review container. The user authorized this original WAV; source ranges address its 44.1kHz PCM samples.' },
  selects: { file: selectPath, sha256: hash(readFileSync(selectPath)) },
  processing: { selected: 'unprocessed keep ranges, conformed to the film at 48kHz; the three pause edits are hard joins in this intermediate only',
    clipGainDb: Object.fromEntries(selects.lines.map((l) => [l.id, l.clipGainDb])),
    fadeInSamples44100: 441, fadeOutSamples44100: 1323,
    pauseCrossfade: { samples44100: INTERNAL_FADE_SAMPLES, durationS: INTERNAL_FADE_SAMPLES / SOURCE_RATE, curve: 'equal power', lines: ['L07', 'L11', 'L15'] },
    resampling: 'libsoxr, precision 33 (very high quality), 44100 to 48000; no time stretch',
    roomTone: { fromSample: toneIn, toSample: toneOut, sourcePcmSha256: hash(pcm.subarray(toneIn * 2, toneOut * 2)), gainDb: 0, fromOutputSample: toneStart, toOutputSample: toneEnd, loopCrossfadeSamples48000: crossfade, curve: 'equal power', fadeInMs: 10, fadeOutMs: 30 },
    highpass: 'one FFmpeg highpass=f=80:p=2 (12dB/octave), across entire mixed stem including room tone',
    dynamics: 'none', loudnessNormalization: 'none', music: false, gameAudio: false },
  exactSelectedKeepDurationS: plan.reduce((n, p) => n + p.sourceSamples, 0) / SOURCE_RATE,
  exactEditedNarrationSamples48000: plan.reduce((n, p) => n + p.outputSamples, 0),
  exactEditedNarrationDurationS: plan.reduce((n, p) => n + p.outputSamples, 0) / NARRATION_RATE,
  firstLineS: plan[0].startSample / NARRATION_RATE, lastLineEndS: plan.at(-1).endSample / NARRATION_RATE,
  lines, outputs,
}
writeFileSync(path.join(out, 'narration-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`NARRATION ASSEMBLED: ${manifest.exactEditedNarrationDurationS.toFixed(6)}s of edited narration on a ${frames / NARRATION_RATE}s film stem`)
