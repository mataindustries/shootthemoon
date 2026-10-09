/**
 * PCM16 codec and the pure loop/stinger operations, on tiny deterministic
 * fixtures (a 4-bar "cycle" of 64 frames) plus full-size buffers where the
 * real frame counts matter.
 *
 *   node --experimental-strip-types --test scripts/music/pcm.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { synthesizeLoopRender, synthesizeStinger } from './fixtures.ts'
import { GUARD_FRAMES, GUARDED_LOOP_FRAMES, LOOP_FRAMES, type LoopGeometry, loopRegions, STINGER_SPECS, STINGER_TAIL_FRAMES } from './musicSpec.ts'
import {
  buildGuardedLoop,
  buildGuardedStinger,
  dualMono,
  extractProductionCycle,
  extractProofCycle,
  foldToMono,
  provePeriodicity,
  sampleLevels,
  sliceFrames,
  stereoCorrelation,
  tailRmsDbfs,
  verifyGuardedLoop,
} from './pcm.ts'
import { encodeWav, parseWav, type Pcm16, WavFormatError } from './wav.ts'

const TINY: LoopGeometry = { framesPerBeat: 4, beatsPerBar: 4, cycleFrames: 64, cycles: 3, guardFrames: 3 }

/** Three cycles where sample value encodes (cycle, frame, channel) unless `periodic`. */
function tinyRender(periodic: boolean): Pcm16 {
  const frames = TINY.cycleFrames * TINY.cycles
  const samples = new Int16Array(frames * 2)
  for (let frame = 0; frame < frames; frame++) {
    const cycle = Math.floor(frame / TINY.cycleFrames)
    const position = frame % TINY.cycleFrames
    samples[2 * frame] = (periodic ? 0 : cycle * 1000) + position * 10
    samples[2 * frame + 1] = (periodic ? 0 : cycle * 1000) + position * 10 + 1
  }
  return { sampleRate: 44_100, channels: 2, frames, samples }
}

const frameAt = (audio: Pcm16, frame: number) => [audio.samples[2 * frame], audio.samples[2 * frame + 1]]

// ---------------------------------------------------------------------------
// WAV codec
// ---------------------------------------------------------------------------

test('WAV round trip is byte-stable and frame-exact', () => {
  const audio = tinyRender(true)
  const bytes = encodeWav(audio)
  const parsed = parseWav(bytes, 'tiny')
  assert.equal(parsed.frames, audio.frames)
  assert.equal(parsed.channels, 2)
  assert.deepEqual(parsed.samples, audio.samples)
  assert.deepEqual(encodeWav(parsed), bytes)
})

test('WAV parser rejects unsupported formats loudly', () => {
  const good = encodeWav(tinyRender(true))
  const float = Buffer.from(good)
  float.writeUInt16LE(3, 20)
  assert.throws(() => parseWav(float, 'f.wav'), (error: unknown) => error instanceof WavFormatError && /format tag 0x3/.test(error.message))
  const deep = Buffer.from(good)
  deep.writeUInt16LE(24, 34)
  assert.throws(() => parseWav(deep, 'd.wav'), /24-bit PCM/)
  assert.throws(() => parseWav(Buffer.from('not a wav at all'), 'x.wav'), /not a RIFF\/WAVE/)
  assert.throws(() => parseWav(good.subarray(0, good.length - 10), 't.wav'), /truncated data chunk/)
  const odd = Buffer.from(good)
  odd.writeUInt32LE(good.readUInt32LE(40) - 2, 40)
  assert.throws(() => parseWav(odd, 'o.wav'), /not a whole number of frames/)
})

test('WAV parser accepts WAVE_FORMAT_EXTENSIBLE PCM and skips unknown chunks', () => {
  const audio = tinyRender(true)
  const data = Buffer.from(audio.samples.buffer)
  const fmt = Buffer.alloc(40)
  fmt.writeUInt16LE(0xfffe, 0)
  fmt.writeUInt16LE(2, 2)
  fmt.writeUInt32LE(44_100, 4)
  fmt.writeUInt32LE(44_100 * 4, 8)
  fmt.writeUInt16LE(4, 12)
  fmt.writeUInt16LE(16, 14)
  fmt.writeUInt16LE(22, 16)
  fmt.writeUInt16LE(16, 18)
  fmt.writeUInt32LE(3, 20)
  Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(fmt, 24)
  const chunk = (id: string, body: Buffer) => {
    const header = Buffer.alloc(8)
    header.write(id, 0, 'ascii')
    header.writeUInt32LE(body.length, 4)
    return Buffer.concat([header, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
  }
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('LIST', Buffer.from('odd')), chunk('data', data)])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  const parsed = parseWav(Buffer.concat([riff, body]), 'ext.wav')
  assert.equal(parsed.frames, audio.frames)
  assert.deepEqual(parsed.samples, audio.samples)
})

