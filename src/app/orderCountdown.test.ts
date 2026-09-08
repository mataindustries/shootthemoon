import { describe, expect, it } from 'vitest'
import { createOrderCountdown } from './orderCountdown.ts'

describe('order panel countdown', () => {
  it('gives the mounted panel five full seconds and clamps delayed ticks at zero', () => {
    const clock = createOrderCountdown(12_000, false)
    expect(clock.sample(12_000, false)).toBe(5_000)
    expect(clock.sample(16_999, false)).toBe(1)
    expect(clock.sample(18_000, false)).toBe(0)
    expect(clock.sample(19_000, false)).toBe(0)
  })

  it('preserves the visible remainder across repeated visibility changes', () => {
    const clock = createOrderCountdown(0, false)
    expect(clock.sample(1_234, true)).toBe(3_766)
    expect(clock.sample(10_000, true)).toBe(3_766)
    expect(clock.sample(20_000, false)).toBe(3_766)
    expect(clock.sample(21_000, true)).toBe(2_766)
    expect(clock.sample(40_000, false)).toBe(2_766)
    expect(clock.sample(42_765, false)).toBe(1)
    expect(clock.sample(42_766, false)).toBe(0)
  })

  it('starts with a full countdown when a hidden panel becomes visible', () => {
    const clock = createOrderCountdown(0, true)
    expect(clock.sample(60_000, false)).toBe(5_000)
    expect(clock.sample(65_000, false)).toBe(0)
  })
})
