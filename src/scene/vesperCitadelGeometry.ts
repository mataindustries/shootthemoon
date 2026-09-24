import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler,
  Matrix4, Object3D, Quaternion, TorusGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import type { RivalStageVisualProfile } from './RivalFoothold.tsx'

export type Triple = readonly [number, number, number]
export type CitadelGroundSampler = (x: number, z: number) => number

// The asymmetric apron surrounds the old anchor; it never changes its datum.
// Every hardware module with a low base must sit inside this polygon.
export const CITADEL_FOOTPRINT: readonly (readonly [number, number])[] = [
  [-8, -3.5], [-5.8, -6], [7.7, -6], [8.2, -3.2], [8, -1.2],
  [7.6, 3.8], [6.8, 5.3], [4, 5.8], [-5.5, 5.8], [-8, 3],
]
export const CITADEL_CROWN_PIVOT: Triple = [-2.5, 8.75, -0.65]
export const CITADEL_ARRAY_PIVOT: Triple = [4.4, 3.35, -1.7]
export const CITADEL_HARDPOINTS = [
  { x: -6.45, z: -3.3, pivotY: 4.25, riserBase: 2.75, yaw: -.24, elevation: .08, mount: 'collar' },
  { x: 6.25, z: .5, pivotY: 4.65, riserBase: 1.90, yaw: .18, elevation: .13, mount: 'strut' },
  { x: 1.1, z: -4.4, pivotY: 5.05, riserBase: 2.00, yaw: -.06, elevation: .10, mount: 'none' },
] as const
export const CITADEL_HARDPOINT_TRUNNION_Y = .6
export const CITADEL_HARDPOINT_MUZZLE_Z = 1.54
type CitadelHardpointFrame = 'fixed' | 'turret' | 'cradle'

export function poseCitadelHardpointPart(
  hardpoint: typeof CITADEL_HARDPOINTS[number],
  frame: CitadelHardpointFrame,
  position: Triple,
  rotation: Triple = [0, 0, 0],
): { position: Triple, rotation: Triple } {
  const matrix = new Matrix4().makeTranslation(hardpoint.x, hardpoint.pivotY, hardpoint.z)
  if (frame !== 'fixed') matrix.multiply(new Matrix4().makeRotationY(hardpoint.yaw))
  if (frame === 'cradle') {
    matrix.multiply(new Matrix4().makeTranslation(0, CITADEL_HARDPOINT_TRUNNION_Y, 0))
    matrix.multiply(new Matrix4().makeRotationX(-hardpoint.elevation))
  }
  const point = new Vector3().fromArray(position).applyMatrix4(matrix)
  const orientation = new Quaternion().setFromRotationMatrix(matrix)
    .multiply(new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ')))
  const angles = new Euler().setFromQuaternion(orientation, 'XYZ')
  return { position: [point.x, point.y, point.z], rotation: [angles.x, angles.y, angles.z] }
}

export function colored(geometry: BufferGeometry, hex: string): BufferGeometry {
  const count = geometry.getAttribute('position').count
  const values = new Float32Array(count * 3)
  const color = new Color(hex)
  for (let i = 0; i < count; i++) color.toArray(values, i * 3)
  geometry.setAttribute('color', new BufferAttribute(values, 3))
  return geometry
}

/** Eight clipped corners and a sloped roof edge give light a physical facet. */
function createArmorBlock(): BufferGeometry {
  const outline = [[-.36, -.5], [.36, -.5], [.5, -.36], [.5, .36], [.36, .5], [-.36, .5], [-.5, .36], [-.5, -.36]] as const
  const positions: number[] = []
  const indices: number[] = []
  for (const [height, inset] of [[-.5, 1], [.35, 1], [.5, .84]]) {
    for (const [x, z] of outline) positions.push(x * inset!, height!, z * inset!)
  }
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8, a = ring * 8 + i, b = ring * 8 + j
      indices.push(a, a + 8, b, b, a + 8, b + 8)
    }
  }
  positions.push(0, -.5, 0, 0, .5, 0)
  for (let i = 0; i < 8; i++) {
    indices.push(24, i, (i + 1) % 8, 25, 16 + (i + 1) % 8, 16 + i)
  }
  const indexed = new BufferGeometry()
  indexed.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()
  return geometry
}

