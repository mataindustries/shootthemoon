import { SIEGE_WAVE_TIMES, type OrbitalSiegeSnapshot } from '../domain/orbitalSiege.ts'
import { DEFENSE_WINDOW_MS, type WaveDefenseView } from '../domain/waveDefense.ts'

export interface PlatformDefenseShots {
  readonly attempt: number
  readonly shots: readonly (number | null)[]
}

/** Read the existing wave deadlines; never dispatch or resolve a siege wave here. */
export function platformDefenseView(siege: OrbitalSiegeSnapshot | null, record: PlatformDefenseShots | null): WaveDefenseView | null {
  if (siege?.status !== 'waves') return null
  const elapsed = siege.elapsedMs - (SIEGE_WAVE_TIMES[siege.wavesResolved]! - DEFENSE_WINDOW_MS)
  if (elapsed < 0 || elapsed >= DEFENSE_WINDOW_MS) return null
  return { status: 'wave', wavesResolved: siege.wavesResolved, phaseElapsedMs: elapsed,
    defenseShots: record?.attempt === siege.attempts ? record.shots : [null, null, null] }
}

/** A presentation-only shot: platform health, resource math and saves are untouched. */
export function firePlatformDefense(siege: OrbitalSiegeSnapshot, record: PlatformDefenseShots | null, elapsedSinceTick: number): PlatformDefenseShots | null {
  const view = platformDefenseView(siege, record)
  if (!view) return record
  const elapsed = view.phaseElapsedMs + Math.max(0, elapsedSinceTick)
  if (elapsed >= DEFENSE_WINDOW_MS || view.defenseShots?.[view.wavesResolved] != null) return record
  const shots = [...view.defenseShots!]
  shots[view.wavesResolved] = elapsed
  return { attempt: siege.attempts, shots }
}
