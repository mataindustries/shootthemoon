import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  createLandingSite,
  createLunarLocation,
  normalizeLongitude,
  surfaceUnitVector,
} from '../domain/lunarCoordinates.ts'
import { deriveRivalSite } from '../domain/rival.ts'
import {
  MOON_RENDER_RADIUS,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import {
  sampleMinimumCameraRadius,
  type CameraPose,
} from './orbitalCameraPath.ts'
import {
  STRIKE_CAMERA_SAFETY,
  STRIKE_PROJECTION_FOV,
  createStrikeCameraPlan,
} from './strikeCameraPlan.ts'
import {
  STRIKE_ROUTE_SAFETY,
  createStrikeRoute,
  sampleMinimumStrikeClearanceM,
} from './strikeRoute.ts'

function site(latitudeRad: number, longitudeRad: number) {
  return createLandingSite(
    createLunarLocation(latitudeRad, normalizeLongitude(longitudeRad), 0),
  )
}

const NARROW_PORTRAIT_ASPECT = 390 / 844
const CRATER_RADIUS = 0.052

function samplePose(
  path: { sample: (progress: number) => CameraPose },
  progress: number,
): CameraPose {
  const { position, target, up } = path.sample(progress)
  return { position: position.clone(), target: target.clone(), up: up.clone() }
}

function projectFromPose(
  pose: CameraPose,
  fov: number,
  aspect: number,
  point: Vector3,
): Vector3 {
  const camera = new PerspectiveCamera(fov, aspect, 0.0004, 80)
  camera.position.copy(pose.position)
  camera.up.copy(pose.up)
  camera.lookAt(pose.target)
  camera.updateMatrixWorld(true)
  return point.clone().project(camera)
}

/** Share of the frame, sampled on a grid, whose view ray meets the Moon. */
function moonFrameCoverage(pose: CameraPose, fov: number, aspect: number): number {
  const camera = new PerspectiveCamera(fov, aspect, 0.0004, 80)
  camera.position.copy(pose.position)
  camera.up.copy(pose.up)
  camera.lookAt(pose.target)
  camera.updateMatrixWorld(true)
  const origin = camera.position
  const direction = new Vector3()
  const samples = 32
  let hits = 0

  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) {
      direction
        .set(((column + 0.5) / samples) * 2 - 1, ((row + 0.5) / samples) * 2 - 1, 0.5)
        .unproject(camera)
        .sub(origin)
        .normalize()
      const along = origin.dot(direction)
      const discriminant =
        along * along - (origin.lengthSq() - MOON_RENDER_RADIUS ** 2)
      if (discriminant >= 0 && -along - Math.sqrt(discriminant) > 0) hits += 1
    }
  }

  return hits / (samples * samples)
}

/** Screen-space bounds of the crater rim ring around the rival site. */
function craterBounds(
  pose: CameraPose,
  fov: number,
  aspect: number,
  rivalSite: ReturnType<typeof site>,
) {
  const transform = landingSiteToRenderTransform(rivalSite)
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }

  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2
    const point = projectFromPose(pose, fov, aspect, transform.position
      .clone()
      .addScaledVector(transform.east, Math.cos(angle) * CRATER_RADIUS)
      .addScaledVector(transform.south, Math.sin(angle) * CRATER_RADIUS))
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }

  return bounds
}

const ROUTE_CASES = [
  {
    name: 'longitude seam',
    player: site(0.24, Math.PI - 1e-7),
    rival: site(-0.36, -Math.PI + 1e-7),
  },
  {
    name: 'north polar origin',
    player: site(Math.PI / 2, 1.9),
    rival: site(-0.42, -1.2),
  },
  {
    name: 'south polar target',
    player: site(0.51, 2.72),
    rival: site(-Math.PI / 2, -2.4),
  },
  {
    name: 'near antipodes',
    player: site(0.18, 0.42),
    rival: site(-0.18 + 1e-7, 0.42 + Math.PI - 1e-7),
  },
  {
    name: 'exact antipodes',
    player: site(0, 0),
    rival: site(0, Math.PI),
  },
] as const

