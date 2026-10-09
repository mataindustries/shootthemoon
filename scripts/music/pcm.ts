/**
 * Pure PCM16 operations for the music asset pipeline: frame-exact slicing,
 * the cycle-2 ≡ cycle-3 periodicity proof, mono fold-down, guard-band
 * construction and level metrics. Everything is integer frame addressing:
 * no floating-point timestamps anywhere.
 */
import {
  describeCycleFrame,
  LOOP_GEOMETRY,
  type LoopGeometry,
  loopRegions,
  PERIODICITY_TOLERANCE_LSB,
} from './musicSpec.ts'
import type { Pcm16 } from './wav.ts'

const FULL_SCALE = 32768

export function dbfs(linear: number): number | null {
  return linear > 0 ? 20 * Math.log10(linear) : null
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Frames [start, start + count) as a new buffer; throws if out of range. */
export function sliceFrames(audio: Pcm16, start: number, count: number): Pcm16 {
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > audio.frames) {
    throw new RangeError(`frame range [${start}, ${start + count}) is outside 0..${audio.frames}`)
  }
  const channels = audio.channels
  return {
    sampleRate: audio.sampleRate,
    channels,
    frames: count,
    samples: audio.samples.slice(start * channels, (start + count) * channels),
  }
}

export function concatFrames(parts: readonly Pcm16[]): Pcm16 {
  const first = parts[0]
  if (!first) throw new Error('nothing to concatenate')
  for (const part of parts) {
    if (part.channels !== first.channels || part.sampleRate !== first.sampleRate) throw new Error('cannot concatenate mismatched PCM')
  }
  const frames = parts.reduce((sum, part) => sum + part.frames, 0)
  const samples = new Int16Array(frames * first.channels)
  let offset = 0
  for (const part of parts) {
    samples.set(part.samples, offset)
    offset += part.samples.length
  }
  return { sampleRate: first.sampleRate, channels: first.channels, frames, samples }
}

export function silence(frames: number, channels: number, sampleRate: number): Pcm16 {
  return { sampleRate, channels, frames, samples: new Int16Array(frames * channels) }
}

// ---------------------------------------------------------------------------
// Periodicity proof
// ---------------------------------------------------------------------------

export interface RegionDiff {
  readonly frames: number
  readonly maxAbsDeltaLsb: number
  readonly rmsDeltaLsb: number
  readonly rmsDeltaDbfs: number | null
  readonly differingSamples: number
  /** Frame offsets relative to the start of the compared region. */
  readonly firstDifferingFrame: number | null
  readonly lastDifferingFrame: number | null
  readonly maxDelta: { readonly frame: number; readonly channel: number; readonly a: number; readonly b: number } | null
}

