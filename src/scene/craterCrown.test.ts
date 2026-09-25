import { afterAll, describe, expect, it } from 'vitest'
import { Box3, Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { MONUMENT_REVEAL_MS } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import type { AddPart, Finish, ModelBatch } from '../render/octagonalKit.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import {
  CROWN_BORE_STROKE, CROWN_CLAIM_Y, CROWN_DAMAGE_TILT, CROWN_FOOTINGS, CROWN_GLOW,
  CROWN_HELD_MS, CROWN_HERO_AZIMUTH, CROWN_HUB, CROWN_KNEE, CROWN_SECTORS,
  CROWN_STOWED_MS, CROWN_THROAT, CROWN_TURRET_SEAT_Y, authorCraterCrownBore,
  authorCraterCrownStatic, craterCrownDefenseMount, craterCrownLift, craterCrownPoseTime,
  crownArmY, crownAz, crownGroundY, crownMember, sampleCraterCrown,
} from './craterCrownModel.ts'
import type { CraterCrownPose } from './craterCrownModel.ts'
import { createHeliosReactorGeometry, heliosGroundY } from './heliosReactorModel.ts'
import { sampleMonumentCamera } from './monumentPresentation.ts'
import { authorMonument } from './octagonalModels.ts'

type Triple = [number, number, number]
type Part = {
  shape: Parameters<AddPart>[0]
  finish: Finish
  position: Triple
  scale: Triple
  rotation: Triple
}

const kit = createOctagonalKit()
const owned: BufferGeometry[] = []
const own = (geometry: BufferGeometry) => {
  owned.push(geometry)
  return geometry
}
const capture = (author: (add: AddPart) => void) => {
  const parts: Part[] = []
  author((shape, finish, position, scale, rotation = [0, 0, 0]) => {
    parts.push({ shape, finish, position, scale, rotation })
  })
  return parts
}
const batches = (author: (add: AddPart) => void) => {
  const result = batchOctagonalModel(kit, author)
  result.forEach(({ geometry }) => own(geometry))
  return result
}
const triangles = (geometry: BufferGeometry) => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
const triangleCount = (model: ModelBatch[]) => model.reduce((sum, { geometry }) => sum + triangles(geometry), 0)
const points = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i))
}
const partPoints = (part: Part) => {
  const object = new Object3D()
  object.position.fromArray(part.position)
  object.scale.fromArray(part.scale)
  object.rotation.set(...part.rotation, 'XYZ')
  object.updateMatrix()
  return points(own(kit.shapes[part.shape].clone().applyMatrix4(object.matrix)))
}
const radius = (vertices: Vector3[]) => Math.max(...vertices.map(({ x, z }) => Math.hypot(x, z)))
const extent = (vertices: Vector3[]) => new Box3().setFromPoints(vertices)
const round = (value: number) => Number(value.toFixed(6))
const boundsJSON = (bounds: Box3) => ({ min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round) })
const angleDifference = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const expectTriple = (actual: number[], expected: Triple) => {
  expect(actual).toHaveLength(3)
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 4))
}
const surfaceArea = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute('position'), index = geometry.index
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  let area = 0
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i)
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1)
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2)
    area += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return area
}

