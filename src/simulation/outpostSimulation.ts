import {
  DEPOSIT_BLUEPRINTS,
  EXTRACTOR_ID,
  MINER_ID,
  OUTPOST_ID,
  RESOURCE_NAME,
  ROBOT_IDLE_POSITION,
  findDeposit,
  findDepositBlueprint,
  type LocalSurfacePosition,
  type MineralDeposit,
  type OutpostSnapshot,
  type RobotState,
} from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'

export const DEPLOYMENT_DURATION_MS = 1_700
export const MINING_DURATION_MS = 2_800
export const UNLOADING_DURATION_MS = 700
export const EXTRACTOR_CONSTRUCTION_DURATION_MS = 2_600
export const EXTRACTOR_PRODUCTION_INTERVAL_MS = 2_000
export const EXTRACTOR_COST = 60
export const MINER_CARGO_CAPACITY = 35

const MINIMUM_TRAVEL_DURATION_MS = 1_050
const TRAVEL_SPEED_M_PER_SECOND = 9.5

export interface RobotKinematics {
  readonly position: LocalSurfacePosition
  readonly headingRad: number
  readonly stateProgress: number
  readonly clearanceM: number
  readonly moving: boolean
}

export type OutpostAction =
  | {
      readonly type: 'establish'
      readonly site: LandingSite
      readonly nowMs: number
    }
  | { readonly type: 'deploy'; readonly nowMs: number }
  | {
      readonly type: 'mine'
      readonly depositId: string
      readonly nowMs: number
    }
  | {
      readonly type: 'constructExtractor'
      readonly depositId: string
      readonly nowMs: number
    }
  | { readonly type: 'tick'; readonly nowMs: number }
  | { readonly type: 'resumeSurface'; readonly nowMs: number }
  | { readonly type: 'reset' }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(value: number): number {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
}

function distanceBetween(
  left: LocalSurfacePosition,
  right: LocalSurfacePosition,
): number {
  return Math.hypot(left.xM - right.xM, left.zM - right.zM)
}

function quadraticPoint(
  start: LocalSurfacePosition,
  control: LocalSurfacePosition,
  end: LocalSurfacePosition,
  progress: number,
): LocalSurfacePosition {
  const inverse = 1 - progress

  return {
    xM:
      inverse * inverse * start.xM +
      2 * inverse * progress * control.xM +
      progress * progress * end.xM,
    zM:
      inverse * inverse * start.zM +
      2 * inverse * progress * control.zM +
      progress * progress * end.zM,
  }
}

function quadraticTangent(
  start: LocalSurfacePosition,
  control: LocalSurfacePosition,
  end: LocalSurfacePosition,
  progress: number,
): LocalSurfacePosition {
  return {
    xM:
      2 * (1 - progress) * (control.xM - start.xM) +
      2 * progress * (end.xM - control.xM),
    zM:
      2 * (1 - progress) * (control.zM - start.zM) +
      2 * progress * (end.zM - control.zM),
  }
}

function headingFromDirection(direction: LocalSurfacePosition): number {
  return Math.atan2(direction.xM, direction.zM)
}

function miningApproachPosition(
  blueprint: (typeof DEPOSIT_BLUEPRINTS)[number],
): LocalSurfacePosition {
  const deltaX = blueprint.position.xM - blueprint.routeControl.xM
  const deltaZ = blueprint.position.zM - blueprint.routeControl.zM
  const length = Math.max(0.001, Math.hypot(deltaX, deltaZ))
  const standOffM = 2.75

  return {
    xM: blueprint.position.xM - (deltaX / length) * standOffM,
    zM: blueprint.position.zM - (deltaZ / length) * standOffM,
  }
}

function miningHeading(depositId: string): number {
  const blueprint = findDepositBlueprint(depositId)

  if (blueprint === null) {
    return Math.PI
  }

  const approachPosition = miningApproachPosition(blueprint)

  const tangent = quadraticTangent(
    ROBOT_IDLE_POSITION,
    blueprint.routeControl,
    approachPosition,
    1,
  )
  return headingFromDirection(tangent)
}

