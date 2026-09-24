import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Object3D, Vector3 } from 'three'
import { EMISSIVE_LIMITS, VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import type { RivalPresentationPhase } from '../app/rivalPresentation.ts'
import { rivalPresentationNeedsContinuousFrames } from '../app/rivalPresentation.ts'
import {
  CITADEL_FOOTPRINT,
  CITADEL_HARDPOINTS,
  CITADEL_HARDPOINT_MUZZLE_Z,
  CITADEL_HARDPOINT_TRUNNION_Y,
  authorCitadelHardpoints,
  authorCitadelHardpointSignal,
  authorCitadelStageHardware,
  createCitadelFoundation,
  createCitadelGeometry,
  poseCitadelHardpointPart,
} from './vesperCitadelGeometry.ts'
import type { CitadelAdd, Triple } from './vesperCitadelGeometry.ts'
import { getRivalStageVisualProfile } from './RivalFoothold.tsx'
import {
  VESPER_SIGNAL_PERIOD_MS,
  poseCitadelSignal,
  sampleCitadelSignal,
} from './vesperSignal.ts'
import { citadelLoopNeedsFrames } from './VesperCitadel.tsx'

function insideFootprint(x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = CITADEL_FOOTPRINT.length - 1; i < CITADEL_FOOTPRINT.length; j = i++) {
    const [xi, zi] = CITADEL_FOOTPRINT[i]!
    const [xj, zj] = CITADEL_FOOTPRINT[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

describe('Vesper citadel geometry', () => {
  it.each(['LANDED', 'ESTABLISHING', 'FORTIFIED'] as const)(
    'seats every low %s module on the terrain-sampled apron',
    (stage) => {
      const { architecture } = createCitadelGeometry(getRivalStageVisualProfile(stage))
      const position = architecture.getAttribute('position')
      const hanging: string[] = []

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index)
        const z = position.getZ(index)
        if (position.getY(index) < 1 && !insideFootprint(x, z)) {
          hanging.push(`${x.toFixed(2)},${z.toFixed(2)}`)
        }
      }

      expect(hanging).toEqual([])
    },
  )

  it('drops its skirt to the sampled ground along every footprint edge', () => {
    const ground = (x: number, z: number) => -0.4 + Math.sin(x * 0.7) * 0.2 + z * 0.02
    const foundation = createCitadelFoundation(ground)
    const position = foundation.getAttribute('position')
    let skirtVertices = 0

    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index)
      if (y < 0.4) {
        skirtVertices += 1
        expect(y).toBeCloseTo(ground(position.getX(index), position.getZ(index)) - 0.12, 6)
      }
    }

    expect(skirtVertices).toBeGreaterThan(CITADEL_FOOTPRINT.length * 6)
  })

  it('stays a handful of merged batches, not per-part meshes', () => {
    const parts = createCitadelGeometry(getRivalStageVisualProfile('FORTIFIED'))
    let triangles = 0
    for (const geometry of Object.values(parts)) {
      triangles += geometry.getAttribute('position').count / 3
    }

    expect(Object.keys(parts)).toHaveLength(8)
    expect(triangles).toBeLessThan(12_000)
  })
})

