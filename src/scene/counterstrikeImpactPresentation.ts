import { MathUtils, Vector3 } from 'three'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { deriveSecondaryImpactOffset } from '../domain/counterstrike.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  COUNTERSTRIKE_TIMING,
  getCounterstrikeRunProgress,
  type CounterstrikeRunState,
} from '../simulation/counterstrikeSimulation.ts'

/**
 * Rival warhead contact envelopes, in milliseconds after ground contact.
 *
 * This is a tactical kinetic hit on infrastructure, not the player's strategic
 * detonation: a white-hot core that is gone in a fifth of a second, a fast
 * ground shock ring, a short ejecta curtain, ballistic debris and a heavier
 * regolith haze that settles before the damage reveal completes. Every
 * envelope ends inside the impact status, so the damage is readable once the
 * dust clears.
 */
export const COUNTERSTRIKE_IMPACT_EFFECT_MS = Object.freeze({
  coreAttack: 35,
  core: 200,
  light: 700,
  ring: 520,
  curtain: 1_400,
  debris: 1_150,
  grains: 1_900,
  dust: 2_400,
  ember: 2_600,
})

export interface CounterstrikeImpactEnergy {
  readonly core: number
  readonly coreRadiusM: number
  readonly light: number
  readonly ringOpacity: number
  readonly ringRadiusM: number
  readonly curtainOpacity: number
  readonly curtainHeightM: number
  readonly curtainRadiusM: number
  readonly debris: number
  readonly dustOpacity: number
  readonly dustSpread: number
  readonly ember: number
}

const QUIET: CounterstrikeImpactEnergy = Object.freeze({
  core: 0,
  coreRadiusM: 0,
  light: 0,
  ringOpacity: 0,
  ringRadiusM: 0,
  curtainOpacity: 0,
  curtainHeightM: 0,
  curtainRadiusM: 0,
  debris: 0,
  dustOpacity: 0,
  dustSpread: 0,
  ember: 0,
})

function easeOut(value: number, power = 3): number {
  return 1 - (1 - MathUtils.clamp(value, 0, 1)) ** power
}

function fade(elapsedMs: number, durationMs: number, power = 1): number {
  return Math.max(0, 1 - elapsedMs / durationMs) ** power
}

/** Milliseconds since warhead contact, or a negative value before it. */
export function getCounterstrikeImpactElapsedMs(
  run: CounterstrikeRunState,
  clockMs: number,
): number {
  if (run.status !== 'impact') return Number.POSITIVE_INFINITY
  return (
    getCounterstrikeRunProgress(run, clockMs) * COUNTERSTRIKE_TIMING.impactMs -
    COUNTERSTRIKE_TIMING.impactContactMs
  )
}

export function sampleCounterstrikeImpactEnergy(
  elapsedMs: number,
): CounterstrikeImpactEnergy {
  if (!(elapsedMs >= 0) || !Number.isFinite(elapsedMs)) return QUIET
  const timing = COUNTERSTRIKE_IMPACT_EFFECT_MS
  const core =
    elapsedMs < timing.coreAttack
      ? elapsedMs / timing.coreAttack
      : fade(elapsedMs - timing.coreAttack, timing.core - timing.coreAttack, 2)
  const lightAttack = Math.min(1, elapsedMs / 25)
  const curtainRise = easeOut(elapsedMs / 420)
  const curtainFall = MathUtils.clamp((elapsedMs - 420) / 980, 0, 1)

  return {
    core,
    coreRadiusM: 2.2 + easeOut(elapsedMs / timing.core, 2) * 1.6,
    light:
      elapsedMs >= timing.light
        ? 0
        : lightAttack * Math.exp(-elapsedMs / 190) * fade(elapsedMs, timing.light),
    ringOpacity: fade(elapsedMs, timing.ring, 1.8) * 0.7,
    ringRadiusM: 2 + easeOut(elapsedMs / timing.ring) * 14,
    curtainOpacity:
      Math.min(1, elapsedMs / 50) * fade(elapsedMs, timing.curtain, 1.3) * 0.7,
    curtainHeightM: 4.8 * curtainRise * (1 - 0.6 * curtainFall * curtainFall),
    curtainRadiusM: 1.6 + easeOut(elapsedMs / 700, 2) * 7.5 + curtainFall * 1.5,
    debris: MathUtils.clamp(elapsedMs / timing.debris, 0, 1),
    dustOpacity:
      Math.min(1, elapsedMs / 120) * fade(elapsedMs, timing.dust, 1.2) * 0.7,
    dustSpread: easeOut(elapsedMs / timing.dust, 2),
    ember:
      elapsedMs >= timing.ember
        ? 0
        : Math.min(1, elapsedMs / 80) * fade(elapsedMs, timing.ember, 1.6),
  }
}

/** Peak of the contact light pulse and its reach, in render units. */
export const COUNTERSTRIKE_IMPACT_LIGHT = Object.freeze({
  peakIntensity: 1.4e-5,
  range: 0.0036,
  clearanceM: 2.5,
  color: '#ffd9b0',
})

/** World position of the contact light, just above the rendered hit point. */
export function getCounterstrikeImpactLightPosition(
  outpost: OutpostSnapshot,
  terrain: SurfaceTerrainProfile,
  segments: number,
): Vector3 {
  const transform = landingSiteToRenderTransform(outpost.site)
  const offset = deriveSecondaryImpactOffset(outpost)
  const ground = sampleRenderedSurface(terrain, segments, offset.xM, offset.zM)
  return new Vector3(
    ground.x,
    ground.y + COUNTERSTRIKE_IMPACT_LIGHT.clearanceM * LOCAL_METRES_TO_RENDER_UNITS,
    ground.z,
  )
    .applyQuaternion(transform.orientation)
    .add(transform.position)
}
