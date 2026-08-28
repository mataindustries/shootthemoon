import { describe, expect, it } from 'vitest'
import { DEPOSIT_BLUEPRINTS, type RobotState } from '../domain/outpost.ts'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import {
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  DEPLOYMENT_DURATION_MS,
  MINING_DURATION_MS,
  advanceOutpost,
  commandMineDeposit,
  constructExtractor,
  createInitialOutpost,
  deployMiner,
  getTravelDurationMs,
} from '../simulation/outpostSimulation.ts'
import {
  createInitialRivalSignal,
  rivalSignalReducer,
} from '../simulation/rivalSimulation.ts'
import {
  OUTPOST_SAVE_SCHEMA_VERSION,
  OUTPOST_STORAGE_KEY,
  deserializePrototypeSave,
  deserializeOutpostSave,
  loadPrototypeSave,
  loadOutpostSave,
  resetPrototypeSave,
  serializePrototypeSave,
  serializeOutpostSave,
  writePrototypeSave,
  writeOutpostSave,
  type PrototypeSnapshot,
  type StorageLike,
} from './outpostSave.ts'

const SITE = createLandingSite(
  createLunarLocation(0.789012345, -2.456789012, 37.25),
)
const START_MS = 50_000
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]?.id ?? 'deposit-alpha'

const PRE_RIVAL_ACTIVE_EXTRACTOR_FIXTURE = `{
  "schemaVersion": 1,
  "savedAtMs": 5000,
  "canonicalLanding": {
    "datumId": "moon-mean-radius-1737400m-v1",
    "latitudeRad": 0,
    "longitudeRad": 0,
    "altitudeM": 0,
    "orientationMcmf": { "x": -0.5, "y": -0.5, "z": 0.5, "w": -0.5 }
  },
  "outpost": {
    "id": "first-outpost",
    "stage": "extractor-active",
    "establishedAtMs": 1000,
    "updatedAtMs": 4900,
    "lunarOre": 17,
    "robot": {
      "id": "miner-01",
      "state": "idle",
      "stateStartedAtMs": 4800,
      "targetDepositId": null,
      "carriedOre": 0
    },
    "deposits": [
      {
        "id": "deposit-alpha",
        "resource": "LUNAR ORE",
        "position": { "xM": -10.5, "zM": -8.5 },
        "orientationRad": -0.42,
        "initialYield": 105,
        "remainingYield": 35
      },
      {
        "id": "deposit-beta",
        "resource": "LUNAR ORE",
        "position": { "xM": 11.8, "zM": -10.4 },
        "orientationRad": 0.76,
        "initialYield": 105,
        "remainingYield": 105
      },
      {
        "id": "deposit-gamma",
        "resource": "LUNAR ORE",
        "position": { "xM": 2.8, "zM": -18.5 },
        "orientationRad": 1.92,
        "initialYield": 105,
        "remainingYield": 105
      }
    ],
    "extractor": {
      "id": "extractor-01",
      "depositId": "deposit-alpha",
      "position": { "xM": -10.5, "zM": -8.5 },
      "orientationRad": -0.42,
      "status": "active",
      "constructionStartedAtMs": 2000,
      "activationTimestampMs": 4600,
      "lastProductionAtMs": 4800
    }
  }
}`

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function snapshotForState(state: RobotState) {
  let outpost = createInitialOutpost(SITE, START_MS)

  if (state === 'stored') {
    return outpost
  }

  outpost = deployMiner(outpost, START_MS)

  if (state === 'deploying') {
    return outpost
  }

  outpost = advanceOutpost(outpost, START_MS + DEPLOYMENT_DURATION_MS)

  if (state === 'idle') {
    return outpost
  }

  const commandAt = outpost.updatedAtMs
  outpost = commandMineDeposit(outpost, DEPOSIT_ID, commandAt)

  if (state === 'traveling') {
    return outpost
  }

  const travelDuration = getTravelDurationMs(DEPOSIT_ID)
  outpost = advanceOutpost(outpost, commandAt + travelDuration)

  if (state === 'mining') {
    return outpost
  }

  outpost = advanceOutpost(
    outpost,
    commandAt + travelDuration + MINING_DURATION_MS,
  )

  if (state === 'returning') {
    return outpost
  }

  return advanceOutpost(
    outpost,
    commandAt + travelDuration * 2 + MINING_DURATION_MS,
  )
}

function activeExtractorOutpost() {
  const initial = createInitialOutpost(SITE, START_MS)
  const prepared = {
    ...initial,
    stage: 'miner-deployed' as const,
    lunarOre: 95,
    robot: { ...initial.robot, state: 'idle' as const },
  }
  const construction = constructExtractor(
    prepared,
    DEPOSIT_ID,
    START_MS + 100,
  )

  return advanceOutpost(
    construction,
    START_MS + 100 + EXTRACTOR_CONSTRUCTION_DURATION_MS,
  )
}

