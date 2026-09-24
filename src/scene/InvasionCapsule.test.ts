import { describe, expect, it } from 'vitest'
import { Group, Matrix4, Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  calculateCapsuleGrounding,
  leafOpenProgress,
  rampBottomClearance,
} from './InvasionCapsule.tsx'
import {
  CAPSULE_SCALE,
  LANDER_BODY_YAW,
  LANDER_DOOR,
  LANDER_PAD,
  LANDER_PAD_BOTTOM_Y,
  SHAPE_HALF,
  authorLander,
  rampPivotModel,
  rampUndersidePoints,
  visorPivotModel,
  type LanderPart,
} from './landerModel.ts'
import { CAPSULE_SERVICE_ANCHOR, WORKER_RADIUS_M } from './miningPresentation.ts'
import { LANDER_CLEARANCE_RADIUS_M, MODULE_SOCKETS } from './moduleLayout.ts'

const site = createLandingSite(createLunarLocation(0.248, -0.684, 18))
const terrain = createSurfaceTerrainProfile(site)
const METRES_PER_MODEL = CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS
const PAD_EMBED_MODEL = 0.008 / METRES_PER_MODEL
const RAMP_EMBED_MODEL = 0.006 / METRES_PER_MODEL
const GEAR = /^leg\d-(pad|ankle|rod|pad-stripe)$/
const GOLDEN = {
  96: {
    landedHeight: 0.0007745048361141355,
    pads: [-0.008003290509961056, -0.030038575792007506, -0.0090823904978691, 0],
  },
  112: {
    landedHeight: 0.0007739192230295602,
    pads: [-0.007676767297678786, -0.03924185908831821, -0.009717022592505729, 0],
  },
  128: {
    landedHeight: 0.0007735292762985462,
    pads: [-0.00942051954197205, -0.04877626391120518, -0.011693940757169528, 0],
  },
} as const
const SEGMENTS = [96, 112, 128] as const

/** Terrain height below a model-frame point, relative to the landed origin. */
function groundModel(segments: number, landedHeight: number, x: number, z: number): number {
  const surface = sampleRenderedSurface(terrain, segments, x * METRES_PER_MODEL, z * METRES_PER_MODEL)
  return (surface.y - landedHeight) / CAPSULE_SCALE
}

function corners(part: LanderPart, transform = new Matrix4()): Vector3[] {
  const half = SHAPE_HALF[part.shape]
  const points: Vector3[] = []
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    points.push(new Vector3(x * half[0], y * half[1], z * half[2])
      .applyMatrix4(part.matrix).applyMatrix4(transform))
  }
  return points
}

/** Mirrors the scene graph: pivot group (position, yaw) > leaf (rotation.x). */
function leafTransform(pivot: Vector3, angle: number): Matrix4 {
  const hinge = new Group()
  const leaf = new Group()
  hinge.position.copy(pivot)
  hinge.rotation.y = LANDER_BODY_YAW
  leaf.rotation.x = angle
  hinge.add(leaf)
  hinge.updateMatrixWorld(true)
  return leaf.matrixWorld.clone()
}

