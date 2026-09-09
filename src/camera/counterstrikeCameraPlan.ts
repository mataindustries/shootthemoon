import { MathUtils, Vector3 } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  MOON_RENDER_RADIUS,
  landingSiteToLocalSurfaceRenderPoint,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import {
  createSafeOrbitalCameraPath,
  type CameraPose,
  type SafeOrbitalCameraPath,
} from './orbitalCameraPath.ts'
import {
  createCounterstrikeRoute,
  createInterceptorRoute,
  type CounterstrikeRoute,
} from './counterstrikeRoute.ts'
import { createStrikeCameraPlan } from './strikeCameraPlan.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'

const SUN_DIRECTION = new Vector3(4.6, 2.6, 3.4).normalize()
const WORLD_UP = new Vector3(0, 1, 0)
const COUNTERSTRIKE_CAMERA_ARC = new Vector3(-0.42, 0.76, 0.5).normalize()

export const COUNTERSTRIKE_CAMERA_SAFETY = Object.freeze({
  orbitalMinimumRadius: MOON_RENDER_RADIUS + 0.09,
  interceptMinimumRadius: MOON_RENDER_RADIUS + 0.075,
  damageMinimumRadius: MOON_RENDER_RADIUS + 0.0045,
  sampleCount: 2_048,
})

export interface CounterstrikeCameraPlan {
  readonly route: CounterstrikeRoute
  readonly launchPose: CameraPose
  readonly trackingPose: CameraPose
  readonly interceptPose: CameraPose
  readonly successPose: CameraPose
  readonly impactWidePose: CameraPose
  readonly impactMediumPose: CameraPose
  readonly damagePose: CameraPose
  readonly warningCamera: SafeOrbitalCameraPath
  readonly interceptorCamera: SafeOrbitalCameraPath
  readonly successCamera: SafeOrbitalCameraPath
  readonly impactWideCamera: SafeOrbitalCameraPath
  readonly impactMediumCamera: SafeOrbitalCameraPath
  readonly damageRevealCamera: SafeOrbitalCameraPath
}

export type CounterstrikeImpactCameraBeat =
  | 'wide'
  | 'medium'
  | 'contact'
  | 'damage-reveal'
  | 'damage-hold'

export const COUNTERSTRIKE_IMPACT_CAMERA_TIMING = Object.freeze({
  wideArrivalProgress: 0.12,
  wideHoldEndProgress: 0.24,
  mediumArrivalProgress: 0.36,
  contactProgress:
    COUNTERSTRIKE_TIMING.impactContactMs / COUNTERSTRIKE_TIMING.impactMs,
  mediumHoldEndProgress: 0.5,
  damageArrivalProgress: 0.6,
})

function rangeProgress(value: number, start: number, end: number): number {
  return MathUtils.clamp((value - start) / (end - start), 0, 1)
}

export function getCounterstrikeImpactCameraBeat(
  progress: number,
): CounterstrikeImpactCameraBeat {
  const clamped = MathUtils.clamp(progress, 0, 1)
  if (clamped < COUNTERSTRIKE_IMPACT_CAMERA_TIMING.wideHoldEndProgress) {
    return 'wide'
  }
  if (clamped < COUNTERSTRIKE_IMPACT_CAMERA_TIMING.contactProgress) {
    return 'medium'
  }
  if (clamped < COUNTERSTRIKE_IMPACT_CAMERA_TIMING.mediumHoldEndProgress) {
    return 'contact'
  }
  if (clamped < COUNTERSTRIKE_IMPACT_CAMERA_TIMING.damageArrivalProgress) {
    return 'damage-reveal'
  }
  return 'damage-hold'
}

export function sampleCounterstrikeImpactCamera(
  plan: CounterstrikeCameraPlan,
  progress: number,
  position: Vector3,
  target: Vector3,
  up: Vector3,
): CounterstrikeImpactCameraBeat {
  const clamped = MathUtils.clamp(progress, 0, 1)
  const timing = COUNTERSTRIKE_IMPACT_CAMERA_TIMING

  // Establish the terminal shot immediately, then keep projectile and target
  // in the same composition through contact and its short aftermath.
  if (clamped < timing.mediumHoldEndProgress) {
    position.copy(plan.impactWidePose.position)
    target.copy(plan.impactWidePose.target)
    up.copy(plan.impactWidePose.up)
  } else {
    plan.damageRevealCamera.sample(
      rangeProgress(
        clamped,
        timing.mediumHoldEndProgress,
        timing.damageArrivalProgress,
      ),
      position,
      target,
      up,
    )
  }

  return getCounterstrikeImpactCameraBeat(clamped)
}

