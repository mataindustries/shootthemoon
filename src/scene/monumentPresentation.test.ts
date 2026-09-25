import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { baseDetailsVisible, monumentDetailVisible, sampleMonumentCamera } from './monumentPresentation.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { PerspectiveCamera, Vector3 } from 'three'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { authorMonument, authorPlatform } from './octagonalModels.ts'
import { heliosGroundY } from './heliosReactorModel.ts'
import { MONUMENT_KINDS, MONUMENT_REPAIR_WORK_MS, MONUMENTS, monumentAllocation, monumentModifiers,
  type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { authorInterceptorHull, authorInterceptorVane } from './interceptorModel.ts'
import { sampleWaveAttack } from './interceptorFlight.ts'

const approach = (wave: number, elapsedMs: number, ship: number) => new Vector3(...sampleWaveAttack({
  wave, elapsedMs, strikeAtMs: OCTOGONALS.waves[wave]!.durationMs, leadDestroyedAtMs: null, aim: [0, .03, 0] }).ships[ship]!.position)

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
        const elapsed = i / 100 * OCTOGONALS.waves[wave]!.durationMs
        const point = approach(wave, elapsed, 1)
        expect(point.y).toBeGreaterThanOrEqual(.035)
        expect(point).toEqual(approach(wave, elapsed, 1))
      }
      expect(approach(wave, 3000, 1).length()).toBeLessThan(approach(wave, 0, 1).length())
      for (let other = 0; other < wave; other++) expect(approach(wave, 0, 1).distanceTo(approach(other, 0, 1))).toBeGreaterThan(.03)
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
      points.push(approach(wave, 0, ship), approach(wave, 1800, ship))
    }
    for (const point of points) {
      const projected = point.clone().applyQuaternion(transform.orientation).add(transform.position).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(.9)
      expect(projected.y).toBeLessThan(.92)
      expect(projected.y).toBeGreaterThan(0)
    }
  })
  it('keeps every above-ground authored monument vertex inside the unchanged mobile reveal and batches each model within budget', () => {
    const kit = createOctagonalKit()
    const site = createLandingSite(createLunarLocation(.248, -.684, 18))
    const transform = landingSiteToRenderTransform(site)
    const vertex = new Vector3()
    for (const kind of MONUMENT_KINDS) {
      const batches = batchOctagonalModel(kit, add => authorMonument(kind, add))
      expect(batches.length).toBeLessThanOrEqual(4)
      expect(batches.reduce((sum, b) => sum + b.geometry.getAttribute('position').count / 3, 0)).toBeLessThan(4000)
      for (const aspect of [390 / 844, 844 / 390]) for (const progress of [0, .5, 1]) {
        const camera = new PerspectiveCamera(42, aspect, .001, 80)
        const pose = sampleMonumentCamera(site, progress, aspect)
        camera.position.copy(pose.position)
        camera.up.copy(pose.up)
        camera.lookAt(pose.target)
        camera.updateMatrixWorld()
        let maxX = 0, minY = Infinity, maxY = -Infinity
        for (const batch of batches) {
          const positions = batch.geometry.getAttribute('position')
          for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i)
            // Footings buried below the lunar datum are hidden by the Moon itself.
            if (vertex.y < heliosGroundY(vertex.x, vertex.z)) continue
            vertex.multiplyScalar(.001)
            vertex.y += .0007
            vertex.applyQuaternion(transform.orientation).add(transform.position).project(camera)
            maxX = Math.max(maxX, Math.abs(vertex.x))
            minY = Math.min(minY, vertex.y)
            maxY = Math.max(maxY, vertex.y)
          }
        }
        expect(maxX).toBeLessThan(.93)
        expect(maxY).toBeLessThan(.92)
        expect(minY).toBeGreaterThan(0)
      }
      batches.forEach(b => b.geometry.dispose())
    }
    for (const author of [authorPlatform, authorInterceptorHull, authorInterceptorVane]) {
      const batches = batchOctagonalModel(kit, author)
      expect(batches.length).toBeLessThanOrEqual(4)
      expect(batches.reduce((sum, b) => sum + b.geometry.getAttribute('position').count / 3, 0)).toBeLessThan(3000)
      batches.forEach(b => b.geometry.dispose())
    }
    disposeOctagonalKit(kit)
  })
})

describe('Landed-outpost monument detail visibility policy', () => {
  it('hides monument detail exactly where the close base-detail presentation takes over, and nowhere else', () => {
    expect(monumentDetailVisible(1.01)).toBe(false)
    expect(monumentDetailVisible(1.179)).toBe(false)
    expect(monumentDetailVisible(1.18)).toBe(true)
    expect(monumentDetailVisible(4.7)).toBe(true)
  })
  it('stays visible for the entire dedicated monument camera sweep — construction, command, wave, damage and reveal all ride this pose', () => {
    for (const lat of [-1.5, 0, .248, 1.5]) for (const aspect of [390 / 844, 16 / 9]) {
      const site = createLandingSite(createLunarLocation(lat, -.684, 18))
      for (let i = 0; i <= 100; i++) {
        const pose = sampleMonumentCamera(site, i / 100, aspect)
        expect(monumentDetailVisible(pose.position.length())).toBe(true)
      }
    }
  })
  it('stays visible in claimed orbit, far beyond the close base-detail radius', () => {
    // Matches CameraRig's desktop/portrait orbit distances.
    expect(monumentDetailVisible(3.345)).toBe(true)
    expect(monumentDetailVisible(4.7)).toBe(true)
  })
  it('leaves monument gameplay modifiers and allocation untouched by the presentation policy', () => {
    for (const kind of MONUMENT_KINDS) {
      const monument: TerritoryMonumentSnapshot = {
        kind, anchor: 'outpost', status: 'complete', phaseElapsedMs: 0, workMs: MONUMENTS[kind].laborMs,
        repairWorkMs: MONUMENT_REPAIR_WORK_MS, health: 100, wavesResolved: 3,
        orders: ['DEFEND', 'DEFEND', 'DEFEND'], productionPenalty: 0, energyLoss: 0, oreLost: 0,
        completedAtMs: 1, revealSeen: true,
      }
      const modifiersBefore = monumentModifiers(monument)
      const allocationBefore = monumentAllocation(monument)
      // Sampling the visibility policy at both the hidden and visible radii must not perturb gameplay state.
      monumentDetailVisible(1.0)
      monumentDetailVisible(2.0)
      expect(monumentModifiers(monument)).toEqual(modifiersBefore)
      expect(monumentAllocation(monument)).toEqual(allocationBefore)
    }
  })
})
