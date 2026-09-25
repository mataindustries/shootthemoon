import { OCTOGONALS } from '../content/octogonals.ts'
import { DEFENSE_FIRE_END_MS, DEFENSE_LOCK_MS, DEFENSE_WINDOW_MS } from '../domain/waveDefense.ts'
import { INTERCEPTOR_SCALE, VANE_DEPLOYED, VANE_TUCKED, interceptorEmitterLocal } from './interceptorModel.ts'
import type { Vec3 } from './interceptorModel.ts'

export type InterceptorBeat = 'parked' | 'ingress' | 'stalk' | 'hold' | 'lock' | 'dive' | 'break' | 'gone' | 'destroyed'

export interface WaveAttackInput {
  wave: number
  elapsedMs: number
  strikeAtMs: number
  leadDestroyedAtMs: number | null
  aim: Readonly<Vec3>
}

export interface InterceptorPose {
  beat: InterceptorBeat
  visible: boolean
  position: Vec3
  // Euler YXZ: positive pitch points the nose down.
  yaw: number
  pitch: number
  roll: number
  scale: number
  vaneYaw: number
  vanePitch: number
  thrust: number
  charge: number
  muzzle: number
  emitters: [Vec3, Vec3]
}

export interface InterceptorPulse {
  ship: number
  index: 0 | 1
  fired: boolean
  boltVisible: boolean
  intensity: number
  ageMs: number
  from: [Vec3, Vec3]
  to: [Vec3, Vec3]
  impact: Vec3
  impactFlash: number
}

export interface WaveAttackFrame {
  ships: [InterceptorPose, InterceptorPose, InterceptorPose]
  // Six records, indexed by ship * 2 + pulse index.
  pulses: InterceptorPulse[]
  killPoint: Vec3
  hasKillPoint: boolean
  effectsActive: boolean
}

const RUN_MS = 1000
const LOCK_MS = 180
const FIRE_OFFSET_MS = 300
const FIRE_STAGGER_MS = 130
const PULSE_GAP_MS = 100
const PULSE_MS = 70
const MUZZLE_MS = 40
const CHARGE_MS = 150
const BREAK_AFTER_FIRE_MS = 170
const ROLL_IN_MS = 120
const FOLD_MS = 180
const SHRINK_MS = 90
const EXIT_MARGIN_MS = 40
const IMPACT_FLASH_MS = 140
const SPARK_MS = 220
const JINK_MS = 450
const DEG = Math.PI / 180
const TAU = 2 * Math.PI

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const progress = (start: number, end: number, time: number) => clamp01((time - start) / (end - start))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const smoothstep = (start: number, end: number, time: number) => {
  const t = progress(start, end, time)
  return t * t * (3 - 2 * t)
}
const angleMix = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
const sideOf = (ship: number) => ship === 0 ? -1 : 1

function createPose(): InterceptorPose {
  return {
    beat: 'parked', visible: true, position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0,
    scale: 0, vaneYaw: VANE_TUCKED.yaw, vanePitch: 0, thrust: 0, charge: 0, muzzle: 0,
    emitters: [[0, 0, 0], [0, 0, 0]],
  }
}

function createPulse(ship: number, index: 0 | 1): InterceptorPulse {
  return {
    ship, index, fired: false, boltVisible: false, intensity: 0, ageMs: 0,
    from: [[0, 0, 0], [0, 0, 0]], to: [[0, 0, 0], [0, 0, 0]],
    impact: [0, 0, 0], impactFlash: 0,
  }
}

export function createWaveAttackFrame(): WaveAttackFrame {
  return {
    ships: [createPose(), createPose(), createPose()],
    pulses: [createPulse(0, 0), createPulse(0, 1), createPulse(1, 0), createPulse(1, 1), createPulse(2, 0), createPulse(2, 1)],
    killPoint: [0, 0, 0], hasKillPoint: false, effectsActive: false,
  }
}

