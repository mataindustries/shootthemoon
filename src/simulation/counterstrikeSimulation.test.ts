import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import {
  deriveSecondaryImpactOffset,
  deriveSecondaryImpactSite,
} from '../domain/counterstrike.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  advanceOutpost,
  constructExtractor,
  createInitialOutpost,
} from './outpostSimulation.ts'
import { createInitialFirstStrike } from './firstStrikeSimulation.ts'
import {
  COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS,
  COUNTERSTRIKE_TIMING,
  counterstrikeFactsReducer,
  counterstrikeRunReducer,
  createCounterstrikeRunState,
  createInitialCounterstrike,
  getCounterstrikeAttemptElapsedMs,
  getCounterstrikeTimingProfile,
  judgeInterceptionTiming,
} from './counterstrikeSimulation.ts'

const SITE = createLandingSite(createLunarLocation(0.248, -0.684, 18))
const START_MS = 40_000
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]!.id

function activeOutpost() {
  const initial = createInitialOutpost(SITE, START_MS)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 95,
    robot: { ...initial.robot, state: 'idle' as const },
  }
  return advanceOutpost(
    constructExtractor(prepared, DEPOSIT_ID, START_MS + 100),
    START_MS + 100 + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

function completedFirstStrike() {
  const initial = createInitialFirstStrike(START_MS)
  return {
    ...initial,
    status: 'COMPLETE' as const,
    updatedAtMs: START_MS + 1_000,
    available: true,
    availableAtMs: START_MS + 100,
    armedAtMs: START_MS + 200,
    launchConfirmedAtMs: START_MS + 300,
    launchCompleted: true,
    launchCompletedAtMs: START_MS + 400,
    finalVesperTransmissionCompleted: true,
    finalVesperTransmissionCompletedAtMs: START_MS + 500,
    impactCompleted: true,
    impactCompletedAtMs: START_MS + 600,
    rivalFootholdDamaged: true,
    permanentScarCreated: true,
    endingCompleted: true,
    endingCompletedAtMs: START_MS + 1_000,
  }
}

function beginTracking() {
  let run = createCounterstrikeRunState(null, 0)
  run = counterstrikeRunReducer(run, {
    type: 'begin',
    clockMs: 1_000,
    replay: false,
  })
  run = counterstrikeRunReducer(run, {
    type: 'issueOrder',
    order: 'KEEP_EXTRACTING',
    clockMs: 1_100,
  })
  run = counterstrikeRunReducer(run, {
    type: 'advance',
    clockMs: 1_100 + COUNTERSTRIKE_TIMING.commandConfirmationMs,
  })
  return counterstrikeRunReducer(run, {
    type: 'advance',
    clockMs:
      1_100 +
      COUNTERSTRIKE_TIMING.commandConfirmationMs +
      COUNTERSTRIKE_TIMING.warningMs,
  })
}

describe('Vesper Counterstrike timing and state machine', () => {
  it('keeps the longest unattended escalation within 20–35 seconds', () => {
    expect(COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS).toBe(33_010)
    expect(COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS).toBeGreaterThan(20_000)
    expect(COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS).toBeLessThan(35_000)
    expect(
      COUNTERSTRIKE_TIMING.warningMs +
        COUNTERSTRIKE_TIMING.validWindowStartMs +
        COUNTERSTRIKE_TIMING.launchedValidMs +
        COUNTERSTRIKE_TIMING.successMs,
    ).toBe(20_000)
  })

  it('defines inclusive, deterministic timing-window boundaries', () => {
    expect(judgeInterceptionTiming(5_799.999)).toBe('EARLY')
    expect(judgeInterceptionTiming(5_800)).toBe('VALID')
    expect(judgeInterceptionTiming(8_200)).toBe('VALID')
    expect(judgeInterceptionTiming(8_200.001)).toBe('LATE')
    expect(COUNTERSTRIKE_TIMING.validWindowMs).toBe(2_400)
    expect(
      COUNTERSTRIKE_TIMING.validWindowEndMs -
        COUNTERSTRIKE_TIMING.validWindowStartMs,
    ).toBe(COUNTERSTRIKE_TIMING.validWindowMs)
    expect(COUNTERSTRIKE_TIMING.readyMs).toBe(
      COUNTERSTRIKE_TIMING.validWindowMs,
    )
  })

  it('widens only the prioritized interceptor window by exactly 40%', () => {
    const normal = getCounterstrikeTimingProfile('KEEP_EXTRACTING')
    const hardened = getCounterstrikeTimingProfile('HARDEN_OUTPOST')
    const prioritized = getCounterstrikeTimingProfile(
      'PRIORITIZE_INTERCEPTOR',
    )

    expect(hardened).toEqual(normal)
    expect(prioritized.validWindowMs).toBe(normal.validWindowMs * 1.4)
    expect(judgeInterceptionTiming(5_500, 'KEEP_EXTRACTING')).toBe('EARLY')
    expect(judgeInterceptionTiming(5_500, 'PRIORITIZE_INTERCEPTOR')).toBe(
      'VALID',
    )
  })

  it.each([
    { name: 'early', offset: 2_000, judgement: 'EARLY', result: 'missed' },
    { name: 'valid', offset: 7_000, judgement: 'VALID', result: 'success' },
    { name: 'late', offset: 8_600, judgement: 'LATE', result: 'missed' },
  ] as const)('classifies a $name interception attempt', ({
    offset,
    judgement,
    result,
  }) => {
    let run = beginTracking()
    const attemptStartedAtMs = run.attemptStartedAtMs!
    if (offset >= COUNTERSTRIKE_TIMING.trackingMs) {
      run = counterstrikeRunReducer(run, {
        type: 'advance',
        clockMs: attemptStartedAtMs + COUNTERSTRIKE_TIMING.trackingMs,
      })
    }
    run = counterstrikeRunReducer(run, {
      type: 'fire',
      clockMs: attemptStartedAtMs + offset,
    })

    expect(run.status).toBe('interceptor-launched')
    expect(run.judgement).toBe(judgement)
    expect(run.attemptElapsedAtFireMs).toBe(offset)
    expect(run.attemptsUsed).toBe(1)

    const duplicateFire = counterstrikeRunReducer(run, {
      type: 'fire',
      clockMs: attemptStartedAtMs + offset + 10,
    })
    expect(duplicateFire).toBe(run)

    run = counterstrikeRunReducer(run, {
      type: 'advance',
      clockMs: attemptStartedAtMs + offset + 5_000,
    })
    expect(run.status).toBe(result)
  })

  it('allows no more than two attempts and resolves an unattended run as failure', () => {
    let run = beginTracking()

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      run = counterstrikeRunReducer(run, {
        type: 'advance',
        clockMs: run.phaseStartedAtMs + COUNTERSTRIKE_TIMING.trackingMs,
      })
      run = counterstrikeRunReducer(run, {
        type: 'advance',
        clockMs: run.phaseStartedAtMs + COUNTERSTRIKE_TIMING.readyMs,
      })
      expect(run.status).toBe('missed')
      expect(run.attemptsUsed).toBe(attempt)
      run = counterstrikeRunReducer(run, {
        type: 'advance',
        clockMs: run.phaseStartedAtMs + COUNTERSTRIKE_TIMING.missedMs,
      })
    }

    expect(run.status).toBe('impact')
    const ignored = counterstrikeRunReducer(run, {
      type: 'fire',
      clockMs: run.phaseStartedAtMs + 100,
    })
    expect(ignored).toBe(run)
    run = counterstrikeRunReducer(run, {
      type: 'advance',
      clockMs: run.phaseStartedAtMs + COUNTERSTRIKE_TIMING.impactMs,
    })
    expect(run).toMatchObject({ status: 'resolved', outcome: 'FAILURE' })
  })

  it('shifts active clocks across visibility suspension without consuming the window', () => {
    let run = beginTracking()
    const elapsedBefore = getCounterstrikeAttemptElapsedMs(
      run,
      run.phaseStartedAtMs + 2_400,
    )
    run = counterstrikeRunReducer(run, {
      type: 'shiftClock',
      durationMs: 31_000,
    })
    const elapsedAfter = getCounterstrikeAttemptElapsedMs(
      run,
      run.phaseStartedAtMs + 2_400,
    )

    expect(elapsedBefore).toBe(2_400)
    expect(elapsedAfter).toBe(2_400)
  })

  it('replay starts at command and restores the deliberately accepted ending', () => {
    const accepted = {
      ...createInitialCounterstrike(START_MS),
      available: true,
      availableAtMs: START_MS,
      acceptedOutcome: 'SUCCESS' as const,
      selectedOrder: 'PRIORITIZE_INTERCEPTOR' as const,
      acceptedOrder: 'PRIORITIZE_INTERCEPTOR' as const,
      interceptionSucceeded: true,
      replayEligible: true,
      orbitalDebrisRecorded: true,
      completedAtMs: START_MS + 1,
      acceptedAtMs: START_MS + 1,
    }
    let run = createCounterstrikeRunState(accepted, 1_000)
    run = counterstrikeRunReducer(run, {
      type: 'begin',
      clockMs: 1_100,
      replay: true,
    })
    expect(run).toMatchObject({ status: 'command', replay: true, outcome: null })

    run = counterstrikeRunReducer(run, {
      type: 'restoreAccepted',
      outcome: accepted.acceptedOutcome,
      order: accepted.acceptedOrder,
      clockMs: 2_000,
    })
    expect(run).toMatchObject({
      status: 'resolved',
      replay: false,
      outcome: 'SUCCESS',
      order: 'PRIORITIZE_INTERCEPTOR',
      attemptsUsed: 0,
    })
  })
})

