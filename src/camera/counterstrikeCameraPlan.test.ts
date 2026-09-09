import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { deriveSecondaryImpactSite } from '../domain/counterstrike.ts'
import { createInitialOutpost } from '../simulation/outpostSimulation.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import { landingSiteToLocalSurfaceRenderPoint, landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import { createInterceptorRoute } from './counterstrikeRoute.ts'
import { COUNTERSTRIKE_INTERCEPTION_HOLD_MS, sampleCounterstrikeInterceptionCamera, createCounterstrikeCameraPlan, sampleCounterstrikeImpactCamera, COUNTERSTRIKE_IMPACT_CAMERA_TIMING } from './counterstrikeCameraPlan.ts'
import type { CameraPose } from './orbitalCameraPath.ts'

function cameraFor(pose: CameraPose, aspect: number, fov: number) {
  const camera = new PerspectiveCamera(fov, aspect, 0.00018, 80)
  camera.position.copy(pose.position)
  camera.up.copy(pose.up)
  camera.lookAt(pose.target)
  camera.updateMatrixWorld()
  return camera
}

function expectInFrame(point: Vector3, camera: PerspectiveCamera) {
  const screen = point.clone().project(camera)
  expect(Math.abs(screen.x)).toBeLessThan(0.85)
  expect(Math.abs(screen.y)).toBeLessThan(0.8)
  expect(screen.z).toBeGreaterThan(-1)
  expect(screen.z).toBeLessThan(1)
}

const sites = [[0.248, -0.684], [Math.PI / 2, 0], [-Math.PI / 2, 0], [0, Math.PI - 1e-7]]

describe.each([320 / 568, 390 / 844, 844 / 390])('Counterstrike composition at aspect %f', (aspect) => {
  it.each(sites)('frames launch and direct contact at site %f, %f', (lat, lon) => {
    const player = createLandingSite(createLunarLocation(lat!, lon!))
    const rival = createLandingSite(createLunarLocation(-0.61, 2.08))
    const impact = deriveSecondaryImpactSite(createInitialOutpost(player, 0))
    const plan = createCounterstrikeCameraPlan(player, rival, impact, aspect)
    const launchCamera = cameraFor(plan.launchPose, aspect, aspect < 0.72 ? 56 : 40)
    for (let index = 0; index <= 20; index++) {
      const vehicle = plan.route.getRenderPoint(index * 0.08 / 20)
      expectInFrame(vehicle, launchCamera)
      const progress = index * 0.08 / 20
      const direction = plan.route.getRenderPoint(progress + 0.002)
        .sub(plan.route.getRenderPoint(Math.max(0, progress - 0.002))).normalize()
      const nose = vehicle.clone().addScaledVector(direction, 0.032).project(launchCamera)
      const tail = vehicle.clone().addScaledVector(direction, -0.019).project(launchCamera)
      // Keep the vehicle side-on and large enough to read, not an end-on dot.
      expect(Math.hypot((nose.x - tail.x) * aspect, nose.y - tail.y)).toBeGreaterThan(0.12)
      // The near-side lunar surface must not occlude the launch vehicle.
      const ray = vehicle.clone().sub(plan.launchPose.position)
      const closest = plan.launchPose.position.clone().addScaledVector(ray,
        Math.max(0, Math.min(1, -plan.launchPose.position.dot(ray) / ray.lengthSq())))
      expect(closest.length()).toBeGreaterThan(1)
    }
    const local = landingSiteToRenderTransform(player)
    const target = landingSiteToLocalSurfaceRenderPoint(player, impact)
      .addScaledVector(local.up, LOCAL_SURFACE_RENDER_OFFSET)
    const offset = target.clone().sub(landingSiteToRenderTransform(impact).position)
    const pose = { position: new Vector3(), target: new Vector3(), up: new Vector3() }
    for (let index = 0; index <= 40; index++) {
      const progress = index / 100
      sampleCounterstrikeImpactCamera(plan, progress, pose.position, pose.target, pose.up)
      expect(pose.position.toArray()).toEqual(plan.impactWidePose.position.toArray())
      expect(pose.target.toArray()).toEqual(plan.impactWidePose.target.toArray())
      const camera = cameraFor(pose, aspect, aspect < 0.72 ? 51 : 41)
      const vehicle = plan.route.getTerminalRenderPoint(0.9 + progress / 0.4 * 0.1).add(offset)
      expectInFrame(vehicle, camera)
      // Include the missile silhouette and the structures, not only their centers.
      expectInFrame(vehicle.clone().addScaledVector(local.up, 0.0008), camera)
      expectInFrame(target, camera)
      expectInFrame(local.position.clone().addScaledVector(local.up, 0.002), camera)
    }
    const timing = COUNTERSTRIKE_IMPACT_CAMERA_TIMING
    expect((timing.mediumHoldEndProgress - timing.contactProgress) * COUNTERSTRIKE_TIMING.impactMs).toBeGreaterThanOrEqual(750)
    sampleCounterstrikeImpactCamera(plan, timing.mediumHoldEndProgress - 0.001, pose.position, pose.target, pose.up)
    expect(pose.position.toArray()).toEqual(plan.impactWidePose.position.toArray())
    expect(plan.damagePose.position.distanceTo(plan.damagePose.target)).toBeGreaterThan(plan.impactWidePose.position.distanceTo(plan.impactWidePose.target))
    expect(plan.damagePose.target.toArray()).toEqual(plan.impactWidePose.target.toArray())
  })
})