// ---------------------------------------------------------------------------
// Cycle extraction
// ---------------------------------------------------------------------------

test('cycle 2 and cycle 3 extraction are frame-exact', () => {
  const render = tinyRender(false)
  const cycle2 = extractProductionCycle(render, TINY)
  const cycle3 = extractProofCycle(render, TINY)
  assert.equal(cycle2.frames, 64)
  assert.deepEqual(frameAt(cycle2, 0), [1000, 1001]) // cycle index 1, position 0
  assert.deepEqual(frameAt(cycle2, 63), [1630, 1631])
  assert.deepEqual(frameAt(cycle3, 0), [2000, 2001])
  assert.throws(() => sliceFrames(render, 190, 3), RangeError)
})

test('full-size extraction: production loop is exactly 1,693,440 frames starting at frame 1,693,440', () => {
  const render = synthesizeLoopRender('bed')
  assert.equal(render.frames, 5_080_320)
  const crop = extractProductionCycle(render)
  assert.equal(crop.frames, LOOP_FRAMES)
  assert.deepEqual(crop.samples.subarray(0, 64), render.samples.subarray(LOOP_FRAMES * 2, LOOP_FRAMES * 2 + 64))
  assert.deepEqual(extractProofCycle(render).samples, crop.samples)
})

// ---------------------------------------------------------------------------
// Periodicity
// ---------------------------------------------------------------------------

test('periodicity: identical cycles pass and are recognized as exact', () => {
  const report = provePeriodicity(tinyRender(true), TINY)
  assert.equal(report.pass, true)
  assert.equal(report.identical, true)
  assert.equal(report.cycle.maxAbsDeltaLsb, 0)
  assert.equal(report.cycle.maxDelta, null)
  assert.equal(report.boundary.wrapMismatchLsb, 0)
})

test('periodicity: a 1 LSB difference passes but is not identical', () => {
  const render = tinyRender(true)
  render.samples[2 * (128 + 10)] = (render.samples[2 * (128 + 10)] as number) + 1
  const report = provePeriodicity(render, TINY)
  assert.equal(report.pass, true)
  assert.equal(report.identical, false)
  assert.equal(report.cycle.maxAbsDeltaLsb, 1)
})

test('periodicity: a known defect fails with its exact location, RMS and per-bar map', () => {
  const render = tinyRender(true)
  // +40 LSB on the right channel of cycle 3, frame 37 (bar 3 beat 2 +1).
  render.samples[2 * (128 + 37) + 1] = (render.samples[2 * (128 + 37) + 1] as number) + 40
  const report = provePeriodicity(render, TINY)
  assert.equal(report.pass, false)
  assert.equal(report.cycle.maxAbsDeltaLsb, 40)
  assert.deepEqual(report.cycle.maxDelta, { frame: 37, channel: 1, a: 371, b: 411 })
  assert.equal(report.cycle.maxDeltaSourceFrame, 64 + 37)
  assert.equal(report.cycle.maxDeltaPosition, 'bar 3 beat 2 +1 frames')
  assert.equal(report.cycle.differingSamples, 1)
  assert.equal(report.cycle.firstDifferingFrame, 37)
  assert.equal(report.cycle.rmsDeltaLsb, Math.round(Math.sqrt(1600 / 128) * 1e6) / 1e6)
  assert.deepEqual(report.perBarMaxAbsDeltaLsb, [0, 0, 40, 0])
})

test('periodicity: a cycle-1 tail that differs in the pre-guard fails on its own', () => {
  const render = tinyRender(true)
  render.samples[2 * 62] = 9999 // cycle 1, inside [c2 − guard, c2)
  const report = provePeriodicity(render, TINY)
  assert.equal(report.cycle.maxAbsDeltaLsb, 0)
  assert.equal(report.preGuard.maxAbsDeltaLsb, 9999 - 620)
  assert.equal(report.pass, false)
})

