import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import {
  FIRST_STRIKE_ID,
  LUNAR_SCAR_ID,
  type FirstStrikeSnapshot,
} from '../domain/firstStrike.ts'

export type FirstStrikeAction =
  | { readonly type: 'establish'; readonly nowMs: number }
  | {
      readonly type: 'unlock'
      readonly outpost: OutpostSnapshot
      readonly rival: RivalSignalSnapshot
      readonly nowMs: number
    }
  | { readonly type: 'arm'; readonly nowMs: number }
  | { readonly type: 'cancelLaunchConfirmation' }
  | { readonly type: 'fire'; readonly nowMs: number }
  | { readonly type: 'completeLaunch'; readonly nowMs: number }
  | { readonly type: 'completeFinalTransmission'; readonly nowMs: number }
  | {
      readonly type: 'completeImpact'
      readonly rivalSite: LandingSite
      readonly nowMs: number
    }
  | { readonly type: 'completeEnding'; readonly nowMs: number }
  | { readonly type: 'reset' }

function assertTimestamp(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError('First Strike timestamps must be finite and non-negative.')
  }
}

function transitionTimestamp(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): number {
  assertTimestamp(nowMs)
  return Math.max(strike.updatedAtMs, nowMs)
}

export function createInitialFirstStrike(nowMs: number): FirstStrikeSnapshot {
  assertTimestamp(nowMs)

  return {
    id: FIRST_STRIKE_ID,
    status: 'LOCKED',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    available: false,
    availableAtMs: null,
    armedAtMs: null,
    launchConfirmedAtMs: null,
    launchCompleted: false,
    launchCompletedAtMs: null,
    finalVesperTransmissionCompleted: false,
    finalVesperTransmissionCompletedAtMs: null,
    impactCompleted: false,
    impactCompletedAtMs: null,
    rivalFootholdDamaged: false,
    permanentScarCreated: false,
    scar: null,
    endingCompleted: false,
    endingCompletedAtMs: null,
  }
}

export function canUnlockFirstStrike(
  outpost: OutpostSnapshot,
  rival: RivalSignalSnapshot,
): boolean {
  return (
    outpost.stage === 'extractor-active' &&
    outpost.extractor?.status === 'active' &&
    rival.cinematicCompleted &&
    rival.scanCompleted
  )
}

export function createMigratedFirstStrike(
  outpost: OutpostSnapshot,
  rival: RivalSignalSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  const initial = createInitialFirstStrike(
    Math.min(outpost.establishedAtMs, nowMs),
  )

  // A v1/v2 save waiting on Vesper's response still completes that response
  // first. A response already seen restores directly to the unlocked protocol.
  if (!rival.scanResponseCompleted || !canUnlockFirstStrike(outpost, rival)) {
    return { ...initial, updatedAtMs: nowMs }
  }

  return {
    ...initial,
    status: 'READY',
    updatedAtMs: nowMs,
    available: true,
    availableAtMs: Math.min(rival.scanResponseCompletedAtMs ?? nowMs, nowMs),
  }
}

export function normalizeFirstStrikeForResume(
  strike: FirstStrikeSnapshot,
  rivalSite: LandingSite,
  nowMs: number,
): FirstStrikeSnapshot {
  const timestamp = transitionTimestamp(strike, nowMs)

  if (strike.impactCompleted) {
    const impactAtMs = strike.impactCompletedAtMs ?? timestamp
    return {
      ...strike,
      status: 'COMPLETE',
      updatedAtMs: timestamp,
      available: true,
      launchCompleted: true,
      launchCompletedAtMs: strike.launchCompletedAtMs ?? impactAtMs,
      rivalFootholdDamaged: true,
      permanentScarCreated: true,
      scar: strike.scar ?? {
        id: LUNAR_SCAR_ID,
        site: rivalSite,
        createdAtMs: impactAtMs,
      },
      endingCompleted: true,
      endingCompletedAtMs: strike.endingCompletedAtMs ?? timestamp,
    }
  }

  if (strike.status === 'LAUNCHING' || strike.status === 'IMPACTED') {
    return {
      ...strike,
      status: 'ARMED',
      updatedAtMs: timestamp,
      launchConfirmedAtMs: null,
      launchCompleted: false,
      launchCompletedAtMs: null,
    }
  }

  return strike.updatedAtMs === timestamp
    ? strike
    : { ...strike, updatedAtMs: timestamp }
}

