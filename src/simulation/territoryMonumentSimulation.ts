import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { CounterstrikeOrder, OutpostDamageState } from '../domain/counterstrike.ts'
import { siegeIsActive } from '../domain/orbitalSiege.ts'
import { MONUMENTS, MONUMENT_FOUNDATION_MS, MONUMENT_REPAIR_ORE, MONUMENT_REPAIR_WORK_MS,
  monumentAllocation, monumentIsActive, monumentsUnlocked, type MonumentKind, type MonumentOrder,
  type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { DEFENSE_WINDOW_MS, resolveDefenseDamage } from '../domain/waveDefense.ts'
import { advanceOutpostOperations, calculateOutpostOperations } from './outpostOperations.ts'

export function canStartMonument(outpost: OutpostSnapshot, kind: MonumentKind, firstStrike: FirstStrikeSnapshot | null, repair = false): boolean {
  return monumentsUnlocked(outpost, firstStrike) && outpost.extractor?.status === 'active' &&
    outpost.robot.state === 'idle' && outpost.module?.status !== 'constructing' && !siegeIsActive(outpost.orbitalSiege) &&
    (repair ? outpost.monument?.status === 'damaged' : outpost.monument === null) &&
    outpost.lunarOre >= (repair ? MONUMENT_REPAIR_ORE : MONUMENTS[kind].ore) &&
    calculateOutpostOperations(outpost).energyGeneratedKw >= (repair ? 2.01 : 6)
}

export function startMonument(outpost: OutpostSnapshot, kind: MonumentKind, firstStrike: FirstStrikeSnapshot | null, nowMs: number, repair = false): OutpostSnapshot {
  if (!canStartMonument(outpost, kind, firstStrike, repair)) return outpost
  const monument: TerritoryMonumentSnapshot = repair && outpost.monument !== null
    ? { ...outpost.monument, status: 'repairing', repairWorkMs: 0 }
    : { kind, anchor: kind === 'CRATER_CROWN' && firstStrike?.scar ? 'impact-scar' : 'outpost',
        status: 'constructing', phaseElapsedMs: 0, workMs: 0, repairWorkMs: 0, health: 100,
        wavesResolved: 0, orders: [null, null, null], productionPenalty: 0, energyLoss: 0,
        oreLost: 0, completedAtMs: null, revealSeen: false, defenseShots: [null, null, null] }
  return { ...outpost, updatedAtMs: nowMs, lunarOre: outpost.lunarOre - (repair ? MONUMENT_REPAIR_ORE : MONUMENTS[kind].ore),
    operations: { ...outpost.operations, lastUpdatedAtMs: nowMs }, monument }
}

export function issueMonumentOrder(outpost: OutpostSnapshot, order: MonumentOrder): OutpostSnapshot {
  const m = outpost.monument
  if (m?.status !== 'command') return outpost
  const orders = [...m.orders]
  orders[m.wavesResolved] = order
  return { ...outpost, monument: { ...m, status: 'wave', phaseElapsedMs: 0, orders } }
}

export function fireMonumentDefense(outpost: OutpostSnapshot, wave: number): OutpostSnapshot {
  const m = outpost.monument
  if (m?.status !== 'wave' || wave !== m.wavesResolved || m.phaseElapsedMs > DEFENSE_WINDOW_MS ||
      m.defenseShots?.[wave] != null) return outpost
  const defenseShots = [...(m.defenseShots ?? [null, null, null])]
  defenseShots[wave] = m.phaseElapsedMs
  return { ...outpost, monument: { ...m, defenseShots } }
}

function complete(m: TerritoryMonumentSnapshot, nowMs: number): TerritoryMonumentSnapshot {
  return { ...m, status: 'complete', workMs: MONUMENTS[m.kind].laborMs, phaseElapsedMs: 0,
    productionPenalty: 0, energyLoss: 0, completedAtMs: nowMs }
}

/** Split at wave and labor boundaries. A command waits indefinitely, including on restore. */
export function advanceTerritoryMonument(initial: OutpostSnapshot, nowMs: number,
  damage: OutpostDamageState = 'INTACT', commandOrder: CounterstrikeOrder | null = null, commandActive = false): OutpostSnapshot {
  if (commandActive) return advanceOutpostOperations(initial, nowMs, damage, commandOrder, true)
  let outpost = initial
  let cursor = initial.operations.lastUpdatedAtMs
  while (cursor < nowMs && monumentIsActive(outpost.monument)) {
    const m = outpost.monument!
    if (m.status === 'command') break
    const repairing = m.status === 'repairing'
    const allocation = monumentAllocation(m)
    const metrics = calculateOutpostOperations(outpost, damage, commandOrder)
    const powerFraction = allocation.powerKw > 0 ? metrics.monumentAllocationKw / allocation.powerKw : 0
    const speed = allocation.builders * powerFraction
    const remaining = repairing ? MONUMENT_REPAIR_WORK_MS - m.repairWorkMs : MONUMENTS[m.kind].laborMs - m.workMs
    const workBoundary = speed > 0 && remaining > 1e-7 ? remaining / speed : Infinity
    const phaseBoundary = m.status === 'constructing' ? MONUMENT_FOUNDATION_MS - m.phaseElapsedMs :
      m.status === 'wave' ? OCTOGONALS.waves[m.wavesResolved]!.durationMs - m.phaseElapsedMs : Infinity
    const delta = Math.min(nowMs - cursor, phaseBoundary, workBoundary)
    outpost = advanceOutpostOperations(outpost, cursor + delta, damage, commandOrder)
    cursor += delta
    const work = Math.min(remaining, delta * speed)
    let updated: TerritoryMonumentSnapshot = { ...m,
      workMs: repairing ? m.workMs : Math.min(MONUMENTS[m.kind].laborMs, m.workMs + work),
      repairWorkMs: repairing ? Math.min(MONUMENT_REPAIR_WORK_MS, m.repairWorkMs + work) : m.repairWorkMs,
      phaseElapsedMs: m.status === 'constructing' || m.status === 'wave' ? m.phaseElapsedMs + delta : 0 }
    if (repairing && updated.repairWorkMs >= MONUMENT_REPAIR_WORK_MS - 1e-7) {
      updated = complete({ ...updated, health: 100, repairWorkMs: MONUMENT_REPAIR_WORK_MS }, cursor)
    } else if (m.status === 'activating' && updated.workMs >= MONUMENTS[m.kind].laborMs - 1e-7) {
      updated = complete(updated, cursor)
    } else if (m.status === 'constructing' && delta >= phaseBoundary) {
      updated = { ...updated, status: 'command', phaseElapsedMs: 0 }
    } else if (m.status === 'wave' && delta >= phaseBoundary) {
      const wave = OCTOGONALS.waves[m.wavesResolved]!
      const order = m.orders[m.wavesResolved]!
      const poweredDefense = order === 'DEFEND' ? metrics.defenseAllocationKw / 6 : 0
      const hit = order === 'ACCELERATE' ? wave.hit - 9 : wave.hit - (wave.hit - (5 + m.wavesResolved * 2)) * poweredDefense
      const oreLost = Math.min(outpost.lunarOre, wave.storageLoss * (order === 'DEFEND' ? 1 - poweredDefense : order === 'PRESERVE' ? 1 : .5))
      outpost = { ...outpost, lunarOre: outpost.lunarOre - oreLost }
      updated = { ...updated, health: Math.max(0, m.health - resolveDefenseDamage(hit, m.defenseShots?.[m.wavesResolved])), oreLost: m.oreLost + oreLost,
        wavesResolved: m.wavesResolved + 1, phaseElapsedMs: 0, status: 'command' }
      if (updated.wavesResolved === 3) {
        updated = updated.health < 40 ? { ...updated, status: 'damaged', productionPenalty: .3, energyLoss: .15 } :
          updated.workMs >= MONUMENTS[m.kind].laborMs - 1e-7 ? complete(updated, cursor) : { ...updated, status: 'activating' }
      }
    }
    outpost = { ...outpost, monument: updated }
  }
  return advanceOutpostOperations(outpost, nowMs, damage, commandOrder)
}
