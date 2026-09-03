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
import { sampleMinimumCameraRadius } from './orbitalCameraPath.ts'
import {
  COUNTERSTRIKE_IMPACT_CAMERA_TIMING,
  COUNTERSTRIKE_CAMERA_SAFETY,
  createCounterstrikeCameraPlan,
  getCounterstrikeImpactCameraBeat,
} from './counterstrikeCameraPlan.ts'
import {
  COUNTERSTRIKE_ROUTE_SAFETY,
  createCounterstrikeRoute,
  createInterceptorRoute,
  sampleMinimumCounterstrikeClearanceM,
} from './counterstrikeRoute.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import {
  landingSiteToLocalSurfaceRenderPoint,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'

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
      expect(sampleMinimumCameraRadius(plan.interceptorCamera)).toBeGreaterThanOrEqual(
        COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius - 1e-9,
      )
      expect(sampleMinimumCameraRadius(plan.successCamera)).toBeGreaterThanOrEqual(
        COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius - 1e-9,
      )
      for (const path of [
        plan.impactWideCamera,
        plan.impactMediumCamera,
        plan.damageRevealCamera,
      ]) {
        expect(sampleMinimumCameraRadius(path)).toBeGreaterThanOrEqual(
          COUNTERSTRIKE_CAMERA_SAFETY.damageMinimumRadius - 1e-9,
        )
      }
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

      const playerTransform = landingSiteToRenderTransform(player)
      const playerPosition = playerTransform.position
      const impactPosition = landingSiteToRenderTransform(impact).position
      const damageAxis = impactPosition
        .clone()
        .sub(playerPosition)
        .addScaledVector(
          playerTransform.up,
          -impactPosition.clone().sub(playerPosition).dot(playerTransform.up),
        )
        .normalize()
      for (const pose of [
        plan.impactWidePose,
        plan.impactMediumPose,
        plan.damagePose,
      ]) {
        const viewDirection = pose.target
          .clone()
          .sub(pose.position)
          .normalize()
        expect(Math.abs(viewDirection.dot(damageAxis))).toBeLessThan(0.3)
      }
    },
  )

  it('holds the low damage composition for at least three seconds', () => {
    expect(
      COUNTERSTRIKE_TIMING.impactMs *
        (1 - COUNTERSTRIKE_IMPACT_CAMERA_TIMING.damageArrivalProgress),
    ).toBeGreaterThanOrEqual(3_000)
    expect(COUNTERSTRIKE_IMPACT_CAMERA_TIMING.contactProgress).toBe(0.4)
    expect(getCounterstrikeImpactCameraBeat(0.12)).toBe('wide')
    expect(getCounterstrikeImpactCameraBeat(0.3)).toBe('medium')
    expect(getCounterstrikeImpactCameraBeat(0.42)).toBe('contact')
    expect(getCounterstrikeImpactCameraBeat(0.55)).toBe('damage-reveal')
    expect(getCounterstrikeImpactCameraBeat(0.6)).toBe('damage-hold')
  })
})
