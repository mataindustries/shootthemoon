import type { AddPart } from '../render/octagonalKit.ts'

export type Vec3 = [number, number, number]

const H = Math.PI / 2
const Q = Math.PI / 4

export const INTERCEPTOR_SCALE = {
  lead: .0082,
  escort: .0066,
} as const

export const VANE_PIVOTS: readonly [Vec3, Vec3] = [
  [.44, -.02, .10],
  [-.44, -.02, .10],
]

export const VANE_EMITTER_LOCAL: Vec3 = [0, 0, 1.16]

export const VANE_TUCKED = {
  yaw: 155 * Math.PI / 180,
  pitch: 0,
}

export const VANE_DEPLOYED = {
  yaw: 30 * Math.PI / 180,
  pitch: 8 * Math.PI / 180,
}

export const NOZZLE_EXITS: readonly [Vec3, Vec3] = [
  [.28, .02, -1.60],
  [-.28, .02, -1.60],
]

export const INTERCEPTOR_ENVELOPE: { min: Vec3, max: Vec3 } = {
  min: [-1.593, -.350, -1.601],
  max: [1.593, .479, 1.351],
}

export function authorInterceptorHull(add: AddPart) {
  add('taper', 'dark', [0, 0, .30], [.60, 2.10, .30], [H, 0, 0])
  add('taper', 'dark', [0, .17, .05], [.34, 1.40, .14], [H + .11, 0, 0])
  add('bevel', 'dark', [0, .02, -.62], [.56, 1.00, .40], [H, 0, 0])
  add('box', 'gold', [0, .40, -.20], [.11, .11, .90], [0, 0, Q])
  add('bevel', 'gold', [0, .40, -.80], [.24, .06, .24])
  add('box', 'cyan', [0, .095, .98], [.30, .03, .05], [.11, 0, 0])
  add('box', 'dark', [0, -.24, -.05], [.12, .12, 1.50], [0, 0, Q])
  add('box', 'dark', [0, .02, -1.22], [.96, .34, .26])
  add('taper', 'amber', [.28, .02, -1.47], [.15, .26, .15], [H, 0, 0])
  add('taper', 'amber', [-.28, .02, -1.47], [.15, .26, .15], [H, 0, 0])
  add('box', 'gold', [.42, -.02, .10], [.14, .14, .26])
  add('box', 'gold', [-.42, -.02, .10], [.14, .14, .26])
}

export function authorInterceptorVane(add: AddPart) {
  add('box', 'gold', [0, 0, .54], [.085, .085, 1.02], [0, 0, Q])
  add('box', 'gold', [0, 0, 1.08], [.15, .09, .14])
}

// Vane instance = M_ship · T(pivot) · Ry(side * yaw) · Rx(pitch); never mirror with negative scale: instancing does not reverse triangle winding.
export function interceptorEmitterLocal(side: 1 | -1, vaneYaw: number, vanePitch: number, out: Vec3): Vec3 {
  const pivot = side === 1
    ? VANE_PIVOTS[0]
    : VANE_PIVOTS[1]
  const [x, y, z] = VANE_EMITTER_LOCAL
  const sinPitch = Math.sin(vanePitch), cosPitch = Math.cos(vanePitch)
  const sinYaw = Math.sin(side * vaneYaw), cosYaw = Math.cos(side * vaneYaw)
  const pitchY = y * cosPitch - z * sinPitch
  const pitchZ = y * sinPitch + z * cosPitch
  out[0] = pivot[0] + x * cosYaw + pitchZ * sinYaw
  out[1] = pivot[1] + pitchY
  out[2] = pivot[2] - x * sinYaw + pitchZ * cosYaw
  return out
}
