import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createLandingSite,
  createLunarLocation,
  type LandingSite,
} from '../domain/lunarCoordinates.ts'
import { deriveRivalSite } from '../domain/rival.ts'
import {
  createSafeOrbitalCameraPath,
  sampleMinimumCameraRadius,
  slerpUnitDirections,
  type CameraPose,
  type SafeOrbitalCameraPath,
} from './orbitalCameraPath.ts'
import {
  RIVAL_CAMERA_SAFETY,
  createRivalFocusCameraPath,
  createRivalRevealCameraPlan,
  getDualSiteViewDirection,
  type RivalRevealCameraPlan,
} from './rivalCameraPlan.ts'

const PORTRAIT_ASPECT = 390 / 844
const LANDSCAPE_ASPECT = 844 / 390
const SAFETY_EPSILON = 1e-9

function degrees(value: number): number {
  return (value * Math.PI) / 180
}

function site(latitudeDeg: number, longitudeDeg: number): LandingSite {
  return createLandingSite(
    createLunarLocation(degrees(latitudeDeg), degrees(longitudeDeg)),
  )
}

function revealPaths(
  plan: RivalRevealCameraPlan,
): readonly SafeOrbitalCameraPath[] {
  return [
    plan.orbitalTransition,
    plan.capsuleApproach,
    plan.impact,
    plan.dualSites,
  ]
}

function expectPathSafe(
  path: SafeOrbitalCameraPath,
  sampleCount: number = RIVAL_CAMERA_SAFETY.sampleCount,
): void {
  const position = new Vector3()
  const target = new Vector3()
  const up = new Vector3()

  for (let index = 0; index <= sampleCount; index += 1) {
    const sample = path.sample(index / sampleCount, position, target, up)

    expect(Number.isFinite(sample.position.x)).toBe(true)
    expect(Number.isFinite(sample.position.y)).toBe(true)
    expect(Number.isFinite(sample.position.z)).toBe(true)
    expect(sample.position.length()).toBeGreaterThanOrEqual(
      path.minimumRadius - SAFETY_EPSILON,
    )
    expect(sample.up.length()).toBeCloseTo(1, 10)
  }

  expect(sampleMinimumCameraRadius(path, sampleCount)).toBeGreaterThanOrEqual(
    path.minimumRadius - SAFETY_EPSILON,
  )
  expect(path.getPoint(0)).toEqual(path.start.position)
  expect(path.getPoint(1)).toEqual(path.end.position)
}

function poseAt(position: Vector3): CameraPose {
  return {
    position,
    target: new Vector3(),
    up: new Vector3(0, 1, 0),
  }
}

