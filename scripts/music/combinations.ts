/**
 * Layer-combination model for the asset build's measured headroom audit
 * (handoff 9.3) and the local review auditions. Two different things live
 * here and are never mixed up:
 *
 *   - arithmetic worst case: Σ 10^((TP + gain)/20), the handoff's H1/H2
 *     bound (every peak coincident). A design sanity check, computed from
 *     either the locked ceilings or the measured per-asset true peaks;
 *   - measured sums: the real canonical crops summed sample by sample at the
 *     same gains, then measured by FFmpeg ebur128 (true peak, 4× oversampled).
 *
 * The gains come from the handoff mix table (section 3.4) with the
 * gain-raising modifiers (section 3.5) at their maxima. Modifiers that only
 * lower a layer (view, damage on ENGINE, rotation thinning) can never raise
 * a peak, so they need no variant of their own.
 *
 * Pure: no I/O.
 */
import {
  ASCENDANT_DAMAGE_PRESSURE_DB,
  CALM_CUES,
  CLAIMED_LOUDEST_FLAVOR_ENGINE_DB,
  COMBINATION_STINGER_OFFSETS,
  type Cue,
  DAMAGE_ENGINE_DB,
  FRAMES_PER_BAR,
  type LayerGains,
  LOOP_IDS,
  type LoopId,
  MAX_TIER_ENGINE_DB,
  MIX_TABLE,
  type MixRow,
  positionToFrames,
  SIEGE_ARC_CELLS,
  type StingerId,
  type StingerSpec,
  TIER_CUES,
} from './musicSpec.ts'

export interface MixVariant {
  /** e.g. `CONTESTED+tier`, `SIEGE_COMBAT@CLAIMED`. */
  readonly id: string
  readonly cue: Cue
  readonly gains: LayerGains
}

function resolveRow(row: MixRow, arc: keyof typeof SIEGE_ARC_CELLS | null): Partial<Record<LoopId, number>> {
  const gains: Partial<Record<LoopId, number>> = {}
  for (const layer of LOOP_IDS) {
    const cell = row[layer]
    if (cell === undefined) continue
    if (cell === 'arc') {
      const arcGain = arc === null ? undefined : (SIEGE_ARC_CELLS[arc] as LayerGains)[layer]
      if (arcGain !== undefined) gains[layer] = arcGain
    } else {
      gains[layer] = cell
    }
  }
  return gains
}

/** Invariant I2: no layer above 0 dB. */
function clampToUnity(gains: Partial<Record<LoopId, number>>): LayerGains {
  const clamped: Partial<Record<LoopId, number>> = {}
  for (const layer of LOOP_IDS) {
    const gain = gains[layer]
    if (gain !== undefined) clamped[layer] = Math.min(0, gain)
  }
  return clamped
}

/** Every audible mix the runtime can reach, at the loudest modifier settings. */
export function layerMixVariants(): MixVariant[] {
  const variants: MixVariant[] = []
  for (const cue of Object.keys(MIX_TABLE) as Cue[]) {
    const row: MixRow = MIX_TABLE[cue]
    if (Object.keys(row).length === 0) continue // SILENT, FS_VACUUM
    const hasArcCells = Object.values(row).includes('arc')
    if (hasArcCells) {
      variants.push({ id: cue, cue, gains: clampToUnity(resolveRow(row, null)) })
      for (const arc of Object.keys(SIEGE_ARC_CELLS) as (keyof typeof SIEGE_ARC_CELLS)[]) {
        variants.push({ id: `${cue}@${arc}`, cue, gains: clampToUnity(resolveRow(row, arc)) })
      }
      continue
    }
    const base = resolveRow(row, null)
    variants.push({ id: cue, cue, gains: clampToUnity(base) })
    if ((TIER_CUES as readonly Cue[]).includes(cue) && base.engine !== undefined) {
      variants.push({ id: `${cue}+tier`, cue, gains: clampToUnity({ ...base, engine: base.engine + MAX_TIER_ENGINE_DB }) })
    }
    if (cue === 'ASCENDANT' && base.engine !== undefined) {
      // Unrepaired Counterstrike wound: ENGINE −3 dB, PRESSURE enters at −14 dB.
      variants.push({
        id: 'ASCENDANT+tier+damaged',
        cue,
        gains: clampToUnity({ ...base, engine: base.engine + MAX_TIER_ENGINE_DB + DAMAGE_ENGINE_DB, pressure: ASCENDANT_DAMAGE_PRESSURE_DB }),
      })
    }
    if (cue === 'CLAIMED') {
      variants.push({ id: 'CLAIMED+helios', cue, gains: clampToUnity({ ...base, engine: CLAIMED_LOUDEST_FLAVOR_ENGINE_DB }) })
    }
  }
  return variants
}

