import { MathUtils, Vector3 } from 'three'
import {
  MEAN_LUNAR_DATUM,
  surfaceUnitVector,
  type LandingSite,
} from '../domain/lunarCoordinates.ts'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { slerpUnitDirections } from './orbitalCameraPath.ts'

const COUNTERSTRIKE_ARC_DIRECTION = new Vector3(-0.42, 0.76, 0.5).normalize()
const HIDDEN_SOURCE_SEPARATION_RAD = (104 * Math.PI) / 180

export const COUNTERSTRIKE_ROUTE_SAFETY = Object.freeze({
  moonRadiusM: MEAN_LUNAR_DATUM.referenceRadiusM,
  minimumClearanceM: 18_000,
  peakClearanceM: 480_000,
  terminalClearanceM: 120,
  sampleCount: 2_048,
})

export interface CounterstrikeRoute {
  readonly startDirection: Vector3
  readonly endDirection: Vector3
  readonly minimumClearanceM: number
  getDirection(progress: number, target?: Vector3): Vector3
  getCanonicalPoint(progress: number, target?: Vector3): Vector3
  getRenderPoint(progress: number, target?: Vector3): Vector3
  getTerminalCanonicalPoint(progress: number, target?: Vector3): Vector3
  getTerminalRenderPoint(progress: number, target?: Vector3): Vector3
}

export interface InterceptorRoute {
  readonly interceptProgress: number
  readonly startDirection: Vector3
  readonly endDirection: Vector3
  getCanonicalPoint(progress: number, target?: Vector3): Vector3
  getRenderPoint(progress: number, target?: Vector3): Vector3
}

function clampProgress(progress: number): number {
  return MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
}

function toDirection(site: LandingSite): Vector3 {
  const vector = surfaceUnitVector(site.location)
  return new Vector3(vector.x, vector.y, vector.z).normalize()
}

export function deriveCounterstrikeLaunchDirection(
  playerSite: LandingSite,
  rivalSite: LandingSite,
): Vector3 {
  const player = toDirection(playerSite)
  const rival = toDirection(rivalSite)
  const tangent = rival.addScaledVector(player, -rival.dot(player))

  if (tangent.lengthSq() < 1e-12) {
    tangent.copy(COUNTERSTRIKE_ARC_DIRECTION)
      .addScaledVector(player, -COUNTERSTRIKE_ARC_DIRECTION.dot(player))
  }

  tangent.normalize()
  return player
    .multiplyScalar(Math.cos(HIDDEN_SOURCE_SEPARATION_RAD))
    .addScaledVector(tangent, Math.sin(HIDDEN_SOURCE_SEPARATION_RAD))
    .normalize()
}

function threatClearanceM(progress: number): number {
  const clamped = clampProgress(progress)
  return MathUtils.lerp(
    COUNTERSTRIKE_ROUTE_SAFETY.minimumClearanceM,
    COUNTERSTRIKE_ROUTE_SAFETY.peakClearanceM,
    Math.sin(Math.PI * clamped) ** 0.86,
  )
}

export function createCounterstrikeRoute(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  secondaryImpactSite: LandingSite,
): CounterstrikeRoute {
  if (
    playerSite.datumId !== MEAN_LUNAR_DATUM.id ||
    rivalSite.datumId !== MEAN_LUNAR_DATUM.id ||
    secondaryImpactSite.datumId !== MEAN_LUNAR_DATUM.id
  ) {
    throw new RangeError('Counterstrike route requires the mean lunar datum.')
  }

  const startDirection = deriveCounterstrikeLaunchDirection(
    playerSite,
    rivalSite,
  )
  const endDirection = toDirection(secondaryImpactSite)
  const temporaryDirection = new Vector3()
  const scale = MOON_RENDER_RADIUS / MEAN_LUNAR_DATUM.referenceRadiusM

  const getDirection = (
    progress: number,
    target = new Vector3(),
  ): Vector3 =>
    slerpUnitDirections(
      startDirection,
      endDirection,
      clampProgress(progress),
      COUNTERSTRIKE_ARC_DIRECTION,
      target,
    )

  const getCanonicalPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => {
    const clamped = clampProgress(progress)
    getDirection(clamped, temporaryDirection)
    return target.copy(temporaryDirection).multiplyScalar(
      MEAN_LUNAR_DATUM.referenceRadiusM + threatClearanceM(clamped),
    )
  }

  const getRenderPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => getCanonicalPoint(progress, target).multiplyScalar(scale)

  const getTerminalCanonicalPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => {
    const clamped = clampProgress(progress)
    const clearanceM = MathUtils.lerp(
      COUNTERSTRIKE_ROUTE_SAFETY.minimumClearanceM,
      COUNTERSTRIKE_ROUTE_SAFETY.terminalClearanceM,
      clamped * clamped,
    )
    return target.copy(endDirection).multiplyScalar(
      MEAN_LUNAR_DATUM.referenceRadiusM + clearanceM,
    )
  }

  const getTerminalRenderPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 =>
    getTerminalCanonicalPoint(progress, target).multiplyScalar(scale)

  return {
    startDirection,
    endDirection,
    minimumClearanceM: COUNTERSTRIKE_ROUTE_SAFETY.minimumClearanceM,
    getDirection,
    getCanonicalPoint,
    getRenderPoint,
    getTerminalCanonicalPoint,
    getTerminalRenderPoint,
  }
}

export function createInterceptorRoute(
  playerSite: LandingSite,
  threatRoute: CounterstrikeRoute,
  interceptProgress: number,
): InterceptorRoute {
  const safeInterceptProgress = MathUtils.clamp(interceptProgress, 0.12, 0.96)
  const startDirection = toDirection(playerSite)
  const endDirection = threatRoute.getDirection(safeInterceptProgress)
  const endpoint = threatRoute.getCanonicalPoint(safeInterceptProgress)
  const endpointClearanceM =
    endpoint.length() - MEAN_LUNAR_DATUM.referenceRadiusM
  const temporaryDirection = new Vector3()
  const scale = MOON_RENDER_RADIUS / MEAN_LUNAR_DATUM.referenceRadiusM

  const getCanonicalPoint = (
    progress: number,
    target = new Vector3(),
  ): Vector3 => {
    const clamped = clampProgress(progress)
    slerpUnitDirections(
      startDirection,
      endDirection,
      clamped,
      COUNTERSTRIKE_ARC_DIRECTION,
      temporaryDirection,
    )
    const launchClearanceM = 9_000
    const clearanceM = MathUtils.lerp(
      launchClearanceM,
      endpointClearanceM,
      clamped ** 0.72,
    )
    return target.copy(temporaryDirection).multiplyScalar(
      MEAN_LUNAR_DATUM.referenceRadiusM + clearanceM,
    )
  }

  return {
    interceptProgress: safeInterceptProgress,
    startDirection,
    endDirection,
    getCanonicalPoint,
    getRenderPoint: (progress: number, target = new Vector3()) =>
      getCanonicalPoint(progress, target).multiplyScalar(scale),
  }
}

export function sampleMinimumCounterstrikeClearanceM(
  route: CounterstrikeRoute,
  sampleCount = COUNTERSTRIKE_ROUTE_SAFETY.sampleCount,
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
