import { Vector3 } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  MOON_RENDER_RADIUS,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import {
  createIlluminatedArcWaypoint,
  createSafeOrbitalCameraPath,
  slerpUnitDirections,
  type CameraPose,
  type SafeOrbitalCameraPath,
} from './orbitalCameraPath.ts'

const WORLD_UP = new Vector3(0, 1, 0)
const ORBIT_TARGET = new Vector3(0, 0, 0)
const CINEMATIC_LIGHT_DIRECTION = new Vector3(4.6, 2.6, 3.4).normalize()
const DIRECTION_EPSILON = 1e-10

export const RIVAL_CAMERA_SAFETY = Object.freeze({
  moonRadius: MOON_RENDER_RADIUS,
  orbitalMinimumRadius: MOON_RENDER_RADIUS + 0.38,
  approachMinimumRadius: MOON_RENDER_RADIUS + 0.09,
  surfaceMinimumRadius: MOON_RENDER_RADIUS + 0.006,
  sampleCount: 1_024,
})

export interface RivalCameraFraming {
  readonly narrowPortrait: boolean
  readonly wideRadius: number
  readonly orbitalFov: number
  readonly approachFov: number
  readonly surfaceFov: number
}

export interface RivalRevealCameraPlan {
  readonly framing: RivalCameraFraming
  readonly playerWidePose: CameraPose
  readonly rivalWidePose: CameraPose
  readonly rivalApproachPose: CameraPose
  readonly rivalSurfacePose: CameraPose
  readonly dualSitePose: CameraPose
  readonly orbitalTransition: SafeOrbitalCameraPath
  readonly capsuleApproach: SafeOrbitalCameraPath
  readonly impact: SafeOrbitalCameraPath
  readonly dualSites: SafeOrbitalCameraPath
}

function isNarrowPortrait(aspect: number): boolean {
  return aspect < 0.72
}

export function getRivalCameraFraming(aspect: number): RivalCameraFraming {
  const narrowPortrait = isNarrowPortrait(aspect)

  return {
    narrowPortrait,
    wideRadius: narrowPortrait ? 4.7 : 3.65,
    orbitalFov: narrowPortrait ? 58 : 42,
    approachFov: narrowPortrait ? 50 : 39,
    surfaceFov: narrowPortrait ? 48 : 38,
  }
}

function localPointToWorld(
  site: LandingSite,
  x: number,
  y: number,
  z: number,
): Vector3 {
  const transform = landingSiteToRenderTransform(site)

  return transform.position
    .clone()
    .addScaledVector(transform.east, x)
    .addScaledVector(transform.up, y)
    .addScaledVector(transform.south, z)
}

function getWidePose(
  site: LandingSite,
  radius: number,
  eastOffsetRatio: number,
  southOffsetRatio: number,
): CameraPose {
  const transform = landingSiteToRenderTransform(site)
  const position = transform.up
    .clone()
    .multiplyScalar(radius)
    .addScaledVector(transform.east, radius * eastOffsetRatio)
    .addScaledVector(transform.south, radius * southOffsetRatio)
    .setLength(radius)

  return {
    position,
    target: ORBIT_TARGET.clone(),
    up: WORLD_UP.clone(),
  }
}

function getRivalApproachPose(
  site: LandingSite,
  framing: RivalCameraFraming,
): CameraPose {
  if (framing.narrowPortrait) {
    return {
      position: localPointToWorld(site, 0.06, 0.14, 0.1),
      target: localPointToWorld(site, -0.003, 0.018, -0.006),
      up: landingSiteToRenderTransform(site).up.clone(),
    }
  }

  return {
    position: localPointToWorld(site, 0.05, 0.115, 0.08),
    target: localPointToWorld(site, -0.003, 0.016, -0.006),
    up: landingSiteToRenderTransform(site).up.clone(),
  }
}

export function getRivalSurfaceCameraPose(site: LandingSite): CameraPose {
  const transform = landingSiteToRenderTransform(site)

  return {
    position: localPointToWorld(site, 0.0065, 0.0095, 0.0195),
    target: localPointToWorld(site, 0, 0.00065, 0),
    up: transform.up.clone(),
  }
}

/**
 * The bisector sees both sites near opposite limbs. Exact antipodes use a
 * deterministic illuminated perpendicular because their algebraic sum is zero.
 */
export function getDualSiteViewDirection(
  playerDirection: Vector3,
  rivalDirection: Vector3,
  illuminatedDirection = CINEMATIC_LIGHT_DIRECTION,
): Vector3 {
  const player = playerDirection.clone().normalize()
  const rival = rivalDirection.clone().normalize()
  const midpoint = player.clone().add(rival)

  if (midpoint.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON) {
    return midpoint.normalize()
  }

  const projectedLight = illuminatedDirection
    .clone()
    .addScaledVector(player, -illuminatedDirection.dot(player))

  if (projectedLight.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON) {
    return projectedLight.normalize()
  }

  return slerpUnitDirections(
    player,
    rival,
    0.5,
    new Vector3(0, 1, 0),
  )
}