function revealedPrototype(): PrototypeSnapshot {
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
    type: 'completeIntroTransmission',
    nowMs: START_MS + 3_200,
  })!
  rival = rivalSignalReducer(rival, {
    type: 'completeCinematic',
    nowMs: START_MS + 3_300,
  })!

  return { outpost, rival }
}

describe('versioned first outpost save', () => {
  it('serializes the schema version and preserves canonical coordinates', () => {
    const serialized = serializeOutpostSave(
      createInitialOutpost(SITE, START_MS),
      START_MS + 1,
    )
    const raw = JSON.parse(serialized) as {
      schemaVersion: number
      canonicalLanding: { latitudeRad: number; longitudeRad: number; altitudeM: number }
    }
    const restored = deserializeOutpostSave(serialized, START_MS + 2)

    expect(raw.schemaVersion).toBe(OUTPOST_SAVE_SCHEMA_VERSION)
    expect(raw.canonicalLanding).toMatchObject({
      latitudeRad: SITE.location.latitudeRad,
      longitudeRad: SITE.location.longitudeRad,
      altitudeM: SITE.location.heightM,
    })
    expect(restored?.site).toEqual(SITE)
  })

  it('rejects malformed and unsupported save data', () => {
    expect(deserializeOutpostSave('{bad json')).toBeNull()
    expect(
      deserializeOutpostSave(
        JSON.stringify({ schemaVersion: OUTPOST_SAVE_SCHEMA_VERSION + 1 }),
      ),
    ).toBeNull()
  })

  it.each([
    'stored',
    'deploying',
    'idle',
    'traveling',
    'mining',
    'returning',
    'unloading',
  ] as const)('restores %s to a safe resumable robot state', (state) => {
    const source = snapshotForState(state)
    const safeEnvelope = JSON.parse(
      serializeOutpostSave(source, START_MS + 100),
    ) as { outpost: Record<string, unknown> }
    const restored = deserializeOutpostSave(
      JSON.stringify({
        ...safeEnvelope,
        outpost: {
          ...safeEnvelope.outpost,
          lunarOre: source.lunarOre,
          robot: source.robot,
        },
      }),
      START_MS + 200,
    )

    expect(restored).not.toBeNull()
    expect(restored?.robot.state).toBe(state === 'stored' ? 'stored' : 'idle')
    expect(restored?.robot.targetDepositId).toBeNull()
    expect(restored?.robot.carriedOre).toBe(0)

    if (state === 'returning' || state === 'unloading') {
      expect(restored?.lunarOre).toBe(
        source.lunarOre + source.robot.carriedOre,
      )
    }
  })

  it('writes, loads, and deliberately resets the prototype save', () => {
    const storage = new MemoryStorage()
    const outpost = createInitialOutpost(SITE, START_MS)

    expect(writeOutpostSave(storage, outpost, START_MS)).toBe(true)
    expect(loadOutpostSave(storage, START_MS + 1)?.site).toEqual(SITE)
    expect(storage.values.has(OUTPOST_STORAGE_KEY)).toBe(true)
    expect(resetPrototypeSave(storage)).toBe(true)
    expect(storage.values.has(OUTPOST_STORAGE_KEY)).toBe(false)
    expect(loadOutpostSave(storage)).toBeNull()
  })
})

