/**
 * The five-layer mix (handoff 3.4–3.5): the cue table, its modifiers in their
 * locked order, invariants I1–I2 and the arithmetic headroom bound behind I3.
 * Gains are dB relative to each layer's unity level; an absent layer is off.
 * Pure: no audio, no time.
 */
import type { MonumentKind } from '../../domain/territoryMonument.ts'
import { LAYER_IDS, LAYER_SPECS, type LayerId } from './musicConstants.ts'

export const CUES = [
  'SILENT',
  'RECON',
  'FOOTHOLD',
  'FOOTHOLD_WORKS',
  'CONTESTED',
  'RETALIATION',
  'ASCENDANT',
  'CLAIMED',
  'REVEAL_APPROACH',
  'REVEAL_IMPACT',
  'REVEAL_TRANSMISSION',
  'REVEAL_SETTLE',
  'RIVAL_FOCUS',
  'RIVAL_TRANSMISSION',
  'STRIKE_DECISION',
  'FS_FLIGHT',
  'FS_TRANSMISSION',
  'FS_VACUUM',
  'FS_BREATH',
  'CS_ALERT',
  'CS_WARNING',
  'CS_COMBAT',
  'CS_IMPACT',
  'CS_SUCCESS',
  'SIEGE_BUILD',
  'SIEGE_ALERT',
  'SIEGE_COMBAT',
  'SIEGE_REPAIR',
  'MONUMENT_CHOICES',
  'MONUMENT_BUILD',
  'MONUMENT_ALERT',
  'MONUMENT_ALERT_DWELL',
  'MONUMENT_COMBAT',
  'MONUMENT_ACTIVATING',
  'MONUMENT_DAMAGED',
  'MONUMENT_REVEAL',
] as const
export type Cue = (typeof CUES)[number]

export const ARCS = ['RECON', 'FOOTHOLD', 'CONTESTED', 'RETALIATION', 'ASCENDANT', 'CLAIMED'] as const
export type Arc = (typeof ARCS)[number]

export const CALM_CUES = ['RECON', 'FOOTHOLD', 'FOOTHOLD_WORKS', 'CONTESTED', 'RETALIATION', 'ASCENDANT', 'CLAIMED'] as const satisfies readonly Cue[]
export type CalmCue = (typeof CALM_CUES)[number]
/** Infrastructure tier cues: ENGINE +1 dB per tier (handoff 3.5 item 1). */
export const TIER_CUES = ['FOOTHOLD_WORKS', 'CONTESTED', 'RETALIATION', 'ASCENDANT'] as const satisfies readonly Cue[]

export type LayerGains = Readonly<Partial<Record<LayerId, number>>>
type MixRow = Readonly<Partial<Record<LayerId, number | 'arc'>>>

/** Handoff 3.4. Blank cells are absent (off). */
export const MIX_TABLE: Readonly<Record<Cue, MixRow>> = Object.freeze({
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
})

/** Siege "arc" cells carry the arc's identity layer; other arcs add nothing. */
export const SIEGE_ARC_CELLS: Readonly<Partial<Record<Arc, LayerGains>>> = Object.freeze({
  CONTESTED: { pressure: -12 },
  CLAIMED: { claim: -10 },
})

/** CLAIMED sets ENGINE to the completed monument's flavor (handoff 3.5 item 4). */
export const MONUMENT_FLAVOR_ENGINE_DB: Readonly<Record<MonumentKind, number>> = Object.freeze({
  HELIOS_SPIRE: -4,
  BASTION_OBELISK: -6,
  CRATER_CROWN: -10,
  SIGNAL_ARRAY: -12,
})

export const TIER_STEP_DB = 1
export const VIEW_AWAY_ENGINE_DB = -4
export const DAMAGE_ENGINE_DB = -3
export const ASCENDANT_DAMAGE_PRESSURE_DB = -14
/** Rotation thinning (handoff 3.7): ENGINE off, PRESSURE −6, CLAIM −4. */
export const THIN_PRESSURE_DB = -6
export const THIN_CLAIM_DB = -4
/** I3: every reachable worst-case sum stays at or below this. */
export const HEADROOM_CEILING_DBFS = -1

export function isCalmCue(cue: Cue): cue is CalmCue {
  return (CALM_CUES as readonly Cue[]).includes(cue)
}

export interface MixModifiers {
  readonly arc: Arc
  readonly moduleActive: boolean
  readonly siegeOperational: boolean
  /** `phase` is orbit, selected or returning. */
  readonly viewAway: boolean
  readonly counterstrikeDamaged: boolean
  readonly siegeDamaged: boolean
  readonly monumentDamaged: boolean
  /** The completed monument (CLAIMED flavor). */
  readonly monumentKind: MonumentKind | null
  /** `csStatus` is neither dormant nor resolved (invariant I1). */
  readonly counterstrikeActive: boolean
  /** Scar exploration: the arc calm cue with ENGINE off. */
  readonly engineOff: boolean
}