describe('Vesper signal loop', () => {
  const sampleAt = (ms: number) => sampleCitadelSignal(ms)

  it('runs a 7–12 second cycle that starts and ends idle', () => {
    expect(VESPER_SIGNAL_PERIOD_MS).toBeGreaterThanOrEqual(7_000)
    expect(VESPER_SIGNAL_PERIOD_MS).toBeLessThanOrEqual(12_000)
    for (const ms of [0, 1_500, 8_000, 9_900]) {
      const { charge, alignment, routing, transmission } = sampleAt(ms)
      expect(Math.max(charge, alignment, routing, transmission)).toBe(0)
    }
    expect(sampleAt(VESPER_SIGNAL_PERIOD_MS + 5_300)).toEqual(sampleAt(5_300))
  })

  it('charges, aligns, routes and transmits in order, then cools down', () => {
    const firstAbove = (key: 'charge' | 'alignment' | 'routing' | 'transmission') => {
      for (let ms = 0; ms < VESPER_SIGNAL_PERIOD_MS; ms += 20) {
        if (sampleAt(ms)[key] > 0.5) return ms
      }
      return Infinity
    }

    const charge = firstAbove('charge')
    const alignment = firstAbove('alignment')
    const routing = firstAbove('routing')
    const transmission = firstAbove('transmission')
    expect(charge).toBeLessThan(alignment)
    expect(alignment).toBeLessThan(routing)
    expect(routing).toBeLessThan(transmission)
    // Noticeable within five seconds of an idle start.
    expect(charge).toBeLessThan(5_000)
    expect(sampleAt(transmission + 1_500).transmission).toBe(0)
  })

  it('keeps cyan restrained at the transmission peak', () => {
    for (let ms = 0; ms < VESPER_SIGNAL_PERIOD_MS; ms += 25) {
      const pose = poseCitadelSignal(sampleAt(ms), ms)
      // Large lit surfaces stay at panel levels; only small tips reach LED level.
      expect(pose.core).toBeLessThanOrEqual(EMISSIVE_LIMITS.activePanel)
      expect(pose.routing).toBeLessThanOrEqual(EMISSIVE_LIMITS.activePanel)
      for (const level of [pose.crown, pose.array]) {
        expect(level).toBeLessThanOrEqual(EMISSIVE_LIMITS.tinyLed)
      }
      expect(pose.beam).toBeLessThanOrEqual(0.25)
      expect(Math.abs(pose.crownYaw)).toBeLessThan(0.5)
    }
  })

  it('only asks for frames in held close views the presentation does not already animate', () => {
    const phases: RivalPresentationPhase[] = [
      'idle', 'warning', 'orbital-transition', 'capsule-approach', 'impact',
      'intro-transmission', 'dual-sites', 'rival-focus', 'rival-focused',
      'scanning', 'scan-response', 'contested',
    ]
    const owned = phases.filter(citadelLoopNeedsFrames)
    expect(owned).toEqual(['intro-transmission', 'rival-focused', 'scan-response'])
    for (const phase of owned) {
      expect(rivalPresentationNeedsContinuousFrames(phase)).toBe(false)
    }
  })
})

function collectCitadelParts(author: (add: CitadelAdd) => void): Parameters<CitadelAdd>[] {
  const parts: Parameters<CitadelAdd>[] = []
  author((shape, color, position, scale, rotation = [0, 0, 0]) => {
    parts.push([shape, color, position, scale, rotation])
  })
  return parts
}

function expectTriple(actual: Triple, expected: Triple, tolerance = 1e-9): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tolerance)
}

