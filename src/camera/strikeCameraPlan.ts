import { Vector3 } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  MOON_RENDER_RADIUS,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import {
  createSafeOrbitalCameraPath,
  type CameraPose,
  type SafeOrbitalCameraPath,
} from './orbitalCameraPath.ts'
import { createStrikeRoute, type StrikeRoute } from './strikeRoute.ts'

const WORLD_UP = new Vector3(0, 1, 0)
const CINEMATIC_ARC_DIRECTION = new Vector3(0.34, 0.79, 0.51).normalize()

export const STRIKE_CAMERA_SAFETY = Object.freeze({
  surfaceMinimumRadius: MOON_RENDER_RADIUS + 0.018,
  flightMinimumRadius: MOON_RENDER_RADIUS + 0.075,
  approachMinimumRadius: MOON_RENDER_RADIUS + 0.05,
  sampleCount: 2_048,
})

export interface StrikeCameraPlan {
  readonly route: StrikeRoute
  readonly armingPose: CameraPose
  readonly launchPose: CameraPose
  readonly flightEndPose: CameraPose
  readonly targetWidePose: CameraPose
  readonly impactPose: CameraPose
  readonly finalOrbitPose: CameraPose
  readonly flightCamera: SafeOrbitalCameraPath
  readonly transmissionCamera: SafeOrbitalCameraPath
  readonly targetApproachCamera: SafeOrbitalCameraPath
  readonly orbitalPullbackCamera: SafeOrbitalCameraPath
}

function localPointToWorld(
  site: LandingSite,
  east: number,
  up: number,
  south: number,
): Vector3 {
  const transform = landingSiteToRenderTransform(site)
  return transform.position
    .clone()
    .addScaledVector(transform.east, east)
    .addScaledVector(transform.up, up)
    .addScaledVector(transform.south, south)
}

function getPlayerSurfacePose(
  playerSite: LandingSite,
  narrowPortrait: boolean,
): CameraPose {
  const transform = landingSiteToRenderTransform(playerSite)
  return {
    position: localPointToWorld(
      playerSite,
      narrowPortrait ? 0.028 : 0.038,
      narrowPortrait ? 0.038 : 0.032,
      narrowPortrait ? 0.065 : 0.052,
    ),
    target: localPointToWorld(playerSite, 0, 0.006, 0),
    up: transform.up.clone(),
  }
}

function getTargetWidePose(
  rivalSite: LandingSite,
  narrowPortrait: boolean,
  target: Vector3,
): CameraPose {
  const transform = landingSiteToRenderTransform(rivalSite)
  const radius = narrowPortrait ? 1.52 : 1.38
  const position = transform.up
    .clone()
    .multiplyScalar(radius)
    .addScaledVector(transform.east, narrowPortrait ? -0.19 : -0.16)
    .addScaledVector(transform.south, narrowPortrait ? 0.11 : 0.14)
    .setLength(radius)

  return { position, target: target.clone(), up: WORLD_UP.clone() }
}

function getImpactPose(
  rivalSite: LandingSite,
  narrowPortrait: boolean,
): CameraPose {
  const transform = landingSiteToRenderTransform(rivalSite)
  return {
    position: localPointToWorld(
      rivalSite,
      narrowPortrait ? 0.085 : 0.11,
      narrowPortrait ? 0.13 : 0.105,
      narrowPortrait ? 0.17 : 0.15,
    ),
    target: localPointToWorld(rivalSite, 0, 0.008, 0),
    up: transform.up.clone(),
  }
}

function getFinalOrbitPose(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  narrowPortrait: boolean,
): CameraPose {
  const player = landingSiteToRenderTransform(playerSite)
  const rival = landingSiteToRenderTransform(rivalSite)
  const viewDirection = rival.up
    .clone()
    .multiplyScalar(0.82)
    .addScaledVector(player.up, 0.18)

  if (viewDirection.lengthSq() < 1e-10) {
    viewDirection.copy(rival.up)
  }

  const radius = narrowPortrait ? 4.7 : 3.65
  return {
    position: viewDirection.normalize().multiplyScalar(radius),
    target: new Vector3(0, 0, 0),
    up: WORLD_UP.clone(),
  }
}

