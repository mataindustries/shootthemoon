export type SiegeOrder = 'DEFEND' | 'MINE' | 'HARDEN'
export type SiegeStatus = 'constructing' | 'command' | 'waves' | 'operational' | 'damaged' | 'repairing'

export interface OrbitalSiegeSnapshot {
  readonly status: SiegeStatus
  readonly elapsedMs: number
  readonly progress: number
  readonly order: SiegeOrder | null
  readonly wavesResolved: number
  readonly platformHealth: number
  readonly outpostDamage: number
  readonly oreLost: number
  readonly energyLoss: number
  readonly attempts: number
}

export const PLATFORM_ORE_COST = 60 // Same resource threshold as the first extractor.
export const PLATFORM_REPAIR_COST = 20
export const PLATFORM_POWER_KW = 6
export const PLATFORM_BUILD_MS = 30_000
export const SIEGE_ALERT_MS = 6_000
export const SIEGE_COMMAND_END_MS = 11_000
export const SIEGE_WAVE_TIMES = [18_000, 26_000, 34_000] as const
export const PLATFORM_REPAIR_MS = 15_000

export const SIEGE_ORDERS = {
  DEFEND: { title: 'PRIORITIZE DEFENSE', miners: 0, builders: 1, defenders: 2, power: 6, platformHit: 5, outpostHit: 0,
    detail: '0 mine · 1 build · 2 defend · 6 kW. Light hull damage; intercepts all waves when powered.' },
  MINE: { title: 'PRESERVE MINING', miners: 2, builders: 1, defenders: 0, power: 0, platformHit: 28, outpostHit: 12,
    detail: '2 mine · 1 build · 0 defend. Breach: −36% production, −30 ore, −25% energy.' },
  HARDEN: { title: 'HARDEN PLATFORM', miners: 0, builders: 2, defenders: 1, power: 3, platformHit: 2, outpostHit: 8,
    detail: '0 mine · 2 build · 1 defend · 3 kW. Protects platform; −24% outpost production.' },
} as const

export function siegeIsActive(siege: OrbitalSiegeSnapshot | null): boolean {
  return siege !== null && siege.status !== 'operational' && siege.status !== 'damaged'
}

/** Allocation shares the outpost's three robots and generated solar power. */
export function siegeAllocation(siege: OrbitalSiegeSnapshot | null) {
  const active = siegeIsActive(siege)
  const order = active && siege !== null && siege.order !== null && siege.status !== 'repairing'
    ? SIEGE_ORDERS[siege.order] : null
  return {
    active,
    miners: order?.miners ?? 1,
    builders: active ? order?.builders ?? 2 : 0,
    defenders: active ? order?.defenders ?? 0 : 0,
    powerKw: active ? siege?.status === 'repairing' ? 4 : PLATFORM_POWER_KW : 0,
    defenseKw: order?.power ?? 0,
    readiness: active ? (order?.defenders ?? 0) : 3,
  }
}

/** Strictly validate new data while old save versions migrate with no siege. */
export function parseOrbitalSiege(value: unknown): OrbitalSiegeSnapshot | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) return undefined
  const s = value as OrbitalSiegeSnapshot
  if (!['constructing', 'command', 'waves', 'operational', 'damaged', 'repairing'].includes(s.status) ||
      (s.order !== null && !['DEFEND', 'MINE', 'HARDEN'].includes(s.order))) return undefined
  const bounded = (v: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
  if (!bounded(s.elapsedMs, SIEGE_WAVE_TIMES[2]) || !bounded(s.progress, 1) ||
      !bounded(s.platformHealth, 100) || !bounded(s.outpostDamage, 100) ||
      !bounded(s.oreLost, 30) || !bounded(s.energyLoss, 0.25) ||
      !bounded(s.wavesResolved, 3) || !Number.isInteger(s.wavesResolved) ||
      !Number.isInteger(s.attempts) || s.attempts < 1) return undefined
  if ((s.status === 'constructing' && (s.elapsedMs >= SIEGE_ALERT_MS || s.order !== null)) ||
      (s.status === 'command' && (s.elapsedMs < SIEGE_ALERT_MS || s.elapsedMs >= SIEGE_COMMAND_END_MS || s.order !== null)) ||
      (s.status === 'waves' && (s.order === null || s.elapsedMs >= SIEGE_WAVE_TIMES[2])) ||
      (s.status === 'damaged' && (s.wavesResolved !== 3 || s.platformHealth >= 40)) ||
      (s.status === 'operational' && (s.progress !== 1 || s.platformHealth < 40 || s.wavesResolved !== 3))) return undefined
  const expectedWaves = SIEGE_WAVE_TIMES.filter((time) => s.elapsedMs >= time).length
  if ((s.status === 'repairing' && (s.elapsedMs >= PLATFORM_REPAIR_MS || s.wavesResolved !== 3)) ||
      (['constructing', 'command', 'waves'].includes(s.status) && s.wavesResolved !== expectedWaves) ||
      (s.status === 'damaged' && s.elapsedMs !== SIEGE_WAVE_TIMES[2])) return undefined
  return { status: s.status, elapsedMs: s.elapsedMs, progress: s.progress, order: s.order,
    wavesResolved: s.wavesResolved, platformHealth: s.platformHealth, outpostDamage: s.outpostDamage,
    oreLost: s.oreLost, energyLoss: s.energyLoss, attempts: s.attempts }
}
