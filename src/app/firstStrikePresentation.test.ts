import { describe, expect, it } from 'vitest'
import {
  FIRST_STRIKE_CINEMATIC_DURATION_MS,
  createFirstStrikePresentation,
  firstStrikeNeedsContinuousFrames,
  getFirstStrikePresentationProgress,
  getNextAutomaticFirstStrikePhase,
} from './firstStrikePresentation.ts'

describe('First Strike presentation timeline', () => {
  it('keeps the complete launch-to-ending payoff within 18–28 seconds', () => {
    expect(FIRST_STRIKE_CINEMATIC_DURATION_MS).toBeGreaterThanOrEqual(18_000)
    expect(FIRST_STRIKE_CINEMATIC_DURATION_MS).toBeLessThanOrEqual(28_000)
  })

  it('follows the authored beats exactly and leaves ending deliberate', () => {
    const phases = ['arming']
    let phase = getNextAutomaticFirstStrikePhase('arming')

    while (phase !== null) {
      phases.push(phase)
      phase = getNextAutomaticFirstStrikePhase(phase)
    }

    expect(phases).toEqual([
      'arming',
      'launch',
      'orbital-flight',
      'vesper-transmission',
      'target-approach',
      'impact-flash',
      'ejecta',
      'crater-reveal',
      'orbital-pullback',
      'ending',
    ])
    expect(getNextAutomaticFirstStrikePhase('ending')).toBeNull()
  })

  it('supports bounded test frames and returns ending/idle to demand rendering', () => {
    const fixed = createFirstStrikePresentation('orbital-flight', 1_000, 0.63)
    expect(getFirstStrikePresentationProgress(fixed, 99_000)).toBe(0.63)
    expect(firstStrikeNeedsContinuousFrames('orbital-flight')).toBe(true)
    expect(firstStrikeNeedsContinuousFrames('ending')).toBe(false)
    expect(firstStrikeNeedsContinuousFrames('idle')).toBe(false)
  })
})