test('periodicity: boundary metrics around cycle 2 end → cycle 3 start', () => {
  const report = provePeriodicity(tinyRender(false), TINY)
  // Non-periodic ramp: render steps 1630 → 2000 (+370) at the seam, the loop wraps 1630 → 1000 (−630).
  assert.equal(report.boundary.renderSeamStepLsb, 370)
  assert.equal(report.boundary.loopWrapStepLsb, 630)
  assert.equal(report.boundary.wrapMismatchLsb, 1000)
  const periodic = provePeriodicity(tinyRender(true), TINY)
  assert.equal(periodic.boundary.renderSeamStepLsb, periodic.boundary.loopWrapStepLsb)
})

test('periodicity rejects a render of the wrong length', () => {
  assert.throws(() => provePeriodicity(sliceFrames(tinyRender(true), 0, 191), TINY), /exactly 192 frames/)
})

// ---------------------------------------------------------------------------
// Channel delivery
// ---------------------------------------------------------------------------

test('mono fold-down averages L and R (half to even), never drops a channel', () => {
  const stereo: Pcm16 = { sampleRate: 44_100, channels: 2, frames: 6, samples: Int16Array.from([100, 100, 100, 0, 1, 2, 3, 4, -3, -2, 32767, -32768]) }
  const mono = foldToMono(stereo)
  assert.equal(mono.channels, 1)
  assert.equal(mono.frames, 6)
  // 100, 50, 1.5→2, 3.5→4, −2.5→−2, −0.5→0 (round half to even)
  assert.deepEqual([...mono.samples], [100, 50, 2, 4, -2, 0])
  assert.throws(() => foldToMono(mono), /needs stereo/)
})

test('mono fold-down of dual-mono is lossless, and dualMono restores the canonical layout', () => {
  const render = extractProductionCycle(synthesizeLoopRender('engine'))
  const mono = foldToMono(render)
  assert.deepEqual(dualMono(mono).samples, render.samples)
  assert.equal(stereoCorrelation(render), 1)
})

test('stereo correlation distinguishes centered, independent and silent channels', () => {
  const frames = 4410
  const make = (fn: (i: number) => [number, number]): Pcm16 => {
    const samples = new Int16Array(frames * 2)
    for (let i = 0; i < frames; i++) [samples[2 * i], samples[2 * i + 1]] = fn(i).map((x) => Math.round(x * 10000)) as [number, number]
    return { sampleRate: 44_100, channels: 2, frames, samples }
  }
  assert.ok(stereoCorrelation(make((i) => [Math.sin(i / 7), Math.sin(i / 7)])) > 0.9999)
  assert.ok(stereoCorrelation(make((i) => [Math.sin(i / 7), -Math.sin(i / 7)])) < -0.9999)
  assert.ok(Math.abs(stereoCorrelation(make((i) => [Math.sin(i / 7), Math.sin(i / 3.1)]))) < 0.05)
  assert.equal(stereoCorrelation(make(() => [0, 0])), 1)
  assert.equal(stereoCorrelation(make((i) => [Math.sin(i / 7), 0])), 0)
})

test('stereo layers keep both distinct channels through the guarded master', () => {
  const render = synthesizeLoopRender('bed')
  const guarded = buildGuardedLoop(render)
  assert.equal(guarded.channels, 2)
  let different = 0
  for (let i = 0; i < 2000; i++) if (guarded.samples[2 * i] !== guarded.samples[2 * i + 1]) different++
  assert.ok(different > 1000, 'L and R are preserved, not folded')
})

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('loop guards are the neighboring cycles: cycle-1 tail, cycle 2, cycle-3 head', () => {
  const render = tinyRender(false)
  const guarded = buildGuardedLoop(render, TINY)
  assert.equal(guarded.frames, 64 + 2 * 3)
  assert.deepEqual(frameAt(guarded, 0), [610, 611]) // cycle 1, position 61
  assert.deepEqual(frameAt(guarded, 2), [630, 631]) // cycle 1, position 63
  assert.deepEqual(frameAt(guarded, 3), [1000, 1001]) // loop start: cycle 2, position 0
  assert.deepEqual(frameAt(guarded, 66), [1630, 1631]) // loop end − 1
  assert.deepEqual(frameAt(guarded, 67), [2000, 2001]) // post-guard: cycle 3, position 0
  assert.ok(guarded.samples.every((value) => value !== 0), 'no silence was inserted')
})

