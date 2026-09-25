import { afterAll, describe, expect, it } from 'vitest'
import { InstancedMesh, Matrix4, Object3D, Vector3 } from 'three'
import { OCTOGONALS } from '../content/octogonals.ts'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { DEFENSE_WINDOW_MS, defensePhase, resolveDefenseDamage } from '../domain/waveDefense.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { authorInterceptorHull, authorInterceptorVane, VANE_EMITTER_LOCAL, VANE_PIVOTS } from './interceptorModel.ts'
import type { Vec3 } from './interceptorModel.ts'
import { createWaveAttackFrame, sampleWaveAttack, waveAttackSchedule } from './interceptorFlight.ts'
import type { WaveAttackFrame } from './interceptorFlight.ts'
import { BOLT_ARRIVE_MS, BOLT_LENGTH, defenseShake, IMPACT_SPARKS, poseWaveAttack, WAVE_ATTACK_CAPACITY as CAPACITY, waveAttackInput } from './waveDefensePresentation.ts'
import type { WaveAttackMeshes } from './waveDefensePresentation.ts'

const AIM: Vec3 = [0, .022, 0]
const kit = createOctagonalKit()
const hull = batchOctagonalModel(kit, authorInterceptorHull)
const vane = batchOctagonalModel(kit, authorInterceptorVane)[0]!
const meshes: WaveAttackMeshes = {
  hull: hull.map(batch => new InstancedMesh(batch.geometry, kit.materials[batch.finish], CAPACITY.ships)),
  vanes: new InstancedMesh(vane.geometry, kit.materials.gold, CAPACITY.vanes),
  thrust: new InstancedMesh(kit.shapes.taper, kit.materials.amber, CAPACITY.thrust),
  fire: new InstancedMesh(kit.shapes.box, kit.materials.cyan, CAPACITY.fire),
  impacts: new InstancedMesh(kit.shapes.bevel, kit.materials.cyan, CAPACITY.impacts),
  cores: new InstancedMesh(kit.shapes.bevel, kit.materials.cyan, CAPACITY.cores),
}

function view(wave: number, shot: number | null, elapsed = 0): WaveDefenseView {
  const defenseShots = [null, null, null] as (number | null)[]
  defenseShots[wave] = shot
  return Object.freeze({ status: 'wave', phaseElapsedMs: elapsed, wavesResolved: wave, defenseShots: Object.freeze(defenseShots) })
}

function render(wave: number, elapsed: number, shot: number | null, strike: number = OCTOGONALS.waves[wave]!.durationMs) {
  const frame = sampleWaveAttack(waveAttackInput(view(wave, shot), elapsed, strike, AIM), createWaveAttackFrame())
  return { frame, result: poseWaveAttack(frame, wave, meshes) }
}

function instance(mesh: InstancedMesh, index: number) {
  return mesh.getMatrixAt(index, new Matrix4())
}

function shipMatrix(frame: WaveAttackFrame, index: number) {
  const pose = frame.ships[index]!
  const object = new Object3D()
  object.position.fromArray(pose.position)
  object.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ')
  object.scale.setScalar(pose.visible ? pose.scale : 0)
  object.updateMatrix()
  return object.matrix
}

// Instance matrices are stored as float32, so read-back comparisons use float32 precision.
const F32 = 1e-7

/** A lance lies on its pulse's emitter → impact segment: both of its ends are collinear with, and between, them. */
function onSegment(point: Vector3, from: Readonly<Vec3>, to: Readonly<Vec3>) {
  const a = new Vector3().fromArray(from), b = new Vector3().fromArray(to)
  const t = point.clone().sub(a).dot(b.clone().sub(a)) / b.distanceToSquared(a)
  return t >= -1e-5 && t <= 1 + 1e-5 && a.lerp(b, t).distanceTo(point) < F32
}