export function waveAttackSchedule(strikeAtMs: number, leadDestroyed: boolean) {
  const strike = Math.max(DEFENSE_WINDOW_MS, strikeAtMs)
  const runAtMs = strike - RUN_MS
  const first = runAtMs + FIRE_OFFSET_MS
  const fireAtMs = [first, leadDestroyed ? null : first + FIRE_STAGGER_MS, first + 2 * FIRE_STAGGER_MS]
  return {
    runAtMs,
    lockEndMs: runAtMs + LOCK_MS,
    fireAtMs,
    breakAtMs: fireAtMs.map(time => time === null ? null : time + BREAK_AFTER_FIRE_MS),
    shrinkAtMs: strike - EXIT_MARGIN_MS - SHRINK_MS,
    goneAtMs: strike - EXIT_MARGIN_MS,
  }
}

function weaveEnvelope(time: number, run: number) {
  return smoothstep(DEFENSE_LOCK_MS, 900, time) * (1 - smoothstep(run, run + LOCK_MS, time))
}

function samplePosition(
  input: WaveAttackInput, ship: number, time: number, run: number, breakAt: number,
  gone: number, hx: number, hz: number, originY: number, out: Vec3,
) {
  const e = Math.max(0, time)
  const approach = easeOutCubic(progress(0, DEFENSE_LOCK_MS, e))
  const stalk = smoothstep(DEFENSE_LOCK_MS, DEFENSE_FIRE_END_MS, e)
  let r = mix(.0495, .044, approach) - .003 * stalk
  let h = mix(.112 + .01 * originY, .104, approach)
  let s = 0
  if (ship !== 1) {
    const formation = smoothstep(0, 1100, e)
    r += mix(.012, .008, formation)
    s = sideOf(ship) * mix(.024, .016, formation)
    h += mix(ship === 0 ? .006 : .003, ship === 0 ? .004 : .001, formation)
  }
  const envelope = weaveEnvelope(e, run)
  s += .0025 * Math.sin(TAU * (e - DEFENSE_LOCK_MS) / 1600 + .9 * ship) * envelope
  h += .0012 * Math.sin(TAU * (e - DEFENSE_LOCK_MS) / 1100) * envelope

  if (e >= run + LOCK_MS) {
    const duration = breakAt - run - LOCK_MS
    const dive = progress(run + LOCK_MS, breakAt, e)
    r -= .010 * dive * dive
    h -= .005 * dive * dive
    if (e >= breakAt) {
      const exitDuration = gone - breakAt
      const u = progress(breakAt, gone, e)
      const deltaWeight = .2 * u ** 3 + .8 * u * u
      const tangentWeight = u ** 3 - 2 * u * u + u
      r += (ship === 1 ? .030 : .018) * deltaWeight - .020 / duration * exitDuration * tangentWeight
      s += (ship === 1 ? .006 : sideOf(ship) * .050) * deltaWeight
      h += (ship === 1 ? .045 : .032) * deltaWeight - .010 / duration * exitDuration * tangentWeight
    }
  }

  let x = hx * r - hz * s
  let z = hz * r + hx * s
  if (e >= DEFENSE_FIRE_END_MS && e < run) {
    const u = (e - DEFENSE_FIRE_END_MS) / (run - DEFENSE_FIRE_END_MS)
    const angle = .35 * Math.sin(Math.PI * u) * Math.min(1, (run - DEFENSE_FIRE_END_MS) / 1500)
    // Swing about the monument axis that r and s are measured from, so an off-axis aim cannot push the formation out of frame.
    const dx = x, dz = z
    x = Math.cos(angle) * dx + Math.sin(angle) * dz
    z = -Math.sin(angle) * dx + Math.cos(angle) * dz
  }
  if (ship !== 1 && input.leadDestroyedAtMs !== null) {
    const a = (e - input.leadDestroyedAtMs) / JINK_MS
    if (a >= 0 && a < 1) {
      const jink = sideOf(ship) * .005 * Math.sin(Math.PI * a)
      x -= hz * jink
      z += hx * jink
    }
  }
  out[0] = x
  out[1] = Math.max(.096, h)
  out[2] = z
}

function transformEmitter(pose: InterceptorPose, side: 1 | -1, out: Vec3) {
  interceptorEmitterLocal(side, pose.vaneYaw, pose.vanePitch, out)
  const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll)
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch)
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw)
  const x = (cr * out[0] - sr * out[1]) * pose.scale
  const y = (sr * out[0] + cr * out[1]) * pose.scale
  const z = out[2] * pose.scale
  const ry = cp * y - sp * z
  const rz = sp * y + cp * z
  out[0] = pose.position[0] + cy * x + sy * rz
  out[1] = pose.position[1] + ry
  out[2] = pose.position[2] - sy * x + cy * rz
}

