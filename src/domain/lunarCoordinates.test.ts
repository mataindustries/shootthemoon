import { describe, expect, it } from 'vitest'
import {
  HALF_PI,
  MEAN_LUNAR_DATUM,
  createLandingSite,
  createLunarLocation,
  cross,
  dot,
  intersectRayWithSphere,
  localTangentToMcmf,
  lunarLocationToMcmf,
  magnitude,
  mcmfToLocalTangent,
  mcmfToLunarLocation,
  normalizeLongitude,
  tangentBasis,
  type QuaternionData,
  type Vec3,
} from './lunarCoordinates.ts'

const MILLIMETRE = 0.001

function vectorDistance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
}

function rotateByQuaternion(vector: Vec3, quaternion: QuaternionData): Vec3 {
  const qVector = { x: quaternion.x, y: quaternion.y, z: quaternion.z }
  const firstCross = cross(qVector, vector)
  const secondCross = cross(qVector, firstCross)

  return {
    x: vector.x + 2 * (quaternion.w * firstCross.x + secondCross.x),
    y: vector.y + 2 * (quaternion.w * firstCross.y + secondCross.y),
    z: vector.z + 2 * (quaternion.w * firstCross.z + secondCross.z),
  }
}

describe('lunar coordinate validation', () => {
  it('normalizes longitude to [-π, π)', () => {
    expect(normalizeLongitude(Math.PI)).toBeCloseTo(-Math.PI, 14)
    expect(normalizeLongitude(-Math.PI)).toBeCloseTo(-Math.PI, 14)
    expect(normalizeLongitude(5 * Math.PI)).toBeCloseTo(-Math.PI, 14)
    expect(normalizeLongitude(-5 * Math.PI)).toBeCloseTo(-Math.PI, 14)
    expect(normalizeLongitude(0)).toBe(0)
  })

  it('rejects invalid latitude and non-finite values', () => {
    expect(() => createLunarLocation(HALF_PI + 0.01, 0)).toThrow(RangeError)
    expect(() => createLunarLocation(0, Number.NaN)).toThrow(RangeError)
    expect(() => createLunarLocation(0, 0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    )
  })

  it('canonicalizes longitude at both exact poles', () => {
    expect(createLunarLocation(HALF_PI, 1.2).longitudeRad).toBe(0)
    expect(createLunarLocation(-HALF_PI, -2.3).longitudeRad).toBe(0)
  })
})

describe('MCMF conversion', () => {
  it('maps the prime meridian and east-positive quadrants to the documented axes', () => {
    const radius = MEAN_LUNAR_DATUM.referenceRadiusM
    const prime = lunarLocationToMcmf(createLunarLocation(0, 0))
    const east = lunarLocationToMcmf(createLunarLocation(0, Math.PI / 2))
    const north = lunarLocationToMcmf(createLunarLocation(HALF_PI, 0))

    expect(prime.x).toBeCloseTo(radius, 8)
    expect(prime.y).toBeCloseTo(0, 8)
    expect(prime.z).toBeCloseTo(0, 8)
    expect(east.x).toBeCloseTo(0, 8)
    expect(east.z).toBeCloseTo(-radius, 8)
    expect(north.y).toBeCloseTo(radius, 8)
  })

  it('round trips representative and randomized locations within one millimetre', () => {
    let seed = 0x5eed1234
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0
      return seed / 0x1_0000_0000
    }

    const locations = [
      createLunarLocation(0, 0),
      createLunarLocation(0.4, -2.8, 1250),
      createLunarLocation(-1.2, Math.PI - 1e-9, -240),
      createLunarLocation(HALF_PI, 0, 5),
      createLunarLocation(-HALF_PI, 0, 5),
    ]

    for (let index = 0; index < 500; index += 1) {
      locations.push(
        createLunarLocation(
          (random() - 0.5) * (Math.PI - 1e-6),
          (random() - 0.5) * 20 * Math.PI,
          (random() - 0.5) * 20_000,
        ),
      )
    }

    for (const location of locations) {
      const cartesian = lunarLocationToMcmf(location)
      const result = mcmfToLunarLocation(cartesian)
      const reconstructed = lunarLocationToMcmf(result)

      expect(vectorDistance(cartesian, reconstructed)).toBeLessThan(MILLIMETRE)
    }
  })

  it('represents both sides of the longitude seam at the same Cartesian point', () => {
    const westEdge = lunarLocationToMcmf(createLunarLocation(0, -Math.PI))
    const eastEdge = lunarLocationToMcmf(createLunarLocation(0, Math.PI))

    expect(vectorDistance(westEdge, eastEdge)).toBeLessThan(1e-8)
    expect(mcmfToLunarLocation(eastEdge).longitudeRad).toBeCloseTo(-Math.PI, 14)
  })

  it('rejects the MCMF zero vector', () => {
    expect(() => mcmfToLunarLocation({ x: 0, y: 0, z: 0 })).toThrow(RangeError)
  })
})

