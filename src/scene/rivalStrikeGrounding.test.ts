import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  IMPACT_EMITTER_CLEARANCE_M,
  calculateImpactEmitterHeight,
} from './LunarImpactEffects.tsx'
import {
  WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M,
  WARHEAD_SYSTEM_GROUND_CLEARANCE_M,
  calculateWarheadSystemGrounding,
} from './LunarWarheadSystem.tsx'
import { calculatePermanentScarFloorHeight } from './PermanentLunarScar.tsx'
import {
  RIVAL_FOUNDATION_CLEARANCE_M,
  RIVAL_FOUNDATION_RADIUS_M,
  calculateDamagedFoundationVerticalBounds,
  calculateRivalFoundationBottomOffset,
  calculateRivalGrounding,
} from './RivalFoothold.tsx'

const site = createLandingSite(createLunarLocation(0.271, -2.134))
const terrain = createSurfaceTerrainProfile(site)

function denseFootprintMaximum(segments: number, radiusM: number): number {
  let maximum = sampleRenderedSurface(terrain, segments, 0, 0).y

  for (let ring = 1; ring <= 16; ring += 1) {
    const radius = (radiusM * ring) / 16

    for (let index = 0; index < 256; index += 1) {
      const angle = (index / 256) * Math.PI * 2
      maximum = Math.max(
        maximum,
        sampleRenderedSurface(
          terrain,
          segments,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ).y,
      )
    }
  }

  return maximum
}

describe('rival and First Strike rendered-mesh grounding', () => {
  it.each([32, 96, 128])(
    'keeps the rival foundation above the production triangles at %i segments',
    (segments) => {
      const grounding = calculateRivalGrounding(terrain, segments)
      const foundationBottom =
        grounding.attachmentHeight + grounding.foundationBottomOffset
      const denseMaximum = denseFootprintMaximum(
        segments,
        RIVAL_FOUNDATION_RADIUS_M,
      )

      expect(foundationBottom - grounding.maximumSurfaceHeight).toBeCloseTo(
        RIVAL_FOUNDATION_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS,
        12,
      )
      expect(foundationBottom).toBeGreaterThanOrEqual(denseMaximum)

      // The attachment datum is fixed to the larger strategic footprint. The
      // smaller focus model therefore gains clearance without moving its root.
      expect(
        grounding.attachmentHeight +
          calculateRivalFoundationBottomOffset(true),
      ).toBeGreaterThanOrEqual(
        grounding.attachmentHeight +
          calculateRivalFoundationBottomOffset(false),
      )
    },
  )

  it('embeds destroyed rival hardware at the sampled crater floor', () => {
    const segments = 32
    const centerHeight = sampleRenderedSurface(terrain, segments, 0, 0).y
    const scarred = calculateRivalGrounding(terrain, segments, 'scarred')
    const intact = calculateRivalGrounding(terrain, segments, 'terrain')

    expect(scarred.attachmentHeight).toBeCloseTo(
      calculatePermanentScarFloorHeight(centerHeight),
      12,
    )
    expect(scarred.attachmentHeight).toBeLessThan(intact.attachmentHeight)

    for (const focused of [false, true]) {
      const bounds = calculateDamagedFoundationVerticalBounds(
        scarred.attachmentHeight,
        focused,
      )
      expect(bounds.bottom).toBeLessThan(scarred.maximumSurfaceHeight)
      expect(bounds.top).toBeGreaterThan(scarred.maximumSurfaceHeight)
    }
  })

  it.each([96, 112, 128])(
    'clears the launcher base and lowest contact feet at %i segments',
    (segments) => {
      const grounding = calculateWarheadSystemGrounding(terrain, segments)
      const contactBottom =
        grounding.attachmentHeight + grounding.contactBottomOffset
      const denseMaximum = denseFootprintMaximum(
        segments,
        WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M,
      )

      expect(contactBottom - grounding.maximumSurfaceHeight).toBeCloseTo(
        WARHEAD_SYSTEM_GROUND_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS,
        12,
      )
      expect(contactBottom).toBeGreaterThanOrEqual(denseMaximum)
    },
  )

  it.each([32, 96, 128])(
    'anchors the impact emitter 1.5 cm over its exact center triangle at %i segments',
    (segments) => {
      const surface = sampleRenderedSurface(terrain, segments, 0, 0)
      const emitterHeight = calculateImpactEmitterHeight(terrain, segments)

      expect(
        (emitterHeight - surface.y) / LOCAL_METRES_TO_RENDER_UNITS,
      ).toBeCloseTo(IMPACT_EMITTER_CLEARANCE_M, 12)
      expect(IMPACT_EMITTER_CLEARANCE_M).toBeGreaterThanOrEqual(0.01)
      expect(IMPACT_EMITTER_CLEARANCE_M).toBeLessThanOrEqual(0.02)
    },
  )
})
