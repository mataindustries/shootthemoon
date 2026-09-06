import { describe, expect, it } from 'vitest'
import {
  createLandingSite,
  createLunarLocation,
  type LandingSite,
} from '../domain/lunarCoordinates.ts'
import type { OperatingMode, OutpostSnapshot } from '../domain/outpost.ts'
import { createInitialOutpost } from './outpostSimulation.ts'
import {
  COUNTERSTRIKE_DAMAGE_MULTIPLIER,
  HARDENED_COUNTERSTRIKE_DAMAGE_MULTIPLIER,
  KEEP_EXTRACTING_PRODUCTION_MULTIPLIER,
  advanceOutpostOperations,
  analyzeLandingSite,
  calculateOutpostOperations,
  setOperatingMode,
} from './outpostOperations.ts'

const START_MS = 50_000

function site(latitudeDeg: number, longitudeDeg: number): LandingSite {
  return createLandingSite(
    createLunarLocation(
      (latitudeDeg * Math.PI) / 180,
      (longitudeDeg * Math.PI) / 180,
      0,
    ),
  )
}

function activeOutpost(
  landingSite: LandingSite,
  mode: OperatingMode = 'BALANCED',
): OutpostSnapshot {
  const initial = createInitialOutpost(landingSite, START_MS)
  const selected = analyzeLandingSite(landingSite).selectedDepositId
  const deposit = initial.deposits.find((entry) => entry.id === selected)!

  return {
    ...initial,
    stage: 'extractor-active',
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

describe('deterministic landing-site consequences', () => {
  const strongDifficult = site(25, -2)
  const richLong = site(40, 50)
  const balanced = site(-40, -38)

  it('proves the three acceptance sites from canonical scene data', () => {
    const first = analyzeLandingSite(strongDifficult)
    const second = analyzeLandingSite(richLong)
    const third = analyzeLandingSite(balanced)

    expect(first).toMatchObject({
      solarQuality: 'strong',
      extractionQuality: 'difficult',
    })
    expect(second).toMatchObject({
      extractionQuality: 'rich',
      logisticsQuality: 'long',
    })
    expect(third).toMatchObject({
      solarQuality: 'stable',
      extractionQuality: 'standard',
      logisticsQuality: 'moderate',
    })
    expect(analyzeLandingSite(strongDifficult)).toEqual(first)
  })

  it('delivers meaningfully different output at different sites', () => {
    const rates = [strongDifficult, richLong, balanced].map((landingSite) =>
      calculateOutpostOperations(activeOutpost(landingSite)).productionPerMin,
    )

    expect(rates[0]!).toBeGreaterThan(rates[2]!)
    expect(rates[2]!).toBeGreaterThan(rates[1]!)
    expect(rates[0]! / rates[1]!).toBeGreaterThan(2)
  })
})

describe('outpost operations model', () => {
  const strongSite = site(25, -2)

  it('supports all modes and predictably duty-cycles overdrive', () => {
    const conserve = calculateOutpostOperations(
      activeOutpost(strongSite, 'CONSERVE'),
    )
    const balanced = calculateOutpostOperations(
      activeOutpost(strongSite, 'BALANCED'),
    )
    const overdrive = calculateOutpostOperations(
      activeOutpost(strongSite, 'OVERDRIVE'),
    )

    expect([conserve.activeRobots, balanced.activeRobots, overdrive.activeRobots])
      .toEqual([1, 2, 3])
    expect(conserve.productionPerMin).toBeLessThan(balanced.productionPerMin)
    expect(balanced.productionPerMin).toBeLessThan(overdrive.productionPerMin)
    expect(overdrive.energyThrottle).toBeLessThan(1)
    expect(overdrive.status).toBe('LOW ENERGY')
  })

  it('throttles low-energy production without a failure state', () => {
    const metrics = calculateOutpostOperations(
      activeOutpost(site(40, 50), 'BALANCED'),
    )

    expect(metrics.energyGeneratedKw).toBeLessThan(metrics.energyDemandKw)
    expect(metrics.energyThrottle).toBeGreaterThan(0)
    expect(metrics.energyThrottle).toBeLessThan(1)
    expect(metrics.productionPerMin).toBeGreaterThan(0)
    expect(metrics.status).toBe('LOW ENERGY')
  })

  it('integrates production to finite storage and stops delivery when full', () => {
    const source = activeOutpost(strongSite, 'OVERDRIVE')
    const nearFull = {
      ...source,
      lunarOre: source.operations.storageCapacity - 0.5,
    }
    const full = advanceOutpostOperations(nearFull, START_MS + 60_000)
    const metrics = calculateOutpostOperations(full)

    expect(full.lunarOre).toBe(full.operations.storageCapacity)
    expect(metrics.status).toBe('STORAGE FULL')
    expect(metrics.activeRobots).toBe(0)
    expect(metrics.productionPerMin).toBe(0)
  })

  it('applies the documented persistent Counterstrike production loss', () => {
    const source = activeOutpost(strongSite)
    const intact = calculateOutpostOperations(source, 'INTACT')
    const damaged = calculateOutpostOperations(source, 'DAMAGED')

    expect(damaged.damageMultiplier).toBe(COUNTERSTRIKE_DAMAGE_MULTIPLIER)
    expect(damaged.productionPerMin).toBeCloseTo(
      intact.productionPerMin * COUNTERSTRIKE_DAMAGE_MULTIPLIER,
      10,
    )
  })

  it('applies all three command allocations to live operations', () => {
    const source = activeOutpost(strongSite, 'BALANCED')
    const prioritized = calculateOutpostOperations(
      source,
      'INTACT',
      'PRIORITIZE_INTERCEPTOR',
      true,
    )
    const hardened = calculateOutpostOperations(
      source,
      'INTACT',
      'HARDEN_OUTPOST',
      true,
    )
    const extracting = calculateOutpostOperations(
      source,
      'INTACT',
      'KEEP_EXTRACTING',
      true,
    )
    const overdrive = calculateOutpostOperations(
      activeOutpost(strongSite, 'OVERDRIVE'),
    )

    expect([prioritized.activeRobots, hardened.activeRobots, extracting.activeRobots])
      .toEqual([1, 2, 3])
    expect(prioritized.defenseAllocationKw).toBe(6)
    expect(prioritized.interceptionReadiness).toBe('MAXIMUM')
    expect(hardened.defenseAllocationKw).toBe(3)
    expect(hardened.interceptionReadiness).toBe('FORTIFIED')
    expect(extracting.defenseAllocationKw).toBe(0)
    expect(extracting.commandProductionMultiplier).toBe(
      KEEP_EXTRACTING_PRODUCTION_MULTIPLIER,
    )
    expect(extracting.productionPerMin).toBeCloseTo(
      overdrive.productionPerMin * KEEP_EXTRACTING_PRODUCTION_MULTIPLIER,
      10,
    )
  })

  it('limits hardened persistent damage to 15% and keeps normal damage at 30%', () => {
    const source = activeOutpost(strongSite)
    const intact = calculateOutpostOperations(source)
    const hardened = calculateOutpostOperations(
      source,
      'DAMAGED',
      'HARDEN_OUTPOST',
    )
    const aggressive = calculateOutpostOperations(
      source,
      'DAMAGED',
      'KEEP_EXTRACTING',
    )

    expect(hardened.damageMultiplier).toBe(
      HARDENED_COUNTERSTRIKE_DAMAGE_MULTIPLIER,
    )
    expect(hardened.productionPerMin).toBeCloseTo(
      intact.productionPerMin * 0.85,
      10,
    )
    expect(aggressive.damageMultiplier).toBe(COUNTERSTRIKE_DAMAGE_MULTIPLIER)
  })

  it('accounts for elapsed production before changing modes', () => {
    const source = activeOutpost(strongSite, 'CONSERVE')
    const conserveRate = calculateOutpostOperations(source).productionPerMin
    const changed = setOperatingMode(
      source,
      'OVERDRIVE',
      START_MS + 30_000,
    )

    expect(changed.lunarOre).toBeCloseTo(conserveRate / 2, 10)
    expect(changed.operations.mode).toBe('OVERDRIVE')
    expect(changed.operations.lastUpdatedAtMs).toBe(START_MS + 30_000)
  })
})