describe('player lander grounding integration', () => {
  it.each(SEGMENTS)('keeps the approved landed height and pad offsets at %i segments', (segments) => {
    const grounding = calculateCapsuleGrounding(terrain, segments)
    const golden = GOLDEN[segments]
    expect(grounding.landedHeight).toBeCloseTo(golden.landedHeight, 15)
    expect(grounding.padOffsetsModel).toHaveLength(4)
    grounding.padOffsetsModel.forEach((offset, leg) => {
      expect(offset, `leg ${leg} offset`).toBeCloseTo(golden.pads[leg]!, 12)
      expect(offset, `leg ${leg} never lifts above the contact plane`).toBeLessThanOrEqual(0)
    })
    expect(Math.max(...grounding.padOffsetsModel)).toBe(0)
  })

  it.each(SEGMENTS)('seats every authored pad on terrain without sinking the hull at %i segments', (segments) => {
    const { landedHeight, padOffsetsModel } = calculateCapsuleGrounding(terrain, segments)
    const hull = authorLander(padOffsetsModel).hull
    for (let leg = 0; leg < 4; leg++) {
      const pad = hull.find(part => part.label === `leg${leg}-pad`)!
      const center = new Vector3().setFromMatrixPosition(pad.matrix)
      const bottom = LANDER_PAD_BOTTOM_Y + padOffsetsModel[leg]!
      // Centre plus the eight rim vertices of the octagonal pad.
      const radius = new Vector3().setFromMatrixScale(pad.matrix).x
      const samples = [[center.x, center.z], ...Array.from({ length: 8 }, (_, index) => {
        const angle = Math.PI / 8 + index * Math.PI / 4
        return [center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius]
      })]
      const gaps = samples.map(([x, z]) => bottom - groundModel(segments, landedHeight, x!, z!))
      // Contact: the nearest pad point is within ~2.4 cm of the regolith and
      // no point is buried deeper than the grounding embed.
      expect(Math.min(...gaps), `leg ${leg} nearest contact`).toBeLessThanOrEqual(0.01)
      expect(Math.min(...gaps), `leg ${leg} embed`).toBeGreaterThanOrEqual(-PAD_EMBED_MODEL - 1e-9)
      // A flat pad on a gentle slope may open a small downhill gap only.
      expect(Math.max(...gaps), `leg ${leg} downhill gap`).toBeLessThanOrEqual(0.05)
    }
    for (const part of hull.filter(part => !GEAR.test(part.label))) {
      for (const point of corners(part)) {
        const clearance = point.y - groundModel(segments, landedHeight, point.x, point.z)
        expect(clearance, `${part.label} above terrain`).toBeGreaterThan(0.12)
      }
    }
  })
})

