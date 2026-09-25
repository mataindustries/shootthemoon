import { afterAll, describe, expect, it, vi } from 'vitest'
import { Box3, Matrix4, Vector3 } from 'three'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import type { AddPart, Finish, ModelBatch } from '../render/octagonalKit.ts'
import {
  authorInterceptorHull,
  authorInterceptorVane,
  INTERCEPTOR_ENVELOPE,
  interceptorEmitterLocal,
  NOZZLE_EXITS,
  VANE_DEPLOYED,
  VANE_EMITTER_LOCAL,
  VANE_PIVOTS,
  VANE_TUCKED,
} from './interceptorModel.ts'
import type { Vec3 } from './interceptorModel.ts'

const kit = createOctagonalKit()
const hull = batchOctagonalModel(kit, authorInterceptorHull)
const vane = batchOctagonalModel(kit, authorInterceptorVane)
const radians = (degrees: number) => degrees * Math.PI / 180

function triangleCount(batches: ModelBatch[]) {
  return batches.reduce((total, batch) => total + batch.geometry.getAttribute('position').count / 3, 0)
}

function boundsOf(batches: ModelBatch[]) {
  const result = new Box3()
  for (const batch of batches) {
    batch.geometry.computeBoundingBox()
    if (batch.geometry.boundingBox) result.union(batch.geometry.boundingBox)
  }
  return result
}

function surfaceAreas(batches: ModelBatch[]) {
  const result: Record<Finish, number> = { dark: 0, gold: 0, amber: 0, cyan: 0 }
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  for (const { finish, geometry } of batches) {
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i += 3) {
      a.fromBufferAttribute(positions, i)
      b.fromBufferAttribute(positions, i + 1)
      c.fromBufferAttribute(positions, i + 2)
      result[finish] += b.sub(a).cross(c.sub(a)).length() / 2
    }
  }
  return result
}

function widthBetweenZ(batches: ModelBatch[], low: number, high: number) {
  let minX = Infinity, maxX = -Infinity
  const include = (x: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  for (const { geometry } of batches) {
    const positions = geometry.getAttribute('position')
    for (let triangle = 0; triangle < positions.count; triangle += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const i = triangle + edge, j = triangle + (edge + 1) % 3
        const x = positions.getX(i), z = positions.getZ(i)
        const nextX = positions.getX(j), nextZ = positions.getZ(j)
        if (z >= low && z <= high) include(x)
        // Include clipped triangle edges so an empty vertex band cannot hide a broad nose.
        for (const plane of [low, high]) {
          if ((z < plane && nextZ > plane) || (z > plane && nextZ < plane)) {
            include(x + (nextX - x) * (plane - z) / (nextZ - z))
          }
        }
      }
    }
  }
  return maxX - minX
}

function vaneTransform(side: 1 | -1, yaw: number, pitch: number) {
  const pivot = side === 1
    ? VANE_PIVOTS[0]
    : VANE_PIVOTS[1]
  return new Matrix4().makeTranslation(...pivot)
    .multiply(new Matrix4().makeRotationY(side * yaw))
    .multiply(new Matrix4().makeRotationX(pitch))
}

