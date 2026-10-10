/**
 * Locked constants of the Package 1 adaptive soundtrack, transcribed from
 * docs/ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md sections 1, 2, 5 and 6.
 * Every number traces back to the handoff; nothing here is a new design
 * decision. The asset build keeps its own copy (scripts/music/musicSpec.ts),
 * and musicMix.test.ts proves the two agree.
 */

export const BPM = 100
export const BEATS_PER_BAR = 4
export const BEAT_SECONDS = 0.6
export const BAR_SECONDS = 2.4
export const PHRASE_BARS = 4
export const PHRASE_SECONDS = 9.6
export const LOOP_BARS = 16
/** 1,693,440 frames at 44.1 kHz, 1,843,200 at 48 kHz. */
export const LOOP_SECONDS = 38.4
/** Real neighboring audio on both sides of every guarded loop file. */
export const GUARD_SECONDS = 0.2
export const LOOP_START_SECONDS = 0.2
export const LOOP_END_SECONDS = 38.6
/** Rotation windows start and end on bar 9 (P3) boundaries. */
export const ROTATION_OFFSET_SECONDS = 19.2

/** IMMEDIATE = now + this. Also the minimum lead of every quantized boundary. */
export const LOOKAHEAD_SECONDS = 0.1
/** epoch = round((currentTime + this) × sr) / sr. */
export const START_LEAD_SECONDS = 0.15
/**
 * Game timestamps mark a state change; the frame showing it reaches the screen
 * one to three frames later, and sound leading picture is the worse error.
 * Tune within 0–80 ms for acceptance criterion E.
 */
export const SYNC_VISUAL_OFFSET_MS = 40

/** −60 dB: the floor of every dB-linear (exponential) ramp; "off" then sets 0. */
export const OFF_GAIN = 0.001
export const OFF_DB = -60

/** Fade classes (handoff section 5). */
export const HARD_FADE_SECONDS = 0.02
export const DUCK_FADE_SECONDS = 0.4
export const VACUUM_RAMP_SECONDS = 0.04
export const SOUND_OFF_FADE_SECONDS = 0.15
export const NEW_GAME_FADE_SECONDS = 0.5
export const STINGER_CUT_FADE_SECONDS = 0.05
export const STINGER_RESTART_FADE_SECONDS = 0.02
export const BREATH_FADE_SECONDS = 2
/** Camera journeys (CinematicClock.tsx): the descent and the return to orbit. */
export const DESCENT_SECONDS = 6.2
export const RETURN_SECONDS = 2.4

export const DWELL_SECONDS = 2 * PHRASE_SECONDS
export const MAX_CONCURRENT_STINGERS = 2

/** Gameplay-alert duck on the music bus (handoff section 5). */
export const ALERT_DUCK = Object.freeze({
  gainDb: -4,
  attackSeconds: 0.02,
  holdSeconds: 0.4,
  releaseSeconds: 0.6,
})
export type AlertCue = 'threat-warning' | 'target-lock' | 'fire-window'

/** Master chain (handoff 6.1). −0.6 dB compensates the limiter's fixed makeup. */
export const MASTER_GAIN_DB = -0.6
export const LIMITER = Object.freeze({
  thresholdDb: -1,
  kneeDb: 0,
  ratio: 20,
  attackSeconds: 0.003,
  releaseSeconds: 0.25,
})

// ---------------------------------------------------------------------------
// Assets (handoff section 2)
// ---------------------------------------------------------------------------

export const LAYER_IDS = ['bed', 'engine', 'pressure', 'assault', 'claim'] as const
export type LayerId = (typeof LAYER_IDS)[number]

export interface LayerSpec {
  readonly channels: 1 | 2
  readonly unityLufs: number
  readonly truePeakCeilingDbtp: number
}

export const LAYER_SPECS: Readonly<Record<LayerId, LayerSpec>> = Object.freeze({
  bed: { channels: 2, unityLufs: -26, truePeakCeilingDbtp: -14 },
  engine: { channels: 1, unityLufs: -27, truePeakCeilingDbtp: -12 },
  pressure: { channels: 1, unityLufs: -25, truePeakCeilingDbtp: -12 },
  assault: { channels: 1, unityLufs: -20, truePeakCeilingDbtp: -7 },
  claim: { channels: 2, unityLufs: -23, truePeakCeilingDbtp: -10 },
})

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
export type AssetId = LayerId | StingerId

