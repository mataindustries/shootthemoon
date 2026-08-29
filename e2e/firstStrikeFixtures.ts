import {
  createLandingSite,
  createLunarLocation,
} from '../src/domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS } from '../src/domain/outpost.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  advanceOutpost,
  constructExtractor,
  createInitialOutpost,
} from '../src/simulation/outpostSimulation.ts'
import {
  createInitialRivalSignal,
  rivalSignalReducer,
} from '../src/simulation/rivalSimulation.ts'
import {
  createMigratedFirstStrike,
  firstStrikeReducer,
} from '../src/simulation/firstStrikeSimulation.ts'
import { serializePrototypeSave } from '../src/persistence/outpostSave.ts'

const SITE = createLandingSite(createLunarLocation(0.248, -0.684, 18))
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]!.id

function readyPrototype(nowMs: number) {
  const establishedAtMs = nowMs - 15_000
  const initial = createInitialOutpost(SITE, establishedAtMs)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 95,
    robot: {
      ...initial.robot,
      state: 'idle' as const,
      stateStartedAtMs: establishedAtMs + 1_700,
    },
  }
  const constructionStartedAtMs = nowMs - 7_000
  const construction = constructExtractor(
    prepared,
    DEPOSIT_ID,
    constructionStartedAtMs,
  )
  const outpost = advanceOutpost(
    construction,
    constructionStartedAtMs + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
  let rival = createInitialRivalSignal(outpost.site, establishedAtMs)
  rival = rivalSignalReducer(rival, {
    type: 'extractorActivated',
    outpost,
    nowMs: nowMs - 5_800,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'beginCinematic',
    nowMs: nowMs - 5_700,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeIntroTransmission',
    nowMs: nowMs - 5_600,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeCinematic',
    nowMs: nowMs - 5_500,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeScan',
    nowMs: nowMs - 5_400,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeScanResponse',
    nowMs: nowMs - 5_300,
  })!
  const firstStrike = createMigratedFirstStrike(outpost, rival, nowMs - 5_200)

  return { outpost, rival, firstStrike }
}

export function createStrikeReadySave(nowMs = Date.now()): string {
  return serializePrototypeSave(readyPrototype(nowMs), nowMs)
}

export function createCompletedStrikeSave(nowMs = Date.now()): string {
  const prototype = readyPrototype(nowMs)
  let strike = firstStrikeReducer(prototype.firstStrike, {
    type: 'arm',
    nowMs: nowMs - 4_900,
  })!
  strike = firstStrikeReducer(strike, {
    type: 'fire',
    nowMs: nowMs - 4_800,
  })!
  strike = firstStrikeReducer(strike, {
    type: 'completeLaunch',
    nowMs: nowMs - 4_700,
  })!
  strike = firstStrikeReducer(strike, {
    type: 'completeFinalTransmission',
    nowMs: nowMs - 4_600,
  })!
  strike = firstStrikeReducer(strike, {
    type: 'completeImpact',
    rivalSite: prototype.rival.site,
    nowMs: nowMs - 4_500,
  })!
  strike = firstStrikeReducer(strike, {
    type: 'completeEnding',
    nowMs: nowMs - 4_400,
  })!

  return serializePrototypeSave({ ...prototype, firstStrike: strike }, nowMs)
}
