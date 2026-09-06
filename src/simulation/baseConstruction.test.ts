import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import type { OutpostModuleKind, OutpostSnapshot } from '../domain/outpost.ts'
import { deserializeOutpostSave, serializeOutpostSave } from '../persistence/outpostSave.ts'
import {
  REPAIR_GANTRY_RECOVERY_DURATION_MS,
  advanceOutpostOperations,
  calculateOutpostOperations,
} from './outpostOperations.ts'
import {
  MODULE_CONSTRUCTION_DURATION_MS,
  OUTPOST_MODULE_COST,
  STORAGE_SILO_CAPACITY,
  advanceOutpost,
  canConstructModule,
  constructModule,
  createInitialOutpost,
} from './outpostSimulation.ts'

const START_MS = 80_000
const SITE = createLandingSite(createLunarLocation(0.248, -0.684, 18))

function readyOutpost(
  ore = 100,
  mode: OutpostSnapshot['operations']['mode'] = 'BALANCED',
  landingSite = SITE,
): OutpostSnapshot {
  const initial = createInitialOutpost(landingSite, START_MS)
  const deposit = initial.deposits[0]!
  return {
    ...initial,
    stage: 'extractor-active',
    lunarOre: ore,
    robot: { ...initial.robot, state: 'idle' },
    operations: { ...initial.operations, mode },
    extractor: {
      id: 'extractor-01',
      depositId: deposit.id,
      position: deposit.position,
      orientationRad: deposit.orientationRad,
      status: 'active',
      constructionStartedAtMs: START_MS,
      activationTimestampMs: START_MS,
      lastProductionAtMs: START_MS,
    },
  }
}

function completeModule(
  kind: OutpostModuleKind,
  damageState: 'INTACT' | 'DAMAGED' = 'INTACT',
  mode: OutpostSnapshot['operations']['mode'] = 'BALANCED',
  landingSite = SITE,
) {
  const construction = constructModule(
    readyOutpost(100, mode, landingSite),
    kind,
    START_MS + 100,
    damageState,
  )
  return advanceOutpost(
    construction,
    START_MS + 100 + MODULE_CONSTRUCTION_DURATION_MS,
  )
}

describe('base construction pure model', () => {
  it('requires one empty slot, an active extractor, 20 ore, and damage for the gantry', () => {
    const ready = readyOutpost(20)
    expect(canConstructModule(ready, 'SOLAR_WING')).toBe(true)
    expect(canConstructModule(readyOutpost(19.999), 'SOLAR_WING')).toBe(false)
    expect(canConstructModule(ready, 'REPAIR_GANTRY', 'INTACT')).toBe(false)
    expect(canConstructModule(ready, 'REPAIR_GANTRY', 'DAMAGED')).toBe(true)

    const occupied = constructModule(ready, 'SOLAR_WING', START_MS + 1)
    expect(canConstructModule(occupied, 'STORAGE_SILO')).toBe(false)
  })

  it.each(['SOLAR_WING', 'STORAGE_SILO', 'REPAIR_GANTRY'] as const)(
    'deducts exactly once when purchasing %s',
    (kind) => {
      const source = readyOutpost(73.25)
      const purchased = constructModule(
        source,
        kind,
        START_MS + 1,
        kind === 'REPAIR_GANTRY' ? 'DAMAGED' : 'INTACT',
      )
      const repeated = constructModule(
        purchased,
        kind,
        START_MS + 2,
        'DAMAGED',
      )

      expect(purchased.lunarOre).toBe(73.25 - OUTPOST_MODULE_COST)
      expect(repeated).toBe(purchased)
    },
  )

  it('applies +25% solar generation and makes Overdrive sustainable', () => {
    const constrainedSite = createLandingSite(
      createLunarLocation((25 * Math.PI) / 180, (-2 * Math.PI) / 180, 0),
    )
    const source = readyOutpost(100, 'OVERDRIVE', constrainedSite)
    const before = calculateOutpostOperations(source)
    const after = calculateOutpostOperations(
      completeModule('SOLAR_WING', 'INTACT', 'OVERDRIVE', constrainedSite),
    )

    expect(after.energyGeneratedKw).toBeCloseTo(before.energyGeneratedKw * 1.25, 10)
    expect(after.energyThrottle).toBeGreaterThan(before.energyThrottle)
    expect(after.productionPerMin).toBeGreaterThan(before.productionPerMin)
  })

  it('raises silo capacity to 400 without altering post-purchase ore', () => {
    const construction = constructModule(
      readyOutpost(73.25),
      'STORAGE_SILO',
      START_MS + 100,
    )
    const completed = advanceOutpost(
      construction,
      START_MS + 100 + MODULE_CONSTRUCTION_DURATION_MS,
    )

    expect(construction.lunarOre).toBe(53.25)
    expect(completed.lunarOre).toBe(53.25)
    expect(completed.operations.storageCapacity).toBe(STORAGE_SILO_CAPACITY)
  })

  it('consumes repair energy and gradually restores the damage multiplier', () => {
    const active = completeModule('REPAIR_GANTRY', 'DAMAGED')
    const damaged = calculateOutpostOperations(active, 'DAMAGED', 'HARDEN_OUTPOST')
    const halfway = advanceOutpostOperations(
      active,
      active.operations.lastUpdatedAtMs + REPAIR_GANTRY_RECOVERY_DURATION_MS / 2,
      'DAMAGED',
      'HARDEN_OUTPOST',
    )
    const recovering = calculateOutpostOperations(halfway, 'DAMAGED', 'HARDEN_OUTPOST')
    const recovered = advanceOutpostOperations(
      halfway,
      halfway.operations.lastUpdatedAtMs + REPAIR_GANTRY_RECOVERY_DURATION_MS,
      'DAMAGED',
      'HARDEN_OUTPOST',
    )

    expect(damaged.repairConsumedKw).toBeGreaterThan(0)
    expect(halfway.module?.repairProgress).toBeGreaterThan(0)
    expect(halfway.module?.repairProgress).toBeLessThan(1)
    expect(recovering.damageMultiplier).toBeGreaterThan(damaged.damageMultiplier)
    const restoredHalfway = deserializeOutpostSave(
      serializeOutpostSave(halfway, halfway.updatedAtMs),
      halfway.updatedAtMs,
    )
    expect(restoredHalfway?.module?.repairProgress).toBe(
      halfway.module?.repairProgress,
    )
    expect(recovered.module?.repairProgress).toBe(1)
    expect(calculateOutpostOperations(recovered, 'DAMAGED').damageMultiplier).toBe(1)
  })

  it('persists a completed module and safely resumes construction without another deduction', () => {
    const construction = constructModule(
      readyOutpost(64),
      'SOLAR_WING',
      START_MS + 100,
    )
    const midRefresh = deserializeOutpostSave(
      serializeOutpostSave(construction, START_MS + 900),
      START_MS + 1_000,
    )!
    const completedRefresh = deserializeOutpostSave(
      serializeOutpostSave(construction, START_MS + 900),
      START_MS + 100 + MODULE_CONSTRUCTION_DURATION_MS,
    )!

    expect(midRefresh.lunarOre).toBe(44)
    expect(midRefresh.module).toMatchObject({ kind: 'SOLAR_WING', status: 'constructing' })
    expect(midRefresh.module?.completionTimestampMs).toBe(
      START_MS + 100 + MODULE_CONSTRUCTION_DURATION_MS,
    )
    expect(completedRefresh.lunarOre).toBe(44)
    expect(completedRefresh.module).toMatchObject({ kind: 'SOLAR_WING', status: 'active' })
  })
})