export type StingerTiming = 'beat' | 'exact' | 'immediate'

export type StingerDuck =
  | { readonly kind: 'duck'; readonly gainDb: number; readonly bars: number }
  /** Every layer off 0.6 s before the impact; owned by the First Strike plan. */
  | { readonly kind: 'vacuum' }
  /** Bed to −12 dB, the rest off; owned by the Territory Claimed plan. */
  | { readonly kind: 'stage-clear' }

export interface StingerSpec {
  readonly id: StingerId
  readonly bars: number
  readonly channels: 1 | 2
  /** Content length; the shipped file adds 0.2 s of zeros on each side. */
  readonly contentSeconds: number
  /** Where the sync point sits inside the content. */
  readonly syncSeconds: number
  readonly timing: readonly StingerTiming[]
  readonly truePeakCeilingDbtp: number
  readonly priority: number
  readonly duck: StingerDuck
}

function stinger(
  id: StingerId,
  bars: number,
  channels: 1 | 2,
  syncSeconds: number,
  timing: readonly StingerTiming[],
  truePeakCeilingDbtp: number,
  priority: number,
  duck: StingerDuck,
): StingerSpec {
  return Object.freeze({
    id,
    bars,
    channels,
    contentSeconds: Math.round(bars * BAR_SECONDS * 10) / 10,
    syncSeconds,
    timing,
    truePeakCeilingDbtp,
    priority,
    duck,
  })
}

export const STINGER_SPECS: Readonly<Record<StingerId, StingerSpec>> = Object.freeze({
  'vesper-arrival': stinger('vesper-arrival', 2, 1, 0, ['beat'], -9, 70, { kind: 'duck', gainDb: -3, bars: 2 }),
  // Impact at 2:4+1/6 = 4.6 s, on the flash.
  'first-strike': stinger('first-strike', 5, 2, 4.6, ['exact'], -2, 100, { kind: 'vacuum' }),
  'vesper-retaliation': stinger('vesper-retaliation', 1, 1, 0, ['beat'], -9, 70, { kind: 'duck', gainDb: -3, bars: 1 }),
  'divider-contact': stinger('divider-contact', 1, 1, 0, ['beat'], -11, 50, { kind: 'duck', gainDb: -4, bars: 1 }),
  'outcome-hold': stinger('outcome-hold', 1, 1, 0, ['beat'], -9, 60, { kind: 'duck', gainDb: -8, bars: 1 }),
  'outcome-breach': stinger('outcome-breach', 2, 1, 0, ['exact', 'immediate'], -6, 80, { kind: 'duck', gainDb: -8, bars: 2 }),
  'territory-claimed': stinger('territory-claimed', 4, 2, 0, ['exact'], -5, 90, { kind: 'stage-clear' }),
})

/** Per-wave divider-contact gain: +0 / +1 / +2 dB for waves 1 / 2 / 3. */
export const DIVIDER_WAVE_GAIN_DB: readonly number[] = Object.freeze([0, 1, 2])

/** First Strike set piece (handoff 4.2). */
export const FIRST_STRIKE_PLAN = Object.freeze({
  stingerAfterTransmissionStartMs: 800,
  vacuumAfterApproachStartMs: 1_600,
})
/** Counterstrike contact lands this long after `impact` begins (COUNTERSTRIKE_TIMING.impactContactMs). */
export const COUNTERSTRIKE_CONTACT_MS = 1_500

/** Territory Claimed stage clear (handoff 4.2). */
export const STAGE_CLEAR = Object.freeze({
  bedGainDb: -12,
  fadeSeconds: 0.3,
  resumeAfterSeconds: 8.4,
  resumeSwellBars: 1,
})

/** Residency (handoff 10.3): what is fetched and decoded, in this order, once reachable. */
export const RESIDENCY_GROUPS = Object.freeze({
  start: ['bed', 'engine'],
  conflict: ['vesper-arrival', 'pressure', 'assault', 'vesper-retaliation', 'divider-contact', 'outcome-hold', 'outcome-breach'],
  strike: ['first-strike'],
  claim: ['claim', 'territory-claimed'],
} as const satisfies Record<string, readonly AssetId[]>)
export type ResidencyGroup = keyof typeof RESIDENCY_GROUPS
export const RESIDENCY_ORDER: readonly ResidencyGroup[] = ['start', 'conflict', 'strike', 'claim']

export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}
