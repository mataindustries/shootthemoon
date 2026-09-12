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
  const target = transform.position.clone().addScaledVector(transform.up, -.06 - t * .09)
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
  const spread = (ship - 1) * .009
  return new Vector3(origin[0] * .065 * (1 - t) + spread,
    .035 + origin[1] * .08 * (1 - t), origin[2] * .065 * (1 - t) + spread)
}