function getDualSitePose(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  framing: RivalCameraFraming,
): CameraPose {
  const player = landingSiteToRenderTransform(playerSite)
  const rival = landingSiteToRenderTransform(rivalSite)
  const viewDirection = getDualSiteViewDirection(player.up, rival.up)
  const oppositionAxis = rival.up.clone().cross(player.up)

  if (oppositionAxis.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON) {
    oppositionAxis.normalize()
    viewDirection
      .addScaledVector(oppositionAxis, framing.narrowPortrait ? 0.045 : 0.065)
      .normalize()
  }

  return {
    position: viewDirection.multiplyScalar(framing.wideRadius),
    target: ORBIT_TARGET.clone(),
    up: WORLD_UP.clone(),
  }
}

export function createRivalRevealCameraPlan(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  aspect: number,
): RivalRevealCameraPlan {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('Camera aspect must be positive and finite.')
  }

  const framing = getRivalCameraFraming(aspect)
  const playerWidePose = getWidePose(
    playerSite,
    framing.wideRadius,
    0.075,
    0.038,
  )
  const rivalWidePose = getWidePose(
    rivalSite,
    framing.wideRadius,
    -0.065,
    0.032,
  )
  const rivalApproachPose = getRivalApproachPose(rivalSite, framing)
  const rivalSurfacePose = getRivalSurfaceCameraPose(rivalSite)
  const dualSitePose = getDualSitePose(playerSite, rivalSite, framing)
  const illuminatedWaypoint = createIlluminatedArcWaypoint(
    playerWidePose.position,
    rivalWidePose.position,
    CINEMATIC_LIGHT_DIRECTION,
  )
  const orbitalTransition = createSafeOrbitalCameraPath({
    start: playerWidePose,
    end: rivalWidePose,
    minimumRadius: RIVAL_CAMERA_SAFETY.orbitalMinimumRadius,
    preferredArcDirection: CINEMATIC_LIGHT_DIRECTION,
    waypointDirection: illuminatedWaypoint,
  })
  const capsuleApproach = createSafeOrbitalCameraPath({
    start: rivalWidePose,
    end: rivalApproachPose,
    minimumRadius: RIVAL_CAMERA_SAFETY.approachMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: CINEMATIC_LIGHT_DIRECTION,
  })
  const impact = createSafeOrbitalCameraPath({
    start: rivalApproachPose,
    end: rivalSurfacePose,
    minimumRadius: RIVAL_CAMERA_SAFETY.surfaceMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: landingSiteToRenderTransform(rivalSite).up,
  })
  const dualSites = createSafeOrbitalCameraPath({
    start: rivalSurfacePose,
    end: dualSitePose,
    minimumRadius: RIVAL_CAMERA_SAFETY.surfaceMinimumRadius,
    timing: 'climb-before-arc',
    preferredArcDirection: CINEMATIC_LIGHT_DIRECTION,
  })

  return {
    framing,
    playerWidePose,
    rivalWidePose,
    rivalApproachPose,
    rivalSurfacePose,
    dualSitePose,
    orbitalTransition,
    capsuleApproach,
    impact,
    dualSites,
  }
}

export function createRivalFocusCameraPath(
  start: CameraPose,
  plan: RivalRevealCameraPlan,
): SafeOrbitalCameraPath {
  return createSafeOrbitalCameraPath({
    start,
    end: plan.rivalSurfacePose,
    minimumRadius: RIVAL_CAMERA_SAFETY.surfaceMinimumRadius,
    timing: 'arc-before-descent',
    preferredArcDirection: CINEMATIC_LIGHT_DIRECTION,
  })
}

export function createRivalReturnToOrbitCameraPath(
  start: CameraPose,
  plan: RivalRevealCameraPlan,
): SafeOrbitalCameraPath {
  return createSafeOrbitalCameraPath({
    start,
    end: plan.dualSitePose,
    minimumRadius: RIVAL_CAMERA_SAFETY.surfaceMinimumRadius,
    timing: 'climb-before-arc',
    preferredArcDirection: CINEMATIC_LIGHT_DIRECTION,
  })
}

export function cameraPoseApproximatelyEquals(
  first: CameraPose,
  second: CameraPose,
  epsilon = 1e-10,
): boolean {
  return (
    first.position.distanceTo(second.position) <= epsilon &&
    first.target.distanceTo(second.target) <= epsilon &&
    first.up.angleTo(second.up) <= Math.sqrt(epsilon)
  )
}