describe('deterministic First Strike route', () => {
  it.each(ROUTE_CASES)(
    'stays outside the Moon for $name coordinates',
    ({ player, rival }) => {
      const route = createStrikeRoute(player, rival)
      const minimumClearance = sampleMinimumStrikeClearanceM(
        route,
        STRIKE_ROUTE_SAFETY.sampleCount,
      )
      const expectedStart = surfaceUnitVector(player.location)
      const expectedEnd = surfaceUnitVector(rival.location)
      const start = route.getDirection(0)
      const end = route.getDirection(1)

      expect(minimumClearance).toBeGreaterThanOrEqual(
        STRIKE_ROUTE_SAFETY.minimumClearanceM - 1e-6,
      )
      expect(start.distanceTo(new Vector3(
        expectedStart.x,
        expectedStart.y,
        expectedStart.z,
      ))).toBeLessThan(1e-12)
      expect(end.distanceTo(new Vector3(
        expectedEnd.x,
        expectedEnd.y,
        expectedEnd.z,
      ))).toBeLessThan(1e-12)
      expect(route.getCanonicalPoint(0.5).length()).toBeGreaterThan(
        STRIKE_ROUTE_SAFETY.moonRadiusM +
          STRIKE_ROUTE_SAFETY.minimumPeakClearanceM -
          1e-6,
      )
    },
  )

  it('produces bit-for-bit repeatable samples from canonical sites', () => {
    const player = site(0.248, -0.684)
    const rival = site(-0.412, 2.26)
    const first = createStrikeRoute(player, rival)
    const second = createStrikeRoute(player, rival)

    for (let index = 0; index <= 128; index += 1) {
      const progress = index / 128
      expect(first.getCanonicalPoint(progress).toArray()).toEqual(
        second.getCanonicalPoint(progress).toArray(),
      )
    }
    expect(first.angularSeparationRad).toBe(second.angularSeparationRad)
    expect(first.peakClearanceM).toBe(second.peakClearanceM)
  })

  it.each([390 / 844, 844 / 390])(
    'keeps every strike camera cut radially safe at aspect %f',
    (aspect) => {
      const player = site(0.248, -0.684)
      const rival = site(-0.61, 2.08)
      const plan = createStrikeCameraPlan(player, rival, aspect)

      expect(sampleMinimumCameraRadius(
        plan.flightCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.surfaceMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.transmissionCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.flightMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.targetApproachCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.approachMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.craterRevealCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.approachMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(
        plan.orbitalPullbackCamera,
        STRIKE_CAMERA_SAFETY.sampleCount,
      )).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.approachMinimumRadius - 1e-9,
      )
      expect(plan.armingPose.position.length()).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.surfaceMinimumRadius,
      )
      expect(plan.launchPose.position.length()).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.surfaceMinimumRadius,
      )
      expect(plan.scarExplorePose.position.length()).toBeGreaterThanOrEqual(
        STRIKE_CAMERA_SAFETY.surfaceMinimumRadius,
      )
      expect(plan.finalOrbitPose.position.length()).toBeGreaterThan(
        MOON_RENDER_RADIUS + 2,
      )
    },
  )

  it.each([390 / 844, 844 / 390])(
    'frames the complete permanent damage field with untouched terrain at aspect %f',
    (aspect) => {
      const player = site(0.248, -0.684)
      const rival = site(-0.61, 2.08)
      const plan = createStrikeCameraPlan(player, rival, aspect)
      const transform = landingSiteToRenderTransform(rival)
      const camera = new PerspectiveCamera(aspect < 0.72 ? 52 : 41, aspect)
      camera.position.copy(plan.scarExplorePose.position)
      camera.up.copy(plan.scarExplorePose.up)
      camera.lookAt(plan.scarExplorePose.target)
      camera.updateMatrixWorld(true)

      for (let index = 0; index < 32; index += 1) {
        const angle = (index / 32) * Math.PI * 2
        const radius = 0.09
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        const point = new Vector3(
          x,
          Math.sqrt(1 - x * x - z * z) - 1,
          z,
        )
          .applyQuaternion(transform.orientation)
          .add(transform.position)
          .project(camera)

        expect(Math.abs(point.x)).toBeLessThan(0.84)
        expect(Math.abs(point.y)).toBeLessThan(0.84)
      }
    },
  )

  it.each([1440 / 900, 1920 / 1080, 844 / 390])(
    'keeps the landscape crater reveal, pullback and ending on the authored poses at aspect %f',
    (aspect) => {
      const player = site(0.248, -0.684)
      const rival = site(-0.61, 2.08)
      const plan = createStrikeCameraPlan(player, rival, aspect)

      expect(plan.craterRevealPose).toBe(plan.impactPose)
      for (const progress of [0, 0.5, 1]) {
        expect(
          plan.craterRevealCamera.getPoint(progress)
            .distanceTo(plan.impactPose.position),
        ).toBeLessThan(1e-12)
      }
      expect(
        plan.orbitalPullbackCamera.start.position
          .distanceTo(plan.impactPose.position),
      ).toBeLessThan(1e-12)
      expect(plan.finalOrbitPose.target.length()).toBe(0)
      expect(plan.finalOrbitPose.position.length()).toBeCloseTo(3.65, 12)
    },
  )
})

