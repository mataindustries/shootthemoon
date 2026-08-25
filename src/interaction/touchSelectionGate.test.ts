import { describe, expect, it } from 'vitest'
import {
  beginTouch,
  canSelectWithTouchGate,
  createTouchSelectionGate,
  endTouch,
  resetTouchSelectionGate,
} from './touchSelectionGate.ts'

describe('touch selection gate', () => {
  it('clears an incomplete multi-touch gesture during an experience reset', () => {
    const gate = createTouchSelectionGate()

    beginTouch(gate, 11)
    beginTouch(gate, 12)
    endTouch(gate, 12, 100)

    expect(canSelectWithTouchGate(gate, 10_000)).toBe(false)
    expect(gate.activePointerIds).toEqual(new Set([11]))

    resetTouchSelectionGate(gate)

    expect(gate.activePointerIds.size).toBe(0)
    expect(canSelectWithTouchGate(gate, 100)).toBe(true)
  })

  it('keeps the short pinch-to-tap guard after a complete pinch', () => {
    const gate = createTouchSelectionGate()

    beginTouch(gate, 21)
    beginTouch(gate, 22)
    endTouch(gate, 21, 500)
    endTouch(gate, 22, 510)

    expect(canSelectWithTouchGate(gate, 859)).toBe(false)
    expect(canSelectWithTouchGate(gate, 860)).toBe(true)
  })
})
