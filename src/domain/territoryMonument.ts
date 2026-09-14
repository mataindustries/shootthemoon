import type { FirstStrikeSnapshot } from './firstStrike.ts'
import type { OutpostSnapshot } from './outpost.ts'
import { DEFENSE_WINDOW_MS } from './waveDefense.ts'

export const MONUMENT_KINDS = ['HELIOS_SPIRE', 'CRATER_CROWN', 'BASTION_OBELISK', 'SIGNAL_ARRAY'] as const
export type MonumentKind = (typeof MONUMENT_KINDS)[number]
export type MonumentOrder = 'DEFEND' | 'PRESERVE' | 'ACCELERATE'
export type MonumentStatus = 'constructing' | 'command' | 'wave' | 'activating' | 'damaged' | 'repairing' | 'complete'

// Energy is generated solar power, measured over the existing robot work clock.
// There is no battery, currency, inventory or second robot pool.
export const MONUMENT_WORKER_KW = 2
export const MONUMENT_FOUNDATION_MS = 4_000
export const MONUMENT_REPAIR_ORE = 20
export const MONUMENT_REPAIR_WORK_MS = 30_000
export const MONUMENT_REVEAL_MS = 6_000
export const MONUMENTS = {
  HELIOS_SPIRE: { title: 'HELIOS SPIRE', ore: 80, laborMs: 36_000,
    benefit: '+25% solar energy production.', form: 'An illuminated beacon above the lunar horizon.' },
  CRATER_CROWN: { title: 'CRATER CROWN', ore: 90, laborMs: 42_000,
    benefit: '+20% extraction at this territory’s selected terrain.', form: 'An industrial crown built into the existing impact scar.' },
  BASTION_OBELISK: { title: 'BASTION OBELISK', ore: 100, laborMs: 48_000,
    benefit: '25% less siege damage; +50% repair speed; halves production damage effects.', form: 'An armored obelisk held by massive structural braces.' },
  SIGNAL_ARRAY: { title: 'SIGNAL ARRAY', ore: 80, laborMs: 36_000,
    benefit: 'Halves logistics losses; +50% rival scan speed and detection lead.', form: 'A geometric antenna with a pulsing orbital signal.' },
} as const

export const MONUMENT_ORDERS = {
  DEFEND: { title: 'DEFEND', miners: 0, builders: 1, defenders: 2, defenseKw: 6,
    detail: '1 build · 2 defend · 8 kW. Protect hull; mining pauses.' },
  PRESERVE: { title: 'PRESERVE PRODUCTION', miners: 2, builders: 1, defenders: 0, defenseKw: 0,
    detail: '2 mine · 1 build · 2 kW + mining. Heavy hull and storage losses.' },
  ACCELERATE: { title: 'ACCELERATE CONSTRUCTION', miners: 0, builders: 3, defenders: 0, defenseKw: 0,
    detail: '3 build · 6 kW. Triple build speed; exposed hull. Mining pauses.' },
} as const

export interface TerritoryMonumentSnapshot {
  readonly kind: MonumentKind
  readonly anchor: 'outpost' | 'impact-scar'
  readonly status: MonumentStatus
  readonly phaseElapsedMs: number
  readonly workMs: number
  readonly repairWorkMs: number
  readonly health: number
  readonly wavesResolved: number
  readonly orders: readonly (MonumentOrder | null)[]
  readonly productionPenalty: number
  readonly energyLoss: number
  readonly oreLost: number
  readonly completedAtMs: number | null
  readonly revealSeen: boolean
  /** Optional for existing saves; null means no manual shot in that wave. */
  readonly defenseShots?: readonly (number | null)[]
}

export function monumentsUnlocked(outpost: OutpostSnapshot, firstStrike: FirstStrikeSnapshot | null): boolean {
  return outpost.monument !== null || outpost.orbitalSiege?.status === 'operational' || firstStrike?.status === 'COMPLETE'
}

export function monumentIsActive(monument: TerritoryMonumentSnapshot | null): boolean {
  return monument !== null && monument.status !== 'complete' && monument.status !== 'damaged'
}

export function monumentModifiers(monument: TerritoryMonumentSnapshot | null) {
  const kind = monument?.status === 'complete' ? monument.kind : null
  return {
    energy: kind === 'HELIOS_SPIRE' ? 1.25 : 1,
    extraction: kind === 'CRATER_CROWN' ? 1.2 : 1,
    damage: kind === 'BASTION_OBELISK' ? 0.75 : 1,
    damagePenalty: kind === 'BASTION_OBELISK' ? 0.5 : 1,
    repairSpeed: kind === 'BASTION_OBELISK' ? 1.5 : 1,
    logisticsLoss: kind === 'SIGNAL_ARRAY' ? 0.5 : 1,
    detection: kind === 'SIGNAL_ARRAY' ? 1.5 : 1,
  }
}

