import { BufferGeometry, Euler, Matrix4, Quaternion, Sphere, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { AddPart, OctagonalKit } from '../render/octagonalKit.ts'

const PI = Math.PI
type Triple = [number, number, number]
type Batch = 'dark' | 'gold' | 'emitter'
type BodyRange = { batch: Batch, body: number, start: number, count: number }
interface SignalArrayHead {
  dark: BufferGeometry
  gold: BufferGeometry
  goldGlow: BufferGeometry
  emitter: BufferGeometry
  bodies: readonly BodyRange[]
}

export const SIGNAL_HERO_AZIMUTH = -PI / 8
export const SIGNAL_PARK_AZIMUTH = -3 * PI / 8
export const SIGNAL_FAN_ELEVATION = PI / 6
export const SIGNAL_ROTOR_PIVOT: Triple = [0, 31, 0]
export const SIGNAL_HUB_HEIGHT = 5
export const SIGNAL_VANE_SLOTS = [-3, -2, -1, 0, 1, 2, 3] as const
export const SIGNAL_VANE_LAYER = .8
export const SIGNAL_PETAL_VERTICES = 96
export const SIGNAL_STOWED_MS = 0
export const SIGNAL_HELD_MS = 4400
export const SIGNAL_HEAD_BOUNDS = { center: [0, 36, 0] as Triple, radius: 27.5 }

const az = (a: number, r: number, y: number): Triple => [Math.sin(a) * r, y, Math.cos(a) * r]
export const SIGNAL_FOOTINGS = [
  { x: 0, z: 0, bottomY: -2.3 },
  ...Array.from({ length: 4 }, (_, k) => {
    const [x, , z] = az(k * PI / 2, 17.5, 0)
    return { x, z, bottomY: -2.2 }
  }),
]

export const signalVaneAngle = (k: number, deployed: boolean): number => deployed ? k * PI / 8 : k * PI / 24

export function authorSignalArrayBase(add: AddPart): void {
  add('bevel', 'dark', [0, -.3, 0], [10.5, 4, 10.5])
  add('bevel', 'gold', [0, 1, 0], [10.8, .5, 10.8])
  add('bevel', 'dark', [0, 6, 0], [5.5, 9, 5.5])
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2
    add('box', 'dark', az(a, 11.2, 3.6), [13.4, 4, 3.2], [0, a - PI / 2, -Math.atan2(6, 11)])
  }
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2
    add('bevel', 'dark', az(a, 17.5, -.5), [2.6, 3.4, 2.6])
    add('bevel', 'gold', az(a, 17.5, 1.45), [2, .6, 2])
  }
  add('bevel', 'dark', [0, 15.25, 0], [4, 9.5, 4])
  add('bevel', 'gold', [0, 20, 0], [4.4, .9, 4.4])
  add('bevel', 'dark', [0, 24.9, 0], [3.1, 9.8, 3.1])
  add('bevel', 'gold', [0, 30.4, 0], [4.5, 1.2, 4.5])
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2
    add('box', 'amber', az(a, 4 * Math.cos(PI / 8) + .05, 15.25), [.9, 5, .3], [0, a, 0])
  }
}

export interface SignalArrayPose {
  yaw: number
  vanes: number[]
  lit: number
  glow: number
  emitter: number
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const lin = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1)
const ease = (x: number) => x * x * (3 - 2 * x)
// Preserve authored endpoints exactly despite floating-point cancellation.
const mix = (a: number, b: number, x: number) => x === 0 ? a : x === 1 ? b : a + (b - a) * x

export function sampleSignalArray(timeMs: number, out: SignalArrayPose = { yaw: 0, vanes: [], lit: 0, glow: 0, emitter: 0 }): SignalArrayPose {
  const t = clamp(timeMs, SIGNAL_STOWED_MS, SIGNAL_HELD_MS)
  out.yaw = mix(SIGNAL_PARK_AZIMUTH, SIGNAL_HERO_AZIMUTH, ease(lin(t, 250, 1150)))
  out.vanes.length = SIGNAL_VANE_SLOTS.length
  SIGNAL_VANE_SLOTS.forEach((k, i) => {
    const s = 450 + 180 * (3 - Math.abs(k))
    out.vanes[i] = mix(signalVaneAngle(k, false), signalVaneAngle(k, true), ease(lin(t, s, s + 1100)))
  })
  out.lit = t < 1950 || t >= SIGNAL_HELD_MS ? 0 : Math.min(7, Math.ceil(7 * (t - 1950) / 550))
  out.glow = t < 1950 ? .08 : t < 2750 ? .60 : mix(.60, .08, ease(lin(t, 2750, 4200)))
  out.emitter = t < 450 ? .06 : t < 2500 ? .06 + .12 * ease(lin(t, 450, 2500))
    : t < 2750 ? .18 + .64 * ease(lin(t, 2500, 2750)) : mix(.82, .34, ease(lin(t, 2750, 4200)))
  return out
}

