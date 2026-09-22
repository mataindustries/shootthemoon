import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
  normalizeLongitude,
} from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import {
  deriveSecondaryImpactOffset,
  deriveSecondaryImpactSite,
} from '../domain/counterstrike.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  advanceOutpost,
  constructExtractor,
  createInitialOutpost,
} from '../simulation/outpostSimulation.ts'
import { Vector3 } from 'three'
import { sampleMinimumCameraRadius } from './orbitalCameraPath.ts'
import {
  COUNTERSTRIKE_IMPACT_CAMERA_TIMING,
  COUNTERSTRIKE_CAMERA_SAFETY,
  createCounterstrikeCameraPlan,
  getCounterstrikeImpactCameraBeat,
  sampleCounterstrikeImpactCamera,
} from './counterstrikeCameraPlan.ts'
import {
  COUNTERSTRIKE_ROUTE_SAFETY,
  createCounterstrikeRoute,
  createCounterstrikeTerminalApproach,
  createInterceptorRoute,
  sampleMinimumCounterstrikeClearanceM,
} from './counterstrikeRoute.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import {
  landingSiteToLocalSurfaceRenderPoint,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import {
  createSurfaceTerrainProfile,
  sampleTerrainHeightM,
} from '../render/surfaceTerrain.ts'

function site(latitudeRad: number, longitudeRad: number) {
  return createLandingSite(
    createLunarLocation(latitudeRad, normalizeLongitude(longitudeRad), 0),
  )
}

