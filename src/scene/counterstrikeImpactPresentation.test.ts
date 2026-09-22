import { expect, it } from 'vitest'
import {
  COUNTERSTRIKE_IMPACT_EFFECT_MS,
  getCounterstrikeImpactElapsedMs,
  sampleCounterstrikeImpactEnergy,
} from './counterstrikeImpactPresentation.ts'
import {
  COUNTERSTRIKE_TIMING,
  createCounterstrikeRunState,
} from '../simulation/counterstrikeSimulation.ts'

it('is silent before contact and after the impact status', () => {
  for (const elapsedMs of [-1_500, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const energy = sampleCounterstrikeImpactEnergy(elapsedMs)
    expect(Object.values(energy).every((value) => value === 0)).toBe(true)
  }
  const resolved = { ...createCounterstrikeRunState(null, 0), status: 'resolved' as const }
  expect(
    sampleCounterstrikeImpactEnergy(getCounterstrikeImpactElapsedMs(resolved, 10_000)).core,
  ).toBe(0)
})

it('measures effect time from warhead contact inside the impact status', () => {
  const run = {
    ...createCounterstrikeRunState(null, 0),
    status: 'impact' as const,
    phaseStartedAtMs: 1_000,
  }
  expect(getCounterstrikeImpactElapsedMs(run, 1_000)).toBeCloseTo(
    -COUNTERSTRIKE_TIMING.impactContactMs,
    6,
  )
  expect(
    getCounterstrikeImpactElapsedMs(run, 1_000 + COUNTERSTRIKE_TIMING.impactContactMs),
  ).toBeCloseTo(0, 6)
})

it('hits sharply and briefly: a tactical impact, not a strategic fireball', () => {
  const sample = sampleCounterstrikeImpactEnergy
  const timing = COUNTERSTRIKE_IMPACT_EFFECT_MS
  expect(sample(timing.coreAttack).core).toBe(1)
  expect(sample(timing.coreAttack).light).toBeGreaterThan(0.75)
  // The white-hot core is gone within a fifth of a second and stays small.
  expect(sample(timing.core).core).toBe(0)
  expect(sample(timing.core).coreRadiusM).toBeLessThan(4)
  expect(sample(400).light).toBeLessThan(0.15)
  expect(sample(timing.light).light).toBe(0)
  // Heavier regolith follows: the shock ring, curtain and grains outlast it.
  expect(sample(timing.core).ringOpacity).toBeGreaterThan(0)
  expect(sample(400).ringRadiusM).toBeGreaterThan(sample(100).ringRadiusM)
  expect(sample(900).curtainOpacity).toBeGreaterThan(0)
  expect(sample(900).curtainHeightM).toBeLessThan(sample(400).curtainHeightM)
  expect(sample(1_200).dustOpacity).toBeGreaterThan(0)
})

it('clears every effect before the damage reveal settles', () => {
  const settledMs =
    COUNTERSTRIKE_TIMING.impactMs - COUNTERSTRIKE_TIMING.impactContactMs
  for (const durationMs of Object.values(COUNTERSTRIKE_IMPACT_EFFECT_MS)) {
    expect(durationMs).toBeLessThan(settledMs)
  }
  const energy = sampleCounterstrikeImpactEnergy(COUNTERSTRIKE_IMPACT_EFFECT_MS.ember)
  expect(energy.core).toBe(0)
  expect(energy.light).toBe(0)
  expect(energy.ringOpacity).toBe(0)
  expect(energy.curtainOpacity).toBe(0)
  expect(energy.dustOpacity).toBe(0)
  expect(energy.ember).toBe(0)
})
