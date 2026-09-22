import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  CLAIM_HARDWARE,
  CLAIM_RELATIONSHIP_ARC,
  ORBITAL_CLAIM_MARKER,
  claimEmphasisPulse,
  claimFacesCamera,
  claimHardwareScale,
  claimHorizonVisibility,
  claimRelationshipArcOpacity,
  pixelsPerWorldUnit,
  resolveClaimMarkerReadout,
  screenPixelsForWorldSize,
  worldSizeForScreenPixels,
  type ScreenProjection,
} from './orbitalClaimMarker.ts'

/**
 * Supported orbit compositions. Distances are Moon-centred camera radius minus
 * the near-side site, and the tangent length for a site sitting at the limb;
 * the portrait field of view is the wider one the orbit camera adopts there.
 */
const ORBIT_VIEWS = [
  { name: '1440x900 near side', viewportHeightPx: 900, verticalFovDeg: 42, distance: 2.345 },
  { name: '1440x900 limb', viewportHeightPx: 900, verticalFovDeg: 42, distance: 3.192 },
  { name: '1920x1080 near side', viewportHeightPx: 1080, verticalFovDeg: 42, distance: 2.345 },
  { name: '1920x1080 limb', viewportHeightPx: 1080, verticalFovDeg: 42, distance: 3.192 },
  { name: '390x844 near side', viewportHeightPx: 844, verticalFovDeg: 58, distance: 3.7 },
  { name: '390x844 limb', viewportHeightPx: 844, verticalFovDeg: 58, distance: 4.592 },
] as const satisfies readonly (ScreenProjection & { name: string })[]

/** The bisector pose of the TWO CLAIMS DETECTED beat puts both near the limb. */
const DUAL_SITE_VIEWS = [
  { name: '1440x900 dual sites', viewportHeightPx: 900, verticalFovDeg: 42, distance: 3.51 },
  { name: '1920x1080 dual sites', viewportHeightPx: 1080, verticalFovDeg: 42, distance: 3.51 },
  { name: '390x844 dual sites', viewportHeightPx: 844, verticalFovDeg: 58, distance: 4.592 },
] as const satisfies readonly (ScreenProjection & { name: string })[]

function hardwareWorldDiameter(
  claim: 'outpost' | 'rival',
  distance: number,
): number {
  if (claim === 'rival') {
    const rival = CLAIM_HARDWARE.rival
    return (
      claimHardwareScale(
        distance,
        rival.minimumScale,
        rival.maximumScale,
        rival.distanceScale,
      ) * rival.unitDiameter
    )
  }

  const outpost = CLAIM_HARDWARE.outpost
  return (
    claimHardwareScale(
      distance,
      outpost.minimumScale,
      outpost.maximumScale,
      outpost.activeDistanceScale,
    ) * outpost.unitDiameter
  )
}

function readoutFor(
  claim: 'outpost' | 'rival',
  view: ScreenProjection,
  emphasised = false,
) {
  return resolveClaimMarkerReadout(
    hardwareWorldDiameter(claim, view.distance),
    view,
    emphasised,
  )
}

const CLAIMS = ['outpost', 'rival'] as const

