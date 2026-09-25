import { afterAll, describe, expect, it } from 'vitest'
import { Box3, BufferAttribute, Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { MONUMENT_REVEAL_MS } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import type { AddPart, Finish } from '../render/octagonalKit.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import { heliosGroundY } from './heliosReactorModel.ts'
import { sampleMonumentCamera } from './monumentPresentation.ts'
import {
  SIGNAL_FAN_ELEVATION, SIGNAL_FOOTINGS, SIGNAL_HEAD_BOUNDS, SIGNAL_HELD_MS,
  SIGNAL_HERO_AZIMUTH, SIGNAL_HUB_HEIGHT, SIGNAL_PARK_AZIMUTH, SIGNAL_PETAL_VERTICES,
  SIGNAL_ROTOR_PIVOT, SIGNAL_STOWED_MS, SIGNAL_STOWED_TOP_Y, SIGNAL_VANE_LAYER,
  SIGNAL_VANE_SLOTS, applySignalSweepRanges, authorSignalArrayBase, createSignalArrayHead,
  disposeSignalArrayHead, poseSignalArrayHead, sampleSignalArray, signalArrayPoseTime,
  signalBodyMatrix, signalVaneAngle,
} from './signalArrayModel.ts'
import type { SignalArrayPose } from './signalArrayModel.ts'

type Triple = [number, number, number]
type Part = {
  shape: Parameters<AddPart>[0]
  finish: Finish
  position: Triple
  scale: Triple
  rotation: Triple
}
type Head = ReturnType<typeof createSignalArrayHead>
const EPS = 1e-5
const batchNames = ['dark', 'gold', 'emitter'] as const
const allBatchNames = [...batchNames, 'goldGlow'] as const
const kit = createOctagonalKit()
const times = (step: number) => Array.from({ length: SIGNAL_HELD_MS / step + 1 }, (_, i) => i * step)
const round = (value: number) => Number(value.toFixed(6))
const triangles = (geometry: BufferGeometry) => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
const points = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i))
}
const headPoints = (head: Head) => batchNames.flatMap(batch => points(head[batch]))
const extent = (vertices: Vector3[]) => new Box3().setFromPoints(vertices)
const boundsJSON = (bounds: Box3) => ({ min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round) })
const radius = (vertices: Vector3[]) => Math.max(...vertices.map(point => Math.hypot(point.x, point.z)))
const centroid = (vertices: Vector3[]) => vertices.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(vertices.length)
const matrixFor = (part: Part) => {
  const object = new Object3D()
  object.position.fromArray(part.position)
  object.scale.fromArray(part.scale)
  object.rotation.set(...part.rotation)
  object.updateMatrix()
  return object.matrix
}
function captureBase() {
  const parts: Part[] = []
  const batches = batchOctagonalModel(kit, add => authorSignalArrayBase((shape, finish, position, scale, rotation = [0, 0, 0]) => {
    parts.push({ shape, finish, position: [...position], scale: [...scale], rotation: [...rotation] })
    add(shape, finish, position, scale, rotation)
  }))
  return { parts, batches }
}
function surfaceArea(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.index
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  let area = 0
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i)
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1)
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2)
    area += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return area
}
const base = captureBase()
const partGeometry = base.parts.map(part => kit.shapes[part.shape].clone().applyMatrix4(matrixFor(part)))
const partBounds = partGeometry.map(geometry => extent(points(geometry)))
const baseVertices = base.batches.flatMap(({ geometry }) => points(geometry))
const baseBounds = extent(baseVertices)
const baseTriangles = Object.fromEntries(base.batches.map(({ finish, geometry }) => [finish, triangles(geometry)]))
const baseTriangleCount = Object.values(baseTriangles).reduce((sum, count) => sum + count, 0)
const restHead = createSignalArrayHead(kit)
const stowedHead = createSignalArrayHead(kit)
const heldHead = createSignalArrayHead(kit)
const stowed = sampleSignalArray(SIGNAL_STOWED_MS)
const held = sampleSignalArray(SIGNAL_HELD_MS)
poseSignalArrayHead(stowedHead, stowed)
poseSignalArrayHead(heldHead, held)
const restVertices = headPoints(restHead)
const stowedVertices = headPoints(stowedHead)
const heldVertices = headPoints(heldHead)
const stowedBounds = extent(stowedVertices)
const heldBounds = extent(heldVertices)
const headTriangles = Object.fromEntries(batchNames.map(batch => [batch, triangles(restHead[batch])]))
const headTriangleCount = Object.values(headTriangles).reduce((sum, count) => sum + count, 0)
const boundCenter = new Vector3(...SIGNAL_HEAD_BOUNDS.center)
const envelope = { minY: Infinity, maxY: -Infinity, maxRadius: 0, maxBoundDistance: 0, minAt: 0, maxAt: 0, radiusAt: 0, boundAt: 0 }
let turretMinimum = Math.min(...baseVertices.filter(point => point.y < 16).map(point => Math.hypot(point.x - 22, point.z - 13)))
const sweepHead = createSignalArrayHead(kit)
for (const time of times(25)) {
  poseSignalArrayHead(sweepHead, sampleSignalArray(time))
  for (const point of headPoints(sweepHead)) {
    if (point.y < envelope.minY) {
      envelope.minY = point.y
      envelope.minAt = time
    }
    if (point.y > envelope.maxY) {
      envelope.maxY = point.y
      envelope.maxAt = time
    }
    const r = Math.hypot(point.x, point.z), distance = point.distanceTo(boundCenter)
    if (r > envelope.maxRadius) {
      envelope.maxRadius = r
      envelope.radiusAt = time
    }
    if (distance > envelope.maxBoundDistance) {
      envelope.maxBoundDistance = distance
      envelope.boundAt = time
    }
    if (point.y < 16) turretMinimum = Math.min(turretMinimum, Math.hypot(point.x - 22, point.z - 13))
  }
}
const scaffoldMinimums = [16, -16].map(x => Math.min(...[...baseVertices, ...stowedVertices]
  .map(point => Math.hypot(point.x - x, point.z + 12))))
