import { describe, expect, it } from 'vitest'
import {
  DEPOSIT_BLUEPRINTS,
  ROBOT_IDLE_POSITION,
  findDeposit,
  type OutpostSnapshot,
} from '../domain/outpost.ts'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import {
  DEPLOYMENT_DURATION_MS,
  EXTRACTOR_CONSTRUCTION_DURATION_MS,
  EXTRACTOR_COST,
  EXTRACTOR_PRODUCTION_INTERVAL_MS,
  MINER_CARGO_CAPACITY,
  MINING_DURATION_MS,
  UNLOADING_DURATION_MS,
  advanceOutpost,
  canConstructExtractor,
  canMineDeposit,
  commandMineDeposit,
  constructExtractor,
  createInitialOutpost,
  deployMiner,
  getRobotKinematics,
  getTravelDurationMs,
  resumeSurfaceSimulation,
} from './outpostSimulation.ts'

const SITE = createLandingSite(createLunarLocation(0.42, -1.13, 12))
const START_MS = 10_000
const DEPOSIT_ID = DEPOSIT_BLUEPRINTS[0]?.id ?? 'deposit-alpha'

function deployedOutpost(): OutpostSnapshot {
  const deployed = deployMiner(createInitialOutpost(SITE, START_MS), START_MS)
  return advanceOutpost(deployed, START_MS + DEPLOYMENT_DURATION_MS)
}

function runOneMiningCycle(
  source: OutpostSnapshot,
  startedAtMs: number,
  depositId = DEPOSIT_ID,
): { readonly outpost: OutpostSnapshot; readonly completedAtMs: number } {
  let outpost = commandMineDeposit(source, depositId, startedAtMs)
  const travelDuration = getTravelDurationMs(depositId)
  const completedAtMs =
    startedAtMs +
    travelDuration * 2 +
    MINING_DURATION_MS +
    UNLOADING_DURATION_MS
  outpost = advanceOutpost(outpost, completedAtMs)
  return { outpost, completedAtMs }
}

describe('first outpost robot state machine', () => {
  it('follows the explicit deterministic state sequence', () => {
    let outpost = createInitialOutpost(SITE, START_MS)
    expect(outpost.robot.state).toBe('stored')

    outpost = deployMiner(outpost, START_MS + 10)
    expect(outpost.robot.state).toBe('deploying')
    outpost = advanceOutpost(
      outpost,
      START_MS + 10 + DEPLOYMENT_DURATION_MS,
    )
    expect(outpost.robot.state).toBe('idle')

    const commandAt = outpost.updatedAtMs + 20
    outpost = commandMineDeposit(outpost, DEPOSIT_ID, commandAt)
    expect(outpost.robot.state).toBe('traveling')
    const travelDuration = getTravelDurationMs(DEPOSIT_ID)

    outpost = advanceOutpost(outpost, commandAt + travelDuration)
    expect(outpost.robot.state).toBe('mining')
    outpost = advanceOutpost(
      outpost,
      commandAt + travelDuration + MINING_DURATION_MS,
    )
    expect(outpost.robot.state).toBe('returning')
    outpost = advanceOutpost(
      outpost,
      commandAt + travelDuration * 2 + MINING_DURATION_MS,
    )
    expect(outpost.robot.state).toBe('unloading')
    outpost = advanceOutpost(
      outpost,
      commandAt +
        travelDuration * 2 +
        MINING_DURATION_MS +
        UNLOADING_DURATION_MS,
    )
    expect(outpost.robot.state).toBe('idle')
  })

  it('traverses a curved local route, faces travel, and returns to its idle pad', () => {
    const outpost = commandMineDeposit(deployedOutpost(), DEPOSIT_ID, START_MS)
    const duration = getTravelDurationMs(DEPOSIT_ID)
    const midpoint = getRobotKinematics(outpost, START_MS + duration / 2)

    expect(midpoint.moving).toBe(true)
    expect(Number.isFinite(midpoint.headingRad)).toBe(true)
    expect(midpoint.position).not.toEqual(ROBOT_IDLE_POSITION)

    const mining = advanceOutpost(outpost, START_MS + duration)
    const miningPosition = getRobotKinematics(mining, START_MS + duration).position
    const targetDeposit = findDeposit(mining, DEPOSIT_ID)
    expect(targetDeposit).not.toBeNull()
    expect(
      Math.hypot(
        miningPosition.xM - targetDeposit!.position.xM,
        miningPosition.zM - targetDeposit!.position.zM,
      ),
    ).toBeCloseTo(2.75, 4)

    const completed = advanceOutpost(
      outpost,
      START_MS + duration * 2 + MINING_DURATION_MS + UNLOADING_DURATION_MS,
    )
    expect(getRobotKinematics(completed, completed.updatedAtMs).position).toEqual(
      ROBOT_IDLE_POSITION,
    )
  })
})