export function createInitialOutpost(
  site: LandingSite,
  nowMs: number,
): OutpostSnapshot {
  const deposits: readonly MineralDeposit[] = DEPOSIT_BLUEPRINTS.map(
    (blueprint) => ({
      id: blueprint.id,
      resource: RESOURCE_NAME,
      position: blueprint.position,
      orientationRad: blueprint.orientationRad,
      initialYield: blueprint.initialYield,
      remainingYield: blueprint.initialYield,
    }),
  )

  return {
    id: OUTPOST_ID,
    site,
    stage: 'capsule-landed',
    establishedAtMs: nowMs,
    updatedAtMs: nowMs,
    lunarOre: 0,
    robot: {
      id: MINER_ID,
      state: 'stored',
      stateStartedAtMs: nowMs,
      targetDepositId: null,
      carriedOre: 0,
    },
    deposits,
    extractor: null,
  }
}

export function getTravelDurationMs(depositId: string): number {
  const blueprint = findDepositBlueprint(depositId)

  if (blueprint === null) {
    return MINIMUM_TRAVEL_DURATION_MS
  }

  const firstLeg = distanceBetween(
    ROBOT_IDLE_POSITION,
    blueprint.routeControl,
  )
  const secondLeg = distanceBetween(
    blueprint.routeControl,
    blueprint.position,
  )
  return Math.max(
    MINIMUM_TRAVEL_DURATION_MS,
    Math.round(((firstLeg + secondLeg) / TRAVEL_SPEED_M_PER_SECOND) * 1_000),
  )
}

export function getRobotStateDurationMs(
  outpost: OutpostSnapshot,
): number | null {
  switch (outpost.robot.state) {
    case 'deploying':
      return DEPLOYMENT_DURATION_MS
    case 'traveling':
    case 'returning':
      return outpost.robot.targetDepositId === null
        ? MINIMUM_TRAVEL_DURATION_MS
        : getTravelDurationMs(outpost.robot.targetDepositId)
    case 'mining':
      return MINING_DURATION_MS
    case 'unloading':
      return UNLOADING_DURATION_MS
    case 'stored':
    case 'idle':
      return null
  }
}

export function isRobotTransient(state: RobotState): boolean {
  return state !== 'stored' && state !== 'idle'
}

export function deployMiner(
  outpost: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  if (outpost.robot.state !== 'stored') {
    return outpost
  }

  return {
    ...outpost,
    updatedAtMs: nowMs,
    robot: {
      ...outpost.robot,
      state: 'deploying',
      stateStartedAtMs: nowMs,
    },
  }
}

export function canMineDeposit(
  outpost: OutpostSnapshot,
  depositId: string,
): boolean {
  const deposit = findDeposit(outpost, depositId)

  return (
    outpost.robot.state === 'idle' &&
    outpost.stage !== 'capsule-landed' &&
    deposit !== null &&
    deposit.remainingYield > 0 &&
    outpost.extractor?.depositId !== depositId
  )
}

export function commandMineDeposit(
  outpost: OutpostSnapshot,
  depositId: string,
  nowMs: number,
): OutpostSnapshot {
  if (!canMineDeposit(outpost, depositId)) {
    return outpost
  }

  return {
    ...outpost,
    updatedAtMs: nowMs,
    robot: {
      ...outpost.robot,
      state: 'traveling',
      stateStartedAtMs: nowMs,
      targetDepositId: depositId,
      carriedOre: 0,
    },
  }
}

export function canConstructExtractor(
  outpost: OutpostSnapshot,
  depositId: string,
): boolean {
  const deposit = findDeposit(outpost, depositId)

  return (
    outpost.extractor === null &&
    outpost.robot.state === 'idle' &&
    outpost.stage === 'miner-deployed' &&
    outpost.lunarOre >= EXTRACTOR_COST &&
    deposit !== null &&
    deposit.remainingYield > 0
  )
}

