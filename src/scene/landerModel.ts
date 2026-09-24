import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROBOT_IDLE_POSITION } from '../domain/outpost.ts'
import { EMISSIVE_LIMITS, VISUAL_PALETTE } from '../render/visualSystem.ts'
import { CAPSULE_SERVICE_ANCHOR } from './miningPresentation.ts'

/** All authored dimensions are model units; scaling belongs to the caller. */
export const CAPSULE_SCALE = 0.00029
export const LANDER_BODY_YAW = Math.atan2(
  ROBOT_IDLE_POSITION.xM,
  ROBOT_IDLE_POSITION.zM - 0.45,
)
export const LANDER_BODY_SHIFT = -0.09
export const LANDER_PAD = Object.freeze({
  radius: 1.04, centerY: -1.08, halfHeight: .045, halfX: .24, halfZ: .21,
})
export const LANDER_PAD_BOTTOM_Y = -1.125
export const LANDER_GARAGE = Object.freeze({
  halfWidth: .60, floorTopY: -.92, ceilingY: -.10, mouthZ: .60, backZ: -.30,
})
export const LANDER_DOOR = Object.freeze({
  planeZ: .67, halfWidth: .56, halfThickness: .035, rampHalfThickness: .018,
  rampLength: .42, visorLength: .40, visorOpenAngle: 1.85,
})
export const LANDER_ENGINE_EXIT_Y = -1.0
export const LANDER_TOP_Y = 1.6
export const LANDER_LEG_SWEEP = [-1, 0, 0, 1] as const

type Triple = readonly [number, number, number]
type Shape = 'box' | 'panel' | 'prism' | 'block' | 'drum' | 'rod' | 'bell'

export const SHAPE_HALF: Readonly<Record<Shape, Triple>> = Object.freeze({
  box: [.5, .5, .5],
  panel: [.5, .5, .5],
  prism: [1, .5, 1],
  block: [1, .5, 1],
  drum: [1, .5, 1],
  rod: [1, .5, 1],
  bell: [1, .5, 1],
})

export type LanderPart = {
  label: string
  shape: Shape
  finish: string
  matrix: Matrix4
}

// Palette key, roughness, metalness, emission, composite response.
const FINISH = {
  hull: ['playerComposite', .54, .28, 0, 1],
  plate: ['lunarMid', .60, .30, 0, 0],
  paint: ['playerAmberPanel', .62, .22, 0, 0],
  armor: ['playerSteel', .56, .46, 0, 0],
  frame: ['neutralMachinery', .62, .42, 0, 0],
  heat: ['playerHeatDark', .74, .34, 0, 0],
  dark: ['contactDark', .90, .05, 0, 0],
  hazard: ['warningStripe', .60, .20, 0, 0],
  brass: ['monumentGold', .34, .68, 0, 0],
  amber: ['playerAmberEmissive', .50, .20, EMISSIVE_LIMITS.panel, 0],
  led: ['playerAmberEmissive', .50, .20, EMISSIVE_LIMITS.tinyLed, 0],
  nozzle: ['playerHotMetal', .62, .34, EMISSIVE_LIMITS.residualHeat, 0],
} as const satisfies Record<string, readonly [keyof typeof VISUAL_PALETTE, number, number, number, number]>
type Finish = keyof typeof FINISH

function C(position: Triple, scale: Triple, rotation: Triple = [0, 0, 0]): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(...scale),
  )
}

function SEG(a: Triple, b: Triple, radius: number): Matrix4 {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const direction = end.clone().sub(start)
  const length = direction.length()
  return new Matrix4().compose(
    start.add(end).multiplyScalar(.5),
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
    new Vector3(radius, length, radius),
  )
}

export function bodyMatrix(): Matrix4 {
  return new Matrix4().makeTranslation(
    Math.cos(LANDER_BODY_YAW) * LANDER_BODY_SHIFT,
    0,
    -Math.sin(LANDER_BODY_YAW) * LANDER_BODY_SHIFT,
  ).multiply(new Matrix4().makeRotationY(LANDER_BODY_YAW))
}