describe('narrow portrait First Strike framing', () => {
  const player = site(0.248, -0.684)
  const rival = deriveRivalSite(player).site
  const plan = createStrikeCameraPlan(player, rival, NARROW_PORTRAIT_ASPECT)
  const fov = STRIKE_PROJECTION_FOV.narrowPortrait

  it('opens the crater reveal on the impact pose and settles on the whole crater', () => {
    const opening = samplePose(plan.craterRevealCamera, 0)
    const impact = craterBounds(plan.impactPose, fov.close, NARROW_PORTRAIT_ASPECT, rival)
    const reveal = craterBounds(
      samplePose(plan.craterRevealCamera, 1),
      fov.close,
      NARROW_PORTRAIT_ASPECT,
      rival,
    )

    expect(opening.position.distanceTo(plan.impactPose.position)).toBeLessThan(1e-12)
    expect(opening.target.distanceTo(plan.impactPose.target)).toBeLessThan(1e-12)
    // The impact framing is wider than the phone: only rim fragments show.
    expect(impact.maxX).toBeGreaterThan(1)
    // The reveal holds the complete rim with terrain on every side, while the
    // crater still spans most of the frame width.
    for (const extent of [reveal.minX, reveal.maxX, reveal.minY, reveal.maxY]) {
      expect(Math.abs(extent)).toBeLessThan(0.8)
    }
    expect(reveal.maxX - reveal.minX).toBeGreaterThan(1.1)
  })

  it('keeps the crater framing across the crater-reveal to pullback FOV cut', () => {
    const reveal = craterBounds(
      samplePose(plan.craterRevealCamera, 1),
      fov.close,
      NARROW_PORTRAIT_ASPECT,
      rival,
    )
    const pullback = craterBounds(
      samplePose(plan.orbitalPullbackCamera, 0),
      fov.pullback,
      NARROW_PORTRAIT_ASPECT,
      rival,
    )

    expect(pullback.maxX - pullback.minX).toBeCloseTo(reveal.maxX - reveal.minX, 1)
    expect(pullback.maxY - pullback.minY).toBeCloseTo(reveal.maxY - reveal.minY, 1)
    expect((pullback.minY + pullback.maxY) / 2).toBeCloseTo(
      (reveal.minY + reveal.maxY) / 2,
      1,
    )
  })

  it('keeps the Moon filling a large share of the frame through the whole pullback', () => {
    for (let index = 0; index <= 20; index += 1) {
      const pose = samplePose(plan.orbitalPullbackCamera, index / 20)
      expect(
        moonFrameCoverage(pose, fov.pullback, NARROW_PORTRAIT_ASPECT),
      ).toBeGreaterThan(0.38)
    }
  })

  it.each([
    [0.248, -0.684],
    [0.9, 2.4],
    [-0.95, -1.1],
    [0.05, 3.1],
    [-0.3, 0.2],
  ])(
    'holds the scar beneath the centred end card at player site %f, %f',
    (latitude, longitude) => {
      const sweepPlayer = site(latitude, longitude)
      const sweepRival = deriveRivalSite(sweepPlayer).site
      const sweepPlan = createStrikeCameraPlan(
        sweepPlayer,
        sweepRival,
        NARROW_PORTRAIT_ASPECT,
      )
      const scar = projectFromPose(
        sweepPlan.finalOrbitPose,
        fov.pullback,
        NARROW_PORTRAIT_ASPECT,
        landingSiteToRenderTransform(sweepRival).position,
      )
      const moonCentre = projectFromPose(
        sweepPlan.finalOrbitPose,
        fov.pullback,
        NARROW_PORTRAIT_ASPECT,
        new Vector3(),
      )

      // The end card covers roughly NDC y -0.41..0.41 at 390x844.
      expect(scar.y).toBeLessThan(-0.55)
      expect(scar.y).toBeGreaterThan(-0.85)
      expect(Math.abs(scar.x)).toBeLessThan(0.5)
      expect(moonCentre.y).toBeLessThan(-0.45)
      expect(
        samplePose(sweepPlan.orbitalPullbackCamera, 1).position
          .distanceTo(sweepPlan.finalOrbitPose.position),
      ).toBeLessThan(1e-12)
    },
  )
})
