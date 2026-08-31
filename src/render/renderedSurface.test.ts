import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { LOCAL_SURFACE_HALF_SIZE_M } from './localSurface.ts'
import { sampleRenderedSurface } from './renderedSurface.ts'
import {
  createSurfaceTerrainProfile,
  localSurfaceToRender,
} from './surfaceTerrain.ts'

const terrain = createSurfaceTerrainProfile(
  createLandingSite(createLunarLocation(0.248, -0.684)),
)

describe('rendered surface sampling', () => {
  it('matches every production grid vertex exactly', () => {
    const segments = 32
    const cellSizeM = (LOCAL_SURFACE_HALF_SIZE_M * 2) / segments

    for (let row = 0; row <= segments; row += 1) {
      for (let column = 0; column <= segments; column += 1) {
        const xM = -LOCAL_SURFACE_HALF_SIZE_M + column * cellSizeM
        const zM = -LOCAL_SURFACE_HALF_SIZE_M + row * cellSizeM

        expect(sampleRenderedSurface(terrain, segments, xM, zM)).toEqual(
          localSurfaceToRender(terrain, xM, zM),
        )
      }
    }
  })

  it('uses the same diagonal split as SurfacePatch', () => {
    const segments = 32
    const cellSizeM = (LOCAL_SURFACE_HALF_SIZE_M * 2) / segments
    const column = 16
    const row = 16
    const x0M = -LOCAL_SURFACE_HALF_SIZE_M + column * cellSizeM
    const z0M = -LOCAL_SURFACE_HALF_SIZE_M + row * cellSizeM
    const topLeft = localSurfaceToRender(terrain, x0M, z0M)
    const topRight = localSurfaceToRender(terrain, x0M + cellSizeM, z0M)
    const bottomLeft = localSurfaceToRender(terrain, x0M, z0M + cellSizeM)
    const bottomRight = localSurfaceToRender(
      terrain,
      x0M + cellSizeM,
      z0M + cellSizeM,
    )
    const first = sampleRenderedSurface(
      terrain,
      segments,
      x0M + cellSizeM * 0.2,
      z0M + cellSizeM * 0.35,
    )
    const second = sampleRenderedSurface(
      terrain,
      segments,
      x0M + cellSizeM * 0.8,
      z0M + cellSizeM * 0.65,
    )

    expect(first.y).toBeCloseTo(
      topLeft.y +
        0.2 * (topRight.y - topLeft.y) +
        0.35 * (bottomLeft.y - topLeft.y),
      12,
    )
    expect(second.y).toBeCloseTo(
      bottomRight.y +
        0.35 * (topRight.y - bottomRight.y) +
        0.2 * (bottomLeft.y - bottomRight.y),
      12,
    )
  })

  it('clamps samples to the rendered patch boundary', () => {
    expect(sampleRenderedSurface(terrain, 96, 999, -999)).toEqual(
      localSurfaceToRender(
        terrain,
        LOCAL_SURFACE_HALF_SIZE_M,
        -LOCAL_SURFACE_HALF_SIZE_M,
      ),
    )
  })
})
