/**
 * Locked adaptive-soundtrack package contract, transcribed from
 * docs/ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md (sections 1, 2, 3.4, 3.5,
 * 4.2 and 9). Nothing here is a new design decision: every number traces back
 * to the handoff, and the tests in musicSpec.test.ts re-derive the frame math.
 *
 * Pure data and pure helpers only. No I/O.
 */

// ---------------------------------------------------------------------------
// Grid and frame arithmetic (handoff section 1; bible section 6)
// ---------------------------------------------------------------------------

export const CANONICAL_SAMPLE_RATE = 44_100
export const CANONICAL_CHANNELS = 2
export const CANONICAL_BITS_PER_SAMPLE = 16
export const BPM = 100
export const BEATS_PER_BAR = 4
export const METER = '4/4'

/** 0.6 s at 44.1 kHz. */
export const FRAMES_PER_BEAT = (CANONICAL_SAMPLE_RATE * 60) / BPM
/** 2.4 s at 44.1 kHz. */
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * BEATS_PER_BAR

export const LOOP_BARS = 16
export const LOOP_SECONDS = 38.4
/** One 16-bar cycle: 1,693,440 frames. */
export const LOOP_FRAMES = LOOP_BARS * FRAMES_PER_BAR

/** Canonical DaemonV12 loop renders are three identical cycles (48 bars). */
export const RENDER_CYCLES = 3
export const RENDER_BARS = LOOP_BARS * RENDER_CYCLES
export const RENDER_SECONDS = 115.2
/** 5,080,320 frames. */
export const RENDER_FRAMES = LOOP_FRAMES * RENDER_CYCLES

/** Zero-based cycle index of the production loop ("cycle 2"). */
export const PRODUCTION_CYCLE = 1
/** Zero-based cycle index the production loop is proven against ("cycle 3"). */
export const PROOF_CYCLE = 2

export const GUARD_SECONDS = 0.2
/** 8,820 frames. */
export const GUARD_FRAMES = Math.round(GUARD_SECONDS * CANONICAL_SAMPLE_RATE)
/** 1,711,080 frames = 38.8 s. */
export const GUARDED_LOOP_FRAMES = LOOP_FRAMES + 2 * GUARD_FRAMES

/** Every rate the runtime may decode at (handoff section 11, musicClock.test). */
export const CONTEXT_SAMPLE_RATES = [8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000] as const

/**
 * Frame geometry used by the pure PCM functions. Production code always uses
 * LOOP_GEOMETRY; unit tests use tiny geometries with the same shape.
 */
export interface LoopGeometry {
  readonly framesPerBeat: number
  readonly beatsPerBar: number
  readonly cycleFrames: number
  readonly cycles: number
  readonly guardFrames: number
}

export const LOOP_GEOMETRY: LoopGeometry = {
  framesPerBeat: FRAMES_PER_BEAT,
  beatsPerBar: BEATS_PER_BAR,
  cycleFrames: LOOP_FRAMES,
  cycles: RENDER_CYCLES,
  guardFrames: GUARD_FRAMES,
}

/** Frame ranges a loop build reads from the three-cycle render (handoff 9.1). */
export function loopRegions(geometry: LoopGeometry = LOOP_GEOMETRY) {
  const { cycleFrames, guardFrames } = geometry
  const productionStart = cycleFrames * PRODUCTION_CYCLE
  const proofStart = cycleFrames * PROOF_CYCLE
  return {
    sourceFrames: cycleFrames * geometry.cycles,
    production: { start: productionStart, end: productionStart + cycleFrames },
    proof: { start: proofStart, end: proofStart + cycleFrames },
    /** Last guard of cycle 1: the real audio that precedes the loop. */
    preGuard: { start: productionStart - guardFrames, end: productionStart },
    /** Last guard of cycle 2: what the pre-guard must equal for the loop to be periodic. */
    preGuardProof: { start: proofStart - guardFrames, end: proofStart },
    /** First guard of cycle 3: the real audio that follows the loop. */
    postGuard: { start: proofStart, end: proofStart + guardFrames },
    /** Guarded web source [1,684,620, 3,395,700). */
    guarded: { start: productionStart - guardFrames, end: proofStart + guardFrames },
  } as const
}