const staticParts = capture(authorCraterCrownStatic)
const boreParts = capture(authorCraterCrownBore)
const staticBatches = batches(authorCraterCrownStatic)
const boreBatches = batches(authorCraterCrownBore)
const staticVertices = staticBatches.flatMap(({ geometry }) => points(geometry))
const boreVertices = boreBatches.flatMap(({ geometry }) => points(geometry))
const staticBounds = extent(staticVertices)
const boreBounds = extent(boreVertices)
const stowedBounds = extent(boreVertices.map(point => point.clone().add(new Vector3(0, CROWN_BORE_STROKE, 0))))
const clamps = staticParts.filter(part => part.shape === 'box' && part.finish === 'dark' && part.scale[1] === 8.3)
const walls = staticParts.filter(part => part.shape === 'box' && part.finish === 'dark' && part.scale[0] === 7 && part.scale[1] === 8)
const chutes = staticParts.filter(part => part.rotation[1] === Math.PI / 8 - Math.PI / 2)
const glow = staticParts.find(part => part.shape === 'bevel' && part.finish === 'amber')!
const head = boreParts.find(part => part.shape === 'taper')!
const cap = staticParts.find(part => part.shape === 'bevel' && part.finish === 'dark' && part.position[1] === 37.4)!
const fingers = staticParts.filter(part => !chutes.includes(part) && Math.hypot(part.position[0], part.position[2]) > 12 && part.position[1] > 5)
const site = createLandingSite(createLunarLocation(.248, -.684, 18))
const transform = landingSiteToRenderTransform(site)
const aspects = [390 / 844, 844 / 390, 1440 / 900, 1920 / 1080]
const report: Record<string, unknown> = {}

afterAll(() => {
  owned.forEach(geometry => geometry.dispose())
  disposeOctagonalKit(kit)
  console.info(JSON.stringify(report))
})

