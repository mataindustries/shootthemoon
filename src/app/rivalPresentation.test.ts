import { describe, expect, it } from 'vitest'
import {
  createRivalPresentation,
  getNextAutomaticRivalPhase,
  getRivalPresentationProgress,
  rivalPresentationNeedsContinuousFrames,
} from './rivalPresentation.ts'

describe('rival presentation timeline', () => {
  it('samples bounded absolute-time progress', () => {
    const presentation = createRivalPresentation('warning', 1_000)

    expect(getRivalPresentationProgress(presentation, 1_000)).toBe(0)
    expect(getRivalPresentationProgress(presentation, 2_500)).toBe(0.5)
    expect(getRivalPresentationProgress(presentation, 8_000)).toBe(1)
  })

  it('supports deterministic fixed frames without changing persistence', () => {
    const presentation = createRivalPresentation('impact', 1_000, {
      progressOverride: 0.72,
      replay: true,
    })

    expect(getRivalPresentationProgress(presentation, 99_000)).toBe(0.72)
    expect(presentation.replay).toBe(true)
  })

  it('ends bounded effects and keeps settled views out of the full-rate loop', () => {
    expect(getNextAutomaticRivalPhase('dual-sites')).toBe('idle')
    expect(getNextAutomaticRivalPhase('rival-focus')).toBe('rival-focused')
    expect(rivalPresentationNeedsContinuousFrames('scanning')).toBe(true)
    expect(rivalPresentationNeedsContinuousFrames('rival-focused')).toBe(false)
    expect(rivalPresentationNeedsContinuousFrames('idle')).toBe(false)
  })
})
