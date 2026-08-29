import { describe, expect, it } from 'vitest'
import {
  RIVAL_PRESENTATION_DURATIONS_MS,
  createRivalPresentation,
  getNextAutomaticRivalPhase,
  getRivalPresentationProgress,
  rivalPresentationNeedsContinuousFrames,
} from './rivalPresentation.ts'

describe('rival presentation timeline', () => {
  it('samples bounded absolute-time progress', () => {
    const presentation = createRivalPresentation('warning', 1_000)

    expect(getRivalPresentationProgress(presentation, 1_000)).toBe(0)
    expect(getRivalPresentationProgress(presentation, 2_300)).toBe(0.5)
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

  it('keeps the complete first reveal inside the focused demo window', () => {
    const firstRevealDurationMs = [
      'warning',
      'orbital-transition',
      'capsule-approach',
      'impact',
      'intro-transmission',
      'dual-sites',
    ].reduce(
      (total, phase) =>
        total +
        (RIVAL_PRESENTATION_DURATIONS_MS[
          phase as keyof typeof RIVAL_PRESENTATION_DURATIONS_MS
        ] ?? 0),
      0,
    )

    expect(firstRevealDurationMs).toBe(26_300)
    expect(firstRevealDurationMs).toBeGreaterThanOrEqual(25_000)
    expect(firstRevealDurationMs).toBeLessThanOrEqual(40_000)
  })
})