function activeOutpost(playerSite = site(0.248, -0.684)) {
  const initial = createInitialOutpost(playerSite, 1_000)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 95,
    robot: { ...initial.robot, state: 'idle' as const },
  }
  const construction = constructExtractor(
    prepared,
    DEPOSIT_BLUEPRINTS[0]!.id,
    1_100,
  )
  return advanceOutpost(
    construction,
    1_100 + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

const CASES = [
  { player: site(0.24, Math.PI - 1e-7), rival: site(-0.31, -1.1) },
  { player: site(Math.PI / 2, 0), rival: site(-0.42, 1.6) },
  { player: site(-Math.PI / 2, 0), rival: site(0.38, -2.2) },
  { player: site(0, 0), rival: site(0, Math.PI) },
] as const

describe('deterministic Counterstrike routes', () => {
  it.each(CASES)('keeps the hostile safe arc outside the Moon', ({ player, rival }) => {
    const outpost = activeOutpost(player)
    const impact = deriveSecondaryImpactSite(outpost)
    const route = createCounterstrikeRoute(player, rival, impact)

    expect(sampleMinimumCounterstrikeClearanceM(route)).toBeGreaterThanOrEqual(
      COUNTERSTRIKE_ROUTE_SAFETY.minimumClearanceM - 1e-6,
    )
    expect(route.getTerminalCanonicalPoint(1).length()).toBeCloseTo(
      COUNTERSTRIKE_ROUTE_SAFETY.moonRadiusM +
        COUNTERSTRIKE_ROUTE_SAFETY.terminalClearanceM,
      6,
    )

    const interceptor = createInterceptorRoute(player, route, 0.68)
    for (let index = 0; index <= 256; index += 1) {
      expect(interceptor.getCanonicalPoint(index / 256).length()).toBeGreaterThan(
        COUNTERSTRIKE_ROUTE_SAFETY.moonRadiusM,
      )
    }
  })

  it('repeats every hostile and interceptor sample exactly', () => {
    const player = site(0.248, -0.684)
    const rival = site(-0.61, 2.08)
    const impact = deriveSecondaryImpactSite(activeOutpost(player))
    const first = createCounterstrikeRoute(player, rival, impact)
    const second = createCounterstrikeRoute(player, rival, impact)
    const firstInterceptor = createInterceptorRoute(player, first, 0.72)
    const secondInterceptor = createInterceptorRoute(player, second, 0.72)

    for (let index = 0; index <= 128; index += 1) {
      const progress = index / 128
      expect(first.getCanonicalPoint(progress).toArray()).toEqual(
        second.getCanonicalPoint(progress).toArray(),
      )
      expect(firstInterceptor.getCanonicalPoint(progress).toArray()).toEqual(
        secondInterceptor.getCanonicalPoint(progress).toArray(),
      )
    }
  })

  it('maps the canonical secondary site onto the expanded local damage field', () => {
    const player = site(0.248, -0.684)
    const outpost = activeOutpost(player)
    const impact = deriveSecondaryImpactSite(outpost)
    const offset = deriveSecondaryImpactOffset(outpost)
    const transform = landingSiteToRenderTransform(player)
    const expanded = landingSiteToLocalSurfaceRenderPoint(player, impact)
    const delta = expanded.sub(transform.position)

    expect(delta.dot(transform.east) / LOCAL_METRES_TO_RENDER_UNITS).toBeCloseTo(
      offset.xM,
      3,
    )
    expect(delta.dot(transform.south) / LOCAL_METRES_TO_RENDER_UNITS).toBeCloseTo(
      offset.zM,
      3,
    )
  })

  it.each([390 / 844, 844 / 390])(
    'keeps the shorter Counterstrike camera routes clear at aspect %f',
    (aspect) => {
      const player = site(0.248, -0.684)
      const rival = site(-0.61, 2.08)
      const impact = deriveSecondaryImpactSite(activeOutpost(player))
      const plan = createCounterstrikeCameraPlan(player, rival, impact, aspect)

      expect(sampleMinimumCameraRadius(plan.warningCamera)).toBeGreaterThanOrEqual(
        COUNTERSTRIKE_CAMERA_SAFETY.orbitalMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(plan.successCamera)).toBeGreaterThanOrEqual(
        COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius - 1e-9,
      )
      // Terminal shots are checked sample by sample against the rendered
      // relief below; here the resolved damage framing stays above the floor.
      expect(plan.damagePose.position.length()).toBeGreaterThanOrEqual(
        COUNTERSTRIKE_CAMERA_SAFETY.damageMinimumRadius,
      )
      const surfaceUp = plan.damagePose.target.clone().normalize()
      const damageView = plan.damagePose.position
        .clone()
        .sub(plan.damagePose.target)
      const vertical = Math.abs(damageView.dot(surfaceUp))
      const horizontal = damageView
        .clone()
        .addScaledVector(surfaceUp, -damageView.dot(surfaceUp))
        .length()
      expect(horizontal).toBeGreaterThan(vertical)

      // The terminal shot looks back across the hit at the outpost: the
      // contact point always sits in front of the extractor and the lander,
      // so neither structure can hide it.
      const frame = plan.impactFrame
      const extractor = frame.at(-8.4, 0, 3)
      const lander = frame.origin
      for (const pose of [
        plan.impactWidePose,
        plan.impactMediumPose,
        plan.damagePose,
      ]) {
        const toHit = pose.position.distanceTo(frame.impact)
        expect(toHit).toBeLessThan(pose.position.distanceTo(extractor))
        expect(toHit).toBeLessThan(pose.position.distanceTo(lander))
      }
    },
  )

  it.each(CASES)(
    'keeps every terminal camera sample clear of the rendered relief',
    ({ player, rival }) => {
      const impact = deriveSecondaryImpactSite(activeOutpost(player))
      const terrain = createSurfaceTerrainProfile(player)
      for (const aspect of [390 / 844, 1440 / 900, 1920 / 1080]) {
        const plan = createCounterstrikeCameraPlan(player, rival, impact, aspect)
        const frame = plan.impactFrame
        const position = new Vector3()
        for (let index = 0; index <= 220; index += 1) {
          sampleCounterstrikeImpactCamera(
            plan,
            index / 220,
            position,
            new Vector3(),
            new Vector3(),
          )
          const offset = position.clone().sub(frame.origin)
          const heightM =
            offset.dot(frame.up) / LOCAL_METRES_TO_RENDER_UNITS -
            sampleTerrainHeightM(
              terrain,
              offset.dot(frame.east) / LOCAL_METRES_TO_RENDER_UNITS,
              offset.dot(frame.south) / LOCAL_METRES_TO_RENDER_UNITS,
            )
          expect(heightM).toBeGreaterThanOrEqual(
            COUNTERSTRIKE_CAMERA_SAFETY.damageSurfaceClearanceM,
          )
          expect(position.length()).toBeGreaterThan(
            1 + LOCAL_SURFACE_RENDER_OFFSET,
          )
        }
      }
    },
  )

  it('converges the presented warhead on the contact point', () => {
    const player = site(0.248, -0.684)
    const impact = deriveSecondaryImpactSite(activeOutpost(player))
    const approach = createCounterstrikeTerminalApproach(player, impact)
    const frame = approach.frame
    let previousDistance = Number.POSITIVE_INFINITY
    let previousHeight = Number.POSITIVE_INFINITY
    for (let index = 0; index <= 50; index += 1) {
      const tip = approach.getTipPoint(index / 50)
      const distance = tip.distanceTo(frame.impact)
      const height = tip.clone().sub(frame.impact).dot(frame.up)
      expect(distance).toBeLessThan(previousDistance)
      expect(height).toBeLessThanOrEqual(previousHeight)
      previousDistance = distance
      previousHeight = height
    }
    expect(approach.getTipPoint(1).distanceTo(frame.impact)).toBeLessThan(1e-12)
    // It dives steeply out of the sky above the far side of the outpost.
    const dive = approach.getDirection()
    expect(-dive.dot(frame.up)).toBeGreaterThan(0.3)
    expect(dive.dot(frame.axis)).toBeGreaterThan(0.5)
  })

  it('moves through contact and reveal without a frozen tail', () => {
    const timing = COUNTERSTRIKE_IMPACT_CAMERA_TIMING
    const ms = (progress: number) => progress * COUNTERSTRIKE_TIMING.impactMs
    // The approach stays readable and contact is intentional, not late.
    expect(ms(timing.contactProgress)).toBeGreaterThanOrEqual(1_200)
    expect(timing.contactProgress).toBeGreaterThan(0.3)
    expect(timing.contactProgress).toBeLessThan(0.4)
    // The contact composition holds long enough to read the blast.
    expect(
      ms(timing.mediumHoldEndProgress - timing.contactProgress),
    ).toBeGreaterThanOrEqual(750)
    // The reveal is a real move, and the settled hold is brief: the resolved
    // ending holds the damage framing from there.
    expect(
      ms(timing.damageArrivalProgress - timing.mediumHoldEndProgress),
    ).toBeGreaterThanOrEqual(1_200)
    expect(ms(1 - timing.damageArrivalProgress)).toBeGreaterThanOrEqual(200)
    expect(ms(1 - timing.damageArrivalProgress)).toBeLessThanOrEqual(400)

    const beatAt = (elapsedMs: number) =>
      getCounterstrikeImpactCameraBeat(elapsedMs / COUNTERSTRIKE_TIMING.impactMs)
    expect(beatAt(300)).toBe('wide')
    expect(beatAt(1_200)).toBe('medium')
    expect(beatAt(COUNTERSTRIKE_TIMING.impactContactMs + 100)).toBe('contact')
    expect(beatAt(3_300)).toBe('damage-reveal')
    expect(beatAt(COUNTERSTRIKE_TIMING.impactMs - 100)).toBe('damage-hold')

    // Until the final settle, the camera never repeats a pose between 100 ms
    // samples, so the impact status cannot collapse into a still frame.
    const player = site(0.248, -0.684)
    const plan = createCounterstrikeCameraPlan(
      player,
      site(-0.61, 2.08),
      deriveSecondaryImpactSite(activeOutpost(player)),
      390 / 844,
    )
    // Change is measured as view rotation or eye travel relative to the
    // distance to the hit; 1e-3 is about one pixel on a 390 px phone.
    const sample = (elapsedMs: number) => {
      const position = new Vector3()
      const target = new Vector3()
      sampleCounterstrikeImpactCamera(
        plan,
        elapsedMs / COUNTERSTRIKE_TIMING.impactMs,
        position,
        target,
        new Vector3(),
      )
      return { position, look: target.sub(position).normalize() }
    }
    let previous = sample(0)
    for (
      let elapsedMs = 100;
      elapsedMs <= ms(timing.damageArrivalProgress);
      elapsedMs += 100
    ) {
      const current = sample(elapsedMs)
      const change = Math.max(
        current.look.angleTo(previous.look),
        current.position.distanceTo(previous.position) /
          current.position.distanceTo(plan.impactFrame.impact),
      )
      expect(change, `${elapsedMs} ms`).toBeGreaterThan(1e-3)
      previous = current
    }
  })
})
