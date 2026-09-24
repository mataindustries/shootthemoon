import { afterAll, describe, expect, it } from 'vitest'
import { BufferGeometry, Matrix4, Vector3 } from 'three'
import { ROBOT_IDLE_POSITION } from '../domain/outpost.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import { CAPSULE_SERVICE_ANCHOR } from './miningPresentation.ts'
import {
  CAPSULE_SCALE,
  LANDER_BODY_SHIFT,
  LANDER_BODY_YAW,
  LANDER_DOOR,
  LANDER_ENGINE_EXIT_Y,
  LANDER_GARAGE,
  LANDER_LEG_SWEEP,
  LANDER_PAD,
  LANDER_PAD_BOTTOM_Y,
  LANDER_TOP_Y,
  SHAPE_HALF,
  authorLander,
  bodyMatrix,
  createLanderGeometry,
  rampPivotModel,
  rampUndersidePoints,
  visorPivotModel,
  type LanderPart,
} from './landerModel.ts'

const OFFSETS = [-.08, 0, -.05, -.02] as const
const BATCHES = ['hull', 'ramp', 'visor'] as const
const RAMP_ANGLE = 1.90
const GEAR = /^leg\d-(pad|ankle|rod|pad-stripe)$/
const authored = authorLander(OFFSETS)
const geometry = createLanderGeometry(OFFSETS)

afterAll(() => {
  for (const batch of BATCHES) geometry[batch].dispose()
})

function center(part: LanderPart): Vector3 {
  return new Vector3().setFromMatrixPosition(part.matrix)
}

function corners(part: LanderPart): Vector3[] {
  const half = SHAPE_HALF[part.shape]
  const points: Vector3[] = []
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        points.push(new Vector3(x * half[0], y * half[1], z * half[2]).applyMatrix4(part.matrix))
      }
    }
  }
  return points
}

function leafMatrix(pivot: Vector3, angle: number): Matrix4 {
  return new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationY(LANDER_BODY_YAW))
    .multiply(new Matrix4().makeRotationX(angle))
}

const rampOpen = leafMatrix(rampPivotModel(), RAMP_ANGLE)
// A downward-hanging visor opens outward with a negative local X rotation.
const visorOpen = leafMatrix(visorPivotModel(), -LANDER_DOOR.visorOpenAngle)

function vertices(batch: BufferGeometry, transform?: Matrix4): Vector3[] {
  const position = batch.getAttribute('position')
  return Array.from({ length: position.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(position, index)
    return transform ? point.applyMatrix4(transform) : point
  })
}

function expectNear(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(tolerance)
}

function angleDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function boundingBoxValues(batch: BufferGeometry): number[] {
  const bounds = batch.boundingBox
  if (!bounds) throw new Error('Merged lander geometry must have a computed bounding box')
  return [...bounds.min.toArray(), ...bounds.max.toArray()]
}

