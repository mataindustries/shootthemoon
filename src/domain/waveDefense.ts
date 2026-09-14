/** One forgiving, simulation-clock shot. Early taps queue for the tracking lock. */
export const DEFENSE_WINDOW_MS = 3_600
export const DEFENSE_LOCK_MS = 500
export const DEFENSE_FIRE_END_MS = 2_600
export const DEFENSE_BREAKUP_MS = 1_000
export const DEFENSE_HULL_SAVED = 4

/** Shared presentation input; combat resolution remains with each existing simulation. */
export interface WaveDefenseView {
  readonly status: string
  readonly phaseElapsedMs: number
  readonly wavesResolved: number
  readonly defenseShots?: readonly (number | null)[]
}

export function defenseShotHits(shotAtMs: number | null | undefined): boolean {
  return typeof shotAtMs === 'number' && Number.isFinite(shotAtMs) && shotAtMs >= 0 && shotAtMs <= DEFENSE_FIRE_END_MS
}

export function defenseImpactAt(shotAtMs: number | null | undefined): number | null {
  return defenseShotHits(shotAtMs) ? Math.max(DEFENSE_LOCK_MS, shotAtMs!) : null
}

/** Only hull damage changes. All allocation, storage, energy and labor math stays upstream. */
export function resolveDefenseDamage(baselineDamage: number, shotAtMs: number | null | undefined): number {
  return Math.max(0, Math.round(baselineDamage) - (defenseShotHits(shotAtMs) ? DEFENSE_HULL_SAVED : 0))
}

export function defensePhase(elapsedMs: number, shotAtMs: number | null | undefined) {
  const impactAt = defenseImpactAt(shotAtMs)
  if (impactAt !== null) return elapsedMs < impactAt ? 'queued' : 'hit'
  if (elapsedMs > DEFENSE_FIRE_END_MS) return 'miss'
  return elapsedMs < DEFENSE_LOCK_MS ? 'approach' : 'targeting'
}
