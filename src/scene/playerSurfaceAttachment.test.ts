import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { calculateExtractorGrounding } from './Extractor.tsx'
import { calculateMinerGrounding } from './MinerRobot.tsx'

const site = createLandingSite(createLunarLocation(0.248, -0.684))
const terrain = createSurfaceTerrainProfile(site)

describe('player rendered-surface attachments', () => {
  it.each([96, 112, 128])(
    'holds all six heading-rotated rover wheels to the %i-segment mesh',
    (segments) => {
      const grounding = calculateMinerGrounding(
        terrain,
        segments,
        -8.4,
        -5.7,
        0.83,
      )

      expect(grounding.wheelContacts).toHaveLength(6)
      expect(grounding.wheelOffsetsModel).toHaveLength(6)
      expect(Math.max(...grounding.wheelOffsetsModel.map(Math.abs))).toBeLessThan(
        0.12,
      )

      for (const contact of grounding.wheelContacts) {
        expect(contact.wheelBottomY).toBeCloseTo(
          contact.surfaceY - 0.006 * LOCAL_METRES_TO_RENDER_UNITS,
          10,
        )
      }
    },
  )

  it.each([
    { xM: -10.5, zM: -8.5, orientationRad: -0.42 },
    { xM: 11.8, zM: -10.4, orientationRad: 0.76 },
    { xM: 3.2, zM: 4.3, orientationRad: Math.PI },
  ])(
    'telescopes every rotated extractor pad at $xM, $zM',
    ({ xM, zM, orientationRad }) => {
      const grounding = calculateExtractorGrounding(
        terrain,
        112,
        xM,
        zM,
        orientationRad,
      )

      expect(grounding.padOffsetsModel).toHaveLength(4)
      expect(grounding.padSurfaceHeights).toHaveLength(4)

      grounding.padSurfaceHeights.forEach((surfaceY, index) => {
        const padBottomY =
          grounding.position.y +
          (-0.04 + (grounding.padOffsetsModel[index] ?? 0)) *
            LOCAL_METRES_TO_RENDER_UNITS

        expect(padBottomY).toBeCloseTo(
          surfaceY - 0.008 * LOCAL_METRES_TO_RENDER_UNITS,
          12,
        )
      })
    },
  )
})
