import { afterAll, describe, expect, it } from 'vitest'
import { Group, type Material } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { MONUMENTS, monumentModifiers, type MonumentStatus, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit, type AddPart } from '../render/octagonalKit.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import {
  craterCrownMonumentPoseTime, createCraterCrownParts, disposeCraterCrownParts, poseCraterCrownParts,
} from './CraterCrown.tsx'
import {
  authorCraterCrownBore, authorCraterCrownStatic, craterCrownDefenseMount, craterCrownLift, sampleCraterCrown,
  CROWN_BORE_STROKE, CROWN_CLAIM_Y, CROWN_GLOW, CROWN_HELD_MS, CROWN_STOWED_MS, CROWN_TURRET_SEAT_Y,
} from './craterCrownModel.ts'
import { authorMonument } from './octagonalModels.ts'

const kit = createOctagonalKit()
afterAll(() => disposeOctagonalKit(kit))

const record = (author: (add: AddPart) => void) => {
  const parts: unknown[][] = []
  author((...part) => { parts.push(part) })
  return parts
}
const triangles = (author: (add: AddPart) => void) => {
  const batches = batchOctagonalModel(kit, author)
  const count = batches.reduce((sum, { geometry }) => sum + geometry.getAttribute('position').count / 3, 0)
  batches.forEach(({ geometry }) => geometry.dispose())
  return { finishes: batches.map(({ finish }) => finish), count }
}
// FNV-1a over the recorded parts: a platform-independent fingerprint of an author's exact output.
const fingerprint = (author: (add: AddPart) => void) => {
  const text = JSON.stringify(record(author))
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
const monument = (status: MonumentStatus): TerritoryMonumentSnapshot => ({
  kind: 'CRATER_CROWN', anchor: 'impact-scar', status, phaseElapsedMs: 0, workMs: MONUMENTS.CRATER_CROWN.laborMs / 2,
  repairWorkMs: 0, health: 30, wavesResolved: 3, orders: ['DEFEND', 'DEFEND', 'DEFEND'], productionPenalty: 0,
  energyLoss: 0, oreLost: 0, completedAtMs: null, revealSeen: false,
})

describe('Crater Crown monument integration', () => {
  it('routes CRATER_CROWN to the fabricated static Crown alone, with the old ring and its cyan beacons gone', () => {
    const parts = record(add => authorMonument('CRATER_CROWN', add))
    expect(parts).toEqual(record(authorCraterCrownStatic))
    expect(parts.some(([shape, finish]) => shape === 'taper' || finish === 'cyan')).toBe(false)
    expect(triangles(add => authorMonument('CRATER_CROWN', add))).toEqual({ finishes: ['dark', 'gold', 'amber'], count: 1624 })
    expect(triangles(authorCraterCrownBore)).toEqual({ finishes: ['dark'], count: 288 })
  })

  it('leaves the other three monument authors byte-for-byte unchanged', () => {
    // Fingerprints recorded from the pre-integration router.
    expect(fingerprint(add => authorMonument('HELIOS_SPIRE', add))).toBe('b5b250ac')
    expect(fingerprint(add => authorMonument('BASTION_OBELISK', add))).toBe('c703fac2')
    expect(fingerprint(add => authorMonument('SIGNAL_ARRAY', add))).toBe('09c6e2a6')
  })

  it('deploys the bore only while the extraction modifier is live', () => {
    for (const status of ['constructing', 'command', 'wave', 'activating', 'damaged', 'repairing'] as const) {
      expect(monumentModifiers(monument(status)).extraction).toBe(1)
      for (const revealAtMs of [null, 1000]) for (const reducedMotion of [false, true]) {
        expect(craterCrownMonumentPoseTime(monument(status), revealAtMs, 3750, reducedMotion)).toBe(CROWN_STOWED_MS)
      }
    }
    const complete = monument('complete')
    expect(monumentModifiers(complete).extraction).toBe(1.2)
    expect(craterCrownMonumentPoseTime(complete, null, 3750, false)).toBe(CROWN_HELD_MS)
    // The reveal clock drives one plunge; reduced motion shows the held pose from the first frame.
    expect(craterCrownMonumentPoseTime(complete, 1000, 1000, false)).toBe(CROWN_STOWED_MS)
    expect(craterCrownMonumentPoseTime(complete, 1000, 2350, false)).toBe(1350)
    expect(craterCrownMonumentPoseTime(complete, 1000, 9000, false)).toBe(CROWN_HELD_MS)
    expect(craterCrownMonumentPoseTime(complete, 1000, 1000, true)).toBe(CROWN_HELD_MS)
  })

  it('raises the bore by its stroke in model metres and animates only an owned amber instance', () => {
    const parts = createCraterCrownParts(kit)
    const bore = new Group()
    try {
      expect(parts.glow).not.toBe(kit.materials.amber)
      expect([parts.glow.type, parts.glow.color.getHex(), parts.glow.emissive.getHex(), parts.glow.metalness, parts.glow.roughness])
        .toEqual([kit.materials.amber.type, kit.materials.amber.color.getHex(), kit.materials.amber.emissive.getHex(),
          kit.materials.amber.metalness, kit.materials.amber.roughness])
      for (const time of [CROWN_STOWED_MS, 700, 1350, 2000, 2200, 2800, CROWN_HELD_MS]) {
        const pose = sampleCraterCrown(time)
        poseCraterCrownParts(parts, bore, pose)
        expect(bore.position.y).toBe(pose.bore)
        expect(parts.glow.emissiveIntensity).toBe(pose.glow)
      }
      poseCraterCrownParts(parts, bore, sampleCraterCrown(CROWN_STOWED_MS))
      expect([bore.position.y, parts.glow.emissiveIntensity]).toEqual([CROWN_BORE_STROKE, CROWN_GLOW.stowed])
      expect(kit.materials.amber.emissiveIntensity).toBe(EMISSIVE_LIMITS.panel)
    } finally {
      disposeCraterCrownParts(parts)
    }
  })

  it('disposes the bore geometry and owned glow once, never the shared kit', () => {
    const parts = createCraterCrownParts(kit)
    const counts = [0, 0]
    parts.bore.addEventListener('dispose', () => { counts[0]!++ })
    parts.glow.addEventListener('dispose', () => { counts[1]!++ })
    let shared = 0
    const listener = () => { shared++ }
    const kitMaterials: Material[] = Object.values(kit.materials)
    kitMaterials.forEach(material => material.addEventListener('dispose', listener))
    try {
      disposeCraterCrownParts(parts)
      expect(counts).toEqual([1, 1])
      expect(shared).toBe(0)
    } finally {
      kitMaterials.forEach(material => material.removeEventListener('dispose', listener))
    }
  })

  it('seats the turret on the cap and clears the claim marker at both production scales', () => {
    const terrain = createSurfaceTerrainProfile(createLandingSite(createLunarLocation(.248, -.684, 18)))
    for (const [unit, ground] of [[.001, 0], [.0005, sampleRenderedSurface(terrain, 96, 0, 0).y]] as const) {
      const lift = craterCrownLift(ground, unit)
      // The rigid lift puts the authored datum (model y = -.7) on the rendered ground at the centre.
      expect(.0007 + unit * (-.7 + lift)).toBeCloseTo(ground, 12)
      for (const squash of [.08, .25, .5, .75, 1]) {
        const cap = .0007 + unit * squash * (CROWN_TURRET_SEAT_Y + lift)
        const [x, y, z] = craterCrownDefenseMount(unit, squash, lift)
        expect([x, z]).toEqual([0, 0])
        // The turret base (a .004-tall bevel centred on the mount) rests on the cap.
        expect(y - .002).toBeCloseTo(cap, 12)
        expect(y + .009).toBeGreaterThanOrEqual(.004)
        expect(y + .009).toBeLessThanOrEqual(.07)
      }
      // The claim spike (±.006 at close range) floats clear of the completed cap.
      expect(unit * (CROWN_CLAIM_Y + lift) - .006).toBeGreaterThan(unit * (CROWN_TURRET_SEAT_Y + lift))
    }
  })
})
