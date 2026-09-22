import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import {
  DEPOSIT_BLUEPRINTS,
  RESOURCE_NAME,
  type MineralDeposit,
  type OutpostSnapshot,
} from '../domain/outpost.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { calculateMiningLaser } from './MinerRobot.tsx'

const site = createLandingSite(createLunarLocation(0.248, -0.684))
const terrain = createSurfaceTerrainProfile(site)

/** A minimal, otherwise-idle outpost with the robot mid-"mining" on one
 * deposit, so getRobotKinematics returns the same parked approach
 * position/heading the real scene uses when it calls calculateMiningLaser. */
function outpostMiningDeposit(targetDepositId: string, yieldRatio: number): OutpostSnapshot {
  const deposits: MineralDeposit[] = DEPOSIT_BLUEPRINTS.map(blueprint => ({
    id: blueprint.id,
    resource: RESOURCE_NAME,
    position: blueprint.position,
    orientationRad: blueprint.orientationRad,
    initialYield: blueprint.initialYield,
    remainingYield: blueprint.initialYield * yieldRatio,
  }))
  return {
    id: 'first-outpost',
    site,
    stage: 'extractor-active',
    establishedAtMs: 0,
    updatedAtMs: 0,
    lunarOre: 0,
    operations: { mode: 'BALANCED', storageCapacity: 400, lastUpdatedAtMs: 0 },
    robot: { id: 'miner-01', state: 'mining', stateStartedAtMs: 0, targetDepositId, carriedOre: 0 },
    deposits,
    extractor: null,
    orbitalSiege: null,
    monument: null,
    module: null,
  }
}

function laserFor(depositId: string, depositIndex: number, segments: number, yieldRatio = 1) {
  const outpost = outpostMiningDeposit(depositId, yieldRatio)
  const pose = getRobotKinematics(outpost, 0)
  const deposit = outpost.deposits[depositIndex]!
  return calculateMiningLaser(terrain, segments, pose.position.xM, pose.position.zM, pose.headingRad, deposit, depositIndex)
}

it.each([96, 112, 128])('lands the beam on the targeted ore cluster at %i segments, for every deposit', segments => {
  DEPOSIT_BLUEPRINTS.forEach((blueprint, depositIndex) => {
    const { emitter, contact, pitch } = laserFor(blueprint.id, depositIndex, segments)

    // No NaN/invalid transforms.
    for (const value of [emitter.x, emitter.y, emitter.z, contact.x, contact.y, contact.z, pitch]) {
      expect(Number.isFinite(value)).toBe(true)
    }

    // The contact sits near the deposit's own position, not out at the old
    // fixed 1.92 m ground point: comfortably inside the cluster's footprint
    // rather than floating past it in open regolith.
    const centerM = new Vector3(blueprint.position.xM, 0, blueprint.position.zM).multiplyScalar(LOCAL_METRES_TO_RENDER_UNITS)
    const contactToCenterM = new Vector3(contact.x, 0, contact.z).distanceTo(centerM) / LOCAL_METRES_TO_RENDER_UNITS
    expect(contactToCenterM).toBeGreaterThan(0.05)
    expect(contactToCenterM).toBeLessThan(1.3)

    // The contact remains safely above the terrain directly beneath it.
    const ground = sampleRenderedSurface(terrain, segments, contact.x / LOCAL_METRES_TO_RENDER_UNITS, contact.z / LOCAL_METRES_TO_RENDER_UNITS)
    expect((contact.y - ground.y) / LOCAL_METRES_TO_RENDER_UNITS).toBeGreaterThan(0.01)

    // The muzzle sits above the contact and the beam is a plausible,
    // non-degenerate length (never "extended far beyond the target").
    expect(emitter.y).toBeGreaterThan(contact.y)
    const beamLengthM = emitter.distanceTo(contact) / LOCAL_METRES_TO_RENDER_UNITS
    expect(beamLengthM).toBeGreaterThan(0.3)
    expect(beamLengthM).toBeLessThan(2.2)

    // The arm pitch aims generally forward-and-down at the contact, not
    // reverted to some degenerate/backward angle.
    expect(pitch).toBeGreaterThan(0)
    expect(pitch).toBeLessThan(Math.PI / 2)

    // The beam path does not clip through terrain anywhere along its length.
    for (let i = 0; i <= 20; i++) {
      const beam = new Vector3().lerpVectors(emitter, contact, i / 20)
      const surface = sampleRenderedSurface(terrain, segments, beam.x / LOCAL_METRES_TO_RENDER_UNITS, beam.z / LOCAL_METRES_TO_RENDER_UNITS)
      expect(beam.y).toBeGreaterThan(surface.y)
    }
  })
})

it.each(DEPOSIT_BLUEPRINTS.map((blueprint, index) => ({ blueprint, index })))(
  'is a deterministic pure function of terrain and deposit state for $blueprint.id',
  ({ blueprint, index }) => {
    const a = laserFor(blueprint.id, index, 112)
    const b = laserFor(blueprint.id, index, 112)
    expect(a.emitter.equals(b.emitter)).toBe(true)
    expect(a.contact.equals(b.contact)).toBe(true)
    expect(a.pitch).toBe(b.pitch)
  },
)

it('keeps targeting a real ore surface, above terrain and without NaNs, as the deposit depletes', () => {
  const blueprint = DEPOSIT_BLUEPRINTS[0]!
  for (const yieldRatio of [1, 0.6, 0.15]) {
    const { emitter, contact, pitch } = laserFor(blueprint.id, 0, 112, yieldRatio)
    for (const value of [emitter.x, emitter.y, emitter.z, contact.x, contact.y, contact.z, pitch]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    const ground = sampleRenderedSurface(terrain, 112, contact.x / LOCAL_METRES_TO_RENDER_UNITS, contact.z / LOCAL_METRES_TO_RENDER_UNITS)
    expect((contact.y - ground.y) / LOCAL_METRES_TO_RENDER_UNITS).toBeGreaterThan(0.01)
  }
})
