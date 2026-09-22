/**
 * Shared HUD number formatting.
 *
 * Simulation values such as lunar ore accumulate fractionally, so every HUD
 * readout goes through here instead of interpolating a raw float.
 */
export function formatMetric(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0$/, '')
}