/** The skirt is sampled along every edge, not perched on a flat tangent pad. */
export function createCitadelFoundation(groundAt: CitadelGroundSampler): BufferGeometry {
  const positions: number[] = []
  const triangle = (a: Triple, b: Triple, c: Triple) => positions.push(...a, ...b, ...c)
  for (let edge = 0; edge < CITADEL_FOOTPRINT.length; edge++) {
    const [ax, az] = CITADEL_FOOTPRINT[edge]!
    const [bx, bz] = CITADEL_FOOTPRINT[(edge + 1) % CITADEL_FOOTPRINT.length]!
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2)
    for (let i = 0; i < steps; i++) {
      const x0 = ax + (bx - ax) * i / steps, z0 = az + (bz - az) * i / steps
      const x1 = ax + (bx - ax) * (i + 1) / steps, z1 = az + (bz - az) * (i + 1) / steps
      const low0: Triple = [x0, groundAt(x0, z0) - .12, z0]
      const low1: Triple = [x1, groundAt(x1, z1) - .12, z1]
      const top0: Triple = [x0 * .96, .48, z0 * .96]
      const top1: Triple = [x1 * .96, .48, z1 * .96]
      triangle(low0, top0, low1)
      triangle(low1, top0, top1)
      triangle([0, .48, 0], top1, top0)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return colored(geometry, P.neutralMachinery)
}

export function createCitadelShapes() {
  return {
    box: new BoxGeometry(1, 1, 1).toNonIndexed(),
    armor: createArmorBlock(),
    drum: new CylinderGeometry(1, 1, 1, 12).toNonIndexed(),
    ring: new TorusGeometry(1, .10, 4, 16).toNonIndexed(),
  }
}
export type CitadelShape = keyof ReturnType<typeof createCitadelShapes>
export type CitadelAdd = (shape: CitadelShape, color: string, position: Triple, scale: Triple, rotation?: Triple) => void
type CitadelAuthor = (add: CitadelAdd) => void

/**
 * Authored architecture sections, in batch order. The wreck re-emits these same
 * parts through destructive transforms, so both states share one design.
 */
export const CITADEL_ARCHITECTURE = {
  // A continuous terraced bunker, a service apron, and recessed armored bays.
  terraces: add => {
    add('armor', P.rivalFrame, [-.8, .85, -.1], [13.5, .8, 9.8])
    add('armor', P.neutralMachinery, [-3.1, 1.8, -.5], [7.4, 2.4, 7.6])
    add('armor', P.neutralMachinery, [3.45, 1.45, -1], [5.6, 1.7, 7.6])
    add('armor', P.rivalFrame, [-3.1, 3.06, -.7], [6.9, .36, 6.9])
    add('armor', P.neutralMachinery, [3.6, 2.45, -1.6], [4.9, .5, 6.3])
    add('armor', P.rivalFrame, [2.5, .85, 3.3], [7.8, .55, 3.8])
  },
  bays: add => {
    for (const x of [-4.7, -2.5, -.3]) {
      add('box', P.contactDark, [x, 1.82, 3.29], [1.7, 1.5, .18])
      add('armor', P.neutralMachinery, [x, 2.65, 3.56], [2.08, .4, .8])
      add('box', P.rivalFrame, [x, 1.55, 3.43], [1.38, .95, .14])
      for (const side of [-1, 1]) add('box', P.rivalSurgical, [x + side * .84, 1.85, 3.47], [.10, 1.2, .18])
    }
  },
  steps: add => {
    for (let i = 0; i < 4; i++) {
      add('box', P.neutralMachinery, [1.9, .51 + i * .14, 5.12 - i * .33], [2.9, .22, .55])
    }
  },
  // Offset command keep. Split buttresses protect an open four-sided chamber.
  keep: add => {
    add('armor', P.neutralMachinery, [-2.5, 4.02, -.65], [4.9, 1.65, 4.5])
    add('armor', P.rivalFrame, [-2.5, 4.95, -.65], [4.5, .3, 4.05])
    for (const z of [-2.22, .92]) {
      add('armor', P.neutralMachinery, [-4.35, 7.15, z], [1.05, 4.8, 1.03], [0, 0, -.16])
      add('armor', P.neutralMachinery, [-.77, 6.65, z], [.85, 3.8, 1.03], [0, 0, .12])
      add('box', P.rivalFrame, [-4.39, 6.35, z + .03], [1.08, .20, 1.07], [0, 0, -.16])
    }
    add('armor', P.neutralMachinery, [-2.7, 8.45, -.65], [5.8, .66, 4.65], [0, 0, -.035])
    add('armor', P.rivalFrame, [-2.7, 8.08, -.65], [5.4, .2, 4.2])
  },
  // Single tall knife buttress: the headquarters' recognizable asymmetry.
  knife: add => {
    add('armor', P.neutralMachinery, [-5.15, 8.72, -.9], [.95, 7.1, 2.22], [0, 0, -.14])
    add('box', P.rivalSurgical, [-5.64, 10.44, -.92], [.10, 2.3, 1.15], [0, 0, -.14])
  },
  // Core collars and dark external shield ribs; cyan remains recessed.
  coreShield: add => {
    for (const y of [5.15, 6.1, 7.08, 7.85]) {
      add('drum', P.rivalFrame, [-2.5, y, -.65], [1.2, .18, 1.2])
    }
    for (const x of [-3.22, -1.78]) for (const z of [-1.37, .07]) {
      add('box', P.neutralMachinery, [x, 6.55, z], [.19, 2.8, .19])
    }
  },
  // Listening station on the lower roof; conduits feed its single gimbal.
  station: add => {
    add('drum', P.rivalFrame, [4.4, 2.85, -1.7], [.85, .55, .85])
    add('armor', P.neutralMachinery, [4.4, 3.25, -1.7], [.7, .8, .7])
    for (const z of [-2.3, -1.85]) {
      add('box', P.rivalFrame, [1.15, 2.88, z], [5.2, .22, .22])
    }
  },
  // Roof cooling baffles, tightly grouped infrastructure, no scattered props.
  baffles: add => {
    add('armor', P.rivalFrame, [-3.7, 3.34, -3.5], [3.9, .42, .9])
    for (let i = 0; i < 7; i++) {
      add('box', P.neutralMachinery, [-5.15 + i * .49, 3.6, -3.5], [.17, .25, .84])
    }
  },
  sideBunkers: add => {
    for (const z of [-4.5, 2.3]) {
      add('armor', P.rivalFrame, [6.65, 1.2, z], [1.3, 1.35, 1.9])
      add('box', P.neutralMachinery, [6.66, 1.93, z], [.65, .12, 1.3])
    }
  },
  // Two inset V insignia: physical ceramic inlays, not a texture or new copy.
  insignia: add => {
    for (const z of [-2.91, 1.62]) for (const side of [-1, 1]) {
      add('box', P.rivalSurgical, [-2.5 + side * .26, 4.04, z], [.14, .73, .045], [0, 0, side * -.42])
    }
  },
} as const satisfies Record<string, CitadelAuthor>

// Stage hardware supports split-rail energy-lance hardpoints.
export function authorCitadelStageHardware(add: CitadelAdd, profile: RivalStageVisualProfile): void {
  for (let i = 0; i < profile.pylonCount; i++) {
    const h = CITADEL_HARDPOINTS[i]!
    add('armor', P.rivalFrame, [h.x, 1.2, h.z], [1.12, 1.5, 1.22])
    add('box', P.neutralMachinery, [h.x, 2.8 + i * .2, h.z], [.25, 3.3 + i * .4, .35])
    add('box', P.neutralMachinery, [h.x, 4.3 + i * .4, h.z], [.42, .30, .42])
  }
  for (let i = 0; i < profile.buttressCount; i++) {
    const x = -5.5 + i * 2.05
    add('armor', P.rivalFrame, [x, 1, -4.8], [1.2, 1.8, 1.4], [-.15, 0, 0])
  }
}

export function authorCitadelHardpoints(add: CitadelAdd, profile: RivalStageVisualProfile): void {
  for (let i = 0; i < profile.pylonCount; i++) {
    const h = CITADEL_HARDPOINTS[i]!, r = h.pivotY - h.riserBase
    const part = (frame: CitadelHardpointFrame, shape: CitadelShape, color: string, position: Triple, scale: Triple, rotation?: Triple) => {
      const pose = poseCitadelHardpointPart(h, frame, position, rotation)
      add(shape, color, pose.position, scale, pose.rotation)
    }
    part('fixed', 'armor', P.neutralMachinery, [0, -r / 2 + .02, 0], [.66, r + .04, .70])
    part('fixed', 'box', P.rivalFrame, [0, -r / 2 + .05, -.37], [.18, r - .10, .12])
    part('turret', 'armor', P.rivalFrame, [0, .17, -.05], [.92, .34, .96])
    for (const side of [-1, 1]) part('turret', 'box', P.neutralMachinery, [side * .30, .55, .04], [.12, .50, .54])
    part('cradle', 'armor', P.rivalFrame, [0, 0, -.20], [.52, .36, .88])
    for (const side of [-1, 1]) part('cradle', 'box', P.neutralMachinery, [side * .115, 0, .80], [.08, .20, 1.30])
    part('cradle', 'box', P.rivalFrame, [0, .125, .42], [.31, .05, .56])
    for (const side of [-1, 1]) part('cradle', 'box', P.rivalSurgical, [side * .23, .04, .98], [.05, .24, .46], [0, side * .2, 0])
    part('cradle', 'box', P.rivalFrame, [0, 0, 1.44], [.38, .28, .12])
    part('cradle', 'box', P.contactDark, [0, 0, 1.52], [.14, .12, .04])
    if (h.mount === 'collar') add('box', P.rivalFrame, [h.x, 3.08, h.z], [1.0, .26, 1.0])
    if (h.mount === 'strut') add('box', P.rivalFrame, [h.x - .65, 3.225, h.z], [.14, 1.32, .26], [0, 0, -.651])
  }
}

export function authorCitadelHardpointSignal(add: CitadelAdd, profile: RivalStageVisualProfile): void {
  for (let i = 0; i < profile.pylonCount; i++) {
    const h = CITADEL_HARDPOINTS[i]!
    for (const [position, scale] of [
      [[0, -.02, .82], [.06, .12, 1.18]],
      [[0, 0, 1.555], [.05, .05, .03]],
    ] as const) {
      const pose = poseCitadelHardpointPart(h, 'cradle', position)
      add('box', P.rivalCyanPanel, pose.position, scale, pose.rotation)
    }
  }
}

export const authorCitadelCore: CitadelAuthor = add => {
  add('drum', P.rivalCyanPanel, [-2.5, 6.5, -.65], [.73, 2.75, .73])
  add('drum', P.rivalHighlight, [-2.5, 6.5, -.65], [.38, 2.86, .38])
}
export const authorCitadelRouting: CitadelAuthor = add => {
  // Narrow vertical channels rise from the core into the crown, on both faces.
  for (const z of [-2.27, .97]) {
    add('box', P.rivalCyanPanel, [-1.4, 6.55, z], [.105, 2.8, .09])
    add('box', P.rivalCyanPanel, [-1.85, 8.06, z], [.95, .11, .09])
  }
}
/** Authored about CITADEL_CROWN_PIVOT. */
export const authorCitadelCrown: CitadelAuthor = add => {
  add('drum', P.rivalFrame, [0, .1, 0], [1.03, .28, 1.03])
  add('armor', P.neutralMachinery, [0, .62, 0], [.65, 1.15, .7])
  // A split tuning fork, with a broad aperture instead of aliasing wirework.
  for (const side of [-1, 1]) {
    add('armor', P.neutralMachinery, [side * 1.1, 1.55, 0], [.64, 2.85, 1.1], [0, 0, -side * .17])
    add('box', P.rivalFrame, [side * 1.08, 1.65, .58], [.4, 1.85, .12], [0, 0, -side * .17])
    add('box', P.rivalSurgical, [side * 1.32, 2.48, .12], [.10, .74, .76], [0, 0, -side * .17])
  }
  add('armor', P.rivalFrame, [0, 1.25, 0], [2.5, .38, .82])
  add('armor', P.neutralMachinery, [0, 2.24, -.1], [.65, .9, .55])
}
/** Authored about CITADEL_CROWN_PIVOT. */
export const authorCitadelCrownSignal: CitadelAuthor = add => {
  for (const side of [-1, 1]) add('box', P.rivalCyanPanel, [side * .68, 1.64, .03], [.13, 1.45, .62], [0, 0, -side * .17])
  add('box', P.rivalHighlight, [0, 2.23, .205], [.25, .52, .06])
}
/** Authored about CITADEL_ARRAY_PIVOT. */
export const authorCitadelArray: CitadelAuthor = add => {
  // Solid-backed, folded phased array with a nine-cell graphite face.
  add('armor', P.neutralMachinery, [0, 1.08, 0], [3.1, 2.16, .44], [-.26, 0, 0])
  for (const side of [-1, 1]) add('armor', P.rivalFrame, [side * 1.61, 1.08, .24], [.65, 1.86, .4], [-.26, side * -.4, 0])
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    add('box', P.rivalSkeleton, [(col - 1) * .88, .43 + row * .6, .42 - row * .16], [.78, .48, .10], [-.26, 0, 0])
  }
  add('box', P.neutralMachinery, [0, .15, .55], [.18, .18, 1.3])
  add('armor', P.rivalFrame, [0, .45, 1.07], [.44, .62, .42])
}
/** Authored about CITADEL_ARRAY_PIVOT. */
export const authorCitadelArraySignal: CitadelAuthor = add => {
  add('box', P.rivalCyanPanel, [0, .28, .52], [2.35, .105, .10])
  add('box', P.rivalHighlight, [0, .58, 1.30], [.19, .24, .05])
}

