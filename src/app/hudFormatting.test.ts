import { describe, expect, it } from 'vitest'
import { formatMetric } from './hudFormatting.ts'

describe('HUD metric formatting', () => {
  it('never leaks an accumulated float into a readout', () => {
    // The shipped orbital legend showed this exact extractor-fed value.
    expect(formatMetric(12.386203425399929)).toBe('12.4')
    expect(formatMetric(0.1 + 0.2)).toBe('0.3')
  })

  it('keeps whole values clean', () => {
    expect(formatMetric(0)).toBe('0')
    expect(formatMetric(40)).toBe('40')
    expect(formatMetric(60.04)).toBe('60')
  })

  it('holds one decimal place for every simulated ore total', () => {
    for (let step = 0; step < 400; step += 1) {
      const formatted = formatMetric(step * 1.0372046280913)
      const decimals = formatted.split('.')[1] ?? ''

      expect(decimals.length).toBeLessThanOrEqual(1)
      expect(formatted).not.toContain('e')
    }
  })
})
