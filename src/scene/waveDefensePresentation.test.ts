import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { MONUMENT_KINDS } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { authorDrone, authorMonument } from './octagonalModels.ts'
import { sampleMonumentCamera } from './monumentPresentation.ts'
import { defenseApproach, defenseShake } from './waveDefensePresentation.ts'

describe('wave defense framing and safety', () => {
  it('keeps every enemy hull above all monuments and inside both portrait phone frames on every approach', () => {
    const kit = createOctagonalKit()
    const drone = batchOctagonalModel(kit, authorDrone)
    const hull = new Box3()
    for (const batch of drone) {
      batch.geometry.computeBoundingBox()
      hull.union(batch.geometry.boundingBox!)
    }
    let roof = 0
    for (const kind of MONUMENT_KINDS) {
      const batches = batchOctagonalModel(kit, add => authorMonument(kind, add))
      for (const batch of batches) {
        batch.geometry.computeBoundingBox()
        roof = Math.max(roof, batch.geometry.boundingBox!.max.y * .001 + .0007)
        batch.geometry.dispose()
      }
    }
    const object = new Object3D()
    const world = new Matrix4()
    for (const aspect of [390 / 844, 320 / 568]) for (const latitude of [-1.5, .248, 1.5]) {
      const site = createLandingSite(createLunarLocation(latitude, -.684, 18))
      const transform = landingSiteToRenderTransform(site)
      world.compose(transform.position, transform.orientation, new Vector3(1, 1, 1))
      const camera = new PerspectiveCamera(42, aspect, .001, 80)
      const pose = sampleMonumentCamera(site, 0, aspect)
      camera.position.copy(pose.position)
      camera.up.copy(pose.up)
      camera.lookAt(pose.target)
      camera.updateMatrixWorld()
      for (let wave = 0; wave < 3; wave++) for (let ship = 0; ship < 3; ship++) for (let ms = 0; ms <= 3600; ms += 100) {
        object.position.copy(defenseApproach(wave, ms, ship))
        object.rotation.set(0, Math.atan2(OCTOGONALS.waves[wave]!.origin[0], OCTOGONALS.waves[wave]!.origin[2]), (ship - 1) * .12)
        object.scale.setScalar(ship === 1 ? .008 : .0062)
        object.updateMatrix()
        const bounds = hull.clone().applyMatrix4(object.matrix)
        expect(bounds.min.y).toBeGreaterThan(roof)
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new Vector3(x, y, z).applyMatrix4(world).project(camera)
          expect(Math.abs(p.x)).toBeLessThan(.98)
          expect(p.y).toBeLessThan(.96)
          expect(p.y).toBeGreaterThan(.1)
          expect(Math.abs(p.z)).toBeLessThan(1)
        }
      }
    }
    drone.forEach(batch => batch.geometry.dispose())
    disposeOctagonalKit(kit)
  })

  it('the shake is bounded, deterministic, returns to the exact camera pose and respects reduced motion', () => {
    for (let ms = 0; ms <= 2000; ms++) {
      const shake = defenseShake(ms, 600, false)
      expect(Math.abs(shake)).toBeLessThan(.0012)
      expect(shake).toBe(defenseShake(ms, 600, false))
      expect(defenseShake(ms, 600, true)).toBe(0)
      expect(defenseShake(ms, null, false)).toBe(0)
      if (ms <= 600 || ms >= 880) expect(shake).toBe(0)
    }
    expect(defenseShake(700, 3000, false)).toBe(0)
  })
})
