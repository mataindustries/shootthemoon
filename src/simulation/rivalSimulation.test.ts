import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import { RIVAL_IDENTITY_ID } from '../domain/rival.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  advanceOutpost,
  constructExtractor,
  createInitialOutpost,
} from './outpostSimulation.ts'
import {
  createInitialRivalSignal,
  createMigratedRivalSignal,
  fortifyRivalSignal,
  normalizeRivalSignalForResume,
  rivalSignalReducer,
  type RivalSignalAction,
} from './rivalSimulation.ts'

const START_MS = 20_000
const SITE = createLandingSite(createLunarLocation(0.42, -2.7, 18))
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]?.id ?? 'deposit-alpha'

function extractorOutpost() {
  const initial = createInitialOutpost(SITE, START_MS)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 100,
    robot: {
      ...initial.robot,
      state: 'idle' as const,
    },
  }
  const construction = constructExtractor(prepared, DEPOSIT_ID, START_MS + 10)

  return advanceOutpost(
    construction,
    START_MS + 10 + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

function reduce(
  actions: readonly RivalSignalAction[],
  initial = createInitialRivalSignal(SITE, START_MS),
) {
  return actions.reduce(rivalSignalReducer, initial)
}

function revealedRival() {
  const outpost = extractorOutpost()
  const result = reduce([
    { type: 'extractorActivated', outpost, nowMs: START_MS + 3_000 },
    { type: 'beginCinematic', nowMs: START_MS + 3_100 },
    { type: 'completeIntroTransmission', nowMs: START_MS + 3_200 },
    { type: 'completeCinematic', nowMs: START_MS + 3_300 },
  ])

  if (result === null) {
    throw new Error('Expected a revealed rival fixture.')
  }

  return result
}

describe('rival signal progression', () => {
  it('never queues before an extractor is active and triggers only once', () => {
    const rival = createInitialRivalSignal(SITE, START_MS)
    const inactiveOutpost = createInitialOutpost(SITE, START_MS)
    const activeOutpost = extractorOutpost()
    const early = rivalSignalReducer(rival, {
      type: 'extractorActivated',
      outpost: inactiveOutpost,
      nowMs: START_MS + 100,
    })
    const queued = rivalSignalReducer(rival, {
      type: 'extractorActivated',
      outpost: activeOutpost,
      nowMs: START_MS + 3_000,
    })
    const duplicate = rivalSignalReducer(queued, {
      type: 'extractorActivated',
      outpost: activeOutpost,
      nowMs: START_MS + 4_000,
    })

    expect(early).toBe(rival)
    expect(queued?.revealStatus).toBe('QUEUED')
    expect(queued?.revealTriggeredAtMs).toBe(START_MS + 3_000)
    expect(duplicate).toBe(queued)
  })

  it('defers a migrated active extractor until an explicit safe moment', () => {
    const migrated = createMigratedRivalSignal(
      extractorOutpost(),
      START_MS + 4_000,
    )
    const queued = rivalSignalReducer(migrated, {
      type: 'safeMomentReached',
      nowMs: START_MS + 4_500,
    })

    expect(migrated.identityId).toBe(RIVAL_IDENTITY_ID)
    expect(migrated.revealStatus).toBe('AWAITING_SAFE_MOMENT')
    expect(migrated.stage).toBeNull()
    expect(queued?.revealStatus).toBe('QUEUED')
  })

  it('normalizes interrupted camera travel without replaying completed copy', () => {
    const outpost = extractorOutpost()
    const cinematic = reduce([
      { type: 'extractorActivated', outpost, nowMs: START_MS + 3_000 },
      { type: 'beginCinematic', nowMs: START_MS + 3_100 },
      { type: 'completeIntroTransmission', nowMs: START_MS + 3_200 },
    ])

    if (cinematic === null) {
      throw new Error('Expected a cinematic rival fixture.')
    }

    const normalized = normalizeRivalSignalForResume(
      cinematic,
      START_MS + 4_000,
    )

    expect(normalized.revealStatus).toBe('QUEUED')
    expect(normalized.stage).toBeNull()
    expect(normalized.introTransmissionCompleted).toBe(true)
    expect(normalized.introTransmissionCompletedAtMs).toBe(START_MS + 3_200)
  })

  it('commits LANDED once and persists viewed, replay, and skip eligibility', () => {
    const rival = revealedRival()
    const duplicate = rivalSignalReducer(rival, {
      type: 'completeCinematic',
      nowMs: START_MS + 9_000,
    })

    expect(rival.revealStatus).toBe('REVEALED')
    expect(rival.stage).toBe('LANDED')
    expect(rival.cinematicCompleted).toBe(true)
    expect(rival.cinematicViewedOnce).toBe(true)
    expect(rival.replayEligible).toBe(true)
    expect(rival.skipEligible).toBe(true)
    expect(duplicate).toBe(rival)
  })

  it('advances the first completed scan deterministically to ESTABLISHING', () => {
    const landed = revealedRival()
    const scanned = rivalSignalReducer(landed, {
      type: 'completeScan',
      nowMs: START_MS + 4_000,
    })
    const duplicate = rivalSignalReducer(scanned, {
      type: 'completeScan',
      nowMs: START_MS + 5_000,
    })
    const responded = rivalSignalReducer(scanned, {
      type: 'completeScanResponse',
      nowMs: START_MS + 4_100,
    })

    expect(scanned?.stage).toBe('ESTABLISHING')
    expect(scanned?.stageChangedAtMs).toBe(START_MS + 4_000)
    expect(scanned?.scanCompletedAtMs).toBe(START_MS + 4_000)
    expect(duplicate).toBe(scanned)
    expect(responded?.scanResponseCompleted).toBe(true)
    expect(responded?.scanResponseCompletedAtMs).toBe(START_MS + 4_100)
  })

  it('represents FORTIFIED only through the explicit pure transition', () => {
    const establishing = rivalSignalReducer(revealedRival(), {
      type: 'completeScan',
      nowMs: START_MS + 4_000,
    })

    if (establishing === null) {
      throw new Error('Expected an establishing rival fixture.')
    }

    const fortified = fortifyRivalSignal(establishing, START_MS + 8_000)
    const duplicate = fortifyRivalSignal(fortified, START_MS + 9_000)

    expect(fortified.stage).toBe('FORTIFIED')
    expect(fortified.stageChangedAtMs).toBe(START_MS + 8_000)
    expect(duplicate).toBe(fortified)
  })

  it('resets the complete rival prototype state', () => {
    expect(rivalSignalReducer(revealedRival(), { type: 'reset' })).toBeNull()
  })

  it('establishes the dormant rival source once for a fresh outpost', () => {
    const established = rivalSignalReducer(null, {
      type: 'establish',
      playerSite: SITE,
      nowMs: START_MS,
    })
    const duplicate = rivalSignalReducer(established, {
      type: 'establish',
      playerSite: createLandingSite(createLunarLocation(-0.2, 0.9)),
      nowMs: START_MS + 100,
    })

    expect(established?.revealStatus).toBe('DORMANT')
    expect(duplicate).toBe(established)
  })
})
