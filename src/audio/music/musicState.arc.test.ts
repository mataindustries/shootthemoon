import { describe, expect, it } from 'vitest'
import { createAcceptedCounterstrikeSave, createCompletedStrikeSave, createStrikeReadySave } from '../../../e2e/firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from '../../../e2e/rivalFixtures.ts'
import { createFirstStrikePresentation } from '../../app/firstStrikePresentation.ts'
import { createRivalPresentation } from '../../app/rivalPresentation.ts'
import { OCTOGONALS } from '../../content/octogonals.ts'
import { createLandingSite, createLunarLocation } from '../../domain/lunarCoordinates.ts'
import type { OutpostSnapshot } from '../../domain/outpost.ts'
import { deserializePrototypeSave, type PrototypeSnapshot } from '../../persistence/outpostSave.ts'
import {
  counterstrikeFactsReducer,
  counterstrikeRunReducer,
  createCounterstrikeRunState,
} from '../../simulation/counterstrikeSimulation.ts'
import { advanceOrbitalSiege, issueSiegeOrder, startOrbitalSiege } from '../../simulation/orbitalSiegeSimulation.ts'
import { createInitialOutpost } from '../../simulation/outpostSimulation.ts'
import { advanceTerritoryMonument, issueMonumentOrder, startMonument } from '../../simulation/territoryMonumentSimulation.ts'
import { buildMusicSnapshot, type MusicSnapshotSource } from './buildMusicSnapshot.ts'
import { deriveArc, deriveCue, deriveMusicTarget } from './musicState.ts'

const NOW = 100_000

function restore(save: string): PrototypeSnapshot {
  const prototype = deserializePrototypeSave(save, NOW)
  if (prototype === null) throw new Error('fixture did not deserialize')
  return prototype
}

function snapshotOf(prototype: Partial<PrototypeSnapshot> | null, overrides: Partial<MusicSnapshotSource> = {}) {
  return buildMusicSnapshot({
    entryOpen: false,
    phase: 'orbit',
    monumentView: false,
    outpost: prototype?.outpost ?? null,
    rival: prototype?.rival ?? null,
    rivalPresentation: createRivalPresentation('idle', 0),
    firstStrike: prototype?.firstStrike ?? null,
    firstStrikePresentation: createFirstStrikePresentation('idle', 0),
    strikeConfirmationOpen: false,
    counterstrike: prototype?.counterstrike ?? null,
    counterstrikeRun: createCounterstrikeRunState(prototype?.counterstrike ?? null, 0),
    platformDefense: null,
    monumentRevealAtMs: null,
    ...overrides,
  })
}

function step(outpost: OutpostSnapshot, delta: number): OutpostSnapshot {
  return advanceTerritoryMonument(outpost, outpost.operations.lastUpdatedAtMs + delta)
}

/** Builds a monument through the real simulation: foundation, three waves, labor. */
function claim(prototype: PrototypeSnapshot): PrototypeSnapshot {
  let outpost = step(startMonument({ ...prototype.outpost, lunarOre: 230 }, 'HELIOS_SPIRE', prototype.firstStrike, NOW), 4_000)
  for (let wave = 0; wave < 3; wave += 1) {
    outpost = step(issueMonumentOrder(outpost, 'DEFEND'), OCTOGONALS.waves[wave]!.durationMs)
  }
  outpost = step(outpost, 60_000)
  expect(outpost.monument?.status).toBe('complete')
  return { ...prototype, outpost }
}

