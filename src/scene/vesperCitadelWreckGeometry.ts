import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Matrix4,
  Object3D, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import type { RivalStageVisualProfile } from './RivalFoothold.tsx'
import {
  CITADEL_ARCHITECTURE, CITADEL_ARRAY_PIVOT, CITADEL_CROWN_PIVOT,
  authorCitadelArray, authorCitadelArraySignal, authorCitadelCore,
  authorCitadelCrown, authorCitadelCrownSignal, authorCitadelStageHardware,
  createCitadelShapes, type CitadelShape, type Triple,
} from './vesperCitadelGeometry.ts'

/**
 * Commander Vesper's headquarters after First Strike. Every architectural mass
 * is one of the intact citadel's authored parts, split along fracture planes
 * and re-posed, so the ruin keeps the live base's footprint, offset keep and
 * listening crown. Model units match VesperCitadel; y = 0 is the scarred
 * grounding datum (the sampled crater floor beneath the site).
 */

export interface WreckPose {
  readonly pivot?: Triple
  readonly rotation?: Triple
  readonly offset?: Triple
}

/** Standing remains settle into the scar: sunk into regolith, heaved off level. */
export const CITADEL_WRECK_SETTLE: WreckPose = Object.freeze({
  pivot: [-1, 0, -.5] as Triple,
  rotation: [.028, 0, -.022] as Triple,
  offset: [0, -.9, 0] as Triple,
})
/** The intact base terrace spans y .45–1.25; the settle sinks it through the floor. */
export const CITADEL_WRECK_FOUNDATION_BOTTOM = .45 - .9
export const CITADEL_WRECK_FOUNDATION_TOP = 1.25 - .9
/** The last signal remnants stay far below the live panel emissive limit. */
export const CITADEL_WRECK_EMBER_INTENSITY = .16

/** Vertices past the plane (along its normal) collapse onto a jagged fracture face. */
interface Fracture {
  readonly point: Triple
  readonly normal: Triple
  readonly jag: number
}

interface Part {
  readonly shape: WreckShape
  readonly color: string
  readonly position: Triple
  readonly scale: Triple
  readonly rotation: Triple
}

interface EmitOptions {
  readonly select?: (part: Part) => boolean
  readonly fractures?: readonly Fracture[]
  /** The bottom faces of these parts stay buried in the scar floor. */
  readonly anchored?: boolean
  readonly recolor?: (color: string) => string
  /** Routes the parts to the dim signal batch instead of the armor batch. */
  readonly ember?: boolean
}

type WreckShape = CitadelShape | 'mound'
type WreckAdd = (shape: WreckShape, color: string, position: Triple, scale: Triple, rotation?: Triple) => void
type Emit = (author: (add: WreckAdd) => void, options?: EmitOptions) => void

export interface CitadelWreckFragment {
  readonly name: string
  /** 'ground' pieces bite into the scar floor; the rest lean on the named fragment. */
  readonly restsOn: string
  readonly min: Triple
  readonly max: Triple
  /** Model-space points that must stay below the scar floor. */
  readonly footing: readonly Triple[]
}

export interface CitadelWreckGeometry {
  readonly wreck: BufferGeometry
  readonly embers: BufferGeometry
  readonly fragments: readonly CitadelWreckFragment[]
}

const CHAR = new Color(P.damageChar)
/** [wall, extra on up-facing faces]: surviving walls keep their ceramic tone. */
const STANDING_CHAR = [.08, .3] as const
const FALLEN_CHAR = [.14, .3] as const
const REGOLITH_CHAR = [0, .08] as const
const NO_CHAR = [0, 0] as const
const REGOLITH = new Color(P.damageFloor).lerp(new Color(P.lunarMid), .12).getStyle()
const DEAD_SIGNAL: Readonly<Record<string, string>> = {
  [P.rivalCyanPanel]: P.rivalWreck,
  [P.rivalHighlight]: P.rivalFrame,
}
const deadSignal = (color: string) => DEAD_SIGNAL[color] ?? color