export function rampPivotModel(): Vector3 {
  return new Vector3(0, -.92, .67).applyMatrix4(bodyMatrix())
}

export function visorPivotModel(): Vector3 {
  return new Vector3(0, -.10, .67).applyMatrix4(bodyMatrix())
}

/** Hull matrices are model-local; the two door batches remain hinge-local. */
export function authorLander(padOffsetsModel: readonly number[] = [0, 0, 0, 0]) {
  const hull: LanderPart[] = []
  const ramp: LanderPart[] = []
  const visor: LanderPart[] = []
  const body = bodyMatrix()
  const add = (target: LanderPart[], frame: Matrix4) => (
    label: string, shape: Shape, finish: Finish,
    position: Triple, scale: Triple, rotation: Triple = [0, 0, 0],
  ) => {
    target.push({ label, shape, finish, matrix: C(position, scale, rotation).premultiply(frame) })
  }
  const B = add(hull, body)

  B('garage-floor', 'box', 'frame', [0, -.945, .15], [1.28, .05, .90])
  B('garage-ceiling', 'box', 'frame', [0, -.075, .15], [1.28, .05, .90])
  for (const side of [-1, 1]) {
    B('garage-wall', 'box', 'hull', [side * .62, -.51, .15], [.04, .82, .90])
    for (const z of [-.2, .2]) {
      B('garage-rib', 'box', 'frame', [side * .595, -.51, z], [.03, .84, .05])
    }
    B('portal-jamb', 'box', 'armor', [side * .66, -.48, .62], [.12, .98, .08])
    B('portal-chevron', 'panel', 'hazard', [side * .66, -.82, .662], [.09, .16, .008])
  }
  B('garage-back', 'box', 'dark', [0, -.49, -.28], [1.20, .86, .04])
  for (const side of [-1, 1]) {
    B('garage-back-light', 'panel', 'amber', [side * .34, -.49, -.255], [.035, .52, .012])
  }
  B('garage-ceiling-light', 'box', 'amber', [0, -.112, .50], [.90, .02, .03])
  B('garage-floor-lip', 'box', 'hazard', [0, -.916, .57], [1.20, .008, .05])
  B('portal-lintel', 'box', 'armor', [0, -.04, .62], [1.44, .12, .08])

  B('keel', 'prism', 'hull', [0, -.52, -.72], [.66, .66, .24])
  B('keel-heatplate', 'box', 'heat', [0, -.855, -.72], [1.10, .03, .40])
  for (const side of [-1, 1]) {
    B('side-pod', 'block', 'hull', [side * .80, -.56, -.18], [.14, .34, .30])
    B('side-pod-armor', 'box', 'paint', [side * .86, -.50, -.18], [.10, .18, .46], [0, 0, side * .35])
    B('side-pod-strut', 'box', 'frame', [side * .70, -.44, -.18], [.12, .06, .34])
  }
  B('core', 'prism', 'hull', [0, .23, -.12], [.62, .58, .64])
  B('core-collar', 'block', 'frame', [0, -.05, -.12], [.67, .10, .69])
  for (const a of [Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2]) {
    B('light-ring', 'panel', 'amber', [.667 * Math.sin(a), 0, -.12 + .667 * Math.cos(a)], [.20, .018, .012], [0, a, 0])
  }
  B('hull-front-plate', 'box', 'plate', [0, .26, .50], [.66, .34, .04])
  for (const side of [-1, 1]) {
    B('core-side-plate', 'box', 'plate', [side * .585, .24, -.12], [.04, .38, .46])
    B('core-cheek', 'box', 'armor', [side * .44, .24, .36], [.05, .36, .30], [0, side * .62, 0])
  }
  B('core-rear-plate', 'box', 'plate', [0, .24, -.74], [.46, .38, .04])

  B('cabin', 'prism', 'hull', [-.04, .66, -.18], [.46, .40, .46])
  B('brow', 'box', 'plate', [-.04, .78, .25], [.56, .20, .06], [-.55, 0, 0])
  B('viewport', 'panel', 'amber', [-.04, .63, .27], [.40, .045, .02])
  B('viewport-frame', 'box', 'frame', [-.04, .63, .262], [.50, .10, .02])
  B('spine', 'block', 'hull', [-.16, .90, -.30], [.24, .10, .30])
  B('roof-hatch', 'drum', 'frame', [.16, .87, -.06], [.11, .035, .11])
  B('roof-hatch-ring', 'drum', 'brass', [.16, .89, -.06], [.12, .008, .12])

  B('hopper', 'bell', 'frame', [.50, .60, .30], [.18, .20, .18], [Math.PI, 0, 0])
  B('hopper-rim', 'drum', 'hazard', [.50, .705, .30], [.185, .02, .185])
  B('hopper-mouth', 'drum', 'dark', [.50, .69, .30], [.165, .012, .165])
  B('hopper-chute', 'box', 'frame', [.46, .46, .24], [.12, .14, .16])
  B('hopper-led', 'panel', 'led', [.50, .74, .49], [.06, .025, .012])
  B('locker', 'box', 'paint', [-.56, .20, .36], [.20, .30, .16], [0, .3, 0])
  B('locker-stripe', 'panel', 'hazard', [-.60, .30, .45], [.12, .03, .01], [0, .3, 0])
  B('floodlight', 'box', 'frame', [-.30, .05, .66], [.14, .07, .06])
  B('floodlight-lens', 'panel', 'amber', [-.30, .05, .694], [.11, .045, .008])

  for (const [x, y, z, r, h] of [[-.42, .18, -.62, .17, .70], [.10, .12, -.78, .14, .56]] as const) {
    B('tank', 'block', 'hull', [x, y, z], [r, h, r])
    for (const side of [-1, 1]) {
      B('tank-band', 'drum', 'brass', [x, y + side * .2 * h, z], [r + .012, .02, r + .012])
    }
  }
  B('mast', 'rod', 'frame', [-.30, 1.24, -.44], [.03, .64, .03])
  B('mast-collar', 'block', 'frame', [-.30, .92, -.44], [.08, .10, .08])
  B('mast-paddle', 'box', 'paint', [-.20, 1.42, -.44], [.02, .20, .22], [0, 0, .28])
  B('mast-head', 'box', 'frame', [-.30, 1.54, -.44], [.16, .07, .10])
  B('mast-led', 'box', 'led', [-.30, 1.585, -.44], [.03, .03, .03])
  B('radiator', 'box', 'armor', [.50, .86, -.40], [.03, .60, .56])
  for (const y of [.64, .80, .96, 1.12]) {
    B('radiator-rib', 'box', 'frame', [.50, y, -.40], [.06, .02, .58])
  }
  B('radiator-root', 'box', 'frame', [.50, .52, -.40], [.12, .10, .34])

  for (const [x, z] of [[-.80, -.18], [.80, -.18], [-.32, -.72], [.32, -.72]] as const) {
    B('engine-housing', 'block', 'frame', [x, -.76, z], [.11, .08, .11])
    B('engine-bell', 'bell', 'heat', [x, -.90, z], [.13, .20, .13])
    B('engine-exit', 'drum', 'nozzle', [x, -.994, z], [.115, .008, .115])
    B('engine-gimbal', 'drum', 'brass', [x, -.80, z], [.075, .02, .075])
  }

  const M = add(hull, new Matrix4())
  M('solar-socket', 'box', 'dark', [-.72, -.60, 0], [.03, .26, .24])
  M('solar-socket-frame', 'box', 'frame', [-.70, -.60, 0], [.06, .32, .30])
  M('solar-socket-mount', 'box', 'hull', [-.62, -.60, 0], [.14, .30, .30])
  const delta = Math.atan2(CAPSULE_SERVICE_ANCHOR.xM, CAPSULE_SERVICE_ANCHOR.zM)
  const at = (r: number, y: number): Triple => [r * Math.sin(delta), y, r * Math.cos(delta)]
  M('service-mount', 'box', 'hull', at(.74, -.34), [.28, .30, .16], [0, delta, 0])
  M('service-socket', 'box', 'dark', at(.82, -.34), [.16, .16, .02], [0, delta, 0])
  M('service-led', 'panel', 'led', at(.83, -.20), [.06, .02, .01], [0, delta, 0])
  M('service-boom', 'box', 'frame', at(.95, -.12), [.05, .05, .30], [0, delta, 0])

  for (let i = 0; i < 4; i++) {
    const frame = new Matrix4().makeRotationY(i * Math.PI / 2)
    const L = add(hull, frame)
    const sw = LANDER_LEG_SWEEP[i]!
    const off = padOffsetsModel[i] ?? 0
    const padTop = -1.035 + off
    const HP: Triple = sw === 0 ? [.60, .10, 0] : [.44, .10, .52 * sw]
    const K: Triple = sw === 0 ? [1.10, -.50, 0] : [1.08, -.50, .14 * sw]
    // Widen only leg 2's twin members to clear the reserved solar corridor.
    const straightHalf = i === 2 ? .151 : .14
    const half = sw === 0 ? straightHalf : .085
    const hpHalf = sw === 0 ? straightHalf : .12
    const hpDepth = sw === 0 ? .40 : .36
    const segment = (label: string, shape: Shape, finish: Finish, a: Triple, b: Triple, radius: number) => {
      hull.push({ label: `leg${i}-${label}`, shape, finish, matrix: SEG(a, b, radius).premultiply(frame) })
    }
    for (const v of [-1, 1]) {
      const k: Triple = [K[0], K[1], K[2] + v * half]
      const h: Triple = [HP[0], HP[1], HP[2] + v * hpHalf]
      segment('upper', 'box', 'armor', h, k, .085)
      L(`leg${i}-knee`, 'box', 'paint', k, [.12, .12, .09])
      segment('sleeve', 'rod', 'armor', k, [k[0], -.80, k[2]], .05)
      L(`leg${i}-collar`, 'rod', 'brass', [k[0], -.81, k[2]], [.05, .02, .05])
      segment('rod', 'rod', 'frame', [k[0], -.76, k[2]], [(1.04 + k[0]) / 2, padTop + .02, k[2]], .026)
    }
    L(`leg${i}-crossbar`, 'box', 'frame', [K[0], -.80, K[2]], [.05, .05, 2 * half + .06])
    L(`leg${i}-hardpoint`, 'box', 'frame', [HP[0] - .02, .10, HP[2]], [.12, .14, hpDepth])
    L(`leg${i}-knee-led`, 'panel', 'led', [K[0] + .065, -.50, K[2] + half], [.05, .03, .01], [0, Math.PI / 2, 0])
    L(`leg${i}-pad`, 'block', 'frame', [1.04, -1.08 + off, 0], [.235, .09, .235])
    L(`leg${i}-ankle`, 'box', 'armor', [1.06, padTop + .02, K[2]], [.08, .04, 2 * half + .10])
    L(`leg${i}-pad-stripe`, 'panel', 'hazard', [1.25, -1.06 + off, 0], [.16, .03, .01], [0, Math.PI / 2, 0])
  }

  const R = add(ramp, new Matrix4())
  R('ramp-skin', 'box', 'paint', [0, .21, 0], [1.12, .42, .036])
  for (const side of [-1, 1]) {
    R('ramp-chevron', 'panel', 'hazard', [side * .24, .231, .021], [.10, .16, .006], [0, 0, side * .5])
    R('ramp-edge', 'box', 'armor', [side * .54, .21, 0], [.04, .42, .040])
    R('ramp-hinge', 'rod', 'frame', [side * .38, 0, .030], [.03, .24, .03], [0, 0, Math.PI / 2])
  }
  for (const y of [.12, .22, .32]) {
    R('ramp-tread', 'box', 'frame', [0, y, -.022], [.92, .02, .008])
  }
  R('ramp-lip', 'box', 'hazard', [0, .405, 0], [1.12, .03, .040])

  const V = add(visor, new Matrix4())
  V('visor-skin', 'box', 'paint', [0, -.20, 0], [1.12, .40, .07])
  for (const side of [-1, 1]) {
    V('visor-rail', 'box', 'armor', [side * .51, -.20, .02], [.10, .40, .05])
    V('visor-hinge', 'rod', 'frame', [side * .38, 0, 0], [.04, .24, .04], [0, 0, Math.PI / 2])
  }
  V('visor-strip', 'panel', 'amber', [0, -.35, .039], [.50, .025, .008])
  V('visor-floodlight', 'panel', 'amber', [0, -.12, -.039], [.70, .03, .008])

  return { hull, ramp, visor, rampPivot: rampPivotModel(), visorPivot: visorPivotModel(), yaw: LANDER_BODY_YAW }
}

