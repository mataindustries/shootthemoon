/**
 * How the layers move between two targets (handoff section 5): which
 * boundary a change waits for, how long its fades run, and the sequencing
 * rule that keeps every crossfade under the headroom ceiling (H3). Pure.
 */
import type { QuantizeUnit } from './musicClock.ts'
import {
  BAR_SECONDS,
  BEAT_SECONDS,
  BREATH_FADE_SECONDS,
  DESCENT_SECONDS,
  DUCK_FADE_SECONDS,
  HARD_FADE_SECONDS,
  LAYER_IDS,
  LAYER_SPECS,
  OFF_DB,
  RETURN_SECONDS,
  type LayerId,
} from './musicConstants.ts'
import { gainsEqual, HEADROOM_CEILING_DBFS, isCalmCue, linearSumDbfs, type Cue, type LayerGains } from './musicMix.ts'
import type { MusicTarget } from './musicState.ts'

export type CueClass =
  | 'silent'
  | 'calm'
  | 'tension'
  | 'combat'
  | 'aftermath'
  | 'setpiece'
  | 'transmission'
  | 'strike'
  | 'reveal'

export function cueClass(cue: Cue): CueClass {
  if (cue === 'SILENT') return 'silent'
  if (isCalmCue(cue)) return 'calm'
  switch (cue) {
    case 'CS_COMBAT':
    case 'SIEGE_COMBAT':
    case 'MONUMENT_COMBAT':
      return 'combat'
    case 'CS_IMPACT':
    case 'CS_SUCCESS':
    case 'MONUMENT_ACTIVATING':
    case 'MONUMENT_DAMAGED':
      return 'aftermath'
    case 'REVEAL_APPROACH':
    case 'REVEAL_IMPACT':
    case 'REVEAL_SETTLE':
    case 'RIVAL_FOCUS':
      return 'setpiece'
    case 'REVEAL_TRANSMISSION':
    case 'RIVAL_TRANSMISSION':
      return 'transmission'
    case 'FS_FLIGHT':
    case 'FS_TRANSMISSION':
    case 'FS_VACUUM':
    case 'FS_BREATH':
      return 'strike'
    case 'MONUMENT_REVEAL':
      return 'reveal'
    default:
      return 'tension'
  }
}

export interface TransitionSpec {
  readonly unit: QuantizeUnit
  readonly fadeSeconds: number
  /** ASSAULT enters with a 20 ms ramp starting on the boundary ("the drop lands on the downbeat"). */
  readonly hard: boolean
  /** Rises start half a fall after the falls (handoff 5 sequencing). */
  readonly sequenced: boolean
}

const spec = (unit: QuantizeUnit, fadeSeconds: number, hard = false, sequenced = true): TransitionSpec =>
  Object.freeze({ unit, fadeSeconds, hard, sequenced })

export const TRANSITIONS = Object.freeze({
  calmArcChange: spec('phrase', 2 * BAR_SECONDS),
  /** FOOTHOLD ⇄ FOOTHOLD_WORKS: the industry layer enters at the next bar, before Vesper answers. */
  calmSubState: spec('bar', BAR_SECONDS),
  /** Tier, damage and flavor modifiers lift or settle at the next phrase. */
  calmModifier: spec('phrase', BAR_SECONDS),
  toTension: spec('bar', BAR_SECONDS),
  toCombat: spec('bar', BEAT_SECONDS, true),
  fire: spec('beat', BEAT_SECONDS, true),
  setPiece: spec('beat', BEAT_SECONDS),
  transmission: spec('immediate', DUCK_FADE_SECONDS),
  aftermath: spec('beat', BEAT_SECONDS),
  release: spec('phrase', BAR_SECONDS),
  dwell: spec('phrase', 2 * BAR_SECONDS),
  rotation: spec('bar', BAR_SECONDS),
  breath: spec('immediate', BREATH_FADE_SECONDS, false, false),
  descent: spec('immediate', DESCENT_SECONDS, false, false),
  ascent: spec('immediate', RETURN_SECONDS, false, false),
})

function gainsEqualExceptEngine(a: LayerGains, b: LayerGains): boolean {
  return gainsEqual({ ...a, engine: 0 }, { ...b, engine: 0 })
}

