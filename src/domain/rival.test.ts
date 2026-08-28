import { describe, expect, it } from 'vitest'
import {
  HALF_PI,
  createLandingSite,
  createLunarLocation,
  lunarLocationToMcmf,
} from './lunarCoordinates.ts'
import {
  RIVAL_SITE_ANGULAR_SEPARATION_RAD,
  RIVAL_SITE_MAX_ABS_LATITUDE_RAD,
  RIVAL_SITE_MIN_SEAM_DISTANCE_RAD,
  deriveRivalSite,
  lunarAngularSeparationRad,
} from './rival.ts'

function cartesianDistance(
  left: ReturnType<typeof lunarLocationToMcmf>,
  right: ReturnType<typeof lunarLocationToMcmf>,
): number {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  )
}

function expectSafeRivalSite(playerSite: ReturnType<typeof createLandingSite>) {
  const rival = deriveRivalSite(playerSite)
  const separation = lunarAngularSeparationRad(
    playerSite.location,
    rival.site.location,
  )

  expect(separation).toBeCloseTo(RIVAL_SITE_ANGULAR_SEPARATION_RAD, 12)
  expect(Math.abs(rival.site.location.latitudeRad)).toBeLessThanOrEqual(
    RIVAL_SITE_MAX_ABS_LATITUDE_RAD + 1e-12,
  )
  expect(
    Math.PI - Math.abs(rival.site.location.longitudeRad),
  ).toBeGreaterThanOrEqual(RIVAL_SITE_MIN_SEAM_DISTANCE_RAD - 1e-12)
  expect(rival.site.location.heightM).toBeCloseTo(0, 9)
  expect(rival.surfaceHeadingRad).toBeGreaterThanOrEqual(-Math.PI)
  expect(rival.surfaceHeadingRad).toBeLessThan(Math.PI)

  return rival
}

describe('deterministic rival coordinates', () => {
  it.each([
    [0, 0],
    [0.62, -1.48],
    [-0.81, 2.24],
  ])('places a typical site far away and inside presentation bounds', (latitudeRad, longitudeRad) => {
    expectSafeRivalSite(
      createLandingSite(createLunarLocation(latitudeRad, longitudeRad, 125)),
    )
  })

  it('is continuous across the longitude seam', () => {
    const eastEdge = createLandingSite(
      createLunarLocation(0.37, Math.PI - 1e-10),
    )
    const westEdge = createLandingSite(
      createLunarLocation(0.37, -Math.PI + 1e-10),
    )
    const eastRival = expectSafeRivalSite(eastEdge)
    const westRival = expectSafeRivalSite(westEdge)
    const distanceM = cartesianDistance(
      lunarLocationToMcmf(eastRival.site.location),
      lunarLocationToMcmf(westRival.site.location),
    )

    expect(distanceM).toBeLessThan(0.001)
    expect(eastRival.surfaceHeadingRad).toBeCloseTo(
      westRival.surfaceHeadingRad,
      9,
    )
  })

  it.each([
    [HALF_PI, 2.4],
    [-HALF_PI, -1.7],
    [HALF_PI - 1e-8, Math.PI - 1e-9],
    [-HALF_PI + 1e-8, -Math.PI + 1e-9],
  ])('handles exact and near-polar player sites', (latitudeRad, longitudeRad) => {
    expectSafeRivalSite(
      createLandingSite(createLunarLocation(latitudeRad, longitudeRad)),
    )
  })

  it('returns bit-for-bit repeatable plain serializable domain data', () => {
    const playerSite = createLandingSite(
      createLunarLocation(-0.456789012, 3.012345678, 71.25),
    )
    const first = deriveRivalSite(playerSite)
    const second = deriveRivalSite(playerSite)
    const restored = JSON.parse(JSON.stringify(first)) as typeof first

    expect(second).toEqual(first)
    expect(restored).toEqual(first)
    expect(Object.getPrototypeOf(restored.site.location)).toBe(Object.prototype)
  })

  it('maintains the minimum distance across a representative global grid', () => {
    for (let latitudeDeg = -90; latitudeDeg <= 90; latitudeDeg += 15) {
      for (let longitudeDeg = -180; longitudeDeg < 180; longitudeDeg += 30) {
        const player = createLandingSite(
          createLunarLocation(
            (latitudeDeg * Math.PI) / 180,
            (longitudeDeg * Math.PI) / 180,
          ),
        )
        const rival = deriveRivalSite(player)

        expect(
          lunarAngularSeparationRad(player.location, rival.site.location),
        ).toBeGreaterThanOrEqual((131.999999 * Math.PI) / 180)
      }
    }
  })
})