describe('music arc from reducer-built fixtures', () => {
  it('RECON before any outpost', () => {
    const s = snapshotOf(null)
    expect(deriveArc(s)).toBe('RECON')
    expect(deriveCue(s)).toBe('RECON')
  })

  it('FOOTHOLD once the outpost is established, FOOTHOLD_WORKS once the extractor runs', () => {
    const outpost = createInitialOutpost(createLandingSite(createLunarLocation(0.248, -0.684, 18)), NOW)
    expect(deriveArc(snapshotOf({ outpost }))).toBe('FOOTHOLD')
    expect(deriveCue(snapshotOf({ outpost }, { phase: 'landed' }))).toBe('FOOTHOLD')
    const works = restore(createLegacyActiveExtractorSave(NOW))
    expect(works.rival.revealStatus).not.toBe('REVEALED')
    expect(deriveArc(snapshotOf(works))).toBe('FOOTHOLD')
    expect(deriveCue(snapshotOf(works, { phase: 'landed' }))).toBe('FOOTHOLD_WORKS')
  })

  it('CONTESTED once Vesper is revealed', () => {
    const ready = restore(createStrikeReadySave(NOW))
    expect(ready.rival.revealStatus).toBe('REVEALED')
    expect(deriveArc(snapshotOf(ready))).toBe('CONTESTED')
    expect(deriveMusicTarget(snapshotOf(ready)).gains).toEqual({ bed: 0, engine: -8, pressure: -10 })
  })

  it('RETALIATION after the First Strike, including the restored TRACK COUNTERSTRIKE prompt', () => {
    const completed = restore(createCompletedStrikeSave(NOW))
    expect(completed.firstStrike.status).toBe('COMPLETE')
    expect(completed.counterstrike.available).toBe(true)
    const prompt = snapshotOf(completed)
    expect(prompt.csStatus).toBe('dormant')
    expect(deriveArc(prompt)).toBe('RETALIATION')
    expect(deriveCue(prompt)).toBe('RETALIATION')
    // Refreshed mid-Counterstrike: the run restores to its command, a tension cue in the same arc.
    const detected = { ...completed, counterstrike: counterstrikeFactsReducer(completed.counterstrike, { type: 'detect', nowMs: NOW })! }
    const run = createCounterstrikeRunState(detected.counterstrike, 0)
    expect(run.status).toBe('command')
    const restoredRun = snapshotOf(detected, { counterstrikeRun: run })
    expect(deriveArc(restoredRun)).toBe('RETALIATION')
    expect(deriveCue(restoredRun)).toBe('CS_ALERT')
  })

  it('ASCENDANT once an outcome is accepted, carrying the unrepaired wound', () => {
    const success = restore(createAcceptedCounterstrikeSave('SUCCESS', NOW))
    expect(deriveArc(snapshotOf(success))).toBe('ASCENDANT')
    expect(deriveMusicTarget(snapshotOf(success, { phase: 'landed' })).gains).toEqual({ bed: 0, engine: -4 })
    const failure = restore(createAcceptedCounterstrikeSave('FAILURE', NOW))
    expect(deriveArc(snapshotOf(failure))).toBe('ASCENDANT')
    expect(deriveMusicTarget(snapshotOf(failure, { phase: 'landed' })).gains).toEqual({ bed: 0, engine: -7, pressure: -14 })
  })

  it('CLAIMED once the monument is complete', () => {
    const claimed = claim(restore(createAcceptedCounterstrikeSave('SUCCESS', NOW)))
    const s = snapshotOf(claimed, { phase: 'landed' })
    expect(deriveArc(s)).toBe('CLAIMED')
    expect(deriveMusicTarget(s).gains).toEqual({ bed: 0, engine: -4, claim: 0 })
  })

  it('CLAIMED while Vesper stands; a later First Strike still plays its set piece', () => {
    const ready = restore(createStrikeReadySave(NOW))
    let outpost = startOrbitalSiege({ ...ready.outpost, lunarOre: 300 }, NOW)
    outpost = issueSiegeOrder(advanceOrbitalSiege(outpost, NOW + 6_000), 'DEFEND')
    outpost = advanceOrbitalSiege(outpost, NOW + 34_000)
    expect(outpost.orbitalSiege?.status).toBe('operational')
    const claimed = claim({ ...ready, outpost: { ...outpost, lunarOre: 230 } })
    expect(claimed.firstStrike.status).toBe('READY')
    expect(claimed.rival.revealStatus).toBe('REVEALED')
    expect(deriveArc(snapshotOf(claimed))).toBe('CLAIMED')
    expect(deriveCue(snapshotOf(claimed, { firstStrikePresentation: createFirstStrikePresentation('launch', 0) }))).toBe('FS_FLIGHT')
  })

  it('a replayed Counterstrike over an accepted outcome stays in ASCENDANT', () => {
    const success = restore(createAcceptedCounterstrikeSave('SUCCESS', NOW))
    const run = counterstrikeRunReducer(createCounterstrikeRunState(success.counterstrike, 0), { type: 'begin', clockMs: 1, replay: true })
    const s = snapshotOf(success, { counterstrikeRun: run })
    expect(deriveArc(s)).toBe('ASCENDANT')
    expect(deriveCue(s)).toBe('CS_ALERT')
  })
})
