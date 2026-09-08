export const ORDER_COUNTDOWN_MS = 5_000

/** Elapsed visible time, independent of simulation clocks and saved state. */
export function createOrderCountdown(nowMs: number, hidden: boolean) {
  let remainingMs = ORDER_COUNTDOWN_MS
  let lastSampleMs = nowMs
  let wasHidden = hidden

  return {
    sample(clockMs: number, isHidden: boolean): number {
      if (!wasHidden) {
        remainingMs = Math.max(0, remainingMs - Math.max(0, clockMs - lastSampleMs))
      }
      lastSampleMs = clockMs
      wasHidden = isHidden
      return remainingMs
    },
  }
}
