import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS, LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { CubicBezierCurve3, MathUtils, Vector3 } from 'three'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { createSafeOrbitalCameraPath, slerpUnitDirections, type CameraPose, type SafeOrbitalCameraPath } from './orbitalCameraPath.ts'

export interface TouchdownCameraTransition {
  readonly path: SafeOrbitalCameraPath
  readonly startFov: number
  readonly endFov: number
  readonly descent: CubicBezierCurve3 | null
}

/** Snapshot both endpoints once. No live OrbitControls target belongs to this path. */
export function createTouchdownCameraTransition(
  start: CameraPose, end: CameraPose, startFov: number, endFov: number,
): TouchdownCameraTransition {
  // Bowed descent from 94a28a0/551daff, with fixed endpoints and the newer
  // safe orbital fallback for far-side or extreme starting views.
  const east = new Vector3().crossVectors(new Vector3(0, 1, 0), end.up).normalize()
  if (east.lengthSq() < .5) east.set(1, 0, 0)
  const south = new Vector3().crossVectors(east, end.up).normalize()
  const curve = new CubicBezierCurve3(start.position.clone(),
    start.position.clone().lerp(end.up.clone().multiplyScalar(2.15), .46).addScaledVector(east, .08),
    end.up.clone().multiplyScalar(1.13).addScaledVector(east, .036).addScaledVector(south, .072), end.position.clone())
  const safe = curve.getPoints(256).every(point => point.length() > MOON_RENDER_RADIUS + .0001)
  return {
    descent: safe ? curve : null,
    path: createSafeOrbitalCameraPath({ start, end,
      minimumRadius: MOON_RENDER_RADIUS + 0.0001,
      timing: 'arc-before-descent', preferredArcDirection: end.up }),
    startFov, endFov,
  }
}

export function sampleTouchdownCamera(
  transition: TouchdownCameraTransition, progress: number,
  position: Vector3, target: Vector3, up: Vector3,
): number {
  const p = MathUtils.clamp(progress, 0, 1)
  // Arrive before the state handoff: the last .62 s holds the settled framing.
  const travel = Math.min(1, p / .9)
  if (transition.descent) {
    transition.descent.getPoint(MathUtils.smootherstep(travel, 0, 1), position)
    // Track the look-target closer to the position's own pace (was .72) so the
    // capsule reads as part of the shot as it arrives, instead of the camera
    // snapping fully onto the landing point while still well short of it.
    const aim = MathUtils.smoothstep(p / .86, 0, 1)
    target.copy(transition.path.start.target).lerp(transition.path.end.target, aim)
    slerpUnitDirections(transition.path.start.up, transition.path.end.up, aim, transition.path.end.up, up)
  } else transition.path.sample(travel, position, target, up)
  return MathUtils.lerp(transition.startFov, transition.endFov, MathUtils.smoothstep(p, 0.45, .9))
}

export function landingCameraBeat(progress: number) {
  return progress < .86 ? 'descent' : progress < .9 ? 'touchdown' : 'hold'
}

function localPointToWorld(site: LandingSite, x: number, y: number, z: number): Vector3 {
  const transform = landingSiteToRenderTransform(site)
  return new Vector3(x, y, z).applyQuaternion(transform.orientation).add(transform.position)
}

export function getSurfaceCameraPose(
  site: LandingSite,
  terrain: SurfaceTerrainProfile | null,
  terrainSegments: number,
  hasSilo = false,
): CameraPose {
  const transform = landingSiteToRenderTransform(site)
  // The higher silo view separates roofs from deposit hit areas and leaves
  // the foreground structure above the operations panel on portrait phones.
  const targetXM = 1.6
  const targetZM = hasSilo ? 11.5 : -7.5
  const targetGround =
    terrain === null
      ? LOCAL_SURFACE_RENDER_OFFSET
      : sampleRenderedSurface(
          terrain,
          terrainSegments,
          targetXM,
          targetZM,
        ).y

  const target = localPointToWorld(
    site,
    targetXM * LOCAL_METRES_TO_RENDER_UNITS,
    targetGround + 1.05 * LOCAL_METRES_TO_RENDER_UNITS,
    targetZM * LOCAL_METRES_TO_RENDER_UNITS,
  )
  const position = localPointToWorld(
    site, 0.00115, hasSilo ? 0.0056 : 0.00255, hasSilo ? 0.0078 : 0.0043,
  )
  return { position, target, up: transform.up.clone() }
}
