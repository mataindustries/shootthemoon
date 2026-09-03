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
  type CounterstrikeRoute,
} from './counterstrikeRoute.ts'
import { createStrikeCameraPlan } from './strikeCameraPlan.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'

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

  if (clamped < timing.wideHoldEndProgress) {
    plan.impactWideCamera.sample(
      Math.min(1, clamped / timing.wideArrivalProgress),
      position,
      target,
      up,
    )
  } else if (clamped < timing.mediumHoldEndProgress) {
    plan.impactMediumCamera.sample(
      rangeProgress(
        clamped,
        timing.wideHoldEndProgress,
        timing.mediumArrivalProgress,
      ),
      position,
      target,
      up,
    )
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

  const trackingPose: CameraPose = {
    position: viewDirection
      .normalize()
      .multiplyScalar(narrow ? 4.55 : 3.55)
      .addScaledVector(COUNTERSTRIKE_CAMERA_ARC, narrow ? 0.2 : 0.12),
    target: new Vector3(0, 0, 0),
    up: WORLD_UP.clone(),
  }
  const interceptPoint = route.getRenderPoint(0.7)
  const interceptDirection = route.getDirection(0.7)
  const interceptSide = interceptDirection
    .clone()
    .cross(COUNTERSTRIKE_CAMERA_ARC)
  if (interceptSide.lengthSq() < 1e-10) {
    interceptSide.set(0, 1, 0).cross(interceptDirection)
  }
  interceptSide.normalize()
  const interceptPose: CameraPose = {
    position: interceptPoint
      .clone()
      .addScaledVector(interceptDirection, narrow ? 0.32 : 0.24)
      .addScaledVector(interceptSide, narrow ? 0.52 : 0.4),
    target: interceptPoint.clone(),
    up: WORLD_UP.clone(),
  }
  const successDirection = interceptPoint.clone().normalize()
  const successPose: CameraPose = {
    position: successDirection
      .multiplyScalar(narrow ? 3.9 : 3.15)
      .addScaledVector(interceptSide, narrow ? 0.32 : 0.24),
    target: new Vector3(0, 0, 0),
    up: WORLD_UP.clone(),
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
  const viewSide = damageSide.clone().multiplyScalar(narrow ? 1 : -1)
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
  const impactWidePose: CameraPose = {
    ...surfacePose(0.5, narrow ? 70 : 52, narrow ? 48 : 42, 2),
  }
  const impactMediumPose: CameraPose = {
    ...surfacePose(0.8, narrow ? 50 : 44, 38, narrow ? 12 : 14),
  }
  const damagePose: CameraPose = {
    ...surfacePose(
      0.62,
      narrow ? 75 : 55,
      38,
      narrow ? 10 : 14,
      narrow ? MathUtils.degToRad(15) : 0,
    ),
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
    start: trackingPose,
    end: interceptPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius,
    preferredArcDirection: COUNTERSTRIKE_CAMERA_ARC,
    arcHeight: 0.06,
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
