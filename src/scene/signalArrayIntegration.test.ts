import { afterAll, describe, expect, it } from 'vitest'
import type { Material } from 'three'
import { MONUMENTS, monumentModifiers, type MonumentStatus, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit, type AddPart } from '../render/octagonalKit.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import { authorMonument } from './octagonalModels.ts'
import { createSignalArrayParts, disposeSignalArrayParts, poseSignalArrayParts, signalArrayMonumentPoseTime } from './SignalArray.tsx'
import { authorSignalArrayBase, sampleSignalArray, SIGNAL_HELD_MS, SIGNAL_PETAL_VERTICES, SIGNAL_STOWED_MS } from './signalArrayModel.ts'

const kit = createOctagonalKit()
afterAll(() => disposeOctagonalKit(kit))

const record = (author: (add: AddPart) => void) => {
  const parts: unknown[][] = []
  author((...part) => { parts.push(part) })
  return parts
}
const triangles = (kind: Parameters<typeof authorMonument>[0]) => {
  const batches = batchOctagonalModel(kit, add => authorMonument(kind, add))
  const count = batches.reduce((sum, { geometry }) => sum + geometry.getAttribute('position').count / 3, 0)
  batches.forEach(({ geometry }) => geometry.dispose())
  return { finishes: batches.map(({ finish }) => finish), count }
}
const monument = (status: MonumentStatus): TerritoryMonumentSnapshot => ({
  kind: 'SIGNAL_ARRAY', anchor: 'outpost', status, phaseElapsedMs: 0, workMs: MONUMENTS.SIGNAL_ARRAY.laborMs / 2,
  repairWorkMs: 0, health: 30, wavesResolved: 3, orders: ['DEFEND', 'DEFEND', 'DEFEND'], productionPenalty: 0,
  energyLoss: 0, oreLost: 0, completedAtMs: null, revealSeen: false,
})

describe('Signal Array monument integration', () => {
  it('routes SIGNAL_ARRAY to the new static base alone, without the Spire plinth or the old ring array', () => {
    const parts = record(add => authorMonument('SIGNAL_ARRAY', add))
    expect(parts).toEqual(record(authorSignalArrayBase))
    expect(parts.some(([shape, finish]) => shape === 'ring' || finish === 'cyan')).toBe(false)
    expect(triangles('SIGNAL_ARRAY')).toEqual({ finishes: ['dark', 'gold', 'amber'], count: 1056 })
  })

  it('leaves the Spire plinth and every other monument untouched by the shared router', () => {
    expect(record(add => authorMonument('HELIOS_SPIRE', add)).slice(0, 2)).toEqual([
      ['bevel', 'dark', [0, 2, 0], [17, 4, 17]],
      ['ring', 'gold', [0, 3.5, 0], [15.8, 15.8, 6], [Math.PI / 2, 0, 0]],
    ])
    const all = ['dark', 'gold', 'amber', 'cyan']
    expect(triangles('HELIOS_SPIRE')).toEqual({ finishes: all, count: 1120 })
    expect(triangles('CRATER_CROWN')).toEqual({ finishes: all, count: 2080 })
    expect(triangles('BASTION_OBELISK')).toEqual({ finishes: all, count: 1164 })
  })

  it('deploys the head only while the detection modifier is live', () => {
    for (const status of ['constructing', 'command', 'wave', 'activating', 'damaged', 'repairing'] as const) {
      expect(monumentModifiers(monument(status)).detection).toBe(1)
      for (const revealAtMs of [null, 1000]) for (const reducedMotion of [false, true]) {
        expect(signalArrayMonumentPoseTime(monument(status), revealAtMs, 3750, reducedMotion)).toBe(SIGNAL_STOWED_MS)
      }
    }
    const complete = monument('complete')
    expect(monumentModifiers(complete).detection).toBe(1.5)
    expect(signalArrayMonumentPoseTime(complete, null, 3750, false)).toBe(SIGNAL_HELD_MS)
    // The reveal clock drives the sampler; reduced motion shows the held pose from the first frame.
    expect(signalArrayMonumentPoseTime(complete, 1000, 1000, false)).toBe(SIGNAL_STOWED_MS)
    expect(signalArrayMonumentPoseTime(complete, 1000, 3750, false)).toBe(2750)
    expect(signalArrayMonumentPoseTime(complete, 1000, 9000, false)).toBe(SIGNAL_HELD_MS)
    expect(signalArrayMonumentPoseTime(complete, 1000, 1000, true)).toBe(SIGNAL_HELD_MS)
  })

  it('splits the gold stream by sweep and animates only owned emissive instances', () => {
    const parts = createSignalArrayParts(kit)
    try {
      for (const [owned, shared] of [[parts.glow, kit.materials.gold], [parts.emitter, kit.materials.amber]] as const) {
        expect(owned).not.toBe(shared)
        expect(owned.type).toBe(shared.type)
        expect([owned.color.getHex(), owned.emissive.getHex(), owned.metalness, owned.roughness])
          .toEqual([shared.color.getHex(), shared.emissive.getHex(), shared.metalness, shared.roughness])
      }
      const total = parts.head.gold.getAttribute('position').count
      for (const time of [0, 1950, 2250, 2500, 2750, 3500, 4399, SIGNAL_HELD_MS]) {
        const pose = sampleSignalArray(time)
        poseSignalArrayParts(parts, pose)
        const lit = pose.lit * SIGNAL_PETAL_VERTICES
        expect(parts.head.goldGlow.drawRange).toEqual({ start: 0, count: lit })
        expect(parts.head.gold.drawRange).toEqual({ start: lit, count: total - lit })
        expect(parts.glow.emissiveIntensity).toBe(pose.glow)
        expect(parts.emitter.emissiveIntensity).toBe(pose.emitter)
      }
      expect(kit.materials.gold.emissiveIntensity).toBe(.08)
      expect(kit.materials.amber.emissiveIntensity).toBe(EMISSIVE_LIMITS.panel)
    } finally {
      disposeSignalArrayParts(parts)
    }
  })

  it('disposes the head streams and both owned materials once, never the shared kit', () => {
    const parts = createSignalArrayParts(kit)
    const owned = [parts.head.dark, parts.head.gold, parts.head.goldGlow, parts.head.emitter, parts.glow, parts.emitter]
    const counts = owned.map(() => 0)
    owned.forEach((resource, i) => resource.addEventListener('dispose', () => { counts[i]!++ }))
    let shared = 0
    const listener = () => { shared++ }
    const kitMaterials: Material[] = Object.values(kit.materials)
    kitMaterials.forEach(material => material.addEventListener('dispose', listener))
    try {
      disposeSignalArrayParts(parts)
      expect(counts).toEqual([1, 1, 1, 1, 1, 1])
      expect(shared).toBe(0)
    } finally {
      kitMaterials.forEach(material => material.removeEventListener('dispose', listener))
    }
  })
})