function poseMatrix(pose: WreckPose, parent?: Matrix4): Matrix4 {
  const [px, py, pz] = pose.pivot ?? [0, 0, 0]
  const [ox, oy, oz] = pose.offset ?? [0, 0, 0]
  const matrix = new Matrix4()
    .makeTranslation(px + ox, py + oy, pz + oz)
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(...(pose.rotation ?? [0, 0, 0]))))
    .multiply(new Matrix4().makeTranslation(-px, -py, -pz))
  return parent === undefined ? matrix : parent.clone().multiply(matrix)
}

/** Stable per-position noise so coincident vertices of adjoining faces break together. */
function roughness(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return h - Math.floor(h)
}

/**
 * Slides every vertex past a fracture back along the part's own edge axis (the
 * one most aligned with the plane normal), so a snapped column shortens in
 * place instead of shearing. Returns false when nothing of the part survives.
 */
function applyFractures(
  geometry: BufferGeometry,
  placement: Matrix4,
  fractures: readonly Fracture[],
): boolean {
  const position = geometry.getAttribute('position')
  const axes = [new Vector3(), new Vector3(), new Vector3()]
  placement.extractBasis(axes[0]!, axes[1]!, axes[2]!)
  axes.forEach(axis => axis.normalize())
  const cuts = fractures.map(({ point, normal, jag }) => {
    const n = new Vector3(...normal).normalize()
    const axis = axes.reduce((best, next) => Math.abs(next.dot(n)) > Math.abs(best.dot(n)) ? next : best)
    const slide = axis.clone().multiplyScalar(1 / axis.dot(n))
    return { n, offset: n.dot(new Vector3(...point)), slide, jag }
  })
  const vertex = new Vector3()
  let collapsed = 0
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i)
    const noise = roughness(vertex.x, vertex.y, vertex.z)
    let cut = false
    for (const { n, offset, slide, jag } of cuts) {
      const past = n.dot(vertex) - offset
      if (past > 0) {
        vertex.addScaledVector(slide, -(past + jag * noise))
        cut = true
      }
    }
    if (cut) collapsed++
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  return collapsed < position.count
}

/** Blast char gathers on up-facing surfaces; walls keep their ceramic tone. */
function scorch(geometry: BufferGeometry, hex: string, amount: readonly [number, number]): void {
  const normal = geometry.getAttribute('normal')
  const values = new Float32Array(normal.count * 3)
  const base = new Color(hex)
  const color = new Color()
  for (let i = 0; i < normal.count; i++) {
    const t = Math.min(1, amount[0] + amount[1] * Math.max(0, normal.getY(i)))
    color.copy(base).lerp(CHAR, t).toArray(values, i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(values, 3))
}

function createWreckBuilder() {
  const shapes: Record<WreckShape, BufferGeometry> = {
    ...createCitadelShapes(),
    // Low regolith heaps; the only form the intact citadel does not author.
    mound: new CylinderGeometry(.42, 1, 1, 7, 1).toNonIndexed(),
  }
  const armor: BufferGeometry[] = []
  const embers: BufferGeometry[] = []
  const fragments: CitadelWreckFragment[] = []
  const settle = poseMatrix(CITADEL_WRECK_SETTLE)
  const placement = new Object3D()

  function fragment(
    name: string,
    restsOn: string,
    pose: WreckPose,
    char: readonly [number, number],
    build: (emit: Emit) => void,
    frame: 'settled' | 'ground' | Matrix4 = 'settled',
  ): Matrix4 {
    const parent = frame === 'settled' ? settle : frame === 'ground' ? undefined : frame
    const matrix = poseMatrix(pose, parent)
    const min = new Vector3(Infinity, Infinity, Infinity)
    const max = new Vector3(-Infinity, -Infinity, -Infinity)
    const lowest = new Vector3(0, Infinity, 0)
    const footing: Triple[] = []
    const vertex = new Vector3()

    build((author, options = {}) => {
      author((shape, color, position, scale, rotation = [0, 0, 0]) => {
        const part: Part = { shape, color, position, scale, rotation }
        if (options.select !== undefined && !options.select(part)) return
        placement.position.fromArray(position)
        placement.scale.fromArray(scale)
        placement.rotation.set(...rotation)
        placement.updateMatrix()
        const geometry = shapes[shape].clone()
        geometry.deleteAttribute('uv')
        const bottom: number[] = []
        if (options.anchored) {
          const local = geometry.getAttribute('position')
          for (let i = 0; i < local.count; i++) if (local.getY(i) <= -.5 + 1e-6) bottom.push(i)
        }
        geometry.applyMatrix4(placement.matrix)
        const fractures = options.fractures ?? []
        if (fractures.length > 0 && !applyFractures(geometry, placement.matrix, fractures)) {
          geometry.dispose()
          return
        }
        if (fractures.length > 0 || shape === 'mound') geometry.computeVertexNormals()
        geometry.applyMatrix4(matrix)
        const target = options.ember ? embers : armor
        const hex = options.recolor?.(color) ?? color
        if (options.ember) scorch(geometry, hex, NO_CHAR)
        else scorch(geometry, hex, char)
        target.push(geometry)

        const positions = geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i)
          min.min(vertex)
          max.max(vertex)
          if (vertex.y < lowest.y) lowest.copy(vertex)
        }
        for (const i of bottom) {
          footing.push([positions.getX(i), positions.getY(i), positions.getZ(i)])
        }
      })
    })

    if (Number.isFinite(lowest.y)) {
      if (footing.length === 0) footing.push([lowest.x, lowest.y, lowest.z])
      fragments.push({
        name,
        restsOn,
        min: [min.x, min.y, min.z],
        max: [max.x, max.y, max.z],
        footing,
      })
    }
    return matrix
  }

  function finish(): CitadelWreckGeometry {
    const merge = (parts: BufferGeometry[]) => {
      const geometry = mergeGeometries(parts)!
      parts.forEach(part => part.dispose())
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      return geometry
    }
    const result = { wreck: merge(armor), embers: merge(embers), fragments }
    Object.values(shapes).forEach(shape => shape.dispose())
    return result
  }

  return { fragment, finish }
}

