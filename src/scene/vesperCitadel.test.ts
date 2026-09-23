import { describe, expect, it } from 'vitest'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import type { RivalPresentationPhase } from '../app/rivalPresentation.ts'
import { rivalPresentationNeedsContinuousFrames } from '../app/rivalPresentation.ts'
import {
  CITADEL_FOOTPRINT,
  createCitadelFoundation,
  createCitadelGeometry,
} from './vesperCitadelGeometry.ts'
import { getRivalStageVisualProfile } from './RivalFoothold.tsx'
import {
  VESPER_SIGNAL_PERIOD_MS,
  poseCitadelSignal,
  sampleCitadelSignal,
} from './vesperSignal.ts'
import { citadelLoopNeedsFrames } from './VesperCitadel.tsx'

function insideFootprint(x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = CITADEL_FOOTPRINT.length - 1; i < CITADEL_FOOTPRINT.length; j = i++) {
    const [xi, zi] = CITADEL_FOOTPRINT[i]!
    const [xj, zj] = CITADEL_FOOTPRINT[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

describe('Vesper citadel geometry', () => {
  it.each(['LANDED', 'ESTABLISHING', 'FORTIFIED'] as const)(
    'seats every low %s module on the terrain-sampled apron',
    (stage) => {
      const { architecture } = createCitadelGeometry(getRivalStageVisualProfile(stage))
      const position = architecture.getAttribute('position')
      const hanging: string[] = []

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index)
        const z = position.getZ(index)
        if (position.getY(index) < 1 && !insideFootprint(x, z)) {
          hanging.push(`${x.toFixed(2)},${z.toFixed(2)}`)
        }
      }

      expect(hanging).toEqual([])
    },
  )

  it('drops its skirt to the sampled ground along every footprint edge', () => {
    const ground = (x: number, z: number) => -0.4 + Math.sin(x * 0.7) * 0.2 + z * 0.02
    const foundation = createCitadelFoundation(ground)
    const position = foundation.getAttribute('position')
    let skirtVertices = 0

    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index)
      if (y < 0.4) {
        skirtVertices += 1
        expect(y).toBeCloseTo(ground(position.getX(index), position.getZ(index)) - 0.12, 6)
      }
    }

    expect(skirtVertices).toBeGreaterThan(CITADEL_FOOTPRINT.length * 6)
  })

  it('stays a handful of merged batches, not per-part meshes', () => {
    const parts = createCitadelGeometry(getRivalStageVisualProfile('FORTIFIED'))
    let triangles = 0
    for (const geometry of Object.values(parts)) {
      triangles += geometry.getAttribute('position').count / 3
    }

    expect(Object.keys(parts)).toHaveLength(8)
    expect(triangles).toBeLessThan(12_000)
  })
})

describe('Vesper signal loop', () => {
  const sampleAt = (ms: number) => sampleCitadelSignal(ms)

  it('runs a 7–12 second cycle that starts and ends idle', () => {
    expect(VESPER_SIGNAL_PERIOD_MS).toBeGreaterThanOrEqual(7_000)
    expect(VESPER_SIGNAL_PERIOD_MS).toBeLessThanOrEqual(12_000)
    for (const ms of [0, 1_500, 8_000, 9_900]) {
      const { charge, alignment, routing, transmission } = sampleAt(ms)
      expect(Math.max(charge, alignment, routing, transmission)).toBe(0)
    }
    expect(sampleAt(VESPER_SIGNAL_PERIOD_MS + 5_300)).toEqual(sampleAt(5_300))
  })

  it('charges, aligns, routes and transmits in order, then cools down', () => {
    const firstAbove = (key: 'charge' | 'alignment' | 'routing' | 'transmission') => {
      for (let ms = 0; ms < VESPER_SIGNAL_PERIOD_MS; ms += 20) {
        if (sampleAt(ms)[key] > 0.5) return ms
      }
      return Infinity
    }

    const charge = firstAbove('charge')
    const alignment = firstAbove('alignment')
    const routing = firstAbove('routing')
    const transmission = firstAbove('transmission')
    expect(charge).toBeLessThan(alignment)
    expect(alignment).toBeLessThan(routing)
    expect(routing).toBeLessThan(transmission)
    // Noticeable within five seconds of an idle start.
    expect(charge).toBeLessThan(5_000)
    expect(sampleAt(transmission + 1_500).transmission).toBe(0)
  })

  it('keeps cyan restrained at the transmission peak', () => {
    for (let ms = 0; ms < VESPER_SIGNAL_PERIOD_MS; ms += 25) {
      const pose = poseCitadelSignal(sampleAt(ms), ms)
      // Large lit surfaces stay at panel levels; only small tips reach LED level.
      expect(pose.core).toBeLessThanOrEqual(EMISSIVE_LIMITS.activePanel)
      expect(pose.routing).toBeLessThanOrEqual(EMISSIVE_LIMITS.activePanel)
      for (const level of [pose.crown, pose.array]) {
        expect(level).toBeLessThanOrEqual(EMISSIVE_LIMITS.tinyLed)
      }
      expect(pose.beam).toBeLessThanOrEqual(0.25)
      expect(Math.abs(pose.crownYaw)).toBeLessThan(0.5)
    }
  })

  it('only asks for frames in held close views the presentation does not already animate', () => {
    const phases: RivalPresentationPhase[] = [
      'idle', 'warning', 'orbital-transition', 'capsule-approach', 'impact',
      'intro-transmission', 'dual-sites', 'rival-focus', 'rival-focused',
      'scanning', 'scan-response', 'contested',
    ]
    const owned = phases.filter(citadelLoopNeedsFrames)
    expect(owned).toEqual(['intro-transmission', 'rival-focused', 'scan-response'])
    for (const phase of owned) {
      expect(rivalPresentationNeedsContinuousFrames(phase)).toBe(false)
    }
  })
})
