import {
  MEAN_LUNAR_DATUM,
  TAU,
  createLandingSite,
  dot,
  mcmfToLunarLocation,
  normalizeLongitude,
  surfaceUnitVector,
  tangentBasis,
  type LandingSite,
  type LunarLocation,
  type Vec3,
} from './lunarCoordinates.ts'

export const RIVAL_SIGNAL_ID = 'rival-signal-vesper' as const
export const RIVAL_IDENTITY_ID = 'vesper' as const

export const RIVAL_SITE_ANGULAR_SEPARATION_RAD = (132 * Math.PI) / 180
export const RIVAL_SITE_MAX_ABS_LATITUDE_RAD = (55 * Math.PI) / 180
export const RIVAL_SITE_MIN_SEAM_DISTANCE_RAD = (15 * Math.PI) / 180

const RIVAL_SITE_HEIGHT_M = 0
const CANDIDATE_COUNT = 12
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5))
const VECTOR_EPSILON = 1e-12

export type RivalRevealStatus =
  | 'DORMANT'
  | 'AWAITING_SAFE_MOMENT'
  | 'QUEUED'
  | 'CINEMATIC'
  | 'REVEALED'

export type RivalStage = 'LANDED' | 'ESTABLISHING' | 'FORTIFIED'

export interface DerivedRivalSite {
  readonly site: LandingSite
  /** Clockwise bearing from local north toward east. */
  readonly surfaceHeadingRad: number
}

export interface RivalSignalSnapshot {
  readonly id: typeof RIVAL_SIGNAL_ID
  readonly identityId: typeof RIVAL_IDENTITY_ID
  readonly site: LandingSite
  /** Clockwise bearing from local north toward east. */
  readonly surfaceHeadingRad: number
  readonly revealStatus: RivalRevealStatus
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly revealTriggeredAtMs: number | null
  readonly stage: RivalStage | null
  readonly stageChangedAtMs: number | null
  readonly introTransmissionCompleted: boolean
  readonly introTransmissionCompletedAtMs: number | null
  readonly cinematicCompleted: boolean
  readonly cinematicCompletedAtMs: number | null
  readonly cinematicViewedOnce: boolean
  readonly replayEligible: boolean
  readonly skipEligible: boolean
  readonly scanCompleted: boolean
  readonly scanCompletedAtMs: number | null
  readonly scanResponseCompleted: boolean
  readonly scanResponseCompletedAtMs: number | null
}

function addScaled(
  first: Vec3,
  firstScale: number,
  second: Vec3,
  secondScale: number,
): Vec3 {
  return {
    x: first.x * firstScale + second.x * secondScale,
    y: first.y * firstScale + second.y * secondScale,
    z: first.z * firstScale + second.z * secondScale,
  }
}

function negate(vector: Vec3): Vec3 {
  return { x: -vector.x, y: -vector.y, z: -vector.z }
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z)

  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    throw new RangeError('Cannot normalize a zero-length rival direction.')
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

function unitVectorToSurfaceLocation(vector: Vec3): LunarLocation {
  const radius = MEAN_LUNAR_DATUM.referenceRadiusM + RIVAL_SITE_HEIGHT_M

  return mcmfToLunarLocation(
    {
      x: vector.x * radius,
      y: vector.y * radius,
      z: vector.z * radius,
    },
    MEAN_LUNAR_DATUM,
  )
}

function distanceFromLongitudeSeam(longitudeRad: number): number {
  return Math.PI - Math.abs(normalizeLongitude(longitudeRad))
}

function bearingTowardPlayer(
  rivalLocation: LunarLocation,
  playerDirection: Vec3,
): number {
  const rivalDirection = surfaceUnitVector(rivalLocation)
  const tangentTowardPlayer = normalize(
    addScaled(
      playerDirection,
      1,
      rivalDirection,
      -dot(playerDirection, rivalDirection),
    ),
  )
  const basis = tangentBasis(rivalLocation)
  const north = negate(basis.south)

  return normalizeLongitude(
    Math.atan2(
      dot(tangentTowardPlayer, basis.east),
      dot(tangentTowardPlayer, north),
    ),
  )
}

/**
 * Derives the sole prototype rival location from the player's canonical site.
 * Every candidate is exactly 132 degrees away. Fixed bearing fallbacks keep the
 * result out of polar and antimeridian presentation trouble without randomness.
 */
export function deriveRivalSite(playerSite: LandingSite): DerivedRivalSite {
  if (playerSite.datumId !== MEAN_LUNAR_DATUM.id) {
    throw new RangeError('Rival placement requires the mean lunar datum.')
  }

  const playerDirection = surfaceUnitVector(playerSite.location)
  const playerBasis = tangentBasis(playerSite.location)
  const north = negate(playerBasis.south)

  for (let candidateIndex = 0; candidateIndex < CANDIDATE_COUNT; candidateIndex += 1) {
    const bearingRad = GOLDEN_ANGLE_RAD + (candidateIndex * TAU) / CANDIDATE_COUNT
    const tangentDirection = addScaled(
      playerBasis.east,
      Math.cos(bearingRad),
      north,
      Math.sin(bearingRad),
    )
    const rivalDirection = normalize(
      addScaled(
        playerDirection,
        Math.cos(RIVAL_SITE_ANGULAR_SEPARATION_RAD),
        tangentDirection,
        Math.sin(RIVAL_SITE_ANGULAR_SEPARATION_RAD),
      ),
    )
    const rivalLocation = unitVectorToSurfaceLocation(rivalDirection)

    if (
      Math.abs(rivalLocation.latitudeRad) >
        RIVAL_SITE_MAX_ABS_LATITUDE_RAD ||
      distanceFromLongitudeSeam(rivalLocation.longitudeRad) <
        RIVAL_SITE_MIN_SEAM_DISTANCE_RAD
    ) {
      continue
    }

    return Object.freeze({
      site: createLandingSite(rivalLocation),
      surfaceHeadingRad: bearingTowardPlayer(
        rivalLocation,
        playerDirection,
      ),
    })
  }

  throw new Error('Unable to derive a safe deterministic rival location.')
}

export function lunarAngularSeparationRad(
  first: LunarLocation,
  second: LunarLocation,
): number {
  const cosine = dot(surfaceUnitVector(first), surfaceUnitVector(second))
  return Math.acos(Math.max(-1, Math.min(1, cosine)))
}
