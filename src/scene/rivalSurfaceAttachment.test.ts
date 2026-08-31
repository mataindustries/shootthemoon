import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import {
  createSurfaceTerrainProfile,
  localSurfaceToRender,
} from '../render/surfaceTerrain.ts'
import {
  RIVAL_FOUNDATION_CLEARANCE_M,
  calculateRivalGrounding,
  createRivalSurfaceAttachment,
  getRivalStageVisualProfile,
} from './RivalFoothold.tsx'
import { sampleVesperSignalPulse } from './RivalSignal.tsx'
import {
  PERMANENT_SCAR_CLEARANCE,
  PERMANENT_SCAR_FLOOR_HEIGHT,
  calculatePermanentScarFloorHeight,
  createCraterGeometry,
  createEjectaGeometry,
  lunarSphereTangentHeight,
} from './PermanentLunarScar.tsx'

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
      const terrain = createSurfaceTerrainProfile(site)
      const segments = 32
      const renderTransform = landingSiteToRenderTransform(site)
      const grounding = calculateRivalGrounding(terrain, segments)
      const attachment = createRivalSurfaceAttachment(
        site,
        terrain,
        segments,
      )
      const expectedPosition = renderTransform.position
        .clone()
        .addScaledVector(renderTransform.up, grounding.attachmentHeight)
      const attachedUp = new Vector3(0, 1, 0)
        .applyQuaternion(attachment.orientation)
        .normalize()

      expect(
        attachment.position.distanceTo(expectedPosition),
      ).toBeLessThan(1e-12)
      expect(attachedUp.distanceTo(renderTransform.up)).toBeLessThan(1e-10)
      expect(attachment.up.distanceTo(renderTransform.up)).toBeLessThan(1e-12)
      expect(
        attachment.position.length() - renderTransform.position.length(),
      ).toBeCloseTo(grounding.attachmentHeight, 10)
    },
  )

  it('is deterministic and does not mutate the canonical render transform', () => {
    const site = createLandingSite(createLunarLocation(-0.3, 1.1, 125))
    const terrain = createSurfaceTerrainProfile(site)
    const before = landingSiteToRenderTransform(site)
    const first = createRivalSurfaceAttachment(site, terrain, 32)
    const second = createRivalSurfaceAttachment(site, terrain, 32)
    const after = landingSiteToRenderTransform(site)

    expect(first.position.toArray()).toEqual(second.position.toArray())
    expect(first.orientation.toArray()).toEqual(second.orientation.toArray())
    expect(before.position.toArray()).toEqual(after.position.toArray())
    expect(before.orientation.toArray()).toEqual(after.orientation.toArray())
  })

  it('clears the actual rendered foundation footprint rather than the mean sphere', () => {
    const site = createLandingSite(createLunarLocation(0.27, -2.13))
    const terrain = createSurfaceTerrainProfile(site)
    const surfaceCenter = localSurfaceToRender(terrain, 0, 0)
    const grounding = calculateRivalGrounding(terrain, 32)
    const attachment = createRivalSurfaceAttachment(site, terrain, 32)
    const transform = landingSiteToRenderTransform(site)
    const attachmentHeight = attachment.position
      .clone()
      .sub(transform.position)
      .dot(transform.up)
    const foundationClearance =
      attachmentHeight +
      grounding.foundationBottomOffset -
      grounding.maximumSurfaceHeight

    expect(surfaceCenter.y).toBeCloseTo(0.00042, 12)
    expect(attachmentHeight).toBeCloseTo(grounding.attachmentHeight, 12)
    expect(foundationClearance).toBeCloseTo(
      RIVAL_FOUNDATION_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS,
      12,
    )
  })

  it('replaces the raised terrain with a depressed, sphere-conformal scar', () => {
    const site = createLandingSite(createLunarLocation(-0.61, 2.08))
    const terrain = createSurfaceTerrainProfile(site)
    const surfaceCenter = localSurfaceToRender(terrain, 0, 0)
    const floorHeight = calculatePermanentScarFloorHeight(surfaceCenter.y)
    const crater = createCraterGeometry(0x51a7c4a3, floorHeight)
    const positions = crater.getAttribute('position')
    let maximumLift = Number.NEGATIVE_INFINITY

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const z = positions.getZ(index)
      const lift = y - lunarSphereTangentHeight(x, z)
      maximumLift = Math.max(maximumLift, lift)
      expect(lift).toBeGreaterThanOrEqual(PERMANENT_SCAR_CLEARANCE - 1e-8)
    }

    expect(floorHeight).toBeLessThan(surfaceCenter.y - 0.0003)
    expect(floorHeight).toBeCloseTo(PERMANENT_SCAR_FLOOR_HEIGHT, 12)
    expect(maximumLift).toBeGreaterThan(PERMANENT_SCAR_FLOOR_HEIGHT + 0.001)
    crater.dispose()
  })

  it('projects the permanent ejecta field onto the Moon instead of a tangent plate', () => {
    const ejecta = createEjectaGeometry(0x51a7c4a3)
    const positions = ejecta.getAttribute('position')

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const z = positions.getZ(index)
      const lift = y - lunarSphereTangentHeight(x, z)

      expect(lift).toBeGreaterThanOrEqual(PERMANENT_SCAR_CLEARANCE - 1e-8)
      expect(lift).toBeLessThan(0.0001)
    }

    ejecta.dispose()
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