function makeShapes(): Record<Shape, BufferGeometry> {
  const panel = new BoxGeometry(1, 1, 1)
  // BoxGeometry groups 4 and 5 are the +Z/-Z faces. Keep their indices only.
  panel.setIndex(Array.from(panel.getIndex()!.array.slice(24, 36)))
  panel.clearGroups()
  const prism = new CylinderGeometry(1, 1, 1, 8, 3, false, Math.PI / 8)
  const position = prism.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if (Math.abs(y) > .49) {
      position.setX(i, position.getX(i) * .86)
      position.setZ(i, position.getZ(i) * .86)
    } else {
      position.setY(i, Math.sign(y) * .36)
    }
  }
  prism.computeVertexNormals()
  return {
    box: new BoxGeometry(1, 1, 1),
    panel,
    prism,
    block: new CylinderGeometry(1, 1, 1, 8, 1, false, Math.PI / 8),
    drum: new CylinderGeometry(1, 1, 1, 8, 1, false, Math.PI / 8),
    rod: new CylinderGeometry(1, 1, 1, 6, 1, true),
    bell: new CylinderGeometry(.46, 1, 1, 8, 1, true, Math.PI / 8),
  }
}

function mergeParts(parts: readonly LanderPart[], shapes: Record<Shape, BufferGeometry>): BufferGeometry {
  const geometries = parts.map(part => {
    const geometry = shapes[part.shape].toNonIndexed()
    geometry.applyMatrix4(part.matrix)
    const count = geometry.getAttribute('position').count
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2))
    }
    const [palette, roughness, metalness, emission, composite] = FINISH[part.finish as Finish]
    const color = new Color(VISUAL_PALETTE[palette])
    const colors = new Float32Array(count * 3)
    const finish = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      colors.set([color.r, color.g, color.b], i * 3)
      finish.set([roughness, metalness, emission, composite], i * 4)
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geometry.setAttribute('miningFinish', new Float32BufferAttribute(finish, 4))
    return geometry
  })
  const merged = mergeGeometries(geometries, false)
  for (const geometry of geometries) geometry.dispose()
  if (!merged) throw new Error('Lander part geometry attributes could not be merged')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/** Three geometry batches, with no materials or scene objects. */
export function createLanderGeometry(padOffsetsModel: readonly number[] = [0, 0, 0, 0]) {
  const authored = authorLander(padOffsetsModel)
  const shapes = makeShapes()
  try {
    return {
      hull: mergeParts(authored.hull, shapes),
      ramp: mergeParts(authored.ramp, shapes),
      visor: mergeParts(authored.visor, shapes),
      rampPivot: authored.rampPivot,
      visorPivot: authored.visorPivot,
      yaw: authored.yaw,
    }
  } finally {
    for (const shape of Object.values(shapes)) shape.dispose()
  }
}

export function rampUndersidePoints(theta: number): Vector3[] {
  const rotation = new Matrix4().makeRotationY(LANDER_BODY_YAW)
  const pivot = rampPivotModel()
  const points: Vector3[] = []
  for (const side of [-1, 1]) {
    for (const f of [.5, .75, 1]) {
      points.push(new Vector3(
        side * .54,
        f * .42 * Math.cos(theta) - .018 * Math.sin(theta),
        f * .42 * Math.sin(theta) + .018 * Math.cos(theta),
      ).applyMatrix4(rotation).add(pivot))
    }
  }
  return points
}
