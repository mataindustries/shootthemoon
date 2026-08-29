import { MathUtils, Vector3 } from 'three'
import {
  MEAN_LUNAR_DATUM,
  surfaceUnitVector,
  type LandingSite,
} from '../domain/lunarCoordinates.ts'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { slerpUnitDirections } from './orbitalCameraPath.ts'

const PREFERRED_STRIKE_ARC = new Vector3(0.34, 0.79, 0.51).normalize()

export const STRIKE_ROUTE_SAFETY = Object.freeze({
  moonRadiusM: MEAN_LUNAR_DATUM.referenceRadiusM,
  minimumClearanceM: 24_000,
  minimumPeakClearanceM: 320_000,
  maximumPeakClearanceM: 760_000,
  peakClearancePerRadianM: 360_000,
  sampleCount: 2_048,
})

export interface StrikeRoute {
  readonly startDirection: Vector3
  readonly endDirection: Vector3
  readonly angularSeparationRad: number
  readonly minimumClearanceM: number
  readonly peakClearanceM: number
  getCanonicalPoint(progress: number, target?: Vector3): Vector3
  getRenderPoint(progress: number, target?: Vector3): Vector3
  getDirection(progress: number, target?: Vector3): Vector3
}

function clampProgress(progress: number): number {
  return MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
}

function strikeClearanceM(
  progress: number,
  minimumClearanceM: number,
  peakClearanceM: number,
): number {
  const elevation = Math.sin(Math.PI * clampProgress(progress)) ** 0.82
  return MathUtils.lerp(minimumClearanceM, peakClearanceM, elevation)
}

/**
 * A deterministic, geography-derived visual route. It interpolates MCMF unit
 * directions instead of latitude/longitude, so seams and poles do not exist
 * in the path math. Exact antipodes use the same explicit tangent fallback as
 * the proven Rival Signal camera paths.
 */
export function createStrikeRoute(
  playerSite: LandingSite,
  rivalSite: LandingSite,
): StrikeRoute {
  if (
    playerSite.datumId !== MEAN_LUNAR_DATUM.id ||
    rivalSite.datumId !== MEAN_LUNAR_DATUM.id
  ) {
    throw new RangeError('First Strike route requires the mean lunar datum.')
  }

  const playerVector = surfaceUnitVector(playerSite.location)
  const rivalVector = surfaceUnitVector(rivalSite.location)
  const startDirection = new Vector3(
    playerVector.x,
    playerVector.y,
    playerVector.z,
  ).normalize()
  const endDirection = new Vector3(
    rivalVector.x,
    rivalVector.y,
    rivalVector.z,
  ).normalize()
  const angularSeparationRad = Math.acos(
    MathUtils.clamp(startDirection.dot(endDirection), -1, 1),
  )
  const peakClearanceM = MathUtils.clamp(
    angularSeparationRad * STRIKE_ROUTE_SAFETY.peakClearancePerRadianM,
    STRIKE_ROUTE_SAFETY.minimumPeakClearanceM,
    STRIKE_ROUTE_SAFETY.maximumPeakClearanceM,
  )
  const temporaryDirection = new Vector3()

  const getDirection = (
    progress: number,
    target = new Vector3(),
  ): Vector3 =>
    slerpUnitDirections(
      startDirection,
      endDirection,
      clampProgress(progress),
      PREFERRED_STRIKE_ARC,
      target,
    )

  const getCanonicalPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => {
    const clamped = clampProgress(progress)
    const clearanceM = strikeClearanceM(
      clamped,
      STRIKE_ROUTE_SAFETY.minimumClearanceM,
      peakClearanceM,
    )

    getDirection(clamped, temporaryDirection)
    return target
      .copy(temporaryDirection)
      .multiplyScalar(MEAN_LUNAR_DATUM.referenceRadiusM + clearanceM)
  }

  const getRenderPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => {
    const scale = MOON_RENDER_RADIUS / MEAN_LUNAR_DATUM.referenceRadiusM
    return getCanonicalPoint(progress, target).multiplyScalar(scale)
  }

  return {
    startDirection,
    endDirection,
    angularSeparationRad,
    minimumClearanceM: STRIKE_ROUTE_SAFETY.minimumClearanceM,
    peakClearanceM,
    getCanonicalPoint,
    getRenderPoint,
    getDirection,
  }
}

export function sampleMinimumStrikeClearanceM(
  route: StrikeRoute,
  sampleCount = STRIKE_ROUTE_SAFETY.sampleCount,
): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('sampleCount must be a positive integer.')
  }

  const point = new Vector3()
  let minimum = Number.POSITIVE_INFINITY

  for (let index = 0; index <= sampleCount; index += 1) {
    route.getCanonicalPoint(index / sampleCount, point)
    minimum = Math.min(
      minimum,
      point.length() - MEAN_LUNAR_DATUM.referenceRadiusM,
    )
  }

  return minimum
}
