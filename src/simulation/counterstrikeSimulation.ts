import type { InterceptorContact } from './interceptorCollision.ts'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import {
  COUNTERSTRIKE_ID,
  deriveSecondaryImpactSite,
  type CounterstrikeOrder,
  type CounterstrikeOutcome,
  type CounterstrikeSnapshot,
} from '../domain/counterstrike.ts'

export type CounterstrikeRunStatus =
  | 'dormant'
  | 'command'
  | 'command-confirmed'
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
  readonly order: CounterstrikeOrder | null
  readonly replay: boolean
  readonly threatProgressStart: number
  readonly threatProgressEnd: number
  readonly contact: InterceptorContact | null
  readonly interceptRouteProgress: number | null
}

export const COUNTERSTRIKE_TIMING = Object.freeze({
  commandConfirmationMs: 1_050,
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

export const PRIORITIZED_INTERCEPT_WINDOW_MULTIPLIER = 1.4

export interface CounterstrikeTimingProfile {
  readonly trackingMs: number
  readonly readyMs: number
  readonly validWindowMs: number
  readonly validWindowStartMs: number
  readonly validWindowEndMs: number
}

export function getCounterstrikeTimingProfile(
  order: CounterstrikeOrder | null,
): CounterstrikeTimingProfile {
  if (order !== 'PRIORITIZE_INTERCEPTOR') {
    return COUNTERSTRIKE_TIMING
  }

  const widenedWindowMs =
    COUNTERSTRIKE_TIMING.validWindowMs *
    PRIORITIZED_INTERCEPT_WINDOW_MULTIPLIER
  const addedWindowMs = widenedWindowMs - COUNTERSTRIKE_TIMING.validWindowMs
  const trackingMs = COUNTERSTRIKE_TIMING.trackingMs - addedWindowMs / 2

  return Object.freeze({
    trackingMs,
    readyMs: widenedWindowMs,
    validWindowMs: widenedWindowMs,
    validWindowStartMs: trackingMs,
    validWindowEndMs: trackingMs + widenedWindowMs,
  })
}

export const COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS =
  COUNTERSTRIKE_TIMING.commandConfirmationMs +
  COUNTERSTRIKE_TIMING.warningMs +
  (getCounterstrikeTimingProfile('PRIORITIZE_INTERCEPTOR').trackingMs +
    getCounterstrikeTimingProfile('PRIORITIZE_INTERCEPTOR').readyMs +
    COUNTERSTRIKE_TIMING.missedMs) *
    COUNTERSTRIKE_TIMING.maximumAttempts +
  COUNTERSTRIKE_TIMING.impactMs

export type CounterstrikeFactsAction =
  | { readonly type: 'establish'; readonly nowMs: number }
  | {
      readonly type: 'detect'
      readonly nowMs: number
    }
  | {
      readonly type: 'issueOrder'
      readonly order: CounterstrikeOrder
      readonly nowMs: number
    }
  | {
      readonly type: 'unlock'
      readonly firstStrike: FirstStrikeSnapshot
      readonly nowMs: number
    }
  | {
      readonly type: 'acceptOutcome'
      readonly outcome: CounterstrikeOutcome
      readonly order: CounterstrikeOrder
      readonly outpost: OutpostSnapshot
      readonly nowMs: number
    }
  | { readonly type: 'completeRepairs'; readonly nowMs: number }
  | { readonly type: 'reset' }

export type CounterstrikeRunAction =
  | {
      readonly type: 'begin'
      readonly clockMs: number
      readonly replay: boolean
    }
  | {
      readonly type: 'issueOrder'
      readonly order: CounterstrikeOrder
      readonly clockMs: number
    }
  | { readonly type: 'advance'; readonly clockMs: number }
  | { readonly type: 'contact'; readonly launchAtMs: number; readonly clockMs: number }
  | { readonly type: 'fire'; readonly clockMs: number }
  | { readonly type: 'shiftClock'; readonly durationMs: number }
  | {
      readonly type: 'restoreAccepted'
      readonly outcome: CounterstrikeOutcome | null
      readonly order?: CounterstrikeOrder | null
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
    detectedAtMs: null,
    selectedOrder: null,
    orderIssuedAtMs: null,
    acceptedOutcome: null,
    acceptedOrder: null,
    productionDamagePenalty: 0,
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
  order: CounterstrikeOrder,
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
    selectedOrder: order,
    acceptedOrder: order,
    productionDamagePenalty:
      success ? 0 : order === 'HARDEN_OUTPOST' ? 0.15 : 0.3,
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
    case 'detect': {
      if (!state.available || state.detectedAtMs !== null) return state
      const timestamp = transitionTimestamp(state, action.nowMs)
      return { ...state, updatedAtMs: timestamp, detectedAtMs: timestamp }
    }
    case 'issueOrder': {
      if (!state.available || state.acceptedOutcome !== null) return state
      const timestamp = transitionTimestamp(state, action.nowMs)
      return {
        ...state,
        updatedAtMs: timestamp,
        detectedAtMs: state.detectedAtMs ?? timestamp,
        selectedOrder: action.order,
        orderIssuedAtMs: timestamp,
      }
    }
    case 'unlock':
      return unlockCounterstrike(state, action.firstStrike, action.nowMs)
    case 'acceptOutcome':
      return acceptCounterstrikeOutcome(
        state,
        action.outcome,
        action.order,
        action.outpost,
        action.nowMs,
      )
    case 'completeRepairs': {
      if (
        state.acceptedOutcome !== 'FAILURE' ||
        state.outpostDamageState !== 'DAMAGED' ||
        !state.repairsRequired
      ) {
        return state
      }
      const timestamp = transitionTimestamp(state, action.nowMs)
      return {
        ...state,
        updatedAtMs: timestamp,
        productionDamagePenalty: 0,
        outpostDamageState: 'INTACT',
        repairsRequired: false,
      }
    }
  }
}

export function createCounterstrikeRunState(
  snapshot: CounterstrikeSnapshot | null,
  clockMs = 0,
): CounterstrikeRunState {
  assertTimestamp(clockMs, 'Counterstrike clock')
  const restoredOutcome = snapshot?.acceptedOutcome ?? null
  const pendingOrder = snapshot?.selectedOrder ?? null
  const pendingStatus =
    snapshot?.available === true && snapshot.detectedAtMs !== null
      ? pendingOrder === null
        ? 'command'
        : 'warning'
      : 'dormant'

  return {
    status: restoredOutcome === null ? pendingStatus : 'resolved',
    phaseStartedAtMs: clockMs,
    attemptStartedAtMs: null,
    attemptNumber: 0,
    attemptsUsed: 0,
    judgement: null,
    attemptElapsedAtFireMs: null,
    outcome: restoredOutcome,
    order:
      restoredOutcome === null ? pendingOrder : snapshot?.acceptedOrder ?? null,
    replay: false,
    threatProgressStart: 0,
    threatProgressEnd: 0,
    contact: null,
    interceptRouteProgress: null,
  }
}

export function judgeInterceptionTiming(
  attemptElapsedMs: number,
  order: CounterstrikeOrder | null = null,
): InterceptionJudgement {
  assertTimestamp(attemptElapsedMs, 'Interception timing')

  const timing = getCounterstrikeTimingProfile(order)
  if (attemptElapsedMs < timing.validWindowStartMs) {
    return 'EARLY'
  }
  if (attemptElapsedMs <= timing.validWindowEndMs) {
    return 'VALID'
  }
  return 'LATE'
}

export function getCounterstrikeRunDurationMs(
  run: CounterstrikeRunState,
): number | null {
  switch (run.status) {
    case 'command-confirmed':
      return COUNTERSTRIKE_TIMING.commandConfirmationMs
    case 'warning':
      return COUNTERSTRIKE_TIMING.warningMs
    case 'tracking':
      return getCounterstrikeTimingProfile(run.order).trackingMs
    case 'intercept-ready':
      return getCounterstrikeTimingProfile(run.order).readyMs
    case 'interceptor-launched':
      return run.judgement === 'VALID'
        ? COUNTERSTRIKE_TIMING.launchedValidMs * (run.contact?.flightProgress ?? 1)
        : COUNTERSTRIKE_TIMING.launchedMissMs
    case 'success':
      return COUNTERSTRIKE_TIMING.successMs
    case 'missed':
      return COUNTERSTRIKE_TIMING.missedMs
    case 'impact':
      return COUNTERSTRIKE_TIMING.impactMs
    case 'dormant':
    case 'command':
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

export function getInterceptorFlightProgress(run: CounterstrikeRunState, clockMs: number): number {
  const duration = run.judgement === 'VALID' ? COUNTERSTRIKE_TIMING.launchedValidMs : COUNTERSTRIKE_TIMING.launchedMissMs
  return Math.max(0, Math.min(1, (clockMs - run.phaseStartedAtMs) / duration))
}

export function getCounterstrikeThreatProgress(
  run: CounterstrikeRunState,
  clockMs: number,
): number {
  const progress = run.status === 'interceptor-launched'
    ? getInterceptorFlightProgress(run, clockMs) : getCounterstrikeRunProgress(run, clockMs)
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
    contact: null,
    interceptRouteProgress: null,
  }
}

function advanceRun(
  run: CounterstrikeRunState,
  clockMs: number,
): CounterstrikeRunState {
  switch (run.status) {
    case 'command-confirmed':
      return {
        ...run,
        status: 'warning',
        phaseStartedAtMs: clockMs,
        threatProgressStart: 0,
        threatProgressEnd: 0.08,
      }
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
      if (run.contact !== null) return run // Only the authoritative contact event may resolve this flight.
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
    case 'command':
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
  const judgement = judgeInterceptionTiming(attemptElapsedMs, run.order)
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
        status: 'command',
        phaseStartedAtMs: action.clockMs,
        attemptStartedAtMs: null,
        attemptNumber: 0,
        attemptsUsed: 0,
        judgement: null,
        attemptElapsedAtFireMs: null,
        outcome: null,
        order: null,
        replay: action.replay,
        threatProgressStart: 0,
        threatProgressEnd: 0.08,
        contact: null,
    interceptRouteProgress: null,
      }
    case 'issueOrder':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      if (run.status !== 'command') return run
      return {
        ...run,
        status: 'command-confirmed',
        phaseStartedAtMs: action.clockMs,
        order: action.order,
      }
    case 'advance':
      assertTimestamp(action.clockMs, 'Counterstrike clock')
      return advanceRun(run, action.clockMs)
    case 'contact': {
      assertTimestamp(action.clockMs, 'Contact clock')
      if (run.status !== 'interceptor-launched' || run.judgement !== 'VALID' || run.contact === null ||
          action.launchAtMs !== run.phaseStartedAtMs) return run
      const contactAtMs = run.phaseStartedAtMs + COUNTERSTRIKE_TIMING.launchedValidMs * run.contact.flightProgress
      if (action.clockMs < contactAtMs) return run
      return { ...run, status: 'success', outcome: 'SUCCESS', phaseStartedAtMs: contactAtMs,
        threatProgressStart: run.contact.threatProgress, threatProgressEnd: run.contact.threatProgress }
    }
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
        order: action.order ?? null,
      }
    case 'reset':
      return createCounterstrikeRunState(null, action.clockMs)
  }
}

export function counterstrikeNeedsContinuousFrames(
  status: CounterstrikeRunStatus,
): boolean {
  return status !== 'dormant' && status !== 'resolved' && status !== 'command'
}
