import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { deserializePrototypeSave, serializePrototypeSave } from '../persistence/outpostSave.ts'
import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { PLATFORM_ORE_COST, SIEGE_ALERT_MS, SIEGE_WAVE_TIMES, parseOrbitalSiege, type SiegeOrder } from '../domain/orbitalSiege.ts'
import { createInitialOutpost, constructExtractor, advanceOutpost, outpostReducer } from './outpostSimulation.ts'
import { calculateOutpostOperations } from './outpostOperations.ts'
import { advanceOrbitalSiege, canStartOrbitalSiege, issueSiegeOrder, startOrbitalSiege } from './orbitalSiegeSimulation.ts'
import { deserializeOutpostSave, serializeOutpostSave, resetPrototypeSave, OUTPOST_STORAGE_KEY } from '../persistence/outpostSave.ts'

const START = 100_000
function ready() {
  const initial = createInitialOutpost(createLandingSite(createLunarLocation(.248, -.684, 18)), START - 3000)
  const built = constructExtractor({ ...initial, stage: 'miner-deployed', lunarOre: 200,
    robot: { ...initial.robot, state: 'idle' } }, initial.deposits[0]!.id, START - 3000)
  return advanceOutpost(built, START)
}
function commanded(order: SiegeOrder) {
  return issueSiegeOrder(advanceOrbitalSiege(startOrbitalSiege(ready(), START), START + SIEGE_ALERT_MS), order)
}
function outcome(order: SiegeOrder) {
  return advanceOrbitalSiege(commanded(order), START + SIEGE_WAVE_TIMES[2])
}

