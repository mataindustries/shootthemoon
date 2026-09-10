import { MathUtils } from 'three'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'

// Presentation envelopes use the existing success clock, including pause/replay.
export function sampleInterceptEnergy(progress: number) {
  const elapsedMs = MathUtils.clamp(progress, 0, 1) * COUNTERSTRIKE_TIMING.successMs
  return {
    core: Math.max(0, 1 - elapsedMs / 180) ** 2,
    shellOpacity: Math.max(0, 1 - elapsedMs / 760) * 0.34,
    shellRadius: 0.018 + Math.min(elapsedMs / 760, 1) * 0.075,
    ringOpacity: Math.max(0, 1 - elapsedMs / 1_000) * 0.68,
    ringRadius: 0.025 + Math.min(elapsedMs / 1_000, 1) * 0.13,
    surfacePulse: Math.max(0, 1 - elapsedMs / 420) ** 2,
  }
}