const areas: Record<Finish, number> = { dark: 0, gold: 0, amber: 0, cyan: 0 }
for (const { finish, geometry } of base.batches) areas[finish] += surfaceArea(geometry)
for (const batch of batchNames) areas[batch === 'emitter' ? 'amber' : batch] += surfaceArea(heldHead[batch])
const totalArea = Object.values(areas).reduce((sum, area) => sum + area, 0)
const areaPercent = Object.fromEntries(Object.entries(areas).map(([finish, area]) => [finish, round(100 * area / totalArea)]))
const site = createLandingSite(createLunarLocation(.248, -.684, 18))
const transform = landingSiteToRenderTransform(site)
const framing = [390 / 844, 844 / 390, 1440 / 900, 1920 / 1080].map(aspect => {
  const camera = new PerspectiveCamera(42, aspect, .001, 80)
  const projected = new Vector3()
  const result = { aspect, left: Infinity, right: Infinity, lower: Infinity, upper: Infinity }
  const samples = [...times(100).map(time => ({ time, progress: time / 6000 })),
    { time: SIGNAL_STOWED_MS, progress: 0 }, { time: SIGNAL_HELD_MS, progress: 1 }]
  for (const { time, progress } of samples) {
    const pose = sampleMonumentCamera(site, progress, aspect)
    camera.position.copy(pose.position)
    camera.up.copy(pose.up)
    camera.lookAt(pose.target)
    camera.updateMatrixWorld()
    poseSignalArrayHead(sweepHead, sampleSignalArray(time))
    for (const point of [...baseVertices, ...headPoints(sweepHead)]) {
      projected.copy(point).multiplyScalar(.001)
      projected.y += .0007
      projected.applyQuaternion(transform.orientation).add(transform.position).project(camera)
      result.left = Math.min(result.left, .93 + projected.x)
      result.right = Math.min(result.right, .93 - projected.x)
      result.lower = Math.min(result.lower, projected.y)
      result.upper = Math.min(result.upper, .92 - projected.y)
    }
  }
  return result
})

afterAll(() => {
  base.batches.forEach(({ geometry }) => geometry.dispose())
  partGeometry.forEach(geometry => geometry.dispose())
  for (const head of [restHead, stowedHead, heldHead, sweepHead]) disposeSignalArrayHead(head)
  disposeOctagonalKit(kit)
})