function unlock(
  strike: FirstStrikeSnapshot,
  outpost: OutpostSnapshot,
  rival: RivalSignalSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (
    strike.status !== 'LOCKED' ||
    !canUnlockFirstStrike(outpost, rival)
  ) {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    status: 'READY',
    updatedAtMs: timestamp,
    available: true,
    availableAtMs: timestamp,
  }
}

function arm(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (strike.status !== 'READY') {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    status: 'ARMED',
    updatedAtMs: timestamp,
    armedAtMs: timestamp,
  }
}

function fire(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (strike.status !== 'ARMED') {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    status: 'LAUNCHING',
    updatedAtMs: timestamp,
    launchConfirmedAtMs: timestamp,
  }
}

function completeLaunch(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (strike.status !== 'LAUNCHING' || strike.launchCompleted) {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    updatedAtMs: timestamp,
    launchCompleted: true,
    launchCompletedAtMs: timestamp,
  }
}

function completeFinalTransmission(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (
    strike.status !== 'LAUNCHING' ||
    strike.finalVesperTransmissionCompleted
  ) {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    updatedAtMs: timestamp,
    finalVesperTransmissionCompleted: true,
    finalVesperTransmissionCompletedAtMs: timestamp,
  }
}

function completeImpact(
  strike: FirstStrikeSnapshot,
  rivalSite: LandingSite,
  nowMs: number,
): FirstStrikeSnapshot {
  if (
    strike.status !== 'LAUNCHING' ||
    !strike.launchCompleted ||
    strike.impactCompleted
  ) {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    status: 'IMPACTED',
    updatedAtMs: timestamp,
    impactCompleted: true,
    impactCompletedAtMs: timestamp,
    rivalFootholdDamaged: true,
    permanentScarCreated: true,
    scar: {
      id: LUNAR_SCAR_ID,
      site: rivalSite,
      createdAtMs: timestamp,
    },
  }
}

function completeEnding(
  strike: FirstStrikeSnapshot,
  nowMs: number,
): FirstStrikeSnapshot {
  if (strike.status !== 'IMPACTED' || !strike.impactCompleted) {
    return strike
  }

  const timestamp = transitionTimestamp(strike, nowMs)
  return {
    ...strike,
    status: 'COMPLETE',
    updatedAtMs: timestamp,
    endingCompleted: true,
    endingCompletedAtMs: timestamp,
  }
}

export function firstStrikeReducer(
  state: FirstStrikeSnapshot | null,
  action: FirstStrikeAction,
): FirstStrikeSnapshot | null {
  if (action.type === 'reset') {
    return null
  }

  if (action.type === 'establish') {
    return state ?? createInitialFirstStrike(action.nowMs)
  }

  if (state === null) {
    return null
  }

  switch (action.type) {
    case 'unlock':
      return unlock(state, action.outpost, action.rival, action.nowMs)
    case 'arm':
      return arm(state, action.nowMs)
    case 'cancelLaunchConfirmation':
      return state
    case 'fire':
      return fire(state, action.nowMs)
    case 'completeLaunch':
      return completeLaunch(state, action.nowMs)
    case 'completeFinalTransmission':
      return completeFinalTransmission(state, action.nowMs)
    case 'completeImpact':
      return completeImpact(state, action.rivalSite, action.nowMs)
    case 'completeEnding':
      return completeEnding(state, action.nowMs)
  }
}