describe('Counterstrike accepted facts and canonical damage', () => {
  it('unlocks only after the complete First Strike ending', () => {
    const initial = createInitialCounterstrike(START_MS)
    const locked = counterstrikeFactsReducer(initial, {
      type: 'unlock',
      firstStrike: createInitialFirstStrike(START_MS),
      nowMs: START_MS + 1,
    })
    const unlocked = counterstrikeFactsReducer(initial, {
      type: 'unlock',
      firstStrike: completedFirstStrike(),
      nowMs: START_MS + 2_000,
    })

    expect(locked).toBe(initial)
    expect(unlocked).toMatchObject({ available: true, acceptedOutcome: null })
  })

  it('persists success without damage and failure without mutating outpost facts', () => {
    const outpost = activeOutpost()
    const unlocked = {
      ...createInitialCounterstrike(START_MS),
      available: true,
      availableAtMs: START_MS,
    }
    const success = counterstrikeFactsReducer(unlocked, {
      type: 'acceptOutcome',
      outcome: 'SUCCESS',
      order: 'PRIORITIZE_INTERCEPTOR',
      outpost,
      nowMs: START_MS + 100,
    })!
    const failure = counterstrikeFactsReducer(success, {
      type: 'acceptOutcome',
      outcome: 'FAILURE',
      order: 'HARDEN_OUTPOST',
      outpost,
      nowMs: START_MS + 200,
    })!

    expect(success).toMatchObject({
      acceptedOutcome: 'SUCCESS',
      interceptionSucceeded: true,
      outpostDamageState: 'INTACT',
      orbitalDebrisRecorded: true,
      repairsRequired: false,
      secondaryImpactSite: null,
    })
    expect(failure).toMatchObject({
      acceptedOutcome: 'FAILURE',
      acceptedOrder: 'HARDEN_OUTPOST',
      productionDamagePenalty: 0.15,
      interceptionSucceeded: false,
      outpostDamageState: 'DAMAGED',
      orbitalDebrisRecorded: false,
      repairsRequired: true,
    })
    const repaired = counterstrikeFactsReducer(failure, {
      type: 'completeRepairs',
      nowMs: START_MS + 300,
    })!
    expect(repaired).toMatchObject({
      acceptedOutcome: 'FAILURE',
      productionDamagePenalty: 0,
      outpostDamageState: 'INTACT',
      repairsRequired: false,
      secondaryImpactSite: failure.secondaryImpactSite,
    })
    expect(
      counterstrikeFactsReducer(repaired, {
        type: 'completeRepairs',
        nowMs: START_MS + 400,
      }),
    ).toBe(repaired)
    expect(outpost.extractor?.status).toBe('active')
    expect(outpost.lunarOre).toBe(activeOutpost().lunarOre)
  })

  it('places the secondary impact canonically near, but never on, the outpost center', () => {
    const outpost = activeOutpost()
    const first = deriveSecondaryImpactSite(outpost)
    const second = deriveSecondaryImpactSite(outpost)
    const offset = deriveSecondaryImpactOffset(outpost)
    const distanceM = Math.hypot(offset.xM, offset.zM)
    const extractorDistanceM = Math.hypot(
      offset.xM - outpost.extractor!.position.xM,
      offset.zM - outpost.extractor!.position.zM,
    )

    expect(first).toEqual(second)
    expect(first).not.toEqual(outpost.site)
    expect(first.location.heightM).toBe(0)
    expect(distanceM).toBeGreaterThan(15)
    expect(distanceM).toBeLessThan(35)
    expect(extractorDistanceM).toBeCloseTo(8.4, 10)
  })

  it('reset clears accepted Counterstrike facts', () => {
    expect(
      counterstrikeFactsReducer(createInitialCounterstrike(START_MS), {
        type: 'reset',
      }),
    ).toBeNull()
  })
})
