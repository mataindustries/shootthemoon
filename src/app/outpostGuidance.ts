import { findDeposit, type OutpostSnapshot } from '../domain/outpost.ts'
import { canConstructExtractor, canMineDeposit, EXTRACTOR_COST } from '../simulation/outpostSimulation.ts'

export function outpostGuidance(outpost: OutpostSnapshot, selectedId: string | null): string | null {
  if (outpost.extractor?.status === 'constructing') return 'Building extractor · mining starts automatically when ready.'
  if (outpost.extractor?.status === 'active') return null
  if (outpost.robot.state === 'stored') return 'Deploy your miner to gather ore for the first extractor.'
  if (outpost.robot.state !== 'idle') return null
  if (selectedId !== null && canConstructExtractor(outpost, selectedId)) return 'Build your first extractor · it mines automatically.'
  if (selectedId !== null && canMineDeposit(outpost, selectedId)) return `Mine this deposit · collect ${EXTRACTOR_COST} ore to build an extractor.`
  if (findDeposit(outpost, selectedId)?.remainingYield === 0) return 'Deposit depleted · tap another ore signal.'
  return outpost.lunarOre >= EXTRACTOR_COST
    ? 'Tap an ore signal to build your first extractor.'
    : `Tap an ore signal · collect ${EXTRACTOR_COST} ore to build an extractor.`
}

export function depositLabel(id: string): string {
  return id.replace('deposit-', '').toUpperCase()
}