describe('orbital claim marker readability', () => {
  it('records why world-space hardware alone cannot carry orbital distance', () => {
    for (const view of ORBIT_VIEWS) {
      for (const claim of CLAIMS) {
        expect(readoutFor(claim, view).hardwareDiameterPx).toBeLessThan(14)
      }
    }
  })

  it('holds both claims inside a readable, restrained pixel band in orbit', () => {
    for (const view of ORBIT_VIEWS) {
      for (const claim of CLAIMS) {
        const readout = readoutFor(claim, view)

        expect(readout.beaconDiameterPx).toBeGreaterThanOrEqual(
          ORBITAL_CLAIM_MARKER.minimumBeaconPx,
        )
        expect(readout.beaconDiameterPx).toBeLessThanOrEqual(
          ORBITAL_CLAIM_MARKER.maximumBeaconPx,
        )
        expect(readout.beaconOpacity).toBe(1)
      }
    }
  })

  it('lifts both claims together through the dual-sites beat', () => {
    for (const view of DUAL_SITE_VIEWS) {
      const player = readoutFor('outpost', view, true)
      const rival = readoutFor('rival', view, true)

      for (const readout of [player, rival]) {
        expect(readout.beaconDiameterPx).toBeGreaterThanOrEqual(
          ORBITAL_CLAIM_MARKER.emphasisBeaconPx,
        )
        expect(readout.beaconDiameterPx).toBeLessThanOrEqual(
          ORBITAL_CLAIM_MARKER.maximumBeaconPx,
        )
      }

      // Neither claim may out-shout the other in the same composition.
      expect(
        Math.abs(player.beaconDiameterPx - rival.beaconDiameterPx),
      ).toBeLessThanOrEqual(6)
      expect(player.beaconDiameterPx).toBeGreaterThan(
        readoutFor('outpost', view).beaconDiameterPx - 0.001,
      )
    }
  })

  it('keeps the tap target matched to what is actually drawn', () => {
    for (const view of [...ORBIT_VIEWS, ...DUAL_SITE_VIEWS]) {
      for (const claim of CLAIMS) {
        for (const emphasised of [false, true]) {
          const readout = readoutFor(claim, view, emphasised)

          expect(readout.touchDiameterPx).toBeGreaterThanOrEqual(
            readout.beaconDiameterPx,
          )
          expect(readout.touchDiameterPx).toBeGreaterThanOrEqual(
            ORBITAL_CLAIM_MARKER.minimumTouchPx,
          )
          expect(readout.touchDiameterPx).toBeLessThanOrEqual(
            ORBITAL_CLAIM_MARKER.maximumTouchPx,
          )
          expect(
            screenPixelsForWorldSize(readout.touchWorldRadius * 2, view),
          ).toBeCloseTo(readout.touchDiameterPx, 6)
        }
      }
    }
  })

  it('never lets an enlarged tap target grow into a Moon-sized bubble', () => {
    for (const view of ORBIT_VIEWS) {
      for (const claim of CLAIMS) {
        const hardware =
          claim === 'rival' ? CLAIM_HARDWARE.rival : CLAIM_HARDWARE.outpost
        // The pre-pass hit sphere was a fixed 7.5 unit-scale radius riding the
        // marker group. Growing the drawn marker must not grow the bubble that
        // sits between the player and a Moon orbit gesture.
        const legacyRadius =
          7.5 *
          claimHardwareScale(
            view.distance,
            hardware.minimumScale,
            hardware.maximumScale,
            'distanceScale' in hardware
              ? hardware.distanceScale
              : hardware.activeDistanceScale,
          )

        expect(readoutFor(claim, view).touchWorldRadius).toBeLessThanOrEqual(
          legacyRadius,
        )
      }
    }
  })

  it('scales with distance instead of pinning one world size', () => {
    const near = readoutFor('rival', ORBIT_VIEWS[0])
    const far = readoutFor('rival', ORBIT_VIEWS[1])

    expect(far.beaconWorldDiameter).toBeGreaterThan(near.beaconWorldDiameter)
    expect(far.beaconDiameterPx).toBeCloseTo(near.beaconDiameterPx, 6)
  })

  it('retires the beacon once the authored hardware reads on its own', () => {
    const closeApproach: ScreenProjection = {
      distance: 0.15,
      verticalFovDeg: 50,
      viewportHeightPx: 844,
    }

    expect(readoutFor('outpost', closeApproach).hardwareDiameterPx).toBeGreaterThan(
      ORBITAL_CLAIM_MARKER.beaconFadeEndPx,
    )
    expect(readoutFor('outpost', closeApproach).beaconOpacity).toBe(0)

    let previous = 1

    for (let px = 0; px <= 200; px += 4) {
      const opacity = resolveClaimMarkerReadout(
        worldSizeForScreenPixels(px, ORBIT_VIEWS[0]),
        ORBIT_VIEWS[0],
      ).beaconOpacity

      expect(opacity).toBeLessThanOrEqual(previous + 1e-9)
      previous = opacity
    }
  })

  it('lifts the billboarded ring far enough to clear the local surface', () => {
    for (const view of ORBIT_VIEWS) {
      for (const claim of CLAIMS) {
        const readout = readoutFor(claim, view)

        expect(readout.beaconSurfaceOffset).toBeGreaterThanOrEqual(
          readout.beaconWorldDiameter / 2,
        )
        // ...while staying inside the tap target, so a tap aimed at the exact
        // claim coordinates still selects it.
        expect(readout.beaconSurfaceOffset).toBeLessThan(readout.touchWorldRadius)
      }
    }
  })

  it('stops drawing a claim exactly where it stops being selectable', () => {
    const camera = new Vector3(3.2, 0.32, 0.92).setLength(3.345)

    for (let step = 0; step <= 240; step += 1) {
      const angle = (step / 240) * Math.PI
      const site = new Vector3(
        Math.cos(angle),
        0,
        Math.sin(angle),
      )
        .applyAxisAngle(new Vector3(0, 1, 0), 0.28)
        .setLength(1.00038)

      expect(claimHorizonVisibility(site, camera) > 0).toBe(
        claimFacesCamera(site, camera),
      )
    }
  })

  it('keeps the relationship arc a hairline at every supported viewport', () => {
    for (const view of DUAL_SITE_VIEWS) {
      for (const distance of [view.distance, view.distance - 1.06]) {
        const widthPx = screenPixelsForWorldSize(
          CLAIM_RELATIONSHIP_ARC.tubeRadius * 2,
          { ...view, distance },
        )

        expect(widthPx).toBeGreaterThan(1.2)
        expect(widthPx).toBeLessThan(6)
      }
    }
  })

  it('fades the relationship arc in and out inside the beat', () => {
    expect(claimRelationshipArcOpacity(0)).toBe(0)
    expect(claimRelationshipArcOpacity(1)).toBe(0)
    expect(claimRelationshipArcOpacity(0.5)).toBeCloseTo(
      CLAIM_RELATIONSHIP_ARC.maximumOpacity,
      6,
    )

    for (let step = 0; step <= 100; step += 1) {
      const opacity = claimRelationshipArcOpacity(step / 100)

      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(
        CLAIM_RELATIONSHIP_ARC.maximumOpacity,
      )
    }
  })

  it('keeps the reveal pulse restrained and settled at rest', () => {
    expect(claimEmphasisPulse(0)).toBe(0)

    for (let step = 0; step <= 200; step += 1) {
      const pulse = claimEmphasisPulse(step / 20)

      expect(pulse).toBeGreaterThanOrEqual(0)
      expect(pulse).toBeLessThanOrEqual(1)
    }
  })

  it('degrades to zero rather than NaN on a degenerate projection', () => {
    for (const projection of [
      { distance: 0, verticalFovDeg: 42, viewportHeightPx: 900 },
      { distance: 2, verticalFovDeg: 0, viewportHeightPx: 900 },
      { distance: 2, verticalFovDeg: 42, viewportHeightPx: 0 },
      { distance: Number.NaN, verticalFovDeg: 42, viewportHeightPx: 900 },
    ]) {
      expect(pixelsPerWorldUnit(projection)).toBe(0)
      expect(worldSizeForScreenPixels(40, projection)).toBe(0)

      const readout = resolveClaimMarkerReadout(0.02, projection)

      expect(readout.beaconWorldDiameter).toBe(0)
      expect(readout.touchWorldRadius).toBe(0)
    }
  })
})
