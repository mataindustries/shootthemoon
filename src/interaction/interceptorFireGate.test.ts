import { describe, expect, it } from 'vitest'
import {
  INITIAL_INTERCEPTOR_FIRE_GESTURE,
  beginInterceptorFireGesture,
  cancelInterceptorFireGesture,
  endInterceptorFireGesture,
  moveInterceptorFireGesture,
} from './interceptorFireGate.ts'

const sample = (
  pointerId: number,
  clientX: number,
  clientY: number,
  isPrimary = true,
) => ({ pointerId, clientX, clientY, isPrimary })

describe('interceptor fire gesture gate', () => {
  it('accepts one stationary primary release', () => {
    const started = beginInterceptorFireGesture(
      INITIAL_INTERCEPTOR_FIRE_GESTURE,
      sample(4, 120, 640),
    )
    const result = endInterceptorFireGesture(
      started,
      sample(4, 125, 644),
    )

    expect(result.shouldFire).toBe(true)
    expect(result.state).toBe(INITIAL_INTERCEPTOR_FIRE_GESTURE)
  })

  it('rejects dragging, cancellation, and a non-primary pointer', () => {
    const started = beginInterceptorFireGesture(
      INITIAL_INTERCEPTOR_FIRE_GESTURE,
      sample(8, 100, 700),
    )
    const moved = moveInterceptorFireGesture(started, sample(8, 124, 700))

    expect(endInterceptorFireGesture(moved, sample(8, 124, 700)).shouldFire)
      .toBe(false)
    expect(
      beginInterceptorFireGesture(
        INITIAL_INTERCEPTOR_FIRE_GESTURE,
        sample(9, 100, 700, false),
      ),
    ).toBe(INITIAL_INTERCEPTOR_FIRE_GESTURE)
    expect(cancelInterceptorFireGesture()).toBe(
      INITIAL_INTERCEPTOR_FIRE_GESTURE,
    )
  })

  it('cancels the primary gesture when a second pointer arrives', () => {
    const primary = beginInterceptorFireGesture(
      INITIAL_INTERCEPTOR_FIRE_GESTURE,
      sample(11, 140, 650),
    )
    const multitouch = beginInterceptorFireGesture(
      primary,
      sample(12, 160, 650, false),
    )

    expect(multitouch.cancelled).toBe(true)
    expect(
      endInterceptorFireGesture(multitouch, sample(11, 140, 650)).shouldFire,
    ).toBe(false)
  })
})
