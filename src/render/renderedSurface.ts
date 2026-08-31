import { LOCAL_SURFACE_HALF_SIZE_M } from './localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceRenderSample,
  type SurfaceTerrainProfile,
} from './surfaceTerrain.ts'

function clampToPatch(valueM: number): number {
  return Math.max(
    -LOCAL_SURFACE_HALF_SIZE_M,
    Math.min(LOCAL_SURFACE_HALF_SIZE_M, valueM),
  )
}

/**
 * Samples the actual triangle plane rendered by SurfacePatch. Attachments use
 * this instead of the continuous terrain function so feet and foundations do
 * not intersect the coarser production mesh.
 */
export function sampleRenderedSurface(
  terrain: SurfaceTerrainProfile,
  segments: number,
  xM: number,
  zM: number,
): SurfaceRenderSample {
  const safeSegments = Math.max(1, Math.floor(segments))
  const clampedXM = clampToPatch(xM)
  const clampedZM = clampToPatch(zM)
  const normalizedX =
    ((clampedXM + LOCAL_SURFACE_HALF_SIZE_M) /
      (LOCAL_SURFACE_HALF_SIZE_M * 2)) *
    safeSegments
  const normalizedZ =
    ((clampedZM + LOCAL_SURFACE_HALF_SIZE_M) /
      (LOCAL_SURFACE_HALF_SIZE_M * 2)) *
    safeSegments
  const column = Math.min(safeSegments - 1, Math.floor(normalizedX))
  const row = Math.min(safeSegments - 1, Math.floor(normalizedZ))
  const fractionX = Math.min(1, Math.max(0, normalizedX - column))
  const fractionZ = Math.min(1, Math.max(0, normalizedZ - row))
  const cellSizeM = (LOCAL_SURFACE_HALF_SIZE_M * 2) / safeSegments
  const x0M = -LOCAL_SURFACE_HALF_SIZE_M + column * cellSizeM
  const z0M = -LOCAL_SURFACE_HALF_SIZE_M + row * cellSizeM
  const topLeft = localSurfaceToRender(terrain, x0M, z0M)
  const topRight = localSurfaceToRender(terrain, x0M + cellSizeM, z0M)
  const bottomLeft = localSurfaceToRender(terrain, x0M, z0M + cellSizeM)
  const bottomRight = localSurfaceToRender(
    terrain,
    x0M + cellSizeM,
    z0M + cellSizeM,
  )

  let y: number

  if (fractionX + fractionZ <= 1) {
    y =
      topLeft.y +
      fractionX * (topRight.y - topLeft.y) +
      fractionZ * (bottomLeft.y - topLeft.y)
  } else {
    y =
      bottomRight.y +
      (1 - fractionZ) * (topRight.y - bottomRight.y) +
      (1 - fractionX) * (bottomLeft.y - bottomRight.y)
  }

  return {
    x:
      topLeft.x +
      fractionX * (topRight.x - topLeft.x),
    y,
    z:
      topLeft.z +
      fractionZ * (bottomLeft.z - topLeft.z),
  }
}

export function maximumRenderedSurfaceHeight(
  terrain: SurfaceTerrainProfile,
  segments: number,
  pointsM: readonly Readonly<{ xM: number; zM: number }>[],
): number {
  return pointsM.reduce(
    (maximum, point) =>
      Math.max(
        maximum,
        sampleRenderedSurface(terrain, segments, point.xM, point.zM).y,
      ),
    Number.NEGATIVE_INFINITY,
  )
}
