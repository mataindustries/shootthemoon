import { BufferGeometry, ConeGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ModelBatch, OctagonalKit } from '../render/octagonalKit.ts'

export const HELIOS_LOOP_MS = 12000
export const HELIOS_LAUNCH_MS = 7900
export const HELIOS_REVEAL_LAUNCH_MS = 4200
export const HELIOS_REVEAL_LEAD_MS = 3700
export const HELIOS_OPEN_LEAD_MS = 1500
export const HELIOS_LOOP_LIMIT_MS = 36000
export const HELIOS_HELD_POSE_MS = 0
export const L = 92, PARK = -6, PITCH = .45
export const HELIOS_MUZZLE_SPEED = 2 * L / 900
export const COLLAR_S = Array.from({ length: 10 }, (_, k) => 4 + 9.6 * k)
export const PYLON_S = [8.8, 28, 47.2, 66.4, 85.6]
export const RINGS = [{ y: 14, radius: 14.2, tilt: .16, turns: 2 }, { y: 23, radius: 12.6, tilt: -.20, turns: -3 }, { y: 31, radius: 11.312, tilt: .12, turns: 4 }]
export const HELIOS_PATH_SEGMENTS = 14, HELIOS_PATH_SEGMENT_VERTICES = 72
const PI = Math.PI, C = Math.cos(PITCH), S = Math.sin(PITCH)
type Triple = [number, number, number]
const az = (a: number, r: number, y: number): Triple => [Math.sin(a) * r, y, Math.cos(a) * r]
const lin = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)))
const ramp = (t: number, a: number, b: number) => { const x = lin(t, a, b); return x * x * (3 - 2 * x) }
export const heliosGroundY = (x: number, z: number) => -.7 - (1000 - Math.sqrt(1e6 - x * x - z * z))
export function heliosRailPoint(s: number, n = 0, out: [number, number] = [0, 0]) {
  out[0] = 27 + s * C - n * S
  out[1] = 7 + s * S + n * C
  return out
}
export const heliosRevealOrigin = (r: number) => r - HELIOS_REVEAL_LEAD_MS
export const heliosOpenOrigin = (now: number) => now - HELIOS_OPEN_LEAD_MS
export const heliosLoopTime = (now: number, origin: number | null) => origin === null || now - origin >= HELIOS_LOOP_LIMIT_MS ? HELIOS_HELD_POSE_MS : ((now - origin) % HELIOS_LOOP_MS + HELIOS_LOOP_MS) % HELIOS_LOOP_MS
export const heliosLoopRemainingMs = (now: number, origin: number) => Math.max(0, origin + HELIOS_LOOP_LIMIT_MS - now)
export const heliosLoopNeedsFrames = ({ looping, revealing, withinLimit }: { looping: boolean; revealing: boolean; withinLimit: boolean }) => looping && !revealing && withinLimit
function integral(t: number) {
  const x = (t - 4300) / 2100
  return t < 4300 ? 0 : t < 6400 ? 2100 * (x ** 3 - x ** 4 / 2) : t < 7900 ? 1050 + t - 6400 : 2550 + 1000 * (1 - Math.exp(-(t - 7900) / 1000))
}
export const heliosRingAngle = (t: number, i: number) => 2 * PI * RINGS[i]!.turns * (t + 6 * integral(t)) / (HELIOS_LOOP_MS + 6 * integral(HELIOS_LOOP_MS))
export interface HeliosSample {
  reactor: number; surge: number; ringAngles: Triple; lit: number; pathStart: number; pathCount: number
  railHeat: number; sledS: number; payloadS: number | null; payloadVisible: boolean; payloadScale: number
  flash: number; trail: number; trailLength: number; breath: number
  core: number; powerPath: number; railHeatI: number; payloadI: number; flashOpacity: number; trailOpacity: number
}
export function sampleHelios(time: number, out: HeliosSample = { ringAngles: [0, 0, 0] } as HeliosSample): HeliosSample {
  const t = ((time % HELIOS_LOOP_MS) + HELIOS_LOOP_MS) % HELIOS_LOOP_MS
  const fire = (t - 7000) / 900, exit = lin(t, 7900, 9300)
  out.reactor = t < 7900 ? ramp(t, 4000, 5200) : Math.exp(-(t - 7900) / 900)
  out.surge = t < 6400 ? ramp(t, 4300, 6400) : t < 7900 ? 1 : Math.exp(-(t - 7900) / 1000)
  for (let i = 0; i < 3; i++) out.ringAngles[i] = heliosRingAngle(t, i)
  out.lit = t < 5000 || t >= 7900 ? 0 : Math.min(14, 1 + Math.floor(13 * lin(t, 5000, 6500)))
  out.railHeat = t < 5000 ? 0 : t < 7000 ? .35 * lin(t, 5000, 6500) : t < 7900 ? .35 + .65 * fire * fire : Math.exp(-(t - 7900) / 1035)
  out.sledS = t < 6200 ? PARK : t < 6850 ? PARK * (1 - ramp(t, 6200, 6850)) : t < 7000 ? 0 : t < 7900 ? L * fire * fire : t < 8600 ? L - 2.4 * Math.sin(PI / 2 * Math.min(1, (t - 7900) / 140)) * Math.exp(-(t - 7900) / 220) : t < 10800 ? L + (PARK - L) * ramp(t, 8600, 10800) : PARK
  out.payloadS = t >= 7900 && t < 9300 ? L + HELIOS_MUZZLE_SPEED * (t - 7900) : t >= 9300 && t < 10800 ? null : out.sledS
  out.payloadVisible = out.payloadS !== null && out.payloadS > PARK + 1
  out.payloadScale = t >= 7900 && t < 9300 ? 1 - .65 * ramp(exit, .4, 1) : 1
  out.pathStart = t < 7000 ? 0 : 4
  if (t >= 7000) for (let k = 0; k < COLLAR_S.length; k++) if (out.payloadS !== null && COLLAR_S[k]! < out.payloadS) out.pathStart++
  out.pathCount = Math.max(0, out.lit - out.pathStart)
  out.flash = t < 7900 ? 0 : Math.exp(-(t - 7900) / 120)
  out.trail = t < 7000 ? 0 : t < 7900 ? ramp(fire, .45, 1) : t < 9300 ? 1 - ramp(exit, .35, 1) : 0
  out.trailLength = 6 + 30 * (t < 7900 ? fire : 1)
  out.breath = Math.sin(2 * PI * 3 * t / HELIOS_LOOP_MS)
  out.core = .22 + .40 * out.reactor + .02 * out.breath * (1 - out.reactor)
  out.powerPath = t < 7000 ? .50 : .62
  out.railHeatI = .06 + .56 * out.railHeat
  out.payloadI = .08 + .74 * (t >= 7000 && t < 7900 ? fire : t >= 7900 && t < 9300 ? 1 - ramp(exit, .2, 1) : 0)
  out.flashOpacity = .42 * out.flash
  out.trailOpacity = .35 * out.trail
  return out
}

