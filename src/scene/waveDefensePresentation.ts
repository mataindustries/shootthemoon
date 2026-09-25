import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { InstancedMesh } from 'three'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { defenseImpactAt } from '../domain/waveDefense.ts'
import { NOZZLE_EXITS, VANE_PIVOTS } from './interceptorModel.ts'
import type { Vec3 } from './interceptorModel.ts'
import { impactSpark } from './interceptorFlight.ts'
import type { WaveAttackFrame, WaveAttackInput } from './interceptorFlight.ts'

/** Interpolate at most one existing simulation tick; hidden/closed views never run ahead. */
export function defenseElapsed(m: Pick<WaveDefenseView, 'phaseElapsedMs' | 'status'>, sampledAtMs: number, nowMs: number, running: boolean) {
  return m.phaseElapsedMs + (m.status === 'wave' && running ? Math.max(0, Math.min(80, nowMs - sampledAtMs)) : 0)
}

export function defenseShake(elapsedMs: number, shotAtMs: number | null | undefined, reducedMotion: boolean): number {
  const impact = defenseImpactAt(shotAtMs)
  if (reducedMotion || impact === null) return 0
  const t = (elapsedMs - impact) / 280
  // A bounded lateral translation of both camera and target; no zoom, roll or accumulation.
  return t > 0 && t < 1 ? Math.sin(t * Math.PI * 4) * Math.sin(t * Math.PI) * (1 - t) * .0012 : 0
}

/** The existing shot record decides the lead's fate; the attack presentation only reads it. */
export function waveAttackInput(m: WaveDefenseView, elapsedMs: number, strikeAtMs: number, aim: Readonly<Vec3>): WaveAttackInput {
  return { wave: m.wavesResolved, elapsedMs, strikeAtMs, leadDestroyedAtMs: defenseImpactAt(m.defenseShots?.[m.wavesResolved]), aim }
}

export const IMPACT_SPARKS = 5
// Fire holds six vane-tip charge glows plus two bolts for each of the six pulse records. Each contact is a violet
// rim with a hot additive core and sparks drawn over it.
export const WAVE_ATTACK_CAPACITY = { ships: 3, vanes: 6, thrust: 6, fire: 6 + 12, impacts: 6, cores: 6 * (1 + IMPACT_SPARKS) } as const

export interface WaveAttackMeshes {
  /** One instanced mesh per hull finish, three instances each. */
  readonly hull: readonly InstancedMesh[]
  readonly vanes: InstancedMesh
  readonly thrust: InstancedMesh
  /** Vane-tip charge/muzzle glows and violet bolts share one draw. */
  readonly fire: InstancedMesh
  readonly impacts: InstancedMesh
  readonly cores: InstancedMesh
}

const UP = new Vector3(0, 1, 0)
// Each pulse is a half-path bolt that leaves the vane tip, strikes, and drains into the impact within its 70 ms.
// Contact feedback starts when the bolt's head arrives.
export const BOLT_LENGTH = .5
const BOLT_END_MS = 70
export const BOLT_ARRIVE_MS = BOLT_END_MS / (1 + BOLT_LENGTH)
const BOLT_WIDTH = .0008
const EMITTER_GLOW = .0011
const PLUME_LENGTH = 1.25
const PLUME_RADIUS = .12

export function createWaveAttackScratch() {
  return { object: new Object3D(), ship: new Matrix4(), matrix: new Matrix4(), quaternion: new Quaternion(),
    start: new Vector3(), end: new Vector3(), target: new Vector3(), size: new Vector3(), spark: [0, 0, 0] as Vec3 }
}

/**
 * Write one sampled attack frame into preallocated instanced meshes. Nothing is allocated per frame, and a transient
 * mesh draws only while it has live instances. Vanes compose M_ship · T(pivot) · Ry(side · yaw) · Rx(pitch), never a
 * mirrored scale.
 */
