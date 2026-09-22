import { describe, expect, it } from 'vitest'
import {
  sampleEjectaBlastResidual,
  sampleImpactBlastEnergy,
  sampleImpactBlastRadius,
} from './LunarImpactEffects.tsx'

const STEPS = 200
const PROGRESS = Array.from(
  { length: STEPS + 1 },
  (_, index) => index / STEPS,
)
const OUT_OF_RANGE = [-4, -0.5, -0.001, 1.001, 1.5, 12]

const peakProgress = PROGRESS.reduce((best, progress) =>
  sampleImpactBlastEnergy(progress) > sampleImpactBlastEnergy(best)
    ? progress
    : best,
)

describe('first strike blast energy', () => {
  it('rises to full power inside the opening tenth of the phase', () => {
    expect(sampleImpactBlastEnergy(0)).toBe(0)
    expect(sampleImpactBlastEnergy(0.02)).toBeGreaterThan(0.3)
    expect(sampleImpactBlastEnergy(0.05)).toBeGreaterThan(0.7)
    expect(sampleImpactBlastEnergy(0.1)).toBeGreaterThan(0.95)

    const attack = PROGRESS.filter((progress) => progress <= peakProgress)
    attack.forEach((progress, index) => {
      if (index === 0) return
      expect(sampleImpactBlastEnergy(progress)).toBeGreaterThan(
        sampleImpactBlastEnergy(attack[index - 1]!),
      )
    })
  })

  it('peaks early in the phase and holds the blast through its first third', () => {
    expect(peakProgress).toBeGreaterThan(0)
    expect(peakProgress).toBeLessThanOrEqual(0.2)
    expect(sampleImpactBlastEnergy(peakProgress)).toBeCloseTo(1, 5)
    expect(sampleImpactBlastEnergy(0.15)).toBeGreaterThan(0.9)
    expect(sampleImpactBlastEnergy(0.3)).toBeGreaterThan(0.6)
  })

  it('never falls back to darkness before the phase ends', () => {
    PROGRESS.forEach((progress) => {
      if (progress === 0) return
      expect(sampleImpactBlastEnergy(progress)).toBeGreaterThan(0)
    })

    // The old sine pulse collapsed to zero from 0.42 onwards, leaving the
    // climax black for the last ~0.75s of the phase.
    PROGRESS.filter((progress) => progress >= 0.1).forEach((progress) => {
      expect(sampleImpactBlastEnergy(progress)).toBeGreaterThan(0.15)
    })
    expect(sampleImpactBlastEnergy(1)).toBeGreaterThan(0.15)
  })

  it('decays without recovering once the blast is past its peak', () => {
    const decay = PROGRESS.filter((progress) => progress >= peakProgress)
    decay.forEach((progress, index) => {
      if (index === 0) return
      expect(sampleImpactBlastEnergy(progress)).toBeLessThanOrEqual(
        sampleImpactBlastEnergy(decay[index - 1]!),
      )
    })

    PROGRESS.filter((progress) => progress >= 0.25).forEach(
      (progress, index, samples) => {
        if (index === 0) return
        expect(sampleImpactBlastEnergy(progress)).toBeLessThan(
          sampleImpactBlastEnergy(samples[index - 1]!),
        )
      },
    )
  })

  it('stays finite, bounded and clamped outside the phase', () => {
    PROGRESS.forEach((progress) => {
      const energy = sampleImpactBlastEnergy(progress)
      expect(Number.isFinite(energy)).toBe(true)
      expect(energy).toBeGreaterThanOrEqual(0)
      expect(energy).toBeLessThanOrEqual(1)
    })

    OUT_OF_RANGE.forEach((progress) => {
      expect(sampleImpactBlastEnergy(progress)).toBe(
        sampleImpactBlastEnergy(progress < 0 ? 0 : 1),
      )
    })
  })
})

describe('ejecta blast residual', () => {
  it('opens on the value impact-flash handed over', () => {
    expect(sampleEjectaBlastResidual(0)).toBe(sampleImpactBlastEnergy(1))
    expect(sampleEjectaBlastResidual(0.01)).toBeCloseTo(
      sampleImpactBlastEnergy(1),
      1,
    )
  })

  it('fades out over the opening quarter of the ejecta phase', () => {
    const firstZero = PROGRESS.find(
      (progress) => sampleEjectaBlastResidual(progress) === 0,
    )

    expect(sampleEjectaBlastResidual(0.1)).toBeGreaterThan(0)
    expect(sampleEjectaBlastResidual(0.2)).toBeGreaterThan(0)
    expect(firstZero).toBeGreaterThanOrEqual(0.2)
    expect(firstZero).toBeLessThanOrEqual(0.3)
    expect(sampleEjectaBlastResidual(0.3)).toBe(0)
    expect(sampleEjectaBlastResidual(1)).toBe(0)

    PROGRESS.forEach((progress, index) => {
      if (index === 0) return
      expect(sampleEjectaBlastResidual(progress)).toBeLessThanOrEqual(
        sampleEjectaBlastResidual(PROGRESS[index - 1]!),
      )
    })
  })

  it('stays finite, bounded and clamped outside the phase', () => {
    PROGRESS.forEach((progress) => {
      const residual = sampleEjectaBlastResidual(progress)
      expect(Number.isFinite(residual)).toBe(true)
      expect(residual).toBeGreaterThanOrEqual(0)
      expect(residual).toBeLessThanOrEqual(sampleImpactBlastEnergy(1))
    })

    OUT_OF_RANGE.forEach((progress) => {
      expect(sampleEjectaBlastResidual(progress)).toBe(
        sampleEjectaBlastResidual(progress < 0 ? 0 : 1),
      )
    })
  })
})

describe('fireball radius', () => {
  it('opens with the blast and keeps swelling while it cools', () => {
    expect(sampleImpactBlastRadius(0)).toBeGreaterThan(0)
    expect(sampleImpactBlastRadius(peakProgress)).toBeGreaterThan(
      sampleImpactBlastRadius(0) * 2,
    )

    PROGRESS.forEach((progress, index) => {
      if (index === 0) return
      expect(sampleImpactBlastRadius(progress)).toBeGreaterThan(
        sampleImpactBlastRadius(PROGRESS[index - 1]!),
      )
    })
  })

  it('stays finite, bounded and clamped outside the phase', () => {
    PROGRESS.forEach((progress) => {
      const radius = sampleImpactBlastRadius(progress)
      expect(Number.isFinite(radius)).toBe(true)
      expect(radius).toBeGreaterThan(0)
      expect(radius).toBeLessThan(0.05)
    })

    OUT_OF_RANGE.forEach((progress) => {
      expect(sampleImpactBlastRadius(progress)).toBe(
        sampleImpactBlastRadius(progress < 0 ? 0 : 1),
      )
    })
  })
})