describe('Crater Crown pure geometry and reveal', () => {
  it('authors the specified parts, order, finishes, constants and rotations', () => {
    expect(staticParts).toHaveLength(79)
    expect(staticParts.filter(part => part.shape === 'box')).toHaveLength(66)
    expect(staticParts.filter(part => part.shape === 'bevel')).toHaveLength(13)
    expect(new Set(staticParts.map(part => part.finish))).toEqual(new Set(['dark', 'gold', 'amber']))
    expect(boreParts).toHaveLength(5)
    expect(boreParts.filter(part => part.shape === 'bevel')).toHaveLength(4)
    expect(boreParts.filter(part => part.shape === 'taper')).toHaveLength(1)
    expect(new Set(boreParts.map(part => part.finish))).toEqual(new Set(['dark']))
    for (const part of staticParts) expect(part.rotation[0]).toBe(0)
    expect(boreParts.map(part => part.rotation)).toEqual([
      [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [Math.PI, 0, 0],
    ])
    const sectorOrder = [
      ['box', 'dark'], ['box', 'gold'], ['box', 'amber'], ['box', 'dark'],
      ['bevel', 'gold'], ['box', 'dark'], ['box', 'gold'], ['box', 'dark'], ['box', 'gold'],
    ]
    for (let k = 0; k < 8; k++) {
      expect(staticParts.slice(9 * k, 9 * (k + 1)).map(({ shape, finish }) => [shape, finish])).toEqual(sectorOrder)
    }
    expect(staticParts.slice(72).map(({ shape, finish }) => [shape, finish])).toEqual([
      ['bevel', 'dark'], ['bevel', 'gold'], ['bevel', 'gold'], ['bevel', 'dark'],
      ['bevel', 'amber'], ['box', 'dark'], ['box', 'amber'],
    ])
    expect(CROWN_SECTORS).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(k => k * Math.PI / 4))
    expect(CROWN_KNEE).toEqual({ r: 35, y: 21 })
    expect(CROWN_HUB).toEqual({ r: 5.5, y: 31 })
    expect(CROWN_THROAT).toEqual({ apothem: 7.4, top: 6.8 })
    expect(CROWN_TURRET_SEAT_Y).toBe(38.1)
    expect(CROWN_CLAIM_Y).toBe(56)
    expect(CROWN_BORE_STROKE).toBe(10)
    expect(CROWN_STOWED_MS).toBe(0)
    expect(CROWN_HELD_MS).toBe(3400)
    expect(CROWN_GLOW).toEqual({ stowed: .10, flare: .82, held: .48 })
    expect(CROWN_DAMAGE_TILT).toBe(-.035)
    expect(crownArmY(35)).toBe(21)
    expect(crownArmY(5.5)).toBe(31)
    expect(crownAz(Math.PI / 8, 44, 21)).toEqual([Math.sin(Math.PI / 8) * 44, 21, Math.cos(Math.PI / 8) * 44])
    const forward = capture(add => crownMember(add, 'gold', .3, 2, 4, 5, 8, .45, 1.3, 2, 1.5))
    const reverse = capture(add => crownMember(add, 'gold', .3, 5, 8, 2, 4, .45, 1.3, 2, 1.5))
    expect(reverse).toEqual(forward)
    expectTriple(forward[0]!.position, [Math.sin(.3) * 1.9, 7.2, Math.cos(.3) * 1.9])
    expect(forward[0]!.scale).toEqual([6.5, .45, 1.3])
    expect(forward[0]!.rotation).toEqual([0, .3 - Math.PI / 2, Math.atan2(4, 3)])
  })

  it('meets exact batch and triangle budgets and stays below half of Helios', () => {
    const staticCounts = staticBatches.map(({ finish, geometry }) => [finish, triangles(geometry)])
    const boreCounts = boreBatches.map(({ finish, geometry }) => [finish, triangles(geometry)])
    expect(staticCounts).toEqual([['dark', 524], ['gold', 928], ['amber', 172]])
    expect(boreCounts).toEqual([['dark', 288]])
    const total = triangleCount(staticBatches) + triangleCount(boreBatches)
    expect(total).toBe(1912)
    expect(total).toBeLessThanOrEqual(2500)
    expect(staticBatches.length + boreBatches.length).toBeLessThanOrEqual(4)
    const helios = createHeliosReactorGeometry(kit)
    helios.static.forEach(({ geometry }) => own(geometry))
    for (const geometry of [helios.ring, helios.core, helios.powerPath, helios.railHeat, helios.sled, helios.payload, helios.cone]) own(geometry)
    const spire = batches(add => authorMonument('HELIOS_SPIRE', add))
    const heliosTotal = triangleCount(helios.static) + triangleCount(spire)
    expect(total).toBeLessThan(.5 * heliosTotal)
    report.performance = { staticCounts, boreCounts, staticTriangles: triangleCount(staticBatches),
      total, batches: staticBatches.length + boreBatches.length, heliosTotal, heliosThreshold: .5 * heliosTotal }
  })

  it('keeps the static, deployed and stowed envelopes at their authored dimensions', () => {
    expectTriple(staticBounds.min.toArray(), [-50.3, -4.3, -50.3])
    expectTriple(staticBounds.max.toArray(), [50.3, 38.1, 50.3])
    const staticRadius = radius(staticVertices)
    expect(staticRadius).toBeGreaterThan(50.6)
    expect(staticRadius).toBeLessThan(50.65)
    expect(boreBounds.min.y).toBeCloseTo(.5, 4)
    expect(boreBounds.max.y).toBeCloseTo(28, 4)
    expect(stowedBounds.min.y).toBeCloseTo(10.5, 4)
    expect(stowedBounds.max.y).toBeCloseTo(38, 4)
    expect(radius(boreVertices)).toBeCloseTo(6, 4)
    report.envelopes = { static: boundsJSON(staticBounds), staticRadius: round(staticRadius),
      deployed: boundsJSON(boreBounds), stowed: boundsJSON(stowedBounds), boreRadius: round(radius(boreVertices)) }
  })

  it('buries footings, walls and chute while exposing only the throat glow crown', () => {
    for (const [x, z] of [[0, 0], [44, 0], [0, -44], [31, 31], [-50.3, 5.7]] as const) {
      expect(crownGroundY(x, z)).toBeCloseTo(heliosGroundY(x, z), 12)
    }
    expect(clamps).toHaveLength(8)
    expect(CROWN_FOOTINGS).toEqual(CROWN_SECTORS.map(phi => ({ x: Math.sin(phi) * 44, z: Math.cos(phi) * 44, bottomY: -4.3 })))
    let clampBurial = Infinity
    for (const [i, clamp] of clamps.entries()) {
      const footing = CROWN_FOOTINGS[i]!
      expect([footing.x, footing.z]).toEqual([clamp.position[0], clamp.position[2]])
      expect(footing.bottomY).toBe(-4.3)
      const vertices = partPoints(clamp)
      expect(extent(vertices).min.y).toBeCloseTo(footing.bottomY, 4)
      const lower = vertices.filter(point => point.y < clamp.position[1])
      expect(lower.length).toBeGreaterThan(0)
      for (const tilt of [0, CROWN_DAMAGE_TILT, -CROWN_DAMAGE_TILT]) {
        const matrix = new Matrix4().makeRotationZ(tilt)
        for (const vertex of lower) {
          const point = vertex.clone().applyMatrix4(matrix)
          const burial = crownGroundY(point.x, point.z) - point.y
          expect(burial).toBeGreaterThanOrEqual(.5)
          clampBurial = Math.min(clampBurial, burial)
        }
      }
    }
    let wallBurial = Infinity
    for (const wall of walls) {
      const lower = partPoints(wall).filter(point => point.y < wall.position[1])
      expect(lower.length).toBeGreaterThan(0)
      for (const point of lower) {
        const burial = crownGroundY(point.x, point.z) - point.y
        expect(burial).toBeGreaterThanOrEqual(.4)
        wallBurial = Math.min(wallBurial, burial)
      }
    }
    expect(chutes).toHaveLength(2)
    const chuteLowest = chutes.flatMap(partPoints).reduce((a, b) => a.y < b.y ? a : b)
    const chuteBurial = crownGroundY(chuteLowest.x, chuteLowest.z) - chuteLowest.y
    expect(chuteBurial).toBeGreaterThanOrEqual(.5)
    const glowVertices = partPoints(glow)
    const ground = crownGroundY(0, 0)
    expect(extent(glowVertices).min.y).toBeLessThanOrEqual(ground - .1)
    const above = glowVertices.filter(point => point.y > 0)
    expect(above.length).toBeGreaterThan(0)
    for (const point of above) expect(point.y).toBeGreaterThan(ground + .8)
    report.grounding = { clampMinimumBurial: round(clampBurial), wallMinimumBurial: round(wallBurial),
      chuteBurial: round(chuteBurial), glowMinY: round(extent(glowVertices).min.y),
      glowPositiveMinY: round(Math.min(...above.map(point => point.y))), ground }
  })

  it('closes the throat around the bore and clears the head, glow and hub', () => {
    expect(walls).toHaveLength(8)
    for (const [i, wall] of walls.entries()) {
      expect(wall.rotation).toEqual([0, CROWN_SECTORS[i], 0])
      expectTriple(wall.position, crownAz(CROWN_SECTORS[i]!, 8.4, 2.8))
      expect(Math.hypot(wall.position[0], wall.position[2]) - wall.scale[2] / 2).toBeCloseTo(CROWN_THROAT.apothem, 12)
      expect(extent(partPoints(wall)).max.y).toBeCloseTo(CROWN_THROAT.top, 4)
    }
    expect(2 * 7.4 * Math.tan(Math.PI / 8)).toBeLessThan(7)
    const boreRadius = radius(boreVertices)
    const clearance = CROWN_THROAT.apothem - boreRadius
    expect(clearance).toBeGreaterThanOrEqual(1.4)
    const headBounds = extent(partPoints(head))
    expect(headBounds.max.y).toBeLessThanOrEqual(6.5)
    expect(headBounds.min.y + CROWN_BORE_STROKE).toBeGreaterThanOrEqual(9.8)
    const glowTop = extent(partPoints(glow)).max.y
    // This authored 0.4 m contact clearance crosses a Float32 buffer boundary.
    expect(boreBounds.min.y - glowTop).toBeCloseTo(.4, 4)
    expect(boreBounds.max.y).toBeGreaterThanOrEqual(28)
    expect(stowedBounds.max.y).toBeLessThanOrEqual(38.1)
    expect(glow.scale[0] * Math.cos(Math.PI / 8)).toBeGreaterThan(7.4 + 2)
    report.throat = { walls: walls.length, apothem: CROWN_THROAT.apothem, top: CROWN_THROAT.top,
      radialClearance: round(clearance), deployedHeadMaxY: round(headBounds.max.y),
      stowedHeadMinY: round(headBounds.min.y + CROWN_BORE_STROKE),
      stowedHeadAboveThroat: round(headBounds.min.y + CROWN_BORE_STROKE - CROWN_THROAT.top),
      drillGlowClearance: round(boreBounds.min.y - glowTop) }
  })

  it('supports the turret, defense aim, ground lift and claim marker', () => {
    expect(staticBounds.max.y).toBeCloseTo(38.1, 4)
    expect(staticBounds.max.y).toBeCloseTo(CROWN_TURRET_SEAT_Y, 4)
    expect(extent(partPoints(cap)).max.y).toBeCloseTo(38.1, 4)
    const capApothem = cap.scale[0] * Math.cos(Math.PI / 8)
    expect(capApothem).toBeGreaterThanOrEqual(7)
    const aims: number[] = []
    for (const unit of [.001, .0005]) for (const squash of [.08, .5, 1]) {
      for (const lift of [0, craterCrownLift(.0008, .0005)]) {
        const mount = craterCrownDefenseMount(unit, squash, lift)
        expect(mount).toEqual([0, .0007 + unit * squash * (CROWN_TURRET_SEAT_Y + lift) + .002, 0])
        const aim = mount[1] + .009
        expect(aim).toBeGreaterThanOrEqual(.004)
        expect(aim).toBeLessThanOrEqual(.07)
        aims.push(aim)
      }
    }
    expect(craterCrownLift(0, .001)).toBeCloseTo(0, 12)
    for (const ground of [-.0003, 0, .00042, .0009]) {
      expect(.0007 + .0005 * (-.7 + craterCrownLift(ground, .0005))).toBeCloseTo(ground, 12)
    }
    const claimClearance = CROWN_CLAIM_Y - 6 - 38.1
    expect(claimClearance).toBeGreaterThanOrEqual(10)
    report.turret = { seatY: CROWN_TURRET_SEAT_Y, capApothem: round(capApothem),
      capFootprintClearance: round(capApothem - 7), aimRange: [Math.min(...aims), Math.max(...aims)], claimClearance }
  })

  it('measures every transformed face within the finish area targets', () => {
    const areas: Record<Finish, number> = { dark: 0, gold: 0, amber: 0, cyan: 0 }
    for (const { finish, geometry } of [...staticBatches, ...boreBatches]) areas[finish] += surfaceArea(geometry)
    const total = Object.values(areas).reduce((sum, area) => sum + area, 0)
    expect(areas.dark / total).toBeGreaterThanOrEqual(.65)
    expect(areas.gold / total).toBeGreaterThanOrEqual(.18)
    expect(areas.gold / total).toBeLessThanOrEqual(.28)
    expect(areas.amber / total).toBeGreaterThanOrEqual(.03)
    expect(areas.amber / total).toBeLessThanOrEqual(.06)
    expect(areas.cyan).toBe(0)
    report.areaPercent = Object.fromEntries(Object.entries(areas).map(([finish, area]) => [finish, round(100 * area / total)]))
  })

  it('aligns the chute and camera with the gap between all 32 fingers', () => {
    expect(CROWN_HERO_AZIMUTH).toBe(Math.PI / 8)
    expect(chutes).toHaveLength(2)
    for (const { position: [x, , z] } of chutes) expect(Math.atan2(x, z)).toBe(Math.PI / 8)
    expect(fingers).toHaveLength(32)
    const separations = fingers.map(({ position: [x, , z] }) => angleDifference(Math.atan2(x, z), CROWN_HERO_AZIMUTH))
    for (const separation of separations) expect(separation).toBeGreaterThanOrEqual(20 * Math.PI / 180)
    const inverseOrientation = transform.orientation.clone().invert()
    const cameraMargins = aspects.map(aspect => {
      let maximumDeviation = 0
      for (const progress of [0, .25, .5, .75, 1]) {
        const eye = sampleMonumentCamera(site, progress, aspect).position.sub(transform.position).applyQuaternion(inverseOrientation)
        const deviation = angleDifference(Math.atan2(eye.x, eye.z), CROWN_HERO_AZIMUTH)
        expect(deviation).toBeLessThanOrEqual(5 * Math.PI / 180)
        maximumDeviation = Math.max(maximumDeviation, deviation)
      }
      return { aspect, maximumDeviationDegrees: round(maximumDeviation * 180 / Math.PI),
        marginDegrees: round(5 - maximumDeviation * 180 / Math.PI) }
    })
    report.hero = { azimuthDegrees: 22.5, chuteAzimuths: chutes.map(part => Math.atan2(part.position[0], part.position[2])),
      minimumFingerSeparationDegrees: round(Math.min(...separations) * 180 / Math.PI), cameraMargins }
  })

  it('frames above-ground static and moving bore vertices throughout the reveal', () => {
    expect(CROWN_HELD_MS).toBeLessThanOrEqual(MONUMENT_REVEAL_MS)
    const framing = aspects.map(aspect => {
      const camera = new PerspectiveCamera(42, aspect, .001, 80)
      const point = new Vector3()
      const result = { aspect, horizontal: Infinity, lower: Infinity, upper: Infinity, evaluatedVertices: 0 }
      for (let i = 0; i <= 30; i++) {
        const progress = i / 30
        const pose = sampleMonumentCamera(site, progress, aspect)
        camera.position.copy(pose.position)
        camera.up.copy(pose.up)
        camera.lookAt(pose.target)
        camera.updateMatrixWorld()
        const boreOffset = sampleCraterCrown(progress * MONUMENT_REVEAL_MS).bore
        for (const [vertices, offset] of [[staticVertices, 0], [boreVertices, boreOffset]] as const) {
          for (const vertex of vertices) {
            point.copy(vertex)
            point.y += offset
            if (point.y < crownGroundY(point.x, point.z)) continue
            point.multiplyScalar(.001)
            point.y += .0007
            point.applyQuaternion(transform.orientation).add(transform.position).project(camera)
            result.horizontal = Math.min(result.horizontal, .93 - Math.abs(point.x))
            result.lower = Math.min(result.lower, point.y)
            result.upper = Math.min(result.upper, .92 - point.y)
            result.evaluatedVertices++
          }
        }
      }
      expect(result.evaluatedVertices).toBeGreaterThan(0)
      expect(result.horizontal).toBeGreaterThan(0)
      expect(result.lower).toBeGreaterThan(0)
      expect(result.upper).toBeGreaterThan(0)
      return { ...result, horizontal: round(result.horizontal), lower: round(result.lower), upper: round(result.upper) }
    })
    report.framing = framing
  }, 60_000)

  it('matches the exact sampler table and preserves authored endpoints', () => {
    const ease = (x: number) => x * x * (3 - 2 * x)
    const table = [
      [-100, 10, .10], [0, 10, .10], [700, 10, .10], [1350, 5, .10],
      [1899, 10 * (1 - ease(1199 / 1300)), .10], [2000, 0, .10 + .72 * ease(1 / 3)],
      [2200, 0, .82], [2800, 0, .82 - .34 * ease(.5)], [3400, 0, .48], [9000, 0, .48],
    ] as const
    for (const [time, bore, glowValue] of table) {
      const pose = sampleCraterCrown(time)
      expect(pose.bore).toBeCloseTo(bore, 12)
      expect(pose.glow).toBeCloseTo(glowValue, 12)
      if ([0, 5, 10].includes(bore)) expect(pose.bore).toBe(bore)
      if ([.10, .82, .48].includes(glowValue)) expect(pose.glow).toBe(glowValue)
    }
    expect(sampleCraterCrown(-100)).toEqual({ bore: 10, glow: .10 })
    expect(sampleCraterCrown(CROWN_STOWED_MS)).toEqual({ bore: 10, glow: .10 })
    expect(sampleCraterCrown(CROWN_HELD_MS)).toEqual({ bore: 0, glow: .48 })
    expect(sampleCraterCrown(9000)).toEqual({ bore: 0, glow: .48 })
    expect(CROWN_GLOW.held).toBe(EMISSIVE_LIMITS.panel)
    report.samplerTable = table.map(([time]) => ({ time, ...sampleCraterCrown(time) }))
  })

  it('reuses one output and reproduces bounded samples independently of evaluation order', () => {
    const out: CraterCrownPose = { bore: -1, glow: -1 }
    const forward: { time: number, bore: number, glow: number }[] = []
    let previousBore = Infinity
    for (let time = -50; time <= 3450; time += 10) {
      expect(sampleCraterCrown(time, out)).toBe(out)
      expect(out.bore).toBeGreaterThanOrEqual(0)
      expect(out.bore).toBeLessThanOrEqual(10)
      expect(out.bore).toBeLessThanOrEqual(previousBore)
      expect(out.glow).toBeGreaterThanOrEqual(.10)
      expect(out.glow).toBeLessThanOrEqual(.82)
      if (time < 1900) expect(out.glow).toBe(.10)
      previousBore = out.bore
      forward.push({ time, ...out })
    }
    for (const { time, bore, glow: glowValue } of forward.toReversed()) {
      expect(sampleCraterCrown(time, out)).toBe(out)
      expect(out).toEqual({ bore, glow: glowValue })
      expect(sampleCraterCrown(time, out)).toBe(out)
      expect(out).toEqual({ bore, glow: glowValue })
    }
    const a = sampleCraterCrown(1234), b = sampleCraterCrown(1234)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    report.samplerSweep = { samples: forward.length, boreRange: [Math.min(...forward.map(pose => pose.bore)), Math.max(...forward.map(pose => pose.bore))],
      glowRange: [Math.min(...forward.map(pose => pose.glow)), Math.max(...forward.map(pose => pose.glow))], deterministic: true, reusedOut: true }
  })

  it('resolves live, reveal, future, held and reduced-motion pose times', () => {
    for (const live of [false, true]) for (const reducedMotion of [false, true]) {
      for (const revealAtMs of [null, 1000]) for (const nowMs of [-100, 0, 999, 1000, 2750, 90000]) {
        const actual = craterCrownPoseTime({ live, revealAtMs, nowMs, reducedMotion })
        if (!live) expect(actual).toBe(0)
        else if (revealAtMs === null || reducedMotion) expect(actual).toBe(3400)
        else if (nowMs <= 1000) expect(actual).toBe(0)
        else if (nowMs === 2750) expect(actual).toBe(1750)
        else expect(actual).toBe(3400)
      }
    }
    report.poseTime = { combinations: 48, passed: true }
  })

  it('leaves the three other monument authors at their existing triangle counts', () => {
    const isolation = [['HELIOS_SPIRE', 1120], ['BASTION_OBELISK', 1164], ['SIGNAL_ARRAY', 1056]] as const
    for (const [kind, expected] of isolation) {
      expect(triangleCount(batches(add => authorMonument(kind, add)))).toBe(expected)
    }
    report.isolation = Object.fromEntries(isolation)
  })
})