describe('interceptor model', () => {
  afterAll(() => {
    const bounds = boundsOf(hull)
    const length = bounds.max.z - bounds.min.z, width = bounds.max.x - bounds.min.x
    const areas = surfaceAreas(hull)
    const total = Object.values(areas).reduce((sum, area) => sum + area, 0)
    const emitters = (yaw: number, pitch: number) => ([1, -1] as const).map(side => interceptorEmitterLocal(side, yaw, pitch, [0, 0, 0]))
    console.info('interceptor model metrics', JSON.stringify({
      hullBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      areaPercent: Object.fromEntries(Object.entries(areas).map(([finish, area]) => [finish, area / total * 100])),
      forwardWidthRatio: widthBetweenZ(hull, bounds.max.z - length * .10, bounds.max.z) / width,
      rearWidthRatio: widthBetweenZ(hull, bounds.min.z, bounds.min.z + length * .15) / width,
      tuckedEmitters: emitters(VANE_TUCKED.yaw, VANE_TUCKED.pitch),
      deployedEmitters: emitters(VANE_DEPLOYED.yaw, VANE_DEPLOYED.pitch),
      envelope: INTERCEPTOR_ENVELOPE,
    }))
    for (const batch of [...hull, ...vane]) batch.geometry.dispose()
    disposeOctagonalKit(kit)
  })

  it('authors exactly twelve hull parts and two vane parts with the prescribed draw and triangle budgets', () => {
    const hullParts: Parameters<AddPart>[] = [], vaneParts: Parameters<AddPart>[] = []
    authorInterceptorHull((...part) => hullParts.push(part))
    authorInterceptorVane((...part) => vaneParts.push(part))
    expect(hullParts).toHaveLength(12)
    expect(vaneParts).toHaveLength(2)
    expect(hull.map(batch => batch.finish).sort()).toEqual(['amber', 'cyan', 'dark', 'gold'])
    expect(vane.map(batch => batch.finish)).toEqual(['gold'])
    expect(triangleCount(hull)).toBe(328)
    expect(triangleCount(hull)).toBeLessThanOrEqual(340)
    expect(triangleCount(vane)).toBe(24)
    expect(triangleCount(vane)).toBeLessThanOrEqual(30)
    expect(hullParts.every(([shape]) => shape !== 'ring' && shape !== 'scar')).toBe(true)
    expect(vaneParts.every(([shape]) => shape !== 'ring' && shape !== 'scar')).toBe(true)
  })

  it('has an arrow planform across complete clipped forward and rear bands', () => {
    const bounds = boundsOf(hull)
    const length = bounds.max.z - bounds.min.z
    const width = bounds.max.x - bounds.min.x
    expect.soft(widthBetweenZ(hull, bounds.max.z - length * .10, bounds.max.z)).toBeLessThanOrEqual(width * .25)
    expect.soft(widthBetweenZ(hull, bounds.min.z, bounds.min.z + length * .15)).toBeGreaterThanOrEqual(width * .70)
  })

  it('reserves amber for rear nozzles and cyan for the small dorsal sensor', () => {
    for (const { finish, geometry } of hull) {
      const positions = geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        if (finish === 'amber') expect(positions.getZ(i)).toBeLessThan(-1.3)
        if (finish === 'cyan') {
          expect(positions.getZ(i)).toBeGreaterThan(.9)
          expect(positions.getY(i)).toBeGreaterThan(.05)
        }
      }
    }
    const areas = surfaceAreas(hull)
    const total = Object.values(areas).reduce((sum, area) => sum + area, 0)
    expect(areas.dark / total).toBeGreaterThanOrEqual(.60)
    expect(areas.cyan / total).toBeLessThanOrEqual(.03)
    expect(areas.amber / total).toBeLessThanOrEqual(.10)
  })

  it('keeps the complete hull inside the required bounds', () => {
    const bounds = boundsOf(hull)
    expect.soft(bounds.min.x).toBeGreaterThanOrEqual(-.54)
    expect.soft(bounds.max.x).toBeLessThanOrEqual(.54)
    expect.soft(bounds.min.y).toBeGreaterThanOrEqual(-.36)
    expect.soft(bounds.max.y).toBeLessThanOrEqual(.49)
    expect.soft(bounds.min.z).toBeGreaterThanOrEqual(-1.61)
    expect.soft(bounds.max.z).toBeLessThanOrEqual(1.36)
  })

  it('contains the hull and the complete vane sweep in its conservative envelope', () => {
    const envelope = new Box3(new Vector3(...INTERCEPTOR_ENVELOPE.min), new Vector3(...INTERCEPTOR_ENVELOPE.max))
    expect(envelope.containsBox(boundsOf(hull))).toBe(true)
    const point = new Vector3()
    for (let yaw = 20; yaw <= 160; yaw += 5) {
      for (const pitch of [0, 8]) {
        for (const side of [1, -1] as const) {
          const matrix = vaneTransform(side, radians(yaw), radians(pitch))
          for (const { geometry } of vane) {
            const positions = geometry.getAttribute('position')
            for (let i = 0; i < positions.count; i++) {
              point.fromBufferAttribute(positions, i).applyMatrix4(matrix)
              expect(envelope.containsPoint(point)).toBe(true)
            }
          }
        }
      }
    }
  })

  it('matches independent Three.js T · Ry · Rx emitter composition and reuses its output', () => {
    const out: Vec3 = [NaN, NaN, NaN]
    for (const side of [1, -1] as const) {
      for (const yaw of [20, 22, 30, 70, 90, 130, 155, 160]) {
        for (const pitch of [0, 4, 8]) {
          const expected = new Vector3(...VANE_EMITTER_LOCAL).applyMatrix4(vaneTransform(side, radians(yaw), radians(pitch)))
          expect(interceptorEmitterLocal(side, radians(yaw), radians(pitch), out)).toBe(out)
          expect(new Vector3(...out).distanceTo(expected)).toBeLessThan(1e-9)
        }
      }
    }
    expect(NOZZLE_EXITS).toEqual([[.28, .02, -1.60], [-.28, .02, -1.60]])
  })

  it('keeps every vane vertex beyond local z .3 clear of the fuselage throughout deployment', () => {
    const point = new Vector3()
    for (let yaw = 20; yaw <= 160; yaw += 5) {
      for (const pitch of [0, 8]) {
        for (const side of [1, -1] as const) {
          const matrix = vaneTransform(side, radians(yaw), radians(pitch))
          for (const { geometry } of vane) {
            const positions = geometry.getAttribute('position')
            for (let i = 0; i < positions.count; i++) {
              if (positions.getZ(i) <= .3) continue
              point.fromBufferAttribute(positions, i).applyMatrix4(matrix)
              expect(Math.abs(point.x)).toBeGreaterThan(.55)
            }
          }
        }
      }
    }
  })

  it('disposes every generated batch, kit geometry, and kit material', () => {
    const disposableKit = createOctagonalKit()
    const batches = [
      ...batchOctagonalModel(disposableKit, authorInterceptorHull),
      ...batchOctagonalModel(disposableKit, authorInterceptorVane),
    ]
    const spies = [
      ...batches.map(batch => vi.spyOn(batch.geometry, 'dispose')),
      ...Object.values(disposableKit.shapes).map(shape => vi.spyOn(shape, 'dispose')),
      ...Object.values(disposableKit.materials).map(material => vi.spyOn(material, 'dispose')),
    ]
    try {
      for (const batch of batches) batch.geometry.dispose()
      disposeOctagonalKit(disposableKit)
      for (const spy of spies) expect(spy).toHaveBeenCalledExactlyOnceWith()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
