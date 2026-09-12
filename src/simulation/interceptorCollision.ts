import { Vector3 } from 'three'
import type { LandingSite, Vec3 } from '../domain/lunarCoordinates.ts'
import { createCounterstrikeRoute, createInterceptorRoute } from '../camera/counterstrikeRoute.ts'
import type { CounterstrikeRunState } from './counterstrikeSimulation.ts'

// Enclose the solid noses, fins and rims at their orbital render scale.
// Exhaust and contrails are not colliders.
export const THREAT_CONTACT_RADIUS = 0.0355
export const INTERCEPTOR_CONTACT_RADIUS = 0.0164
export const CONTACT_PATH_SEGMENTS = 1024

export interface InterceptorContact {
  readonly flightProgress: number
  readonly launchThreatProgress: number
  readonly threatProgress: number
  readonly point: Vec3
}

/** First contact of two moving spheres, including contact between frame samples. */
export function sweptSphereContact(
  a0: Vector3, a1: Vector3, radiusA: number,
  b0: Vector3, b1: Vector3, radiusB: number,
): number | null {
  const start = a0.clone().sub(b0)
  const velocity = a1.clone().sub(a0).sub(b1.clone().sub(b0))
  const radius = radiusA + radiusB
  const c = start.lengthSq() - radius * radius
  if (c <= 0) return 0
  const a = velocity.lengthSq()
  if (a < 1e-20) return null
  const b = 2 * start.dot(velocity)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const t = (-b - Math.sqrt(discriminant)) / (2 * a)
  return t >= 0 && t <= 1 ? t : null
}

/** Sweep the authored curves once at launch; rendering cadence cannot move contact. */
export function planInterceptorContact(
  player: LandingSite, rival: LandingSite, impact: LandingSite,
  run: CounterstrikeRunState,
): InterceptorContact | null {
  if (run.status !== 'interceptor-launched' || run.judgement !== 'VALID' || run.interceptRouteProgress === null) return null
  const threat = createCounterstrikeRoute(player, rival, impact)
  const interceptor = createInterceptorRoute(player, threat, run.interceptRouteProgress)
  const sampleThreat = (p: number) => threat.getRenderPoint(run.threatProgressStart + (run.threatProgressEnd - run.threatProgressStart) * p)
  const sampleInterceptor = (p: number) => interceptor.getRenderPoint(p * p * (3 - 2 * p))
  let previousThreat = sampleThreat(0)
  let previousInterceptor = sampleInterceptor(0)
  for (let index = 1; index <= CONTACT_PATH_SEGMENTS; index++) {
    const p = index / CONTACT_PATH_SEGMENTS
    const nextThreat = sampleThreat(p)
    const nextInterceptor = sampleInterceptor(p)
    const fraction = sweptSphereContact(previousThreat, nextThreat, THREAT_CONTACT_RADIUS,
      previousInterceptor, nextInterceptor, INTERCEPTOR_CONTACT_RADIUS)
    if (fraction !== null) {
      const flightProgress = (index - 1 + fraction) / CONTACT_PATH_SEGMENTS
      const a = previousThreat.lerp(nextThreat, fraction)
      const b = previousInterceptor.lerp(nextInterceptor, fraction)
      const point = a.lerp(b, THREAT_CONTACT_RADIUS / (THREAT_CONTACT_RADIUS + INTERCEPTOR_CONTACT_RADIUS))
      return { flightProgress, launchThreatProgress: run.threatProgressStart,
        threatProgress: run.threatProgressStart + (run.threatProgressEnd - run.threatProgressStart) * flightProgress,
        point: { x: point.x, y: point.y, z: point.z } }
    }
    previousThreat = nextThreat
    previousInterceptor = nextInterceptor
  }
  return null
}