export function signalArrayPoseTime({ complete, revealAtMs, nowMs, reducedMotion }: {
  complete: boolean
  revealAtMs: number | null
  nowMs: number
  reducedMotion: boolean
}): number {
  if (!complete) return SIGNAL_STOWED_MS
  return revealAtMs !== null && !reducedMotion ? clamp(nowMs - revealAtMs, SIGNAL_STOWED_MS, SIGNAL_HELD_MS) : SIGNAL_HELD_MS
}

const frame = new Matrix4().makeTranslation(0, SIGNAL_HUB_HEIGHT, 0)
  .multiply(new Matrix4().makeRotationX(-SIGNAL_FAN_ELEVATION))
const scratch = new Matrix4()
export function signalBodyMatrix(body: number, pose: SignalArrayPose, out: Matrix4): Matrix4 {
  out.makeTranslation(...SIGNAL_ROTOR_PIVOT).multiply(scratch.makeRotationY(pose.yaw))
  if (body > 0) {
    const i = body - 1
    out.multiply(frame).multiply(scratch.makeRotationZ(-pose.vanes[i]!))
      .multiply(scratch.makeTranslation(0, 0, SIGNAL_VANE_LAYER * SIGNAL_VANE_SLOTS[i]!))
  }
  return out
}

const rimPosition: Triple = [0, 25.3, -.05]
const rimScale: Triple = [9.4, 1.6, .6]
// The outer rim supplies the stowed upper envelope; measure its authored corners.
export const SIGNAL_STOWED_TOP_Y = (() => {
  const pose = sampleSignalArray(SIGNAL_STOWED_MS), matrix = new Matrix4(), point = new Vector3()
  let top = -Infinity
  for (let body = 1; body <= SIGNAL_VANE_SLOTS.length; body++) {
    signalBodyMatrix(body, pose, matrix)
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      point.set(rimPosition[0] + x * rimScale[0], rimPosition[1] + y * rimScale[1], rimPosition[2] + z * rimScale[2])
      top = Math.max(top, point.applyMatrix4(matrix).y)
    }
  }
  return top
})()

const batches: readonly Batch[] = ['dark', 'gold', 'emitter']
type Rest = { position: Float32Array, normal: Float32Array }
const rest = new WeakMap<SignalArrayHead, Record<Batch, Rest>>()