export function createCounterstrikeCameraPlan(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  secondaryImpactSite: LandingSite,
  aspect: number,
  interceptRouteProgress = 0.7,
  threatProgressStart = Math.max(0.12, interceptRouteProgress - 0.07),
): CounterstrikeCameraPlan {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('Counterstrike camera aspect must be positive and finite.')
  }

  const narrow = aspect < 0.72
  const route = createCounterstrikeRoute(
    playerSite,
    rivalSite,
    secondaryImpactSite,
  )
  const player = landingSiteToRenderTransform(playerSite)
  const source = route.startDirection
  const viewDirection = player.up
    .clone()
    .multiplyScalar(0.66)
    .addScaledVector(source, 0.34)
  if (viewDirection.lengthSq() < 1e-10) viewDirection.copy(player.up)

  // Frame the launch vehicle against the lunar surface using the route's
  // own basis, independent of whichever orbit/surface view preceded it.
  const launchTarget = route.getRenderPoint(0.04)
  const launchSide = source.clone().cross(route.endDirection).normalize()
  if (launchSide.dot(SUN_DIRECTION) < 0) launchSide.negate()
  const launchPose: CameraPose = {
    position: launchTarget.clone()
      .addScaledVector(source, 0.2)
      .addScaledVector(launchSide, 0.42),
    target: launchTarget.clone().addScaledVector(source, -0.055),
    up: source.clone(),
  }

  const trackingPose: CameraPose = {
    position: viewDirection
      .normalize()
      .multiplyScalar(narrow ? 4.55 : 3.55)
      .addScaledVector(COUNTERSTRIKE_CAMERA_ARC, narrow ? 0.2 : 0.12),
    target: new Vector3(0, 0, 0),
    up: WORLD_UP.clone(),
  }
  const interceptPoint = route.getRenderPoint(interceptRouteProgress)
  const interceptorRoute = createInterceptorRoute(playerSite, route, interceptRouteProgress)
  // One explicit side view covers the entire actual engagement. Its vertical
  // axis follows the route, using portrait height instead of wasting width.
  const interceptDirection = player.up.clone().add(route.getDirection(interceptRouteProgress)).normalize()
  const interceptSide = player.up.clone().cross(route.getDirection(interceptRouteProgress)).normalize()
  const view = interceptDirection.clone().addScaledVector(interceptSide, 0.22).normalize()
  const up = interceptPoint.clone().sub(player.position)
    .addScaledVector(view, -interceptPoint.clone().sub(player.position).dot(view)).normalize()
  if (!narrow) up.cross(view).normalize()
  const right = up.clone().cross(view).normalize()
  const points = [player.position.clone(), interceptPoint.clone()]
  for (let index = 0; index <= 48; index++) {
    const t = index / 48
    points.push(interceptorRoute.getRenderPoint(t))
    points.push(route.getRenderPoint(MathUtils.lerp(threatProgressStart, interceptRouteProgress, t)))
  }
  const target = player.position.clone().lerp(interceptPoint, 0.5)
  const tanY = Math.tan(MathUtils.degToRad(narrow ? 56 : 40) / 2)
  let distance = 0.25
  for (const point of points) {
    const offset = point.clone().sub(target)
    // Include the exaggerated missile silhouettes and initial debris flash.
    distance = Math.max(distance, offset.dot(view) + Math.max(
      (Math.abs(offset.dot(right)) + 0.055) / (tanY * aspect * 0.76),
      (Math.abs(offset.dot(up)) + 0.055) / (tanY * 0.68),
    ))
  }
  const interceptPose: CameraPose = {
    position: target.clone().addScaledVector(view, distance), target, up,
  }
  const successPose: CameraPose = {
    position: interceptPose.position.clone().sub(interceptPose.target)
      .multiplyScalar(2.8).add(interceptPose.target),
    target: interceptPose.target.clone(),
    up: interceptPose.up.clone(),
  }
  const playerSurfacePosition = player.position
    .clone()
    .addScaledVector(player.up, LOCAL_SURFACE_RENDER_OFFSET)
  const impactPosition = landingSiteToLocalSurfaceRenderPoint(
    playerSite,
    secondaryImpactSite,
  ).addScaledVector(player.up, LOCAL_SURFACE_RENDER_OFFSET)
  const damageAxis = impactPosition
    .clone()
    .sub(player.position)
    .addScaledVector(
      player.up,
      -impactPosition.clone().sub(player.position).dot(player.up),
    )
  if (damageAxis.lengthSq() < 1e-10) damageAxis.copy(player.east)
  damageAxis.normalize()
  const damageSide = damageAxis.clone().cross(player.up).normalize()
  const viewSide = damageSide.clone().multiplyScalar(
    damageSide.dot(SUN_DIRECTION) >= 0 ? 1 : -1,
  )
  const metres = LOCAL_METRES_TO_RENDER_UNITS
  const surfaceFocus = (routeProgress: number, heightM: number) =>
    playerSurfacePosition
      .clone()
      .lerp(impactPosition, routeProgress)
      .addScaledVector(player.up, heightM * metres)
  const surfacePose = (
    routeProgress: number,
    sideM: number,
    heightM: number,
    targetHeightM: number,
    rollRad = 0,
  ): CameraPose => {
    const surfaceAnchor = surfaceFocus(routeProgress, 0)
    const target = surfaceFocus(routeProgress, targetHeightM)
    const position = surfaceAnchor
      .clone()
      .addScaledVector(viewSide, sideM * metres)
      .addScaledVector(player.up, heightM * metres)
    if (rollRad === 0) {
      return { position, target, up: player.up.clone() }
    }

    const view = target.clone().sub(position).normalize()
    const projectedUp = player.up
      .clone()
      .addScaledVector(view, -player.up.dot(view))
      .normalize()
    const up = projectedUp
      .multiplyScalar(Math.cos(rollRad))
      .addScaledVector(damageAxis, Math.sin(rollRad))
      .normalize()
    return { position, target, up }
  }
  const impactWidePose = surfacePose(0.65, narrow ? 70 : 52, 48, 10)
  // Retain the beat markers without introducing a second shot before impact.
  const impactMediumPose = impactWidePose
  const damagePose: CameraPose = {
    position: impactWidePose.position.clone()
      .sub(impactWidePose.target)
      .multiplyScalar(1.3)
      .add(impactWidePose.target),
    target: impactWidePose.target.clone(),
    up: impactWidePose.up.clone(),
  }
  const firstStrikeFinalPose = createStrikeCameraPlan(
    playerSite,
    rivalSite,
    aspect,
  ).finalOrbitPose
  const warningCamera = createSafeOrbitalCameraPath({
    start: firstStrikeFinalPose,
    end: trackingPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.orbitalMinimumRadius,
    preferredArcDirection: COUNTERSTRIKE_CAMERA_ARC,
    arcHeight: 0.08,
  })
  const interceptorCamera = createSafeOrbitalCameraPath({
    start: interceptPose,
    end: interceptPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius,
    preferredArcDirection: COUNTERSTRIKE_CAMERA_ARC,
    arcHeight: 0,
  })
  const successCamera = createSafeOrbitalCameraPath({
    start: interceptPose,
    end: successPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius,
    timing: 'climb-before-arc',
    preferredArcDirection: COUNTERSTRIKE_CAMERA_ARC,
  })
  const impactWideCamera = createSafeOrbitalCameraPath({
    start: trackingPose,
    end: impactWidePose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.damageMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: player.up,
  })
  const impactMediumCamera = createSafeOrbitalCameraPath({
    start: impactWidePose,
    end: impactMediumPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.damageMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: player.east,
  })
  const damageRevealCamera = createSafeOrbitalCameraPath({
    start: impactMediumPose,
    end: damagePose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.damageMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: player.south,
  })

  return {
    route,
    launchPose,
    trackingPose,
    interceptPose,
    successPose,
    impactWidePose,
    impactMediumPose,
    damagePose,
    warningCamera,
    interceptorCamera,
    successCamera,
    impactWideCamera,
    impactMediumCamera,
    damageRevealCamera,
  }
}

// Presentation-only hold; the success simulation and effect clocks are unchanged.
export const COUNTERSTRIKE_INTERCEPTION_HOLD_MS = 1_000
export function sampleCounterstrikeInterceptionCamera(
  plan: CounterstrikeCameraPlan,
  status: 'interceptor-launched' | 'success',
  progress: number,
  position: Vector3,
  target: Vector3,
  up: Vector3,
): 'interception-flight' | 'interception-hold' | 'interception-pullback' {
  const hold = COUNTERSTRIKE_INTERCEPTION_HOLD_MS / COUNTERSTRIKE_TIMING.successMs
  if (status === 'interceptor-launched' || progress <= hold) {
    position.copy(plan.interceptPose.position)
    target.copy(plan.interceptPose.target)
    up.copy(plan.interceptPose.up)
    return status === 'success' ? 'interception-hold' : 'interception-flight'
  }
  const t = MathUtils.smoothstep(rangeProgress(progress, hold, 1), 0, 1)
  position.lerpVectors(plan.interceptPose.position, plan.successPose.position, t)
  target.copy(plan.interceptPose.target)
  up.copy(plan.interceptPose.up)
  return 'interception-pullback'
}
