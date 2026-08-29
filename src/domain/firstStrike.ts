import type { LandingSite } from './lunarCoordinates.ts'

export const FIRST_STRIKE_ID = 'first-strike-lunar-warhead' as const
export const LUNAR_SCAR_ID = 'null-meridian-impact-scar' as const

export type FirstStrikeStatus =
  | 'LOCKED'
  | 'READY'
  | 'ARMED'
  | 'LAUNCHING'
  | 'IMPACTED'
  | 'COMPLETE'

export interface LunarScarSnapshot {
  readonly id: typeof LUNAR_SCAR_ID
  readonly site: LandingSite
  readonly createdAtMs: number
}

/**
 * Serializable facts for the single MVP strike. Presentation progress and the
 * confirmation dialog deliberately live outside this snapshot so a refresh
 * can never resume a destructive cinematic halfway through.
 */
export interface FirstStrikeSnapshot {
  readonly id: typeof FIRST_STRIKE_ID
  readonly status: FirstStrikeStatus
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly available: boolean
  readonly availableAtMs: number | null
  readonly armedAtMs: number | null
  readonly launchConfirmedAtMs: number | null
  readonly launchCompleted: boolean
  readonly launchCompletedAtMs: number | null
  readonly finalVesperTransmissionCompleted: boolean
  readonly finalVesperTransmissionCompletedAtMs: number | null
  readonly impactCompleted: boolean
  readonly impactCompletedAtMs: number | null
  readonly rivalFootholdDamaged: boolean
  readonly permanentScarCreated: boolean
  readonly scar: LunarScarSnapshot | null
  readonly endingCompleted: boolean
  readonly endingCompletedAtMs: number | null
}