export function createSignalArrayHead(kit: OctagonalKit): SignalArrayHead {
  const parts: Record<Batch, BufferGeometry[]> = { dark: [], gold: [], emitter: [] }
  const ranges: Record<Batch, BodyRange[]> = { dark: [], gold: [], emitter: [] }
  const counts: Record<Batch, number> = { dark: 0, gold: 0, emitter: 0 }
  const add = (body: number, batch: Batch, shape: keyof OctagonalKit['shapes'], position: Triple, scale: Triple, rotation: Triple = [0, 0, 0], inFrame = false) => {
    const matrix = new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale))
    if (inFrame) matrix.premultiply(frame)
    const geometry = kit.shapes[shape].clone().applyMatrix4(matrix)
    const count = geometry.getAttribute('position').count
    const previous = ranges[batch].at(-1)
    if (previous?.body === body) previous.count += count
    else ranges[batch].push({ batch, body, start: counts[batch], count })
    counts[batch] += count
    parts[batch].push(geometry)
  }

  const X: Triple = [PI / 2, 0, 0]
  add(0, 'dark', 'bevel', [0, 1.2, 0], [3.7, 2.4, 3.7])
  add(0, 'dark', 'bevel', [0, 0, 0], [4.2, 5.6, 4.2], X, true)
  add(0, 'emitter', 'bevel', [0, 0, 2.9], [2.4, .4, 2.4], X, true)
  add(0, 'dark', 'bevel', [0, 0, 9.3], [1, 13, 1], X, true)
  add(0, 'dark', 'bevel', [0, 0, 16.6], [2.4, 2.4, 2.4], X, true)
  add(0, 'emitter', 'bevel', [0, 0, 17.9], [1.8, .5, 1.8], X, true)
  add(0, 'dark', 'box', [0, .4, -4.9], [5, 4.4, 3.6], [0, 0, 0], true)
  for (let i = 0; i < SIGNAL_VANE_SLOTS.length; i++) {
    add(i + 1, 'dark', 'box', [0, 11, -.2], [.8, 16, .36])
    add(i + 1, 'dark', 'box', [0, 16, .22], [5.6, .9, .28])
    add(i + 1, 'dark', 'box', rimPosition, rimScale)
  }
  for (let body = SIGNAL_VANE_SLOTS.length; body >= 1; body--) {
    add(body, 'gold', 'taper', [0, 16.75, .14], [5.2, 16.5, .15], [0, 0, PI])
  }
  add(0, 'gold', 'ring', [0, 0, 2.9], [3.6, 3.6, 3], [0, 0, 0], true)
  add(0, 'gold', 'ring', [0, 0, 17.6], [3.1, 3.1, 2.4], [0, 0, 0], true)

  const merge = (batch: Batch) => {
    const geometry = mergeGeometries(parts[batch])!
    parts[batch].forEach(part => part.dispose())
    return geometry
  }
  const dark = merge('dark'), gold = merge('gold'), emitter = merge('emitter')
  const goldGlow = new BufferGeometry()
    .setAttribute('position', gold.getAttribute('position'))
    .setAttribute('normal', gold.getAttribute('normal'))
    .setIndex(gold.index)
  const head = { dark, gold, goldGlow, emitter, bodies: batches.flatMap(batch => ranges[batch]) }
  for (const geometry of [dark, gold, goldGlow, emitter]) {
    geometry.boundingSphere = new Sphere(new Vector3(...SIGNAL_HEAD_BOUNDS.center), SIGNAL_HEAD_BOUNDS.radius)
  }
  const capture = (geometry: BufferGeometry): Rest => ({
    position: new Float32Array(geometry.getAttribute('position').array),
    normal: new Float32Array(geometry.getAttribute('normal').array),
  })
  rest.set(head, { dark: capture(dark), gold: capture(gold), emitter: capture(emitter) })
  applySignalSweepRanges(head, 0)
  return head
}

export function poseSignalArrayHead(head: SignalArrayHead, pose: SignalArrayPose): void {
  const arrays = rest.get(head)!
  const matrix = new Matrix4(), point = new Vector3(), normal = new Vector3()
  for (const { batch, body, start, count } of head.bodies) {
    signalBodyMatrix(body, pose, matrix)
    const position = head[batch].getAttribute('position'), normals = head[batch].getAttribute('normal')
    for (let i = start; i < start + count; i++) {
      point.fromArray(arrays[batch].position, i * 3).applyMatrix4(matrix)
      normal.fromArray(arrays[batch].normal, i * 3).transformDirection(matrix)
      position.setXYZ(i, point.x, point.y, point.z)
      normals.setXYZ(i, normal.x, normal.y, normal.z)
    }
  }
  for (const batch of batches) {
    head[batch].getAttribute('position').needsUpdate = true
    head[batch].getAttribute('normal').needsUpdate = true
  }
}

export function applySignalSweepRanges(head: SignalArrayHead, lit: number): void {
  const count = clamp(Math.trunc(lit), 0, SIGNAL_VANE_SLOTS.length) * SIGNAL_PETAL_VERTICES
  const total = head.gold.index?.count ?? head.gold.getAttribute('position').count
  head.goldGlow.setDrawRange(0, count)
  head.gold.setDrawRange(count, total - count)
}

export function disposeSignalArrayHead(head: SignalArrayHead): void {
  if (!rest.delete(head)) return
  head.goldGlow.deleteAttribute('position').deleteAttribute('normal').setIndex(null)
  for (const geometry of [head.dark, head.gold, head.goldGlow, head.emitter]) geometry.dispose()
}
