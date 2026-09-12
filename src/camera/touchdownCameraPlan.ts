import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS, LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { MathUtils, Vector3 } from 'three'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { createSafeOrbitalCameraPath, type CameraPose, type SafeOrbitalCameraPath } from './orbitalCameraPath.ts'

export interface TouchdownCameraTransition {
  readonly path: SafeOrbitalCameraPath
  readonly startFov: number
  readonly endFov: number
}

/** Snapshot both endpoints once. No live OrbitControls target belongs to this path. */
export function createTouchdownCameraTransition(
  start: CameraPose, end: CameraPose, startFov: number, endFov: number,
): TouchdownCameraTransition {
  return {
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
  transition.path.sample(p, position, target, up)
  return MathUtils.lerp(transition.startFov, transition.endFov, MathUtils.smoothstep(p, 0.45, 1))
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