export function monumentAllocation(monument: TerritoryMonumentSnapshot) {
  const active = monumentIsActive(monument)
  const waiting = monument.status === 'command'
  const order = monument.status === 'wave' ? monument.orders[monument.wavesResolved] : null
  const choice = order ? MONUMENT_ORDERS[order] : null
  const builders = !active || waiting ? 0 : choice?.builders ?? 2
  const workRemaining = monument.status === 'repairing'
    ? monument.repairWorkMs < MONUMENT_REPAIR_WORK_MS
    : monument.workMs < MONUMENTS[monument.kind].laborMs
  return { active, miners: waiting ? 1 : choice?.miners ?? 1, builders,
    defenders: choice?.defenders ?? 0, powerKw: workRemaining ? builders * MONUMENT_WORKER_KW : 0,
    defenseKw: choice?.defenseKw ?? 0, readiness: choice?.defenders ?? (waiting ? 2 : 0) }
}

/** Strict facts validation: no missing payments, skipped decisions or replayed waves. */
export function parseTerritoryMonument(value: unknown): TerritoryMonumentSnapshot | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) return undefined
  const m = value as TerritoryMonumentSnapshot
  const bounded = (n: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max
  if (!MONUMENT_KINDS.includes(m.kind) || !['outpost', 'impact-scar'].includes(m.anchor) ||
      !['constructing', 'command', 'wave', 'activating', 'damaged', 'repairing', 'complete'].includes(m.status) ||
      !bounded(m.phaseElapsedMs, 8_000) || !bounded(m.workMs, MONUMENTS[m.kind].laborMs) ||
      !bounded(m.repairWorkMs, MONUMENT_REPAIR_WORK_MS) || !bounded(m.health, 100) ||
      !bounded(m.wavesResolved, 3) || !Number.isInteger(m.wavesResolved) ||
      !bounded(m.productionPenalty, .3) || !bounded(m.energyLoss, .15) || !bounded(m.oreLost, 18) ||
      typeof m.revealSeen !== 'boolean' || !Array.isArray(m.orders) || m.orders.length !== 3 ||
      m.orders.some((o) => o !== null && !Object.hasOwn(MONUMENT_ORDERS, o))) return undefined
  if (m.orders.some((o, i) => i < m.wavesResolved ? o === null : i === m.wavesResolved && m.status === 'wave' ? o === null : o !== null)) return undefined
  if (m.defenseShots !== undefined && (!Array.isArray(m.defenseShots) || m.defenseShots.length !== 3 ||
      m.defenseShots.some((shot, i) => shot !== null && (!bounded(shot, DEFENSE_WINDOW_MS) ||
        m.orders[i] === null || (i === m.wavesResolved && shot > m.phaseElapsedMs))))) return undefined
  if (m.anchor === 'impact-scar' && m.kind !== 'CRATER_CROWN') return undefined
  if (!['damaged', 'repairing'].includes(m.status) && (m.productionPenalty !== 0 || m.energyLoss !== 0)) return undefined
  if (m.status !== 'repairing' && m.repairWorkMs !== 0 && !(m.status === 'complete' && m.repairWorkMs === MONUMENT_REPAIR_WORK_MS)) return undefined
  if (m.status === 'constructing' && (m.wavesResolved !== 0 || m.phaseElapsedMs >= MONUMENT_FOUNDATION_MS)) return undefined
  if (m.status === 'command' && (m.wavesResolved >= 3 || m.phaseElapsedMs !== 0)) return undefined
  if (m.status === 'wave' && (m.wavesResolved >= 3 || m.phaseElapsedMs >= [6_000, 7_000, 8_000][m.wavesResolved]!)) return undefined
  if (['activating', 'damaged', 'repairing', 'complete'].includes(m.status) && (m.wavesResolved !== 3 || m.phaseElapsedMs !== 0)) return undefined
  if ((m.status === 'damaged' || m.status === 'repairing') && (m.health >= 40 || m.productionPenalty !== .3 || m.energyLoss !== .15)) return undefined
  if (m.status === 'activating' && (m.health < 40 || m.workMs >= MONUMENTS[m.kind].laborMs)) return undefined
  if (m.status === 'repairing' && m.repairWorkMs >= MONUMENT_REPAIR_WORK_MS) return undefined
  if (m.status === 'complete' ? (!bounded(m.completedAtMs!, Number.MAX_SAFE_INTEGER) || m.completedAtMs === null || m.health < 40 || m.workMs !== MONUMENTS[m.kind].laborMs || m.productionPenalty !== 0 || m.energyLoss !== 0)
    : m.completedAtMs !== null || m.revealSeen) return undefined
  return { kind: m.kind, anchor: m.anchor, status: m.status, phaseElapsedMs: m.phaseElapsedMs,
    workMs: m.workMs, repairWorkMs: m.repairWorkMs, health: m.health, wavesResolved: m.wavesResolved,
    orders: [...m.orders], productionPenalty: m.productionPenalty, energyLoss: m.energyLoss,
    oreLost: m.oreLost, completedAtMs: m.completedAtMs, revealSeen: m.revealSeen,
    ...(m.defenseShots === undefined ? {} : { defenseShots: [...m.defenseShots] }) }
}
