import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

export const BASE_DETAIL_ALTITUDE = .18
export function baseDetailsVisible(cameraRadius: number): boolean {
  return cameraRadius < 1 + BASE_DETAIL_ALTITUDE
}

/** Monument detail only competes with the close base view; every dedicated monument presentation sits beyond the cutoff. */
export function monumentDetailVisible(cameraRadius: number): boolean {
  return !baseDetailsVisible(cameraRadius)
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
