import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LANDING_MARKER_DIAMETER_FACTOR,
  LANDING_MARKER_MAX_SCALE,
  LANDING_MARKER_OUTER_RING_TUBE_RADIUS,
  LANDING_MARKER_OUTER_RING_Y,
  LANDING_MARKER_SURFACE_OFFSET,
  getLandingMarkerOuterPulse,
  getLandingMarkerPosition,
  getLandingMarkerScale,
} from './landingMarkerLayout.ts'

describe('landing marker layout', () => {
  it('keeps the precise site center and offsets it only along the surface normal', () => {
    const transform = landingSiteToRenderTransform(
      createLandingSite(createLunarLocation(0.42, -1.18)),
    )
    const position = getLandingMarkerPosition(transform)
    const offset = position.clone().sub(transform.position)

    expect(offset.length()).toBeCloseTo(LANDING_MARKER_SURFACE_OFFSET, 12)
    expect(offset.normalize().dot(transform.up)).toBeCloseTo(1, 12)
  })

  it('increases apparent diameter by exactly fifty percent at every scale limit', () => {
    expect(LANDING_MARKER_DIAMETER_FACTOR).toBe(1.5)
    expect(getLandingMarkerScale(0)).toBeCloseTo(0.0003 * 1.5, 12)
    expect(getLandingMarkerScale(1)).toBeCloseTo(0.013 * 1.5, 12)
    expect(getLandingMarkerScale(100)).toBeCloseTo(0.026 * 1.5, 12)
  })

  it('keeps the thick outer ring fully clear of the lunar surface', () => {
    const minimumClearance =
      LANDING_MARKER_SURFACE_OFFSET +
      (LANDING_MARKER_OUTER_RING_Y -
        LANDING_MARKER_OUTER_RING_TUBE_RADIUS) *
        LANDING_MARKER_MAX_SCALE

    expect(minimumClearance).toBeGreaterThan(0)
    expect(minimumClearance).toBeLessThan(0.001)
  })

  it('uses a restrained slow pulse only on the outer ring', () => {
    const samples = Array.from({ length: 100 }, (_, index) =>
      getLandingMarkerOuterPulse(index / 10),
    )

    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.98)
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.04)
  })
})
