import { Quaternion, Vector3 } from 'three'
import {
  MEAN_LUNAR_DATUM,
  lunarLocationToMcmf,
  tangentBasis,
  type LandingSite,
  type Vec3,
} from '../domain/lunarCoordinates.ts'

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

