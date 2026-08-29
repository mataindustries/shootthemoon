export type RivalPresentationPhase =
  | 'idle'
  | 'warning'
  | 'orbital-transition'
  | 'capsule-approach'
  | 'impact'
  | 'intro-transmission'
  | 'dual-sites'
  | 'rival-focus'
  | 'rival-focused'
  | 'scanning'
  | 'scan-response'
  | 'contested'

export interface RivalPresentationState {
  readonly phase: RivalPresentationPhase
  readonly startedAtMs: number
  readonly progressOverride: number | null
  readonly replay: boolean
}

export const RIVAL_PRESENTATION_DURATIONS_MS: Readonly<
  Partial<Record<RivalPresentationPhase, number>>
> = Object.freeze({
  warning: 2_600,
  'orbital-transition': 5_800,
  'capsule-approach': 4_800,
  impact: 2_600,
  'intro-transmission': 7_000,
  'dual-sites': 3_500,
  'rival-focus': 2_600,
  scanning: 4_000,
  'scan-response': 8_000,
  contested: 4_000,
})

const NEXT_AUTOMATIC_PHASE: Readonly<
  Partial<Record<RivalPresentationPhase, RivalPresentationPhase>>
> = Object.freeze({
  warning: 'orbital-transition',
  'orbital-transition': 'capsule-approach',
  'capsule-approach': 'impact',
  impact: 'intro-transmission',
  'intro-transmission': 'dual-sites',
  'dual-sites': 'idle',
  'rival-focus': 'rival-focused',
  scanning: 'scan-response',
  'scan-response': 'contested',
  contested: 'idle',
})

export function createRivalPresentation(
  phase: RivalPresentationPhase = 'idle',
  startedAtMs = performance.now(),
  options: {
    readonly progressOverride?: number | null
    readonly replay?: boolean
  } = {},
): RivalPresentationState {
  return {
    phase,
    startedAtMs,
    progressOverride: options.progressOverride ?? null,
    replay: options.replay ?? false,
  }
}

export function getRivalPresentationDurationMs(
  phase: RivalPresentationPhase,
): number | null {
  return RIVAL_PRESENTATION_DURATIONS_MS[phase] ?? null
}

export function getRivalPresentationProgress(
  presentation: RivalPresentationState,
  nowMs = performance.now(),
): number {
  if (presentation.progressOverride !== null) {
    return Math.max(0, Math.min(1, presentation.progressOverride))
  }

  const durationMs = getRivalPresentationDurationMs(presentation.phase)

  if (durationMs === null) {
    return presentation.phase === 'idle' ? 0 : 1
  }

  return Math.max(
    0,
    Math.min(1, (nowMs - presentation.startedAtMs) / durationMs),
  )
}

export function getNextAutomaticRivalPhase(
  phase: RivalPresentationPhase,
): RivalPresentationPhase | null {
  return NEXT_AUTOMATIC_PHASE[phase] ?? null
}

export function rivalPresentationNeedsContinuousFrames(
  phase: RivalPresentationPhase,
): boolean {
  return (
    phase === 'warning' ||
    phase === 'orbital-transition' ||
    phase === 'capsule-approach' ||
    phase === 'impact' ||
    phase === 'dual-sites' ||
    phase === 'rival-focus' ||
    phase === 'scanning' ||
    phase === 'contested'
  )
}

export function rivalPresentationLocksCamera(
  phase: RivalPresentationPhase,
): boolean {
  return (
    phase === 'orbital-transition' ||
    phase === 'capsule-approach' ||
    phase === 'impact' ||
    phase === 'intro-transmission' ||
    phase === 'dual-sites' ||
    phase === 'rival-focus' ||
    phase === 'scanning' ||
    phase === 'scan-response' ||
    phase === 'contested'
  )
}

export function rivalPresentationShowsFoothold(
  phase: RivalPresentationPhase,
): boolean {
  return (
    phase === 'capsule-approach' ||
    phase === 'impact' ||
    phase === 'intro-transmission' ||
    phase === 'dual-sites' ||
    phase === 'rival-focus' ||
    phase === 'rival-focused' ||
    phase === 'scanning' ||
    phase === 'scan-response' ||
    phase === 'contested'
  )
}

export function rivalPresentationIsFirstReveal(
  phase: RivalPresentationPhase,
): boolean {
  return (
    phase === 'warning' ||
    phase === 'orbital-transition' ||
    phase === 'capsule-approach' ||
    phase === 'impact' ||
    phase === 'intro-transmission' ||
    phase === 'dual-sites'
  )
}