// ---------------------------------------------------------------------------
// Quality thresholds (handoff sections 2 and 9)
// ---------------------------------------------------------------------------

/** max |cycle 2 − cycle 3| and pre-guard equality tolerance, in PCM16 LSB. */
export const PERIODICITY_TOLERANCE_LSB = 1
/** Stinger content must be ≤ −60 dBFS RMS over its last 100 ms. */
export const STINGER_TAIL_FRAMES = Math.round(0.1 * CANONICAL_SAMPLE_RATE)
export const STINGER_TAIL_MAX_RMS_DBFS = -60
/** Mono fold-down gates (handoff 9.1 step 5). */
export const MONO_MIN_CORRELATION = 0.9
export const MONO_MAX_LOUDNESS_DELTA_LU = 1
/** Combination audit gate (handoff 9.3): every measured true peak ≤ −2 dBTP. */
export const COMBINATION_TRUE_PEAK_CEILING_DBTP = -2
/** Loop offsets per (mix, stinger) pair in the combination audit (handoff 9.3). */
export const COMBINATION_STINGER_OFFSETS = 16
/** FFmpeg-decoded frames must land in [expected, expected + 3,000] (handoff 9.1 step 8). */
export const MP3_DECODE_SLACK_FRAMES = 3_000

export const MP3_BITRATE_KBPS: Readonly<Record<1 | 2, number>> = { 1: 96, 2: 160 }

// ---------------------------------------------------------------------------
// Assets (handoff section 2)
// ---------------------------------------------------------------------------

export const LOOP_IDS = ['bed', 'engine', 'pressure', 'assault', 'claim'] as const
export type LoopId = (typeof LOOP_IDS)[number]

export const STINGER_IDS = [
  'vesper-arrival',
  'first-strike',
  'vesper-retaliation',
  'divider-contact',
  'outcome-hold',
  'outcome-breach',
  'territory-claimed',
] as const
export type StingerId = (typeof STINGER_IDS)[number]

export type AssetId = LoopId | StingerId
export const ASSET_IDS: readonly AssetId[] = [...LOOP_IDS, ...STINGER_IDS]

export interface LoopSpec {
  readonly id: LoopId
  readonly kind: 'loop'
  /** Shipping channel count. Canonical renders are always stereo. */
  readonly channels: 1 | 2
  readonly unityLufs: number
  readonly lufsTolerance: number
  readonly truePeakCeilingDbtp: number
  /** DaemonV12 project/render basename (handoff 8.1). */
  readonly sourceName: string
}

export const LOOP_SPECS: readonly LoopSpec[] = [
  { id: 'bed', kind: 'loop', channels: 2, unityLufs: -26, lufsTolerance: 1, truePeakCeilingDbtp: -14, sourceName: 'stm-loop-bed' },
  { id: 'engine', kind: 'loop', channels: 1, unityLufs: -27, lufsTolerance: 1, truePeakCeilingDbtp: -12, sourceName: 'stm-loop-engine' },
  { id: 'pressure', kind: 'loop', channels: 1, unityLufs: -25, lufsTolerance: 1, truePeakCeilingDbtp: -12, sourceName: 'stm-loop-pressure' },
  { id: 'assault', kind: 'loop', channels: 1, unityLufs: -20, lufsTolerance: 1, truePeakCeilingDbtp: -7, sourceName: 'stm-loop-assault' },
  { id: 'claim', kind: 'loop', channels: 2, unityLufs: -23, lufsTolerance: 1, truePeakCeilingDbtp: -10, sourceName: 'stm-loop-claim' },
]

export type StingerTiming = 'beat' | 'exact' | 'immediate'