const radiatorAngles = [3 * PI / 8, 5 * PI / 8]
const supports = PYLON_S.flatMap(s => [-1, 1].map(sign => {
  const [x, y] = heliosRailPoint(s, -7.1)
  // Solve the curved-ground height at the splayed foot, not at the rail centre.
  let z = sign * 4, ground = heliosGroundY(x, z)
  for (let i = 0; i < 6; i++) { z = sign * (4 + .08 * (y - ground + 1)); ground = heliosGroundY(x, z) }
  return { top: [-x, y, -sign * 2] as Triple, foot: [-x, ground - 1, -z] as Triple }
}))
export const HELIOS_FOOTINGS = [
  { x: 0, z: 0, bottomY: -2.4 },
  ...Array.from({ length: 8 }, (_, k) => { const [x, , z] = az((k + .5) * PI / 4, 24.5, 0); return { x, z, bottomY: -2 } }),
  { x: -22.5, z: 0, bottomY: -2.2 },
  ...radiatorAngles.map(a => { const [x, , z] = az(a, 29.75, 0); return { x, z, bottomY: -2.2 } }),
  ...supports.map(({ foot: [x, y, z] }) => ({ x, z, bottomY: y - .2 })),
]

export function createHeliosReactorGeometry(kit: OctagonalKit) {
  const parts: Record<string, BufferGeometry[]> = {}
  const matrix = (position: Triple, scale: Triple, rotation: Triple = [0, 0, 0]) => new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale))
  const add = (batch: string, shape: keyof OctagonalKit['shapes'], transform: Matrix4) => { (parts[batch] ??= []).push(kit.shapes[shape].clone().applyMatrix4(transform)) }
  const m = (batch: string, shape: keyof OctagonalKit['shapes'], position: Triple, scale: Triple, rotation?: Triple) => add(batch, shape, matrix(position, scale, rotation))
  const rail = (batch: string, s: number, n: number, z: number, scale: Triple, twist = 0) => {
    const [x, y] = heliosRailPoint(s, n)
    add(batch, 'box', new Matrix4().makeRotationY(PI).multiply(new Matrix4().makeTranslation(x, y, z)).multiply(new Matrix4().makeRotationZ(PITCH)).multiply(new Matrix4().makeRotationX(twist)).scale(new Vector3(...scale)))
  }
  const d = 'dark', g = 'gold'
  m(d, 'bevel', [0, -.1, 0], [25, 4.6, 25])
  for (let k = 0; k < 8; k++) {
    const a = k * PI / 4, b = a + PI / 8
    m(d, 'box', az(b, 24.5, .15), [5, 4.3, 6.5], [0, b, 0])
    m(d, 'bevel', az(a, 14, 6), [4.3, 4, 1.2], [0, a, 0])
    m('core', 'box', az(b, 13.7, 6), [1.7, 3.4, .9], [0, b, 0])
    rail(d, 0, -1 + 5.45 * Math.cos(a), 5.45 * Math.sin(a), [2.2, 1.3, 4.5], a)
    rail(d, 93.5, -1 + 5.1 * Math.cos(a), 5.1 * Math.sin(a), [3, 3, 4.2], a)
    rail('railHeat', 93.5, -1 + 3.75 * Math.cos(a), 3.75 * Math.sin(a), [3.1, .3, 3.1], a)
    for (const s of COLLAR_S) rail(d, s, -1 + 4.3 * Math.cos(a), 4.3 * Math.sin(a), [1.8, 1.8, 3.56], a)
  }
  for (let j = 0; j < 4; j++) {
    const b = PI / 4 + j * PI / 2, a = j * PI / 2
    m(d, 'bevel', az(b, 18.5, 19.1), [1.3, 33.8, 1.3])
    m(g, 'bevel', az(b, 18.5, 36.6), [2, 1.2, 2])
    for (const { y, radius } of RINGS) {
      const tip = 1.1 * radius + 1.2
      m(d, 'box', az(b, (18.5 + tip) / 2, y), [1, 1, 18.5 - tip], [0, b, 0])
      m(g, 'box', az(b, tip, y), [1.4, 2, 1.2], [0, b, 0])
    }
    m('ring', 'bevel', az(a, 1, 0), [.12, .16, .087], [0, a, 0])
    rail(g, 96.5, -1 + 4.6 * Math.cos(b), 4.6 * Math.sin(b), [6, .8, .8])
  }
  m(d, 'bevel', [-22.5, 5.75, 0], [5.95, 9.5, 4.9])
  m(d, 'box', [-22.5, -.6, 0], [11.5, 3.2, 9.4])
  m(g, 'box', [-22.5, 10.75, 0], [11.6, .5, 9.6])
  m(g, 'ring', [0, 8.05, 0], [14.3, 14.3, 4], [PI / 2, 0, 0])
  m('ring', 'ring', [0, 0, 0], [1, 1, 1.6], [PI / 2, 0, 0])
  m('core', 'ring', [0, 4.3, 0], [12.2, 12.2, 3], [PI / 2, 0, 0])
  rail(d, 42.5, -5.3, 0, [105, 3.6, 5.2])
  for (const s of COLLAR_S) {
    rail(d, s, -8.4, 0, [3.2, 2.6, 4.4])
    rail(g, s, 4.45, 0, [1.9, .5, 3.7])
  }
  for (const a of radiatorAngles) {
    m(d, 'box', az(a, 25, 13.15), [1, 21.7, 12], [0, a, 0])
    m(d, 'box', az(a, 29.75, .05), [2.4, 4.5, 3.5])
    m(g, 'box', az(a, 25, 24.25), [1.3, .5, 12.4], [0, a, 0])
    for (const y of [7.5, 13.2, 18.9]) for (const sign of [-1, 1]) {
      const p = az(a, 25, y)
      p[0] += sign * .56 * Math.cos(a); p[2] -= sign * .56 * Math.sin(a)
      m('railHeat', 'box', p, [.12, .5, 11], [0, a, 0])
    }
  }
  const line = (a: Triple, b: Triple, width: number) => {
    const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start)
    add(d, 'box', new Matrix4().compose(start.add(end).multiplyScalar(.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize()), new Vector3(width, delta.length(), width)))
  }
  for (let i = 0; i < supports.length; i += 2) {
    const pair = supports.slice(i, i + 2)
    for (const { top, foot } of pair) {
      line(foot, top, 1.6)
      m(d, 'box', [foot[0], foot[1] + .4, foot[2]], [3.6, 1.2, 3.6])
    }
    const brace = pair.map(({ top, foot }) => foot.map((v, j) => v + .45 * (top[j]! - v)) as Triple)
    line(brace[0]!, brace[1]!, 1)
  }
  for (const sign of [-1, 1]) {
    m(d, 'box', [-14.8, 8.75, sign * 2.6], [4.8, 1.5, 1.5])
    rail('railHeat', 42.5, -3.25, sign * 1.6, [105, .7, .7])
    m('sled', 'box', [0, -3.05, sign * 1.6], [7.4, .4, .6])
  }
  // Keep both boxes of each segment contiguous for the advancing draw range.
  for (let k = 0; k < HELIOS_PATH_SEGMENTS; k++) for (const sign of [-1, 1]) {
    if (k < 4) m('powerPath', 'box', [-12.4 - 1.2 * (k + .5), 9.55, sign * 2.6], [1.05, .15, .7])
    else rail('powerPath', COLLAR_S[k - 4]!, -8.1, sign * 2.25, [2.6, .5, .12])
  }
  m('sled', 'box', [0, -2.45, 0], [7, 1.1, 4.2])
  m('payload', 'bevel', [0, 0, 0], [1.9, 7, 1.9], [0, 0, -PI / 2])
  m('payload', 'taper', [5, 0, 0], [1.9, 3, 1.9], [0, 0, -PI / 2])
  m('payload', 'ring', [-3.6, 0, 0], [2.05, 2.05, 2], [0, PI / 2, 0])
  const merge = (key: string) => { const geometry = mergeGeometries(parts[key]!)!; parts[key]!.forEach(p => p.dispose()); geometry.computeBoundingSphere(); return geometry }
  return {
    static: [d, g].map(finish => ({ finish, geometry: merge(finish) })) as ModelBatch[],
    ring: merge('ring'), core: merge('core'), powerPath: merge('powerPath'), railHeat: merge('railHeat'),
    sled: merge('sled'), payload: merge('payload'), cone: new ConeGeometry(1, 1, 8, 1, true).rotateZ(PI / 2).translate(.5, 0, 0),
  }
}