/** Sample-by-sample comparison of `frames` frames: a from aStart against b from bStart. */
export function diffRegions(a: Pcm16, aStart: number, b: Pcm16, bStart: number, frames: number): RegionDiff {
  if (a.channels !== b.channels) throw new Error('cannot diff audio with different channel counts')
  const channels = a.channels
  if (aStart < 0 || bStart < 0 || aStart + frames > a.frames || bStart + frames > b.frames) throw new RangeError('diff region outside the audio')
  let maxAbs = 0
  let maxIndex = -1
  let sumSquares = 0
  let differing = 0
  let firstIndex = -1
  let lastIndex = -1
  const aBase = aStart * channels
  const bBase = bStart * channels
  const count = frames * channels
  for (let i = 0; i < count; i++) {
    const delta = (a.samples[aBase + i] as number) - (b.samples[bBase + i] as number)
    if (delta !== 0) {
      const abs = delta < 0 ? -delta : delta
      differing++
      sumSquares += delta * delta
      if (firstIndex < 0) firstIndex = i
      lastIndex = i
      if (abs > maxAbs) {
        maxAbs = abs
        maxIndex = i
      }
    }
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
  return {
    frames,
    maxAbsDeltaLsb: maxAbs,
    rmsDeltaLsb: round(rms, 6),
    rmsDeltaDbfs: rms > 0 ? round(dbfs(rms / FULL_SCALE) as number, 2) : null,
    differingSamples: differing,
    firstDifferingFrame: firstIndex < 0 ? null : Math.floor(firstIndex / channels),
    lastDifferingFrame: lastIndex < 0 ? null : Math.floor(lastIndex / channels),
    maxDelta:
      maxIndex < 0
        ? null
        : {
            frame: Math.floor(maxIndex / channels),
            channel: maxIndex % channels,
            a: a.samples[aBase + maxIndex] as number,
            b: b.samples[bBase + maxIndex] as number,
          },
  }
}

export interface PeriodicityReport {
  readonly pass: boolean
  /** Cycle 2 and cycle 3 (and the pre-guard pair) are bit-identical. */
  readonly identical: boolean
  readonly toleranceLsb: number
  /** Cycle 2 vs cycle 3; frame offsets are relative to the cycle start. */
  readonly cycle: RegionDiff & { readonly maxDeltaPosition: string | null; readonly maxDeltaSourceFrame: number | null }
  /** [c2 − guard, c2) vs [c3 − guard, c3); frame offsets relative to the guard start. */
  readonly preGuard: RegionDiff
  /** Largest |Δ| in each bar of the cycle, for locating the responsible material. */
  readonly perBarMaxAbsDeltaLsb: readonly number[]
  readonly boundary: BoundaryReport
}

export interface BoundaryReport {
  /** Largest per-channel step |x[c3] − x[c3 − 1]| where the render itself crosses cycle 2 → cycle 3. */
  readonly renderSeamStepLsb: number
  /** Largest per-channel step the runtime loop produces when it wraps cycle 2's last frame to its first. */
  readonly loopWrapStepLsb: number
  /** |loop wrap − render continuity| per channel: 0 means the wrap is indistinguishable from the render. */
  readonly wrapMismatchLsb: number
  /** Largest sample-to-sample step within ±guard frames of the seam, for scale. */
  readonly neighbourhoodMaxStepLsb: number
}

export function provePeriodicity(source: Pcm16, geometry: LoopGeometry = LOOP_GEOMETRY): PeriodicityReport {
  const regions = loopRegions(geometry)
  if (source.frames !== regions.sourceFrames) {
    throw new RangeError(`periodicity proof needs exactly ${regions.sourceFrames} frames, got ${source.frames}`)
  }
  const cycle = diffRegions(source, regions.production.start, source, regions.proof.start, geometry.cycleFrames)
  const preGuard = diffRegions(source, regions.preGuard.start, source, regions.preGuardProof.start, geometry.guardFrames)

  const framesPerBar = geometry.framesPerBeat * geometry.beatsPerBar
  const bars = Math.ceil(geometry.cycleFrames / framesPerBar)
  const perBar: number[] = Array.from({ length: bars }, () => 0)
  const channels = source.channels
  const aBase = regions.production.start * channels
  const bBase = regions.proof.start * channels
  if (cycle.differingSamples > 0) {
    for (let i = 0; i < geometry.cycleFrames * channels; i++) {
      const delta = Math.abs((source.samples[aBase + i] as number) - (source.samples[bBase + i] as number))
      const bar = Math.floor(i / channels / framesPerBar)
      if (delta > (perBar[bar] as number)) perBar[bar] = delta
    }
  }

  const pass = cycle.maxAbsDeltaLsb <= PERIODICITY_TOLERANCE_LSB && preGuard.maxAbsDeltaLsb <= PERIODICITY_TOLERANCE_LSB
  return {
    pass,
    identical: cycle.differingSamples === 0 && preGuard.differingSamples === 0,
    toleranceLsb: PERIODICITY_TOLERANCE_LSB,
    cycle: {
      ...cycle,
      maxDeltaPosition: cycle.maxDelta ? describeCycleFrame(cycle.maxDelta.frame, geometry) : null,
      maxDeltaSourceFrame: cycle.maxDelta ? regions.production.start + cycle.maxDelta.frame : null,
    },
    preGuard,
    perBarMaxAbsDeltaLsb: perBar,
    boundary: measureBoundary(source, geometry),
  }
}

function measureBoundary(source: Pcm16, geometry: LoopGeometry): BoundaryReport {
  const regions = loopRegions(geometry)
  const channels = source.channels
  const at = (frame: number, channel: number) => source.samples[frame * channels + channel] as number
  const seam = regions.proof.start
  const loopFirst = regions.production.start
  const loopLast = regions.production.end - 1
  let renderStep = 0
  let wrapStep = 0
  let mismatch = 0
  for (let channel = 0; channel < channels; channel++) {
    const natural = at(seam, channel) - at(seam - 1, channel)
    const wrapped = at(loopFirst, channel) - at(loopLast, channel)
    renderStep = Math.max(renderStep, Math.abs(natural))
    wrapStep = Math.max(wrapStep, Math.abs(wrapped))
    mismatch = Math.max(mismatch, Math.abs(wrapped - natural))
  }
  let neighbourhood = 0
  const from = Math.max(1, seam - geometry.guardFrames)
  const to = Math.min(source.frames - 1, seam + geometry.guardFrames)
  for (let frame = from; frame <= to; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      neighbourhood = Math.max(neighbourhood, Math.abs(at(frame, channel) - at(frame - 1, channel)))
    }
  }
  return { renderSeamStepLsb: renderStep, loopWrapStepLsb: wrapStep, wrapMismatchLsb: mismatch, neighbourhoodMaxStepLsb: neighbourhood }
}