const near = (value: number, target: number) => Math.abs(value - target) < 1e-6
const at = (part: Part, x: number, y?: number, z?: number) =>
  near(part.position[0], x) &&
  (y === undefined || near(part.position[1], y)) &&
  (z === undefined || near(part.position[2], z))

export function createCitadelWreckGeometry(profile: RivalStageVisualProfile): CitadelWreckGeometry {
  const { fragment, finish } = createWreckBuilder()
  const A = CITADEL_ARCHITECTURE
  const terraces = A.terraces

  // FOUNDATION: the continuous terrace survives as a sunk, heaved plinth.
  fragment('plinth', 'ground', {}, STANDING_CHAR, emit => {
    emit(terraces, {
      select: part => at(part, -.8) || at(part, 2.5, .85),
      anchored: true,
      fractures: [{ point: [4.2, 1.05, 4.6], normal: [.35, .75, .55], jag: .35 }],
    })
    emit((add: WreckAdd) => authorCitadelStageHardware(add, profile), {
      select: part => part.shape === 'armor',
    })
  })

  // FORTRESS: the west mass slumps toward the knife side; its roof caves in.
  fragment('west-bunker', 'plinth', {}, STANDING_CHAR, emit => {
    emit(terraces, {
      select: part => at(part, -3.1, 1.8),
      fractures: [
        { point: [-3.2, 3.0, 0], normal: [-.35, 1, 0], jag: .28 },
        { point: [-6.1, 2.2, -3.7], normal: [-.45, .7, -.55], jag: .3 },
      ],
    })
    emit(terraces, {
      select: part => at(part, -3.1, 3.06),
      fractures: [{ point: [-3.35, 0, 0], normal: [-1, 0, 0], jag: .45 }],
    })
    // Burned-out interior showing through the roof split.
    emit(add => add('box', P.contactDark, [-3.75, 2.75, -.7], [.9, .5, 6.2]))
  })
  fragment('west-roof', 'west-bunker', {
    pivot: [-3.75, 2.95, -.7], rotation: [.05, 0, .34], offset: [0, -.08, 0],
  }, FALLEN_CHAR, emit => {
    emit(terraces, {
      select: part => at(part, -3.1, 3.06),
      fractures: [{ point: [-3.75, 0, 0], normal: [1, 0, 0], jag: .4 }],
    })
  })
  fragment('east-bunker', 'plinth', {}, STANDING_CHAR, emit => {
    emit(terraces, {
      select: part => at(part, 3.45),
      fractures: [{ point: [5.4, 2.0, -3.9], normal: [.45, .75, -.5], jag: .3 }],
    })
  })
  fragment('east-roof', 'east-bunker', {
    pivot: [3.6, 2.2, -1.6], rotation: [.09, .1, -.08], offset: [.3, -.06, .25],
  }, FALLEN_CHAR, emit => {
    emit(terraces, {
      select: part => at(part, 3.6, 2.45),
      fractures: [{ point: [5.6, 2.5, -4.1], normal: [.55, .45, -.7], jag: .35 }],
    })
  })

  // Armored bays: two doors blown in to the dark interior, one lintel down.
  fragment('bays', 'west-bunker', {}, STANDING_CHAR, emit => {
    const bay = (part: Part) => [-4.7, -2.5, -.3].find(x => Math.abs(part.position[0] - x) < 1.2)
    emit(A.bays, {
      select: part =>
        bay(part) === -4.7 && !(part.shape === 'armor') &&
        part.color !== P.rivalFrame && part.color !== P.rivalSurgical,
    })
    emit(A.bays, {
      select: part => bay(part) === -2.5 && part.color !== P.rivalFrame,
      fractures: [{ point: [-1.9, 2.55, 3.6], normal: [1, .75, .2], jag: .3 }],
    })
    emit(A.bays, { select: part => bay(part) === -.3 })
  })
  fragment('bay-lintel', 'plinth', {
    pivot: [-4.7, 2.45, 3.96], rotation: [1.25, .3, .12], offset: [-.2, -1.35, .75],
  }, FALLEN_CHAR, emit => {
    emit(A.bays, {
      select: part => part.shape === 'armor' && at(part, -4.7),
      fractures: [{ point: [-3.9, 2.65, 3.56], normal: [1, .2, 0], jag: .3 }],
    })
  })

  // COMMAND KEEP: fractured along its west footing, leaning toward the knife.
  const keep = fragment('keep', 'west-bunker', {
    pivot: [-.05, 3.2, -.65], rotation: [-.05, 0, .2],
  }, STANDING_CHAR, emit => {
    const keepParts = A.keep
    emit(keepParts, {
      select: part => at(part, -2.5, 4.02),
      fractures: [{ point: [-2.5, 4.6, -.65], normal: [-.18, 1, .12], jag: .35 }],
    })
    // Split buttress stumps, each snapped on its own line.
    const stumps: readonly [number, number, Fracture][] = [
      [-4.35, -2.22, { point: [-4.35, 6.1, -2.22], normal: [.35, 1, .1], jag: .4 }],
      [-4.35, .92, { point: [-4.35, 7.7, .92], normal: [-.25, 1, .15], jag: .45 }],
      [-.77, -2.22, { point: [-.77, 5.5, -2.22], normal: [-.3, 1, -.2], jag: .35 }],
      [-.77, .92, { point: [-.77, 6.35, .92], normal: [.2, 1, .3], jag: .4 }],
      [-4.39, .95, { point: [-4.35, 7.7, .92], normal: [-.25, 1, .15], jag: .1 }],
    ]
    for (const [x, z, fracture] of stumps) {
      emit(keepParts, { select: part => at(part, x, undefined, z), fractures: [fracture] })
    }
    emit(A.knife, {
      select: part => part.shape === 'armor',
      fractures: [{ point: [-5.2, 7.85, -.9], normal: [.4, 1, -.1], jag: .45 }],
    })
    const coreBreak: Fracture = { point: [-2.5, 6.2, -.65], normal: [.35, 1, -.25], jag: .35 }
    emit(A.coreShield, { fractures: [coreBreak] })
    emit(authorCitadelCore, { fractures: [coreBreak], recolor: deadSignal })
    // The open chamber, burned black where the keep wall broke away.
    emit(add => add('box', P.contactDark, [-2.6, 4.25, -.65], [4.2, .5, 3.8]))
    emit(A.insignia, {
      select: part => !(near(part.position[2], -2.91) && part.position[0] < -2.5),
    })
  })
  // One sliver of the core still holds a faint charge.
  fragment('core-ember', 'keep', {}, NO_CHAR, emit => {
    emit(add => add('box', P.rivalCyanPanel, [-2.62, 6.02, -.5], [.2, .16, .3], [.2, .4, .3]), { ember: true })
  }, keep)

  // The keep roof slid off to the west and fetched up against the stumps.
  fragment('keep-roof', 'ground', {
    pivot: [-2.7, 8.45, -.65], rotation: [.06, .12, 1.02], offset: [-3.95, -6.2, .1],
  }, FALLEN_CHAR, emit => {
    emit(A.keep, {
      select: part => part.position[1] > 8,
      fractures: [{ point: [-.6, 8.5, -2.4], normal: [.6, .2, -.75], jag: .45 }],
    })
  }, 'ground')

  // The knife buttress snapped; its blade lies across the west apron.
  fragment('knife-blade', 'ground', {
    pivot: [-4.95, 10.1, -.9], rotation: [.28, .82, 1.5], offset: [-4.3, -9.55, -3.1],
  }, FALLEN_CHAR, emit => {
    emit(A.knife, {
      fractures: [{ point: [-5.2, 7.85, -.9], normal: [-.4, -1, .1], jag: .45 }],
    })
  }, 'ground')

  // LISTENING CROWN: torn from the keep, jammed tilted into the broken chamber.
  const [crownX, crownY, crownZ] = CITADEL_CROWN_PIVOT
  const tineBreak: Fracture = { point: [1.25, 1.95, 0], normal: [.55, .8, 0], jag: .3 }
  fragment('crown', 'keep', {
    pivot: [0, 0, 0], rotation: [.28, .55, -.95], offset: [crownX + .35, crownY - 3.1, crownZ + .2],
  }, STANDING_CHAR, emit => {
    emit(authorCitadelCrown, { fractures: [tineBreak] })
    emit(authorCitadelCrownSignal, { fractures: [tineBreak], recolor: deadSignal })
  }, keep)
  // Its snapped tine fell onto the front apron.
  fragment('crown-tine', 'ground', {
    pivot: [1.2, 2.2, 0], rotation: [1.42, .55, .3], offset: [-2.6, -1.95, 5.35],
  }, FALLEN_CHAR, emit => {
    const flipped: Fracture = { point: tineBreak.point, normal: [-.7, -.7, 0], jag: tineBreak.jag }
    emit(authorCitadelCrown, { select: part => part.position[0] > .5, fractures: [flipped] })
    emit(authorCitadelCrownSignal, {
      select: part => part.position[0] > .5, fractures: [flipped], recolor: deadSignal,
    })
  }, 'ground')

  // PHASED ARRAY: still on its gimbal, knocked back and twisted, one wing gone.
  fragment('station', 'east-roof', {}, STANDING_CHAR, emit => {
    emit(A.station, {
      select: part => !near(part.position[2], -2.3),
    })
    emit(A.station, {
      select: part => near(part.position[2], -2.3),
      fractures: [{ point: [1.6, 0, 0], normal: [-1, 0, 0], jag: .4 }],
    })
  })
  const [arrayX, arrayY, arrayZ] = CITADEL_ARRAY_PIVOT
  const arrayPose: WreckPose = {
    pivot: [0, 0, 0], rotation: [-.82, .38, .3], offset: [arrayX, arrayY - .1, arrayZ],
  }
  const arrayBreak: Fracture = { point: [1.15, 1.75, 0], normal: [.6, .8, .1], jag: .35 }
  const missingCells = new Set(['0.88,0.43', '-0.88,1.03', '0.88,1.63'])
  const array = fragment('array', 'station', arrayPose, STANDING_CHAR, emit => {
    emit(authorCitadelArray, {
      select: part =>
        !(part.shape === 'armor' && part.position[0] > 1) &&
        !missingCells.has(`${part.position[0].toFixed(2)},${part.position[1].toFixed(2)}`),
      fractures: [arrayBreak],
    })
    emit(authorCitadelArraySignal, {
      select: part => part.color !== P.rivalHighlight,
      fractures: [arrayBreak],
      recolor: deadSignal,
    })
  })
  fragment('array-ember', 'array', {}, NO_CHAR, emit => {
    emit(authorCitadelArraySignal, {
      select: part => part.color === P.rivalHighlight,
      recolor: () => P.rivalCyanPanel,
      ember: true,
    })
  }, array)
  fragment('array-wing', 'ground', {
    pivot: [1.61, 1.08, .24], rotation: [1.45, .5, .35], offset: [arrayX + .2, arrayY - 3.3, arrayZ + 2.2],
  }, FALLEN_CHAR, emit => {
    emit(authorCitadelArray, {
      select: part => part.shape === 'armor' && part.position[0] > 1,
    })
  })

  // Perimeter hardware: one side bunker toppled outward, pylons snapped.
  fragment('side-bunker', 'plinth', {}, STANDING_CHAR, emit => {
    emit(A.sideBunkers, { select: part => near(part.position[2], -4.5) })
  })
  fragment('side-bunker-toppled', 'ground', {
    pivot: [7.3, .55, 2.3], rotation: [.1, .35, -.62], offset: [.25, -.1, .15],
  }, FALLEN_CHAR, emit => {
    emit(A.sideBunkers, { select: part => near(part.position[2], 2.3) })
  })
  const stage = (add: WreckAdd) => authorCitadelStageHardware(add, profile)
  const pylonBreak = (x: number, z: number, height: number): Fracture => ({
    point: [x, height, z], normal: [.3, 1, -.25], jag: .3,
  })
  const pylons = [
    { x: -6.45, z: -3.3, fall: { rotation: [-1.42, .35, .1] as Triple, offset: [-.3, -2.3, -3.1] as Triple } },
    { x: 6.25, z: .5, fall: { rotation: [.12, .2, -.72] as Triple, offset: [.05, -.25, 0] as Triple } },
    { x: 1.1, z: -4.4, fall: null },
  ].slice(0, profile.pylonCount)
  fragment('pylon-stumps', 'plinth', {}, STANDING_CHAR, emit => {
    for (const { x, z } of pylons) {
      emit(stage, {
        select: part => part.shape === 'box' && at(part, x, undefined, z) && part.scale[1] > 1,
        fractures: [pylonBreak(x, z, 2.3)],
      })
    }
  })
  for (const { x, z, fall } of pylons) {
    if (fall === null) continue
    // The west mast fell clear; the east mast still hangs from its stump.
    const fell = x < 0
    fragment(`pylon-mast-${fell ? 'west' : 'east'}`, fell ? 'ground' : 'pylon-stumps', {
      pivot: [x, 2.3, z], rotation: fall.rotation, offset: fall.offset,
    }, FALLEN_CHAR, emit => {
      emit(stage, {
        select: part => part.shape === 'box' && at(part, x, undefined, z),
        fractures: [{ ...pylonBreak(x, z, 2.3), normal: [-.3, -1, .25] }],
      })
    }, fell ? 'ground' : 'settled')
  }

  // Loose regolith banked against the sunk walls, so no clean plinth edge shows.
  fragment('regolith', 'ground', {}, REGOLITH_CHAR, emit => {
    emit(add => {
      add('mound', REGOLITH, [-8.3, .05, .6], [2.1, 1.3, 3.4], [0, .3, 0])
      add('mound', REGOLITH, [-5.9, 0, -5.7], [2.6, 1.1, 1.5], [0, -.2, 0])
      add('mound', REGOLITH, [2.9, 0, -5.8], [3.2, 1.0, 1.4], [0, .15, 0])
      add('mound', REGOLITH, [7.6, .05, -1.6], [1.6, 1.2, 3.0], [0, .5, 0])
      add('mound', REGOLITH, [4.9, 0, 5.3], [2.8, .9, 1.4], [0, -.35, 0])
    }, { anchored: true })
  }, 'ground')

  return finish()
}