function copyVec(from: Readonly<Vec3>, to: Vec3) {
  to[0] = from[0]
  to[1] = from[1]
  to[2] = from[2]
}

export function sampleWaveAttack(input: WaveAttackInput, out = createWaveAttackFrame()): WaveAttackFrame {
  const origin = (OCTOGONALS.waves[input.wave] ?? OCTOGONALS.waves[0]).origin
  const length = Math.hypot(origin[0], origin[2])
  const hx = origin[0] / length, hz = origin[2] / length
  const strike = Math.max(DEFENSE_WINDOW_MS, input.strikeAtMs)
  const run = strike - RUN_MS
  const gone = strike - EXIT_MARGIN_MS
  const e = input.elapsedMs
  out.effectsActive = false

  for (let ship = 0; ship < out.ships.length; ship++) {
    const pose = out.ships[ship]
    if (!pose) continue
    const fire = run + FIRE_OFFSET_MS + FIRE_STAGGER_MS * ship
    const breakAt = fire + BREAK_AFTER_FIRE_MS
    const destroyed = ship === 1 && input.leadDestroyedAtMs !== null && e >= input.leadDestroyedAtMs
    pose.beat = destroyed ? 'destroyed' : e >= gone ? 'gone' : e >= breakAt ? 'break'
      : e >= run + LOCK_MS ? 'dive' : e >= run ? 'lock' : e >= DEFENSE_FIRE_END_MS ? 'hold'
      : e >= DEFENSE_LOCK_MS ? 'stalk' : e > 0 ? 'ingress' : 'parked'
    pose.visible = !destroyed && e < gone
    pose.scale = pose.visible ? (ship === 1 ? INTERCEPTOR_SCALE.lead : INTERCEPTOR_SCALE.escort)
      * (1 - smoothstep(gone - SHRINK_MS, gone, e)) : 0
    samplePosition(input, ship, e, run, breakAt, gone, hx, hz, origin[1], pose.position)

    const dx = input.aim[0] - pose.position[0], dz = input.aim[2] - pose.position[2]
    const aimYaw = Math.atan2(dx, dz)
    const aimPitch = Math.atan2(pose.position[1] - input.aim[1], Math.hypot(dx, dz))
    const pitchCap = mix(18, 40, smoothstep(run, run + LOCK_MS, e)) * DEG
    pose.yaw = aimYaw
    pose.pitch = Math.max(-pitchCap, Math.min(pitchCap, aimPitch))
    pose.roll = -6 * DEG * Math.cos(TAU * (e - DEFENSE_LOCK_MS) / 1600 + .9 * ship) * weaveEnvelope(e, run)

    if (e < 650 || e >= breakAt) {
      // Emitter storage is scratch until both world emitters are written below.
      const before = pose.emitters[0], after = pose.emitters[1]
      const time = e < 650 ? Math.max(0, Math.min(350, e)) : Math.min(e, gone - .5)
      samplePosition(input, ship, time - .5, run, breakAt, gone, hx, hz, origin[1], before)
      samplePosition(input, ship, time + .5, run, breakAt, gone, hx, hz, origin[1], after)
      const vx = after[0] - before[0], vy = after[1] - before[1], vz = after[2] - before[2]
      const tangentYaw = Math.hypot(vx, vz) > 1e-15 ? Math.atan2(vx, vz) : aimYaw
      const tangentPitch = Math.hypot(vx, vy, vz) > 1e-15 ? Math.atan2(-vy, Math.hypot(vx, vz)) : pose.pitch
      if (e < 650) {
        const blend = smoothstep(350, 650, e)
        pose.yaw = angleMix(tangentYaw, aimYaw, blend)
        pose.pitch = angleMix(tangentPitch, pose.pitch, blend)
      } else {
        samplePosition(input, ship, breakAt, run, breakAt, gone, hx, hz, origin[1], before)
        const startYaw = Math.atan2(input.aim[0] - before[0], input.aim[2] - before[2])
        const startPitch = Math.max(-40 * DEG, Math.min(40 * DEG,
          Math.atan2(before[1] - input.aim[1], Math.hypot(input.aim[0] - before[0], input.aim[2] - before[2]))))
        const dr = ship === 1 ? .030 : .018
        const ds = ship === 1 ? .006 : sideOf(ship) * .050
        const endYaw = Math.atan2(hx * dr - hz * ds, hz * dr + hx * ds)
        const yawDuration = ship === 1 ? 140 : ROLL_IN_MS
        let turn = progress(breakAt, breakAt + yawDuration, e)
        if (ship === 2) {
          // The shorter escort exit needs most of its turn before the last third.
          const tail = 3 * turn - 2
          turn = turn < 2 / 3 ? 1.125 * turn : .75 + .375 * tail - .125 * tail ** 3
        }
        pose.yaw = angleMix(startYaw, endYaw, turn)
        pose.yaw = angleMix(pose.yaw, tangentYaw, smoothstep(breakAt + yawDuration, breakAt + yawDuration + ROLL_IN_MS, e))
        const pitchProgress = progress(breakAt, breakAt + ROLL_IN_MS, e)
        pose.pitch = angleMix(startPitch, tangentPitch, ship === 2 ? 1 - (1 - pitchProgress) ** 2 : easeOutCubic(pitchProgress))
        if (ship === 1) {
          // Cross the near-vertical tangent with a continuous 120 ms pitch arc.
          const age = e - breakAt
          const crestPitch = -84 * DEG
          const rate = (startPitch - crestPitch) / 100
          const settle = progress(80, ROLL_IN_MS, age)
          pose.pitch = startPitch - rate * Math.min(80, age) - rate * 20 * (2 * settle - settle * settle)
          if (age >= ROLL_IN_MS) {
            const alignedPitch = Math.atan2(-vy, vx * Math.sin(pose.yaw) + vz * Math.cos(pose.yaw))
            pose.pitch = angleMix(crestPitch, alignedPitch, easeOutCubic(progress(ROLL_IN_MS, 2 * ROLL_IN_MS, age)))
          }
        }
        pose.roll = -sideOf(ship) * (ship === 1 ? 55 : 78) * DEG
          * easeOutCubic(progress(breakAt, breakAt + ROLL_IN_MS, e))
      }
    }

    const deployment = progress(run, run + LOCK_MS, e)
    const back = 1 + 2.3 * (deployment - 1) ** 3 + 1.3 * (deployment - 1) ** 2
    pose.vaneYaw = Math.max(22 * DEG, mix(VANE_TUCKED.yaw, VANE_DEPLOYED.yaw, back))
    pose.vanePitch = mix(VANE_TUCKED.pitch, VANE_DEPLOYED.pitch, smoothstep(run, run + LOCK_MS, e))
    if (e >= breakAt) {
      const t = progress(breakAt, breakAt + FOLD_MS, e)
      const fold = t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
      pose.vaneYaw = mix(VANE_DEPLOYED.yaw, VANE_TUCKED.yaw, fold)
      pose.vanePitch = mix(VANE_DEPLOYED.pitch, VANE_TUCKED.pitch, fold)
    }

    pose.thrust = .7 * (1 - progress(0, 400, e)) ** 2
    if (e >= breakAt) {
      const age = e - breakAt
      pose.thrust = age < 60 ? age / 60 : mix(1, .45, progress(60, 260, age))
    }
    if (ship !== 1 && input.leadDestroyedAtMs !== null) {
      const age = e - input.leadDestroyedAtMs
      if (age >= 0 && age < JINK_MS) {
        pose.roll -= sideOf(ship) * .52 * Math.sin(Math.PI * age / JINK_MS)
        pose.thrust += .5 * Math.sin(Math.PI * Math.min(1, age / 200))
      }
    }
    pose.charge = e < fire ? progress(fire - CHARGE_MS, fire, e) ** 2
      : 1 - progress(fire + BREAK_AFTER_FIRE_MS, fire + 250, e)
    pose.muzzle = 0
    for (let pulse = 0; pulse < 2; pulse++) {
      const start = fire + pulse * PULSE_GAP_MS
      const age = e - start
      if (age >= 0 && age < MUZZLE_MS && !(ship === 1 && input.leadDestroyedAtMs !== null && start >= input.leadDestroyedAtMs)) {
        pose.muzzle = Math.max(pose.muzzle, 1 - age / MUZZLE_MS)
      }
    }
    if (!pose.visible) {
      pose.thrust = 0
      pose.charge = 0
      pose.muzzle = 0
    }
    transformEmitter(pose, 1, pose.emitters[0])
    transformEmitter(pose, -1, pose.emitters[1])
    if (pose.thrust > .02 || pose.charge > .02) out.effectsActive = true
  }

  for (let index = 0; index < out.pulses.length; index++) {
    const pulse = out.pulses[index]
    if (!pulse) continue
    const ship = Math.floor(index / 2)
    const pulseIndex = index % 2 === 0 ? 0 : 1
    const pose = out.ships[ship]
    if (!pose) continue
    const start = run + FIRE_OFFSET_MS + FIRE_STAGGER_MS * ship + pulseIndex * PULSE_GAP_MS
    const age = e - start
    pulse.ship = ship
    pulse.index = pulseIndex
    pulse.ageMs = age
    pulse.fired = age >= 0 && !(ship === 1 && input.leadDestroyedAtMs !== null && start >= input.leadDestroyedAtMs)
    pulse.boltVisible = pulse.fired && age < PULSE_MS && e < gone
    pulse.intensity = pulse.boltVisible ? 1 - (age / PULSE_MS) ** 2 : 0
    pulse.impactFlash = pulse.fired && age < IMPACT_FLASH_MS && e < gone ? .0030 * Math.sin(Math.PI * age / IMPACT_FLASH_MS) : 0
    const offS = ship === 0 ? (pulseIndex === 0 ? -.0022 : -.0010)
      : ship === 1 ? (pulseIndex === 0 ? .0004 : .0014) : (pulseIndex === 0 ? .0022 : .0010)
    const offH = ship === 0 ? (pulseIndex === 0 ? .0010 : -.0004)
      : ship === 1 ? (pulseIndex === 0 ? .0014 : .0002) : (pulseIndex === 0 ? .0008 : -.0006)
    pulse.impact[0] = input.aim[0] - hz * offS + hx * .0015
    pulse.impact[1] = input.aim[1] + offH
    pulse.impact[2] = input.aim[2] + hx * offS + hz * .0015
    copyVec(pose.emitters[0], pulse.from[0])
    copyVec(pose.emitters[1], pulse.from[1])
    pulse.to[0][0] = pulse.impact[0] - hz * .0005
    pulse.to[0][1] = pulse.impact[1]
    pulse.to[0][2] = pulse.impact[2] + hx * .0005
    pulse.to[1][0] = pulse.impact[0] + hz * .0005
    pulse.to[1][1] = pulse.impact[1]
    pulse.to[1][2] = pulse.impact[2] - hx * .0005
    if (pulse.fired && age < SPARK_MS && e < gone) out.effectsActive = true
  }

  out.hasKillPoint = input.leadDestroyedAtMs !== null && e >= input.leadDestroyedAtMs
  if (out.hasKillPoint && input.leadDestroyedAtMs !== null) {
    samplePosition(input, 1, input.leadDestroyedAtMs, run, run + FIRE_OFFSET_MS + FIRE_STAGGER_MS + BREAK_AFTER_FIRE_MS,
      gone, hx, hz, origin[1], out.killPoint)
  } else {
    out.killPoint[0] = 0
    out.killPoint[1] = 0
    out.killPoint[2] = 0
  }
  if (e >= gone) out.effectsActive = false
  return out
}

export function impactSpark(wave: number, impact: Readonly<Vec3>, i: number, ageMs: number, out: Vec3): number {
  copyVec(impact, out)
  if (ageMs < 0 || ageMs >= SPARK_MS) return 0
  const origin = (OCTOGONALS.waves[wave] ?? OCTOGONALS.waves[0]).origin
  const length = Math.hypot(origin[0], origin[2])
  const hx = origin[0] / length, hz = origin[2] / length
  const side = (i - 2) * .38
  const dx = hx * .55 - hz * side, dy = .55 + .2 * (i % 2), dz = hz * .55 + hx * side
  const norm = Math.hypot(dx, dy, dz)
  const t = ageMs / SPARK_MS
  const distance = (.0020 + .0075 * t) / norm
  out[0] += dx * distance
  out[1] += dy * distance - .004 * t * t
  out[2] += dz * distance
  return .001 * (1 - t)
}