/** How a stinger treats the layers while it plays (handoff 2.2, 4.2). */
export type StingerDuck =
  | { readonly kind: 'duck'; readonly gainDb: number; readonly bars: number; readonly fadeSeconds: number }
  | {
      readonly kind: 'vacuum'
      /** Every layer reaches off this long before the sync point (target-approach + 1.6 s = impact − 0.6 s). */
      readonly leadSeconds: number
      readonly rampSeconds: number
    }
  | {
      readonly kind: 'stage-clear'
      readonly bedGainDb: number
      readonly fadeSeconds: number
      /** The CLAIMED mix returns at the first phrase boundary ≥ sync + this, with a 1-bar swell. */
      readonly resumeAfterSeconds: number
      readonly resumeCue: 'CLAIMED'
      readonly resumeSwellBars: number
    }

export interface StingerSpec {
  readonly id: StingerId
  readonly kind: 'stinger'
  readonly bars: number
  readonly channels: 1 | 2
  /** DaemonV12 position of the sync point inside the content. */
  readonly syncPosition: string
  readonly timing: readonly StingerTiming[]
  readonly truePeakCeilingDbtp: number
  /** Runtime per-wave gain offsets (divider-contact only). */
  readonly waveGainDb: readonly number[] | null
  readonly duck: StingerDuck
  readonly priority: number
  readonly sourceName: string
}

/** Handoff section 5 fade class "duck". */
const DUCK_FADE_SECONDS = 0.4

export const STINGER_SPECS: readonly StingerSpec[] = [
  {
    id: 'vesper-arrival', kind: 'stinger', bars: 2, channels: 1, syncPosition: '1:1', timing: ['beat'],
    truePeakCeilingDbtp: -9, waveGainDb: null, duck: { kind: 'duck', gainDb: -3, bars: 2, fadeSeconds: DUCK_FADE_SECONDS },
    priority: 70, sourceName: 'stm-sting-vesper-arrival',
  },
  {
    id: 'first-strike', kind: 'stinger', bars: 5, channels: 2, syncPosition: '2:4+1/6', timing: ['exact'],
    truePeakCeilingDbtp: -2, waveGainDb: null, duck: { kind: 'vacuum', leadSeconds: 0.6, rampSeconds: 0.04 },
    priority: 100, sourceName: 'stm-sting-first-strike',
  },
  {
    id: 'vesper-retaliation', kind: 'stinger', bars: 1, channels: 1, syncPosition: '1:1', timing: ['beat'],
    truePeakCeilingDbtp: -9, waveGainDb: null, duck: { kind: 'duck', gainDb: -3, bars: 1, fadeSeconds: DUCK_FADE_SECONDS },
    priority: 70, sourceName: 'stm-sting-vesper-retaliation',
  },
  {
    id: 'divider-contact', kind: 'stinger', bars: 1, channels: 1, syncPosition: '1:1', timing: ['beat'],
    truePeakCeilingDbtp: -11, waveGainDb: [0, 1, 2], duck: { kind: 'duck', gainDb: -4, bars: 1, fadeSeconds: DUCK_FADE_SECONDS },
    priority: 50, sourceName: 'stm-sting-divider-contact',
  },
  {
    id: 'outcome-hold', kind: 'stinger', bars: 1, channels: 1, syncPosition: '1:1', timing: ['beat'],
    truePeakCeilingDbtp: -9, waveGainDb: null, duck: { kind: 'duck', gainDb: -8, bars: 1, fadeSeconds: DUCK_FADE_SECONDS },
    priority: 60, sourceName: 'stm-sting-outcome-hold',
  },
  {
    id: 'outcome-breach', kind: 'stinger', bars: 2, channels: 1, syncPosition: '1:1', timing: ['exact', 'immediate'],
    truePeakCeilingDbtp: -6, waveGainDb: null, duck: { kind: 'duck', gainDb: -8, bars: 2, fadeSeconds: DUCK_FADE_SECONDS },
    priority: 80, sourceName: 'stm-sting-outcome-breach',
  },
  {
    id: 'territory-claimed', kind: 'stinger', bars: 4, channels: 2, syncPosition: '1:1', timing: ['exact'],
    truePeakCeilingDbtp: -5, waveGainDb: null,
    duck: { kind: 'stage-clear', bedGainDb: -12, fadeSeconds: 0.3, resumeAfterSeconds: 8.4, resumeCue: 'CLAIMED', resumeSwellBars: 1 },
    priority: 90, sourceName: 'stm-sting-territory-claimed',
  },
]