describe('Rival Signal schema migration and atomic persistence', () => {
  it('migrates a literal schema-v1 active extractor without changing player facts', () => {
    const restored = deserializePrototypeSave(
      PRE_RIVAL_ACTIVE_EXTRACTOR_FIXTURE,
      6_000,
    )

    expect(restored).not.toBeNull()
    expect(restored?.outpost.site.location).toEqual({
      latitudeRad: 0,
      longitudeRad: 0,
      heightM: 0,
    })
    expect(restored?.outpost.establishedAtMs).toBe(1_000)
    expect(restored?.outpost.lunarOre).toBe(17)
    expect(restored?.outpost.robot.state).toBe('idle')
    expect(restored?.outpost.deposits.map((deposit) => deposit.remainingYield)).toEqual([
      35,
      105,
      105,
    ])
    expect(restored?.outpost.extractor).toMatchObject({
      status: 'active',
      constructionStartedAtMs: 2_000,
      activationTimestampMs: 4_600,
      lastProductionAtMs: 6_000,
    })
    expect(restored?.rival.identityId).toBe('vesper')
    expect(restored?.rival.revealStatus).toBe('AWAITING_SAFE_MOMENT')
    expect(restored?.rival.revealTriggeredAtMs).toBe(4_600)
    expect(restored?.rival.stage).toBeNull()
    expect(restored?.rival.cinematicCompleted).toBe(false)
  })

  it('round trips both factions atomically without replaying completed transmissions', () => {
    let prototype = revealedPrototype()
    prototype = {
      ...prototype,
      rival: rivalSignalReducer(prototype.rival, {
        type: 'completeScan',
        nowMs: START_MS + 4_000,
      })!,
    }
    prototype = {
      ...prototype,
      rival: rivalSignalReducer(prototype.rival, {
        type: 'completeScanResponse',
        nowMs: START_MS + 4_100,
      })!,
    }
    const serialized = serializePrototypeSave(prototype, START_MS + 5_000)
    const raw = JSON.parse(serialized) as {
      schemaVersion: number
      rival: {
        canonicalLanding: {
          latitudeRad: number
          longitudeRad: number
          altitudeM: number
        }
      }
    }
    const restored = deserializePrototypeSave(serialized, START_MS + 5_100)

    expect(raw.schemaVersion).toBe(OUTPOST_SAVE_SCHEMA_VERSION)
    expect(raw.rival.canonicalLanding).toMatchObject({
      latitudeRad: prototype.rival.site.location.latitudeRad,
      longitudeRad: prototype.rival.site.location.longitudeRad,
      altitudeM: prototype.rival.site.location.heightM,
    })
    expect(restored?.outpost.site).toEqual(prototype.outpost.site)
    expect(restored?.outpost.lunarOre).toBe(prototype.outpost.lunarOre)
    expect(restored?.outpost.deposits).toEqual(prototype.outpost.deposits)
    expect(restored?.outpost.extractor).toMatchObject({
      depositId: prototype.outpost.extractor?.depositId,
      status: 'active',
      constructionStartedAtMs:
        prototype.outpost.extractor?.constructionStartedAtMs,
      activationTimestampMs:
        prototype.outpost.extractor?.activationTimestampMs,
    })
    expect(restored?.rival.site).toEqual(prototype.rival.site)
    expect(restored?.rival.stage).toBe('ESTABLISHING')
    expect(restored?.rival.introTransmissionCompleted).toBe(true)
    expect(restored?.rival.scanCompleted).toBe(true)
    expect(restored?.rival.scanResponseCompleted).toBe(true)
    expect(restored?.rival.replayEligible).toBe(true)
    expect(restored?.rival.skipEligible).toBe(true)
  })

  it('normalizes interrupted CINEMATIC state to a safe queued replay', () => {
    const prototype = revealedPrototype()
    let pending = createInitialRivalSignal(prototype.outpost.site, START_MS)

    pending = rivalSignalReducer(pending, {
      type: 'extractorActivated',
      outpost: prototype.outpost,
      nowMs: START_MS + 3_000,
    })!
    pending = rivalSignalReducer(pending, {
      type: 'beginCinematic',
      nowMs: START_MS + 3_100,
    })!
    pending = rivalSignalReducer(pending, {
      type: 'completeIntroTransmission',
      nowMs: START_MS + 3_200,
    })!

    const serialized = serializePrototypeSave(
      { outpost: prototype.outpost, rival: pending },
      START_MS + 3_300,
    )
    const raw = JSON.parse(serialized) as {
      rival: Record<string, unknown>
    }

    expect(raw.rival.revealStatus).toBe('QUEUED')

    raw.rival.revealStatus = 'CINEMATIC'
    const restored = deserializePrototypeSave(
      JSON.stringify(raw),
      START_MS + 3_400,
    )

    expect(restored?.rival.revealStatus).toBe('QUEUED')
    expect(restored?.rival.stage).toBeNull()
    expect(restored?.rival.introTransmissionCompleted).toBe(true)
  })

  it('derives a rival for a schema-v2 outpost that is missing rival data', () => {
    const serialized = serializeOutpostSave(
      createInitialOutpost(SITE, START_MS),
      START_MS + 10,
    )
    const raw = JSON.parse(serialized) as Record<string, unknown>
    delete raw.rival

    const restored = deserializePrototypeSave(
      JSON.stringify(raw),
      START_MS + 20,
    )

    expect(restored?.rival.revealStatus).toBe('DORMANT')
    expect(restored?.rival.site).not.toEqual(restored?.outpost.site)
  })

  it('writes, loads, and resets the complete two-faction snapshot under the legacy key', () => {
    const storage = new MemoryStorage()
    const prototype = revealedPrototype()

    expect(writePrototypeSave(storage, prototype, START_MS + 5_000)).toBe(true)
    expect(storage.values.size).toBe(1)
    expect(storage.values.has(OUTPOST_STORAGE_KEY)).toBe(true)
    expect(loadPrototypeSave(storage, START_MS + 5_100)?.rival.stage).toBe(
      'LANDED',
    )
    expect(resetPrototypeSave(storage)).toBe(true)
    expect(storage.values.size).toBe(0)
    expect(loadPrototypeSave(storage)).toBeNull()
  })

  it('rejects a rival location that no longer matches the canonical derivation', () => {
    const serialized = serializePrototypeSave(
      revealedPrototype(),
      START_MS + 5_000,
    )
    const raw = JSON.parse(serialized) as {
      rival: {
        canonicalLanding: { latitudeRad: number }
      }
    }
    raw.rival.canonicalLanding.latitudeRad += 0.01

    expect(
      deserializePrototypeSave(JSON.stringify(raw), START_MS + 5_100),
    ).toBeNull()
  })
})
