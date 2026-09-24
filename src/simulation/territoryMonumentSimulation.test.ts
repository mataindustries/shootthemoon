import { describe, expect, it } from 'vitest'
import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { MONUMENT_KINDS, MONUMENTS, MONUMENT_ORDERS, MONUMENT_WORKER_KW, monumentModifiers, monumentsUnlocked,
  parseTerritoryMonument, type MonumentKind, type MonumentOrder } from '../domain/territoryMonument.ts'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { deserializePrototypeSave, serializePrototypeSave, resetPrototypeSave, OUTPOST_STORAGE_KEY } from '../persistence/outpostSave.ts'
import { canConstructModule, canMineDeposit, createInitialOutpost, outpostReducer } from './outpostSimulation.ts'
import { calculateOutpostOperations } from './outpostOperations.ts'
import { advanceTerritoryMonument, canStartMonument, issueMonumentOrder, startMonument } from './territoryMonumentSimulation.ts'
import { advanceOrbitalSiege, canStartOrbitalSiege, issueSiegeOrder, startOrbitalSiege } from './orbitalSiegeSimulation.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'

const NOW = 100_000
function ready() {
  const prototype = deserializePrototypeSave(createAcceptedCounterstrikeSave('SUCCESS', NOW), NOW)!
  return { ...prototype, outpost: { ...prototype.outpost, lunarOre: 230 } }
}
function begun(kind: MonumentKind = 'HELIOS_SPIRE') {
  const p = ready()
  return startMonument(p.outpost, kind, p.firstStrike, NOW)
}
function step(outpost: OutpostSnapshot, delta: number) {
  return advanceTerritoryMonument(outpost, outpost.operations.lastUpdatedAtMs + delta)
}
function finish(kind: MonumentKind, orders: readonly MonumentOrder[] = ['DEFEND', 'DEFEND', 'DEFEND']) {
  let outpost = step(begun(kind), 4_000)
  for (let wave = 0; wave < 3; wave++) {
    outpost = step(issueMonumentOrder(outpost, orders[wave]!), OCTOGONALS.waves[wave]!.durationMs)
  }
  return step(outpost, 20_000)
}