describe.each([320 / 568, 390 / 844, 844 / 390])('direct interception framing at %f', aspect => {
  it.each(sites)('holds both vehicles and outpost at site %f, %f', (lat, lon) => {
    const player = createLandingSite(createLunarLocation(lat!, lon!))
    const rival = createLandingSite(createLunarLocation(-0.61, 2.08))
    const impact = deriveSecondaryImpactSite(createInitialOutpost(player, 0))
    for (const endpoint of [0.445, 0.58, 0.66, 0.825, 0.94]) {
      const plan = createCounterstrikeCameraPlan(player, rival, impact, aspect, endpoint)
      const interceptor = createInterceptorRoute(player, plan.route, endpoint)
      const pose = { position: new Vector3(), target: new Vector3(), up: new Vector3() }
      for (let index = 0; index <= 100; index++) {
        const progress = index / 100
        sampleCounterstrikeInterceptionCamera(plan, 'interceptor-launched', progress, pose.position, pose.target, pose.up)
        const camera = cameraFor(pose, aspect, aspect < 0.72 ? 56 : 40)
        const vehicles = [interceptor.getRenderPoint(progress * progress * (3 - 2 * progress)),
          plan.route.getRenderPoint(endpoint - 0.07 + progress * 0.07)]
        for (const point of [...vehicles, landingSiteToRenderTransform(player).position]) {
          expectInFrame(point, camera)
          const ray = point.clone().sub(pose.position)
          const nearest = pose.position.clone().addScaledVector(ray,
            Math.max(0, Math.min(1, -pose.position.dot(ray) / ray.lengthSq())))
          expect(nearest.length()).toBeGreaterThanOrEqual(1 - 1e-7)
        }
        // Both orbital silhouettes have several visible pixels even on 320px phones.
        const screenSize = 0.025 / (camera.position.distanceTo(vehicles[0]!) * Math.tan(camera.fov * Math.PI / 360)) * 568 / 2
        expect(screenSize).toBeGreaterThan(4)
      }
      const hold = COUNTERSTRIKE_INTERCEPTION_HOLD_MS / COUNTERSTRIKE_TIMING.successMs
      for (const progress of [0, hold / 2, hold]) {
        expect(sampleCounterstrikeInterceptionCamera(plan, 'success', progress, pose.position, pose.target, pose.up)).toBe('interception-hold')
        expect(pose.position.toArray()).toEqual(plan.interceptPose.position.toArray())
        expectInFrame(plan.route.getRenderPoint(endpoint), cameraFor(pose, aspect, aspect < 0.72 ? 56 : 40))
      }
      expect(sampleCounterstrikeInterceptionCamera(plan, 'success', hold + 0.1, pose.position, pose.target, pose.up)).toBe('interception-pullback')
      expect(pose.position.distanceTo(pose.target)).toBeGreaterThan(plan.interceptPose.position.distanceTo(plan.interceptPose.target))
    }
  })
})