export function poseWaveAttack(frame: WaveAttackFrame, wave: number, meshes: WaveAttackMeshes, scratch = createWaveAttackScratch()) {
  const { object, ship, matrix, quaternion, start, end, target, size, spark } = scratch
  let shipsVisible = false, thrustVisible = false, fire = 0
  for (let index = 0; index < frame.ships.length; index++) {
    const pose = frame.ships[index]!
    shipsVisible ||= pose.visible
    object.position.fromArray(pose.position)
    object.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ')
    object.scale.setScalar(pose.visible ? pose.scale : 0)
    object.updateMatrix()
    ship.copy(object.matrix)
    for (const mesh of meshes.hull) mesh.setMatrixAt(index, ship)
    // Amber exhaust grows aft of each nozzle with the sampled thrust, then collapses to nothing. A parked fleet
    // (the allocation pause) is a still frame, so it never holds a lit plume.
    const thrust = pose.visible && pose.beat !== 'parked' && pose.thrust > .02 ? pose.thrust : 0
    const plume = PLUME_LENGTH * thrust
    thrustVisible ||= thrust > 0
    for (let side = 0; side < 2; side++) {
      object.position.fromArray(VANE_PIVOTS[side]!)
      object.rotation.set(pose.vanePitch, (side === 0 ? 1 : -1) * pose.vaneYaw, 0, 'YXZ')
      object.scale.setScalar(1)
      object.updateMatrix()
      meshes.vanes.setMatrixAt(index * 2 + side, matrix.multiplyMatrices(ship, object.matrix))
      const nozzle = NOZZLE_EXITS[side]!
      matrix.makeRotationX(-Math.PI / 2).scale(size.set(PLUME_RADIUS * (.6 + .4 * thrust), plume, PLUME_RADIUS * (.6 + .4 * thrust)))
        .setPosition(nozzle[0], nozzle[1], nozzle[2] - plume / 2)
      meshes.thrust.setMatrixAt(index * 2 + side, matrix.premultiply(ship))
    }
    // The weapon visibly charges at both vane tips before the volley, then flashes with each pulse.
    const glow = EMITTER_GLOW * Math.max(.6 * pose.charge, pose.muzzle)
    if (pose.visible && glow > EMITTER_GLOW * .02) {
      quaternion.setFromEuler(object.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ'))
      for (const emitter of pose.emitters) meshes.fire.setMatrixAt(fire++, matrix.compose(start.fromArray(emitter), quaternion, size.setScalar(glow)))
    }
  }

  let impacts = 0, cores = 0
  for (const pulse of frame.pulses) {
    if (pulse.boltVisible) {
      const travel = pulse.ageMs / BOLT_ARRIVE_MS
      const head = Math.min(1, travel)
      const tail = Math.min(1, Math.max(0, travel - BOLT_LENGTH))
      const width = BOLT_WIDTH * (.55 + .45 * pulse.intensity)
      for (let side = 0; side < 2; side++) {
        target.fromArray(pulse.to[side]!)
        start.fromArray(pulse.from[side]!).lerp(target, tail)
        end.fromArray(pulse.from[side]!).lerp(target, head).sub(start)
        const length = end.length()
        if (length < 1e-9) continue
        quaternion.setFromUnitVectors(UP, end.divideScalar(length))
        matrix.compose(start.addScaledVector(end, length / 2), quaternion, size.set(width, length, width))
        meshes.fire.setMatrixAt(fire++, matrix)
      }
    }
    if (!pulse.fired || !frame.effectsActive || pulse.ageMs < BOLT_ARRIVE_MS) continue
    if (pulse.impactFlash > 0) {
      meshes.impacts.setMatrixAt(impacts++, matrix.makeScale(pulse.impactFlash, pulse.impactFlash, pulse.impactFlash).setPosition(...pulse.impact))
      const core = pulse.impactFlash * .55
      meshes.cores.setMatrixAt(cores++, matrix.makeScale(core, core, core).setPosition(...pulse.impact))
    }
    for (let i = 0; i < IMPACT_SPARKS; i++) {
      const sparkSize = impactSpark(wave, pulse.impact, i, pulse.ageMs, spark)
      if (sparkSize > 0) meshes.cores.setMatrixAt(cores++, matrix.makeScale(sparkSize, sparkSize, sparkSize).setPosition(...spark))
    }
  }

  for (const mesh of meshes.hull) mesh.instanceMatrix.needsUpdate = true
  meshes.vanes.instanceMatrix.needsUpdate = true
  meshes.thrust.instanceMatrix.needsUpdate = true
  meshes.thrust.visible = thrustVisible
  showLive(meshes.fire, fire)
  showLive(meshes.impacts, impacts)
  showLive(meshes.cores, cores)
  return { shipsVisible, thrustVisible, fire, impacts: impacts + cores }
}

function showLive(mesh: InstancedMesh, count: number) {
  mesh.instanceMatrix.needsUpdate = count > 0
  mesh.count = count
  mesh.visible = count > 0
}
