import { describe, expect, it } from 'vitest'
import { firePlatformDefense, platformDefenseView, type PlatformDefenseShots } from './platformDefensePresentation.ts'
import { SIEGE_ORDERS, SIEGE_WAVE_TIMES, type SiegeOrder } from '../domain/orbitalSiege.ts'
import { createAcceptedCounterstrikeSave } from '../../e2e/firstStrikeFixtures.ts'
import { deserializePrototypeSave, serializePrototypeSave } from '../persistence/outpostSave.ts'
import { advanceOrbitalSiege, startOrbitalSiege, issueSiegeOrder } from '../simulation/orbitalSiegeSimulation.ts'
import { defensePhase } from '../domain/waveDefense.ts'

describe('platform presentation shares defense without another resolver', () => {
  it.each(Object.keys(SIEGE_ORDERS) as SiegeOrder[])('%s keeps all saved costs and outcomes identical with manual hit/miss feedback', order => {
    const p = deserializePrototypeSave(createAcceptedCounterstrikeSave('SUCCESS', 100000), 100000)!
    const start = startOrbitalSiege({ ...p.outpost, lunarOre: 230 }, 100000)
    let state = issueSiegeOrder(advanceOrbitalSiege(start, 106000), order)
    let shots: PlatformDefenseShots | null = null
    for (let wave = 0; wave < 3; wave++) {
      const begins = 100000 + SIEGE_WAVE_TIMES[wave]! - 3600
      state = advanceOrbitalSiege(state, begins - 1)
      expect(platformDefenseView(state.orbitalSiege, shots)).toBeNull()
      state = advanceOrbitalSiege(state, begins + 800)
      const before = serializePrototypeSave({ ...p, outpost: state }, begins + 800)
      const view = platformDefenseView(state.orbitalSiege, shots)!
      expect(view).toMatchObject({ status: 'wave', wavesResolved: wave, phaseElapsedMs: 800 })
      shots = firePlatformDefense(state.orbitalSiege!, shots, wave === 1 ? 2000 : 0)
      expect(defensePhase(3000, shots!.shots[wave])).toBe(wave === 1 ? 'miss' : 'hit')
      expect(firePlatformDefense(state.orbitalSiege!, shots, 0)).toBe(shots)
      expect(serializePrototypeSave({ ...p, outpost: state }, begins + 800)).toBe(before)
      state = advanceOrbitalSiege(state, 100000 + SIEGE_WAVE_TIMES[wave]!)
      expect(state.orbitalSiege?.wavesResolved).toBe(wave + 1)
    }
    const baseline = advanceOrbitalSiege(issueSiegeOrder(advanceOrbitalSiege(start, 106000), order), 134000)
    expect(state.orbitalSiege).toEqual(baseline.orbitalSiege)
    expect(state.lunarOre).toBeCloseTo(baseline.lunarOre, 8)
    expect(platformDefenseView(state.orbitalSiege, shots)).toBeNull()
    const restored = deserializePrototypeSave(serializePrototypeSave({ ...p, outpost: state }, 134000), 900000)!
    expect(restored.outpost.orbitalSiege).toEqual(baseline.orbitalSiege)
  })
})