type MutableGains = Partial<Record<LayerId, number>>

function tableGains(cue: Cue, arc: Arc): MutableGains {
  const row = MIX_TABLE[cue]
  const gains: MutableGains = {}
  for (const layer of LAYER_IDS) {
    const cell = row[layer]
    if (cell === undefined) continue
    if (cell === 'arc') {
      const arcGain = SIEGE_ARC_CELLS[arc]?.[layer]
      if (arcGain !== undefined) gains[layer] = arcGain
    } else {
      gains[layer] = cell
    }
  }
  return gains
}

function addEngine(gains: MutableGains, db: number): void {
  if (gains.engine !== undefined) gains.engine += db
}

/** Modifiers 1–4 in their locked order; 5 (operating-mode tilt) is off in package 1. */
export function applyModifiers(cue: Cue, base: LayerGains, m: MixModifiers): LayerGains {
  const gains: MutableGains = { ...base }
  if ((TIER_CUES as readonly Cue[]).includes(cue)) {
    addEngine(gains, (m.moduleActive ? TIER_STEP_DB : 0) + (m.siegeOperational ? TIER_STEP_DB : 0))
  }
  if (isCalmCue(cue)) {
    if (m.viewAway) addEngine(gains, VIEW_AWAY_ENGINE_DB)
    if (m.counterstrikeDamaged || m.siegeDamaged || m.monumentDamaged) addEngine(gains, DAMAGE_ENGINE_DB)
    if (cue === 'ASCENDANT' && m.counterstrikeDamaged) gains.pressure = ASCENDANT_DAMAGE_PRESSURE_DB
  }
  if (cue === 'CLAIMED' && m.monumentKind !== null) gains.engine = MONUMENT_FLAVOR_ENGINE_DB[m.monumentKind]
  return gains
}

/** I1 (CLAIM and PRESSURE never together, CLAIM off during a Counterstrike) and I2 (≤ 0 dB). */
export function applyInvariants(gains: LayerGains, counterstrikeActive: boolean): LayerGains {
  const result: MutableGains = {}
  for (const layer of LAYER_IDS) {
    const gain = gains[layer]
    if (gain !== undefined) result[layer] = Math.min(0, gain)
  }
  if (counterstrikeActive) delete result.claim
  else if (result.claim !== undefined) delete result.pressure
  return result
}

/** Table → modifiers → scar ENGINE off → invariants. */
export function mixGains(cue: Cue, m: MixModifiers): LayerGains {
  const modified: MutableGains = { ...applyModifiers(cue, tableGains(cue, m.arc), m) }
  if (m.engineOff) delete modified.engine
  return applyInvariants(modified, m.counterstrikeActive)
}

export type RotationKind = 'normal' | 'thin' | 'rest'

/** Rotation in long calm (handoff 3.7). Only ever lowers a layer. */
export function rotationGains(gains: LayerGains, kind: RotationKind): LayerGains {
  if (kind === 'normal') return gains
  if (kind === 'rest') return {}
  const thinned: MutableGains = { ...gains }
  delete thinned.engine
  if (thinned.pressure !== undefined) thinned.pressure += THIN_PRESSURE_DB
  if (thinned.claim !== undefined) thinned.claim += THIN_CLAIM_DB
  return thinned
}

export function gainsEqual(a: LayerGains, b: LayerGains): boolean {
  return LAYER_IDS.every((layer) => {
    const left = a[layer]
    const right = b[layer]
    return left === undefined || right === undefined ? left === right : Math.abs(left - right) < 1e-9
  })
}

export function linearSumDbfs(dbValues: readonly number[]): number {
  const sum = dbValues.reduce((total, db) => total + 10 ** (db / 20), 0)
  return sum <= 0 ? -Infinity : 20 * Math.log10(sum)
}

/**
 * H1: Σ 10^((TP + gain)/20) over the layers' true-peak ceilings, as if every
 * peak coincided. `extraDb` adds further terms (a stinger's ceiling + gain).
 */
export function arithmeticPeakDbfs(gains: LayerGains, extraDb: readonly number[] = []): number {
  const terms = LAYER_IDS.filter((layer) => gains[layer] !== undefined).map(
    (layer) => (gains[layer] as number) + LAYER_SPECS[layer].truePeakCeilingDbtp,
  )
  return linearSumDbfs([...terms, ...extraDb])
}
