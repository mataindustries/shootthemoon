import { Quaternion, Vector3 } from 'three'
import {
  MEAN_LUNAR_DATUM,
  lunarLocationToMcmf,
  tangentBasis,
  type LandingSite,
  type Vec3,
} from '../domain/lunarCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from './localSurface.ts'

export const MOON_RENDER_RADIUS = 1

export interface LandingRenderTransform {
  readonly position: Vector3
  readonly orientation: Quaternion
  readonly east: Vector3
  readonly up: Vector3
  readonly south: Vector3
}

export function vec3ToThree(vector: Vec3): Vector3 {
  return new Vector3(vector.x, vector.y, vector.z)
}

export function landingSiteToRenderTransform(
  site: LandingSite,
): LandingRenderTransform {
  const canonicalPosition = lunarLocationToMcmf(site.location)
  const scale = MOON_RENDER_RADIUS / MEAN_LUNAR_DATUM.referenceRadiusM
  const basis = tangentBasis(site.location)

  return {
    position: new Vector3(
      canonicalPosition.x * scale,
      canonicalPosition.y * scale,
      canonicalPosition.z * scale,
    ),
    orientation: new Quaternion(
      site.orientationMcmf.x,
      site.orientationMcmf.y,
      site.orientationMcmf.z,
      site.orientationMcmf.w,
    ),
    east: vec3ToThree(basis.east),
    up: vec3ToThree(basis.up),
    south: vec3ToThree(basis.south),
  }
}

/**
 * Converts a nearby canonical site into the deliberately expanded local scale
 * used by close-range terrain and machinery. Radial altitude is excluded so
 * callers can align the point to their exact rendered surface.
 */
export function landingSiteToLocalSurfaceRenderPoint(
  originSite: LandingSite,
  nearbySite: LandingSite,
  target = new Vector3(),
): Vector3 {
  if (
    originSite.datumId !== MEAN_LUNAR_DATUM.id ||
    nearbySite.datumId !== MEAN_LUNAR_DATUM.id
  ) {
    throw new RangeError('Local surface rendering requires the mean lunar datum.')
  }

  const origin = landingSiteToRenderTransform(originSite)
  const nearby = landingSiteToRenderTransform(nearbySite)
  const canonicalScale = MOON_RENDER_RADIUS / MEAN_LUNAR_DATUM.referenceRadiusM
  const delta = nearby.position.clone().sub(origin.position)
  const eastM = delta.dot(origin.east) / canonicalScale
  const southM = delta.dot(origin.south) / canonicalScale

  return target
    .copy(origin.position)
    .addScaledVector(origin.east, eastM * LOCAL_METRES_TO_RENDER_UNITS)
    .addScaledVector(origin.south, southM * LOCAL_METRES_TO_RENDER_UNITS)
}
