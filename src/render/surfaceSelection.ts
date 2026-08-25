import {
  MEAN_LUNAR_DATUM,
  createLandingSite,
  intersectRayWithSphere,
  mcmfToLunarLocation,
  type LandingSite,
  type LunarDatum,
  type Ray3,
} from '../domain/lunarCoordinates.ts'

export function selectLandingSiteFromOrbitalRay(
  ray: Ray3,
  moonRenderRadius: number,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): LandingSite | null {
  const renderHit = intersectRayWithSphere(ray, moonRenderRadius)

  if (renderHit === null) {
    return null
  }

  const metresPerRenderUnit = datum.referenceRadiusM / moonRenderRadius
  const canonicalHit = {
    x: renderHit.x * metresPerRenderUnit,
    y: renderHit.y * metresPerRenderUnit,
    z: renderHit.z * metresPerRenderUnit,
  }

  return createLandingSite(mcmfToLunarLocation(canonicalHit, datum), datum)
}

