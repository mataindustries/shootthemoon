import { Vector3 } from 'three'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { OCTOGONALS } from '../content/octogonals.ts'

export const BASE_DETAIL_ALTITUDE = .18
export function baseDetailsVisible(cameraRadius: number): boolean {
  return cameraRadius < 1 + BASE_DETAIL_ALTITUDE
}

export function territoryMonumentSite(outpost: OutpostSnapshot, strike: FirstStrikeSnapshot | null): LandingSite {
  return outpost.monument?.anchor === 'impact-scar' && strike?.scar ? strike.scar.site : outpost.site
}

/** A safe, deliberate pullback: structure first, then claim and surrounding scar. */
export function sampleMonumentCamera(site: LandingSite, progress: number, aspect: number) {
  const transform = landingSiteToRenderTransform(site)
  const p = Math.max(0, Math.min(1, progress))
  const t = p * p * (3 - 2 * p)
  const portrait = aspect < 1 ? 1.25 : 1
  const target = transform.position.clone().addScaledVector(transform.up, -.04 - t * .11)
  const position = transform.position.clone()
    .addScaledVector(transform.up, (.24 + t * .55) * portrait)
    .addScaledVector(transform.east, (.13 + t * .21) * portrait)
    .addScaledVector(transform.south, (.32 + t * .35) * portrait)
  return { position, target, up: transform.up.clone() }
}

/** Three straight, distinct approach lanes; no random spawn positions. */
export function octogonalApproach(wave: number, progress: number, ship: number): Vector3 {
  const origin = OCTOGONALS.waves[wave]!.origin
  const t = Math.max(0, Math.min(1, progress))
  // The pass clears the Spire's .083 render-unit summit, including the fleet hull.
  if (t === 1 && ship === 1) return new Vector3(0, .09, 0)
  const spread = (ship - 1) * .020
  const length = Math.hypot(origin[0], origin[2])
  const trail = Math.abs(ship - 1) * .003
  return new Vector3(origin[0] * (.059 * (1 - t) + trail) - origin[2] / length * spread,
    .035 + .055 * t + origin[1] * .08 * (1 - t) + Math.abs(ship - 1) * .004,
    origin[2] * (.059 * (1 - t) + trail) + origin[0] / length * spread)
}
