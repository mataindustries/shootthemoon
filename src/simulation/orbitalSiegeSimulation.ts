import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { CounterstrikeOrder, OutpostDamageState } from '../domain/counterstrike.ts'
import {
  PLATFORM_ORE_COST, PLATFORM_REPAIR_COST, PLATFORM_POWER_KW, PLATFORM_BUILD_MS,
  PLATFORM_REPAIR_MS, SIEGE_ALERT_MS, SIEGE_COMMAND_END_MS, SIEGE_WAVE_TIMES,
  SIEGE_ORDERS, siegeIsActive, type SiegeOrder,
} from '../domain/orbitalSiege.ts'
import { advanceOutpostOperations, calculateOutpostOperations } from './outpostOperations.ts'

export function canStartOrbitalSiege(outpost: OutpostSnapshot, repair = false): boolean {
  const siege = outpost.orbitalSiege
  return outpost.extractor?.status === 'active' && outpost.robot.state === 'idle' &&
    outpost.module?.status !== 'constructing' && !siegeIsActive(siege) &&
    (!repair || siege?.status === 'damaged' || (siege?.outpostDamage ?? 0) > 0) &&
    outpost.lunarOre >= (repair ? PLATFORM_REPAIR_COST : PLATFORM_ORE_COST) &&
    calculateOutpostOperations(outpost).energyGeneratedKw >= (repair ? 4 : PLATFORM_POWER_KW) + 2
}

export function startOrbitalSiege(outpost: OutpostSnapshot, nowMs: number, repair = false): OutpostSnapshot {
  if (!canStartOrbitalSiege(outpost, repair)) return outpost
  const previous = outpost.orbitalSiege
  return {
    ...outpost, updatedAtMs: nowMs,
    lunarOre: outpost.lunarOre - (repair ? PLATFORM_REPAIR_COST : PLATFORM_ORE_COST),
    operations: { ...outpost.operations, lastUpdatedAtMs: nowMs },
    orbitalSiege: repair && previous !== null
      ? { ...previous, status: 'repairing', elapsedMs: 0, progress: 0 }
      : { status: 'constructing', elapsedMs: 0, progress: 0, order: null, wavesResolved: 0,
          platformHealth: 100, outpostDamage: previous?.outpostDamage ?? 0,
          energyLoss: previous?.energyLoss ?? 0, oreLost: 0, attempts: (previous?.attempts ?? 0) + 1 },
  }
}

export function issueSiegeOrder(outpost: OutpostSnapshot, order: SiegeOrder): OutpostSnapshot {
  if (outpost.orbitalSiege?.status !== 'command') return outpost
  return { ...outpost, orbitalSiege: { ...outpost.orbitalSiege, order, status: 'waves' } }
}

/** Split production at every event boundary so large and small ticks agree. No offline waves. */
export function advanceOrbitalSiege(
  initial: OutpostSnapshot, nowMs: number, damage: OutpostDamageState = 'INTACT',
  commandOrder: CounterstrikeOrder | null = null, commandActive = false,
): OutpostSnapshot {
  let outpost = initial
  let cursor = initial.operations.lastUpdatedAtMs
  if (nowMs <= cursor) return initial
  while (cursor < nowMs && siegeIsActive(outpost.orbitalSiege)) {
    const siege = outpost.orbitalSiege!
    const repairing = siege.status === 'repairing'
    const boundaries = repairing ? [PLATFORM_REPAIR_MS] :
      [SIEGE_ALERT_MS, SIEGE_COMMAND_END_MS, ...SIEGE_WAVE_TIMES]
    const next = boundaries.find((time) => time > siege.elapsedMs)!
    const delta = Math.min(nowMs - cursor, next - siege.elapsedMs)
    outpost = advanceOutpostOperations(outpost, cursor + delta, damage, commandOrder, commandActive)
    cursor += delta
    const elapsedMs = siege.elapsedMs + delta
    let updated = { ...siege, elapsedMs, progress: Math.min(1, elapsedMs / (repairing ? PLATFORM_REPAIR_MS : PLATFORM_BUILD_MS)) }
    if (repairing) {
      if (elapsedMs >= PLATFORM_REPAIR_MS) updated = { ...updated, status: 'operational', platformHealth: 100,
        outpostDamage: 0, energyLoss: 0, progress: 1 }
    } else {
      if (elapsedMs >= SIEGE_ALERT_MS && updated.status === 'constructing') updated.status = 'command'
      if (elapsedMs >= SIEGE_COMMAND_END_MS && updated.order === null) {
        updated.order = 'HARDEN'
        updated.status = 'waves'
      }
      if (updated.wavesResolved < 3 && elapsedMs >= SIEGE_WAVE_TIMES[updated.wavesResolved]!) {
        const effect = SIEGE_ORDERS[updated.order!]
        const metrics = calculateOutpostOperations(outpost, damage, commandOrder, commandActive)
        const powered = effect.power === 0 ? 1 : metrics.defenseAllocationKw / effect.power
        const platformHit = Math.round(effect.platformHit + (28 - effect.platformHit) * (1 - powered))
        const outpostHit = Math.round(effect.outpostHit + (12 - effect.outpostHit) * (1 - powered))
        updated.platformHealth = Math.max(0, updated.platformHealth - platformHit)
        updated.outpostDamage = Math.min(60, updated.outpostDamage + outpostHit)
        updated.wavesResolved += 1
        if (updated.wavesResolved === 3) {
          const failure = updated.platformHealth < 40
          updated.status = failure ? 'damaged' : 'operational'
          if (failure) {
            const lost = Math.min(30, outpost.lunarOre)
            outpost = { ...outpost, lunarOre: outpost.lunarOre - lost }
            updated.oreLost = lost
            updated.energyLoss = 0.25
          } else {
            updated.energyLoss = 0
          }
        }
      }
    }
    outpost = { ...outpost, orbitalSiege: updated }
  }
  return advanceOutpostOperations(outpost, nowMs, damage, commandOrder, commandActive)
}
