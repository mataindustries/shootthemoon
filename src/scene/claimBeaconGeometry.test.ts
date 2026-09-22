import { describe, expect, it } from 'vitest'
import {
  CLAIM_BEACON_LAYOUT,
  createClaimBeaconGeometry,
} from './claimBeaconGeometry.ts'

function readPoints(glyph: 'block' | 'spear'): { x: number; y: number }[] {
  const geometry = createClaimBeaconGeometry(glyph)
  const position = geometry.getAttribute('position')
  const points: { x: number; y: number }[] = []

  for (let index = 0; index < position.count; index += 1) {
    points.push({ x: position.getX(index), y: position.getY(index) })
    expect(position.getZ(index)).toBe(0)
  }

  geometry.dispose()
  return points
}

describe('claim beacon geometry', () => {
  it('keeps the ring exactly one unit across so scale means screen diameter', () => {
    const radii = readPoints('block').map((point) =>
      Math.hypot(point.x, point.y),
    )

    expect(Math.max(...radii.filter((radius) => radius <= 0.51))).toBeCloseTo(
      CLAIM_BEACON_LAYOUT.ringOuterRadius,
      5,
    )
    expect(CLAIM_BEACON_LAYOUT.ringOuterRadius * 2).toBe(1)
  })

  it('leaves the authored bracket gaps at screen top and bottom', () => {
    const ringPoints = readPoints('block').filter((point) => {
      const radius = Math.hypot(point.x, point.y)
      return radius >= CLAIM_BEACON_LAYOUT.ringInnerRadius - 1e-6 && radius <= 0.51
    })

    expect(ringPoints.length).toBeGreaterThan(0)

    for (const point of ringPoints) {
      const angle = Math.atan2(point.y, point.x)

      expect(Math.abs(angle - Math.PI / 2)).toBeGreaterThanOrEqual(
        CLAIM_BEACON_LAYOUT.ringGapRad - 1e-6,
      )
      expect(Math.abs(angle + Math.PI / 2)).toBeGreaterThanOrEqual(
        CLAIM_BEACON_LAYOUT.ringGapRad - 1e-6,
      )
    }
  })

  it('carries a compact leader that rises clear of the ring', () => {
    const points = readPoints('block')
    const highest = Math.max(...points.map((point) => point.y))

    expect(CLAIM_BEACON_LAYOUT.leaderTipY).toBeGreaterThan(
      CLAIM_BEACON_LAYOUT.ringOuterRadius,
    )
    expect(CLAIM_BEACON_LAYOUT.leaderHalfWidth * 2).toBeLessThan(
      CLAIM_BEACON_LAYOUT.ringOuterRadius * 0.1,
    )
    expect(highest).toBeGreaterThan(CLAIM_BEACON_LAYOUT.leaderTipY)
    // A marker, not a billboard: the whole mark stays close to the claim.
    expect(highest).toBeLessThan(1.1)
  })

  it('distinguishes the two factions by glyph as well as colour', () => {
    const block = readPoints('block')
    const spear = readPoints('spear')

    expect(block.length).not.toBe(spear.length)
    expect(Math.max(...spear.map((point) => point.y))).toBeCloseTo(
      CLAIM_BEACON_LAYOUT.glyphTipY,
      5,
    )
    expect(Math.max(...block.map((point) => point.y))).toBeLessThan(
      Math.max(...spear.map((point) => point.y)),
    )
  })

  it('stays a single cheap draw call worth of geometry', () => {
    for (const glyph of ['block', 'spear'] as const) {
      const geometry = createClaimBeaconGeometry(glyph)
      const index = geometry.getIndex()

      expect(index).not.toBeNull()
      expect(index!.count / 3).toBeLessThanOrEqual(120)
      expect(geometry.boundingSphere?.radius ?? 0).toBeLessThan(1.2)
      geometry.dispose()
    }
  })
})
