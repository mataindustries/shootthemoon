/**
 * Builds the MusicSnapshot (handoff 3.1) from the App's real state. Pure: App
 * memoizes it, so the music system reads the game's own facts and presentation
 * clocks and never keeps a copy of campaign state.
 */
import type { FirstStrikePresentationState } from '../../app/firstStrikePresentation.ts'
import type { RivalPresentationState } from '../../app/rivalPresentation.ts'
import type { CounterstrikeSnapshot } from '../../domain/counterstrike.ts'
import type { FirstStrikeSnapshot } from '../../domain/firstStrike.ts'
import type { OutpostSnapshot } from '../../domain/outpost.ts'
import type { RivalSignalSnapshot } from '../../domain/rival.ts'
import type { WaveDefenseView } from '../../domain/waveDefense.ts'
import type { CounterstrikeRunState } from '../../simulation/counterstrikeSimulation.ts'
import type { ExperiencePhase } from '../../simulation/moonCoreState.ts'
import type { MusicSnapshot } from './musicState.ts'

export interface MusicSnapshotSource {
  readonly entryOpen: boolean
  readonly phase: ExperiencePhase
  readonly monumentView: boolean
  readonly outpost: OutpostSnapshot | null
  readonly rival: RivalSignalSnapshot | null
  readonly rivalPresentation: Pick<RivalPresentationState, 'phase'>
  readonly firstStrike: FirstStrikeSnapshot | null
  readonly firstStrikePresentation: Pick<FirstStrikePresentationState, 'phase' | 'startedAtMs'>
  readonly strikeConfirmationOpen: boolean
  readonly counterstrike: CounterstrikeSnapshot | null
  readonly counterstrikeRun: Pick<CounterstrikeRunState, 'status' | 'phaseStartedAtMs'>
  /** The platform defense window currently shown, if any. */
  readonly platformDefense: Pick<WaveDefenseView, 'wavesResolved'> | null
  readonly monumentRevealAtMs: number | null
}

export function buildMusicSnapshot(source: MusicSnapshotSource): MusicSnapshot {
  const { outpost } = source
  return {
    entryOpen: source.entryOpen,
    phase: source.phase,
    monumentView: source.monumentView,
    outpost:
      outpost === null
        ? null
        : {
            extractorActive: outpost.extractor?.status === 'active',
            moduleActive: outpost.module?.status === 'active',
            siege: outpost.orbitalSiege,
            monument: outpost.monument,
          },
    rivalRevealStatus: source.rival?.revealStatus ?? null,
    rivalPhase: source.rivalPresentation.phase,
    firstStrikeStatus: source.firstStrike?.status ?? null,
    strikePhase: source.firstStrikePresentation.phase,
    strikePhaseStartedAtMs: source.firstStrikePresentation.startedAtMs,
    strikeConfirmationOpen: source.strikeConfirmationOpen,
    acceptedOutcome: source.counterstrike?.acceptedOutcome ?? null,
    counterstrikeDamaged: source.counterstrike?.outpostDamageState === 'DAMAGED',
    csStatus: source.counterstrikeRun.status,
    csPhaseStartedAtMs: source.counterstrikeRun.phaseStartedAtMs,
    platformDefenseWave: source.platformDefense?.wavesResolved ?? null,
    monumentRevealAtMs: source.monumentRevealAtMs,
  }
}
