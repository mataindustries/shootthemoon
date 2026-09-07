import { expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { deserializeOutpostSave, serializeOutpostSave } from '../persistence/outpostSave.ts'
import {
  advanceOutpost, canMineDeposit, commandMineDeposit, constructExtractor,
  constructModule, createInitialOutpost, EXTRACTOR_CONSTRUCTION_DURATION_MS,
  MODULE_CONSTRUCTION_DURATION_MS,
} from './outpostSimulation.ts'

it('preserves every deposit and its mining eligibility through Solar Wing construction and reload', () => {
  const initial = createInitialOutpost(createLandingSite(createLunarLocation(0.248, -0.684)), 0)
  const prepared = { ...initial, stage: 'miner-deployed' as const, lunarOre: 95,
    robot: { ...initial.robot, state: 'idle' as const } }
  const active = advanceOutpost(constructExtractor(prepared, 'deposit-alpha', 0), EXTRACTOR_CONSTRUCTION_DURATION_MS)
  const constructing = constructModule(active, 'SOLAR_WING', 10_000)
  const completed = advanceOutpost(constructing, 10_000 + MODULE_CONSTRUCTION_DURATION_MS)
  const restored = deserializeOutpostSave(serializeOutpostSave(completed, 20_000), 20_000)!
  for (const outpost of [active, constructing, completed, restored]) {
    expect(outpost.deposits).toEqual(active.deposits)
    for (const deposit of outpost.deposits) {
      const occupied = deposit.id === 'deposit-alpha'
      expect(canMineDeposit(outpost, deposit.id)).toBe(!occupied)
      const commanded = commandMineDeposit(outpost, deposit.id, 21_000)
      if (occupied) expect(commanded).toBe(outpost)
      else {
        expect(commanded.robot.state).toBe('traveling')
        expect(commanded.robot.targetDepositId).toBe(deposit.id)
      }
    }
  }
})