describe('frontier lunar industrial lander', () => {
  it('aligns the body with the idle miner and the service socket with its anchor', () => {
    const expectedYaw = Math.atan2(ROBOT_IDLE_POSITION.xM, ROBOT_IDLE_POSITION.zM - .45)
    expectNear(LANDER_BODY_YAW, expectedYaw, 1e-12, 'body yaw')
    expectNear(authored.yaw, expectedYaw, 1e-12, 'authored yaw')
    expectNear(geometry.yaw, expectedYaw, 1e-12, 'merged geometry yaw')
    expect(LANDER_BODY_SHIFT).toBe(-.09)
    expect(CAPSULE_SCALE).toBe(.00029)

    const sockets = authored.hull.filter(part => part.label === 'service-socket')
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]!
    const point = center(socket)
    const expectedBearing = Math.atan2(CAPSULE_SERVICE_ANCHOR.xM, CAPSULE_SERVICE_ANCHOR.zM)
    expect(angleDistance(Math.atan2(point.x, point.z), expectedBearing)).toBeLessThanOrEqual(1e-9)

    const expectedBody = new Matrix4().makeTranslation(
      Math.cos(expectedYaw) * LANDER_BODY_SHIFT,
      0,
      -Math.sin(expectedYaw) * LANDER_BODY_SHIFT,
    ).multiply(new Matrix4().makeRotationY(expectedYaw))
    expect(bodyMatrix().elements).toEqual(expectedBody.elements)
  })

  it('places four pad centres on the prescribed model-frame axes', () => {
    expect(LANDER_PAD).toEqual({ radius: 1.04, centerY: -1.08, halfHeight: .045, halfX: .24, halfZ: .21 })
    expect(LANDER_LEG_SWEEP).toEqual([-1, 0, 0, 1])
    const pads = authored.hull.filter(part => /^leg\d-pad$/.test(part.label))
    expect(pads).toHaveLength(4)
    const expectedXZ = [[1.04, 0], [0, -1.04], [-1.04, 0], [0, 1.04]] as const
    for (let leg = 0; leg < 4; leg++) {
      const pad = pads.find(part => part.label === `leg${leg}-pad`)
      expect(pad, `leg ${leg} pad`).toBeDefined()
      const point = center(pad!)
      expectNear(Math.hypot(point.x, point.z), 1.04, 1e-9, `leg ${leg} pad radius`)
      expectNear(point.x, expectedXZ[leg]![0], 1e-9, `leg ${leg} pad x`)
      expectNear(point.z, expectedXZ[leg]![1], 1e-9, `leg ${leg} pad z`)
    }
  })

  it('adjusts the contact plane per pad while keeping non-gear above the engine exits', () => {
    expect(LANDER_PAD_BOTTOM_Y).toBe(-1.125)
    for (let leg = 0; leg < 4; leg++) {
      const pad = authored.hull.find(part => part.label === `leg${leg}-pad`)!
      const bottom = Math.min(...corners(pad).map(point => point.y))
      expectNear(bottom, LANDER_PAD_BOTTOM_Y + OFFSETS[leg]!, 1e-9, `leg ${leg} contact plane`)
    }
    const nonGearBottom = Math.min(...authored.hull.filter(part => !GEAR.test(part.label))
      .flatMap(part => corners(part).map(point => point.y)))
    expectNear(nonGearBottom, -1, .002, 'lowest non-gear corner')
  })

  it('keeps the hull and opened leaves within their model envelopes', () => {
    expect(LANDER_TOP_Y).toBe(1.6)
    const hull = vertices(geometry.hull)
    const minimumPadBottom = LANDER_PAD_BOTTOM_Y + Math.min(...OFFSETS)
    expect(Math.max(...hull.map(point => Math.hypot(point.x, point.z)))).toBeLessThanOrEqual(1.28)
    expect(Math.max(...hull.map(point => Math.abs(point.x)))).toBeLessThanOrEqual(1.28)
    expect(Math.max(...hull.map(point => point.y))).toBeLessThanOrEqual(1.60 + 1e-6)
    // Contact is checked on double-precision authored corners above; merged
    // Float32 positions can round below an exact decimal contact plane.
    const authoredBottom = Math.min(...authored.hull.flatMap(part => corners(part).map(point => point.y)))
    expect(authoredBottom).toBeGreaterThanOrEqual(minimumPadBottom - 1e-9)
    expect(Math.min(...hull.map(point => point.y))).toBeGreaterThanOrEqual(minimumPadBottom - 1e-7)

    for (const [batch, transform] of [[geometry.ramp, rampOpen], [geometry.visor, visorOpen]] as const) {
      const opened = vertices(batch, transform)
      expect(Math.max(...opened.map(point => Math.hypot(point.x, point.z)))).toBeLessThanOrEqual(1.30)
      expect(Math.max(...opened.map(point => point.y))).toBeLessThanOrEqual(.10)
    }
  })

  it('authors four descent engine bells ending at y = -1', () => {
    expect(LANDER_ENGINE_EXIT_Y).toBe(-1)
    const bells = authored.hull.filter(part => part.label === 'engine-bell')
    expect(bells).toHaveLength(4)
    for (const bell of bells) {
      expect(bell.shape).toBe('bell')
      expectNear(Math.min(...corners(bell).map(point => point.y)), -1, 1e-6, 'engine-bell bottom')
      const point = center(bell)
      expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(.95)
    }
  })

  it('keeps the garage departure volume clear and points the ramp toward the idle miner', () => {
    expect(LANDER_GARAGE).toEqual({ halfWidth: .60, floorTopY: -.92, ceilingY: -.10, mouthZ: .60, backZ: -.30 })
    const inverseBody = bodyMatrix().invert()
    const obstacles = [
      ...authored.hull.map(part => ({ part, transform: new Matrix4() })),
      ...authored.ramp.map(part => ({ part, transform: rampOpen })),
      ...authored.visor.map(part => ({ part, transform: visorOpen })),
    ]
    for (const { part, transform } of obstacles) {
      for (const point of corners(part)) {
        point.applyMatrix4(transform).applyMatrix4(inverseBody)
        const inside = point.x > -.55 && point.x < .46
          && point.z > .74 && point.z < 1.60
          && point.y > -.88 && point.y < -.16
        expect(inside, `${part.label} corner in miner clearance: ${point.toArray().join(', ')}`).toBe(false)
      }
    }

    // Approved render conversion: .00012 world units per metre, giving
    // 2.4166666666666665 metres per model unit at the specified capsule scale.
    const metresPerModelUnit = CAPSULE_SCALE / .00012
    const pivot = rampPivotModel()
    const bearing = Math.atan2(
      ROBOT_IDLE_POSITION.xM / metresPerModelUnit - pivot.x,
      ROBOT_IDLE_POSITION.zM / metresPerModelUnit - pivot.z,
    )
    expect(angleDistance(bearing, LANDER_BODY_YAW)).toBeLessThanOrEqual(.035)
  })

  it('leaves the solar socket approach clear of non-solar hull corners', () => {
    const violations: { label: string; corner: number[] }[] = []
    for (const part of authored.hull.filter(part => !part.label.startsWith('solar-'))) {
      for (const point of corners(part)) {
        const inside = point.x > -1.30 && point.x < -.735
          && Math.abs(point.z) < .10 && point.y > -.74 && point.y < -.46
        if (inside) violations.push({ label: part.label, corner: point.toArray() })
      }
    }
    expect(violations, 'Non-solar hull corners inside the specified solar approach').toEqual([])
  })

  it('merges exactly three batches within the triangle budgets', () => {
    const budgets = { hull: 2600, ramp: 130, visor: 80 }
    const counts = BATCHES.map(batch => {
      const triangles = geometry[batch].getAttribute('position').count / 3
      expect(Number.isInteger(triangles), `${batch} complete triangles`).toBe(true)
      expect(triangles, `${batch} triangles`).toBeGreaterThan(0)
      expect(triangles, `${batch} triangle budget`).toBeLessThanOrEqual(budgets[batch])
      return `${batch}: ${triangles} triangles, ${authored[batch].length} parts`
    })
    expect(BATCHES.map(batch => geometry[batch])).toHaveLength(3)
    console.info(`Lander geometry: ${counts.join('; ')}; 3 final geometries`)
  })

  it('emits non-indexed geometry with complete vertex attributes and computed bounds', () => {
    const attributes = { position: 3, normal: 3, uv: 2, color: 3, miningFinish: 4 }
    for (const batch of BATCHES) {
      const result = geometry[batch]
      expect(result.index, `${batch} index`).toBeNull()
      expect(Object.keys(result.attributes).sort()).toEqual(Object.keys(attributes).sort())
      const count = result.getAttribute('position').count
      for (const [name, itemSize] of Object.entries(attributes)) {
        const attribute = result.getAttribute(name)
        expect(attribute.itemSize, `${batch}.${name} itemSize`).toBe(itemSize)
        expect(attribute.count, `${batch}.${name} count`).toBe(count)
        expect(Array.from(attribute.array).every(Number.isFinite), `${batch}.${name} finite values`).toBe(true)
      }
      expect(boundingBoxValues(result).every(Number.isFinite), `${batch} bounding box`).toBe(true)
      expect(result.boundingSphere, `${batch} bounding sphere`).not.toBeNull()
      expect(Number.isFinite(result.boundingSphere!.radius), `${batch} bounding radius`).toBe(true)
    }
  })

  it('uses only the prescribed emissive limits and keeps LEDs tiny', () => {
    const allowed = [0, EMISSIVE_LIMITS.residualHeat, EMISSIVE_LIMITS.panel, EMISSIVE_LIMITS.tinyLed]
    const seen = new Set<number>()
    for (const batch of BATCHES) {
      const finish = geometry[batch].getAttribute('miningFinish')
      for (let index = 0; index < finish.count; index++) {
        const emission = finish.getZ(index)
        expect(allowed.some(value => Math.abs(value - emission) <= 1e-7), `${batch} emission ${emission}`).toBe(true)
        seen.add(emission)
      }
    }
    for (const expected of allowed) {
      expect([...seen].some(value => Math.abs(value - expected) <= 1e-7), `emission ${expected} present`).toBe(true)
    }
    const leds = BATCHES.flatMap(batch => authored[batch]).filter(part => part.finish === 'led')
    expect(leds.length).toBeGreaterThan(0)
    for (const part of leds) {
      const scale = new Vector3().setFromMatrixScale(part.matrix)
      expect(Math.max(scale.x, scale.y, scale.z), `${part.label} LED scale`).toBeLessThanOrEqual(.06 + 1e-12)
    }
  })

  it('uses local Z as the smallest dimension of every two-sided panel', () => {
    expect(SHAPE_HALF).toEqual({
      box: [.5, .5, .5], panel: [.5, .5, .5],
      prism: [1, .5, 1], block: [1, .5, 1], drum: [1, .5, 1], rod: [1, .5, 1], bell: [1, .5, 1],
    })
    const panels = BATCHES.flatMap(batch => authored[batch]).filter(part => part.shape === 'panel')
    expect(panels.length).toBeGreaterThan(0)
    for (const part of panels) {
      const scale = new Vector3().setFromMatrixScale(part.matrix)
      expect(scale.z, `${part.label} panel Z versus X`).toBeLessThanOrEqual(scale.x + 1e-12)
      expect(scale.z, `${part.label} panel Z versus Y`).toBeLessThanOrEqual(scale.y + 1e-12)
    }
  })

  it('transforms the specified pivots and ramp underside samples through the body frame', () => {
    expect(LANDER_DOOR).toEqual({
      planeZ: .67, halfWidth: .56, halfThickness: .035, rampHalfThickness: .018,
      rampLength: .42, visorLength: .40, visorOpenAngle: 1.85,
    })
    const rampExpected = new Vector3(0, -.92, .67).applyMatrix4(bodyMatrix())
    const visorExpected = new Vector3(0, -.10, .67).applyMatrix4(bodyMatrix())
    for (const actual of [rampPivotModel(), authored.rampPivot, geometry.rampPivot]) {
      expect(actual.distanceTo(rampExpected)).toBeLessThanOrEqual(1e-12)
    }
    for (const actual of [visorPivotModel(), authored.visorPivot, geometry.visorPivot]) {
      expect(actual.distanceTo(visorExpected)).toBeLessThanOrEqual(1e-12)
    }
    for (const theta of [0, RAMP_ANGLE]) {
      const samples = rampUndersidePoints(theta)
      const expected: Vector3[] = []
      for (const side of [-1, 1]) {
        for (const fraction of [.5, .75, 1]) {
          expected.push(new Vector3(side * .54, fraction * .42, .018)
            .applyMatrix4(new Matrix4().makeRotationX(theta))
            .applyMatrix4(new Matrix4().makeRotationY(LANDER_BODY_YAW))
            .add(rampExpected))
        }
      }
      expect(samples).toHaveLength(6)
      for (let index = 0; index < samples.length; index++) {
        expect(samples[index]!.distanceTo(expected[index]!)).toBeLessThanOrEqual(1e-12)
      }
    }
    for (const [parts, transform] of [[authored.ramp, rampOpen], [authored.visor, visorOpen]] as const) {
      for (const point of parts.flatMap(corners)) {
        point.applyMatrix4(transform)
        expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(1.30)
        expect(point.y).toBeLessThanOrEqual(.10)
      }
    }
  })

  it('authors and merges deterministically for identical pad offsets', () => {
    const secondAuthored = authorLander(OFFSETS)
    const secondGeometry = createLanderGeometry(OFFSETS)
    try {
      for (const batch of BATCHES) {
        const snapshot = (parts: LanderPart[]) => parts.map(part => ({
          label: part.label, shape: part.shape, finish: part.finish, matrix: part.matrix.elements,
        }))
        expect(secondAuthored[batch].length, `${batch} part count`).toBe(authored[batch].length)
        expect(snapshot(secondAuthored[batch]), `${batch} authored order and transforms`).toEqual(snapshot(authored[batch]))
        expect(secondGeometry[batch].getAttribute('position').count / 3, `${batch} triangles`)
          .toBe(geometry[batch].getAttribute('position').count / 3)
        expect(boundingBoxValues(secondGeometry[batch]), `${batch} bounds`).toEqual(boundingBoxValues(geometry[batch]))
        expect(Object.keys(secondGeometry[batch].attributes)).toEqual(Object.keys(geometry[batch].attributes))
        for (const name of Object.keys(geometry[batch].attributes)) {
          expect(secondGeometry[batch].getAttribute(name).count, `${batch}.${name} deterministic count`)
            .toBe(geometry[batch].getAttribute(name).count)
        }
      }
    } finally {
      for (const batch of BATCHES) secondGeometry[batch].dispose()
    }
  })
})
