import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import {
  RIVAL_IDENTITY_ID,
  RIVAL_SIGNAL_ID,
  deriveRivalSite,
  type RivalSignalSnapshot,
} from '../domain/rival.ts'

export type RivalSignalAction =
  | {
      readonly type: 'establish'
      readonly playerSite: LandingSite
      readonly nowMs: number
    }
  | {
      readonly type: 'extractorActivated'
      readonly outpost: OutpostSnapshot
      readonly nowMs: number
    }
  | { readonly type: 'safeMomentReached'; readonly nowMs: number }
  | { readonly type: 'beginCinematic'; readonly nowMs: number }
  | { readonly type: 'completeIntroTransmission'; readonly nowMs: number }
  | { readonly type: 'completeCinematic'; readonly nowMs: number }
  | { readonly type: 'completeScan'; readonly nowMs: number }
  | { readonly type: 'completeScanResponse'; readonly nowMs: number }
  | { readonly type: 'fortify'; readonly nowMs: number }
  | { readonly type: 'reset' }

function assertTimestamp(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError('Rival timestamps must be finite and non-negative.')
  }
}

function transitionTimestamp(
  rival: RivalSignalSnapshot,
  nowMs: number,
): number {
  assertTimestamp(nowMs)
  return Math.max(rival.updatedAtMs, nowMs)
}

export function createInitialRivalSignal(
  playerSite: LandingSite,
  nowMs: number,
): RivalSignalSnapshot {
  assertTimestamp(nowMs)
  const derived = deriveRivalSite(playerSite)

  return {
    id: RIVAL_SIGNAL_ID,
    identityId: RIVAL_IDENTITY_ID,
    site: derived.site,
    surfaceHeadingRad: derived.surfaceHeadingRad,
    revealStatus: 'DORMANT',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    revealTriggeredAtMs: null,
    stage: null,
    stageChangedAtMs: null,
    introTransmissionCompleted: false,
    introTransmissionCompletedAtMs: null,
    cinematicCompleted: false,
    cinematicCompletedAtMs: null,
    cinematicViewedOnce: false,
    replayEligible: false,
    skipEligible: false,
    scanCompleted: false,
    scanCompletedAtMs: null,
    scanResponseCompleted: false,
    scanResponseCompletedAtMs: null,
  }
}

function extractorIsActive(outpost: OutpostSnapshot): boolean {
  return (
    outpost.stage === 'extractor-active' &&
    outpost.extractor?.status === 'active'
  )
}

export function createMigratedRivalSignal(
  outpost: OutpostSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  assertTimestamp(nowMs)
  const createdAtMs = Math.min(outpost.establishedAtMs, nowMs)
  const initial = createInitialRivalSignal(outpost.site, createdAtMs)

  if (!extractorIsActive(outpost) || outpost.extractor === null) {
    return {
      ...initial,
      updatedAtMs: nowMs,
    }
  }

  return {
    ...initial,
    revealStatus: 'AWAITING_SAFE_MOMENT',
    updatedAtMs: nowMs,
    revealTriggeredAtMs: Math.min(
      outpost.extractor.activationTimestampMs,
      nowMs,
    ),
  }
}

export function normalizeRivalSignalForResume(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  const timestamp = transitionTimestamp(rival, nowMs)

  if (rival.revealStatus !== 'CINEMATIC') {
    return rival.updatedAtMs === timestamp
      ? rival
      : { ...rival, updatedAtMs: timestamp }
  }

  return {
    ...rival,
    revealStatus: 'QUEUED',
    updatedAtMs: timestamp,
  }
}

function queueReveal(
  rival: RivalSignalSnapshot,
  outpost: OutpostSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (rival.revealStatus !== 'DORMANT' || !extractorIsActive(outpost)) {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  return {
    ...rival,
    revealStatus: 'QUEUED',
    updatedAtMs: timestamp,
    revealTriggeredAtMs: timestamp,
  }
}

function releaseAtSafeMoment(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (rival.revealStatus !== 'AWAITING_SAFE_MOMENT') {
    return rival
  }

  return {
    ...rival,
    revealStatus: 'QUEUED',
    updatedAtMs: transitionTimestamp(rival, nowMs),
  }
}

function beginCinematic(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (rival.revealStatus !== 'QUEUED') {
    return rival
  }

  return {
    ...rival,
    revealStatus: 'CINEMATIC',
    updatedAtMs: transitionTimestamp(rival, nowMs),
  }
}

function completeIntroTransmission(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (
    rival.introTransmissionCompleted ||
    (rival.revealStatus !== 'CINEMATIC' &&
      rival.revealStatus !== 'REVEALED')
  ) {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  return {
    ...rival,
    updatedAtMs: timestamp,
    introTransmissionCompleted: true,
    introTransmissionCompletedAtMs: timestamp,
  }
}

function completeCinematic(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (rival.revealStatus !== 'CINEMATIC') {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  return {
    ...rival,
    revealStatus: 'REVEALED',
    updatedAtMs: timestamp,
    stage: 'LANDED',
    stageChangedAtMs: timestamp,
    cinematicCompleted: true,
    cinematicCompletedAtMs: timestamp,
    cinematicViewedOnce: true,
    replayEligible: true,
    skipEligible: true,
  }
}

function completeScan(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (
    !rival.cinematicCompleted ||
    rival.stage === null ||
    rival.scanCompleted
  ) {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  const establishesFoothold = rival.stage === 'LANDED'

  return {
    ...rival,
    updatedAtMs: timestamp,
    stage: establishesFoothold ? 'ESTABLISHING' : rival.stage,
    stageChangedAtMs: establishesFoothold
      ? timestamp
      : rival.stageChangedAtMs,
    scanCompleted: true,
    scanCompletedAtMs: timestamp,
  }
}

function completeScanResponse(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (!rival.scanCompleted || rival.scanResponseCompleted) {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  return {
    ...rival,
    updatedAtMs: timestamp,
    scanResponseCompleted: true,
    scanResponseCompletedAtMs: timestamp,
  }
}

/** Explicit future/dev transition. The normal reveal never dispatches it. */
export function fortifyRivalSignal(
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (rival.stage !== 'ESTABLISHING') {
    return rival
  }

  const timestamp = transitionTimestamp(rival, nowMs)
  return {
    ...rival,
    updatedAtMs: timestamp,
    stage: 'FORTIFIED',
    stageChangedAtMs: timestamp,
  }
}

export function rivalSignalReducer(
  state: RivalSignalSnapshot | null,
  action: RivalSignalAction,
): RivalSignalSnapshot | null {
  if (action.type === 'reset') {
    return null
  }

  if (action.type === 'establish') {
    return state ?? createInitialRivalSignal(action.playerSite, action.nowMs)
  }

  if (state === null) {
    return state
  }

  switch (action.type) {
    case 'extractorActivated':
      return queueReveal(state, action.outpost, action.nowMs)
    case 'safeMomentReached':
      return releaseAtSafeMoment(state, action.nowMs)
    case 'beginCinematic':
      return beginCinematic(state, action.nowMs)
    case 'completeIntroTransmission':
      return completeIntroTransmission(state, action.nowMs)
    case 'completeCinematic':
      return completeCinematic(state, action.nowMs)
    case 'completeScan':
      return completeScan(state, action.nowMs)
    case 'completeScanResponse':
      return completeScanResponse(state, action.nowMs)
    case 'fortify':
      return fortifyRivalSignal(state, action.nowMs)
  }
}
