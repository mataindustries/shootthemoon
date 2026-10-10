import { describe, expect, it } from 'vitest'
import { createAcceptedCounterstrikeSave } from '../../../e2e/firstStrikeFixtures.ts'
import { createFirstStrikePresentation } from '../../app/firstStrikePresentation.ts'
import { createRivalPresentation } from '../../app/rivalPresentation.ts'
import { deserializePrototypeSave } from '../../persistence/outpostSave.ts'
import { counterstrikeRunReducer, createCounterstrikeRunState } from '../../simulation/counterstrikeSimulation.ts'
import { buildMusicSnapshot } from './buildMusicSnapshot.ts'
import { deriveMusicTarget } from './musicState.ts'
import { monument, siege } from './testing/musicFixtures.ts'

const NOW = 100_000

describe('buildMusicSnapshot', () => {
  it('reads the gate, phase and views; a fresh game has no outpost', () => {
    const fresh = buildMusicSnapshot({
      entryOpen: true,
      phase: 'orbit',
      monumentView: false,
      outpost: null,
      rival: null,
      rivalPresentation: createRivalPresentation('idle', 0),
      firstStrike: null,
      firstStrikePresentation: createFirstStrikePresentation('idle', 0),
      strikeConfirmationOpen: false,
      counterstrike: null,
      counterstrikeRun: createCounterstrikeRunState(null, 0),
      platformDefense: null,
      monumentRevealAtMs: null,
    })
    expect(fresh).toEqual({
      entryOpen: true,
      phase: 'orbit',
      monumentView: false,
      outpost: null,
      rivalRevealStatus: null,
      rivalPhase: 'idle',
      firstStrikeStatus: null,
      strikePhase: 'idle',
      strikePhaseStartedAtMs: 0,
      strikeConfirmationOpen: false,
      acceptedOutcome: null,
      counterstrikeDamaged: false,
      csStatus: 'dormant',
      csPhaseStartedAtMs: 0,
      platformDefenseWave: null,
      monumentRevealAtMs: null,
    })
    expect(deriveMusicTarget(fresh).cue).toBe('SILENT')
  })

  it('maps every field the music reads from restored game state and presentation clocks', () => {
    const prototype = deserializePrototypeSave(createAcceptedCounterstrikeSave('FAILURE', NOW), NOW)!
    const operational = siege('operational', { wavesResolved: 3 })
    const outpost = {
      ...prototype.outpost,
      module: prototype.outpost.module ?? {
        id: 'module-slot-01' as const,
        kind: 'SOLAR_WING' as const,
        status: 'active' as const,
        constructionStartedAtMs: NOW,
        completionTimestampMs: NOW,
        repairProgress: 0,
        lastRepairAtMs: NOW,
      },
      orbitalSiege: operational,
      monument: monument('command'),
    }
    const run = counterstrikeRunReducer(createCounterstrikeRunState(prototype.counterstrike, 0), { type: 'begin', clockMs: 4_321, replay: true })
    const built = buildMusicSnapshot({
      entryOpen: false,
      phase: 'landed',
      monumentView: true,
      outpost,
      rival: prototype.rival,
      rivalPresentation: createRivalPresentation('rival-focused', 1_000),
      firstStrike: prototype.firstStrike,
      firstStrikePresentation: createFirstStrikePresentation('scar-explore', 2_345),
      strikeConfirmationOpen: true,
      counterstrike: prototype.counterstrike,
      counterstrikeRun: run,
      platformDefense: { wavesResolved: 2 },
      monumentRevealAtMs: 9_999,
    })
    expect(built).toEqual({
      entryOpen: false,
      phase: 'landed',
      monumentView: true,
      outpost: { extractorActive: true, moduleActive: true, siege: operational, monument: outpost.monument },
      rivalRevealStatus: 'REVEALED',
      rivalPhase: 'rival-focused',
      firstStrikeStatus: 'COMPLETE',
      strikePhase: 'scar-explore',
      strikePhaseStartedAtMs: 2_345,
      strikeConfirmationOpen: true,
      acceptedOutcome: 'FAILURE',
      counterstrikeDamaged: true,
      csStatus: 'command',
      csPhaseStartedAtMs: 4_321,
      platformDefenseWave: 2,
      monumentRevealAtMs: 9_999,
    })
    // A module still under construction is not a tier.
    const constructing = buildMusicSnapshot({
      entryOpen: false,
      phase: 'landed',
      monumentView: false,
      outpost: { ...outpost, module: { ...outpost.module, status: 'constructing' as const } },
      rival: prototype.rival,
      rivalPresentation: createRivalPresentation('idle', 0),
      firstStrike: prototype.firstStrike,
      firstStrikePresentation: createFirstStrikePresentation('idle', 0),
      strikeConfirmationOpen: false,
      counterstrike: prototype.counterstrike,
      counterstrikeRun: createCounterstrikeRunState(prototype.counterstrike, 0),
      platformDefense: null,
      monumentRevealAtMs: null,
    })
    expect(constructing.outpost?.moduleActive).toBe(false)
  })
})
