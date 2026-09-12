import { siegeAllocation } from '../domain/orbitalSiege.ts'
import { monumentAllocation, monumentIsActive, monumentModifiers } from '../domain/territoryMonument.ts'
import {
  DEPOSIT_BLUEPRINTS,
  type MineralDeposit,
  type OperatingMode,
  type OutpostOperationsState,
  type OutpostSnapshot,
} from '../domain/outpost.ts'
import {
  dot,
  surfaceUnitVector,
  type LandingSite,
  type Vec3,
} from '../domain/lunarCoordinates.ts'
import {
  createSurfaceTerrainProfile,
  sampleTerrainHeightM,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import type {
  CounterstrikeOrder,
  OutpostDamageState,
} from '../domain/counterstrike.ts'

export const DEFAULT_STORAGE_CAPACITY = 240
export const AVAILABLE_OPERATION_ROBOTS = 3
export const SOLAR_ARRAY_PEAK_KW = 18
export const SOLAR_WING_GENERATION_MULTIPLIER = 1.25
export const SOLAR_WING_OVERDRIVE_DEMAND_MULTIPLIER = 0.8
export const REPAIR_GANTRY_DEMAND_KW = 4
export const REPAIR_GANTRY_RECOVERY_DURATION_MS = 12_000
export const BASE_SYSTEM_DEMAND_KW = 2
export const ROBOT_DEMAND_KW = 5
export const ROBOT_BASE_PRODUCTION_PER_MIN = 3.6
export const COUNTERSTRIKE_DAMAGE_MULTIPLIER = 0.7
export const HARDENED_COUNTERSTRIKE_DAMAGE_MULTIPLIER = 0.85
export const KEEP_EXTRACTING_PRODUCTION_MULTIPLIER = 1.25

export interface CounterstrikeOperationsEffect {
  readonly activeRobots: 1 | 2 | 3
  readonly defenseAllocationKw: number
  readonly productionMultiplier: number
  readonly readiness: 'MAXIMUM' | 'FORTIFIED' | 'STANDARD'
  readonly projectedConsequence: string
}

export const COUNTERSTRIKE_COMMAND_EFFECTS: Readonly<
  Record<CounterstrikeOrder, CounterstrikeOperationsEffect>
> = Object.freeze({
  PRIORITIZE_INTERCEPTOR: Object.freeze({
    activeRobots: 1,
    defenseAllocationKw: 6,
    productionMultiplier: 1,
    readiness: 'MAXIMUM',
    projectedConsequence: '40% WIDER FIRE WINDOW',
  }),
  HARDEN_OUTPOST: Object.freeze({
    activeRobots: 2,
    defenseAllocationKw: 3,
    productionMultiplier: 1,
    readiness: 'FORTIFIED',
    projectedConsequence: '15% LOSS IF HIT',
  }),
  KEEP_EXTRACTING: Object.freeze({
    activeRobots: 3,
    defenseAllocationKw: 0,
    productionMultiplier: KEEP_EXTRACTING_PRODUCTION_MULTIPLIER,
    readiness: 'STANDARD',
    projectedConsequence: '25% BOOST · 30% LOSS IF HIT',
  }),
})

/** Matches LightingRig's fixed MCMF sun offset (4.6, 2.6, 3.4). */
export const CANONICAL_SUN_DIRECTION: Vec3 = Object.freeze(
  (() => {
    const length = Math.hypot(4.6, 2.6, 3.4)
    return { x: 4.6 / length, y: 2.6 / length, z: 3.4 / length }
  })(),
)

export type SolarQuality = 'poor' | 'stable' | 'strong'
export type ExtractionQuality = 'difficult' | 'standard' | 'rich'
export type LogisticsQuality = 'short' | 'moderate' | 'long'
export type OperationStatus = 'NOMINAL' | 'LOW ENERGY' | 'STORAGE FULL'

export interface DepositOperationsAnalysis {
  readonly depositId: string
  readonly extractionFactor: number
  readonly logisticsDistanceM: number
  readonly logisticsEfficiency: number
  readonly slopeNormalized: number
  readonly roughnessNormalized: number
}

export interface LandingSiteOperationsAnalysis {
  readonly solarExposure: number
  readonly solarQuality: SolarQuality
  readonly extractionQuality: ExtractionQuality
  readonly logisticsQuality: LogisticsQuality
  readonly selectedDepositId: string
  readonly deposit: DepositOperationsAnalysis
}

export interface OutpostOperationsMetrics
  extends LandingSiteOperationsAnalysis {
  readonly mode: OperatingMode
  readonly energyGeneratedKw: number
  readonly energyDemandKw: number
  readonly energyConsumedKw: number
  readonly platformAllocationKw: number
  readonly monumentAllocationKw: number
  readonly constructionRobots: number
  readonly defenseRobots: number
  readonly availableDefense: number
  readonly repairDemandKw: number
  readonly repairConsumedKw: number
  readonly energyThrottle: number
  readonly activeRobots: number
  readonly availableRobots: number
  readonly productionPerMin: number
  readonly storageUsed: number
  readonly storageCapacity: number
  readonly operatingEfficiency: number
  readonly damageMultiplier: number
  readonly defenseDemandKw: number
  readonly defenseAllocationKw: number
  readonly miningAllocationKw: number
  readonly commandProductionMultiplier: number
  readonly interceptionReadiness: CounterstrikeOperationsEffect['readiness']
  readonly status: OperationStatus
}

const MODE_ROBOTS: Readonly<Record<OperatingMode, number>> = Object.freeze({
  CONSERVE: 1,
  BALANCED: 2,
  OVERDRIVE: 3,
})

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function qualityFromSolar(exposure: number): SolarQuality {
  return exposure < 0.42 ? 'poor' : exposure < 0.72 ? 'stable' : 'strong'
}

function qualityFromExtraction(factor: number): ExtractionQuality {
  return factor < 0.9 ? 'difficult' : factor < 0.955 ? 'standard' : 'rich'
}

function qualityFromLogistics(distanceM: number): LogisticsQuality {
  return distanceM < 14.4 ? 'short' : distanceM < 16 ? 'moderate' : 'long'
}

function terrainGradient(
  terrain: SurfaceTerrainProfile,
  xM: number,
  zM: number,
): Readonly<{ slopeNormalized: number; roughnessNormalized: number }> {
  const radiusM = 2
  const center = sampleTerrainHeightM(terrain, xM, zM)
  const east = sampleTerrainHeightM(terrain, xM + radiusM, zM)
  const west = sampleTerrainHeightM(terrain, xM - radiusM, zM)
  const south = sampleTerrainHeightM(terrain, xM, zM + radiusM)
  const north = sampleTerrainHeightM(terrain, xM, zM - radiusM)
  const gradientX = (east - west) / (radiusM * 2)
  const gradientZ = (south - north) / (radiusM * 2)
  const slopeRad = Math.atan(Math.hypot(gradientX, gradientZ))
  const roughnessM = Math.sqrt(
    ((east - center) ** 2 +
      (west - center) ** 2 +
      (south - center) ** 2 +
      (north - center) ** 2) /
      4,
  )

  return {
    slopeNormalized: clamp01(slopeRad / 0.32),
    roughnessNormalized: clamp01(roughnessM / 0.5),
  }
}

/**
 * Deposit extraction uses the rendered terrain source: 55% terrain
 * suitability and 45% remaining deposit quality. Logistics is the local
 * surface distance with a bounded 0-40% terrain traversal surcharge.
 */
export function analyzeDepositOperations(
  site: LandingSite,
  deposit: Pick<
    MineralDeposit,
    'id' | 'position' | 'initialYield' | 'remainingYield'
  >,
): DepositOperationsAnalysis {
  return analyzeDepositWithTerrain(
    createSurfaceTerrainProfile(site),
    deposit,
  )
}

function analyzeDepositWithTerrain(
  terrainProfile: SurfaceTerrainProfile,
  deposit: Pick<
    MineralDeposit,
    'id' | 'position' | 'initialYield' | 'remainingYield'
  >,
): DepositOperationsAnalysis {
  const terrain = terrainGradient(
    terrainProfile,
    deposit.position.xM,
    deposit.position.zM,
  )
  const terrainSuitability = clamp01(
    1 - terrain.slopeNormalized * 0.62 - terrain.roughnessNormalized * 0.38,
  )
  const depositQuality =
    deposit.initialYield <= 0
      ? 0
      : clamp01(deposit.remainingYield / deposit.initialYield)
  const extractionFactor = clamp01(
    0.45 * depositQuality + 0.55 * terrainSuitability,
  )
  const directDistanceM = Math.hypot(deposit.position.xM, deposit.position.zM)
  const traversalSurcharge =
    terrain.slopeNormalized * 0.24 + terrain.roughnessNormalized * 0.16
  const logisticsDistanceM = directDistanceM * (1 + traversalSurcharge)
  const logisticsNormalized = clamp01((logisticsDistanceM - 12) / 12)

  return Object.freeze({
    depositId: deposit.id,
    extractionFactor,
    logisticsDistanceM,
    logisticsEfficiency: 1 - logisticsNormalized * 0.34,
    ...terrain,
  })
}

function blueprintDeposits(): readonly MineralDeposit[] {
  return DEPOSIT_BLUEPRINTS.map((deposit) => ({
    id: deposit.id,
    resource: 'LUNAR ORE',
    position: deposit.position,
    orientationRad: deposit.orientationRad,
    initialYield: deposit.initialYield,
    remainingYield: deposit.initialYield,
  }))
}

function chooseDeposit(
  site: LandingSite,
  deposits: readonly MineralDeposit[],
  selectedDepositId?: string | null,
): DepositOperationsAnalysis {
  const terrain = createSurfaceTerrainProfile(site)
  const analyses = deposits.map((deposit) =>
    analyzeDepositWithTerrain(terrain, deposit),
  )
  const selected =
    selectedDepositId === undefined || selectedDepositId === null
      ? null
      : analyses.find((analysis) => analysis.depositId === selectedDepositId)

  return (
    selected ??
    analyses.reduce((best, candidate) =>
      candidate.extractionFactor * candidate.logisticsEfficiency >
      best.extractionFactor * best.logisticsEfficiency
        ? candidate
        : best,
    )
  )
}

/** Site preview derived only from canonical coordinates, terrain and deposits. */
export function analyzeLandingSite(
  site: LandingSite,
): LandingSiteOperationsAnalysis {
  const solarExposure = clamp01(
    dot(surfaceUnitVector(site.location), CANONICAL_SUN_DIRECTION),
  )
  const deposit = chooseDeposit(site, blueprintDeposits())

  return Object.freeze({
    solarExposure,
    solarQuality: qualityFromSolar(solarExposure),
    extractionQuality: qualityFromExtraction(deposit.extractionFactor),
    logisticsQuality: qualityFromLogistics(deposit.logisticsDistanceM),
    selectedDepositId: deposit.depositId,
    deposit,
  })
}

export function createOutpostOperationsState(
  nowMs: number,
  existingOre = 0,
): OutpostOperationsState {
  const migratedCapacity = Math.max(
    DEFAULT_STORAGE_CAPACITY,
    Math.ceil(existingOre / 20) * 20,
  )

  return Object.freeze({
    mode: 'BALANCED',
    storageCapacity: migratedCapacity,
    lastUpdatedAtMs: nowMs,
  })
}

/**
 * Energy = 18 kW * max(0, surfaceNormal·sun). Demand = 2 kW base + 5 kW
 * per requested robot. A deficit duty-cycles every robot by the same bounded
 * throttle. Ore/min = 3.6 * robots * extraction * logistics * energy * damage.
 * Counterstrike damage is a persistent 0.70 multiplier. Storage full forces
 * robots and delivered production to zero.
 */
export function calculateOutpostOperations(
  outpost: OutpostSnapshot,
  damageState: OutpostDamageState = 'INTACT',
  commandOrder: CounterstrikeOrder | null = null,
  commandActive = false,
): OutpostOperationsMetrics {
  const siege = outpost.orbitalSiege
  const monument = outpost.monument
  const modifiers = monumentModifiers(monument)
  const monumentActive = !commandActive && monumentIsActive(monument)
  // Counterstrike owns its Command Phase while the surface siege is paused.
  const allocation = monumentActive && monument !== null ? monumentAllocation(monument) : siegeAllocation(commandActive ? null : siege)
  const selectedDepositId = outpost.extractor?.depositId ?? null
  const deposit = chooseDeposit(
    outpost.site,
    outpost.deposits,
    selectedDepositId,
  )
  const solarExposure = clamp01(
    dot(surfaceUnitVector(outpost.site.location), CANONICAL_SUN_DIRECTION),
  )
  const moduleActive = outpost.module?.status === 'active'
  const solarWingActive = moduleActive && outpost.module?.kind === 'SOLAR_WING'
  const repairActive =
    moduleActive &&
    outpost.module?.kind === 'REPAIR_GANTRY' &&
    damageState === 'DAMAGED' &&
    outpost.module.repairProgress < 1
  const energyGeneratedKw =
    solarExposure *
    SOLAR_ARRAY_PEAK_KW *
    (solarWingActive ? SOLAR_WING_GENERATION_MULTIPLIER : 1) *
    (1 - (siege?.energyLoss ?? 0)) * (1 - (monument?.energyLoss ?? 0)) * modifiers.energy
  const constructionAllocationKw = Math.min(allocation.powerKw, Math.max(0, energyGeneratedKw - BASE_SYSTEM_DEMAND_KW))
  const commandEffect =
    commandActive && commandOrder !== null
      ? COUNTERSTRIKE_COMMAND_EFFECTS[commandOrder]
      : null
  const requestedRobots =
    allocation.active ? allocation.miners :
    commandEffect?.activeRobots ?? MODE_ROBOTS[outpost.operations.mode]
  const extractorActive = outpost.extractor?.status === 'active'
  const storageFull =
    outpost.lunarOre >= outpost.operations.storageCapacity - 1e-9
  const activeRobots = extractorActive && !storageFull ? requestedRobots : 0
  const overdriveDemandMultiplier =
    solarWingActive && outpost.operations.mode === 'OVERDRIVE'
      ? SOLAR_WING_OVERDRIVE_DEMAND_MULTIPLIER
      : 1
  const robotDemandKw =
    activeRobots * ROBOT_DEMAND_KW * overdriveDemandMultiplier
  const repairDemandKw = repairActive ? REPAIR_GANTRY_DEMAND_KW : 0
  const defenseDemandKw = extractorActive
    ? allocation.active ? allocation.defenseKw : commandEffect?.defenseAllocationKw ?? 0
    : 0
  const defenseAllocationKw = allocation.active
    ? Math.min(defenseDemandKw, Math.max(0, energyGeneratedKw - BASE_SYSTEM_DEMAND_KW - constructionAllocationKw))
    : defenseDemandKw
  const energyDemandKw = extractorActive
    ? BASE_SYSTEM_DEMAND_KW + defenseDemandKw + robotDemandKw + repairDemandKw + allocation.powerKw
    : 0
  const robotEnergyAvailableKw = Math.max(
    0,
    energyGeneratedKw - BASE_SYSTEM_DEMAND_KW - defenseAllocationKw - repairDemandKw - constructionAllocationKw,
  )
  const energyThrottle =
    robotDemandKw <= 0 ? (storageFull ? 0 : 1) : clamp01(robotEnergyAvailableKw / robotDemandKw)
  const baseDamageMultiplier =
    damageState === 'DAMAGED'
      ? commandOrder === 'HARDEN_OUTPOST'
        ? HARDENED_COUNTERSTRIKE_DAMAGE_MULTIPLIER
        : COUNTERSTRIKE_DAMAGE_MULTIPLIER
      : 1
  const counterstrikeDamageMultiplier =
    baseDamageMultiplier +
    (1 - baseDamageMultiplier) *
      (outpost.module?.kind === 'REPAIR_GANTRY'
        ? outpost.module.repairProgress
        : 0)
  const rawDamageMultiplier = counterstrikeDamageMultiplier * (1 - (siege?.outpostDamage ?? 0) / 100) * (1 - (monument?.productionPenalty ?? 0))
  const damageMultiplier = 1 - (1 - rawDamageMultiplier) * modifiers.damagePenalty
  const commandProductionMultiplier =
    (commandEffect?.productionMultiplier ?? 1) *
    (allocation.active && !monumentActive ? 0.75 : siege?.status === 'operational' ? 1.2 : 1) * modifiers.extraction
  const logisticsEfficiency = 1 - (1 - deposit.logisticsEfficiency) * modifiers.logisticsLoss
  const operatingEfficiency =
    activeRobots === 0
      ? 0
      : clamp01(
          deposit.extractionFactor *
            logisticsEfficiency *
            energyThrottle *
            damageMultiplier,
        )
  const productionPerMin =
    ROBOT_BASE_PRODUCTION_PER_MIN *
    activeRobots *
    operatingEfficiency *
    commandProductionMultiplier
  const status: OperationStatus = storageFull
    ? 'STORAGE FULL'
    : energyThrottle < 0.999 || defenseAllocationKw < defenseDemandKw || constructionAllocationKw < allocation.powerKw
      ? 'LOW ENERGY'
      : 'NOMINAL'

  return Object.freeze({
    solarExposure,
    solarQuality: qualityFromSolar(solarExposure),
    extractionQuality: qualityFromExtraction(deposit.extractionFactor),
    logisticsQuality: qualityFromLogistics(deposit.logisticsDistanceM),
    selectedDepositId: deposit.depositId,
    deposit,
    mode: outpost.operations.mode,
    energyGeneratedKw,
    energyDemandKw,
    energyConsumedKw: Math.min(energyGeneratedKw, energyDemandKw),
    platformAllocationKw: monumentActive ? 0 : allocation.powerKw,
    monumentAllocationKw: monumentActive ? constructionAllocationKw : 0,
    constructionRobots: allocation.builders,
    defenseRobots: allocation.defenders,
    availableDefense: allocation.active ? allocation.readiness : AVAILABLE_OPERATION_ROBOTS - activeRobots,
    repairDemandKw,
    repairConsumedKw:
      repairDemandKw === 0
        ? 0
        : Math.min(
            repairDemandKw,
            Math.max(
              0,
              energyGeneratedKw -
                BASE_SYSTEM_DEMAND_KW -
                defenseAllocationKw - constructionAllocationKw,
            ),
          ),
    energyThrottle,
    activeRobots,
    availableRobots: AVAILABLE_OPERATION_ROBOTS,
    productionPerMin,
    storageUsed: Math.min(outpost.lunarOre, outpost.operations.storageCapacity),
    storageCapacity: outpost.operations.storageCapacity,
    operatingEfficiency,
    damageMultiplier,
    defenseDemandKw,
    defenseAllocationKw,
    miningAllocationKw: Math.min(robotDemandKw, robotEnergyAvailableKw),
    commandProductionMultiplier,
    interceptionReadiness: commandEffect?.readiness ?? 'STANDARD',
    status,
  })
}

export function advanceOutpostOperations(
  outpost: OutpostSnapshot,
  nowMs: number,
  damageState: OutpostDamageState = 'INTACT',
  commandOrder: CounterstrikeOrder | null = null,
  commandActive = false,
): OutpostSnapshot {
  if (nowMs <= outpost.operations.lastUpdatedAtMs) return outpost

  const metrics = calculateOutpostOperations(
    outpost,
    damageState,
    commandOrder,
    commandActive,
  )
  const elapsedMinutes = (nowMs - outpost.operations.lastUpdatedAtMs) / 60_000
  const deliveredOre = Math.min(
    metrics.productionPerMin * elapsedMinutes,
    Math.max(0, outpost.operations.storageCapacity - outpost.lunarOre),
  )
  const repairProgress =
    outpost.module?.kind === 'REPAIR_GANTRY' &&
    outpost.module.status === 'active' &&
    damageState === 'DAMAGED'
      ? Math.min(
          1,
          outpost.module.repairProgress +
            ((nowMs - outpost.operations.lastUpdatedAtMs) /
              REPAIR_GANTRY_RECOVERY_DURATION_MS) *
              (metrics.repairConsumedKw / REPAIR_GANTRY_DEMAND_KW) * monumentModifiers(outpost.monument).repairSpeed,
        )
      : outpost.module?.repairProgress

  return {
    ...outpost,
    updatedAtMs: nowMs,
    lunarOre: outpost.lunarOre + deliveredOre,
    operations: { ...outpost.operations, lastUpdatedAtMs: nowMs },
    module:
      outpost.module === null
        ? null
        : {
            ...outpost.module,
            repairProgress: repairProgress ?? outpost.module.repairProgress,
            lastRepairAtMs: nowMs,
          },
    extractor:
      outpost.extractor === null
        ? null
        : { ...outpost.extractor, lastProductionAtMs: nowMs },
  }
}

export function setOperatingMode(
  outpost: OutpostSnapshot,
  mode: OperatingMode,
  nowMs: number,
  damageState: OutpostDamageState = 'INTACT',
): OutpostSnapshot {
  const advanced = advanceOutpostOperations(outpost, nowMs, damageState)
  return advanced.operations.mode === mode
    ? advanced
    : {
        ...advanced,
        updatedAtMs: nowMs,
        operations: { ...advanced.operations, mode, lastUpdatedAtMs: nowMs },
      }
}