describe('local tangent transforms', () => {
  it('produces an orthonormal, right-handed east/up/south basis', () => {
    const locations = [
      createLunarLocation(0, 0),
      createLunarLocation(0.75, 1.8),
      createLunarLocation(-1.1, -2.7),
      createLunarLocation(HALF_PI, 0),
    ]

    for (const location of locations) {
      const basis = tangentBasis(location)
      const handedness = cross(basis.east, basis.up)

      expect(magnitude(basis.east)).toBeCloseTo(1, 12)
      expect(magnitude(basis.up)).toBeCloseTo(1, 12)
      expect(magnitude(basis.south)).toBeCloseTo(1, 12)
      expect(dot(basis.east, basis.up)).toBeCloseTo(0, 12)
      expect(dot(basis.east, basis.south)).toBeCloseTo(0, 12)
      expect(dot(basis.up, basis.south)).toBeCloseTo(0, 12)
      expect(vectorDistance(handedness, basis.south)).toBeLessThan(1e-12)
    }
  })

  it('round trips local points up to 20 kilometres from the anchor', () => {
    const anchor = createLunarLocation(0.72, -2.4, 80)
    const localPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 20_000, y: 300, z: -20_000 },
      { x: -12_345, y: -50, z: 9_876 },
    ]

    for (const localPoint of localPoints) {
      const global = localTangentToMcmf(localPoint, anchor)
      const result = mcmfToLocalTangent(global, anchor)

      expect(vectorDistance(localPoint, result)).toBeLessThan(MILLIMETRE)
    }
  })

  it('stores a normalized orientation that maps local up to the surface normal', () => {
    const location = createLunarLocation(0.57, -1.34)
    const site = createLandingSite(location)
    const basis = tangentBasis(location)
    const rotatedUp = rotateByQuaternion(
      { x: 0, y: 1, z: 0 },
      site.orientationMcmf,
    )
    const quaternionLength = Math.hypot(
      site.orientationMcmf.x,
      site.orientationMcmf.y,
      site.orientationMcmf.z,
      site.orientationMcmf.w,
    )

    expect(quaternionLength).toBeCloseTo(1, 12)
    expect(vectorDistance(rotatedUp, basis.up)).toBeLessThan(1e-12)
  })
})

describe('analytic sphere selection', () => {
  it('returns the nearest forward hit through the sphere center', () => {
    const hit = intersectRayWithSphere(
      {
        origin: { x: 0, y: 0, z: 3 },
        direction: { x: 0, y: 0, z: -2 },
      },
      1,
    )

    expect(hit).not.toBeNull()
    expect(hit?.z).toBeCloseTo(1, 12)
  })

  it('handles a tangent hit and rejects a miss', () => {
    const tangent = intersectRayWithSphere(
      {
        origin: { x: 1, y: 2, z: 0 },
        direction: { x: 0, y: -1, z: 0 },
      },
      1,
    )
    const miss = intersectRayWithSphere(
      {
        origin: { x: 2, y: 2, z: 0 },
        direction: { x: 0, y: -1, z: 0 },
      },
      1,
    )

    expect(tangent).not.toBeNull()
    expect(tangent?.x).toBeCloseTo(1, 12)
    expect(tangent?.y).toBeCloseTo(0, 12)
    expect(miss).toBeNull()
  })

  it('rejects a zero-length ray direction', () => {
    expect(() =>
      intersectRayWithSphere(
        {
          origin: { x: 0, y: 0, z: 3 },
          direction: { x: 0, y: 0, z: 0 },
        },
        1,
      ),
    ).toThrow(RangeError)
  })
})

