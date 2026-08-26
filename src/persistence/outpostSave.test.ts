import { describe, expect, it } from 'vitest'
import { DEPOSIT_BLUEPRINTS, type RobotState } from '../domain/outpost.ts'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import {
  DEPLOYMENT_DURATION_MS,
  MINING_DURATION_MS,
  advanceOutpost,
  commandMineDeposit,
  createInitialOutpost,
  deployMiner,
  getTravelDurationMs,
} from '../simulation/outpostSimulation.ts'
import {
  OUTPOST_SAVE_SCHEMA_VERSION,
  OUTPOST_STORAGE_KEY,
  deserializeOutpostSave,
  loadOutpostSave,
  resetPrototypeSave,
  serializeOutpostSave,
  writeOutpostSave,
  type StorageLike,
} from './outpostSave.ts'

const SITE = createLandingSite(
  createLunarLocation(0.789012345, -2.456789012, 37.25),
)
const START_MS = 50_000
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]?.id ?? 'deposit-alpha'

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