export function findVariant(variants: readonly MixVariant[], id: string): MixVariant {
  const variant = variants.find((candidate) => candidate.id === id)
  if (!variant) throw new Error(`unknown mix variant ${id}`)
  return variant
}

function variantsOfCue(variants: readonly MixVariant[], cue: Cue): MixVariant[] {
  return variants.filter((variant) => variant.cue === cue)
}

// ---------------------------------------------------------------------------
// Arithmetic worst case (H1 / H2 as in the handoff)
// ---------------------------------------------------------------------------

export type LayerPeaks = Readonly<Record<LoopId, number>>

export function linearSumDbfs(dbValues: readonly number[]): number {
  const sum = dbValues.reduce((total, db) => total + 10 ** (db / 20), 0)
  return 20 * Math.log10(sum)
}

/** H1: Σ 10^((TP_layer + gain)/20) in dBFS. */
export function arithmeticLayerPeakDbfs(gains: LayerGains, peaks: LayerPeaks): number {
  const terms = LOOP_IDS.filter((layer) => gains[layer] !== undefined).map((layer) => (gains[layer] as number) + peaks[layer])
  return linearSumDbfs(terms)
}

// ---------------------------------------------------------------------------
// Stinger contexts
// ---------------------------------------------------------------------------

export interface StingerContext {
  /** e.g. `divider-contact|MONUMENT_COMBAT|+2dB`. */
  readonly id: string
  readonly stinger: StingerId
  /** The mix the layers hold when the stinger starts. */
  readonly variant: MixVariant
  readonly stingerGainDb: number
  /** stage-clear only: the mix that returns afterwards. */
  readonly resumeVariant: MixVariant | null
}

/**
 * Which mixes each stinger can sound over, read from the handoff's edge
 * table (4.1) and cue rules (3.3). A stinger fires on a state edge, so both
 * sides of the edge are included: the mix before it (its transition may not
 * have landed yet) and the mix after it. Calm-arc edges include every calm
 * variant because replays (REVIEW SIGNAL, REPLAY COUNTERSTRIKE) and sieges can
 * happen in any arc.
 */
