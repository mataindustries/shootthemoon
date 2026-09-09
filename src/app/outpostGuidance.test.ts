import { expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { advanceOutpost, commandMineDeposit, constructExtractor, createInitialOutpost, deployMiner } from '../simulation/outpostSimulation.ts'
import { outpostGuidance } from './outpostGuidance.ts'

it('guides a fresh outpost through mining and the first automatic extractor', () => {
  let outpost = createInitialOutpost(createLandingSite(createLunarLocation(0, 0)), 0)
  expect(outpostGuidance(outpost, null)).toContain('Deploy your miner')
  outpost = deployMiner(outpost, 0)
  expect(outpostGuidance(outpost, null)).toBeNull()
  outpost = advanceOutpost(outpost, 2000)
  expect(outpostGuidance(outpost, null)).toContain('Tap an ore signal')
  expect(outpostGuidance(outpost, 'deposit-alpha')).toContain('Mine this deposit')
  for (const start of [2000, 20000]) {
    outpost = commandMineDeposit(outpost, 'deposit-alpha', start)
    expect(outpostGuidance(outpost, 'deposit-alpha')).toBeNull()
    outpost = advanceOutpost(outpost, start + 15000)
  }
  expect(outpostGuidance(outpost, null)).toContain('build your first extractor')
  expect(outpostGuidance(outpost, 'deposit-alpha')).toContain('mines automatically')
  outpost = constructExtractor(outpost, 'deposit-alpha', 40000)
  expect(outpostGuidance(outpost, null)).toContain('mining starts automatically')
  outpost = advanceOutpost(outpost, 44000)
  expect(outpost.extractor?.status).toBe('active')
  expect(outpostGuidance(outpost, null)).toBeNull()
})
