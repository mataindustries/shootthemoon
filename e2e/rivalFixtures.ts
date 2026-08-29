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
import { createMigratedFirstStrike } from '../src/simulation/firstStrikeSimulation.ts'
import {
  serializeOutpostSave,
  serializePrototypeSave,
} from '../src/persistence/outpostSave.ts'

const FIXTURE_SITE = createLandingSite(
  createLunarLocation(0.248, -0.684, 18),
)
const FIXTURE_DEPOSIT_ID =
  DEPOSIT_BLUEPRINTS[0]?.id ?? 'deposit-alpha'

function createActiveExtractorOutpost(nowMs: number) {
  const establishedAtMs = nowMs - 12_000
  const initial = createInitialOutpost(FIXTURE_SITE, establishedAtMs)
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
  const constructionStartedAtMs = nowMs - 4_000
  const construction = constructExtractor(
    prepared,
    FIXTURE_DEPOSIT_ID,
    constructionStartedAtMs,
  )

  return advanceOutpost(
    construction,
    constructionStartedAtMs + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

export function createLegacyActiveExtractorSave(nowMs = Date.now()): string {
  const envelope = JSON.parse(
    serializeOutpostSave(createActiveExtractorOutpost(nowMs), nowMs),
  ) as Record<string, unknown>

  envelope.schemaVersion = 1
  delete envelope.rival
  return JSON.stringify(envelope)
}

function createCinematicPrototype(nowMs: number) {
  const outpost = createActiveExtractorOutpost(nowMs)
  let rival = createInitialRivalSignal(outpost.site, nowMs - 12_000)

  rival = rivalSignalReducer(rival, {
    type: 'extractorActivated',
    outpost,
    nowMs: nowMs - 1_200,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'beginCinematic',
    nowMs: nowMs - 1_100,
  })!

  return {
    outpost,
    rival,
    firstStrike: createMigratedFirstStrike(outpost, rival, nowMs),
  }
}

export function createInterruptedCinematicSave(
  nowMs = Date.now(),
): string {
  const envelope = JSON.parse(
    serializePrototypeSave(createCinematicPrototype(nowMs), nowMs),
  ) as { rival: Record<string, unknown> }

  // Persistence deliberately writes only safe states. This fixture restores the
  // raw transient a crashed older tab could have left before normalization.
  envelope.rival.revealStatus = 'CINEMATIC'
  return JSON.stringify(envelope)
}

export function createScanAwaitingResponseSave(
  nowMs = Date.now(),
): string {
  const { outpost } = createCinematicPrototype(nowMs)
  let rival = createInitialRivalSignal(outpost.site, nowMs - 12_000)

  rival = rivalSignalReducer(rival, {
    type: 'extractorActivated',
    outpost,
    nowMs: nowMs - 2_000,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'beginCinematic',
    nowMs: nowMs - 1_900,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeIntroTransmission',
    nowMs: nowMs - 1_800,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeCinematic',
    nowMs: nowMs - 1_700,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeScan',
    nowMs: nowMs - 1_600,
  })!

  return serializePrototypeSave(
    {
      outpost,
      rival,
      firstStrike: createMigratedFirstStrike(outpost, rival, nowMs),
    },
    nowMs,
  )
}
