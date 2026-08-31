export type FirstStrikePresentationPhase =
  | 'idle'
  | 'arming'
  | 'launch'
  | 'orbital-flight'
  | 'vesper-transmission'
  | 'target-approach'
  | 'impact-flash'
  | 'ejecta'
  | 'crater-reveal'
  | 'orbital-pullback'
  | 'scar-explore'
  | 'ending'

export interface FirstStrikePresentationState {
  readonly phase: FirstStrikePresentationPhase
  readonly startedAtMs: number
  readonly progressOverride: number | null
  readonly replay: boolean
}

export const FIRST_STRIKE_PRESENTATION_DURATIONS_MS: Readonly<
  Partial<Record<FirstStrikePresentationPhase, number>>
> = Object.freeze({
  arming: 2_400,
  launch: 3_200,
  'orbital-flight': 3_800,
  'vesper-transmission': 3_200,
  'target-approach': 2_200,
  'impact-flash': 1_300,
  ejecta: 3_400,
  'crater-reveal': 2_600,
  'orbital-pullback': 4_000,
})

const NEXT_AUTOMATIC_PHASE: Readonly<
  Partial<Record<FirstStrikePresentationPhase, FirstStrikePresentationPhase>>
> = Object.freeze({
  arming: 'launch',
  launch: 'orbital-flight',
  'orbital-flight': 'vesper-transmission',
  'vesper-transmission': 'target-approach',
  'target-approach': 'impact-flash',
  'impact-flash': 'ejecta',
  ejecta: 'crater-reveal',
  'crater-reveal': 'orbital-pullback',
  'orbital-pullback': 'ending',
})

export const FIRST_STRIKE_CINEMATIC_DURATION_MS = Object.values(
  FIRST_STRIKE_PRESENTATION_DURATIONS_MS,
).reduce((total, duration) => total + duration, 0)

export function createFirstStrikePresentation(
  phase: FirstStrikePresentationPhase = 'idle',
  startedAtMs = performance.now(),
  progressOverride: number | null = null,
  replay = false,
): FirstStrikePresentationState {
  return { phase, startedAtMs, progressOverride, replay }
}

export function getFirstStrikePresentationDurationMs(
  phase: FirstStrikePresentationPhase,
): number | null {
  return FIRST_STRIKE_PRESENTATION_DURATIONS_MS[phase] ?? null
}

export function getFirstStrikePresentationProgress(
  presentation: FirstStrikePresentationState,
  nowMs = performance.now(),
): number {
  if (presentation.progressOverride !== null) {
    return Math.max(0, Math.min(1, presentation.progressOverride))
  }

  const durationMs = getFirstStrikePresentationDurationMs(presentation.phase)

  if (durationMs === null) {
    return presentation.phase === 'idle' ? 0 : 1
  }

  return Math.max(
    0,
    Math.min(1, (nowMs - presentation.startedAtMs) / durationMs),
  )
}

export function getNextAutomaticFirstStrikePhase(
  phase: FirstStrikePresentationPhase,
): FirstStrikePresentationPhase | null {
  return NEXT_AUTOMATIC_PHASE[phase] ?? null
}

export function firstStrikeNeedsContinuousFrames(
  phase: FirstStrikePresentationPhase,
): boolean {
  return phase !== 'idle' && phase !== 'scar-explore' && phase !== 'ending'
}

export function firstStrikeLocksCamera(
  phase: FirstStrikePresentationPhase,
): boolean {
  return phase !== 'idle' && phase !== 'scar-explore'
}

export function firstStrikeShowsWarhead(
  phase: FirstStrikePresentationPhase,
): boolean {
  return (
    phase === 'arming' ||
    phase === 'launch' ||
    phase === 'orbital-flight' ||
    phase === 'vesper-transmission' ||
    phase === 'target-approach'
  )
}

export function firstStrikeShowsImpactEffects(
  phase: FirstStrikePresentationPhase,
): boolean {
  return (
    phase === 'impact-flash' ||
    phase === 'ejecta' ||
    phase === 'crater-reveal'
  )
}
