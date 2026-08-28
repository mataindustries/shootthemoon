import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  RIVAL_SURFACE_CLEARANCE,
  createRivalSurfaceAttachment,
  getRivalStageVisualProfile,
} from './RivalFoothold.tsx'
import { sampleVesperSignalPulse } from './RivalSignal.tsx'

describe('rival surface attachment', () => {
  it.each([
    { latitudeRad: 0.21, longitudeRad: 0.72 },
    { latitudeRad: -0.34, longitudeRad: Math.PI - 1e-7 },
    { latitudeRad: 1.47, longitudeRad: -1.8 },
    { latitudeRad: -1.47, longitudeRad: 2.2 },
  ])(
    'keeps a tangent foothold attached at $latitudeRad, $longitudeRad',
    ({ latitudeRad, longitudeRad }) => {
      const site = createLandingSite(
        createLunarLocation(latitudeRad, longitudeRad),
      )
      const renderTransform = landingSiteToRenderTransform(site)
      const attachment = createRivalSurfaceAttachment(site)
      const expectedPosition = renderTransform.position
        .clone()
        .addScaledVector(renderTransform.up, RIVAL_SURFACE_CLEARANCE)
      const attachedUp = new Vector3(0, 1, 0)
        .applyQuaternion(attachment.orientation)
        .normalize()

      expect(attachment.position.distanceTo(expectedPosition)).toBeLessThan(1e-12)
      expect(attachedUp.distanceTo(renderTransform.up)).toBeLessThan(1e-10)
      expect(attachment.up.distanceTo(renderTransform.up)).toBeLessThan(1e-12)
      expect(
        attachment.position.length() - renderTransform.position.length(),
      ).toBeCloseTo(RIVAL_SURFACE_CLEARANCE, 10)
    },
  )

  it('is deterministic and does not mutate the canonical render transform', () => {
    const site = createLandingSite(createLunarLocation(-0.3, 1.1, 125))
    const before = landingSiteToRenderTransform(site)
    const first = createRivalSurfaceAttachment(site)
    const second = createRivalSurfaceAttachment(site)
    const after = landingSiteToRenderTransform(site)

    expect(first.position.toArray()).toEqual(second.position.toArray())
    expect(first.orientation.toArray()).toEqual(second.orientation.toArray())
    expect(before.position.toArray()).toEqual(after.position.toArray())
    expect(before.orientation.toArray()).toEqual(after.orientation.toArray())
  })

  it('gives every rival stage a distinct, monotonic silhouette', () => {
    const landed = getRivalStageVisualProfile('LANDED')
    const establishing = getRivalStageVisualProfile('ESTABLISHING')
    const fortified = getRivalStageVisualProfile('FORTIFIED')

    expect(landed).toEqual({
      pylonCount: 0,
      lightCount: 2,
      buttressCount: 0,
      mastHeightM: 4.8,
    })
    expect(establishing.pylonCount).toBeGreaterThan(landed.pylonCount)
    expect(establishing.lightCount).toBeGreaterThan(landed.lightCount)
    expect(establishing.mastHeightM).toBeGreaterThan(landed.mastHeightM)
    expect(fortified.pylonCount).toBeGreaterThan(establishing.pylonCount)
    expect(fortified.lightCount).toBeGreaterThan(establishing.lightCount)
    expect(fortified.buttressCount).toBeGreaterThan(establishing.buttressCount)
    expect(fortified.mastHeightM).toBeGreaterThan(establishing.mastHeightM)
    expect(getRivalStageVisualProfile(null)).toBe(landed)
  })

  it('samples two crisp beacon beats followed by an idle gap', () => {
    expect(sampleVesperSignalPulse(55)).toBeCloseTo(1, 8)
    expect(sampleVesperSignalPulse(335)).toBeCloseTo(1, 8)
    expect(sampleVesperSignalPulse(190)).toBe(0)
    expect(sampleVesperSignalPulse(1_000)).toBe(0)
    expect(sampleVesperSignalPulse(1_855)).toBeCloseTo(
      sampleVesperSignalPulse(55),
      8,
    )
  })
})