/** Handoff section 5's table, with the bible's next-bar FOOTHOLD_WORKS entrance. */
export function classifyTransition(from: MusicTarget | null, to: MusicTarget, reason: 'change' | 'dwell' = 'change'): TransitionSpec {
  if (reason === 'dwell') return TRANSITIONS.dwell
  const fromCue = from?.cue ?? 'SILENT'
  const fromClass = cueClass(fromCue)
  const toClass = cueClass(to.cue)
  if (from !== null && fromCue === to.cue) {
    if (toClass === 'calm' && from.viewAway !== to.viewAway && gainsEqualExceptEngine(from.gains, to.gains)) {
      return to.viewAway ? TRANSITIONS.ascent : TRANSITIONS.descent
    }
    return toClass === 'calm' ? TRANSITIONS.calmModifier : TRANSITIONS.toTension
  }
  switch (toClass) {
    case 'transmission':
      return TRANSITIONS.transmission
    case 'strike':
      if (to.cue === 'FS_BREATH') return TRANSITIONS.breath
      if (to.cue === 'FS_FLIGHT' && fromClass !== 'strike') return TRANSITIONS.fire
      return TRANSITIONS.setPiece
    case 'setpiece':
    case 'reveal':
      return TRANSITIONS.setPiece
    case 'combat':
      return fromClass === 'combat' ? TRANSITIONS.aftermath : TRANSITIONS.toCombat
    case 'aftermath':
      return TRANSITIONS.aftermath
    case 'calm':
      if (fromClass !== 'calm') return TRANSITIONS.release
      return to.arc === from?.arc ? TRANSITIONS.calmSubState : TRANSITIONS.calmArcChange
    case 'tension':
      return fromClass === 'combat' ? TRANSITIONS.aftermath : TRANSITIONS.toTension
    case 'silent':
      return TRANSITIONS.setPiece
  }
}

/** A layer's planned ramp, in dB (null = off). */
export interface LayerMovePlan {
  readonly layer: LayerId
  readonly start: number
  readonly end: number
  readonly targetDb: number | null
}

type LevelsDb = Readonly<Partial<Record<LayerId, number>>>

function level(gains: LevelsDb, layer: LayerId): number {
  return gains[layer] ?? OFF_DB
}

/**
 * Falls start on the boundary; rises start half a fall later (or on the
 * boundary when nothing falls). A hard ASSAULT entrance lands on the boundary
 * only when the resulting envelope stays under the ceiling; otherwise it is
 * sequenced like any other rise, so H3 holds for every pair of targets.
 */
export function planCrossfade(
  from: LevelsDb,
  to: LayerGains,
  boundary: number,
  transition: TransitionSpec,
  layers: readonly LayerId[] = LAYER_IDS,
): LayerMovePlan[] {
  const changed = layers.filter((layer) => Math.abs(level(to, layer) - level(from, layer)) > 1e-6)
  const falls = changed.filter((layer) => level(to, layer) < level(from, layer))
  const rises = changed.filter((layer) => level(to, layer) > level(from, layer))
  const duration = transition.fadeSeconds
  const riseStart = boundary + (transition.sequenced && falls.length > 0 ? duration / 2 : 0)
  const targetDb = (layer: LayerId) => (to[layer] === undefined ? null : (to[layer] as number))
  const plan = (hard: boolean): LayerMovePlan[] => [
    ...falls.map((layer) => ({ layer, start: boundary, end: boundary + duration, targetDb: targetDb(layer) })),
    ...rises.map((layer) =>
      hard && layer === 'assault'
        ? { layer, start: boundary, end: boundary + HARD_FADE_SECONDS, targetDb: targetDb(layer) }
        : { layer, start: riseStart, end: riseStart + duration, targetDb: targetDb(layer) },
    ),
  ]
  if (!transition.hard || !rises.includes('assault')) return plan(false)
  const hard = plan(true)
  return envelopePeakDbfs(from, hard) <= HEADROOM_CEILING_DBFS ? hard : plan(false)
}

/**
 * H3: the arithmetic worst case (every layer's true-peak ceiling coincident)
 * of a planned crossfade, sampled across its whole span.
 */
export function envelopePeakDbfs(from: LevelsDb, moves: readonly LayerMovePlan[], samples = 200): number {
  if (moves.length === 0) {
    return linearSumDbfs(LAYER_IDS.filter((l) => from[l] !== undefined).map((l) => level(from, l) + LAYER_SPECS[l].truePeakCeilingDbtp))
  }
  const start = Math.min(...moves.map((move) => move.start))
  const end = Math.max(...moves.map((move) => move.end))
  let worst = -Infinity
  for (let index = 0; index <= samples; index += 1) {
    const time = start + ((end - start) * index) / samples
    const terms: number[] = []
    for (const layer of LAYER_IDS) {
      const move = moves.find((candidate) => candidate.layer === layer)
      const begin = level(from, layer)
      let db = begin
      if (move !== undefined) {
        const finish = move.targetDb ?? OFF_DB
        const progress = move.end <= move.start ? (time >= move.start ? 1 : 0) : Math.max(0, Math.min(1, (time - move.start) / (move.end - move.start)))
        db = begin + (finish - begin) * progress
      }
      if (db > OFF_DB) terms.push(db + LAYER_SPECS[layer].truePeakCeilingDbtp)
    }
    worst = Math.max(worst, linearSumDbfs(terms))
  }
  return worst
}
