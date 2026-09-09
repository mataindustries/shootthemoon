import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { calculateMiningLaser } from './MinerRobot.tsx'

it.each([96, 112, 128])('connects the laser muzzle to terrain at %i segments, across headings', segments => {
  const terrain = createSurfaceTerrainProfile(createLandingSite(createLunarLocation(0.248, -0.684)))
  for (const heading of [0, 0.83, Math.PI, -1.9]) {
    const { emitter, contact } = calculateMiningLaser(terrain, segments, 6, -9, heading)
    const ground = sampleRenderedSurface(terrain, segments, contact.x / LOCAL_METRES_TO_RENDER_UNITS, contact.z / LOCAL_METRES_TO_RENDER_UNITS)
    expect(contact.y - ground.y).toBeCloseTo(0.015 * LOCAL_METRES_TO_RENDER_UNITS, 10)
    expect(emitter.y).toBeGreaterThan(contact.y)
    expect(emitter.distanceTo(contact) / LOCAL_METRES_TO_RENDER_UNITS).toBeGreaterThan(0.4)
    expect(emitter.distanceTo(contact) / LOCAL_METRES_TO_RENDER_UNITS).toBeLessThan(2)
    for (let i = 0; i <= 10; i++) {
      const beam = new Vector3().lerpVectors(emitter, contact, i / 10)
      const surface = sampleRenderedSurface(terrain, segments, beam.x / LOCAL_METRES_TO_RENDER_UNITS, beam.z / LOCAL_METRES_TO_RENDER_UNITS)
      expect(beam.y).toBeGreaterThan(surface.y)
    }
  }
})
