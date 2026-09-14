import { Vector3 } from 'three'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { DEFENSE_WINDOW_MS, defenseImpactAt } from '../domain/waveDefense.ts'
import { octogonalApproach } from './monumentPresentation.ts'

/** Interpolate at most one existing simulation tick; hidden/closed views never run ahead. */
export function defenseElapsed(m: Pick<WaveDefenseView, 'phaseElapsedMs' | 'status'>, sampledAtMs: number, nowMs: number, running: boolean) {
  return m.phaseElapsedMs + (m.status === 'wave' && running ? Math.max(0, Math.min(80, nowMs - sampledAtMs)) : 0)
}

/** The whole pass stays above the tallest monument, then retreats away from the claim. */
export function defenseApproach(wave: number, elapsedMs: number, ship: number): Vector3 {
  const point = octogonalApproach(wave, Math.min(.7, elapsedMs / DEFENSE_WINDOW_MS * .7), ship)
  point.x *= .9
  point.z *= .9
  point.y += .033
  return point
}

export function defenseShake(elapsedMs: number, shotAtMs: number | null | undefined, reducedMotion: boolean): number {
  const impact = defenseImpactAt(shotAtMs)
  if (reducedMotion || impact === null) return 0
  const t = (elapsedMs - impact) / 280
  // A bounded lateral translation of both camera and target; no zoom, roll or accumulation.
  return t > 0 && t < 1 ? Math.sin(t * Math.PI * 4) * Math.sin(t * Math.PI) * (1 - t) * .0012 : 0
}
