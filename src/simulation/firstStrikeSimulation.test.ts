import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  advanceOutpost,
  constructExtractor,
  createInitialOutpost,
} from './outpostSimulation.ts'
import {
  createInitialRivalSignal,
  rivalSignalReducer,
} from './rivalSimulation.ts'
import {
  canUnlockFirstStrike,
  createInitialFirstStrike,
  firstStrikeReducer,
  normalizeFirstStrikeForResume,
} from './firstStrikeSimulation.ts'

const SITE = createLandingSite(createLunarLocation(0.31, -2.82, 14))
const START_MS = 12_000
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]!.id

function activeExtractorOutpost() {
  const initial = createInitialOutpost(SITE, START_MS)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 95,
    robot: { ...initial.robot, state: 'idle' as const },
  }
  const construction = constructExtractor(prepared, DEPOSIT_ID, START_MS + 100)
  return advanceOutpost(
    construction,
    START_MS + 100 + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

function scannedRival(responseCompleted = true) {
  const outpost = activeExtractorOutpost()
  let rival = createInitialRivalSignal(outpost.site, START_MS)
  rival = rivalSignalReducer(rival, {
    type: 'extractorActivated',
    outpost,
    nowMs: START_MS + 3_000,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'beginCinematic',
    nowMs: START_MS + 3_100,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeCinematic',
    nowMs: START_MS + 3_200,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeScan',
    nowMs: START_MS + 3_300,
  })!

  if (responseCompleted) {
    rival = rivalSignalReducer(rival, {
      type: 'completeScanResponse',
      nowMs: START_MS + 3_400,
    })!
  }

  return { outpost, rival }
}

function unlockedStrike() {
  const { outpost, rival } = scannedRival()
  let strike = createInitialFirstStrike(START_MS)
  strike = firstStrikeReducer(strike, {
    type: 'unlock',
    outpost,
    rival,
    nowMs: START_MS + 3_500,
  })!
  return { outpost, rival, strike }
}

describe('First Strike state machine', () => {
  it('unlocks only for an active extractor and a completed rival scan', () => {
    const initialOutpost = createInitialOutpost(SITE, START_MS)
    const initialRival = createInitialRivalSignal(SITE, START_MS)
    const { outpost, rival } = scannedRival(false)

    expect(canUnlockFirstStrike(initialOutpost, initialRival)).toBe(false)
    expect(canUnlockFirstStrike(outpost, initialRival)).toBe(false)
    expect(canUnlockFirstStrike(outpost, rival)).toBe(true)

    const initialStrike = createInitialFirstStrike(START_MS)
    const denied = firstStrikeReducer(initialStrike, {
      type: 'unlock',
      outpost,
      rival: initialRival,
      nowMs: START_MS + 3_500,
    })
    const unlocked = firstStrikeReducer(initialStrike, {
      type: 'unlock',
      outpost,
      rival,
      nowMs: START_MS + 3_500,
    })

    expect(denied).toBe(initialStrike)
    expect(unlocked).toMatchObject({ status: 'READY', available: true })
    expect(unlocked?.availableAtMs).toBe(START_MS + 3_500)
    expect(outpost.lunarOre).toBe(activeExtractorOutpost().lunarOre)
  })

  it('requires arming and deliberate fire while cancellation changes no state', () => {
    const { strike } = unlockedStrike()
    const prematureFire = firstStrikeReducer(strike, {
      type: 'fire',
      nowMs: START_MS + 3_600,
    })
    const armed = firstStrikeReducer(strike, {
      type: 'arm',
      nowMs: START_MS + 3_600,
    })!
    const cancelled = firstStrikeReducer(armed, {
      type: 'cancelLaunchConfirmation',
    })
    const fired = firstStrikeReducer(cancelled, {
      type: 'fire',
      nowMs: START_MS + 3_700,
    })

    expect(prematureFire).toBe(strike)
    expect(armed.status).toBe('ARMED')
    expect(cancelled).toBe(armed)
    expect(fired).toMatchObject({
      status: 'LAUNCHING',
      launchConfirmedAtMs: START_MS + 3_700,
    })
  })

  it('commits launch, Vesper response, exact-coordinate scar, and ending once', () => {
    const { rival, strike: ready } = unlockedStrike()
    let strike = firstStrikeReducer(ready, {
      type: 'arm',
      nowMs: START_MS + 3_600,
    })!
    strike = firstStrikeReducer(strike, {
      type: 'fire',
      nowMs: START_MS + 3_700,
    })!

    const earlyImpact = firstStrikeReducer(strike, {
      type: 'completeImpact',
      rivalSite: rival.site,
      nowMs: START_MS + 3_800,
    })
    expect(earlyImpact).toBe(strike)

    strike = firstStrikeReducer(strike, {
      type: 'completeLaunch',
      nowMs: START_MS + 3_900,
    })!
    strike = firstStrikeReducer(strike, {
      type: 'completeFinalTransmission',
      nowMs: START_MS + 4_000,
    })!
    strike = firstStrikeReducer(strike, {
      type: 'completeImpact',
      rivalSite: rival.site,
      nowMs: START_MS + 4_100,
    })!

    expect(strike).toMatchObject({
      status: 'IMPACTED',
      launchCompleted: true,
      finalVesperTransmissionCompleted: true,
      impactCompleted: true,
      rivalFootholdDamaged: true,
      permanentScarCreated: true,
    })
    expect(strike.scar?.site).toEqual(rival.site)

    strike = firstStrikeReducer(strike, {
      type: 'completeEnding',
      nowMs: START_MS + 4_200,
    })!
    const duplicate = firstStrikeReducer(strike, {
      type: 'completeEnding',
      nowMs: START_MS + 4_300,
    })
    expect(strike.status).toBe('COMPLETE')
    expect(strike.endingCompleted).toBe(true)
    expect(duplicate).toBe(strike)
  })

  it('normalizes interrupted launch to armed and confirmed impact to completed', () => {
    const { rival, strike: ready } = unlockedStrike()
    let launching = firstStrikeReducer(ready, {
      type: 'arm',
      nowMs: START_MS + 3_600,
    })!
    launching = firstStrikeReducer(launching, {
      type: 'fire',
      nowMs: START_MS + 3_700,
    })!
    launching = firstStrikeReducer(launching, {
      type: 'completeLaunch',
      nowMs: START_MS + 3_800,
    })!

    const resumedBeforeImpact = normalizeFirstStrikeForResume(
      launching,
      rival.site,
      START_MS + 5_000,
    )
    expect(resumedBeforeImpact).toMatchObject({
      status: 'ARMED',
      launchConfirmedAtMs: null,
      launchCompleted: false,
      launchCompletedAtMs: null,
      impactCompleted: false,
    })

    const impacted = firstStrikeReducer(launching, {
      type: 'completeImpact',
      rivalSite: rival.site,
      nowMs: START_MS + 4_000,
    })!
    const resumedAfterImpact = normalizeFirstStrikeForResume(
      impacted,
      rival.site,
      START_MS + 5_000,
    )
    expect(resumedAfterImpact).toMatchObject({
      status: 'COMPLETE',
      impactCompleted: true,
      endingCompleted: true,
      rivalFootholdDamaged: true,
      permanentScarCreated: true,
    })
    expect(resumedAfterImpact.scar?.site).toEqual(rival.site)
  })

  it('reset clears the full strike and a new run starts locked', () => {
    const { strike } = unlockedStrike()
    expect(firstStrikeReducer(strike, { type: 'reset' })).toBeNull()
    expect(
      firstStrikeReducer(null, { type: 'establish', nowMs: START_MS + 9_000 }),
    ).toMatchObject({ status: 'LOCKED', available: false })
  })
})