describe('Signal Array pure geometry', () => {
  it('authors the exact static base within its geometry and finish budgets', () => {
    expect(base.parts).toHaveLength(23)
    expect(base.batches.length).toBeLessThanOrEqual(3)
    for (const { finish } of base.batches) expect(['dark', 'gold', 'amber']).toContain(finish)
    expect(baseTriangleCount).toBeGreaterThan(0)
    expect(baseTriangleCount).toBeLessThanOrEqual(1200)
    expect(baseBounds.max.y).toBeCloseTo(31, 5)
    expect(baseBounds.min.y).toBeGreaterThanOrEqual(-2.5)
    expect(radius(baseVertices)).toBeLessThanOrEqual(20.5)
    for (const part of base.parts) expect(part.rotation[0]).toBe(0)
    expect(base.parts.slice(0, 3).map(({ shape, finish, position, scale }) => [shape, finish, position, scale])).toEqual([
      ['bevel', 'dark', [0, -.3, 0], [10.5, 4, 10.5]],
      ['bevel', 'gold', [0, 1, 0], [10.8, .5, 10.8]],
      ['bevel', 'dark', [0, 6, 0], [5.5, 9, 5.5]],
    ])
    expect(base.parts.slice(15, 19).map(({ shape, finish, position, scale }) => [shape, finish, position, scale])).toEqual([
      ['bevel', 'dark', [0, 15.25, 0], [4, 9.5, 4]],
      ['bevel', 'gold', [0, 20, 0], [4.4, .9, 4.4]],
      ['bevel', 'dark', [0, 24.9, 0], [3.1, 9.8, 3.1]],
      ['bevel', 'gold', [0, 30.4, 0], [4.5, 1.2, 4.5]],
    ])
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2
      const radial = (r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r]
      expect(base.parts[3 + k]).toEqual({ shape: 'box', finish: 'dark', position: radial(11.2, 3.6),
        scale: [13.4, 4, 3.2], rotation: [0, a - Math.PI / 2, -Math.atan2(6, 11)] })
      expect(base.parts[7 + k * 2]).toEqual({ shape: 'bevel', finish: 'dark', position: radial(17.5, -.5),
        scale: [2.6, 3.4, 2.6], rotation: [0, 0, 0] })
      expect(base.parts[8 + k * 2]).toEqual({ shape: 'bevel', finish: 'gold', position: radial(17.5, 1.45),
        scale: [2, .6, 2], rotation: [0, 0, 0] })
      expect(base.parts[19 + k]).toEqual({ shape: 'box', finish: 'amber', position: radial(4 * Math.cos(Math.PI / 8) + .05, 15.25),
        scale: [.9, 5, .3], rotation: [0, a, 0] })
    }
  })

  it('matches each of five buried footings to exactly one foundation', () => {
    expect(SIGNAL_FOOTINGS).toHaveLength(5)
    const expected = [{ x: 0, z: 0, bottomY: -2.3 }, ...Array.from({ length: 4 }, (_, k) => ({
      x: Math.sin(k * Math.PI / 2) * 17.5, z: Math.cos(k * Math.PI / 2) * 17.5, bottomY: -2.2,
    }))]
    expect(SIGNAL_FOOTINGS).toEqual(expected)
    for (const footing of SIGNAL_FOOTINGS) {
      const matches = base.parts.filter((part, i) => part.shape === 'bevel' && part.finish === 'dark'
        && Math.hypot(part.position[0] - footing.x, part.position[2] - footing.z) < EPS
        && Math.abs(partBounds[i]!.min.y - footing.bottomY) < EPS)
      expect(matches).toHaveLength(1)
      const ground = heliosGroundY(footing.x, footing.z)
      expect(footing.bottomY).toBeGreaterThanOrEqual(ground - 2.5)
      expect(footing.bottomY).toBeLessThanOrEqual(ground - .5)
    }
  })

  it('shares the gold streams and leads them with seven outward-wide petals in sweep order', () => {
    expect(headTriangleCount).toBeLessThanOrEqual(1100)
    expect(headTriangleCount).toBeGreaterThan(0)
    expect(new Set(restHead.bodies.map(range => range.body))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(restHead.goldGlow.getAttribute('position')).toBe(restHead.gold.getAttribute('position'))
    expect(restHead.goldGlow.getAttribute('normal')).toBe(restHead.gold.getAttribute('normal'))
    expect(restHead.goldGlow.index).toBe(restHead.gold.index)
    expect(SIGNAL_PETAL_VERTICES).toBe(96)
    const gold = points(restHead.gold), heldGold = points(heldHead.gold)
    const right = new Vector3(Math.cos(SIGNAL_HERO_AZIMUTH), 0, -Math.sin(SIGNAL_HERO_AZIMUTH))
    let previous = Infinity
    for (let i = 0; i < 7; i++) {
      const start = i * SIGNAL_PETAL_VERTICES
      const petal = gold.slice(start, start + SIGNAL_PETAL_VERTICES)
      expect(petal).toHaveLength(96)
      expect(restHead.bodies.filter(range => range.batch === 'gold' && range.body === 7 - i))
        .toEqual([{ batch: 'gold', body: 7 - i, start, count: SIGNAL_PETAL_VERTICES }])
      const bounds = extent(petal)
      expect(bounds.min.y).toBeCloseTo(8.5, 5)
      expect(bounds.max.y).toBeCloseTo(25, 5)
      const innerWidth = Math.max(...petal.filter(point => Math.abs(point.y - 8.5) < EPS).map(point => Math.abs(point.x)))
      const outerWidth = Math.max(...petal.filter(point => Math.abs(point.y - 25) < EPS).map(point => Math.abs(point.x)))
      expect(outerWidth / innerWidth).toBeCloseTo(1 / .16, 5)
      expect(outerWidth).toBeCloseTo(5.2 * Math.cos(Math.PI / 8), 5)
      const projection = centroid(heldGold.slice(start, start + SIGNAL_PETAL_VERTICES)).dot(right)
      expect(projection).toBeLessThan(previous)
      previous = projection
    }
    expect(gold.length).toBe(7 * SIGNAL_PETAL_VERTICES + 2 * kit.shapes.ring.getAttribute('position').count)
    for (const batch of batchNames) {
      const ranges = restHead.bodies.filter(range => range.batch === batch).sort((a, b) => a.start - b.start)
      let end = 0
      for (const range of ranges) {
        expect(range.start).toBe(end)
        expect(range.count).toBeGreaterThan(0)
        end += range.count
      }
      expect(end).toBe(restHead[batch].getAttribute('position').count)
    }
  })

  it('keeps all vane rest vertices inside their specified local layer thickness', () => {
    for (const range of restHead.bodies) if (range.body > 0) {
      const geometry = restHead[range.batch as typeof batchNames[number]]
      const position = geometry.getAttribute('position')
      for (let i = range.start; i < range.start + range.count; i++) {
        expect(position.getZ(i)).toBeGreaterThanOrEqual(-.38)
        expect(position.getZ(i)).toBeLessThanOrEqual(.38)
      }
    }
    expect(SIGNAL_VANE_LAYER).toBe(.8)
  })

  it('partitions only draw ranges while keeping both hub rings in normal gold', () => {
    const head = createSignalArrayHead(kit)
    const position = head.gold.getAttribute('position'), normal = head.gold.getAttribute('normal')
    const positions = Array.from(position.array), normals = Array.from(normal.array)
    const versions = [position, normal].map(attribute => (attribute as BufferAttribute).version)
    const stream = head.gold.index?.count ?? position.count
    try {
      for (const [requested, lit] of [[-3, 0], [0, 0], [1, 1], [3.9, 3], [7, 7], [9, 7]]) {
        applySignalSweepRanges(head, requested!)
        const start = lit! * SIGNAL_PETAL_VERTICES
        expect(head.goldGlow.drawRange).toEqual({ start: 0, count: start })
        expect(head.gold.drawRange).toEqual({ start, count: stream - start })
        expect(head.gold.drawRange.start).toBeLessThanOrEqual(7 * SIGNAL_PETAL_VERTICES)
        expect(head.gold.drawRange.start + head.gold.drawRange.count).toBe(stream)
      }
      expect(head.gold.getAttribute('position')).toBe(position)
      expect(head.gold.getAttribute('normal')).toBe(normal)
      expect(Array.from(position.array)).toEqual(positions)
      expect(Array.from(normal.array)).toEqual(normals)
      expect([position, normal].map(attribute => (attribute as BufferAttribute).version)).toEqual(versions)
    } finally {
      disposeSignalArrayHead(head)
    }
  })

  it('poses from rest without drift and keeps normals unit length', () => {
    const head = createSignalArrayHead(kit)
    const attributes = batchNames.map(batch => ({ position: head[batch].getAttribute('position'), normal: head[batch].getAttribute('normal') }))
    try {
      poseSignalArrayHead(head, stowed)
      poseSignalArrayHead(head, held)
      for (const [i, batch] of batchNames.entries()) {
        expect(head[batch].getAttribute('position')).toBe(attributes[i]!.position)
        expect(head[batch].getAttribute('normal')).toBe(attributes[i]!.normal)
        for (const attribute of ['position', 'normal']) {
          expect(head[batch].getAttribute(attribute)).toBeInstanceOf(BufferAttribute)
          expect((head[batch].getAttribute(attribute) as BufferAttribute).version).toBeGreaterThan(0)
          expect(Array.from(head[batch].getAttribute(attribute).array)).toEqual(Array.from(heldHead[batch].getAttribute(attribute).array))
        }
      }
      for (const time of times(100)) {
        poseSignalArrayHead(head, sampleSignalArray(time))
        for (const batch of batchNames) {
          const normal = head[batch].getAttribute('normal')
          let maximumError = 0
          for (let i = 0; i < normal.count; i++) maximumError = Math.max(maximumError, Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1))
          expect(maximumError).toBeLessThan(1e-6)
        }
      }
      poseSignalArrayHead(head, held)
      for (const batch of batchNames) for (const attribute of ['position', 'normal']) {
        expect(Array.from(head[batch].getAttribute(attribute).array)).toEqual(Array.from(heldHead[batch].getAttribute(attribute).array))
      }
    } finally {
      disposeSignalArrayHead(head)
    }
  })

  it('points the lens and boom at the exact stowed and held azimuths and fan elevation', () => {
    const vertexCount = kit.shapes.bevel.getAttribute('position').count
    expect(SIGNAL_ROTOR_PIVOT).toEqual([0, 31, 0])
    expect(SIGNAL_HUB_HEIGHT).toBe(5)
    expect(SIGNAL_FAN_ELEVATION).toBe(Math.PI / 6)
    for (const [head, yaw] of [[stowedHead, SIGNAL_PARK_AZIMUTH], [heldHead, SIGNAL_HERO_AZIMUTH]] as const) {
      const lens = centroid(points(head.emitter).slice(-vertexCount))
      const direction = lens.clone().sub(new Vector3(0, 36, 0))
      expect(Math.atan2(direction.x, direction.z)).toBeCloseTo(yaw, 7)
      expect(Math.atan2(direction.y, Math.hypot(direction.x, direction.z))).toBeCloseTo(Math.PI / 6, 7)
      const boom = centroid(points(head.dark).slice(2 * vertexCount, 3 * vertexCount)).sub(new Vector3(0, 36, 0))
      expect(Math.atan2(boom.x, boom.z)).toBeCloseTo(yaw, 7)
      expect(Math.atan2(boom.y, Math.hypot(boom.x, boom.z))).toBeCloseTo(Math.PI / 6, 7)
    }
    const expected = new Vector3(0, 36, 0).addScaledVector(new Vector3(
      Math.cos(SIGNAL_FAN_ELEVATION) * Math.sin(SIGNAL_HERO_AZIMUTH),
      Math.sin(SIGNAL_FAN_ELEVATION),
      Math.cos(SIGNAL_FAN_ELEVATION) * Math.cos(SIGNAL_HERO_AZIMUTH),
    ), 17.9)
    expect(centroid(points(heldHead.emitter).slice(-vertexCount)).distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('uses the specified body frame and slot layer offsets', () => {
    for (const pose of [stowed, sampleSignalArray(950), held]) {
      const out = new Matrix4()
      expect(signalBodyMatrix(0, pose, out)).toBe(out)
      expect(new Vector3().applyMatrix4(out)).toEqual(new Vector3(...SIGNAL_ROTOR_PIVOT))
      const forward = new Vector3(0, 0, 1).transformDirection(out)
      expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(pose.yaw, 12)
      for (const [i, k] of SIGNAL_VANE_SLOTS.entries()) {
        const matrix = signalBodyMatrix(i + 1, pose, out)
        const origin = new Vector3().applyMatrix4(matrix)
        const expectedOrigin = new Vector3(
          Math.cos(SIGNAL_FAN_ELEVATION) * Math.sin(pose.yaw), Math.sin(SIGNAL_FAN_ELEVATION),
          Math.cos(SIGNAL_FAN_ELEVATION) * Math.cos(pose.yaw),
        ).multiplyScalar(SIGNAL_VANE_LAYER * k).add(new Vector3(0, 36, 0))
        expect(origin.distanceTo(expectedOrigin)).toBeLessThan(1e-12)
        const axis = new Vector3(0, 1, 0).transformDirection(matrix)
          .applyAxisAngle(new Vector3(0, 1, 0), -pose.yaw)
          .applyAxisAngle(new Vector3(1, 0, 0), SIGNAL_FAN_ELEVATION)
        expect(Math.atan2(axis.x, axis.y)).toBeCloseTo(pose.vanes[i]!, 12)
      }
    }
  })

  it('contains every sampled head vertex in the fixed sphere and vertical envelope', () => {
    expect.soft(envelope.minY, `minimum at ${envelope.minAt} ms`).toBeGreaterThanOrEqual(31)
    expect.soft(envelope.maxY, `maximum at ${envelope.maxAt} ms`).toBeLessThanOrEqual(60.5)
    expect.soft(envelope.maxBoundDistance, `sphere maximum at ${envelope.boundAt} ms`).toBeLessThanOrEqual(SIGNAL_HEAD_BOUNDS.radius)
    expect.soft(radius(heldVertices)).toBeLessThanOrEqual(27)
    expect(Math.abs(SIGNAL_STOWED_TOP_Y - stowedBounds.max.y)).toBeLessThan(.01)
    expect(SIGNAL_HEAD_BOUNDS).toEqual({ center: [0, 36, 0], radius: 27.5 })
    const spheres = allBatchNames.map(batch => sweepHead[batch].boundingSphere)
    for (const time of times(25)) {
      poseSignalArrayHead(sweepHead, sampleSignalArray(time))
      for (const [i, batch] of allBatchNames.entries()) {
        expect(sweepHead[batch].boundingSphere).toBe(spheres[i])
        expect(sweepHead[batch].boundingSphere?.center).toEqual(boundCenter)
        expect(sweepHead[batch].boundingSphere?.radius).toBe(27.5)
      }
    }
  })

  it('clears the defense turret and both construction scaffold positions', () => {
    // Mirrors the existing TerritoryMonument turret and scaffold contracts.
    expect.soft(turretMinimum).toBeGreaterThanOrEqual(8.5)
    for (const minimum of scaffoldMinimums) expect.soft(minimum).toBeGreaterThanOrEqual(1.5)
  })

  it('keeps dark surface area dominant and amber sparse without cyan', () => {
    // Count every transformed triangle face, including buried faces, and the shared gold stream once.
    expect.soft(areas.dark / totalArea).toBeGreaterThanOrEqual(.55)
    expect.soft(areas.gold / totalArea).toBeLessThanOrEqual(.40)
    expect.soft(areas.amber / totalArea).toBeLessThanOrEqual(.03)
    expect(areas.cyan).toBe(0)
  })

  it.each(framing)('frames every vertex throughout the reveal at aspect $aspect', margin => {
    expect.soft(margin.left).toBeGreaterThan(0)
    expect.soft(margin.right).toBeGreaterThan(0)
    expect.soft(margin.lower).toBeGreaterThan(0)
    expect.soft(margin.upper).toBeGreaterThan(0)
  })

  it('repeats static authorship, head streams, body ranges and bounds exactly', () => {
    const repeatedBase = captureBase(), repeatedHead = createSignalArrayHead(kit)
    try {
      expect(repeatedBase.parts).toEqual(base.parts)
      expect(repeatedBase.batches.map(batch => batch.finish)).toEqual(base.batches.map(batch => batch.finish))
      expect(repeatedHead.bodies).toEqual(restHead.bodies)
      for (const [i, batch] of repeatedBase.batches.entries()) {
        const original = base.batches[i]!.geometry
        expect(triangles(batch.geometry)).toBe(triangles(original))
        expect(extent(points(batch.geometry))).toEqual(extent(points(original)))
        for (const attribute of ['position', 'normal']) {
          expect(Array.from(batch.geometry.getAttribute(attribute).array)).toEqual(Array.from(original.getAttribute(attribute).array))
        }
      }
      for (const batch of allBatchNames) {
        expect(triangles(repeatedHead[batch])).toBe(triangles(restHead[batch]))
        expect(repeatedHead[batch].boundingSphere).toEqual(restHead[batch].boundingSphere)
        expect(extent(points(repeatedHead[batch]))).toEqual(extent(points(restHead[batch])))
        for (const attribute of ['position', 'normal']) {
          expect(Array.from(repeatedHead[batch].getAttribute(attribute).array)).toEqual(Array.from(restHead[batch].getAttribute(attribute).array))
        }
      }
      poseSignalArrayHead(repeatedHead, stowed)
      expect(extent(headPoints(repeatedHead))).toEqual(stowedBounds)
      expect(Math.abs(extent(headPoints(repeatedHead)).max.y - SIGNAL_STOWED_TOP_Y)).toBeLessThan(.01)
    } finally {
      repeatedBase.batches.forEach(({ geometry }) => geometry.dispose())
      disposeSignalArrayHead(repeatedHead)
    }
  })

  it('disposes all owned geometries once without disposing kit source geometry', () => {
    const head = createSignalArrayHead(kit)
    const owned = allBatchNames.map(batch => head[batch])
    const counts = new Map(owned.map(geometry => [geometry, 0]))
    const sources = Object.values(kit.shapes)
    let sourceDisposals = 0
    const sourceListener = () => { sourceDisposals++ }
    for (const geometry of owned) geometry.addEventListener('dispose', () => counts.set(geometry, counts.get(geometry)! + 1))
    for (const geometry of sources) geometry.addEventListener('dispose', sourceListener)
    try {
      disposeSignalArrayHead(head)
      expect([...counts.values()]).toEqual([1, 1, 1, 1])
      expect(sourceDisposals).toBe(0)
      disposeSignalArrayHead(head)
      expect([...counts.values()]).toEqual([1, 1, 1, 1])
      expect(sourceDisposals).toBe(0)
    } finally {
      for (const geometry of sources) geometry.removeEventListener('dispose', sourceListener)
    }
  })
})

describe('Signal Array deterministic deployment', () => {
  it('returns exact stowed and held poses and clamps both ends', () => {
    expect(SIGNAL_STOWED_MS).toBe(0)
    expect(SIGNAL_HELD_MS).toBe(4400)
    expect(SIGNAL_VANE_SLOTS).toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(SIGNAL_PARK_AZIMUTH).toBe(-3 * Math.PI / 8)
    expect(SIGNAL_HERO_AZIMUTH).toBe(-Math.PI / 8)
    expect(stowed).toEqual({ yaw: SIGNAL_PARK_AZIMUTH, vanes: SIGNAL_VANE_SLOTS.map(k => signalVaneAngle(k, false)), lit: 0, glow: .08, emitter: .06 })
    expect(held.yaw).toBe(SIGNAL_HERO_AZIMUTH)
    expect(held.vanes).toEqual(SIGNAL_VANE_SLOTS.map(k => signalVaneAngle(k, true)))
    expect(held.lit).toBe(0)
    expect(held.glow).toBe(.08)
    expect(held.emitter).toBeCloseTo(.34, 12)
    for (const k of SIGNAL_VANE_SLOTS) {
      expect(signalVaneAngle(k, false)).toBe(k * Math.PI / 24)
      expect(signalVaneAngle(k, true)).toBe(k * Math.PI / 8)
    }
    for (const time of [-Infinity, -100_000, -1, 0]) expect(sampleSignalArray(time)).toEqual(stowed)
    for (const time of [4400, 4401, 100_000, Infinity]) expect(sampleSignalArray(time)).toEqual(held)
    expect(SIGNAL_HELD_MS).toBeLessThanOrEqual(MONUMENT_REVEAL_MS - 1000)
  })

  it('preserves vane ordering and locks outer panels before inner panels', () => {
    let minimumGap = Infinity
    for (const time of times(1)) {
      const pose = sampleSignalArray(time)
      expect(pose.vanes).toHaveLength(7)
      for (let i = 1; i < pose.vanes.length; i++) minimumGap = Math.min(minimumGap, pose.vanes[i]! - pose.vanes[i - 1]!)
    }
    expect(minimumGap).toBeGreaterThanOrEqual(Math.PI / 24 - 1e-9)
    const locks = SIGNAL_VANE_SLOTS.filter(k => k !== 0).map(k => {
      const i = SIGNAL_VANE_SLOTS.indexOf(k)
      const time = 450 + 180 * (3 - Math.abs(k)) + 1100
      expect(sampleSignalArray(time).vanes[i]).toBe(signalVaneAngle(k, true))
      expect(sampleSignalArray(time - 1).vanes[i]).not.toBe(signalVaneAngle(k, true))
      expect(sampleSignalArray(time - 1100).vanes[i]).toBe(signalVaneAngle(k, false))
      expect(time).toBeLessThan(1950)
      return { slot: k, time }
    })
    expect(locks.filter(lock => Math.abs(lock.slot) === 3).map(lock => lock.time)).toEqual([1550, 1550])
    expect(locks.filter(lock => Math.abs(lock.slot) === 2).map(lock => lock.time)).toEqual([1730, 1730])
    expect(locks.filter(lock => Math.abs(lock.slot) === 1).map(lock => lock.time)).toEqual([1910, 1910])
    expect(sampleSignalArray(250).yaw).toBe(SIGNAL_PARK_AZIMUTH)
    expect(sampleSignalArray(700).yaw).toBeCloseTo((SIGNAL_PARK_AZIMUTH + SIGNAL_HERO_AZIMUTH) / 2, 12)
    expect(sampleSignalArray(1150).yaw).toBe(SIGNAL_HERO_AZIMUTH)
  })

  it('sweeps monotonically, cools its glow and peaks the emitter at 2750 ms', () => {
    let previousLit = 0
    let peak = { time: 0, emitter: -Infinity }
    for (const time of times(1)) {
      const pose = sampleSignalArray(time)
      expect(pose.glow).toBeGreaterThanOrEqual(.08)
      expect(pose.glow).toBeLessThanOrEqual(.65)
      expect(pose.glow).toBeLessThanOrEqual(EMISSIVE_LIMITS.activePanel)
      expect(pose.emitter).toBeGreaterThanOrEqual(.06)
      expect(pose.emitter).toBeLessThanOrEqual(.82)
      expect(pose.emitter).toBeLessThanOrEqual(EMISSIVE_LIMITS.tinyLed)
      if (pose.emitter > peak.emitter) peak = { time, emitter: pose.emitter }
      if (time < 1950 || time >= 4400) expect(pose.lit).toBe(0)
      else {
        expect(pose.lit).toBeGreaterThanOrEqual(previousLit)
        expect(pose.lit).toBe(Math.min(7, Math.ceil(7 * (time - 1950) / 550)))
        previousLit = pose.lit
      }
      if (time >= 4200) expect(pose.glow).toBe(.08)
    }
    expect(sampleSignalArray(1950).glow).toBe(.60)
    expect(sampleSignalArray(2500).lit).toBe(7)
    expect(sampleSignalArray(2500).emitter).toBe(.18)
    expect(sampleSignalArray(2750).glow).toBe(.60)
    expect(peak.time).toBe(2750)
    expect(peak.emitter).toBe(.82)
    expect(sampleSignalArray(4200).emitter).toBeCloseTo(.34, 12)
  })

  it('reuses optional output while equal inputs remain independent and identical', () => {
    const output: SignalArrayPose = { yaw: 99, vanes: [], lit: 99, glow: 99, emitter: 99 }
    const angles = output.vanes
    const a = sampleSignalArray(1234), b = sampleSignalArray(1234)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.vanes).not.toBe(b.vanes)
    for (const time of times(100)) {
      expect(sampleSignalArray(time, output)).toBe(output)
      expect(output.vanes).toBe(angles)
      expect(output).toEqual(sampleSignalArray(time))
      expect(sampleSignalArray(time)).toEqual(sampleSignalArray(time))
    }
    expect(a).toEqual(b)
  })

  it('resolves the complete pose-time truth table', () => {
    for (const reducedMotion of [false, true]) for (const revealAtMs of [null, 1000]) {
      expect(signalArrayPoseTime({ complete: false, revealAtMs, nowMs: 3500, reducedMotion })).toBe(0)
    }
    for (const revealAtMs of [null, 1000]) {
      expect(signalArrayPoseTime({ complete: true, revealAtMs, nowMs: 3500, reducedMotion: true })).toBe(4400)
    }
    expect(signalArrayPoseTime({ complete: true, revealAtMs: null, nowMs: 3500, reducedMotion: false })).toBe(4400)
    expect(signalArrayPoseTime({ complete: true, revealAtMs: 1000, nowMs: 3500, reducedMotion: false })).toBe(2500)
    expect(signalArrayPoseTime({ complete: true, revealAtMs: 1000, nowMs: 999, reducedMotion: false })).toBe(0)
    expect(signalArrayPoseTime({ complete: true, revealAtMs: 1000, nowMs: 1000, reducedMotion: false })).toBe(0)
    expect(signalArrayPoseTime({ complete: true, revealAtMs: 1000, nowMs: 9000, reducedMotion: false })).toBe(4400)
  })

  it('reports one concise geometry and deployment metrics object', () => {
    console.info(JSON.stringify({
      base: { parts: base.parts.length, batches: base.batches.length, trianglesByBatch: baseTriangles,
        trianglesTotal: baseTriangleCount, bounds: boundsJSON(baseBounds), maxRadius: round(radius(baseVertices)) },
      head: { bodies: new Set(restHead.bodies.map(range => range.body)).size, trianglesByBatch: headTriangles,
        trianglesTotal: headTriangleCount, restBounds: boundsJSON(extent(restVertices)),
        stowedBounds: boundsJSON(stowedBounds), heldBounds: boundsJSON(heldBounds),
        maxRadius: round(envelope.maxRadius), heldMaxRadius: round(radius(heldVertices)), stowedTopY: SIGNAL_STOWED_TOP_Y },
      clearances: { turretMinimum: round(turretMinimum), scaffoldMinimum: round(Math.min(...scaffoldMinimums)), scaffoldMinimums: scaffoldMinimums.map(round) },
      areaPercent,
      footings: SIGNAL_FOOTINGS,
      footingDepths: SIGNAL_FOOTINGS.map(({ x, z, bottomY }) => round(heliosGroundY(x, z) - bottomY)),
      envelope: Object.fromEntries(Object.entries(envelope).map(([key, value]) => [key, round(value)])),
      framing: framing.map(margins => Object.fromEntries(Object.entries(margins).map(([key, value]) => [key, round(value)]))),
      sampler: { stowed, held, vaneLocks: { outer: 1550, middle: 1730, inner: 1910 }, emitterPeak: { time: 2750, value: sampleSignalArray(2750).emitter } },
    }))
  })
})