describe('ore and extractor rules', () => {
  it('depletes a deposit when mining finishes and rewards ore only after unloading', () => {
    let outpost = commandMineDeposit(deployedOutpost(), DEPOSIT_ID, START_MS)
    const initialYield = findDeposit(outpost, DEPOSIT_ID)?.remainingYield
    const travelDuration = getTravelDurationMs(DEPOSIT_ID)

    outpost = advanceOutpost(
      outpost,
      START_MS + travelDuration + MINING_DURATION_MS,
    )
    expect(findDeposit(outpost, DEPOSIT_ID)?.remainingYield).toBe(
      (initialYield ?? 0) - MINER_CARGO_CAPACITY,
    )
    expect(outpost.robot.carriedOre).toBe(MINER_CARGO_CAPACITY)
    expect(outpost.lunarOre).toBe(0)

    outpost = advanceOutpost(
      outpost,
      START_MS + travelDuration * 2 + MINING_DURATION_MS + UNLOADING_DURATION_MS,
    )
    expect(outpost.robot.carriedOre).toBe(0)
    expect(outpost.lunarOre).toBe(MINER_CARGO_CAPACITY)
  })

  it('unlocks construction after two cargo returns and only on a valid selected deposit', () => {
    const first = runOneMiningCycle(deployedOutpost(), START_MS)
    const second = runOneMiningCycle(
      first.outpost,
      first.completedAtMs + 100,
    )

    expect(first.outpost.lunarOre).toBeLessThan(EXTRACTOR_COST)
    expect(second.outpost.lunarOre).toBeGreaterThanOrEqual(EXTRACTOR_COST)
    expect(canConstructExtractor(second.outpost, 'missing-deposit')).toBe(false)
    expect(canConstructExtractor(second.outpost, DEPOSIT_ID)).toBe(true)

    const constructed = constructExtractor(
      second.outpost,
      DEPOSIT_ID,
      second.completedAtMs + 200,
    )
    expect(constructed.extractor?.status).toBe('constructing')
    expect(constructed.lunarOre).toBe(
      second.outpost.lunarOre - EXTRACTOR_COST,
    )
    expect(canMineDeposit(constructed, DEPOSIT_ID)).toBe(false)
    expect(
      constructExtractor(constructed, DEPOSIT_ID, constructed.updatedAtMs),
    ).toBe(constructed)
  })

  it('activates once, produces on deterministic intervals, and skips closed-scene time', () => {
    const first = runOneMiningCycle(deployedOutpost(), START_MS)
    const second = runOneMiningCycle(first.outpost, first.completedAtMs + 10)
    const constructionAt = second.completedAtMs + 10
    let outpost = constructExtractor(second.outpost, DEPOSIT_ID, constructionAt)
    const activationAt = constructionAt + EXTRACTOR_CONSTRUCTION_DURATION_MS

    outpost = advanceOutpost(outpost, activationAt)
    expect(outpost.extractor?.status).toBe('active')
    expect(outpost.stage).toBe('extractor-active')

    outpost = advanceOutpost(
      outpost,
      activationAt + EXTRACTOR_PRODUCTION_INTERVAL_MS * 3 + 250,
    )
    expect(outpost.lunarOre).toBe(
      second.outpost.lunarOre - EXTRACTOR_COST + 3,
    )

    const resumed = resumeSurfaceSimulation(outpost, activationAt + 60_000)
    const next = advanceOutpost(
      resumed,
      activationAt + 60_000 + EXTRACTOR_PRODUCTION_INTERVAL_MS,
    )
    expect(next.lunarOre).toBe(resumed.lunarOre + 1)
  })
})
