import type { AddPart, Finish } from '../render/octagonalKit.ts'

type Triple = [number, number, number]

export const CROWN_HERO_AZIMUTH = Math.PI / 8
export const CROWN_SECTORS = [0, 1, 2, 3, 4, 5, 6, 7].map(k => k * Math.PI / 4)
export const CROWN_KNEE = { r: 35, y: 21 }
export const CROWN_HUB = { r: 5.5, y: 31 }
export const CROWN_THROAT = { apothem: 7.4, top: 6.8 }
export const CROWN_TURRET_SEAT_Y = 38.1
export const CROWN_CLAIM_Y = 56
export const CROWN_BORE_STROKE = 10
export const CROWN_STOWED_MS = 0
export const CROWN_HELD_MS = 3400
export const CROWN_GLOW = { stowed: .10, flare: .82, held: .48 }
export const CROWN_DAMAGE_TILT = -.035

export function crownAz(phi: number, r: number, y: number): Triple {
  return [Math.sin(phi) * r, y, Math.cos(phi) * r]
}

export function crownGroundY(x: number, z: number): number {
  return -.7 - (1000 - Math.sqrt(1e6 - x * x - z * z))
}

export function crownArmY(r: number): number {
  return 21 + (35 - r) * (31 - 21) / (35 - 5.5)
}

export const CROWN_FOOTINGS = CROWN_SECTORS.map(phi => ({
  x: Math.sin(phi) * 44,
  z: Math.cos(phi) * 44,
  bottomY: -4.3,
}))

export function crownMember(
  add: AddPart,
  finish: Finish,
  phi: number,
  r0: number,
  y0: number,
  r1: number,
  y1: number,
  height: number,
  width: number,
  lift = 0,
  extra = 0,
): void {
  if (r1 < r0) {
    const r = r0, y = y0
    r0 = r1
    y0 = y1
    r1 = r
    y1 = y
  }
  const dr = r1 - r0, dy = y1 - y0
  const beta = Math.atan2(dy, dr)
  add('box', finish,
    crownAz(phi, (r0 + r1) / 2 - Math.sin(beta) * lift, (y0 + y1) / 2 + Math.cos(beta) * lift),
    [Math.hypot(dr, dy) + extra, height, width],
    [0, phi - Math.PI / 2, beta])
}

export function authorCraterCrownStatic(add: AddPart): void {
  for (const phi of CROWN_SECTORS) {
    add('box', 'dark', crownAz(phi, 44, -.15), [11, 8.3, 12], [0, phi, 0])
    add('box', 'gold', crownAz(phi, 50.05, 1.6), [11.4, 1.2, .5], [0, phi, 0])
    add('box', 'amber', crownAz(phi, 37.95, 2.4), [4.5, .9, .5], [0, phi, 0])
    crownMember(add, 'dark', phi, 40.5, 3, 35, 21, 4.2, 4.2, 0, 1.5)
    add('bevel', 'gold', crownAz(phi, 35, 21), [5.4, 4.4, 5.4], [0, phi, 0])
    crownMember(add, 'dark', phi, 35, 21, 5.5, 31, 3.4, 3.4, 0, 2)
    crownMember(add, 'gold', phi, 32, crownArmY(32), 8.5, crownArmY(8.5), .45, 1.3, 1.85)
    add('box', 'dark', crownAz(phi, 8.4, 2.8), [7, 8, 2], [0, phi, 0])
    add('box', 'gold', crownAz(phi, 9.55, 5.9), [7.3, 1.2, .3], [0, phi, 0])
  }
  add('bevel', 'dark', [0, 31, 0], [12, 12, 12])
  add('bevel', 'gold', [0, 26, 0], [12.8, 1, 12.8])
  add('bevel', 'gold', [0, 36.2, 0], [12.8, 1, 12.8])
  add('bevel', 'dark', [0, 37.4, 0], [8, 1.4, 8])
  add('bevel', 'amber', [0, -.35, 0], [12.5, .9, 12.5])
  crownMember(add, 'dark', Math.PI / 8, 10.5, 5.6, 38, -1.2, 1.8, 3.6)
  crownMember(add, 'amber', Math.PI / 8, 10.5, 5.6, 38, -1.2, .15, 1.6, .95)
}

export function authorCraterCrownBore(add: AddPart): void {
  add('bevel', 'dark', [0, 17, 0], [3, 22, 3])
  for (const y of [9, 12.5, 16]) {
    add('bevel', 'dark', [0, y, 0], [5, .8, 5])
  }
  add('taper', 'dark', [0, 3.5, 0], [6, 6, 6], [Math.PI, 0, 0])
}

export interface CraterCrownPose {
  bore: number
  glow: number
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const lin = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1)
const ease = (x: number) => x * x * (3 - 2 * x)
const mix = (a: number, b: number, x: number) => x === 0 ? a : x === 1 ? b : a + (b - a) * x

export function sampleCraterCrown(timeMs: number, out: CraterCrownPose = { bore: 0, glow: 0 }): CraterCrownPose {
  const t = clamp(timeMs, CROWN_STOWED_MS, CROWN_HELD_MS)
  out.bore = mix(CROWN_BORE_STROKE, 0, ease(lin(t, 700, 2000)))
  if (t < 1900) out.glow = CROWN_GLOW.stowed
  else if (t < 2200) out.glow = mix(CROWN_GLOW.stowed, CROWN_GLOW.flare, ease(lin(t, 1900, 2200)))
  else out.glow = mix(CROWN_GLOW.flare, CROWN_GLOW.held, ease(lin(t, 2200, CROWN_HELD_MS)))
  return out
}

export function craterCrownPoseTime({ live, revealAtMs, nowMs, reducedMotion }: {
  live: boolean
  revealAtMs: number | null
  nowMs: number
  reducedMotion: boolean
}): number {
  if (!live) return CROWN_STOWED_MS
  return revealAtMs !== null && !reducedMotion ? clamp(nowMs - revealAtMs, CROWN_STOWED_MS, CROWN_HELD_MS) : CROWN_HELD_MS
}

export function craterCrownLift(groundAtCentre: number, unit: number): number {
  return (groundAtCentre - .0007) / unit + .7
}

export function craterCrownDefenseMount(unit: number, squash: number, lift: number): Triple {
  return [0, .0007 + unit * squash * (CROWN_TURRET_SEAT_Y + lift) + .002, 0]
}