export function constructExtractor(
  outpost: OutpostSnapshot,
  depositId: string,
  nowMs: number,
): OutpostSnapshot {
  if (!canConstructExtractor(outpost, depositId)) {
    return outpost
  }

  const deposit = findDeposit(outpost, depositId)

  if (deposit === null) {
    return outpost
  }

  const activationTimestampMs = nowMs + EXTRACTOR_CONSTRUCTION_DURATION_MS

  return {
    ...outpost,
    updatedAtMs: nowMs,
    lunarOre: outpost.lunarOre - EXTRACTOR_COST,
    extractor: {
      id: EXTRACTOR_ID,
      depositId,
      position: deposit.position,
      orientationRad: deposit.orientationRad,
      status: 'constructing',
      constructionStartedAtMs: nowMs,
      activationTimestampMs,
      lastProductionAtMs: activationTimestampMs,
    },
  }
}

function replaceDeposit(
  deposits: readonly MineralDeposit[],
  replacement: MineralDeposit,
): readonly MineralDeposit[] {
  return deposits.map((deposit) =>
    deposit.id === replacement.id ? replacement : deposit,
  )
}

function advanceRobotOnce(
  outpost: OutpostSnapshot,
  transitionAtMs: number,
): OutpostSnapshot {
  const robot = outpost.robot

  switch (robot.state) {
    case 'deploying':
      return {
        ...outpost,
        stage: 'miner-deployed',
        updatedAtMs: transitionAtMs,
        robot: {
          ...robot,
          state: 'idle',
          stateStartedAtMs: transitionAtMs,
          targetDepositId: null,
        },
      }

    case 'traveling':
      return {
        ...outpost,
        updatedAtMs: transitionAtMs,
        robot: {
          ...robot,
          state: 'mining',
          stateStartedAtMs: transitionAtMs,
        },
      }

    case 'mining': {
      const deposit = findDeposit(outpost, robot.targetDepositId)

      if (deposit === null || deposit.remainingYield <= 0) {
        return {
          ...outpost,
          updatedAtMs: transitionAtMs,
          robot: {
            ...robot,
            state: 'returning',
            stateStartedAtMs: transitionAtMs,
            carriedOre: 0,
          },
        }
      }

      const minedOre = Math.min(MINER_CARGO_CAPACITY, deposit.remainingYield)
      return {
        ...outpost,
        updatedAtMs: transitionAtMs,
        deposits: replaceDeposit(outpost.deposits, {
          ...deposit,
          remainingYield: deposit.remainingYield - minedOre,
        }),
        robot: {
          ...robot,
          state: 'returning',
          stateStartedAtMs: transitionAtMs,
          carriedOre: minedOre,
        },
      }
    }

    case 'returning':
      return {
        ...outpost,
        updatedAtMs: transitionAtMs,
        robot: {
          ...robot,
          state: 'unloading',
          stateStartedAtMs: transitionAtMs,
        },
      }

    case 'unloading':
      return {
        ...outpost,
        updatedAtMs: transitionAtMs,
        lunarOre: outpost.lunarOre + robot.carriedOre,
        robot: {
          ...robot,
          state: 'idle',
          stateStartedAtMs: transitionAtMs,
          targetDepositId: null,
          carriedOre: 0,
        },
      }

    case 'stored':
    case 'idle':
      return outpost
  }
}

function advanceRobot(
  initial: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  let outpost = initial

  for (let transition = 0; transition < 8; transition += 1) {
    const duration = getRobotStateDurationMs(outpost)

    if (duration === null) {
      break
    }

    const transitionAtMs = outpost.robot.stateStartedAtMs + duration

    if (nowMs < transitionAtMs) {
      break
    }

    outpost = advanceRobotOnce(outpost, transitionAtMs)
  }

  return outpost
}

function advanceExtractor(
  initial: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  const extractor = initial.extractor

  if (extractor === null) {
    return initial
  }

  if (
    extractor.status === 'constructing' &&
    nowMs >= extractor.activationTimestampMs
  ) {
    const activated: OutpostSnapshot = {
      ...initial,
      stage: 'extractor-active',
      updatedAtMs: extractor.activationTimestampMs,
      extractor: {
        ...extractor,
        status: 'active',
        lastProductionAtMs: extractor.activationTimestampMs,
      },
    }
    return advanceExtractor(activated, nowMs)
  }

  if (extractor.status !== 'active') {
    return initial
  }

  const producedOre = Math.floor(
    (nowMs - extractor.lastProductionAtMs) /
      EXTRACTOR_PRODUCTION_INTERVAL_MS,
  )

  if (producedOre <= 0) {
    return initial
  }

  const productionTimestampMs =
    extractor.lastProductionAtMs +
    producedOre * EXTRACTOR_PRODUCTION_INTERVAL_MS

  return {
    ...initial,
    updatedAtMs: productionTimestampMs,
    lunarOre: initial.lunarOre + producedOre,
    extractor: {
      ...extractor,
      lastProductionAtMs: productionTimestampMs,
    },
  }
}

