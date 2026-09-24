import type { AddPart } from '../render/octagonalKit.ts'

const PI = Math.PI
type Triple = [number, number, number]

/** Metres before monument render scaling; the temple's +z face owns the stair. */
export const ZIGGURAT_HERO_AZIMUTH = PI / 4
export const ZIGGURAT_TERRACES = [
  { half: 15.5, bottom: -2.5, top: 5 },
  { half: 12.5, bottom: 5, top: 12 },
  { half: 9.75, bottom: 12, top: 18.5 },
  { half: 7.25, bottom: 18.5, top: 24.5 },
  { half: 5, bottom: 24.5, top: 30 },
] as const

const CORNERS = [[15.5, 15.5], [15.5, -15.5], [-15.5, 15.5], [-15.5, -15.5]] as const
const az = (phi: number, radius: number, y: number): Triple => [Math.sin(phi) * radius, y, Math.cos(phi) * radius]
const templeToModel = ([x, y, z]: Triple): Triple => {
  const c = Math.cos(ZIGGURAT_HERO_AZIMUTH), s = Math.sin(ZIGGURAT_HERO_AZIMUTH)
  return [c * x + s * z, y, -s * x + c * z]
}

/** Actual foundation bottoms in the final model frame, embedded in lunar ground. */
export const BASTION_FOOTINGS = [
  { x: 0, z: 0, bottomY: -2.5 },
  ...CORNERS.map(([x, z]) => {
    const [modelX, , modelZ] = templeToModel([x, 0, z])
    return { x: modelX, z: modelZ, bottomY: -2.5 }
  }),
]

const STAIR_PITCH = 1.176, STAIR_LENGTH = 27.1
const STAIR_SIN = Math.sin(STAIR_PITCH), STAIR_COS = Math.cos(STAIR_PITCH)

/** Temple-frame point: s climbs from the foot, n measures above the top surface. */
export function zigguratStairPoint(s: number, n = 0, lateral = 0): Triple {
  return [lateral, 5.3 + s * STAIR_SIN + n * STAIR_COS, 15.4 - s * STAIR_COS + n * STAIR_SIN]
}

/** Static kit geometry only. All authored Euler rotations retain x = 0. */
export function authorBastionZiggurat(add: AddPart) {
  const part: AddPart = (shape, finish, position, scale, rotation = [0, 0, 0]) => {
    add(shape, finish, templeToModel(position), scale, [0, rotation[1] + ZIGGURAT_HERO_AZIMUTH, rotation[2]])
  }

  for (const { half, bottom, top } of ZIGGURAT_TERRACES) {
    const width = 2 * half
    part('box', 'dark', [0, (bottom + top) / 2, 0], [width, top - bottom, width])
    // Bury the slab in the armor; only its 0.3 m perimeter lip projects.
    part('box', 'gold', [0, top - .12 - .45 / 2, 0], [width + .6, .45, width + .6])
  }

  const flatRadius = Math.cos(PI / 8)
  for (const [x, z] of CORNERS) {
    part('bevel', 'dark', [x, 4.5, z], [3.6, 14, 3.6])
    part('bevel', 'gold', [x, 12.1, z], [3.1, 1.2, 3.1])
    const phi = Math.atan2(x, z)
    const [dx, , dz] = az(phi, 3.6 * flatRadius + .1, 0)
    part('box', 'amber', [x + dx, 8, z + dz], [1.6, .5, .3], [0, phi, 0])
  }

  const stairRotation: Triple = [0, -PI / 2, -STAIR_PITCH]
  // The top runs 0.26–0.36 m above T1–T4 nosings; the body sinks into the armor.
  part('box', 'dark', zigguratStairPoint(STAIR_LENGTH / 2, -.8), [STAIR_LENGTH, 1.6, 5], stairRotation)
  for (const lateral of [-2.75, 2.75]) {
    part('box', 'gold', zigguratStairPoint(STAIR_LENGTH / 2, -.35, lateral), [STAIR_LENGTH, .9, .5], stairRotation)
  }
  for (let i = 1; i <= 6; i++) {
    // Treads rise 0.025 m above the ramp, below the continuous lance's face.
    part('box', 'gold', zigguratStairPoint(STAIR_LENGTH * i / 7, -.1), [.35, .25, 5], stairRotation)
  }
  // Half of its 0.12 m thickness is embedded: the exposed face is 0.06 m proud.
  part('box', 'amber', zigguratStairPoint(STAIR_LENGTH / 2), [25, .12, .6], stairRotation)

  // The kit's unrotated octagon already has a flat face normal to temple +z.
  part('bevel', 'dark', [0, 34.25, 0], [3.8, 8.5, 3.8])
  const sanctumFace = 3.8 * flatRadius + .1
  part('box', 'amber', [0, 33.6, sanctumFace], [1.2, 4, .3])
  for (const x of [-1.3, 1.3]) {
    part('box', 'cyan', [x, 36.2, sanctumFace], [.5, .5, .3])
  }
  part('bevel', 'gold', [0, 39.2, 0], [4.4, 1.4, 4.4])

  const lean = .25
  for (const x of [-2.6, 2.6]) for (const z of [-2.6, 2.6]) {
    const phi = Math.atan2(x, z)
    // Anchor the tilted bottom centre at y = 39.5, inside the capstone.
    const [dx, y, dz] = az(phi, 3 * Math.sin(lean), 39.5 + 3 * Math.cos(lean))
    part('taper', 'dark', [x + dx, y, z + dz], [1.1, 6, 1.1], [0, phi - PI / 2, -lean])
  }

  for (const phi of [PI / 2, PI, 3 * PI / 2]) {
    // Gate backs overlap T1; slit backs overlap the gate instead of floating.
    part('box', 'dark', az(phi, 12.95, 7.5), [6, 5, 1], [0, phi, 0])
    part('box', 'amber', az(phi, 13.5, 7.5), [.5, 3.5, .2], [0, phi, 0])
  }
}