export function createCitadelGeometry(profile: RivalStageVisualProfile) {
  const shapes = createCitadelShapes()
  const transform = new Object3D()
  function batch(author: CitadelAuthor): BufferGeometry {
    const parts: BufferGeometry[] = []
    author((shape, color, position, scale, rotation = [0, 0, 0]) => {
      transform.position.fromArray(position)
      transform.scale.fromArray(scale)
      transform.rotation.set(...rotation)
      transform.updateMatrix()
      const geometry = shapes[shape].clone().applyMatrix4(transform.matrix)
      // Every batch uses the same plain vertex-color standard material variant.
      geometry.deleteAttribute('uv')
      parts.push(colored(geometry, color))
    })
    const geometry = mergeGeometries(parts)!
    parts.forEach(part => part.dispose())
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  const architecture = batch(add => {
    for (const author of Object.values(CITADEL_ARCHITECTURE)) author(add)
    authorCitadelStageHardware(add, profile)
    authorCitadelHardpoints(add, profile)
  })
  const core = batch(authorCitadelCore)
  const routing = batch(add => {
    authorCitadelRouting(add)
    authorCitadelHardpointSignal(add, profile)
  })
  const lamps = batch(add => {
    for (const x of [-4.7, -2.5, -.3]) add('box', P.rivalCyanPanel, [x, 2.48, 3.48], [.45, .09, .12])
    for (const x of [-6.3, 6.3]) add('box', P.rivalCyanPanel, [x, .95, 3.95], [.2, .16, .22])
    for (let i = 0; i < profile.lightCount; i++) {
      add('box', P.rivalCyanPanel, [3.7 + i * .3, 2.73, 1.15], [.09, .11, .16])
    }
  })
  const crown = batch(authorCitadelCrown)
  const crownSignal = batch(authorCitadelCrownSignal)
  const array = batch(authorCitadelArray)
  const arraySignal = batch(authorCitadelArraySignal)
  Object.values(shapes).forEach(shape => shape.dispose())
  return { architecture, core, routing, lamps, crown, crownSignal, array, arraySignal }
}
