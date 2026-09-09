import { PerspectiveCamera, Vector3 } from 'three'
import { getSurfaceCameraPose } from '../camera/CameraRig.tsx'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { createInitialOutpost, getRobotKinematics, getRobotStateDurationMs } from '../simulation/outpostSimulation.ts'
import { expect, it } from 'vitest'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { MODULE_SOCKETS, LANDER_CLEARANCE_RADIUS_M } from './moduleLayout.ts'
import { MODULE_MODEL_SCALE, SOLAR_PANEL } from './solarWingLayout.ts'

it('keeps the silo volume separate from lander, wing and mining corridors throughout assembly', () => {
  const silo = MODULE_SOCKETS.STORAGE_SILO
  expect(silo.heightM).toBeLessThan(0)
  expect(Math.hypot(silo.xM, silo.zM) - silo.clearanceRadiusM).toBeGreaterThan(LANDER_CLEARANCE_RADIUS_M + 0.5)
  const wing = MODULE_SOCKETS.SOLAR_WING
  expect(Math.hypot(silo.xM - wing.xM, silo.zM - wing.zM)).toBeGreaterThan(silo.clearanceRadiusM + wing.clearanceRadiusM)
  const initial = createInitialOutpost(createLandingSite(createLunarLocation(0.248, -0.684)), 0)
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const radius = 1.32 * MODULE_MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS * (0.15 + t * t * (3 - 2 * t) * 0.85)
    expect(radius).toBeLessThan(silo.clearanceRadiusM)
    for (const deposit of DEPOSIT_BLUEPRINTS) {
      for (const state of ['deploying', 'idle', 'traveling', 'mining', 'returning', 'unloading'] as const) {
        const outpost = { ...initial, robot: { ...initial.robot, state, targetDepositId: deposit.id } }
        const position = getRobotKinematics(outpost, t * (getRobotStateDurationMs(outpost) ?? 1)).position
        expect(Math.hypot(silo.xM - position.xM, silo.zM - position.zM)).toBeGreaterThan(silo.clearanceRadiusM + 1.2)
      }
    }
  }
  expect(MODULE_SOCKETS.SOLAR_WING.clearanceRadiusM).toBeGreaterThan(Math.hypot(SOLAR_PANEL.offsetX + SOLAR_PANEL.width / 2, SOLAR_PANEL.depth / 2) * MODULE_MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS)
})

it.each([[390, 844], [320, 568]])('frames the silo clear of deposit touch discs at %i × %i', (width, height) => {
  const site = createLandingSite(createLunarLocation(0.248, -0.684, 18))
  const terrain = createSurfaceTerrainProfile(site)
  const transform = landingSiteToRenderTransform(site)
  const pose = getSurfaceCameraPose(site, terrain, 112, true)
  const camera = new PerspectiveCamera(54, width / height, 0.0001, 80)
  camera.position.copy(pose.position)
  camera.up.copy(pose.up)
  camera.lookAt(pose.target)
  camera.updateMatrixWorld()
  const project = (point: Vector3) => {
    point.applyQuaternion(transform.orientation).add(transform.position).project(camera)
    return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 }
  }
  const silo = MODULE_SOCKETS.STORAGE_SILO
  const ground = sampleRenderedSurface(terrain, 112, silo.xM, silo.zM)
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
  for (const x of [-1.32, 1.32]) for (const y of [0, 2.45]) for (const z of [-1.32, 1.32]) {
    const point = project(new Vector3(x, y, z).multiplyScalar(MODULE_MODEL_SCALE)
      .applyAxisAngle(new Vector3(0, 1, 0), silo.headingRad)
      .add(new Vector3(ground.x, ground.y + silo.heightM * LOCAL_METRES_TO_RENDER_UNITS, ground.z)))
    bounds.left = Math.min(bounds.left, point.x)
    bounds.right = Math.max(bounds.right, point.x)
    bounds.top = Math.min(bounds.top, point.y)
    bounds.bottom = Math.max(bounds.bottom, point.y)
  }
  expect(bounds.left).toBeGreaterThan(16)
  expect(bounds.right).toBeLessThan(width - 16)
  for (const deposit of DEPOSIT_BLUEPRINTS) {
    const ground = sampleRenderedSurface(terrain, 112, deposit.position.xM, deposit.position.zM)
    const point = project(new Vector3(ground.x, ground.y + 0.7 * LOCAL_METRES_TO_RENDER_UNITS, ground.z))
    const gap = Math.hypot(Math.max(bounds.left - point.x, 0, point.x - bounds.right),
      Math.max(bounds.top - point.y, 0, point.y - bounds.bottom))
    expect(gap).toBeGreaterThan(22)
  }
})
