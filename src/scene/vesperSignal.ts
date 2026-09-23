/** Pure presentation clock. No rival/simulation state or invalidation ownership. */
export const VESPER_SIGNAL_PERIOD_MS = 10_000

function ramp(time: number, start: number, end: number): number {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

export function sampleCitadelSignal(elapsedMs: number) {
  const time = ((elapsedMs % VESPER_SIGNAL_PERIOD_MS) + VESPER_SIGNAL_PERIOD_MS) % VESPER_SIGNAL_PERIOD_MS
  const release = 1 - ramp(time, 5_900, 7_400)
  return {
    charge: ramp(time, 2_000, 3_800) * release,
    alignment: ramp(time, 2_800, 4_800) * release,
    routing: ramp(time, 4_000, 5_000) * (1 - ramp(time, 5_900, 6_800)),
    transmission: ramp(time, 5_000, 5_350) * (1 - ramp(time, 5_700, 6_100)),
    sweep: ramp(time, 5_000, 5_900),
  }
}

export type CitadelSignalSample = ReturnType<typeof sampleCitadelSignal>

/** Headings are model-space radians; +z is the front that faces the player. */
const CROWN_IDLE_SWING = 0.42
const CROWN_SWEEP = 0.38
const ARRAY_AIM_PITCH = -0.32

/**
 * Converts the clock into joint angles and emissive levels. Idle is a slow,
 * searching crown; the peak is a short aligned burst, never a steady glow.
 */
export function poseCitadelSignal(signal: CitadelSignalSample, elapsedMs: number) {
  const listening = Math.sin(elapsedMs / 1_900) * CROWN_IDLE_SWING
  const aimed = (signal.sweep - 0.5) * CROWN_SWEEP
  const crownYaw = listening + (aimed - listening) * signal.alignment
  return {
    crownYaw,
    arrayYaw: crownYaw * 0.55,
    arrayPitch: ARRAY_AIM_PITCH * signal.alignment,
    core: 0.2 + signal.charge * 0.36 + signal.transmission * 0.08,
    routing: 0.1 + signal.routing * 0.55,
    crown: 0.26 + signal.alignment * 0.2 + signal.transmission * 0.34,
    array: 0.18 + signal.alignment * 0.14 + signal.transmission * 0.46,
    beam: signal.transmission * 0.22,
  }
}
