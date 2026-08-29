import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createLandingSite,
  createLunarLocation,
  normalizeLongitude,
  surfaceUnitVector,
} from '../domain/lunarCoordinates.ts'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { sampleMinimumCameraRadius } from './orbitalCameraPath.ts'
import {
  STRIKE_CAMERA_SAFETY,
  createStrikeCameraPlan,
} from './strikeCameraPlan.ts'
import {
  STRIKE_ROUTE_SAFETY,
  createStrikeRoute,
  sampleMinimumStrikeClearanceM,
} from './strikeRoute.ts'

function site(latitudeRad: number, longitudeRad: number) {
  return createLandingSite(
    createLunarLocation(latitudeRad, normalizeLongitude(longitudeRad), 0),
  )
}

const ROUTE_CASES = [
  {
    name: 'longitude seam',
    player: site(0.24, Math.PI - 1e-7),
    rival: site(-0.36, -Math.PI + 1e-7),
  },
  {
    name: 'north polar origin',
    player: site(Math.PI / 2, 1.9),
    rival: site(-0.42, -1.2),
  },
  {
    name: 'south polar target',
    player: site(0.51, 2.72),
    rival: site(-Math.PI / 2, -2.4),
  },
  {
    name: 'near antipodes',
    player: site(0.18, 0.42),
    rival: site(-0.18 + 1e-7, 0.42 + Math.PI - 1e-7),
  },
  {
    name: 'exact antipodes',
    player: site(0, 0),
    rival: site(0, Math.PI),
  },
] as const

describe('deterministic First Strike route', () => {
  it.each(ROUTE_CASES)(
    'stays outside the Moon for $name coordinates',
    ({ player, rival }) => {
      const route = createStrikeRoute(player, rival)
      const minimumClearance = sampleMinimumStrikeClearanceM(
        route,
        STRIKE_ROUTE_SAFETY.sampleCount,
      )
      const expectedStart = surfaceUnitVector(player.location)
      const expectedEnd = surfaceUnitVector(rival.location)
      const start = route.getDirection(0)
      const end = route.getDirection(1)

      expect(minimumClearance).toBeGreaterThanOrEqual(
        STRIKE_ROUTE_SAFETY.minimumClearanceM - 1e-6,
      )
      expect(start.distanceTo(new Vector3(
        expectedStart.x,
        expectedStart.y,
        expectedStart.z,
      ))).toBeLessThan(1e-12)
      expect(end.distanceTo(new Vector3(
        expectedEnd.x,
        expectedEnd.y,
        expectedEnd.z,
      ))).toBeLessThan(1e-12)
      expect(route.getCanonicalPoint(0.5).length()).toBeGreaterThan(
        STRIKE_ROUTE_SAFETY.moonRadiusM +
          STRIKE_ROUTE_SAFETY.minimumPeakClearanceM -
          1e-6,
      )
    },
  )

  it('produces bit-for-bit repeatable samples from canonical sites', () => {
    const player = site(0.248, -0.684)
    const rival = site(-0.412, 2.26)
    const first = createStrikeRoute(player, rival)
    const second = createStrikeRoute(player, rival)

    for (let index = 0; index <= 128; index += 1) {
      const progress = index / 128
      expect(first.getCanonicalPoint(progress).toArray()).toEqual(
        second.getCanonicalPoint(progress).toArray(),
      )
    }
    expect(first.angularSeparationRad).toBe(second.angularSeparationRad)
    expect(first.peakClearanceM).toBe(second.peakClearanceM)
  })

  it.each([390 / 844, 844 / 390])(
    'keeps every strike camera cut radially safe at aspect %f',
    (aspect) => {
      const player = site(0.248, -0.684)
      const rival = site(-0.61, 2.08)
      const plan = createStrikeCameraPlan(player, rival, aspect)

      expect(sampleMinimumCameraRadius(
        plan.flightCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.surfaceMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.transmissionCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.flightMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.targetApproachCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.approachMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.orbitalPullbackCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.approachMinimumRadius - 1e-9,
      )
      expect(plan.finalOrbitPose.position.length()).toBeGreaterThan(
        MOON_RENDER_RADIUS + 2,
      )
    },
  )
})
