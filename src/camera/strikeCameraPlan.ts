import { MathUtils, Vector3 } from 'three'
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

/**
 * Vertical FOVs CameraRig applies to the surface beats (arming through crater
 * reveal) and to the pullback/ending. The narrow-portrait pullback start is
 * dollied in by their tangent ratio so the crater keeps its size across the cut.
 */
export const STRIKE_PROJECTION_FOV = Object.freeze({
  narrowPortrait: Object.freeze({ close: 38, orbital: 56, pullback: 58 }),
  landscape: Object.freeze({ close: 34, orbital: 40, pullback: 42 }),
})

const PORTRAIT_ENDING = Object.freeze({
  radius: 3.8,
  leanWest: 0.22,
  leanNorth: 0.1,
  /** Where the Moon's centre lands vertically, in NDC, at the ending. */
  moonCentreNdcY: -0.6,
})

export interface StrikeCameraPlan {
  readonly route: StrikeRoute
  readonly armingPose: CameraPose
  readonly launchPose: CameraPose
  readonly flightEndPose: CameraPose
  readonly targetWidePose: CameraPose
  readonly impactPose: CameraPose
  readonly craterRevealPose: CameraPose
  readonly scarExplorePose: CameraPose
  readonly finalOrbitPose: CameraPose
  readonly flightCamera: SafeOrbitalCameraPath
  readonly transmissionCamera: SafeOrbitalCameraPath
  readonly targetApproachCamera: SafeOrbitalCameraPath
  readonly craterRevealCamera: SafeOrbitalCameraPath
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
      narrowPortrait ? 0.0075 : 0.01,
      narrowPortrait ? 0.0225 : 0.0195,
      narrowPortrait ? 0.013 : 0.016,
    ),
    target: localPointToWorld(playerSite, 0, 0.004, 0),
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

/**
 * Narrow portrait sees only ~18 degrees across at the close FOV, so the impact
 * pose shows fragments of the rim. The reveal climbs to a steeper, wider
 * framing that holds the whole crater plus untouched terrain. Landscape
 * already frames it and keeps the impact pose.
 */
function getCraterRevealPose(
  rivalSite: LandingSite,
  narrowPortrait: boolean,
  impactPose: CameraPose,
): CameraPose {
  if (!narrowPortrait) {
    return impactPose
  }

  const transform = landingSiteToRenderTransform(rivalSite)
  return {
    position: localPointToWorld(rivalSite, 0.13, 0.38, 0.26),
    target: localPointToWorld(rivalSite, 0, 0.004, 0),
    up: transform.up.clone(),
  }
}

/**
 * The pullback opens on a wider FOV than the crater reveal. In narrow portrait
 * that cut shrinks the crater to ~60%, so the pullback starts dollied in along
 * the same sight line until the crater holds its framing.
 */
function getPullbackStartPose(
  craterRevealPose: CameraPose,
  narrowPortrait: boolean,
): CameraPose {
  if (!narrowPortrait) {
    return craterRevealPose
  }

  const fov = STRIKE_PROJECTION_FOV.narrowPortrait
  const dolly =
    Math.tan(MathUtils.degToRad(fov.close / 2)) /
    Math.tan(MathUtils.degToRad(fov.pullback / 2))
  return {
    position: craterRevealPose.target
      .clone()
      .lerp(craterRevealPose.position, dolly),
    target: craterRevealPose.target.clone(),
    up: craterRevealPose.up.clone(),
  }
}

function getScarExplorePose(
  rivalSite: LandingSite,
  narrowPortrait: boolean,
): CameraPose {
  const transform = landingSiteToRenderTransform(rivalSite)
  return {
    position: localPointToWorld(
      rivalSite,
      narrowPortrait ? 0.17 : 0.2,
      narrowPortrait ? 0.34 : 0.25,
      narrowPortrait ? 0.43 : 0.38,
    ),
    target: localPointToWorld(rivalSite, 0, 0.001, 0),
    up: transform.up.clone(),
  }
}

/**
 * Narrow portrait centres the end card over the middle of the frame. Look down
 * on the scar itself, leaning toward its rake-lit west side and a little north,
 * with a larger Moon aimed low so the lit limb and the scar fill the open frame
 * beneath the card.
 */
function getNarrowPortraitFinalOrbitPose(rivalSite: LandingSite): CameraPose {
  const rival = landingSiteToRenderTransform(rivalSite)
  const viewDirection = rival.up
    .clone()
    .addScaledVector(rival.east, -PORTRAIT_ENDING.leanWest)
    .addScaledVector(rival.south, -PORTRAIT_ENDING.leanNorth)
    .normalize()
  const target = new Vector3(0, 0, 0)
  const screenUp = WORLD_UP.clone().addScaledVector(
    viewDirection,
    -WORLD_UP.dot(viewDirection),
  )

  if (screenUp.lengthSq() > 1e-6) {
    target.addScaledVector(
      screenUp.normalize(),
      -PORTRAIT_ENDING.moonCentreNdcY *
        PORTRAIT_ENDING.radius *
        Math.tan(
          MathUtils.degToRad(STRIKE_PROJECTION_FOV.narrowPortrait.pullback / 2),
        ),
    )
  }

  return {
    position: viewDirection.multiplyScalar(PORTRAIT_ENDING.radius),
    target,
    up: WORLD_UP.clone(),
  }
}

function getFinalOrbitPose(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  narrowPortrait: boolean,
): CameraPose {
  if (narrowPortrait) {
    return getNarrowPortraitFinalOrbitPose(rivalSite)
  }

  const player = landingSiteToRenderTransform(playerSite)
  const rival = landingSiteToRenderTransform(rivalSite)
  const viewDirection = rival.up
    .clone()
    .multiplyScalar(0.82)
    .addScaledVector(player.up, 0.18)

  if (viewDirection.lengthSq() < 1e-10) {
    viewDirection.copy(rival.up)
  }

  return {
    position: viewDirection.normalize().multiplyScalar(3.65),
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
      narrowPortrait ? 0.001 : 0.002,
    ),
    target: armingPose.target.clone().addScaledVector(
      landingSiteToRenderTransform(playerSite).up,
      0.006,
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
  const craterRevealPose = getCraterRevealPose(
    rivalSite,
    narrowPortrait,
    impactPose,
  )
  const scarExplorePose = getScarExplorePose(rivalSite, narrowPortrait)
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
  const craterRevealCamera = createSafeOrbitalCameraPath({
    start: impactPose,
    end: craterRevealPose,
    minimumRadius: STRIKE_CAMERA_SAFETY.approachMinimumRadius,
  })
  const orbitalPullbackCamera = createSafeOrbitalCameraPath({
    start: getPullbackStartPose(craterRevealPose, narrowPortrait),
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
    craterRevealPose,
    scarExplorePose,
    finalOrbitPose,
    flightCamera,
    transmissionCamera,
    targetApproachCamera,
    craterRevealCamera,
    orbitalPullbackCamera,
  }
}