export function stingerAuditContexts(variants: readonly MixVariant[], stingers: readonly StingerSpec[]): StingerContext[] {
  const calm = variants.filter((variant) => (CALM_CUES as readonly Cue[]).includes(variant.cue))
  const of = (...cues: Cue[]) => cues.flatMap((cue) => variantsOfCue(variants, cue))
  const plan: Record<StingerId, { mixes: MixVariant[]; gains: readonly number[] }[]> = {
    // rivalPhase → warning: from a calm arc into REVEAL_APPROACH.
    'vesper-arrival': [{ mixes: [...calm, ...of('REVEAL_APPROACH')], gains: [0] }],
    // Starts 0.8 s into vesper-transmission; layers are removed by the vacuum before the impact.
    'first-strike': [{ mixes: of('FS_FLIGHT', 'FS_TRANSMISSION'), gains: [0] }],
    // csStatus dormant/resolved → command.
    'vesper-retaliation': [{ mixes: [...calm, ...of('CS_ALERT')], gains: [0] }],
    'divider-contact': [
      // siege → command (+0 dB): SIEGE_BUILD → SIEGE_ALERT.
      { mixes: of('SIEGE_BUILD', 'SIEGE_ALERT'), gains: [0] },
      // defense windows and monument waves: +0 / +1 / +2 dB for waves 1 / 2 / 3.
      { mixes: of('SIEGE_COMBAT', 'MONUMENT_COMBAT'), gains: [0, 1, 2] },
      // monument → command with no wave resolved, and → wave from a waiting command.
      { mixes: of('MONUMENT_ALERT', 'MONUMENT_ALERT_DWELL'), gains: [0] },
    ],
    // cs → success; siege waves/repairing → operational; monument wave → activating.
    'outcome-hold': [{ mixes: [...of('CS_COMBAT', 'CS_SUCCESS', 'SIEGE_COMBAT', 'SIEGE_REPAIR', 'MONUMENT_COMBAT', 'MONUMENT_ACTIVATING'), ...calm], gains: [0] }],
    // cs → impact (contact); siege waves → damaged; monument wave → damaged.
    'outcome-breach': [{ mixes: [...of('CS_COMBAT', 'CS_IMPACT', 'SIEGE_COMBAT', 'MONUMENT_COMBAT', 'MONUMENT_DAMAGED'), ...calm], gains: [0] }],
    // monumentRevealAtMs null → set: from activating (or the reveal cue) through stage clear back to CLAIMED.
    'territory-claimed': [{ mixes: of('MONUMENT_ACTIVATING', 'MONUMENT_REVEAL'), gains: [0] }],
  }
  const loudestClaimed = findVariant(variants, 'CLAIMED+helios')
  const contexts: StingerContext[] = []
  for (const spec of stingers) {
    const seen = new Set<string>()
    for (const group of plan[spec.id]) {
      for (const variant of group.mixes) {
        for (const gain of group.gains) {
          const id = `${spec.id}|${variant.id}${gain === 0 ? '' : `|+${gain}dB`}`
          if (seen.has(id)) continue
          seen.add(id)
          contexts.push({
            id,
            stinger: spec.id,
            variant,
            stingerGainDb: gain,
            resumeVariant: spec.duck.kind === 'stage-clear' ? loudestClaimed : null,
          })
        }
      }
    }
  }
  return contexts
}

/** H2 bound with the stinger's duck fully applied (the handoff's arithmetic model). */
export function arithmeticStingerPeakDbfs(context: StingerContext, spec: StingerSpec, peaks: LayerPeaks, stingerPeakDbtp: number): number {
  const terms: number[] = [stingerPeakDbtp + context.stingerGainDb]
  const duck = spec.duck
  for (const layer of LOOP_IDS) {
    const gain = context.variant.gains[layer]
    if (gain === undefined) continue
    if (duck.kind === 'duck') terms.push(gain + duck.gainDb + peaks[layer])
    else if (duck.kind === 'stage-clear' && layer === 'bed') terms.push(duck.bedGainDb + peaks[layer])
    // vacuum: every layer is off at the impact; stage clear: every non-bed layer is off.
  }
  return linearSumDbfs(terms)
}

// ---------------------------------------------------------------------------
// Measured sums (pure sample math; FFmpeg measures the result)
// ---------------------------------------------------------------------------

/** Canonical crop as interleaved stereo float in [−1, 1). */
export type StereoFloat = Float32Array

export function pcm16ToFloat(samples: Int16Array): StereoFloat {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] as number) / 32768
  return out
}

export type LayerSignals = Readonly<Partial<Record<LoopId, StereoFloat>>>

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/** Static-gain sum of `repeats` consecutive cycles, unclamped. */
export function mixLayers(gains: LayerGains, layers: LayerSignals, cycleFrames: number, repeats = 1): StereoFloat {
  const out = new Float32Array(cycleFrames * 2 * repeats)
  for (const layer of LOOP_IDS) {
    const gain = gains[layer]
    if (gain === undefined) continue
    const signal = layers[layer]
    if (!signal) throw new Error(`mix needs layer ${layer}`)
    const linear = dbToGain(gain)
    for (let repeat = 0; repeat < repeats; repeat++) {
      const base = repeat * cycleFrames * 2
      for (let i = 0; i < cycleFrames * 2; i++) out[base + i] = (out[base + i] as number) + linear * (signal[i] as number)
    }
  }
  return out
}