export type AssetSpec = LoopSpec | StingerSpec

export function assetSpec(id: AssetId): AssetSpec {
  const spec = [...LOOP_SPECS, ...STINGER_SPECS].find((candidate) => candidate.id === id)
  if (!spec) throw new Error(`unknown music asset id: ${id}`)
  return spec
}

export function stingerFrames(spec: StingerSpec): number {
  return spec.bars * FRAMES_PER_BAR
}

export function bitrateFor(channels: 1 | 2): number {
  return MP3_BITRATE_KBPS[channels]
}

/**
 * Converts a DaemonV12 `BAR:BEAT+fraction` position (fraction of a whole
 * note) to a zero-based frame offset. `2:4+1/6` → 4.6 s → 202,860 frames.
 * Exact integer arithmetic; rejects positions that do not land on a frame.
 */
export function positionToFrames(position: string, geometry: Pick<LoopGeometry, 'framesPerBeat' | 'beatsPerBar'> = LOOP_GEOMETRY): number {
  const match = /^(\d+):(\d+)(?:\+(\d+)\/(\d+))?$/.exec(position)
  if (!match) throw new Error(`invalid DaemonV12 position: ${position}`)
  const bar = Number(match[1])
  const beat = Number(match[2])
  if (bar < 1 || beat < 1 || beat > geometry.beatsPerBar) throw new Error(`position out of range: ${position}`)
  const numerator = match[3] === undefined ? 0 : Number(match[3])
  const denominator = match[4] === undefined ? 1 : Number(match[4])
  if (denominator === 0) throw new Error(`invalid DaemonV12 position: ${position}`)
  // A whole note is four beats in 4/4.
  const fractionFrames = (numerator * 4 * geometry.framesPerBeat) / denominator
  if (!Number.isInteger(fractionFrames)) throw new Error(`position does not land on a frame: ${position}`)
  return ((bar - 1) * geometry.beatsPerBar + (beat - 1)) * geometry.framesPerBeat + fractionFrames
}

/** Human-readable `bar:beat +frames` for a frame inside a cycle, for failure reports. */
export function describeCycleFrame(frame: number, geometry: Pick<LoopGeometry, 'framesPerBeat' | 'beatsPerBar'> = LOOP_GEOMETRY): string {
  const framesPerBar = geometry.framesPerBeat * geometry.beatsPerBar
  const bar = Math.floor(frame / framesPerBar) + 1
  const withinBar = frame % framesPerBar
  const beat = Math.floor(withinBar / geometry.framesPerBeat) + 1
  const remainder = withinBar % geometry.framesPerBeat
  return `bar ${bar} beat ${beat} +${remainder} frames`
}

// ---------------------------------------------------------------------------
// Runtime mix table (handoff 3.4 / 3.5), used read-only by the combination
// audit and the audition mixes. The runtime phase owns musicMix.ts; this copy
// exists so the asset build can measure real sums before that code exists.
// ---------------------------------------------------------------------------

export type LayerGains = Readonly<Partial<Record<LoopId, number>>>
/** `'arc'` marks the siege rows' arc cells (handoff 3.4 footnote). */
export type MixRow = Readonly<Partial<Record<LoopId, number | 'arc'>>>

