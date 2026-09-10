import { expect, it } from 'vitest'
import { sampleInterceptEnergy } from './interceptPresentation.ts'
import { COUNTERSTRIKE_TIMING } from '../simulation/counterstrikeSimulation.ts'

it('layers a brief core, expanding shell and thin ring inside the one-second hold', () => {
  const sample = (ms: number) => sampleInterceptEnergy(ms / COUNTERSTRIKE_TIMING.successMs)
  expect(sample(0).core).toBe(1)
  expect(sample(180).core).toBe(0)
  expect(sample(180).shellOpacity).toBeGreaterThan(0)
  expect(sample(400).shellRadius).toBeGreaterThan(sample(100).shellRadius)
  expect(sample(420).surfacePulse).toBe(0)
  expect(sample(760).shellOpacity).toBe(0)
  expect(sample(760).ringOpacity).toBeGreaterThan(0)
  expect(sample(1_000).ringOpacity).toBe(0)
  expect(sample(6_400).surfacePulse).toBe(0)
})