// ---------------------------------------------------------------------------
// Loop and stinger derivatives
// ---------------------------------------------------------------------------

/** Cycle 2: the production loop, frames [c, 2c). */
export function extractProductionCycle(source: Pcm16, geometry: LoopGeometry = LOOP_GEOMETRY): Pcm16 {
  const { production } = loopRegions(geometry)
  return sliceFrames(source, production.start, production.end - production.start)
}

/** Cycle 3: the proof cycle, frames [2c, 3c). */
export function extractProofCycle(source: Pcm16, geometry: LoopGeometry = LOOP_GEOMETRY): Pcm16 {
  const { proof } = loopRegions(geometry)
  return sliceFrames(source, proof.start, proof.end - proof.start)
}

/**
 * Guarded loop master: the last guard of cycle 1, all of cycle 2, then the
 * first guard of cycle 3. Every frame is real rendered audio (handoff 9.1
 * step 6); nothing is synthesized, padded or crossfaded.
 */
export function buildGuardedLoop(source: Pcm16, geometry: LoopGeometry = LOOP_GEOMETRY): Pcm16 {
  const { guarded } = loopRegions(geometry)
  return sliceFrames(source, guarded.start, guarded.end - guarded.start)
}

/** Stinger web master: guard zero frames + content + guard zero frames (handoff 2.2). */
export function buildGuardedStinger(content: Pcm16, guardFrames: number): Pcm16 {
  const pad = silence(guardFrames, content.channels, content.sampleRate)
  return concatFrames([pad, content, pad])
}

/** Round half to even: unbiased for the .5 cases a two-channel average produces. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Mono fold-down: M = (L + R) / 2 rounded half-to-even to PCM16, no dither
 * (handoff 9.1 step 5). Exact for dual-mono content (L = R ⇒ M = L), and the
 * average of two int16 values can never leave the int16 range.
 */
export function foldToMono(audio: Pcm16): Pcm16 {
  if (audio.channels !== 2) throw new Error(`mono fold-down needs stereo input, got ${audio.channels} channels`)
  const mono = new Int16Array(audio.frames)
  const samples = audio.samples
  for (let frame = 0; frame < audio.frames; frame++) {
    mono[frame] = roundHalfEven(((samples[2 * frame] as number) + (samples[2 * frame + 1] as number)) / 2)
  }
  return { sampleRate: audio.sampleRate, channels: 1, frames: audio.frames, samples: mono }
}

/** [M, M]: how a mono buffer is heard after Web Audio's speaker up-mix. */
export function dualMono(mono: Pcm16): Pcm16 {
  if (mono.channels !== 1) throw new Error('dualMono needs mono input')
  const samples = new Int16Array(mono.frames * 2)
  for (let frame = 0; frame < mono.frames; frame++) {
    const value = mono.samples[frame] as number
    samples[2 * frame] = value
    samples[2 * frame + 1] = value
  }
  return { sampleRate: mono.sampleRate, channels: 2, frames: mono.frames, samples }
}

/**
 * Pearson L/R correlation. Two silent channels count as perfectly correlated
 * (folding them loses nothing); one silent channel against signal counts as 0.
 */