describe('wave defense DIVIDER presentation', () => {
  afterAll(() => {
    for (const batch of [...hull, vane]) batch.geometry.dispose()
    disposeOctagonalKit(kit)
  })

  it('reads the existing shot record without changing any simulation input or outcome', () => {
    const cases: [number | null, number | null][] = [[null, null], [200, 500], [1200, 1200], [2600, 2600], [2601, null], [NaN, null]]
    for (const [shot, destroyed] of cases) for (let wave = 0; wave < 3; wave++) {
      const frozen = view(wave, shot, 900)
      const snapshot = JSON.stringify(frozen)
      const input = waveAttackInput(frozen, 900, OCTOGONALS.waves[wave]!.durationMs, AIM)
      expect(input).toEqual({ wave, elapsedMs: 900, strikeAtMs: OCTOGONALS.waves[wave]!.durationMs, leadDestroyedAtMs: destroyed, aim: AIM })
      poseWaveAttack(sampleWaveAttack(input), wave, meshes)
      expect(JSON.stringify(frozen)).toBe(snapshot)
      // The outcome still comes only from the unchanged domain rules.
      expect(resolveDefenseDamage(28, shot)).toBe(destroyed === null ? 28 : 24)
      expect(defensePhase(900, shot)).toBe(shot === null || destroyed === null ? 'targeting' : 900 < destroyed ? 'queued' : 'hit')
    }
    expect(waveAttackSchedule(DEFENSE_WINDOW_MS, false).goneAtMs).toBeLessThan(DEFENSE_WINDOW_MS)
    for (const wave of OCTOGONALS.waves) expect(waveAttackSchedule(wave.durationMs, false).goneAtMs).toBeLessThan(wave.durationMs)
  })

  it('draws three DIVIDER hulls and six articulated vanes whose tips are the sampled weapon emitters', () => {
    const vaneLocal = new Matrix4(), emitter = new Vector3()
    for (let wave = 0; wave < 3; wave++) for (const elapsed of [0, 250, 1800, 5100, 5250, 5400, 5560, 5700]) {
      const { frame, result } = render(wave, elapsed, null, 6000)
      expect(result.shipsVisible).toBe(true)
      for (let index = 0; index < 3; index++) {
        const ship = shipMatrix(frame, index)
        for (const mesh of meshes.hull) instance(mesh, index).elements.forEach((value, i) => expect(value).toBeCloseTo(ship.elements[i]!, 8))
        const pose = frame.ships[index]!
        for (let side = 0; side < 2; side++) {
          const sign = side === 0 ? 1 : -1
          vaneLocal.makeTranslation(...VANE_PIVOTS[side]!)
            .multiply(new Matrix4().makeRotationY(sign * pose.vaneYaw)).multiply(new Matrix4().makeRotationX(pose.vanePitch))
          const actual = instance(meshes.vanes, index * 2 + side)
          const expected = ship.clone().multiply(vaneLocal)
          actual.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i]!, 8))
          // Never mirrored: both vanes keep the hull's handedness, so instanced winding stays front-facing.
          expect(actual.determinant()).toBeGreaterThan(0)
          emitter.fromArray(VANE_EMITTER_LOCAL).applyMatrix4(actual)
          expect(emitter.distanceTo(new Vector3().fromArray(pose.emitters[side]!))).toBeLessThan(F32)
        }
      }
    }
  })

  it('sweeps the vanes back on ingress, snaps them into a forward claw for the attack, and folds them in the break', () => {
    const tipZ = (frame: WaveAttackFrame, index: number, side: number) =>
      new Vector3().fromArray(VANE_EMITTER_LOCAL).applyMatrix4(instance(meshes.vanes, index * 2 + side))
        .applyMatrix4(shipMatrix(frame, index).invert()).z
    const strike = 7000, run = strike - 1000
    for (let index = 0; index < 3; index++) {
      const breakAt = waveAttackSchedule(strike, false).breakAtMs[index]!
      for (const [elapsed, forward] of [[250, false], [3000, false], [run + 180, true], [breakAt - 10, true], [breakAt + 180, false]] as const) {
        const { frame } = render(1, elapsed, null, strike)
        for (let side = 0; side < 2; side++) expect(tipZ(frame, index, side) > 0, `ship=${index}, E=${elapsed}`).toBe(forward)
      }
    }
  })

  it('fires two paired violet bolts per surviving ship from the vane tips into the aim, with charge, contact and exhaust only while live', () => {
    for (let wave = 0; wave < 3; wave++) for (const strike of [DEFENSE_WINDOW_MS, OCTOGONALS.waves[wave]!.durationMs]) {
      const schedule = waveAttackSchedule(strike, false)
      const firstPulse = new Map<number, number>()
      for (let elapsed = 0; elapsed <= strike + 200; elapsed += 5) {
        const { frame, result } = render(wave, elapsed, null, strike)
        const glowing = frame.ships.filter(ship => ship.visible && Math.max(.6 * ship.charge, ship.muzzle) > .02).length
        const lances = frame.pulses.filter(pulse => pulse.boltVisible && pulse.ageMs > 0)
        expect(result.fire).toBe(glowing * 2 + lances.length * 2)
        expect(meshes.fire.visible).toBe(result.fire > 0)
        expect(meshes.fire.count).toBe(result.fire)
        for (const [n, pulse] of lances.entries()) for (let side = 0; side < 2; side++) {
          const matrix = instance(meshes.fire, glowing * 2 + n * 2 + side)
          const tail = new Vector3(0, -.5, 0).applyMatrix4(matrix), head = new Vector3(0, .5, 0).applyMatrix4(matrix)
          expect(onSegment(tail, pulse.from[side]!, pulse.to[side]!)).toBe(true)
          expect(onSegment(head, pulse.from[side]!, pulse.to[side]!)).toBe(true)
          // A short bolt, never a beam: at most half the path long, head leading from the vane tip to the base.
          const from = new Vector3().fromArray(pulse.from[side]!), to = new Vector3().fromArray(pulse.to[side]!)
          expect(head.distanceTo(from)).toBeGreaterThan(tail.distanceTo(from))
          expect(head.distanceTo(tail)).toBeLessThanOrEqual(BOLT_LENGTH * from.distanceTo(to) + F32)
          if (pulse.ageMs <= BOLT_ARRIVE_MS * BOLT_LENGTH) expect(tail.distanceTo(from)).toBeLessThan(F32)
          if (pulse.ageMs >= BOLT_ARRIVE_MS) expect(head.distanceTo(to)).toBeLessThan(F32)
          if (!firstPulse.has(pulse.ship * 2 + pulse.index)) firstPulse.set(pulse.ship * 2 + pulse.index, elapsed)
        }
        const flashes = frame.pulses.filter(pulse => pulse.fired && pulse.impactFlash > 0 && pulse.ageMs >= BOLT_ARRIVE_MS).length * 2
        const sparks = frame.effectsActive ? frame.pulses.filter(pulse => pulse.fired && pulse.ageMs >= BOLT_ARRIVE_MS && pulse.ageMs < 220).length * IMPACT_SPARKS : 0
        expect(result.impacts).toBe(flashes + sparks)
        expect(meshes.impacts.visible).toBe(flashes > 0)
        expect(meshes.impacts.count).toBe(flashes / 2)
        expect(meshes.cores.visible).toBe(result.impacts > 0)
        for (const mesh of [meshes.impacts, meshes.cores]) for (let i = 0; i < mesh.count; i++) {
          const point = new Vector3().setFromMatrixPosition(instance(mesh, i))
          expect(point.distanceTo(new Vector3().fromArray(AIM))).toBeLessThan(.015)
        }
        expect(result.thrustVisible).toBe(frame.ships.some(ship => ship.visible && ship.beat !== 'parked' && ship.thrust > .02))
        expect(meshes.thrust.visible).toBe(result.thrustVisible)
        if (elapsed >= schedule.goneAtMs) {
          expect(result.shipsVisible).toBe(false)
          expect(meshes.fire.visible || meshes.impacts.visible || meshes.cores.visible || meshes.thrust.visible).toBe(false)
        }
      }
      expect([...firstPulse.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('never shows a destroyed lead, its charge, or any of its later pulses, and keeps both escorts firing', () => {
    for (let wave = 0; wave < 3; wave++) for (const shot of [200, 1200, 2600]) {
      const strike = OCTOGONALS.waves[wave]!.durationMs
      const escortPulses = new Set<number>()
      for (let elapsed = Math.max(500, shot); elapsed <= strike; elapsed += 5) {
        const { frame, result } = render(wave, elapsed, shot, strike)
        expect(Math.abs(instance(meshes.hull[0]!, 1).determinant())).toBe(0)
        const lead = frame.ships[1]!
        expect(lead.visible || lead.charge > 0 || lead.muzzle > 0).toBe(false)
        expect(frame.pulses.filter(pulse => pulse.ship === 1).some(pulse => pulse.fired)).toBe(false)
        const glowing = frame.ships.filter(ship => ship.visible && Math.max(.6 * ship.charge, ship.muzzle) > .02).length
        const lances = frame.pulses.filter(pulse => pulse.boltVisible && pulse.ageMs > 0)
        expect(result.fire).toBe(glowing * 2 + lances.length * 2)
        for (const pulse of lances) escortPulses.add(pulse.ship * 2 + pulse.index)
        expect(frame.hasKillPoint).toBe(true)
      }
      expect([...escortPulses].sort()).toEqual([0, 1, 4, 5])
    }
  })

  it('holds no lit effect while the fleet is parked for the allocation choice', () => {
    for (let wave = 0; wave < 3; wave++) {
      const { frame, result } = render(wave, 0, null)
      expect(frame.ships.every(ship => ship.beat === 'parked' && ship.visible)).toBe(true)
      expect(result).toEqual({ shipsVisible: true, thrustVisible: false, fire: 0, impacts: 0 })
    }
  })

  it('returns every mesh to its idle state after the attack, whatever the prior frame drew', () => {
    for (let wave = 0; wave < 3; wave++) for (const strike of [DEFENSE_WINDOW_MS, OCTOGONALS.waves[wave]!.durationMs]) {
      render(wave, strike - 700 + 60, null, strike)
      expect(meshes.fire.visible && meshes.impacts.visible && meshes.cores.visible).toBe(true)
      for (const elapsed of [strike - 40, strike, strike + 5000]) {
        const { frame, result } = render(wave, elapsed, null, strike)
        expect(frame.effectsActive).toBe(false)
        expect(result).toEqual({ shipsVisible: false, thrustVisible: false, fire: 0, impacts: 0 })
        expect([meshes.fire, meshes.impacts, meshes.cores, meshes.thrust].map(mesh => mesh.visible)).toEqual([false, false, false, false])
      }
    }
  })

  it('the shake is bounded, deterministic, returns to the exact camera pose and respects reduced motion', () => {
    for (let ms = 0; ms <= 2000; ms++) {
      const shake = defenseShake(ms, 600, false)
      expect(Math.abs(shake)).toBeLessThan(.0012)
      expect(shake).toBe(defenseShake(ms, 600, false))
      expect(defenseShake(ms, 600, true)).toBe(0)
      expect(defenseShake(ms, null, false)).toBe(0)
      if (ms <= 600 || ms >= 880) expect(shake).toBe(0)
    }
    expect(defenseShake(700, 3000, false)).toBe(0)
  })
})