describe('Rival Signal orbital camera safety contract', () => {
  it.each([
    ['canonical fixture', site(14.209, -39.19), null],
    ['equatorial', site(0, 0), null],
    ['longitude seam', site(12, 179.7), site(-18, -179.6)],
    ['near antipodes', site(10, 20), site(-10.0001, -159.999)],
    ['near poles', site(89.4, 178.8), site(-88.9, -179.2)],
  ] as const)(
    'keeps every sampled %s path outside its declared clearance',
    (_label, player, explicitRival) => {
      const rival = explicitRival ?? deriveRivalSite(player).site

      for (const aspect of [PORTRAIT_ASPECT, LANDSCAPE_ASPECT]) {
        const plan = createRivalRevealCameraPlan(player, rival, aspect)

        for (const path of revealPaths(plan)) {
          expectPathSafe(path)
        }
      }
    },
  )

  it('uses a deterministic illuminated tangent for exact antipodes', () => {
    const first = new Vector3(1, 0, 0)
    const opposite = new Vector3(-1, 0, 0)
    const light = new Vector3(0, 1, 0)
    const midpoint = slerpUnitDirections(first, opposite, 0.5, light)
    const dualView = getDualSiteViewDirection(first, opposite, light)

    expect(midpoint.x).toBeCloseTo(0, 12)
    expect(midpoint.y).toBeCloseTo(1, 12)
    expect(midpoint.z).toBeCloseTo(0, 12)
    expect(dualView.x).toBeCloseTo(0, 12)
    expect(dualView.y).toBeCloseTo(1, 12)
    expect(dualView.z).toBeCloseTo(0, 12)
    expect(dualView.dot(first)).toBeCloseTo(0, 12)
    expect(dualView.dot(opposite)).toBeCloseTo(0, 12)
  })

  it('normalizes different legal orbital orientations and zooms safely', () => {
    const player = site(22, -74)
    const rival = deriveRivalSite(player).site
    const plan = createRivalRevealCameraPlan(
      player,
      rival,
      PORTRAIT_ASPECT,
    )
    const directions = [
      new Vector3(1, 0.05, 0.1).normalize(),
      new Vector3(-0.3, 0.82, -0.48).normalize(),
      new Vector3(0.02, -0.99, 0.14).normalize(),
      plan.rivalWidePose.position.clone().negate().normalize(),
    ]

    for (const direction of directions) {
      for (const radius of [2.12, 3.345, 4.7, 5.8]) {
        const path = createRivalFocusCameraPath(
          poseAt(direction.clone().multiplyScalar(radius)),
          plan,
        )

        expectPathSafe(path)
        expect(path.start.position.length()).toBeCloseTo(radius, 10)
        expect(path.end.position).toEqual(plan.rivalSurfacePose.position)
        expect(path.end.target).toEqual(plan.rivalSurfacePose.target)
      }
    }
  })

  it('clamps an unsafe supplied endpoint instead of ever sampling it', () => {
    const minimumRadius = 1.38
    const path = createSafeOrbitalCameraPath({
      start: poseAt(new Vector3(0, 0, 1.01)),
      end: poseAt(new Vector3(0, 0, -0.5)),
      minimumRadius,
      preferredArcDirection: new Vector3(0, 1, 0),
    })

    expect(path.start.position.length()).toBeCloseTo(minimumRadius, 12)
    expect(path.end.position.length()).toBeCloseTo(minimumRadius, 12)
    expectPathSafe(path)
  })

  it('generates identical paths and explicit final framing every time', () => {
    const player = site(-31, 126)
    const rival = deriveRivalSite(player).site
    const first = createRivalRevealCameraPlan(player, rival, PORTRAIT_ASPECT)
    const second = createRivalRevealCameraPlan(player, rival, PORTRAIT_ASPECT)

    for (const [firstPath, secondPath] of revealPaths(first).map(
      (path, index) => [path, revealPaths(second)[index]!] as const,
    )) {
      for (let index = 0; index <= 128; index += 1) {
        const progress = index / 128
        const firstSample = firstPath.sample(progress)
        const secondSample = secondPath.sample(progress)

        expect(firstSample.position.toArray()).toEqual(
          secondSample.position.toArray(),
        )
        expect(firstSample.target.toArray()).toEqual(
          secondSample.target.toArray(),
        )
        expect(firstSample.up.toArray()).toEqual(secondSample.up.toArray())
      }
    }

    expect(first.dualSites.end.position.length()).toBeCloseTo(
      first.framing.wideRadius,
      12,
    )
    expect(first.dualSites.end.target.toArray()).toEqual([0, 0, 0])
    expect(first.impact.end.position.length()).toBeGreaterThanOrEqual(
      RIVAL_CAMERA_SAFETY.surfaceMinimumRadius,
    )
    expect(first.impact.end.target).toEqual(first.rivalSurfacePose.target)
  })

  it('provides mobile framing for both portrait and landscape', () => {
    const player = site(8, 44)
    const rival = deriveRivalSite(player).site
    const portrait = createRivalRevealCameraPlan(
      player,
      rival,
      PORTRAIT_ASPECT,
    )
    const landscape = createRivalRevealCameraPlan(
      player,
      rival,
      LANDSCAPE_ASPECT,
    )

    expect(portrait.framing.narrowPortrait).toBe(true)
    expect(landscape.framing.narrowPortrait).toBe(false)
    expect(portrait.framing.wideRadius).toBeGreaterThan(
      landscape.framing.wideRadius,
    )
    expect(portrait.orbitalTransition.start.target.toArray()).toEqual([0, 0, 0])
    expect(landscape.orbitalTransition.start.target.toArray()).toEqual([0, 0, 0])
    revealPaths(portrait).forEach((path) => expectPathSafe(path, 256))
    revealPaths(landscape).forEach((path) => expectPathSafe(path, 256))
  })
})