describe('Orbital Siege', () => {
  it('uses the existing ore threshold, active extractor, idle labor and generated energy', () => {
    const initial = ready()
    expect(canStartOrbitalSiege(initial)).toBe(true)
    expect(canStartOrbitalSiege({ ...initial, lunarOre: PLATFORM_ORE_COST - .1 })).toBe(false)
    expect(canStartOrbitalSiege({ ...initial, extractor: null })).toBe(false)
    expect(canStartOrbitalSiege({ ...initial, robot: { ...initial.robot, state: 'mining' } })).toBe(false)
    expect(canStartOrbitalSiege({ ...initial, site: createLandingSite(createLunarLocation(-1, 2, 18)) })).toBe(false)
    const started = startOrbitalSiege(initial, START)
    expect(started.lunarOre).toBe(initial.lunarOre - PLATFORM_ORE_COST)
    expect(startOrbitalSiege(started, START + 1)).toBe(started)
  })

  it('reserves robot labor and energy, reduces mining and available defense', () => {
    const initial = ready()
    const before = calculateOutpostOperations(initial)
    const during = calculateOutpostOperations(startOrbitalSiege(initial, START))
    expect(during.platformAllocationKw).toBe(6)
    expect(during.constructionRobots).toBe(2)
    expect(during.activeRobots).toBe(1)
    expect(during.productionPerMin).toBeLessThan(before.productionPerMin)
    expect(during.availableDefense).toBeLessThan(before.availableDefense)
    const conserving = { ...initial, operations: { ...initial.operations, mode: 'CONSERVE' as const } }
    expect(calculateOutpostOperations(startOrbitalSiege(conserving, START)).productionPerMin)
      .toBeLessThan(calculateOutpostOperations(conserving).productionPerMin)
    for (const order of ['DEFEND', 'MINE', 'HARDEN'] as const) {
      const metrics = calculateOutpostOperations(commanded(order))
      expect(metrics.activeRobots + metrics.constructionRobots + metrics.defenseRobots).toBe(3)
      expect(metrics.energyConsumedKw).toBeLessThanOrEqual(metrics.energyGeneratedKw)
    }
    const defense = calculateOutpostOperations(commanded('DEFEND'))
    const mining = calculateOutpostOperations(commanded('MINE'))
    expect(defense.defenseAllocationKw).toBe(6)
    expect(defense.productionPerMin).toBe(0)
    expect(mining.defenseAllocationKw).toBe(0)
    expect(mining.productionPerMin).toBeGreaterThan(defense.productionPerMin)
  })

  it.each([
    ['DEFEND', 'operational', 85, 0],
    ['HARDEN', 'operational', 94, 24],
    ['MINE', 'damaged', 16, 36],
  ] as const)('%s resolves exactly three waves with authored consequences', (order, status, hull, damage) => {
    const resolved = outcome(order)
    expect(resolved.orbitalSiege).toMatchObject({ status, platformHealth: hull, outpostDamage: damage, wavesResolved: 3, progress: 1 })
    expect(advanceOrbitalSiege(resolved, START + 200_000).orbitalSiege).toEqual(resolved.orbitalSiege)
    expect(issueSiegeOrder(resolved, 'DEFEND')).toBe(resolved)
  })

  it('lets Counterstrike own allocation while the surface siege is paused', () => {
    const outpost = commanded('MINE')
    const metrics = calculateOutpostOperations(outpost, 'INTACT', 'PRIORITIZE_INTERCEPTOR', true)
    expect(metrics.activeRobots).toBe(1)
    expect(metrics.defenseAllocationKw).toBe(6)
    expect(metrics.platformAllocationKw).toBe(0)
    expect(metrics.constructionRobots).toBe(0)
    expect(metrics.interceptionReadiness).toBe('MAXIMUM')
    expect(outpost.orbitalSiege?.order).toBe('MINE')
  })

  it('unpowered defenses cannot grant a free victory', () => {
    const started = startOrbitalSiege(ready(), START)
    const lowPower = { ...started, site: createLandingSite(createLunarLocation(.248, .8, 18)) }
    const command = issueSiegeOrder(advanceOrbitalSiege(lowPower, START + 6000), 'DEFEND')
    const metrics = calculateOutpostOperations(command)
    expect(metrics.defenseAllocationKw).toBeLessThan(metrics.defenseDemandKw)
    expect(metrics.status).toBe('LOW ENERGY')
    const result = advanceOrbitalSiege(command, START + 34000)
    expect(result.orbitalSiege?.platformHealth).toBeLessThan(85)
    expect(result.orbitalSiege?.outpostDamage).toBeGreaterThan(0)
  })

  it('defaults to hardening once; tick size cannot change waves, damage or earned ore', () => {
    const begun = startOrbitalSiege(ready(), START)
    const large = advanceOrbitalSiege(begun, START + 40_000)
    let small = begun
    for (let elapsed = 100; elapsed <= 40_000; elapsed += 100) small = advanceOrbitalSiege(small, START + elapsed)
    expect(small.orbitalSiege).toEqual(large.orbitalSiege)
    expect(small.lunarOre).toBeCloseTo(large.lunarOre, 8)
    expect(large.orbitalSiege?.order).toBe('HARDEN')
  })

  it('success supplies persistent logistics; failure loses actual ore, power and production', () => {
    const success = outcome('DEFEND')
    const normal = calculateOutpostOperations({ ...success, orbitalSiege: null })
    expect(calculateOutpostOperations(success).productionPerMin).toBeCloseTo(normal.productionPerMin * 1.2)
    const preHit = advanceOrbitalSiege(commanded('MINE'), START + SIEGE_WAVE_TIMES[2] - 1)
    const failure = advanceOrbitalSiege(preHit, START + SIEGE_WAVE_TIMES[2])
    expect(failure.lunarOre).toBeCloseTo(preHit.lunarOre - 30, 3)
    const metrics = calculateOutpostOperations(failure)
    expect(metrics.damageMultiplier).toBe(.64)
    expect(metrics.energyGeneratedKw).toBeCloseTo(normal.energyGeneratedKw * .75)
    for (const saved of [success, failure, commanded('MINE')]) {
      const restored = deserializeOutpostSave(serializeOutpostSave(saved, START + 40_000), START + 999_000)!
      expect(restored.orbitalSiege).toEqual(saved.orbitalSiege)
      const next = advanceOrbitalSiege(restored, START + 999_000)
      expect(next.orbitalSiege).toEqual(restored.orbitalSiege)
    }
  })

  it('paid repair restores siege damage, keeps lost ore lost and preserves Counterstrike damage', () => {
    const failed = outcome('MINE')
    const repairing = startOrbitalSiege(failed, START + 40_000, true)
    expect(repairing.lunarOre).toBe(failed.lunarOre - 20)
    const partial = advanceOrbitalSiege(repairing, START + 47_500, 'DAMAGED')
    expect(partial.orbitalSiege?.progress).toBe(.5)
    const restored = deserializeOutpostSave(serializeOutpostSave(partial, START + 47_500), START + 100_000)!
    const repaired = advanceOrbitalSiege(restored, START + 107_500, 'DAMAGED')
    expect(repaired.orbitalSiege).toMatchObject({ status: 'operational', platformHealth: 100, outpostDamage: 0, energyLoss: 0, oreLost: 30 })
    expect(calculateOutpostOperations(repaired, 'DAMAGED').damageMultiplier).toBe(.7)
    expect(repaired.lunarOre).toBeLessThan(failed.lunarOre)
  })

  it('replays for the same cost, resets the fixed sequence and reset removes the save', () => {
    const resolved = outcome('DEFEND')
    const replay = startOrbitalSiege(resolved, START + 40_000)
    expect(replay.lunarOre).toBe(resolved.lunarOre - 60)
    expect(replay.orbitalSiege).toMatchObject({ attempts: 2, status: 'constructing', wavesResolved: 0, order: null })
    const replayCommand = issueSiegeOrder(advanceOrbitalSiege(replay, START + 46_000), 'DEFEND')
    expect(advanceOrbitalSiege(replayCommand, START + 74_000).orbitalSiege?.platformHealth).toBe(85)
    expect(outpostReducer(replay, { type: 'reset' })).toBeNull()
    const values = new Map([[OUTPOST_STORAGE_KEY, serializeOutpostSave(replay)]])
    expect(resetPrototypeSave({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } })).toBe(true)
    expect(values.size).toBe(0)
    expect(ready().orbitalSiege).toBeNull()
  })

  it('keeps accepted First Strike and Counterstrike facts through siege failure', () => {
    const prototype = deserializePrototypeSave(createAcceptedCounterstrikeSave('FAILURE', START), START)!
    const failed = { ...prototype, outpost: outcome('MINE') }
    const restored = deserializePrototypeSave(serializePrototypeSave(failed, START + 40000), START + 50000)!
    expect(restored.firstStrike).toEqual({ ...prototype.firstStrike, updatedAtMs: START + 50000 })
    expect(restored.counterstrike).toEqual(prototype.counterstrike)
  })

  it('pauses the command countdown across surface resume', () => {
    const command = advanceOrbitalSiege(startOrbitalSiege(ready(), START), START + 6500)
    const resumed = outpostReducer(command, { type: 'resumeSurface', nowMs: START + 100000 })!
    const next = outpostReducer(resumed, { type: 'operationsTick', nowMs: START + 100100, damageState: 'INTACT', advanceSiege: true })!
    expect(next.orbitalSiege?.elapsedMs).toBe(6600)
    expect(next.orbitalSiege?.status).toBe('command')
  })

  it('migrates v7 saves and rejects malformed siege facts', () => {
    const raw = JSON.parse(serializeOutpostSave(ready(), START))
    raw.schemaVersion = 7
    delete raw.outpost.orbitalSiege
    expect(deserializeOutpostSave(JSON.stringify(raw), START)?.orbitalSiege).toBeNull()
    expect(parseOrbitalSiege({ ...outcome('MINE').orbitalSiege, wavesResolved: 5 })).toBeUndefined()
    expect(parseOrbitalSiege({ ...outcome('MINE').orbitalSiege, status: 'repairing', elapsedMs: 20000 })).toBeUndefined()
    expect(parseOrbitalSiege({ ...outcome('DEFEND').orbitalSiege, progress: -1 })).toBeUndefined()
  })
})