describe('Territory Monuments', () => {
  it('unlocks at the existing First Strike endpoint or successful Orbital Siege', () => {
    const p = ready()
    expect(monumentsUnlocked(p.outpost, null)).toBe(false)
    expect(monumentsUnlocked(p.outpost, p.firstStrike)).toBe(true)
    const siege = advanceOrbitalSiege(issueSiegeOrder(advanceOrbitalSiege(startOrbitalSiege(p.outpost, NOW), NOW + 6000), 'DEFEND'), NOW + 34000)
    expect(monumentsUnlocked(siege, null)).toBe(true)
    expect(canStartMonument(siege, 'CRATER_CROWN', null)).toBe(true)
    expect(startMonument(siege, 'CRATER_CROWN', null, NOW + 34000).monument?.anchor).toBe('outpost')
  })

  it.each(MONUMENT_KINDS)('%s pays once, finishes finite work and keeps a canonical territory claim', kind => {
    const p = ready()
    const initial = begun(kind)
    expect(initial.lunarOre).toBe(p.outpost.lunarOre - MONUMENTS[kind].ore)
    expect(startMonument(initial, kind, p.firstStrike, NOW + 1)).toBe(initial)
    expect(initial.monument?.anchor).toBe(kind === 'CRATER_CROWN' ? 'impact-scar' : 'outpost')
    const result = finish(kind)
    expect(result.monument).toMatchObject({ kind, status: 'complete', health: 79, wavesResolved: 3, workMs: MONUMENTS[kind].laborMs })
    expect(result.monument!.workMs / 1000 * MONUMENT_WORKER_KW).toBe(MONUMENTS[kind].laborMs / 1000 * 2)
    expect(parseTerritoryMonument(result.monument)).toEqual(result.monument)
    const later = step(result, 60_000)
    expect(later.monument).toEqual(result.monument)
    expect(startMonument(result, kind, p.firstStrike, NOW + 200000)).toBe(result)
  })

  it('gates storage, labor, power and concurrent construction without spending', () => {
    const p = ready()
    const blocked = [
      { ...p.outpost, lunarOre: 79 },
      { ...p.outpost, extractor: null },
      { ...p.outpost, robot: { ...p.outpost.robot, state: 'mining' as const } },
      { ...p.outpost, site: createLandingSite(createLunarLocation(-1, 2, 18)) },
      startOrbitalSiege(p.outpost, NOW),
    ]
    for (const outpost of blocked) expect(startMonument(outpost, 'HELIOS_SPIRE', p.firstStrike, NOW)).toBe(outpost)
    const active = begun()
    expect(canStartOrbitalSiege(active)).toBe(false)
    expect(canConstructModule(active, 'SOLAR_WING', 'INTACT')).toBe(false)
    expect(canMineDeposit(active, active.deposits[1]!.id)).toBe(false)
    expect(outpostReducer(active, { type: 'setOperatingMode', nowMs: NOW, mode: 'OVERDRIVE', damageState: 'INTACT' })).toBe(active)
  })

  it.each(Object.keys(MONUMENT_ORDERS) as MonumentOrder[])('%s shares exactly three robots and generated energy', order => {
    const active = issueMonumentOrder(step(begun(), 4000), order)
    const metrics = calculateOutpostOperations(active)
    const choice = MONUMENT_ORDERS[order]
    expect(metrics.activeRobots).toBe(choice.miners)
    expect(metrics.constructionRobots).toBe(choice.builders)
    expect(metrics.defenseRobots).toBe(choice.defenders)
    expect(metrics.activeRobots + metrics.constructionRobots + metrics.defenseRobots).toBe(3)
    expect(metrics.monumentAllocationKw).toBe(choice.builders * 2)
    expect(metrics.energyConsumedKw).toBeLessThanOrEqual(metrics.energyGeneratedKw)
    expect(metrics.miningAllocationKw + metrics.defenseAllocationKw + metrics.monumentAllocationKw + 2).toBeLessThanOrEqual(metrics.energyGeneratedKw)
    expect(step(active, 1000).monument!.workMs - active.monument!.workMs).toBe(choice.builders * 1000)
    const full = calculateOutpostOperations({ ...active, lunarOre: active.operations.storageCapacity })
    expect(full.activeRobots).toBe(0)
    expect(full.constructionRobots).toBe(choice.builders)
  })

  it('gives Counterstrike command allocation priority without advancing a monument', () => {
    const active = issueMonumentOrder(step(begun(), 4000), 'ACCELERATE')
    const metrics = calculateOutpostOperations(active, 'INTACT', 'PRIORITIZE_INTERCEPTOR', true)
    expect(metrics.monumentAllocationKw).toBe(0)
    expect(metrics.constructionRobots).toBe(0)
    expect(metrics.activeRobots).toBe(1)
    expect(metrics.defenseAllocationKw).toBe(6)
    expect(advanceTerritoryMonument(active, NOW + 8000, 'INTACT', 'PRIORITIZE_INTERCEPTOR', true).monument).toEqual(active.monument)
  })

  it('each wave waits for one saved decision, cannot double issue, and never becomes endless', () => {
    let outpost = step(begun(), 4000)
    for (let i = 0; i < 3; i++) {
      expect(outpost.monument).toMatchObject({ status: 'command', wavesResolved: i, phaseElapsedMs: 0 })
      const wait = step(outpost, 100_000)
      expect(wait.monument).toEqual(outpost.monument)
      const order = issueMonumentOrder(wait, 'DEFEND')
      expect(issueMonumentOrder(order, 'PRESERVE')).toBe(order)
      outpost = step(order, OCTOGONALS.waves[i]!.durationMs)
      expect(outpost.monument?.wavesResolved).toBe(i + 1)
    }
    outpost = step(outpost, 20_000)
    expect(outpost.monument?.status).toBe('complete')
    expect(step(outpost, 1_000_000).monument).toEqual(outpost.monument)
  })

  it('tick size cannot change paid labor, energy, waves, ore, or completion', () => {
    let large = step(begun('BASTION_OBELISK'), 4000)
    let small = large
    for (let i = 0; i < 3; i++) {
      large = issueMonumentOrder(large, 'DEFEND')
      small = issueMonumentOrder(small, 'DEFEND')
      large = step(large, OCTOGONALS.waves[i]!.durationMs)
      for (let elapsed = 0; elapsed < OCTOGONALS.waves[i]!.durationMs; elapsed += 100) small = step(small, 100)
      expect(small.monument).toEqual(large.monument)
      expect(small.lunarOre).toBeCloseTo(large.lunarOre, 8)
    }
    large = step(large, 20_000)
    for (let i = 0; i < 200; i++) small = step(small, 100)
    expect(small.monument).toEqual(large.monument)
    expect(small.lunarOre).toBeCloseTo(large.lunarOre, 8)
  })

  it('unpowered labor stalls and underpowered defense cannot grant a free victory', () => {
    const command = issueMonumentOrder(step(begun(), 4000), 'DEFEND')
    const dark = { ...command, site: createLandingSite(createLunarLocation(-1, 2, 18)) }
    const next = step(dark, 6000)
    expect(next.monument?.workMs).toBe(dark.monument?.workMs)
    expect(next.monument?.health).toBe(72)
    expect(calculateOutpostOperations(dark).monumentAllocationKw).toBe(0)
  })

  it('preservation and acceleration have distinct, finite failure outcomes', () => {
    for (const order of ['PRESERVE', 'ACCELERATE'] as const) {
      const result = finish('HELIOS_SPIRE', [order, order, order])
      expect(result.monument).toMatchObject({ status: 'damaged', wavesResolved: 3, productionPenalty: .3, energyLoss: .15, completedAtMs: null })
      expect(result.monument?.health).toBe(order === 'PRESERVE' ? 0 : 25)
      expect(result.monument?.oreLost).toBe(order === 'PRESERVE' ? 18 : 9)
      const normal = calculateOutpostOperations({ ...result, monument: null })
      const damaged = calculateOutpostOperations(result)
      expect(damaged.energyGeneratedKw).toBeCloseTo(normal.energyGeneratedKw * .85)
      expect(damaged.productionPerMin).toBeLessThanOrEqual(normal.productionPerMin * .7)
      expect(step(result, 1_000_000).monument).toEqual(result.monument)
      expect(parseTerritoryMonument(result.monument)).toEqual(result.monument)
    }
    expect(finish('HELIOS_SPIRE', ['DEFEND', 'PRESERVE', 'ACCELERATE']).monument?.status).toBe('damaged')
    expect(finish('HELIOS_SPIRE', ['DEFEND', 'ACCELERATE', 'DEFEND']).monument?.status).toBe('complete')
  })

  it.each(MONUMENT_KINDS)('%s activates its actual production, energy, logistics or defense modifier', kind => {
    const result = finish(kind)
    const normal = calculateOutpostOperations({ ...result, monument: null })
    const metrics = calculateOutpostOperations(result)
    if (kind === 'HELIOS_SPIRE') expect(metrics.energyGeneratedKw).toBeCloseTo(normal.energyGeneratedKw * 1.25)
    if (kind === 'CRATER_CROWN') expect(metrics.productionPerMin).toBeCloseTo(normal.productionPerMin * 1.2)
    if (kind === 'SIGNAL_ARRAY') {
      expect(metrics.productionPerMin).toBeGreaterThan(normal.productionPerMin)
      expect(monumentModifiers(result.monument)).toMatchObject({ detection: 1.5, logisticsLoss: .5 })
    }
    if (kind === 'BASTION_OBELISK') {
      expect(calculateOutpostOperations(result, 'DAMAGED').damageMultiplier).toBeCloseTo(.85)
      const siege = startOrbitalSiege(result, result.operations.lastUpdatedAtMs)
      const command = issueSiegeOrder(advanceOrbitalSiege(siege, siege.operations.lastUpdatedAtMs + 6000), 'DEFEND')
      const defended = advanceOrbitalSiege(command, siege.operations.lastUpdatedAtMs + 34000)
      expect(defended.orbitalSiege?.platformHealth).toBe(88)
      const repairing = startOrbitalSiege({ ...defended, orbitalSiege: { ...defended.orbitalSiege!, outpostDamage: 10 } }, defended.operations.lastUpdatedAtMs, true)
      expect(advanceOrbitalSiege(repairing, repairing.operations.lastUpdatedAtMs + 10_000).orbitalSiege?.status).toBe('operational')
    }
    expect(monumentModifiers(begun(kind).monument).energy).toBe(1)
  })

  it('keeps the persisted BASTION_OBELISK id while presenting the Bastion Ziggurat', () => {
    const p = ready()
    const result = finish('BASTION_OBELISK')
    const raw = serializePrototypeSave({ ...p, outpost: result }, result.operations.lastUpdatedAtMs)
    expect(JSON.parse(raw).outpost.monument.kind).toBe('BASTION_OBELISK')
    const kind = deserializePrototypeSave(raw, result.operations.lastUpdatedAtMs)!.outpost.monument!.kind
    expect(kind).toBe('BASTION_OBELISK')
    expect(MONUMENTS[kind].title).toBe('BASTION ZIGGURAT')
    // The copy must track the live modifiers: −25% damage, +50% repair, half production damage.
    expect(monumentModifiers(result.monument)).toMatchObject({ damage: .75, repairSpeed: 1.5, damagePenalty: .5 })
    expect(MONUMENTS[kind].benefit).toBe('Every step a wall. −25% siege damage · +50% repair · half production damage.')
  })

  it('repair pays once, resumes from refresh, ends with a claim and retains earlier outcomes and losses', () => {
    const p = ready()
    const failed = finish('CRATER_CROWN', ['PRESERVE', 'PRESERVE', 'PRESERVE'])
    const repairing = startMonument(failed, 'CRATER_CROWN', p.firstStrike, failed.operations.lastUpdatedAtMs, true)
    expect(repairing.lunarOre).toBe(failed.lunarOre - 20)
    expect(startMonument(repairing, 'CRATER_CROWN', p.firstStrike, NOW, true)).toBe(repairing)
    const partial = step(repairing, 7500)
    expect(partial.monument?.repairWorkMs).toBe(15000)
    const restore = deserializePrototypeSave(serializePrototypeSave({ ...p, outpost: partial }, partial.operations.lastUpdatedAtMs), NOW + 900000)!
    expect(restore.outpost.monument).toEqual(partial.monument)
    expect(step(restore.outpost, 0).monument).toEqual(partial.monument)
    const repaired = advanceTerritoryMonument(restore.outpost, NOW + 907500, 'DAMAGED')
    expect(repaired.monument).toMatchObject({ status: 'complete', health: 100, productionPenalty: 0, energyLoss: 0, oreLost: 18, wavesResolved: 3 })
    expect(calculateOutpostOperations(repaired, 'DAMAGED').damageMultiplier).toBeCloseTo(.7)
    expect(restore.counterstrike).toEqual(p.counterstrike)
    expect(restore.firstStrike.scar).toEqual(p.firstStrike.scar)
    expect(restore.rival).toMatchObject({ scanResponseCompleted: p.rival.scanResponseCompleted })
  })

  it('refresh at every phase preserves costs, orders, damage and the finite clock', () => {
    const p = ready()
    const initial = begun()
    const command = step(initial, 4000)
    const wave = step(issueMonumentOrder(command, 'DEFEND'), 3000)
    for (const outpost of [initial, command, wave, finish('HELIOS_SPIRE'), finish('HELIOS_SPIRE', ['PRESERVE', 'PRESERVE', 'PRESERVE'])]) {
      const restored = deserializePrototypeSave(serializePrototypeSave({ ...p, outpost }, outpost.operations.lastUpdatedAtMs), NOW + 2000000)!
      expect(restored.outpost.monument).toEqual(outpost.monument)
      expect(restored.outpost.lunarOre).toBe(outpost.lunarOre)
      expect(step(restored.outpost, 0).monument).toEqual(outpost.monument)
    }
    const resumed = outpostReducer(wave, { type: 'resumeSurface', nowMs: NOW + 999000 })!
    expect(step(resumed, 100).monument?.phaseElapsedMs).toBe(3100)
  })

  it('a low-solar territory can repair after the failure energy penalty, with throttled labor', () => {
    const p = ready()
    const weakSite = { ...p.outpost, site: createLandingSite(createLunarLocation(.248, .65, 18)) }
    expect(canStartMonument(weakSite, 'HELIOS_SPIRE', p.firstStrike)).toBe(true)
    let outpost = step(startMonument(weakSite, 'HELIOS_SPIRE', p.firstStrike, NOW), 4000)
    for (const wave of OCTOGONALS.waves) outpost = step(issueMonumentOrder(outpost, 'PRESERVE'), wave.durationMs)
    expect(outpost.monument?.status).toBe('damaged')
    expect(calculateOutpostOperations(outpost).energyGeneratedKw).toBeLessThan(6)
    expect(canStartMonument(outpost, 'HELIOS_SPIRE', p.firstStrike, true)).toBe(true)
    const repairing = startMonument(outpost, 'HELIOS_SPIRE', p.firstStrike, outpost.operations.lastUpdatedAtMs, true)
    const slow = step(repairing, 15000)
    expect(slow.monument?.status).toBe('repairing')
    expect(step(slow, 15000).monument?.status).toBe('complete')
  })

  it('monument recovery leaves existing Orbital Siege losses and damage intact', () => {
    const p = ready()
    const previous = advanceOrbitalSiege(issueSiegeOrder(advanceOrbitalSiege(startOrbitalSiege(p.outpost, NOW), NOW + 6000), 'MINE'), NOW + 34000)
    let outpost = step(startMonument(previous, 'HELIOS_SPIRE', p.firstStrike, NOW + 34000), 4000)
    for (const wave of OCTOGONALS.waves) outpost = step(issueMonumentOrder(outpost, 'PRESERVE'), wave.durationMs)
    const repaired = step(startMonument(outpost, 'HELIOS_SPIRE', p.firstStrike, outpost.operations.lastUpdatedAtMs, true), 15000)
    expect(repaired.monument?.status).toBe('complete')
    expect(repaired.orbitalSiege).toEqual(previous.orbitalSiege)
    expect(calculateOutpostOperations(repaired).damageMultiplier).toBe(.64)
  })

  it('migrates all previous schemas and rejects impossible new claims and waves', () => {
    const p = ready()
    for (let schemaVersion = 1; schemaVersion <= 8; schemaVersion++) {
      const raw = JSON.parse(serializePrototypeSave(p, NOW))
      raw.schemaVersion = schemaVersion
      delete raw.outpost.monument
      expect(deserializePrototypeSave(JSON.stringify(raw), NOW)?.outpost.monument).toBeNull()
    }
    const m = finish('HELIOS_SPIRE').monument!
    for (const invalid of [{ ...m, wavesResolved: 4 }, { ...m, orders: [null, null, null] },
      { ...m, workMs: -1 }, { ...m, completedAtMs: null }, { ...m, health: 0 },
      { ...m, status: 'command' }, { ...m, phaseElapsedMs: Infinity }]) expect(parseTerritoryMonument(invalid)).toBeUndefined()
  })

  it('reveal replay is presentation only, and reset recovers a fresh campaign', () => {
    const p = ready()
    const complete = finish('SIGNAL_ARRAY')
    const seen = outpostReducer(complete, { type: 'monumentRevealSeen' })!
    expect(seen.monument?.revealSeen).toBe(true)
    expect(seen.lunarOre).toBe(complete.lunarOre)
    expect(outpostReducer(seen, { type: 'monumentRevealSeen' })).toBe(seen)
    const restored = deserializePrototypeSave(serializePrototypeSave({ ...p, outpost: seen }), NOW + 500000)!
    expect(restored.outpost.monument).toEqual(seen.monument)
    expect(outpostReducer(restored.outpost, { type: 'reset' })).toBeNull()
    const values = new Map([[OUTPOST_STORAGE_KEY, 'save']])
    resetPrototypeSave({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } })
    expect(values.size).toBe(0)
    const fresh = createInitialOutpost(p.outpost.site, NOW + 900000)
    expect(fresh.monument).toBeNull()
    expect(monumentsUnlocked(fresh, null)).toBe(false)
  })
})
