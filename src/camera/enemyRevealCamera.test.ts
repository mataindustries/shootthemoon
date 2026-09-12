import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { deriveRivalSite } from '../domain/rival.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { createRivalRevealCameraPlan, createRivalReturnToOrbitCameraPath } from './rivalCameraPlan.ts'

const player = createLandingSite(createLunarLocation(.248, -.684, 18))
const rival = deriveRivalSite(player).site

describe('fixed enemy installation reveal', () => {
  it.each([390 / 844, 844 / 390])('frames the installation independently at aspect %s and returns continuously', (aspect) => {
    const plan = createRivalRevealCameraPlan(player, rival, aspect)
    const camera = new PerspectiveCamera(plan.framing.surfaceFov, aspect, .00001, 4)
    camera.position.copy(plan.rivalSurfacePose.position)
    camera.up.copy(plan.rivalSurfacePose.up)
    camera.lookAt(plan.rivalSurfacePose.target)
    camera.updateMatrixWorld(true)
    const transform = landingSiteToRenderTransform(rival)
    for (const [x, y, z] of [[-.0018, .00042, 0], [.0018, .00042, 0], [0, .0045, 0], [0, .001, -.0018]]) {
      const point = transform.position.clone().addScaledVector(transform.east, x!)
        .addScaledVector(transform.up, y!).addScaledVector(transform.south, z!).project(camera)
      expect(Math.abs(point.x)).toBeLessThan(.85)
      expect(Math.abs(point.y)).toBeLessThan(.85)
      expect(point.z).toBeLessThan(1)
    }
    const returnPath = createRivalReturnToOrbitCameraPath(plan.rivalSurfacePose, plan)
    const position = new Vector3(), target = new Vector3(), up = new Vector3()
    returnPath.sample(0, position, target, up)
    expect(position.distanceTo(plan.rivalSurfacePose.position)).toBeLessThan(1e-12)
    returnPath.sample(1, position, target, up)
    expect(position.distanceTo(plan.dualSitePose.position)).toBeLessThan(1e-12)
    expect(target.distanceTo(plan.dualSitePose.target)).toBeLessThan(1e-12)
    plan.rivalSurfacePose.position.set(50, 50, 50)
    expect(createRivalRevealCameraPlan(player, rival, aspect).rivalSurfacePose.position.length()).toBeLessThan(1.1)
  })
})
