import type { LandingSite } from './lunarCoordinates.ts'

export const OUTPOST_ID = 'first-outpost'
export const MINER_ID = 'miner-01'
export const EXTRACTOR_ID = 'extractor-01'
export const RESOURCE_NAME = 'LUNAR ORE'

export type RobotState =
  | 'stored'
  | 'deploying'
  | 'idle'
  | 'traveling'
  | 'mining'
  | 'returning'
  | 'unloading'

export type OutpostStage =
  | 'capsule-landed'
  | 'miner-deployed'
  | 'extractor-active'

export type ExtractorStatus = 'constructing' | 'active'

export interface LocalSurfacePosition {
  readonly xM: number
  readonly zM: number
}

export interface DepositBlueprint {
  readonly id: string
  readonly position: LocalSurfacePosition
  readonly routeControl: LocalSurfacePosition
  readonly orientationRad: number
  readonly initialYield: number
}

export interface MineralDeposit {
  readonly id: string
  readonly resource: typeof RESOURCE_NAME
  readonly position: LocalSurfacePosition
  readonly orientationRad: number
  readonly initialYield: number
  readonly remainingYield: number
}

export interface MinerRobot {
  readonly id: typeof MINER_ID
  readonly state: RobotState
  readonly stateStartedAtMs: number
  readonly targetDepositId: string | null
  readonly carriedOre: number
}

export interface Extractor {
  readonly id: typeof EXTRACTOR_ID
  readonly depositId: string
  readonly position: LocalSurfacePosition
  readonly orientationRad: number
  readonly status: ExtractorStatus
  readonly constructionStartedAtMs: number
  readonly activationTimestampMs: number
  readonly lastProductionAtMs: number
}

export interface OutpostSnapshot {
  readonly id: typeof OUTPOST_ID
  readonly site: LandingSite
  readonly stage: OutpostStage
  readonly establishedAtMs: number
  readonly updatedAtMs: number
  readonly lunarOre: number
  readonly robot: MinerRobot
  readonly deposits: readonly MineralDeposit[]
  readonly extractor: Extractor | null
}

export const ROBOT_IDLE_POSITION: LocalSurfacePosition = Object.freeze({
  xM: 3.2,
  zM: 4.3,
})

export const DEPOSIT_BLUEPRINTS: readonly DepositBlueprint[] = Object.freeze([
  Object.freeze({
    id: 'deposit-alpha',
    position: Object.freeze({ xM: -10.5, zM: -8.5 }),
    routeControl: Object.freeze({ xM: -3.8, zM: 2.2 }),
    orientationRad: -0.42,
    initialYield: 105,
  }),
  Object.freeze({
    id: 'deposit-beta',
    position: Object.freeze({ xM: 11.8, zM: -10.4 }),
    routeControl: Object.freeze({ xM: 6, zM: 1.8 }),
    orientationRad: 0.76,
    initialYield: 105,
  }),
  Object.freeze({
    id: 'deposit-gamma',
    position: Object.freeze({ xM: 2.8, zM: -18.5 }),
    routeControl: Object.freeze({ xM: 7.4, zM: -0.8 }),
    orientationRad: 1.92,
    initialYield: 105,
  }),
])

export function findDeposit(
  outpost: OutpostSnapshot,
  depositId: string | null,
): MineralDeposit | null {
  if (depositId === null) {
    return null
  }

  return outpost.deposits.find((deposit) => deposit.id === depositId) ?? null
}

export function findDepositBlueprint(
  depositId: string,
): DepositBlueprint | null {
  return DEPOSIT_BLUEPRINTS.find((deposit) => deposit.id === depositId) ?? null
}