export function stereoCorrelation(audio: Pcm16): number {
  if (audio.channels !== 2) throw new Error('correlation needs stereo input')
  const n = audio.frames
  let sumL = 0
  let sumR = 0
  for (let frame = 0; frame < n; frame++) {
    sumL += audio.samples[2 * frame] as number
    sumR += audio.samples[2 * frame + 1] as number
  }
  const meanL = sumL / n
  const meanR = sumR / n
  let cov = 0
  let varL = 0
  let varR = 0
  for (let frame = 0; frame < n; frame++) {
    const l = (audio.samples[2 * frame] as number) - meanL
    const r = (audio.samples[2 * frame + 1] as number) - meanR
    cov += l * r
    varL += l * l
    varR += r * r
  }
  if (varL === 0 && varR === 0) return 1
  if (varL === 0 || varR === 0) return 0
  return cov / Math.sqrt(varL * varR)
}

/**
 * Proves the guarded master is exactly [last guard of cycle 1][cycle 2]
 * [first guard of cycle 3]: the content region is the production crop bit for
 * bit and the guards match the crop's own tail/head within the periodicity
 * tolerance, i.e. they are the neighboring cycles' real audio.
 */
export function verifyGuardedLoop(guarded: Pcm16, crop: Pcm16, guardFrames: number = LOOP_GEOMETRY.guardFrames): string[] {
  const problems: string[] = []
  const cycleFrames = crop.frames
  if (guarded.frames !== cycleFrames + 2 * guardFrames) problems.push(`guarded master has ${guarded.frames} frames, expected ${cycleFrames + 2 * guardFrames}`)
  if (guarded.channels !== crop.channels) problems.push('guarded master and crop differ in channel count')
  if (problems.length > 0) return problems
  const content = diffRegions(guarded, guardFrames, crop, 0, cycleFrames)
  if (content.differingSamples !== 0) problems.push(`loop region [${guardFrames}, ${guardFrames + cycleFrames}) is not the production cycle (max |Δ| ${content.maxAbsDeltaLsb} LSB)`)
  const pre = diffRegions(guarded, 0, crop, cycleFrames - guardFrames, guardFrames)
  if (pre.maxAbsDeltaLsb > PERIODICITY_TOLERANCE_LSB) problems.push(`pre-guard is not the preceding cycle's tail (max |Δ| ${pre.maxAbsDeltaLsb} LSB)`)
  const post = diffRegions(guarded, guardFrames + cycleFrames, crop, 0, guardFrames)
  if (post.maxAbsDeltaLsb > PERIODICITY_TOLERANCE_LSB) problems.push(`post-guard is not the following cycle's head (max |Δ| ${post.maxAbsDeltaLsb} LSB)`)
  return problems
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface SampleLevels {
  /** max |sample| / 32768, in dBFS (null for digital silence). */
  readonly samplePeakDbfs: number | null
  /** RMS over every sample of every channel / 32768, in dBFS (a full-scale sine reads −3.01). */
  readonly rmsDbfs: number | null
  /** Samples at or beyond ±32767: the PCM16 clipping signature. */
  readonly fullScaleSamples: number
  readonly clipping: boolean
}

export function sampleLevels(audio: Pcm16, fromFrame = 0, toFrame = audio.frames): SampleLevels {
  let peak = 0
  let sumSquares = 0
  let fullScale = 0
  const start = fromFrame * audio.channels
  const end = toFrame * audio.channels
  for (let i = start; i < end; i++) {
    const value = audio.samples[i] as number
    const abs = value < 0 ? -value : value
    if (abs > peak) peak = abs
    if (abs >= 32767) fullScale++
    sumSquares += value * value
  }
  const count = end - start
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
  const peakDb = dbfs(peak / FULL_SCALE)
  const rmsDb = dbfs(rms / FULL_SCALE)
  return {
    samplePeakDbfs: peakDb === null ? null : round(peakDb, 2),
    rmsDbfs: rmsDb === null ? null : round(rmsDb, 2),
    fullScaleSamples: fullScale,
    clipping: fullScale > 0,
  }
}

/** RMS of the final `frames` frames in dBFS; null means digital silence (passes any threshold). */
export function tailRmsDbfs(audio: Pcm16, frames: number): number | null {
  if (frames > audio.frames) throw new RangeError('tail longer than the audio')
  let sumSquares = 0
  for (let i = (audio.frames - frames) * audio.channels; i < audio.samples.length; i++) {
    const value = audio.samples[i] as number
    sumSquares += value * value
  }
  // Unrounded, so a −59.996 dBFS tail cannot round its way past a −60 dBFS gate.
  return dbfs(Math.sqrt(sumSquares / (frames * audio.channels)) / FULL_SCALE)
}
