import type { InterceptorContact } from '../simulation/interceptorCollision.ts'
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
import {
  createCounterstrikeImpactFrame,
  createCounterstrikeRoute,
  createInterceptorRoute,
  type CounterstrikeImpactFrame,
  type CounterstrikeRoute,
} from './counterstrikeRoute.ts'
import { createStrikeCameraPlan } from './strikeCameraPlan.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import {
  createSurfaceTerrainProfile,
  sampleTerrainHeightM,
} from '../render/surfaceTerrain.ts'

const SUN_DIRECTION = new Vector3(4.6, 2.6, 3.4).normalize()
const WORLD_UP = new Vector3(0, 1, 0)
const COUNTERSTRIKE_CAMERA_ARC = new Vector3(-0.42, 0.76, 0.5).normalize()

export const COUNTERSTRIKE_CAMERA_SAFETY = Object.freeze({
  orbitalMinimumRadius: MOON_RENDER_RADIUS + 0.09,
  interceptMinimumRadius: MOON_RENDER_RADIUS + 0.075,
  // The terminal shots sit low over the outpost so the horizon and sky frame
  // the hit. Every impact pose is authored relative to the rendered relief
  // beneath it and keeps at least this much eye clearance above it.
  damageSurfaceClearanceM: 3,
  // Absolute floor above the offset surface datum, for any relief.
  damageMinimumRadius:
    MOON_RENDER_RADIUS +
    LOCAL_SURFACE_RENDER_OFFSET +
    3 * LOCAL_METRES_TO_RENDER_UNITS,
  sampleCount: 2_048,
})

export interface CounterstrikeCameraPlan {
  readonly route: CounterstrikeRoute
  readonly impactFrame: CounterstrikeImpactFrame
  readonly launchPose: CameraPose
  readonly trackingPose: CameraPose
  readonly interceptPose: CameraPose
  readonly successPose: CameraPose
  readonly impactWidePose: CameraPose
  readonly impactMediumPose: CameraPose
  readonly damagePose: CameraPose
  readonly warningCamera: SafeOrbitalCameraPath
  readonly interceptorRail: readonly CameraPose[]
  readonly successCamera: SafeOrbitalCameraPath
}

export type CounterstrikeImpactCameraBeat =
  | 'wide'
  | 'medium'
  | 'contact'
  | 'damage-reveal'
  | 'damage-hold'

const impactProgress = (elapsedMs: number) =>
  elapsedMs / COUNTERSTRIKE_TIMING.impactMs

/**
 * INCOMING → CONTACT → IMPACT → DAMAGE REVEAL inside the impact status. The
 * camera pushes in while the warhead converges, is nearly settled at contact,
 * keeps a slow drift through the blast, then rises into the damage framing
 * that the resolved ending holds. No beat is a static frame for more than the
 * short final settle.
 */