export const MIX_TABLE = {
  SILENT: {},
  RECON: { bed: -3 },
  FOOTHOLD: { bed: 0, engine: -12 },
  FOOTHOLD_WORKS: { bed: 0, engine: -4 },
  CONTESTED: { bed: 0, engine: -4, pressure: -10 },
  RETALIATION: { bed: 0, engine: -6, pressure: -5 },
  ASCENDANT: { bed: 0, engine: -4 },
  CLAIMED: { bed: 0, engine: -8, claim: 0 },
  REVEAL_APPROACH: { bed: -2, engine: -10, pressure: -6 },
  REVEAL_IMPACT: { bed: -2, engine: -10, pressure: -3 },
  REVEAL_TRANSMISSION: { bed: -6, pressure: -9 },
  REVEAL_SETTLE: { bed: -2, engine: -8, pressure: -8 },
  RIVAL_FOCUS: { bed: -2, engine: -10, pressure: -4 },
  RIVAL_TRANSMISSION: { bed: -5, engine: -12, pressure: -7 },
  STRIKE_DECISION: { bed: -2, engine: -8, pressure: -6 },
  FS_FLIGHT: { bed: -4, engine: -8, pressure: -10, assault: -1 },
  FS_TRANSMISSION: { bed: -4, engine: -8, pressure: -3, assault: -3 },
  FS_VACUUM: {},
  FS_BREATH: { bed: -8 },
  CS_ALERT: { bed: -3, engine: -8, pressure: -2, assault: -14 },
  CS_WARNING: { bed: -3, engine: -8, pressure: -2, assault: -6 },
  CS_COMBAT: { bed: -4, engine: -10, pressure: -2, assault: 0 },
  CS_IMPACT: { bed: -6, pressure: -4, assault: -10 },
  CS_SUCCESS: { bed: -2, engine: -4, pressure: -12, assault: -10 },
  SIEGE_BUILD: { bed: 0, engine: 0, pressure: 'arc', claim: 'arc' },
  SIEGE_ALERT: { bed: -2, engine: -4, pressure: 'arc', assault: -10, claim: 'arc' },
  SIEGE_COMBAT: { bed: -4, engine: -8, pressure: 'arc', assault: 0, claim: 'arc' },
  SIEGE_REPAIR: { bed: 0, engine: -2, pressure: 'arc', claim: 'arc' },
  MONUMENT_CHOICES: { bed: 0, engine: -3, claim: -10 },
  MONUMENT_BUILD: { bed: 0, engine: -3, claim: -8 },
  MONUMENT_ALERT: { bed: -2, engine: -6, assault: -12, claim: -6 },
  MONUMENT_ALERT_DWELL: { bed: -2, engine: -6, claim: -8 },
  MONUMENT_COMBAT: { bed: -4, engine: -10, assault: 0, claim: -5 },
  MONUMENT_ACTIVATING: { bed: 0, engine: -4, claim: -2 },
  MONUMENT_DAMAGED: { bed: 0, engine: -6, claim: -12 },
  MONUMENT_REVEAL: { bed: -4, claim: -6 },
} as const satisfies Record<string, MixRow>

export type Cue = keyof typeof MIX_TABLE

export const CALM_CUES = ['RECON', 'FOOTHOLD', 'FOOTHOLD_WORKS', 'CONTESTED', 'RETALIATION', 'ASCENDANT', 'CLAIMED'] as const satisfies readonly Cue[]
/** Tier modifier cues: ENGINE +1 dB per tier, at most +2 (handoff 3.5 item 1). */
export const TIER_CUES = ['FOOTHOLD_WORKS', 'CONTESTED', 'RETALIATION', 'ASCENDANT'] as const satisfies readonly Cue[]
export const MAX_TIER_ENGINE_DB = 2
/** Damage modifier (handoff 3.5 item 3). */
export const DAMAGE_ENGINE_DB = -3
export const ASCENDANT_DAMAGE_PRESSURE_DB = -14
/** Loudest monument flavor in CLAIMED: HELIOS_SPIRE sets ENGINE to −4 (handoff 3.5 item 4). */
export const CLAIMED_LOUDEST_FLAVOR_ENGINE_DB = -4
/** Siege arc cells (handoff 3.4 footnote). */
export const SIEGE_ARC_CELLS = {
  CONTESTED: { pressure: -12 },
  CLAIMED: { claim: -10 },
} as const satisfies Record<string, LayerGains>
