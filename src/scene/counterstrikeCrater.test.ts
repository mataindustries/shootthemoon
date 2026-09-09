import { expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { createCounterstrikeCraterGeometry } from './CounterstrikeDamage.tsx'

it('keeps the bowl above rendered terrain and its broken rim above the floor', () => {
  const terrain = createSurfaceTerrainProfile(createLandingSite(createLunarLocation(0.248, -0.684)))
  const offset = { xM: -17, zM: -12 }
  const center = sampleRenderedSurface(terrain, 112, offset.xM, offset.zM)
  const geometry = createCounterstrikeCraterGeometry(terrain, 112, offset)
  const positions = geometry.getAttribute('position')
  const heights: number[] = []
  for (let i = 0; i < positions.count; i++) {
    const x = offset.xM + positions.getX(i) * 0.78
    const z = offset.zM + positions.getZ(i) * 0.78
    const surface = sampleRenderedSurface(terrain, 112, x, z)
    const height = (center.y + positions.getY(i) * 0.78 * LOCAL_METRES_TO_RENDER_UNITS - surface.y) / LOCAL_METRES_TO_RENDER_UNITS
    expect(height).toBeGreaterThan(0)
    heights.push(height)
  }
  expect(Math.max(...heights) - heights[0]!).toBeGreaterThan(1)
  expect(new Set(heights.map(y => y.toFixed(2))).size).toBeGreaterThan(12)
  geometry.dispose()
})
