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