export function createStrikeCameraPlan(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  aspect: number,
): StrikeCameraPlan {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('Strike camera aspect must be positive and finite.')
  }

  const narrowPortrait = aspect < 0.72
  const route = createStrikeRoute(playerSite, rivalSite)
  const armingPose = getPlayerSurfacePose(playerSite, narrowPortrait)
  const launchPose: CameraPose = {
    position: armingPose.position.clone().addScaledVector(
      landingSiteToRenderTransform(playerSite).east,
      narrowPortrait ? 0.006 : 0.009,
    ),
    target: armingPose.target.clone().addScaledVector(
      landingSiteToRenderTransform(playerSite).up,
      0.014,
    ),
    up: armingPose.up.clone(),
  }
  const flightTarget = route.getRenderPoint(0.54)
  const flightDirection = route.getDirection(0.54)
  const flightSide = flightDirection
    .clone()
    .cross(CINEMATIC_ARC_DIRECTION)

  if (flightSide.lengthSq() < 1e-10) {
    flightSide.set(0, 1, 0).cross(flightDirection)
  }

  flightSide.normalize()
  const flightStartTarget = route.getRenderPoint(0.08)
  const flightStartDirection = route.getDirection(0.08)
  const flightStartSide = flightStartDirection
    .clone()
    .cross(CINEMATIC_ARC_DIRECTION)

  if (flightStartSide.lengthSq() < 1e-10) {
    flightStartSide.set(0, 1, 0).cross(flightStartDirection)
  }

  flightStartSide.normalize()
  const flightStartPose: CameraPose = {
    position: flightStartTarget
      .clone()
      .addScaledVector(flightStartDirection, 0.14)
      .addScaledVector(flightStartSide, narrowPortrait ? 0.25 : 0.2),
    target: flightStartTarget.clone(),
    up: WORLD_UP.clone(),
  }
  const flightEndPose: CameraPose = {
    position: flightTarget
      .clone()
      .addScaledVector(flightDirection, 0.11)
      .addScaledVector(flightSide, narrowPortrait ? 0.23 : 0.18),
    target: flightTarget.clone(),
    up: WORLD_UP.clone(),
  }
  const transmissionTarget = route.getRenderPoint(0.76)
  const targetWidePose = getTargetWidePose(
    rivalSite,
    narrowPortrait,
    transmissionTarget,
  )
  const impactPose = getImpactPose(rivalSite, narrowPortrait)
  const finalOrbitPose = getFinalOrbitPose(
    playerSite,
    rivalSite,
    narrowPortrait,
  )
  const flightCamera = createSafeOrbitalCameraPath({
    start: flightStartPose,
    end: flightEndPose,
    minimumRadius: STRIKE_CAMERA_SAFETY.flightMinimumRadius,
    timing: 'balanced',
    preferredArcDirection: CINEMATIC_ARC_DIRECTION,
    arcHeight: 0.12,
  })
  const transmissionCamera = createSafeOrbitalCameraPath({
    start: flightEndPose,
    end: targetWidePose,
    minimumRadius: STRIKE_CAMERA_SAFETY.flightMinimumRadius,
    preferredArcDirection: CINEMATIC_ARC_DIRECTION,
    arcHeight: 0.08,
  })
  const targetApproachCamera = createSafeOrbitalCameraPath({
    start: targetWidePose,
    end: impactPose,
    minimumRadius: STRIKE_CAMERA_SAFETY.approachMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: landingSiteToRenderTransform(rivalSite).up,
  })
  const orbitalPullbackCamera = createSafeOrbitalCameraPath({
    start: impactPose,
    end: finalOrbitPose,
    minimumRadius: STRIKE_CAMERA_SAFETY.approachMinimumRadius,
    timing: 'climb-before-arc',
    preferredArcDirection: CINEMATIC_ARC_DIRECTION,
  })

  return {
    route,
    armingPose,
    launchPose,
    flightEndPose,
    targetWidePose,
    impactPose,
    finalOrbitPose,
    flightCamera,
    transmissionCamera,
    targetApproachCamera,
    orbitalPullbackCamera,
  }
}
