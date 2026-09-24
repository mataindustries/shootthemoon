import { afterAll, describe, expect, it } from 'vitest'
import { Box3, BufferGeometry, Euler, Object3D, Vector3 } from 'three'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import type { AddPart, Finish } from '../render/octagonalKit.ts'
import { authorBastionZiggurat, BASTION_FOOTINGS, ZIGGURAT_HERO_AZIMUTH, ZIGGURAT_TERRACES, zigguratStairPoint } from './bastionZigguratModel.ts'
import { heliosGroundY } from './heliosReactorModel.ts'

type Triple = [number, number, number]
type Part = {
  shape: Parameters<AddPart>[0]
  finish: Finish
  position: Triple
  scale: Triple
  rotation: Triple
}
const EPS = 1e-5
const kit = createOctagonalKit()
function captureModel() {
  const parts: Part[] = []
  const batches = batchOctagonalModel(kit, add => authorBastionZiggurat((shape, finish, position, scale, rotation = [0, 0, 0]) => {
    parts.push({ shape, finish, position: [...position], scale: [...scale], rotation: [...rotation] })
    add(shape, finish, position, scale, rotation)
  }))
  return { parts, batches }
}
const { parts, batches } = captureModel()
const matrixFor = (part: Part) => {
  const object = new Object3D()
  object.position.fromArray(part.position)
  object.scale.fromArray(part.scale)
  object.rotation.set(...part.rotation)
  object.updateMatrix()
  return object.matrix
}
const partGeometry = new Map(parts.map(part => [part, kit.shapes[part.shape].clone().applyMatrix4(matrixFor(part))]))
const points = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i))
}
const vertices = batches.flatMap(({ geometry }) => points(geometry))
const bounds = new Box3().setFromPoints(vertices)
const partBounds = (part: Part) => new Box3().setFromPoints(points(partGeometry.get(part)!))
const triangles = (geometry: BufferGeometry) => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
const triangleCount = batches.reduce((sum, batch) => sum + triangles(batch.geometry), 0)
const maxRadius = Math.max(...vertices.map(p => Math.hypot(p.x, p.z)))
const turretMinimum = Math.min(...vertices.filter(p => p.y < 16).map(p => Math.hypot(p.x - 22, p.z - 13)))
const scaffoldMinimums = [16, -16].map(x => Math.min(...vertices.map(p => Math.hypot(p.x - x, p.z + 12))))
function surfaceArea(geometry: BufferGeometry) {
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
const areas: Record<Finish, number> = { dark: 0, gold: 0, amber: 0, cyan: 0 }
for (const batch of batches) areas[batch.finish] += surfaceArea(batch.geometry)
const totalArea = Object.values(areas).reduce((sum, area) => sum + area, 0)
const select = (shape: Part['shape'], finish: Finish, scale: Triple) => parts.filter(part =>
  part.shape === shape && part.finish === finish && part.scale.every((value, i) => Math.abs(value - scale[i]!) < EPS))
const unique = (shape: Part['shape'], finish: Finish, scale: Triple) => {
  const matches = select(shape, finish, scale)
  expect(matches).toHaveLength(1)
  return matches[0]!
}
// Independent inverse of the required +PI/4 model-frame rotation.
const templePoint = (p: Vector3) => new Vector3((p.x - p.z) / Math.SQRT2, p.y, (p.x + p.z) / Math.SQRT2)
const localPoint = (part: Part, point: Triple) => new Vector3(...point).applyMatrix4(matrixFor(part))
const round = (value: number) => Number(value.toFixed(6))

afterAll(() => {
  batches.forEach(batch => batch.geometry.dispose())
  partGeometry.forEach(geometry => geometry.dispose())
  disposeOctagonalKit(kit)
})

describe('Bastion Ziggurat pure geometry', () => {
  it('stays within the static batch, finish and triangle budgets', () => {
    expect(batches.length).toBeLessThanOrEqual(4)
    expect(batches.length).toBeGreaterThan(0)
    for (const { finish } of batches) expect(['dark', 'gold', 'amber', 'cyan']).toContain(finish)
    expect(triangleCount).toBeLessThanOrEqual(2000)
    expect(triangleCount).toBeGreaterThan(0)
    console.info('Bastion Ziggurat static geometry:', JSON.stringify({
      triangles: triangleCount,
      batches: batches.length,
      parts: parts.length,
      bounds: { min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round) },
      maxHeight: round(bounds.max.y),
      maxXZRadius: round(maxRadius),
      materialAreaPercent: Object.fromEntries(Object.entries(areas).map(([finish, area]) => [finish, round(100 * area / totalArea)])),
      turretClearance: round(turretMinimum),
      scaffoldClearances: scaffoldMinimums.map(round),
      footings: BASTION_FOOTINGS.map(({ x, z, bottomY }) => ({
        x: round(x), z: round(z), bottomY,
        groundY: round(heliosGroundY(x, z)),
        embedDepth: round(heliosGroundY(x, z) - bottomY),
      })),
    }, null, 2))
  })

  it('builds five contiguous, steeply stepped armored terraces and buried cornices', () => {
    expect(ZIGGURAT_TERRACES.length).toBeGreaterThanOrEqual(5)
    expect(ZIGGURAT_TERRACES).toEqual([
      { half: 15.5, bottom: -2.5, top: 5 },
      { half: 12.5, bottom: 5, top: 12 },
      { half: 9.75, bottom: 12, top: 18.5 },
      { half: 7.25, bottom: 18.5, top: 24.5 },
      { half: 5, bottom: 24.5, top: 30 },
    ])
    ZIGGURAT_TERRACES.forEach(({ half, bottom, top }, i) => {
      const terrace = unique('box', 'dark', [2 * half, top - bottom, 2 * half])
      const extent = new Box3().setFromPoints(points(partGeometry.get(terrace)!).map(templePoint))
      expect(extent.min.y).toBeCloseTo(bottom, 5)
      expect(extent.max.y).toBeCloseTo(top, 5)
      expect(extent.min.x).toBeCloseTo(-half, 5)
      expect(extent.max.x).toBeCloseTo(half, 5)
      expect(extent.min.z).toBeCloseTo(-half, 5)
      expect(extent.max.z).toBeCloseTo(half, 5)
      const cornice = unique('box', 'gold', [2 * half + .6, .45, 2 * half + .6])
      expect(partBounds(cornice).max.y).toBeCloseTo(top - .12, 5)
      expect(partBounds(cornice).min.y).toBeGreaterThan(bottom)
      const previous = ZIGGURAT_TERRACES[i - 1]
      if (previous) {
        expect(half).toBeLessThan(previous.half)
        expect(top).toBeGreaterThan(previous.top)
        expect(bottom).toBe(previous.top)
        const setbackPerRise = (previous.half - half) / (top - bottom)
        expect(setbackPerRise).toBeGreaterThanOrEqual(.3)
        expect(setbackPerRise).toBeLessThanOrEqual(.6)
      }
    })
  })

  it('anchors four outward-leaning horns below the 46 m height ceiling', () => {
    expect(bounds.max.y).toBeGreaterThanOrEqual(42)
    expect(bounds.max.y).toBeLessThanOrEqual(46)
    const horns = select('taper', 'dark', [1.1, 6, 1.1])
    expect(horns).toHaveLength(4)
    for (const horn of horns) {
      const base = templePoint(localPoint(horn, [0, -.5, 0]))
      const tip = templePoint(localPoint(horn, [0, .5, 0]))
      expect(base.y).toBeCloseTo(39.5, 8)
      expect(Math.abs(base.x)).toBeCloseTo(2.6, 8)
      expect(Math.abs(base.z)).toBeCloseTo(2.6, 8)
      expect(Math.hypot(tip.x, tip.z)).toBeGreaterThan(Math.hypot(base.x, base.z))
      expect(horn.rotation[2]).toBe(-.25)
      const phi = Math.atan2(base.x, base.z)
      expect(horn.rotation[1]).toBeCloseTo(phi - Math.PI / 2 + Math.PI / 4, 8)
    }
    expect(partBounds(unique('bevel', 'dark', [3.8, 8.5, 3.8])).min.y).toBeCloseTo(30, 5)
    const cap = partBounds(unique('bevel', 'gold', [4.4, 1.4, 4.4]))
    expect(cap.min.y).toBeCloseTo(38.5, 5)
    expect(cap.max.y).toBeCloseTo(39.9, 5)
  })

  it('clears the defense turret with every vertex below 16 m', () => {
    // Mirrors the TerritoryMonument turret mount contract at model-frame (22, 13).
    for (const p of vertices) if (p.y < 16) {
      expect(Math.hypot(p.x - 22, p.z - 13)).toBeGreaterThanOrEqual(8.5)
    }
  })

  it('clears both construction scaffold positions with every vertex', () => {
    for (const p of vertices) for (const x of [16, -16]) {
      expect(Math.hypot(p.x - x, p.z + 12)).toBeGreaterThanOrEqual(1.5)
    }
  })

  it('reports actual grounded foundations and stays inside the ground and radius envelope', () => {
    const foundations = [unique('box', 'dark', [31, 7.5, 31]), ...select('bevel', 'dark', [3.6, 14, 3.6])]
    expect(BASTION_FOOTINGS).toHaveLength(5)
    expect(foundations).toHaveLength(5)
    for (const footing of BASTION_FOOTINGS) {
      const ground = heliosGroundY(footing.x, footing.z)
      expect(footing.bottomY).toBeGreaterThanOrEqual(ground - 2.5)
      expect(footing.bottomY).toBeLessThanOrEqual(ground - .5)
      const matches = foundations.filter(part => Math.hypot(part.position[0] - footing.x, part.position[2] - footing.z) < EPS)
      expect(matches).toHaveLength(1)
      expect(partBounds(matches[0]!).min.y).toBeCloseTo(footing.bottomY, 5)
    }
    expect(bounds.min.y).toBeGreaterThanOrEqual(-3)
    expect(maxRadius).toBeLessThanOrEqual(27)
  })

  it('aligns the stair, lance and sanctum door on the hero axis, with sealed gates elsewhere', () => {
    expect(ZIGGURAT_HERO_AZIMUTH).toBe(Math.PI / 4)
    for (const part of parts) expect(part.rotation[0]).toBe(0)
    const stair = unique('box', 'dark', [27.1, 1.6, 5])
    const lance = unique('box', 'amber', [25, .12, .6])
    const door = unique('box', 'amber', [1.2, 4, .3])
    const hero = new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2)
    for (const part of [stair, lance, door]) {
      expect(part.position[0]).toBeGreaterThan(0)
      expect(part.position[2]).toBeGreaterThan(0)
      expect(part.position[0]).toBeCloseTo(part.position[2], 8)
      const direction = new Vector3(...(part === door ? [0, 0, 1] as const : [1, 0, 0] as const)).applyEuler(new Euler(...part.rotation))
      direction.y = 0
      expect(direction.normalize().dot(hero)).toBeCloseTo(1, 8)
    }
    expect(stair.rotation).toEqual([0, -Math.PI / 4, -1.176])
    expect(lance.rotation).toEqual(stair.rotation)
    expect(door.position[1]).toBe(33.6)
    const doorTemple = templePoint(new Vector3(...door.position))
    expect(doorTemple.z - .15).toBeLessThan(3.8 * Math.cos(Math.PI / 8))
    expect(doorTemple.z + .15).toBeGreaterThan(3.8 * Math.cos(Math.PI / 8))

    const foot = templePoint(localPoint(stair, [.5, .5, 0]))
    const head = templePoint(localPoint(stair, [-.5, .5, 0]))
    expect(foot.x).toBeCloseTo(0, 8)
    expect(foot.y).toBeCloseTo(5.3, 8)
    expect(foot.z).toBeCloseTo(15.4, 8)
    expect(new Vector3(...zigguratStairPoint(0)).distanceTo(foot)).toBeLessThan(EPS)
    expect(new Vector3(...zigguratStairPoint(27.1)).distanceTo(head)).toBeLessThan(EPS)
    for (const { half, top } of ZIGGURAT_TERRACES.slice(1)) {
      const surfaceY = foot.y + (half - foot.z) * (head.y - foot.y) / (head.z - foot.z)
      expect(surfaceY - top).toBeGreaterThan(.25)
      expect(surfaceY - top).toBeLessThan(.37)
      // At the same z, the underside lies inside each terrace mass.
      expect(surfaceY - 1.6 / Math.cos(1.176)).toBeLessThan(top)
    }
    const normal = new Vector3(0, 1, 0).applyEuler(new Euler(...stair.rotation))
    const stairSurface = localPoint(stair, [0, .5, 0])
    expect(localPoint(lance, [0, .5, 0]).sub(stairSurface).dot(normal)).toBeCloseTo(.06, 8)
    const stringers = select('box', 'gold', [27.1, .9, .5])
    expect(stringers).toHaveLength(2)
    expect(stringers.map(part => round(templePoint(new Vector3(...part.position)).x)).sort((a, b) => a - b)).toEqual([-2.75, 2.75])
    const treads = select('box', 'gold', [.35, .25, 5])
    expect(treads).toHaveLength(6)
    const treadDistances = treads.map(part => templePoint(new Vector3(...part.position)).sub(foot).dot(head.clone().sub(foot).normalize())).sort((a, b) => a - b)
    treadDistances.forEach((distance, i) => expect(distance).toBeCloseTo(27.1 * (i + 1) / 7, 8))
    const gates = select('box', 'dark', [6, 5, 1])
    expect(gates).toHaveLength(3)
    expect(select('box', 'amber', [.5, 3.5, .2])).toHaveLength(3)
    for (const gate of gates) {
      const p = templePoint(new Vector3(...gate.position))
      expect(p.z).toBeLessThan(EPS)
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(12.95, 8)
      expect(partBounds(gate).min.y).toBeCloseTo(5, 5)
      expect(partBounds(gate).max.y).toBeCloseTo(10, 5)
    }
  })

  it('keeps dark triangle surface area dominant and cyan exclusive to two tiny eyes', () => {
    // Measure all transformed triangle faces, including buried faces; no visibility estimate.
    expect(areas.dark / totalArea).toBeGreaterThanOrEqual(.6)
    expect((areas.amber + areas.cyan) / totalArea).toBeLessThanOrEqual(.05)
    const eyes = parts.filter(part => part.finish === 'cyan')
    expect(eyes).toHaveLength(2)
    const lateralPositions: number[] = []
    for (const eye of eyes) {
      expect(eye.shape).toBe('box')
      expect(eye.scale).toEqual([.5, .5, .3])
      const p = templePoint(new Vector3(...eye.position))
      expect(p.y).toBe(36.2)
      expect(p.z).toBeCloseTo(3.8 * Math.cos(Math.PI / 8) + .1, 8)
      lateralPositions.push(round(p.x))
    }
    expect(lateralPositions.sort((a, b) => a - b)).toEqual([-1.3, 1.3])
  })

  it('mirror-balances terrace and corner-bastion extents about the hero diagonal', () => {
    const terraces = ZIGGURAT_TERRACES.flatMap(({ half, bottom, top }) => [
      unique('box', 'dark', [2 * half, top - bottom, 2 * half]),
      unique('box', 'gold', [2 * half + .6, .45, 2 * half + .6]),
    ])
    const towers = select('bevel', 'dark', [3.6, 14, 3.6])
    const caps = select('bevel', 'gold', [3.1, 1.2, 3.1])
    const embrasures = select('box', 'amber', [1.6, .5, .3])
    expect(towers).toHaveLength(4)
    expect(caps).toHaveLength(4)
    expect(embrasures).toHaveLength(4)
    expect(towers.map(part => templePoint(new Vector3(...part.position)).toArray().map(round)).sort()).toEqual([
      [-15.5, 4.5, -15.5], [-15.5, 4.5, 15.5], [15.5, 4.5, -15.5], [15.5, 4.5, 15.5],
    ].sort())
    const symmetricParts = [...terraces, ...towers, ...caps, ...embrasures]
    for (const part of symmetricParts) {
      const reflected = new Vector3(part.position[2], part.position[1], part.position[0])
      const counterpart = symmetricParts.find(other => other.shape === part.shape && other.finish === part.finish
        && other.scale.every((value, i) => value === part.scale[i])
        && reflected.distanceTo(new Vector3(...other.position)) < EPS)
      expect(counterpart).toBeDefined()
      const originalBounds = partBounds(part), mirrorBounds = partBounds(counterpart!)
      expect(originalBounds.min.x).toBeCloseTo(mirrorBounds.min.z, 5)
      expect(originalBounds.max.x).toBeCloseTo(mirrorBounds.max.z, 5)
      expect(originalBounds.min.z).toBeCloseTo(mirrorBounds.min.x, 5)
      expect(originalBounds.max.z).toBeCloseTo(mirrorBounds.max.x, 5)
      expect(originalBounds.min.y).toBeCloseTo(mirrorBounds.min.y, 5)
      expect(originalBounds.max.y).toBeCloseTo(mirrorBounds.max.y, 5)
    }
  })

  it('authors identical parts, transforms, finishes, triangles and bounds on repeat calls', () => {
    const repeated = captureModel()
    try {
      // AddPart has no label parameter; compare the full ordered part descriptors.
      expect(repeated.parts).toHaveLength(parts.length)
      expect(repeated.parts).toEqual(parts)
      expect(repeated.batches).toHaveLength(batches.length)
      repeated.batches.forEach((batch, i) => {
        const original = batches[i]!
        expect(batch.finish).toBe(original.finish)
        expect(triangles(batch.geometry)).toBe(triangles(original.geometry))
        expect(Array.from(batch.geometry.getAttribute('position').array)).toEqual(Array.from(original.geometry.getAttribute('position').array))
        expect(new Box3().setFromPoints(points(batch.geometry))).toEqual(new Box3().setFromPoints(points(original.geometry)))
      })
    } finally {
      repeated.batches.forEach(batch => batch.geometry.dispose())
    }
  })
})
