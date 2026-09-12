import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { baseDetailsVisible, octogonalApproach, sampleMonumentCamera } from './monumentPresentation.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { PerspectiveCamera, Vector3 } from 'three'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

describe('Territory Monument orbital presentation', () => {
  it('hides base geometry at orbital altitude while retaining surface detail below the cutoff', () => {
    expect(baseDetailsVisible(1.01)).toBe(true)
    expect(baseDetailsVisible(1.18)).toBe(false)
    expect(baseDetailsVisible(4.7)).toBe(false)
  })
  it('three deterministic approach lanes converge without crossing the lunar surface', () => {
    expect(new Set(OCTOGONALS.waves.map(w => w.approach)).size).toBe(3)
    for (let wave = 0; wave < 3; wave++) {
      for (let i = 0; i <= 100; i++) {
        const point = octogonalApproach(wave, i / 100, 1)
        expect(point.y).toBeGreaterThanOrEqual(.035)
        expect(point).toEqual(octogonalApproach(wave, i / 100, 1))
      }
      expect(octogonalApproach(wave, 1, 1).toArray()).toEqual([0, .035, 0])
    }
  })
  it('portrait and landscape reveal pulls back safely, keeps the claim centered and ends above base detail altitude', () => {
    for (const lat of [-1.5, 0, .248, 1.5]) for (const aspect of [390 / 844, 16 / 9]) {
      const site = createLandingSite(createLunarLocation(lat, -.684, 18))
      let radius = 0
      for (let i = 0; i <= 100; i++) {
        const pose = sampleMonumentCamera(site, i / 100, aspect)
        expect(pose.position.length()).toBeGreaterThan(1.1)
        expect(pose.position.length()).toBeGreaterThanOrEqual(radius - 1e-10)
        expect(pose.position.dot(pose.target)).toBeGreaterThan(1)
        radius = pose.position.length()
      }
      expect(baseDetailsVisible(radius)).toBe(false)
    }
  })
  it('frames the entire Spire and all three Octogonal approaches on a portrait phone', () => {
    const site = createLandingSite(createLunarLocation(.248, -.684, 18))
    const transform = landingSiteToRenderTransform(site)
    const camera = new PerspectiveCamera(42, 390 / 844, .001, 80)
    const pose = sampleMonumentCamera(site, 0, camera.aspect)
    camera.position.copy(pose.position)
    camera.up.copy(pose.up)
    camera.lookAt(pose.target)
    camera.updateMatrixWorld()
    const points = [new Vector3(0, .105, 0), new Vector3(0, 0, 0)]
    for (let wave = 0; wave < 3; wave++) for (let ship = 0; ship < 3; ship++) {
      points.push(octogonalApproach(wave, 0, ship), octogonalApproach(wave, .5, ship))
    }
    for (const point of points) {
      const projected = point.clone().applyQuaternion(transform.orientation).add(transform.position).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(.9)
      expect(projected.y).toBeLessThan(.92)
      expect(projected.y).toBeGreaterThan(0)
    }
  })
})