export interface PeakSummary {
  readonly samplePeak: number
  /** Samples at or beyond ±1.0 before any quantization. */
  readonly overs: number
}

export function peakSummary(samples: Float32Array): PeakSummary {
  let peak = 0
  let overs = 0
  for (const value of samples) {
    const abs = Math.abs(value)
    if (abs > peak) peak = abs
    if (abs >= 1) overs++
  }
  return { samplePeak: peak, overs }
}

/**
 * Linear gain of one layer `t` frames after the stinger starts (t may be
 * negative in the lead-in margin). Ducks are dB-linear over the handoff's
 * 0.4 s duck fade, starting at the stinger start, held for the duck length,
 * then released over the same fade. Starting the attack at the stinger
 * start (instead of assuming the duck is already down) keeps the measured
 * audit conservative at the hit.
 */
export function layerGainAt(context: StingerContext, spec: StingerSpec, layer: LoopId, t: number, sampleRate: number): number {
  const base = context.variant.gains[layer]
  const duck = spec.duck
  if (duck.kind === 'duck') {
    if (base === undefined) return 0
    const fade = duck.fadeSeconds * sampleRate
    const holdEnd = duck.bars * FRAMES_PER_BAR
    let depth = 0
    if (t >= 0 && t < fade) depth = duck.gainDb * (t / fade)
    else if (t >= fade && t < holdEnd) depth = duck.gainDb
    else if (t >= holdEnd && t < holdEnd + fade) depth = duck.gainDb * (1 - (t - holdEnd) / fade)
    return dbToGain(base + depth)
  }
  if (duck.kind === 'vacuum') {
    if (base === undefined) return 0
    const end = positionToFrames(spec.syncPosition) - duck.leadSeconds * sampleRate
    const rampStart = end - duck.rampSeconds * sampleRate
    if (t < rampStart) return dbToGain(base)
    if (t >= end) return 0
    return dbToGain(base) * (1 - (t - rampStart) / (end - rampStart))
  }
  // stage-clear
  const fade = duck.fadeSeconds * sampleRate
  if (t >= duck.resumeAfterSeconds * sampleRate) {
    // Conservative: the CLAIMED mix is assumed fully back, without its swell.
    const resumed = context.resumeVariant?.gains[layer]
    return resumed === undefined ? 0 : dbToGain(resumed)
  }
  if (base === undefined && layer !== 'bed') return 0
  if (layer === 'bed') {
    const from = base ?? duck.bedGainDb
    if (t < 0) return base === undefined ? 0 : dbToGain(from)
    if (t >= fade) return dbToGain(duck.bedGainDb)
    return dbToGain(from + (duck.bedGainDb - from) * (t / fade))
  }
  const linear = dbToGain(base as number)
  if (t < 0) return linear
  if (t >= fade) return 0
  return linear * (1 - t / fade)
}

export interface StingerWindowsResult {
  readonly samples: StereoFloat
  /** Sample peak (linear) of each window, in offset order. */
  readonly windowPeaks: readonly number[]
  readonly offsetsFrames: readonly number[]
}

/**
 * Builds one measurable file per (mix, stinger) pair: the stinger summed
 * over the looping layers at COMBINATION_STINGER_OFFSETS evenly spaced loop
 * offsets. Each window carries a short lead-in and tail of the layer mix,
 * raised-cosine faded at its outer edges so window joins cannot create
 * inter-sample overshoot, with digital silence between windows.
 */