test('full-size guarded loop: 1,711,080 frames, content bit-identical to cycle 2, guards match the loop seam', () => {
  const render = synthesizeLoopRender('claim')
  const guarded = buildGuardedLoop(render)
  const crop = extractProductionCycle(render)
  assert.equal(guarded.frames, GUARDED_LOOP_FRAMES)
  assert.deepEqual(verifyGuardedLoop(guarded, crop), [])
  const regions = loopRegions()
  assert.deepEqual(guarded.samples.subarray(0, 8), render.samples.subarray(regions.preGuard.start * 2, regions.preGuard.start * 2 + 8))
  // Runtime loopStart/loopEnd land on exact frames 8,820 and 1,702,260.
  assert.equal(0.2 * 44_100, GUARD_FRAMES)
  assert.equal(GUARD_FRAMES + LOOP_FRAMES, 1_702_260)
})

test('verifyGuardedLoop flags guards that are not neighboring audio', () => {
  const render = synthesizeLoopRender('bed')
  const crop = extractProductionCycle(render)
  const silentGuards = buildGuardedStinger(crop, GUARD_FRAMES)
  const problems = verifyGuardedLoop(silentGuards, crop)
  assert.equal(problems.length, 2)
  assert.match(problems[0] as string, /pre-guard/)
  assert.match(problems[1] as string, /post-guard/)
})

test('stinger guards are 8,820 zero frames on both sides of the untouched content', () => {
  const spec = STINGER_SPECS[1]!
  const content = synthesizeStinger(spec)
  const guarded = buildGuardedStinger(content, GUARD_FRAMES)
  assert.equal(guarded.frames, content.frames + 2 * GUARD_FRAMES)
  assert.ok(guarded.samples.subarray(0, GUARD_FRAMES * 2).every((value) => value === 0))
  assert.ok(guarded.samples.subarray(guarded.samples.length - GUARD_FRAMES * 2).every((value) => value === 0))
  assert.deepEqual(guarded.samples.subarray(GUARD_FRAMES * 2, GUARD_FRAMES * 2 + content.samples.length), content.samples)
})

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

test('final-100-ms RMS: silence passes, a sustained tail is measured exactly', () => {
  const spec = STINGER_SPECS[2]!
  const clean = synthesizeStinger(spec)
  assert.equal(tailRmsDbfs(clean, STINGER_TAIL_FRAMES), null)
  const loud = synthesizeStinger(spec)
  // A full-scale-relative 0.01 square wave in the last 100 ms: exactly −40 dBFS RMS.
  for (let i = loud.samples.length - STINGER_TAIL_FRAMES * 2; i < loud.samples.length; i++) loud.samples[i] = i % 4 < 2 ? 328 : -328
  const rms = tailRmsDbfs(loud, STINGER_TAIL_FRAMES) as number
  assert.ok(Math.abs(rms - 20 * Math.log10(328 / 32768)) < 1e-9)
  assert.ok(rms > -60)
  // Just under the gate: 0.0009 full scale ≈ −60.9 dBFS.
  for (let i = loud.samples.length - STINGER_TAIL_FRAMES * 2; i < loud.samples.length; i++) loud.samples[i] = i % 4 < 2 ? 29 : -29
  assert.ok((tailRmsDbfs(loud, STINGER_TAIL_FRAMES) as number) <= -60)
})

test('sample levels report peak, RMS and PCM16 clipping', () => {
  const audio: Pcm16 = { sampleRate: 44_100, channels: 2, frames: 2, samples: Int16Array.from([16384, -16384, 32767, -32768]) }
  const levels = sampleLevels(audio)
  assert.equal(levels.samplePeakDbfs, 0)
  assert.equal(levels.fullScaleSamples, 2)
  assert.equal(levels.clipping, true)
  assert.equal(sampleLevels({ ...audio, samples: new Int16Array(4) }).samplePeakDbfs, null)
})