describe('player lander ramp and visor integration', () => {
  it('eases both leaves open early in deployment', () => {
    expect(leafOpenProgress(0, 4)).toBe(0)
    expect(leafOpenProgress(0.125, 4)).toBeCloseTo(0.75, 12)
    expect(leafOpenProgress(0.25, 4)).toBe(1)
    expect(leafOpenProgress(1 / 3, 3)).toBe(1)
    expect(leafOpenProgress(1, 3)).toBe(1)
    let previous = 0
    for (let step = 0; step <= 100; step++) {
      const value = leafOpenProgress(step / 100, 3)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it.each(SEGMENTS)('lands the opened ramp on its support at %i segments', (segments) => {
    const { landedHeight, padOffsetsModel, rampOpenAngle } = calculateCapsuleGrounding(terrain, segments)
    const frontPadTop = LANDER_PAD.centerY + LANDER_PAD.halfHeight + padOffsetsModel[3]!
    expect(rampOpenAngle).toBeGreaterThan(Math.PI / 2)
    expect(rampOpenAngle).toBeLessThan(Math.PI - 0.1)
    const at = (angle: number) => rampBottomClearance(terrain, segments, landedHeight, angle, frontPadTop)
    expect(Math.abs(at(rampOpenAngle)) / CAPSULE_SCALE).toBeLessThan(1e-4)
    expect(at(rampOpenAngle - 0.02)).toBeGreaterThan(0)
    expect(at(rampOpenAngle + 0.02)).toBeLessThan(0)

    for (const point of rampUndersidePoints(rampOpenAngle)) {
      const gap = point.y - groundModel(segments, landedHeight, point.x, point.z)
      expect(gap, 'ramp underside is never buried').toBeGreaterThanOrEqual(-RAMP_EMBED_MODEL - 1e-4)
      // Known compromise: the left rail rests on the front pad, so the lip
      // may stand a few centimetres proud of the regolith.
      expect(gap, 'ramp underside stays near the regolith').toBeLessThan(0.16)
    }
  })

  it('lets the front pad, not the terrain alone, stop the ramp on the standard site', () => {
    const { landedHeight, padOffsetsModel, rampOpenAngle } = calculateCapsuleGrounding(terrain, 112)
    const frontPadTop = LANDER_PAD.centerY + LANDER_PAD.halfHeight + padOffsetsModel[3]!
    const withPad = rampBottomClearance(terrain, 112, landedHeight, rampOpenAngle, frontPadTop)
    const terrainOnly = rampBottomClearance(terrain, 112, landedHeight, rampOpenAngle, -Infinity)
    expect(terrainOnly).toBeGreaterThan(withPad)
    const overPad = rampUndersidePoints(rampOpenAngle)
      .filter(point => Math.hypot(point.x, point.z - LANDER_PAD.radius) < 0.235)
    expect(overPad.length).toBeGreaterThan(0)
    expect(Math.min(...overPad.map(point => point.y))).toBeGreaterThanOrEqual(frontPadTop - 1e-4)
  })

  it.each(SEGMENTS)('opens both leaves without cutting the front pad or garage lane at %i segments', (segments) => {
    const { padOffsetsModel, rampOpenAngle } = calculateCapsuleGrounding(terrain, segments)
    const authored = authorLander(padOffsetsModel)
    const ramp = leafTransform(rampPivotModel(), rampOpenAngle)
    const visor = leafTransform(visorPivotModel(), -LANDER_DOOR.visorOpenAngle)
    const pad = authored.hull.find(part => part.label === 'leg3-pad')!
    const padInverse = pad.matrix.clone().invert()
    const padScale = new Vector3().setFromMatrixScale(pad.matrix)

    for (const part of authored.ramp) {
      for (const point of corners(part, ramp)) {
        const local = point.clone().applyMatrix4(padInverse)
        const radialDepth = (1 - Math.hypot(local.x, local.z)) * padScale.x
        const verticalDepth = (0.5 - Math.abs(local.y)) * padScale.y
        const depth = Math.min(radialDepth, verticalDepth)
        expect(depth, `${part.label} inside front pad`).toBeLessThan(0.005)
      }
    }
    // The deployed ramp lip lands outboard and below its hinge.
    const lip = new Vector3(0, 0.42, 0).applyMatrix4(ramp)
    expect(Math.hypot(lip.x, lip.z)).toBeGreaterThan(Math.hypot(rampPivotModel().x, rampPivotModel().z))
    expect(lip.y).toBeLessThan(rampPivotModel().y)
    // The raised visor clears the doorway above the miner.
    for (const part of authored.visor) {
      for (const point of corners(part, visor)) {
        expect(point.y, `${part.label} raised`).toBeGreaterThan(-0.2)
      }
    }
  })
})

describe('player lander surroundings', () => {
  const grounding = calculateCapsuleGrounding(terrain, 112)
  const authored = authorLander(grounding.padOffsetsModel)
  const opened = [
    ...authored.hull.flatMap(part => corners(part)),
    ...authored.ramp.flatMap(part => corners(part, leafTransform(rampPivotModel(), grounding.rampOpenAngle))),
    ...authored.visor.flatMap(part => corners(part, leafTransform(visorPivotModel(), -LANDER_DOOR.visorOpenAngle))),
  ]
  const footprintM = Math.max(...opened.map(point => Math.hypot(point.x, point.z))) * METRES_PER_MODEL

  it('stays inside the worker-navigation lander disc and clear of the service berth', () => {
    expect(footprintM).toBeLessThan(LANDER_CLEARANCE_RADIUS_M)
    expect(CAPSULE_SERVICE_ANCHOR.radiusM - WORKER_RADIUS_M).toBeGreaterThan(footprintM + 0.5)
  })

  it('meets the existing solar-wing coupling at the reserved socket', () => {
    const wing = MODULE_SOCKETS.SOLAR_WING
    // OutpostModule: the coupling runs 4.6 m along x, centred at -3.7 m, and
    // 0.00014 render units above the wing socket's rendered surface.
    const couplingEndModel = (-3.7 + 4.6 / 2) / METRES_PER_MODEL
    const couplingYModel = (sampleRenderedSurface(terrain, 112, wing.xM, wing.zM).y + 0.00014
      - grounding.landedHeight) / CAPSULE_SCALE
    const mount = authored.hull.find(part => part.label === 'solar-socket-mount')!
    const bounds = corners(mount)
    const minX = Math.min(...bounds.map(point => point.x))
    const maxX = Math.max(...bounds.map(point => point.x))
    const minY = Math.min(...bounds.map(point => point.y))
    const maxY = Math.max(...bounds.map(point => point.y))
    expect(couplingEndModel).toBeGreaterThan(minX)
    expect(couplingEndModel).toBeLessThan(maxX)
    expect(couplingYModel).toBeGreaterThan(minY + 0.06)
    expect(couplingYModel).toBeLessThan(maxY - 0.06)
    // Nothing but the socket sits on the coupling's run into the hull.
    for (const part of authored.hull.filter(part => !part.label.startsWith('solar-'))) {
      for (const point of corners(part)) {
        const inRun = point.x < minX && point.x > -1.3
          && Math.abs(point.z) < 0.08 && Math.abs(point.y - couplingYModel) < 0.06
        expect(inRun, `${part.label} blocks the coupling`).toBe(false)
      }
    }
  })
})