export const COUNTERSTRIKE_IMPACT_CAMERA_TIMING = Object.freeze({
  wideHoldEndProgress: impactProgress(700),
  contactProgress:
    COUNTERSTRIKE_TIMING.impactContactMs / COUNTERSTRIKE_TIMING.impactMs,
  mediumHoldEndProgress: impactProgress(2_600),
  damageArrivalProgress: impactProgress(4_100),
  contactImpulseMs: 420,
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

/**
 * A bounded jolt at warhead contact, in local metres: a decaying translation
 * of camera and target together (no zoom, roll or accumulation), following the
 * wave-defense shake. Reduced motion removes it.
 */
export function sampleCounterstrikeContactImpulseM(
  elapsedSinceContactMs: number,
  reducedMotion: boolean,
): number {
  const t = elapsedSinceContactMs / COUNTERSTRIKE_IMPACT_CAMERA_TIMING.contactImpulseMs
  if (reducedMotion || !(t > 0) || t >= 1) return 0
  return Math.sin(t * Math.PI * 5) * (1 - t) ** 2 * 0.42
}

const temporaryImpulse = new Vector3()

export function sampleCounterstrikeImpactCamera(
  plan: CounterstrikeCameraPlan,
  progress: number,
  position: Vector3,
  target: Vector3,
  up: Vector3,
  reducedMotion = false,
): CounterstrikeImpactCameraBeat {
  const clamped = MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
  const timing = COUNTERSTRIKE_IMPACT_CAMERA_TIMING

  // All three poses sit a few metres over the outpost relief; straight
  // interpolation keeps the eye above it (see the terrain clearance tests).
  if (clamped < timing.mediumHoldEndProgress) {
    // Decelerating push: most of the move is spent before contact; a linear
    // share keeps a slow drift through the blast, so the composition never
    // settles before the reveal takes over.
    const pushProgress = clamped / timing.mediumHoldEndProgress
    const push = 0.85 * (1 - (1 - pushProgress) ** 3) + 0.15 * pushProgress
    position.lerpVectors(plan.impactWidePose.position, plan.impactMediumPose.position, push)
    target.lerpVectors(plan.impactWidePose.target, plan.impactMediumPose.target, push)
  } else {
    // The rise leaves with some of the drift's momentum and lands at rest on
    // the damage framing that the resolved ending keeps.
    const u = rangeProgress(clamped, timing.mediumHoldEndProgress, timing.damageArrivalProgress)
    const reveal = 0.35 * u * (1 - u) ** 2 + u * u * (3 - 2 * u)
    position.lerpVectors(plan.impactMediumPose.position, plan.damagePose.position, reveal)
    target.lerpVectors(plan.impactMediumPose.target, plan.damagePose.target, reveal)
  }
  up.copy(plan.impactFrame.up)

  const impulseM = sampleCounterstrikeContactImpulseM(
    (clamped - timing.contactProgress) * COUNTERSTRIKE_TIMING.impactMs,
    reducedMotion,
  )
  if (impulseM !== 0) {
    temporaryImpulse
      .copy(up)
      .multiplyScalar(impulseM)
      .addScaledVector(plan.impactFrame.side, impulseM * 0.45)
      .multiplyScalar(LOCAL_METRES_TO_RENDER_UNITS)
    position.add(temporaryImpulse)
    target.add(temporaryImpulse)
  }

  return getCounterstrikeImpactCameraBeat(clamped)
}

/**
 * Close impact framing in the impact frame: the eye (metres beyond the hit,
 * toward the sun side, and height above the rendered relief) and where a
 * subject (the contact point) must sit on screen, in NDC. The camera looks
 * back across the hit at the extractor and lander, so the contact, the base
 * and the horizon stack vertically on narrow phones and spread on desktop.
 * The damage framing keeps the crater and the damaged extractor above the
 * resolved ending card, which fills the lower half of the viewport.
 */
export const COUNTERSTRIKE_IMPACT_FRAMING = Object.freeze({
  narrow: Object.freeze({
    wide: Object.freeze({ camera: [35, 14, 6.5], screen: [0.26, -0.28] }),
    medium: Object.freeze({ camera: [27, 11.5, 4.8], screen: [0.3, -0.26] }),
    damage: Object.freeze({ camera: [30, 12, 7], screen: [0.12, 0.16] }),
  }),
  wide: Object.freeze({
    wide: Object.freeze({ camera: [35, 17, 6.5], screen: [0.12, -0.44] }),
    medium: Object.freeze({ camera: [27, 14, 4.8], screen: [0.14, -0.28] }),
    damage: Object.freeze({ camera: [30, 14, 7], screen: [0.1, 0.18] }),
  }),
})

type FramingPose = { readonly camera: readonly number[]; readonly screen: readonly number[] }

/**
 * Roll-free aim that places `subject` at the requested NDC position for this
 * projection, so a composition holds across aspect ratios.
 */
function aimAtScreen(
  position: Vector3,
  subject: Vector3,
  up: Vector3,
  screenX: number,
  screenY: number,
  fovDeg: number,
  aspect: number,
): Vector3 {
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2)
  const toSubject = subject.clone().sub(position)
  const distance = toSubject.length()
  const forward = toSubject.normalize()
  const right = forward.clone().cross(up).normalize()
  forward
    .applyAxisAngle(right, -Math.atan(screenY * tanV))
    .applyAxisAngle(up, Math.atan(screenX * tanV * aspect))
  return position.clone().addScaledVector(forward, distance)
}

/** Vertical field of view for the close impact and resolved damage shots. */
export const COUNTERSTRIKE_IMPACT_PROJECTION = Object.freeze({
  narrowFov: 46,
  wideFov: 38,
  near: 0.00018,
  // Far enough to include the starfield above the lunar horizon.
  far: 64,
})

export function getCounterstrikeImpactFov(aspect: number): number {
  return aspect < 0.72
    ? COUNTERSTRIKE_IMPACT_PROJECTION.narrowFov
    : COUNTERSTRIKE_IMPACT_PROJECTION.wideFov
}

export function createCounterstrikeCameraPlan(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  secondaryImpactSite: LandingSite,
  aspect: number,
  interceptRouteProgress = 0.7,
  threatProgressStart = Math.max(0.12, interceptRouteProgress - 0.07),
  contact: InterceptorContact | null = null,
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
  // Author a rail in the engagement's own basis. No orbit-control position or
  // velocity enters this shot. Precompute framing so sampling allocates nothing.
  const flightAxis = interceptPoint.clone().sub(interceptorRoute.getRenderPoint(0.97)).normalize()
  const radial = interceptPoint.clone().normalize()
  const side = player.up.clone().cross(radial).normalize()
  const arrivalView = radial.clone().multiplyScalar(0.8).addScaledVector(side, 0.6).normalize()
  const tanY = Math.tan(MathUtils.degToRad(narrow ? 56 : 40) / 2)
  const interceptorRail: CameraPose[] = []
  for (let index = 0; index <= 160; index++) {
    const t = (index / 160) * (contact?.flightProgress ?? 1)
    const travel = t * t * (3 - 2 * t)
    const interceptor = interceptorRoute.getRenderPoint(travel)
    const threat = route.getRenderPoint(MathUtils.lerp(threatProgressStart, interceptRouteProgress, t))
    const forward = threat.clone().sub(interceptor)
    if (forward.lengthSq() < 1e-10) forward.copy(flightAxis)
    forward.normalize()
    const localUp = interceptor.clone().normalize()
    const tangent = forward.clone().addScaledVector(localUp, -forward.dot(localUp)).normalize()
    const chaseHeight = MathUtils.lerp(0.27, 0.075, MathUtils.smoothstep(interceptRouteProgress, 0.445, 0.825))
    const chasePosition = interceptor.clone().addScaledVector(tangent, -0.2)
      .addScaledVector(localUp, chaseHeight).addScaledVector(side, 0.012)
    // Bisect the two sightlines rather than their world-space separation. This
    // keeps the nearby vehicle large while allowing the distant threat above it.
    const aim = interceptor.clone().sub(chasePosition).normalize()
      .add(threat.clone().sub(chasePosition).normalize()).normalize()
    const chaseTarget = chasePosition.clone().addScaledVector(aim, chasePosition.distanceTo(interceptor))
    const railBlend = MathUtils.smootherstep(t, 0.12, 0.86)
    const view = aim.negate().lerp(arrivalView, railBlend).normalize()
    const target = chaseTarget.lerp(interceptor.clone().lerp(threat, 0.5), railBlend)
    const up = localUp.lerp(flightAxis, railBlend)
      .addScaledVector(view, -localUp.dot(view)).normalize()
      .applyAxisAngle(view, Math.sin(t * Math.PI) * 0.035)
    const right = up.clone().cross(view).normalize()
    let distance = MathUtils.lerp(chasePosition.distanceTo(interceptor), 0.19, railBlend)
    for (const point of [interceptor, threat]) {
      const offset = point.clone().sub(target)
      const margin = MathUtils.lerp(0.024, 0.045, railBlend)
      distance = Math.max(distance, offset.dot(view) + Math.max(
        (Math.abs(offset.dot(right)) + margin) / (tanY * aspect * 0.74),
        (Math.abs(offset.dot(up)) + margin) / (tanY * 0.65),
      ))
    }
    const position = target.clone().addScaledVector(view, distance)
    // Back away along the sightline until the camera is clear of the Moon.
    // The target is above the surface, so the positive sphere exit is safe.
    const minimum = COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius + 0.002
    if (position.length() < minimum) {
      const dot = target.dot(view)
      distance = -dot + Math.sqrt(dot * dot + minimum * minimum - target.lengthSq())
      position.copy(target).addScaledVector(view, distance)
    }
    interceptorRail.push({ position, target, up })
  }
  const interceptPose = interceptorRail[interceptorRail.length - 1]!
  // Return to a readable lunar/outpost orbit, with collision and outpost both
  // inside the final composition; this is also the restored success view.
  const successTarget = player.position.clone().lerp(interceptPoint, 0.45)
  const successPose: CameraPose = {
    position: player.up.clone().add(radial).normalize().multiplyScalar(narrow ? 3.5 : 3.2)
      .addScaledVector(side, 0.3),
    target: successTarget,
    up: flightAxis.clone(),
  }
  const impactFrame = createCounterstrikeImpactFrame(playerSite, secondaryImpactSite)
  const terrain = createSurfaceTerrainProfile(playerSite)
  const reliefBelow = (point: Vector3) => {
    const offset = point.clone().sub(impactFrame.origin)
    return sampleTerrainHeightM(
      terrain,
      offset.dot(impactFrame.east) / LOCAL_METRES_TO_RENDER_UNITS,
      offset.dot(impactFrame.south) / LOCAL_METRES_TO_RENDER_UNITS,
    )
  }
  const framing = narrow
    ? COUNTERSTRIKE_IMPACT_FRAMING.narrow
    : COUNTERSTRIKE_IMPACT_FRAMING.wide
  const impactFov = getCounterstrikeImpactFov(aspect)
  // `side` follows the sun, so the frame can be mirrored; mirror the screen
  // placement with it to keep the outpost on the same side of the hit.
  const handedness =
    impactFrame.side.dot(impactFrame.axis.clone().cross(impactFrame.up)) >= 0 ? 1 : -1
  const framedPose = ({ camera, screen }: FramingPose): CameraPose => {
    const position = impactFrame.at(camera[0]!, camera[1]!, 0)
    position.addScaledVector(
      impactFrame.up,
      (Math.max(0, reliefBelow(position)) + camera[2]!) *
        LOCAL_METRES_TO_RENDER_UNITS,
    )
    return {
      position,
      target: aimAtScreen(
        position,
        impactFrame.impact,
        impactFrame.up,
        screen[0]! * handedness,
        screen[1]!,
        impactFov,
        aspect,
      ),
      up: impactFrame.up.clone(),
    }
  }
  const impactWidePose = framedPose(framing.wide)
  const impactMediumPose = framedPose(framing.medium)
  const damagePose = framedPose(framing.damage)
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
  const successCamera = createSafeOrbitalCameraPath({
    start: interceptPose,
    end: successPose,
    minimumRadius: COUNTERSTRIKE_CAMERA_SAFETY.interceptMinimumRadius,
    timing: 'climb-before-arc',
    preferredArcDirection: COUNTERSTRIKE_CAMERA_ARC,
  })

  return {
    route,
    impactFrame,
    launchPose,
    trackingPose,
    interceptPose,
    successPose,
    impactWidePose,
    impactMediumPose,
    damagePose,
    warningCamera,
    interceptorRail,
    successCamera,
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
): 'interceptor-chase' | 'interception-approach' | 'interception-hold' | 'interception-pullback' {
  const clamped = MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
  if (status === 'interceptor-launched') {
    const index = clamped * (plan.interceptorRail.length - 1)
    const first = plan.interceptorRail[Math.floor(index)]!
    const second = plan.interceptorRail[Math.min(Math.floor(index) + 1, plan.interceptorRail.length - 1)]!
    const t = index - Math.floor(index)
    position.lerpVectors(first.position, second.position, t)
    target.lerpVectors(first.target, second.target, t)
    up.lerpVectors(first.up, second.up, t).normalize()
    return clamped < 0.25 ? 'interceptor-chase' : 'interception-approach'
  }
  const hold = COUNTERSTRIKE_INTERCEPTION_HOLD_MS / COUNTERSTRIKE_TIMING.successMs
  if (clamped <= hold) {
    position.copy(plan.interceptPose.position)
    target.copy(plan.interceptPose.target)
    up.copy(plan.interceptPose.up)
    return 'interception-hold'
  }
  plan.successCamera.sample(rangeProgress(clamped, hold, 1), position, target, up)
  return 'interception-pullback'
}
