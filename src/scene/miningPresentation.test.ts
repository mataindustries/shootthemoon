import { describe, expect, it } from 'vitest'
import { createMiningKit, disposeMiningKit } from '../render/miningKit.ts'
import { createLunarCrystal, createMiningRobotModels, createOreCluster, createRepairCradle } from './miningModels.ts'
import { MODULE_SOCKETS } from './moduleLayout.ts'
import { MODULE_MODEL_SCALE } from './solarWingLayout.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'

describe('mining asset placement and rendering limits', () => {
  it('closes every crystal face so the irregular seam cannot expose an empty interior', () => {
    const crystal = createLunarCrystal()
    const positions = crystal.getAttribute('position')
    const edges = new Map<string, number>()
    for (let i = 0; i < positions.count; i += 3) {
      const vertices = [i, i + 1, i + 2].map(index => [positions.getX(index), positions.getY(index), positions.getZ(index)].join(','))
      for (let j = 0; j < 3; j++) {
        const key = [vertices[j], vertices[(j + 1) % 3]].sort().join(':')
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true)
    crystal.dispose()
  })

  it('bounds ore, tools and cradle geometry while retaining complete surface attributes', () => {
    const kit = createMiningKit()
    const ore = createOreCluster(kit)
    const robot = createMiningRobotModels(kit)
    const cradle = createRepairCradle(kit)
    const geometries = [ore, ...Object.values(robot), ...Object.values(cradle)]
    for (const geometry of geometries) {
      const count = geometry.getAttribute('position').count
      expect(count).toBeLessThan(4000)
      expect(geometry.getAttribute('miningFinish').count).toBe(count)
      expect(geometry.getAttribute('color').count).toBe(count)
      expect(geometry.getAttribute('uv').count).toBe(count)
      expect(geometry.groups).toHaveLength(0)
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    }
    ore.computeBoundingBox()
    expect(ore.boundingBox!.max.y).toBeGreaterThan(1.5)
    expect(ore.boundingBox!.max.x - ore.boundingBox!.min.x).toBeGreaterThan(1.3)
    const scaleM = MODULE_MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS
    const vertices = cradle.frame.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) {
      expect(Math.hypot(vertices.getX(i), vertices.getZ(i)) * scaleM).toBeLessThan(MODULE_SOCKETS.REPAIR_GANTRY.clearanceRadiusM)
    }
    geometries.forEach(geometry => geometry.dispose())
    disposeMiningKit(kit)
  })
})
