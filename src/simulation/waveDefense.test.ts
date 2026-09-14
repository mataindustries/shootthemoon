import { describe, expect, it } from 'vitest'
import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { DEFENSE_FIRE_END_MS, DEFENSE_HULL_SAVED, DEFENSE_WINDOW_MS, defensePhase, resolveDefenseDamage } from '../domain/waveDefense.ts'
import { MONUMENT_KINDS, MONUMENT_ORDERS, parseTerritoryMonument, type MonumentOrder } from '../domain/territoryMonument.ts'
import { deserializePrototypeSave, serializePrototypeSave } from '../persistence/outpostSave.ts'
import { advanceTerritoryMonument, fireMonumentDefense, issueMonumentOrder, startMonument } from './territoryMonumentSimulation.ts'
import { outpostReducer } from './outpostSimulation.ts'
import { calculateOutpostOperations } from './outpostOperations.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'

const NOW = 100_000
const prototype = () => deserializePrototypeSave(createAcceptedCounterstrikeSave('SUCCESS', NOW), NOW)!
function ready(order: MonumentOrder = 'DEFEND') {
  const p = prototype()
  return issueMonumentOrder(advanceTerritoryMonument(startMonument({ ...p.outpost, lunarOre: 230 }, 'HELIOS_SPIRE', p.firstStrike, NOW), NOW + 4000), order)
}
const step = (outpost: OutpostSnapshot, delta: number) => advanceTerritoryMonument(outpost, outpost.operations.lastUpdatedAtMs + delta)

describe('one-thumb wave defense', () => {
  it.each([0, 100, 500, 1800, DEFENSE_FIRE_END_MS])('a shot at %i ms saves four hull, including queued early taps', ms => {
    const baseline = step(ready(), ms)
    const shot = fireMonumentDefense(baseline, 0)
    expect(shot.monument?.defenseShots).toEqual([ms, null, null])
    expect(step(shot, 6000 - ms).monument?.health).toBe(step(baseline, 6000 - ms).monument!.health + DEFENSE_HULL_SAVED)
    expect(defensePhase(ms, ms)).toBe(ms < 500 ? 'queued' : 'hit')
  })

  it.each([DEFENSE_FIRE_END_MS + 1, 3000, DEFENSE_WINDOW_MS])('a late shot at %i ms preserves the exact baseline outcome', ms => {
    const baseline = step(ready('PRESERVE'), ms)
    const shot = fireMonumentDefense(baseline, 0)
    const result = step(shot, 6000 - ms)
    expect(result).toEqual({ ...step(baseline, 6000 - ms), monument: {
      ...step(baseline, 6000 - ms).monument!, defenseShots: [ms, null, null],
    } })
    expect(defensePhase(ms, ms)).toBe('miss')
  })

  it('no action retains baseline damage; hull mitigation is clamped and never heals', () => {
    expect(step(ready(), 6000).monument?.health).toBe(95)
    expect(resolveDefenseDamage(2, 600)).toBe(0)
    expect(resolveDefenseDamage(28.4, null)).toBe(28)
    expect(resolveDefenseDamage(28.4, undefined)).toBe(28)
    for (const invalid of [-1, NaN, Infinity]) expect(resolveDefenseDamage(28, invalid)).toBe(28)
  })

  it.each(Object.keys(MONUMENT_ORDERS) as MonumentOrder[])('%s hit leaves storage, production, energy, labor and allocation unchanged', order => {
    const baseline = step(ready(order), 700)
    const shot = fireMonumentDefense(baseline, 0)
    expect(calculateOutpostOperations(shot)).toEqual(calculateOutpostOperations(baseline))
    const result = step(shot, 5300), missed = step(baseline, 5300)
    expect(result).toEqual({ ...missed, monument: { ...missed.monument!,
      health: missed.monument!.health + 4, defenseShots: [700, null, null],
    } })
  })

  it('rejects double fire, stale wave events, shots outside a wave and expired windows', () => {
    const wave = step(ready(), 700)
    const shot = fireMonumentDefense(wave, 0)
    expect(fireMonumentDefense(shot, 0)).toBe(shot)
    expect(fireMonumentDefense(wave, 1)).toBe(wave)
    const expired = step(wave, 3000)
    expect(fireMonumentDefense(expired, 0)).toBe(expired)
    const command = step(wave, 5300)
    expect(fireMonumentDefense(command, 1)).toBe(command)
    const next = issueMonumentOrder(command, 'DEFEND')
    expect(outpostReducer(next, { type: 'fireMonumentDefense', wave: 0, nowMs: next.operations.lastUpdatedAtMs + 100, damageState: 'INTACT' })).toBe(next)
    // The reducer evaluates the event's real clock, not the preceding 80 ms render tick.
    const late = outpostReducer(ready(), { type: 'fireMonumentDefense', wave: 0, nowMs: NOW + 4000 + 2601, damageState: 'INTACT' })!
    expect(late.monument?.defenseShots?.[0]).toBe(2601)
    expect(step(late, 3399).monument?.health).toBe(95)
  })

  it.each(MONUMENT_KINDS)('%s keeps finite three-wave progression with deterministic hit/miss/hit resolution', kind => {
    const p = prototype()
    let large = step(startMonument({ ...p.outpost, lunarOre: 230 }, kind, p.firstStrike, NOW), 4000)
    let small = large
    for (let wave = 0; wave < 3; wave++) {
      large = step(issueMonumentOrder(large, 'DEFEND'), 800)
      small = step(issueMonumentOrder(small, 'DEFEND'), 800)
      if (wave !== 1) {
        large = fireMonumentDefense(large, wave)
        small = fireMonumentDefense(small, wave)
      }
      const remaining = OCTOGONALS.waves[wave]!.durationMs - 800
      large = step(large, remaining)
      for (let t = 0; t < remaining; t += 100) small = step(small, 100)
      expect(small.monument).toEqual(large.monument)
      expect(small.lunarOre).toBeCloseTo(large.lunarOre, 8)
    }
    const done = step(large, 20000)
    expect(done.monument).toMatchObject({ health: 87, wavesResolved: 3, status: 'complete', defenseShots: [800, null, 800] })
    expect(step(done, 90000).monument).toEqual(done.monument)
  })

  it('reload preserves queued shots, hits and misses without another attempt or offline combat', () => {
    for (const ms of [100, 800, 3000]) {
      const shot = fireMonumentDefense(step(ready(), ms), 0)
      const p = { ...prototype(), outpost: shot }
      const restored = deserializePrototypeSave(serializePrototypeSave(p, shot.operations.lastUpdatedAtMs), NOW + 900000)!
      expect(restored.outpost.monument).toEqual(shot.monument)
      expect(restored.counterstrike).toEqual(p.counterstrike)
      expect(restored.firstStrike).toEqual({ ...p.firstStrike, updatedAtMs: NOW + 900000 })
      expect(fireMonumentDefense(restored.outpost, 0)).toBe(restored.outpost)
      expect(step(restored.outpost, 6000 - ms).monument).toEqual(step(shot, 6000 - ms).monument)
    }
  })

  it('old saves keep their baseline, while malformed or future shot records are rejected', () => {
    const old = { ...ready().monument! }
    delete old.defenseShots
    expect(parseTerritoryMonument(old)).toEqual(old)
    for (const defenseShots of [[-1, null, null], [NaN, null, null], [Infinity, null, null],
      [1, null, null], [null, 0, null], [null], 'hit']) {
      expect(parseTerritoryMonument({ ...old, defenseShots })).toBeUndefined()
    }
  })
})
