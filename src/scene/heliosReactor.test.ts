import { afterAll, describe, expect, it } from 'vitest'
import { BufferGeometry, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { sampleMonumentCamera } from './monumentPresentation.ts'
import { createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import {
  COLLAR_S, HELIOS_FOOTINGS, HELIOS_HELD_POSE_MS, HELIOS_LAUNCH_MS, HELIOS_LOOP_LIMIT_MS,
  HELIOS_LOOP_MS, HELIOS_MUZZLE_SPEED, HELIOS_OPEN_LEAD_MS, HELIOS_PATH_SEGMENTS,
  HELIOS_PATH_SEGMENT_VERTICES, HELIOS_REVEAL_LAUNCH_MS, HELIOS_REVEAL_LEAD_MS,
  L, PARK, PITCH, RINGS, createHeliosReactorGeometry, heliosGroundY, heliosLoopNeedsFrames,
  heliosLoopRemainingMs, heliosLoopTime, heliosOpenOrigin, heliosRailPoint,
  heliosRevealOrigin, heliosRingAngle, sampleHelios,
} from './heliosReactorModel.ts'

const times = (start: number, end: number, step = 20) =>
  Array.from({ length: Math.ceil((end - start) / step) }, (_, i) => start + i * step)

function vertices(geometry: BufferGeometry, matrix = new Matrix4()) {
  const positions = geometry.getAttribute('position')
  return Array.from({ length: positions.count }, (_, i) =>
    new Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix))
}

function ringMatrix(index: number, angle: number, radius = RINGS[index]!.radius) {
  const { y, tilt } = RINGS[index]!
  return new Matrix4().makeTranslation(0, y, 0)
    .multiply(new Matrix4().makeRotationY(angle))
    .multiply(new Matrix4().makeRotationX(tilt))
    .scale(new Vector3(radius, radius, radius))
}

function railMatrix(s: number) {
  const [x, y] = heliosRailPoint(s)
  return new Matrix4().makeRotationY(Math.PI)
    .multiply(new Matrix4().makeTranslation(x, y, 0))
    .multiply(new Matrix4().makeRotationZ(PITCH))
}

const kit = createOctagonalKit()
const geometry = createHeliosReactorGeometry(kit)
const owned = [...geometry.static.map(batch => batch.geometry), geometry.ring, geometry.core,
  geometry.powerPath, geometry.railHeat, geometry.sled, geometry.payload, geometry.cone]
afterAll(() => {
  owned.forEach(part => part.dispose())
  disposeOctagonalKit(kit)
})

describe('Helios reactor timing', () => {
  it('repeats a 10–14 second loop exactly', () => {
    expect(HELIOS_LOOP_MS).toBeGreaterThanOrEqual(10_000)
    expect(HELIOS_LOOP_MS).toBeLessThanOrEqual(14_000)
    for (const t of [0, 5300, 7450, 11990]) {
      expect(sampleHelios(t + HELIOS_LOOP_MS)).toEqual(sampleHelios(t))
    }
  })

  it('holds the parked idle pose before waking and at the end of each loop', () => {
    expect(HELIOS_HELD_POSE_MS).toBe(0)
    for (const t of [0, 1000, 3950, 11950, HELIOS_HELD_POSE_MS]) {
      const pose = sampleHelios(t)
      expect(pose.reactor, `reactor at ${t}`).toBeLessThan(.02)
      expect(pose.surge, `surge at ${t}`).toBeLessThan(.02)
      expect(pose.railHeat, `rail heat at ${t}`).toBeLessThan(.02)
      expect(pose.lit).toBe(0)
      expect(pose.flash).toBeLessThan(.01)
      expect(pose.trail).toBe(0)
      expect(pose.sledS).toBe(PARK)
      expect(pose.payloadVisible).toBe(false)
    }
  })

  it('charges, routes power, loads, accelerates and then releases the payload in order', () => {
    const poses = times(0, HELIOS_LAUNCH_MS, 1).map(t => ({ t, pose: sampleHelios(t) }))
    const first = (predicate: (pose: ReturnType<typeof sampleHelios>) => boolean) => {
      const match = poses.find(({ pose }) => predicate(pose))
      expect(match).toBeDefined()
      return match!.t
    }
    const events = [first(p => p.reactor > .5), first(p => p.surge > .5),
      first(p => p.lit >= 7), first(p => p.sledS > PARK / 2),
      first(p => p.payloadS !== null && p.payloadS > COLLAR_S[0]!), HELIOS_LAUNCH_MS]
    events.slice(1).forEach((t, i) => expect(t).toBeGreaterThan(events[i]!))
    expect(sampleHelios(HELIOS_LAUNCH_MS).payloadS).toBe(L)
    expect(sampleHelios(HELIOS_LAUNCH_MS).flash).toBe(1)
    expect(sampleHelios(HELIOS_LAUNCH_MS).railHeat).toBe(1)
    let previousStep = 0
    for (const t of times(7000, 7900, 10)) {
      const step = sampleHelios(t + 10).payloadS! - sampleHelios(t).payloadS!
      expect(step).toBeGreaterThan(previousStep)
      previousStep = step
    }
    for (const t of times(7900, 9290, 10)) {
      const step = sampleHelios(t + 10).payloadS! - sampleHelios(t).payloadS!
      expect(step).toBeGreaterThan(0)
      expect(step).toBeCloseTo(HELIOS_MUZZLE_SPEED * 10, 10)
    }
    for (const t of times(9300, 10800)) {
      expect(sampleHelios(t).payloadS).toBeNull()
      expect(sampleHelios(t).payloadVisible).toBe(false)
    }
  })

  it('lights ordered power segments and extinguishes segments behind the payload', () => {
    let lit = 0
    for (const t of times(5000, 6501, 10)) {
      const pose = sampleHelios(t)
      expect(pose.lit).toBeGreaterThanOrEqual(lit)
      lit = pose.lit
    }
    expect(lit).toBe(HELIOS_PATH_SEGMENTS)
    for (const t of times(7000, 7900)) {
      const pose = sampleHelios(t)
      expect(pose.pathStart).toBe(4 + COLLAR_S.filter(s => s < pose.payloadS!).length)
      expect(pose.pathCount).toBe(Math.max(0, pose.lit - pose.pathStart))
    }
    for (const t of times(7900, HELIOS_LOOP_MS)) expect(sampleHelios(t).pathCount).toBe(0)
  })

  it('turns every ring continuously by its exact winding count and peaks during the surge', () => {
    RINGS.forEach(({ turns }, index) => {
      expect(heliosRingAngle(HELIOS_LOOP_MS, index) - heliosRingAngle(0, index))
        .toBeCloseTo(2 * Math.PI * turns, 9)
      const speeds = times(0, HELIOS_LOOP_MS, 10).map(t => ({ t,
        speed: (heliosRingAngle(t + 10, index) - heliosRingAngle(t, index)) / 10 }))
      speeds.forEach(({ speed }) => expect(speed * Math.sign(turns)).toBeGreaterThan(0))
      const peak = speeds.reduce((best, value) => Math.abs(value.speed) > Math.abs(best.speed) ? value : best)
      expect(peak.t).toBeGreaterThanOrEqual(6400)
      expect(peak.t).toBeLessThan(7900)
      expect(Math.abs(peak.speed / speeds[0]!.speed)).toBeGreaterThanOrEqual(6)
    })
  })

  it('respects material emissive and additive opacity limits throughout the loop', () => {
    for (const t of times(0, HELIOS_LOOP_MS)) {
      const pose = sampleHelios(t)
      for (const intensity of [pose.core, pose.powerPath, pose.railHeatI]) {
        expect(intensity).toBeLessThanOrEqual(.65)
        expect(intensity).toBeGreaterThanOrEqual(0)
      }
      expect(pose.core).toBeGreaterThanOrEqual(.18)
      expect(pose.payloadI).toBeLessThanOrEqual(.82)
      expect(pose.payloadI).toBeGreaterThanOrEqual(0)
      expect(pose.flashOpacity).toBeLessThanOrEqual(.42)
      expect(pose.trailOpacity).toBeLessThanOrEqual(.35)
    }
  })

  it('launches late in the reveal, wakes after camera motion starts and exits before it ends', () => {
    const reveal = 123_456
    const origin = heliosRevealOrigin(reveal)
    expect(origin).toBe(reveal - HELIOS_REVEAL_LEAD_MS)
    expect(heliosLoopTime(reveal + HELIOS_REVEAL_LAUNCH_MS, origin)).toBe(HELIOS_LAUNCH_MS)
    expect(HELIOS_REVEAL_LAUNCH_MS / 6000).toBeGreaterThanOrEqual(.6)
    expect(HELIOS_REVEAL_LAUNCH_MS / 6000).toBeLessThanOrEqual(.8)
    expect(4000 - HELIOS_REVEAL_LEAD_MS).toBeGreaterThanOrEqual(200)
    for (const delta of times(0, 201, 1)) {
      expect(sampleHelios(heliosLoopTime(reveal + delta, origin)).reactor).toBe(0)
    }
    expect(sampleHelios(heliosLoopTime(reveal + 301, origin)).reactor).toBeGreaterThan(0)
    expect(9300 - HELIOS_REVEAL_LEAD_MS).toBeLessThanOrEqual(6000)
    expect(sampleHelios(heliosLoopTime(reveal + 5599, origin)).payloadVisible).toBe(true)
    expect(sampleHelios(heliosLoopTime(reveal + 5600, origin)).payloadVisible).toBe(false)
    expect(heliosOpenOrigin(reveal)).toBe(reveal - HELIOS_OPEN_LEAD_MS)
  })

  it('stops on the held pose after three loops and only demands eligible held-view frames', () => {
    const origin = 500
    expect(HELIOS_LOOP_LIMIT_MS).toBe(36_000)
    expect(HELIOS_LOOP_LIMIT_MS % HELIOS_LOOP_MS).toBe(0)
    for (const x of [0, 1, 12000, 1_000_000]) {
      expect(heliosLoopTime(origin + HELIOS_LOOP_LIMIT_MS + x, origin)).toBe(0)
      expect(heliosLoopRemainingMs(origin + HELIOS_LOOP_LIMIT_MS + x, origin)).toBe(0)
    }
    expect(heliosLoopRemainingMs(origin + 1000, origin)).toBe(35_000)
    expect(heliosLoopTime(origin - 1, origin)).toBe(HELIOS_LOOP_MS - 1)
    expect(heliosLoopTime(123_456, null)).toBe(0)
    for (const looping of [false, true]) for (const revealing of [false, true]) {
      for (const withinLimit of [false, true]) {
        expect(heliosLoopNeedsFrames({ looping, revealing, withinLimit }))
          .toBe(looping && !revealing && withinLimit)
      }
    }
  })
})

describe('Helios reactor geometry', () => {
  it('fits its draw and geometry budgets with ordered, independently drawable power segments', () => {
    expect(geometry.static.length).toBeLessThanOrEqual(3)
    expect(geometry.static.length).toBeGreaterThan(0)
    geometry.static.forEach(batch => expect(['dark', 'gold', 'cyan']).toContain(batch.finish))
    const triangles = (part: BufferGeometry) => (part.index?.count ?? part.getAttribute('position').count) / 3
    const staticTriangles = geometry.static.reduce((sum, batch) => sum + triangles(batch.geometry), 0)
    expect(staticTriangles).toBeLessThanOrEqual(3800)
    const total = owned.reduce((sum, part) => sum + triangles(part), 0)
      + 2 * triangles(geometry.ring) + triangles(geometry.cone)
    expect(total).toBeLessThanOrEqual(6000)
    expect(owned.length).toBeLessThanOrEqual(10)
    console.info('Helios geometry', { staticTriangles, totalTriangles: total, geometries: owned.length })
    const path = vertices(geometry.powerPath)
    expect(path.length).toBe(HELIOS_PATH_SEGMENTS * HELIOS_PATH_SEGMENT_VERTICES)
    let previousX = 0
    for (let segment = 0; segment < HELIOS_PATH_SEGMENTS; segment++) {
      const start = segment * HELIOS_PATH_SEGMENT_VERTICES
      const centre = path.slice(start, start + HELIOS_PATH_SEGMENT_VERTICES)
        .reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(HELIOS_PATH_SEGMENT_VERTICES)
      expect(centre.x).toBeLessThan(previousX)
      expect(centre.z).toBeCloseTo(0, 5)
      previousX = centre.x
      if (segment < 4) {
        expect(centre.x).toBeCloseTo(-12.4 - 1.2 * (segment + .5), 5)
        expect(centre.y).toBeCloseTo(9.55, 5)
      } else {
        const [x, y] = heliosRailPoint(COLLAR_S[segment - 4]!, -8.1)
        expect(centre.x).toBeCloseTo(-x, 5)
        expect(centre.y).toBeCloseTo(y, 5)
      }
    }
  })

  it('seats every foundation beneath the curved lunar ground', () => {
    expect(HELIOS_FOOTINGS.length).toBeGreaterThan(0)
    for (const { x, z, bottomY } of HELIOS_FOOTINGS) {
      const ground = heliosGroundY(x, z)
      expect(bottomY).toBeGreaterThanOrEqual(ground - 2.5)
      expect(bottomY).toBeLessThanOrEqual(ground - .5)
    }
  })

  it('keeps spinning rings clear of the spire, support heads and one another', () => {
    const bands = RINGS.map((ring, index) => {
      let minY = Infinity, maxY = -Infinity, clearance = Infinity, headroom = Infinity
      let clearanceAt = '', headroomAt = '', minAt = '', maxAt = ''
      let originalClearance = Infinity
      for (let spin = 0; spin < 48; spin++) {
        if (index === 2) {
          for (const point of vertices(geometry.ring, ringMatrix(index, spin * Math.PI / 24, 11.2))) {
            if (point.y >= 4 && point.y <= 42) {
              originalClearance = Math.min(originalClearance,
                Math.hypot(point.x, point.z) - (11.4 - .08 * (point.y - 5) + .8))
            }
          }
        }
        for (const point of vertices(geometry.ring, ringMatrix(index, spin * Math.PI / 24))) {
          const radius = Math.hypot(point.x, point.z)
          const diagnostic = () => `ring ${index}, spin ${spin}, point ${point.toArray()}`
          if (point.y >= 4 && point.y <= 42) {
            const margin = radius - (11.4 - .08 * (point.y - 5) + .8)
            if (margin < clearance) { clearance = margin; clearanceAt = diagnostic() }
          }
          const margin = 1.1 * ring.radius + 1.2 - .8 - radius
          if (margin < headroom) { headroom = margin; headroomAt = diagnostic() }
          if (point.y < minY) { minY = point.y; minAt = diagnostic() }
          if (point.y > maxY) { maxY = point.y; maxAt = diagnostic() }
        }
      }
      expect(clearance, clearanceAt).toBeGreaterThanOrEqual(0)
      if (index === 2) expect(clearance - originalClearance, clearanceAt).toBeGreaterThanOrEqual(.10)
      expect(headroom, headroomAt).toBeGreaterThanOrEqual(0)
      expect(minY, minAt).toBeGreaterThanOrEqual(10.3)
      return { minY, maxY, minAt, maxAt }
    })
    expect(bands[0]!.maxY, bands[0]!.maxAt).toBeLessThan(bands[1]!.minY)
    expect(bands[1]!.maxY, bands[1]!.maxAt).toBeLessThan(bands[2]!.minY)
  })

  it('frames the reactor, rail and launch path throughout portrait and landscape reveals', () => {
    const site = createLandingSite(createLunarLocation(.248, -.684, 18))
    const transform = landingSiteToRenderTransform(site)
    const aspects = [390 / 844, 1440 / 900, 1920 / 1080, 844 / 390]
    const points = [...geometry.static.flatMap(batch => vertices(batch.geometry)),
      ...vertices(geometry.core), ...vertices(geometry.powerPath), ...vertices(geometry.railHeat),
      ...vertices(geometry.sled, railMatrix(PARK)), ...vertices(geometry.payload, railMatrix(PARK))]
    RINGS.forEach((_, index) => {
      for (let spin = 0; spin < 48; spin++) {
        points.push(...vertices(geometry.ring, ringMatrix(index, spin * Math.PI / 24)))
      }
    })
    const closePoints = points.filter(point => Math.hypot(point.x, point.z) <= 34)
    const toWorld = (point: Vector3) => {
      point.multiplyScalar(.001)
      point.y += .0007
      return point.applyQuaternion(transform.orientation).add(transform.position)
    }
    points.forEach(toWorld)
    const cameraFor = (aspect: number, progress: number) => {
      const camera = new PerspectiveCamera(42, aspect, .001, 80)
      const pose = sampleMonumentCamera(site, progress, aspect)
      camera.position.copy(pose.position)
      camera.up.copy(pose.up)
      camera.lookAt(pose.target)
      camera.updateMatrixWorld()
      return camera
    }
    const projected = new Vector3()
    for (const aspect of aspects) for (const progress of [0, .45, .7, 1]) {
      const camera = cameraFor(aspect, progress)
      let maxX = 0, minY = Infinity, maxY = -Infinity
      for (const point of progress === 0 ? closePoints : points) {
        projected.copy(point).project(camera)
        maxX = Math.max(maxX, Math.abs(projected.x))
        minY = Math.min(minY, projected.y)
        maxY = Math.max(maxY, projected.y)
      }
      const diagnostic = `aspect ${aspect}, progress ${progress}`
      expect(maxX, diagnostic).toBeLessThan(.93)
      expect(minY, diagnostic).toBeGreaterThan(0)
      expect(maxY, diagnostic).toBeLessThan(.92)
    }
    for (const aspect of aspects.slice(0, 3)) {
      const camera = cameraFor(aspect, .7)
      let maxX = 0, maxY = 0
      for (const d of times(0, 101, 1)) {
        projected.set(0, 0, 0).applyMatrix4(railMatrix(L + d))
        toWorld(projected).project(camera)
        maxX = Math.max(maxX, Math.abs(projected.x))
        maxY = Math.max(maxY, Math.abs(projected.y))
      }
      expect(maxX, `launch at aspect ${aspect}`).toBeLessThan(1)
      expect(maxY, `launch at aspect ${aspect}`).toBeLessThan(1)
    }
  })

  it('keeps the launch path safely above the curved ground through payload exit', () => {
    for (const s of [...times(PARK, L + 286, .5), L + 286]) {
      const { x, y, z } = new Vector3().applyMatrix4(railMatrix(s))
      expect(y - 2.2).toBeGreaterThan(heliosGroundY(x, z) + 1)
    }
  })
})