export function renderStingerWindows(options: {
  readonly context: StingerContext
  readonly spec: StingerSpec
  readonly layers: LayerSignals
  readonly stinger: StereoFloat
  readonly cycleFrames: number
  readonly sampleRate: number
  readonly marginFrames: number
  readonly gapFrames: number
  readonly offsets?: number
}): StingerWindowsResult {
  const { context, spec, layers, stinger, cycleFrames, sampleRate, marginFrames, gapFrames } = options
  const offsets = options.offsets ?? COMBINATION_STINGER_OFFSETS
  const stingerFrames = stinger.length / 2
  const windowFrames = stingerFrames + 2 * marginFrames
  const stride = windowFrames + gapFrames
  const out = new Float32Array(stride * offsets * 2)
  const stingerGain = dbToGain(context.stingerGainDb)

  const active = LOOP_IDS.filter((layer) => context.variant.gains[layer] !== undefined || context.resumeVariant?.gains[layer] !== undefined || (spec.duck.kind === 'stage-clear' && layer === 'bed'))
  const envelopes = active.map((layer) => {
    const envelope = new Float32Array(windowFrames)
    for (let i = 0; i < windowFrames; i++) envelope[i] = layerGainAt(context, spec, layer, i - marginFrames, sampleRate)
    const signal = layers[layer]
    if (!signal && envelope.some((gain) => gain > 0)) throw new Error(`stinger audit needs layer ${layer}`)
    return { signal, envelope }
  })
  const edge = (i: number) => {
    if (i < marginFrames) return 0.5 - 0.5 * Math.cos((Math.PI * i) / marginFrames)
    if (i >= windowFrames - marginFrames) return 0.5 - 0.5 * Math.cos((Math.PI * (windowFrames - 1 - i)) / marginFrames)
    return 1
  }

  const windowPeaks: number[] = []
  const offsetsFrames: number[] = []
  for (let k = 0; k < offsets; k++) {
    const offsetFrame = Math.floor((k * cycleFrames) / offsets)
    offsetsFrames.push(offsetFrame)
    const base = k * stride * 2
    let peak = 0
    for (let i = 0; i < windowFrames; i++) {
      const t = i - marginFrames
      const loopFrame = (((offsetFrame + t) % cycleFrames) + cycleFrames) % cycleFrames
      let left = 0
      let right = 0
      for (const { signal, envelope } of envelopes) {
        const gain = envelope[i] as number
        if (gain === 0 || !signal) continue
        left += gain * (signal[2 * loopFrame] as number)
        right += gain * (signal[2 * loopFrame + 1] as number)
      }
      if (t >= 0 && t < stingerFrames) {
        left += stingerGain * (stinger[2 * t] as number)
        right += stingerGain * (stinger[2 * t + 1] as number)
      }
      const fade = edge(i)
      left *= fade
      right *= fade
      out[base + 2 * i] = left
      out[base + 2 * i + 1] = right
      peak = Math.max(peak, Math.abs(left), Math.abs(right))
    }
    windowPeaks.push(peak)
  }
  return { samples: out, windowPeaks, offsetsFrames }
}

// ---------------------------------------------------------------------------
// Review auditions (temporary local mixes, never shipped)
// ---------------------------------------------------------------------------

export interface AuditionSpec {
  readonly id: 'A' | 'B' | 'C' | 'D' | 'E'
  readonly name: string
  /** The handoff cue whose unmodified mix-table gains the audition uses. */
  readonly cue: Cue
  readonly layers: readonly LoopId[]
}

export const AUDITIONS: readonly AuditionSpec[] = [
  { id: 'A', name: 'bed', cue: 'RECON', layers: ['bed'] },
  { id: 'B', name: 'bed-engine', cue: 'FOOTHOLD_WORKS', layers: ['bed', 'engine'] },
  { id: 'C', name: 'bed-engine-pressure', cue: 'CONTESTED', layers: ['bed', 'engine', 'pressure'] },
  { id: 'D', name: 'bed-engine-pressure-assault', cue: 'CS_COMBAT', layers: ['bed', 'engine', 'pressure', 'assault'] },
  { id: 'E', name: 'bed-engine-claim', cue: 'CLAIMED', layers: ['bed', 'engine', 'claim'] },
]

export function auditionGains(audition: AuditionSpec): LayerGains {
  return resolveRow(MIX_TABLE[audition.cue], null)
}
