import { Vector3 } from 'three'
import type { LandingRenderTransform } from '../render/renderCoordinates.ts'

const PREVIOUS_MIN_SCALE = 0.0003
const PREVIOUS_MAX_SCALE = 0.026
const PREVIOUS_DISTANCE_SCALE = 0.013

export const LANDING_MARKER_DIAMETER_FACTOR = 1.5
export const LANDING_MARKER_SURFACE_OFFSET = 0.00055
export const LANDING_MARKER_OUTER_RING_Y = 0.042
export const LANDING_MARKER_OUTER_RING_TUBE_RADIUS = 0.045
export const LANDING_MARKER_MAX_SCALE =
  PREVIOUS_MAX_SCALE * LANDING_MARKER_DIAMETER_FACTOR

const LANDING_MARKER_MIN_SCALE =
  PREVIOUS_MIN_SCALE * LANDING_MARKER_DIAMETER_FACTOR
const LANDING_MARKER_DISTANCE_SCALE =
  PREVIOUS_DISTANCE_SCALE * LANDING_MARKER_DIAMETER_FACTOR
const LANDING_MARKER_PULSE_SPEED = 1.55

export function getLandingMarkerPosition(
  transform: LandingRenderTransform,
): Vector3 {
  return transform.position
    .clone()
    .addScaledVector(transform.up, LANDING_MARKER_SURFACE_OFFSET)
}

export function getLandingMarkerScale(cameraDistance: number): number {
  return Math.min(
    LANDING_MARKER_MAX_SCALE,
    Math.max(
      LANDING_MARKER_MIN_SCALE,
      cameraDistance * LANDING_MARKER_DISTANCE_SCALE,
    ),
  )
}

export function getLandingMarkerOuterPulse(elapsedSeconds: number): number {
  return 1.01 + Math.sin(elapsedSeconds * LANDING_MARKER_PULSE_SPEED) * 0.03
}
