import {
  MEAN_LUNAR_DATUM,
  createLandingSite,
  createLunarLocation,
  localTangentToMcmf,
  mcmfToLunarLocation,
  type LandingSite,
} from './lunarCoordinates.ts'
import type { OutpostSnapshot } from './outpost.ts'

export const COUNTERSTRIKE_ID = 'vesper-orbital-counterstrike' as const

export type CounterstrikeOutcome = 'SUCCESS' | 'FAILURE'
export type OutpostDamageState = 'INTACT' | 'DAMAGED'

/**
 * Persisted Counterstrike facts only. The active warning, timing window,
 * missile, camera, and replay-preview state deliberately live in the transient
 * run reducer so refresh can never resume a projectile in flight.
 */
export interface CounterstrikeSnapshot {
  readonly id: typeof COUNTERSTRIKE_ID
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly available: boolean
  readonly availableAtMs: number | null
  readonly acceptedOutcome: CounterstrikeOutcome | null
  readonly interceptionSucceeded: boolean | null
  readonly outpostDamageState: OutpostDamageState
  readonly secondaryImpactSite: LandingSite | null
  readonly completedAtMs: number | null
  readonly acceptedAtMs: number | null
  readonly replayEligible: boolean
  readonly orbitalDebrisRecorded: boolean
  readonly repairsRequired: boolean
}

export interface SecondaryImpactOffset {
  readonly xM: number
  readonly zM: number
}

export const SECONDARY_IMPACT_EXTRACTOR_STANDOFF_M = 8.4

/**
 * Places the survivable hit just beyond the extractor, never at the canonical
 * outpost origin. The extractor-selected direction keeps every valid outpost
 * layout deterministic while the spherical reprojection remains seam/pole safe.
 */
export function deriveSecondaryImpactOffset(
  outpost: OutpostSnapshot,
): SecondaryImpactOffset {
  const extractorPosition = outpost.extractor?.position ?? {
    xM: -10.5,
    zM: -8.5,
  }
  const distance = Math.hypot(extractorPosition.xM, extractorPosition.zM)
  const directionX = distance > 1e-9 ? extractorPosition.xM / distance : -0.78
  const directionZ = distance > 1e-9 ? extractorPosition.zM / distance : -0.63

  return Object.freeze({
    xM:
      extractorPosition.xM +
      directionX * SECONDARY_IMPACT_EXTRACTOR_STANDOFF_M,
    zM:
      extractorPosition.zM +
      directionZ * SECONDARY_IMPACT_EXTRACTOR_STANDOFF_M,
  })
}

export function deriveSecondaryImpactSite(
  outpost: OutpostSnapshot,
): LandingSite {
  if (outpost.site.datumId !== MEAN_LUNAR_DATUM.id) {
    throw new RangeError('Counterstrike impact requires the mean lunar datum.')
  }

  const offset = deriveSecondaryImpactOffset(outpost)
  const tangentPoint = localTangentToMcmf(
    { x: offset.xM, y: 0, z: offset.zM },
    outpost.site.location,
  )
  const projected = mcmfToLunarLocation(tangentPoint)

  return createLandingSite(
    createLunarLocation(projected.latitudeRad, projected.longitudeRad, 0),
  )
}