export function advanceOutpost(
  outpost: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  return advanceExtractor(advanceRobot(outpost, nowMs), nowMs)
}

export function resumeSurfaceSimulation(
  outpost: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  if (outpost.extractor?.status !== 'active') {
    return outpost
  }

  return {
    ...outpost,
    updatedAtMs: nowMs,
    extractor: {
      ...outpost.extractor,
      lastProductionAtMs: nowMs,
    },
  }
}

export function outpostReducer(
  state: OutpostSnapshot | null,
  action: OutpostAction,
): OutpostSnapshot | null {
  switch (action.type) {
    case 'establish':
      return state ?? createInitialOutpost(action.site, action.nowMs)
    case 'deploy':
      return state === null ? null : deployMiner(state, action.nowMs)
    case 'mine':
      return state === null
        ? null
        : commandMineDeposit(state, action.depositId, action.nowMs)
    case 'constructExtractor':
      return state === null
        ? null
        : constructExtractor(state, action.depositId, action.nowMs)
    case 'tick':
      return state === null ? null : advanceOutpost(state, action.nowMs)
    case 'resumeSurface':
      return state === null
        ? null
        : resumeSurfaceSimulation(state, action.nowMs)
    case 'reset':
      return null
  }
}

export function getRobotKinematics(
  outpost: OutpostSnapshot,
  nowMs: number,
): RobotKinematics {
  const robot = outpost.robot
  const duration = getRobotStateDurationMs(outpost)
  const progress =
    duration === null
      ? 1
      : clamp01((nowMs - robot.stateStartedAtMs) / duration)

  if (robot.state === 'stored') {
    return {
      position: { xM: 0, zM: 0.45 },
      headingRad: 0,
      stateProgress: 0,
      clearanceM: 1.18,
      moving: false,
    }
  }

  if (robot.state === 'deploying') {
    const eased = smoothstep(progress)
    return {
      position: {
        xM: ROBOT_IDLE_POSITION.xM * eased,
        zM: 0.45 + (ROBOT_IDLE_POSITION.zM - 0.45) * eased,
      },
      headingRad: 0,
      stateProgress: progress,
      clearanceM: 0.48 + (1 - eased) * 0.7 + Math.sin(progress * Math.PI) * 0.12,
      moving: true,
    }
  }

  const targetId = robot.targetDepositId
  const blueprint = targetId === null ? null : findDepositBlueprint(targetId)

  if (blueprint === null || robot.state === 'idle' || robot.state === 'unloading') {
    return {
      position: ROBOT_IDLE_POSITION,
      headingRad: Math.PI,
      stateProgress: robot.state === 'unloading' ? progress : 1,
      clearanceM: 0.48,
      moving: false,
    }
  }

  if (robot.state === 'mining') {
    return {
      position: miningApproachPosition(blueprint),
      headingRad: miningHeading(blueprint.id),
      stateProgress: progress,
      clearanceM: 0.48,
      moving: false,
    }
  }

  const routeProgress =
    robot.state === 'returning' ? 1 - smoothstep(progress) : smoothstep(progress)
  const approachPosition = miningApproachPosition(blueprint)
  const position = quadraticPoint(
    ROBOT_IDLE_POSITION,
    blueprint.routeControl,
    approachPosition,
    routeProgress,
  )
  const routeTangent = quadraticTangent(
    ROBOT_IDLE_POSITION,
    blueprint.routeControl,
    approachPosition,
    routeProgress,
  )
  const tangent =
    robot.state === 'returning'
      ? { xM: -routeTangent.xM, zM: -routeTangent.zM }
      : routeTangent

  return {
    position,
    headingRad: headingFromDirection(tangent),
    stateProgress: progress,
    clearanceM: 0.48,
    moving: true,
  }
}
