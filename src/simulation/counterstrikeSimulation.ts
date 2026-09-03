import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import {
  COUNTERSTRIKE_ID,
  deriveSecondaryImpactSite,
  type CounterstrikeOutcome,
  type CounterstrikeSnapshot,
} from '../domain/counterstrike.ts'

export type CounterstrikeRunStatus =
  | 'dormant'
  | 'warning'
  | 'tracking'
  | 'intercept-ready'
  | 'interceptor-launched'
  | 'success'
  | 'missed'
  | 'impact'
  | 'resolved'

export type InterceptionJudgement = 'EARLY' | 'VALID' | 'LATE'

export interface CounterstrikeRunState {
  readonly status: CounterstrikeRunStatus
  readonly phaseStartedAtMs: number
  readonly attemptStartedAtMs: number | null
  readonly attemptNumber: 0 | 1 | 2
  readonly attemptsUsed: 0 | 1 | 2
  readonly judgement: InterceptionJudgement | null
  readonly attemptElapsedAtFireMs: number | null
  readonly outcome: CounterstrikeOutcome | null
  readonly replay: boolean
  readonly threatProgressStart: number
  readonly threatProgressEnd: number
  readonly interceptRouteProgress: number | null
}

export const COUNTERSTRIKE_TIMING = Object.freeze({
  warningMs: 3_200,
  trackingMs: 5_800,
  readyMs: 2_400,
  validWindowMs: 2_400,
  validWindowStartMs: 5_800,
  validWindowEndMs: 8_200,
  launchedValidMs: 4_600,
  launchedMissMs: 2_400,
  successMs: 6_400,
  missedMs: 1_800,
  impactMs: 7_800,
  impactContactMs: 3_120,
  maximumAttempts: 2,
})

export const COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS =
  COUNTERSTRIKE_TIMING.warningMs +
  (COUNTERSTRIKE_TIMING.trackingMs +
    COUNTERSTRIKE_TIMING.readyMs +
    COUNTERSTRIKE_TIMING.missedMs) *
    COUNTERSTRIKE_TIMING.maximumAttempts +
  COUNTERSTRIKE_TIMING.impactMs

export type CounterstrikeFactsAction =
  | { readonly type: 'establish'; readonly nowMs: number }
  | {
      readonly type: 'unlock'
      readonly firstStrike: FirstStrikeSnapshot
      readonly nowMs: number
    }
  | {
      readonly type: 'acceptOutcome'
      readonly outcome: CounterstrikeOutcome
      readonly outpost: OutpostSnapshot
      readonly nowMs: number
    }
  | { readonly type: 'reset' }

export type CounterstrikeRunAction =
  | {
      readonly type: 'begin'
      readonly clockMs: number
      readonly replay: boolean
    }
  | { readonly type: 'advance'; readonly clockMs: number }
  | { readonly type: 'fire'; readonly clockMs: number }
  | { readonly type: 'shiftClock'; readonly durationMs: number }
  | {
      readonly type: 'restoreAccepted'
      readonly outcome: CounterstrikeOutcome | null
      readonly clockMs: number
    }
  | { readonly type: 'reset'; readonly clockMs: number }

function assertTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`)
  }
}

function transitionTimestamp(
  snapshot: CounterstrikeSnapshot,
  nowMs: number,
): number {
  assertTimestamp(nowMs, 'Counterstrike timestamp')
  return Math.max(snapshot.updatedAtMs, nowMs)
}

export function createInitialCounterstrike(
  nowMs: number,
): CounterstrikeSnapshot {
  assertTimestamp(nowMs, 'Counterstrike timestamp')

  return {
    id: COUNTERSTRIKE_ID,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    available: false,
    availableAtMs: null,
    acceptedOutcome: null,
    interceptionSucceeded: null,
    outpostDamageState: 'INTACT',
    secondaryImpactSite: null,
    completedAtMs: null,
    acceptedAtMs: null,
    replayEligible: false,
    orbitalDebrisRecorded: false,
    repairsRequired: false,
  }
}

export function canUnlockCounterstrike(
  firstStrike: FirstStrikeSnapshot,
): boolean {
  return (
    firstStrike.status === 'COMPLETE' &&
    firstStrike.impactCompleted &&
    firstStrike.endingCompleted &&
    firstStrike.finalVesperTransmissionCompleted
  )
}

export function createMigratedCounterstrike(
  firstStrike: FirstStrikeSnapshot,
  nowMs: number,
): CounterstrikeSnapshot {
  const createdAtMs = Math.min(firstStrike.createdAtMs, nowMs)
  const initial = createInitialCounterstrike(createdAtMs)

  if (!canUnlockCounterstrike(firstStrike)) {
    return { ...initial, updatedAtMs: nowMs }
  }

  return {
    ...initial,
    updatedAtMs: nowMs,
    available: true,
    availableAtMs: Math.min(firstStrike.endingCompletedAtMs ?? nowMs, nowMs),
  }
}

function unlockCounterstrike(
  snapshot: CounterstrikeSnapshot,
  firstStrike: FirstStrikeSnapshot,
  nowMs: number,
): CounterstrikeSnapshot {
  if (snapshot.available || !canUnlockCounterstrike(firstStrike)) {
    return snapshot
  }

  const timestamp = transitionTimestamp(snapshot, nowMs)
  return {
    ...snapshot,
    updatedAtMs: timestamp,
    available: true,
    availableAtMs: timestamp,
  }
}

function acceptCounterstrikeOutcome(
  snapshot: CounterstrikeSnapshot,
  outcome: CounterstrikeOutcome,
  outpost: OutpostSnapshot,
  nowMs: number,
): CounterstrikeSnapshot {
  if (!snapshot.available) return snapshot

  const timestamp = transitionTimestamp(snapshot, nowMs)
  const success = outcome === 'SUCCESS'
  const secondaryImpactSite = success
    ? null
    : deriveSecondaryImpactSite(outpost)

  return {
    ...snapshot,
    updatedAtMs: timestamp,
    acceptedOutcome: outcome,
    interceptionSucceeded: success,
    outpostDamageState: success ? 'INTACT' : 'DAMAGED',
    secondaryImpactSite,
    completedAtMs: timestamp,
    acceptedAtMs: timestamp,
    replayEligible: true,
    orbitalDebrisRecorded: success,
    repairsRequired: !success,
  }
}

export function counterstrikeFactsReducer(
  state: CounterstrikeSnapshot | null,
  action: CounterstrikeFactsAction,
): CounterstrikeSnapshot | null {
  if (action.type === 'reset') return null
  if (action.type === 'establish') {
    return state ?? createInitialCounterstrike(action.nowMs)
  }
  if (state === null) return null

  switch (action.type) {
    case 'unlock':
      return unlockCounterstrike(state, action.firstStrike, action.nowMs)
    case 'acceptOutcome':
      return acceptCounterstrikeOutcome(
        state,
        action.outcome,
        action.outpost,
        action.nowMs,
      )
  }
}

export function createCounterstrikeRunState(
  snapshot: CounterstrikeSnapshot | null,
  clockMs = 0,
): CounterstrikeRunState {
  assertTimestamp(clockMs, 'Counterstrike clock')
  const restoredOutcome = snapshot?.acceptedOutcome ?? null

  return {
    status: restoredOutcome === null ? 'dormant' : 'resolved',
    phaseStartedAtMs: clockMs,
    attemptStartedAtMs: null,
    attemptNumber: 0,
    attemptsUsed: 0,
    judgement: null,
    attemptElapsedAtFireMs: null,
    outcome: restoredOutcome,
    replay: false,
    threatProgressStart: 0,
    threatProgressEnd: 0,
    interceptRouteProgress: null,
  }
}

export function judgeInterceptionTiming(
  attemptElapsedMs: number,
): InterceptionJudgement {
  assertTimestamp(attemptElapsedMs, 'Interception timing')

  if (attemptElapsedMs < COUNTERSTRIKE_TIMING.validWindowStartMs) {
    return 'EARLY'
  }
  if (attemptElapsedMs <= COUNTERSTRIKE_TIMING.validWindowEndMs) {
    return 'VALID'
  }
  return 'LATE'
}

export function getCounterstrikeRunDurationMs(
  run: CounterstrikeRunState,
): number | null {
  switch (run.status) {
    case 'warning':
      return COUNTERSTRIKE_TIMING.warningMs
    case 'tracking':
      return COUNTERSTRIKE_TIMING.trackingMs
    case 'intercept-ready':
      return COUNTERSTRIKE_TIMING.readyMs
    case 'interceptor-launched':
      return run.judgement === 'VALID'
        ? COUNTERSTRIKE_TIMING.launchedValidMs
        : COUNTERSTRIKE_TIMING.launchedMissMs
    case 'success':
      return COUNTERSTRIKE_TIMING.successMs
    case 'missed':
      return COUNTERSTRIKE_TIMING.missedMs
    case 'impact':
      return COUNTERSTRIKE_TIMING.impactMs
    case 'dormant':
    case 'resolved':
      return null
  }
}

export function getCounterstrikeRunProgress(
  run: CounterstrikeRunState,
  clockMs: number,
): number {
  assertTimestamp(clockMs, 'Counterstrike clock')
  const durationMs = getCounterstrikeRunDurationMs(run)
  if (durationMs === null) return run.status === 'dormant' ? 0 : 1

  return Math.max(
    0,
    Math.min(1, (clockMs - run.phaseStartedAtMs) / durationMs),
  )
}

export function getCounterstrikeAttemptElapsedMs(
  run: CounterstrikeRunState,
  clockMs: number,
): number | null {
  assertTimestamp(clockMs, 'Counterstrike clock')
  return run.attemptStartedAtMs === null
    ? null
    : Math.max(0, clockMs - run.attemptStartedAtMs)
}

export function getCounterstrikeThreatProgress(
  run: CounterstrikeRunState,
  clockMs: number,
): number {
  const progress = getCounterstrikeRunProgress(run, clockMs)
  return (
    run.threatProgressStart +
    (run.threatProgressEnd - run.threatProgressStart) * progress
  )
}

function phaseThreatTarget(attemptNumber: 1 | 2, ready: boolean): number {
  if (attemptNumber === 1) return ready ? 0.58 : 0.4
  return ready ? 0.91 : 0.78
}

function beginTrackingAttempt(
  run: CounterstrikeRunState,
  attemptNumber: 1 | 2,
  clockMs: number,
): CounterstrikeRunState {
  return {
    ...run,
    status: 'tracking',
    phaseStartedAtMs: clockMs,
    attemptStartedAtMs: clockMs,
    attemptNumber,
    judgement: null,
    attemptElapsedAtFireMs: null,
    threatProgressStart: run.threatProgressEnd,
    threatProgressEnd: phaseThreatTarget(attemptNumber, false),
    interceptRouteProgress: null,
  }
}

function advanceRun(
  run: CounterstrikeRunState,
  clockMs: number,
): CounterstrikeRunState {
  switch (run.status) {
    case 'warning':
      return beginTrackingAttempt(
        { ...run, threatProgressStart: 0.08, threatProgressEnd: 0.08 },
        1,
        clockMs,
      )
    case 'tracking':
      if (run.attemptNumber === 0) return run
      return {
        ...run,
        status: 'intercept-ready',
        phaseStartedAtMs: clockMs,
        threatProgressStart: run.threatProgressEnd,
        threatProgressEnd: phaseThreatTarget(run.attemptNumber, true),
      }
    case 'intercept-ready': {
      if (run.attemptNumber === 0 || run.attemptsUsed >= 2) return run
      return {
        ...run,
        status: 'missed',
        phaseStartedAtMs: clockMs,
        attemptsUsed: (run.attemptsUsed + 1) as 1 | 2,
        judgement: 'LATE',
        attemptElapsedAtFireMs:
          run.attemptStartedAtMs === null
            ? null
            : Math.max(0, clockMs - run.attemptStartedAtMs),
        threatProgressStart: run.threatProgressEnd,
        threatProgressEnd: run.threatProgressEnd,
        interceptRouteProgress: run.threatProgressEnd,
      }
    }
    case 'interceptor-launched':
      return {
        ...run,
        status: run.judgement === 'VALID' ? 'success' : 'missed',
        phaseStartedAtMs: clockMs,
        outcome: run.judgement === 'VALID' ? 'SUCCESS' : null,
        threatProgressStart: run.threatProgressEnd,
      }
    case 'success':
      return {
        ...run,
        status: 'resolved',
        phaseStartedAtMs: clockMs,
        outcome: 'SUCCESS',
      }
    case 'missed':
      if (run.attemptsUsed < COUNTERSTRIKE_TIMING.maximumAttempts) {
        return beginTrackingAttempt(run, 2, clockMs)
      }
      return {
        ...run,
        status: 'impact',
        phaseStartedAtMs: clockMs,
        outcome: 'FAILURE',
        threatProgressStart: run.threatProgressEnd,
        threatProgressEnd: 1,
      }
    case 'impact':
      return {
        ...run,
        status: 'resolved',
        phaseStartedAtMs: clockMs,
        outcome: 'FAILURE',
        threatProgressStart: 1,
        threatProgressEnd: 1,
      }
    case 'dormant':
    case 'resolved':
      return run
  }
}

function fireInterceptor(
  run: CounterstrikeRunState,
  clockMs: number,
): CounterstrikeRunState {
  if (
    (run.status !== 'tracking' && run.status !== 'intercept-ready') ||
    run.attemptStartedAtMs === null ||
    run.attemptNumber === 0 ||
    run.attemptsUsed >= COUNTERSTRIKE_TIMING.maximumAttempts
  ) {
    return run
  }

  const attemptElapsedMs = Math.max(0, clockMs - run.attemptStartedAtMs)
  const judgement = judgeInterceptionTiming(attemptElapsedMs)
  const currentThreatProgress = getCounterstrikeThreatProgress(run, clockMs)
  const routeAdvance = judgement === 'VALID' ? 0.045 : 0.07
  const interceptRouteProgress = Math.min(
    run.attemptNumber === 1 ? 0.66 : 0.94,
    currentThreatProgress + routeAdvance,
  )

  return {
    ...run,
    status: 'interceptor-launched',
    phaseStartedAtMs: clockMs,
    attemptsUsed: (run.attemptsUsed + 1) as 1 | 2,
    judgement,
    attemptElapsedAtFireMs: attemptElapsedMs,
    threatProgressStart: currentThreatProgress,
    threatProgressEnd: interceptRouteProgress,
    interceptRouteProgress,
  }
}

export function counterstrikeRunReducer(
  run: CounterstrikeRunState,
  action: CounterstrikeRunAction,
): CounterstrikeRunState {
  switch (action.type) {
    case 'begin':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      if (run.status !== 'dormant' && run.status !== 'resolved') return run
      return {
        status: 'warning',
        phaseStartedAtMs: action.clockMs,
        attemptStartedAtMs: null,
        attemptNumber: 0,
        attemptsUsed: 0,
        judgement: null,
        attemptElapsedAtFireMs: null,
        outcome: null,
        replay: action.replay,
        threatProgressStart: 0,
        threatProgressEnd: 0.08,
        interceptRouteProgress: null,
      }
    case 'advance':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      return advanceRun(run, action.clockMs)
    case 'fire':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      return fireInterceptor(run, action.clockMs)
    case 'shiftClock':
      assertTimestamp(action.durationMs, 'Hidden duration')
      if (run.status === 'dormant' || run.status === 'resolved') return run
      return {
        ...run,
        phaseStartedAtMs: run.phaseStartedAtMs + action.durationMs,
        attemptStartedAtMs:
          run.attemptStartedAtMs === null
            ? null
            : run.attemptStartedAtMs + action.durationMs,
      }
    case 'restoreAccepted':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      return {
        ...createCounterstrikeRunState(null, action.clockMs),
        status: action.outcome === null ? 'dormant' : 'resolved',
        outcome: action.outcome,
      }
    case 'reset':
      return createCounterstrikeRunState(null, action.clockMs)
  }
}

export function counterstrikeNeedsContinuousFrames(
  status: CounterstrikeRunStatus,
): boolean {
  return status !== 'dormant' && status !== 'resolved'
}