describe('Vesper citadel hardpoints', () => {
  it('keeps the three stage slots and replaces only their crossbars with bearings', () => {
    const profile = getRivalStageVisualProfile('FORTIFIED')
    const parts = collectCitadelParts(add => authorCitadelStageHardware(add, profile))
    const slots = [[-6.45, -3.3], [6.25, .5], [1.1, -4.4]] as const
    const expected: Parameters<CitadelAdd>[] = []

    expect(profile.pylonCount).toBe(3)
    expect(profile.buttressCount).toBe(6)
    expect(CITADEL_HARDPOINTS.map(({ x, z }) => [x, z])).toEqual(slots)
    for (const [i, [x, z]] of slots.entries()) {
      expected.push(
        ['armor', P.rivalFrame, [x, 1.2, z], [1.12, 1.5, 1.22]],
        ['box', P.neutralMachinery, [x, 2.8 + i * .2, z], [.25, 3.3 + i * .4, .35]],
        ['box', P.neutralMachinery, [x, 4.3 + i * .4, z], [.42, .30, .42]],
      )
      const slot = parts.filter(([, , position]) => position[0] === x && position[2] === z)
      expect(slot).toHaveLength(3)
    }
    for (let i = 0; i < 6; i++) {
      expected.push(['armor', P.rivalFrame, [-5.5 + i * 2.05, 1, -4.8], [1.2, 1.8, 1.4], [-.15, 0, 0]])
    }

    expect(parts).toHaveLength(expected.length)
    for (const [i, [shape, color, position, scale, rotation = [0, 0, 0] as const]] of expected.entries()) {
      const part = parts[i]!
      expect(part[0]).toBe(shape)
      expect(part[1]).toBe(color)
      expectTriple(part[2], position)
      expectTriple(part[3], scale)
      expectTriple(part[4]!, rotation)
    }
    expect(parts.filter(([shape, , , scale]) => shape === 'box' && scale[0] >= .8)).toEqual([])
  })

  it.each([
    ['LANDED', 1752, 48, 84, 2688],
    ['ESTABLISHING', 2448, 96, 108, 3456],
    ['FORTIFIED', 3072, 120, 132, 4128],
  ] as const)('keeps the exact eight %s batch triangle counts', (stage, architecture, routing, lamps, total) => {
    const geometries = createCitadelGeometry(getRivalStageVisualProfile(stage))
    const counts = Object.fromEntries(Object.entries(geometries).map(([name, geometry]) => [
      name, geometry.getAttribute('position').count / 3,
    ]))

    expect(counts).toEqual({
      architecture, core: 96, routing, lamps, crown: 336,
      crownSignal: 36, array: 312, arraySignal: 24,
    })
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(total)
    for (const geometry of Object.values(geometries)) geometry.dispose()
  })

  it.each(['fixed', 'turret', 'cradle'] as const)('composes %s part poses before arbitrary scale', frame => {
    const cases: readonly { position: Triple, rotation: Triple, scale: Triple }[] = [
      { position: [.21, -.37, 1.12], rotation: [.31, -.24, .19], scale: [.8, 1.3, .45] },
      { position: [-.42, .53, -.28], rotation: [-.47, .36, -.23], scale: [1.7, .62, 2.1] },
      { position: [.08, .16, .97], rotation: [.22, .51, -.34], scale: [.31, 2.4, .93] },
    ]

    for (const hardpoint of CITADEL_HARDPOINTS) for (const { position, rotation, scale } of cases) {
      const expected = new Matrix4().makeTranslation(hardpoint.x, hardpoint.pivotY, hardpoint.z)
      if (frame !== 'fixed') expected.multiply(new Matrix4().makeRotationY(hardpoint.yaw))
      if (frame === 'cradle') {
        expected.multiply(new Matrix4().makeTranslation(0, .6, 0))
        expected.multiply(new Matrix4().makeRotationX(-hardpoint.elevation))
      }
      expected.multiply(new Matrix4().makeTranslation(...position))
      expected.multiply(new Matrix4().makeRotationFromEuler(new Euler(...rotation, 'XYZ')))
      expected.multiply(new Matrix4().makeScale(...scale))

      const pose = poseCitadelHardpointPart(hardpoint, frame, position, rotation)
      const part = new Object3D()
      part.position.fromArray(pose.position)
      part.rotation.set(...pose.rotation, 'XYZ')
      part.scale.fromArray(scale)
      part.updateMatrix()
      for (let i = 0; i < 16; i++) {
        expect(Math.abs(part.matrix.elements[i]! - expected.elements[i]!)).toBeLessThanOrEqual(1e-9)
      }
    }
  })

  it('defaults to a zero local rotation and returns independent pose arrays', () => {
    const hardpoint = CITADEL_HARDPOINTS[0]
    const position: Triple = [.2, -.1, .8]
    const first = poseCitadelHardpointPart(hardpoint, 'cradle', position)
    const snapshot = { position: [...first.position], rotation: [...first.rotation] }
    const second = poseCitadelHardpointPart(hardpoint, 'cradle', position, [0, 0, 0])
    poseCitadelHardpointPart(CITADEL_HARDPOINTS[1], 'turret', [-.8, .7, .6], [.3, .2, .1])

    expect(first).toEqual(second)
    expect(first).toEqual(snapshot)
    expect(first.position).not.toBe(second.position)
    expect(first.rotation).not.toBe(second.rotation)
    expect(first.position).not.toBe(position)
  })

  it('raises forward muzzles and clears the west knife buttress', () => {
    const referenceTips: Triple[] = [[-6.815, 4.973, -1.809], [6.523, 5.450, 2.002], [1.008, 5.804, -2.871]]
    expect(CITADEL_HARDPOINT_TRUNNION_Y).toBe(.6)
    expect(CITADEL_HARDPOINT_MUZZLE_Z).toBe(1.54)

    for (const [i, hardpoint] of CITADEL_HARDPOINTS.entries()) {
      const tip = poseCitadelHardpointPart(hardpoint, 'cradle', [0, 0, CITADEL_HARDPOINT_MUZZLE_Z]).position
      const origin = poseCitadelHardpointPart(hardpoint, 'cradle', [0, 0, 0]).position
      const direction: Triple = [
        Math.sin(hardpoint.yaw) * Math.cos(hardpoint.elevation),
        Math.sin(hardpoint.elevation),
        Math.cos(hardpoint.yaw) * Math.cos(hardpoint.elevation),
      ]
      expectTriple(tip, [
        hardpoint.x + 1.54 * direction[0],
        hardpoint.pivotY + .6 + 1.54 * direction[1],
        hardpoint.z + 1.54 * direction[2],
      ], 1e-6)
      expectTriple(tip, referenceTips[i]!, .001)
      const actualDirection = new Vector3().fromArray(tip).sub(new Vector3().fromArray(origin)).normalize()
      expectTriple([actualDirection.x, actualDirection.y, actualDirection.z], direction, 1e-6)
      expect(actualDirection.z).toBeGreaterThanOrEqual(.95)
      expect(actualDirection.y).toBeGreaterThan(0)
      if (i === 0) expect(tip[0]).toBeLessThan(-6.7)
    }
  })

  it.each(['ESTABLISHING', 'FORTIFIED'] as const)('keeps %s hardpoints graphite with two cyan parts per slot', stage => {
    const profile = getRivalStageVisualProfile(stage)
    const parts = collectCitadelParts(add => authorCitadelHardpoints(add, profile))
    const signal = collectCitadelParts(add => authorCitadelHardpointSignal(add, profile))

    expect(parts).toHaveLength(profile.pylonCount * 13 + 2)
    expect(parts.filter(([, color]) => color === P.rivalCyanPanel)).toEqual([])
    expect(parts.filter(([, color]) => color === P.rivalHighlight)).toEqual([])
    expect(signal).toHaveLength(profile.pylonCount * 2)
    for (let i = 0; i < profile.pylonCount; i++) {
      const slot = signal.slice(i * 2, i * 2 + 2)
      expect(slot.map(([shape, color]) => [shape, color])).toEqual([
        ['box', P.rivalCyanPanel], ['box', P.rivalCyanPanel],
      ])
      const hardpoint = CITADEL_HARDPOINTS[i]!
      for (const [j, position] of ([[0, -.02, .82], [0, 0, 1.555]] as const).entries()) {
        const pose = poseCitadelHardpointPart(hardpoint, 'cradle', position)
        expectTriple(slot[j]![2], pose.position)
        expectTriple(slot[j]![4]!, pose.rotation)
      }
      expectTriple(slot[0]![3], [.06, .12, 1.18])
      expectTriple(slot[1]![3], [.05, .05, .03])
    }
  })

  it('adds only the collar and strut mounts in model space', () => {
    const profile = getRivalStageVisualProfile('FORTIFIED')
    const slots = CITADEL_HARDPOINTS.map((_, i) => {
      const parts = collectCitadelParts(add => authorCitadelHardpoints(add, { ...profile, pylonCount: i + 1 }))
      return parts.slice(i === 0 ? 0 : i * 14)
    })

    expect(slots.map(parts => parts.length)).toEqual([14, 14, 13])
    expect(slots[0]![13]).toEqual(['box', P.rivalFrame, [-6.45, 3.08, -3.3], [1.0, .26, 1.0], [0, 0, 0]])
    expect(slots[1]![13]).toEqual(['box', P.rivalFrame, [6.25 - .65, 3.225, .5], [.14, 1.32, .26], [0, 0, -.651]])
  })

  it('emits no hardpoint or hardpoint signal parts for LANDED', () => {
    const profile = getRivalStageVisualProfile('LANDED')
    expect(profile.pylonCount).toBe(0)
    expect(collectCitadelParts(add => authorCitadelHardpoints(add, profile))).toEqual([])
    expect(collectCitadelParts(add => authorCitadelHardpointSignal(add, profile))).toEqual([])
  })
})
