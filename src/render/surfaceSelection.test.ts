import { describe, expect, it } from 'vitest'
import { selectLandingSiteFromOrbitalRay } from './surfaceSelection.ts'

describe('orbital render ray selection adapter', () => {
  it('converts a render-space hit into a canonical site without retaining the hit', () => {
    const site = selectLandingSiteFromOrbitalRay(
      {
        origin: { x: 0, y: 0, z: 4 },
        direction: { x: 0, y: 0, z: -1 },
      },
      1,
    )

    expect(site).not.toBeNull()
    expect(site?.location.latitudeRad).toBeCloseTo(0, 12)
    expect(site?.location.longitudeRad).toBeCloseTo(-Math.PI / 2, 12)
    expect(site?.location.heightM).toBeCloseTo(0, 6)
    expect(site).not.toHaveProperty('point')
  })

  it('is invariant under orbital render scale', () => {
    const first = selectLandingSiteFromOrbitalRay(
      {
        origin: { x: 0.5, y: 0.25, z: 4 },
        direction: { x: -0.1, y: -0.04, z: -1 },
      },
      1,
    )
    const second = selectLandingSiteFromOrbitalRay(
      {
        origin: { x: 5, y: 2.5, z: 40 },
        direction: { x: -0.1, y: -0.04, z: -1 },
      },
      10,
    )

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.location.latitudeRad).toBeCloseTo(
      second?.location.latitudeRad ?? 0,
      12,
    )
    expect(first?.location.longitudeRad).toBeCloseTo(
      second?.location.longitudeRad ?? 0,
      12,
    )
  })

  it('returns null when the render ray misses', () => {
    expect(
      selectLandingSiteFromOrbitalRay(
        {
          origin: { x: 3, y: 3, z: 4 },
          direction: { x: 0, y: 0, z: -1 },
        },
        1,
      ),
    ).toBeNull()
  })
})

