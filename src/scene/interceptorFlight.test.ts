import { afterAll, describe, expect, it } from 'vitest'
import { Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import { OCTOGONALS } from '../content/octogonals.ts'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { MONUMENT_KINDS } from '../domain/territoryMonument.ts'
import { DEFENSE_FIRE_END_MS, DEFENSE_WINDOW_MS } from '../domain/waveDefense.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { authorMonument } from './octagonalModels.ts'
import { sampleMonumentCamera } from './monumentPresentation.ts'
import { INTERCEPTOR_ENVELOPE, INTERCEPTOR_SCALE, VANE_DEPLOYED, VANE_TUCKED, interceptorEmitterLocal } from './interceptorModel.ts'
import type { Vec3 } from './interceptorModel.ts'
import { createWaveAttackFrame, impactSpark, sampleWaveAttack, waveAttackSchedule } from './interceptorFlight.ts'
import type { InterceptorBeat, InterceptorPose, WaveAttackInput } from './interceptorFlight.ts'

const DEG = Math.PI / 180
const SHIPS = [0, 1, 2] as const
const WAVES = [0, 1, 2] as const
const STRIKES = [3600, 6000, 7000, 8000]
const AIM: Vec3 = [0, .03, 0]
// Production aims: a construction top anywhere in the clamped .004–.07 band, the Crater Crown turret gun at both
// anchors (off-axis), and the Orbital Platform's turret gun.
const FRAMING_AIMS: readonly Vec3[] = [AIM, [0, .004, 0], [0, .07, 0], [0, .037, .043], [0, .025, .0215], [0, .057, 0]]

function inputAt(elapsedMs: number, strikeAtMs = 6000, wave = 0, leadDestroyedAtMs: number | null = null, aim: Readonly<Vec3> = AIM): WaveAttackInput {
  return { wave, elapsedMs, strikeAtMs, leadDestroyedAtMs, aim }
}

function distance(a: Readonly<Vec3>, b: Readonly<Vec3>) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function forward(pose: InterceptorPose) {
  return new Vector3(Math.sin(pose.yaw) * Math.cos(pose.pitch), -Math.sin(pose.pitch), Math.cos(pose.yaw) * Math.cos(pose.pitch))
}

function velocity(input: WaveAttackInput, ship: 0 | 1 | 2) {
  const before = sampleWaveAttack({ ...input, elapsedMs: input.elapsedMs - .25 }).ships[ship].position
  const after = sampleWaveAttack({ ...input, elapsedMs: input.elapsedMs + .25 }).ships[ship].position
  return new Vector3(after[0] - before[0], after[1] - before[1], after[2] - before[2]).normalize()
}

function expectedBeat(elapsedMs: number, strikeAtMs: number, ship: number): InterceptorBeat {
  const run = strikeAtMs - 1000
  if (elapsedMs >= strikeAtMs - 40) return 'gone'
  if (elapsedMs >= run + 470 + 130 * ship) return 'break'
  if (elapsedMs >= run + 180) return 'dive'
  if (elapsedMs >= run) return 'lock'
  if (elapsedMs >= 2600) return 'hold'
  if (elapsedMs >= 500) return 'stalk'
  return elapsedMs > 0 ? 'ingress' : 'parked'
}

function references(value: unknown): object[] {
  if (value === null || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(references)]
}

function finiteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (value === null || typeof value !== 'object') return true
  return Object.values(value).every(finiteNumbers)
}

describe('interceptor flight', () => {
  const report: Record<string, unknown> = {}
  afterAll(() => {
    console.info('Interceptor flight metrics', JSON.stringify(report, null, 2))
  })

  it('is stateless in random sample order and preserves every nested output reference', () => {
    const reused = createWaveAttackFrame()
    const originalReferences = references(reused)
    expect(reused.ships).toHaveLength(3)
    expect(reused.pulses).toHaveLength(6)
    const samples = STRIKES.flatMap(strike => WAVES.flatMap(wave => [null, 1200, strike - 450].flatMap(destroyed =>
      [-100, 0, 200, 500, 700, 1200, 1400, 2600, strike - 1000, strike - 820, strike - 700,
        strike - 570, strike - 470, strike - 300, strike - 130, strike - 40, strike, strike + 100]
        .map(time => inputAt(time, strike, wave, destroyed)))))
    samples.sort(() => Math.random() - .5)
    for (const input of samples) {
      const result = sampleWaveAttack(input, reused)
      expect(result).toBe(reused)
      expect(result).toEqual(sampleWaveAttack(input))
      const currentReferences = references(result)
      expect(currentReferences).toHaveLength(originalReferences.length)
      for (let i = 0; i < originalReferences.length; i++) expect(currentReferences[i]).toBe(originalReferences[i])
    }
  })

  it('uses the fixed beat boundaries and clamps the strike to the unchanged defense window', () => {
    expect(waveAttackSchedule(0, false)).toEqual(waveAttackSchedule(DEFENSE_WINDOW_MS, false))
    expect(waveAttackSchedule(3600, false).runAtMs).toBe(DEFENSE_FIRE_END_MS)
    for (const strike of STRIKES) {
      const run = strike - 1000
      const schedule = waveAttackSchedule(strike, false)
      expect(schedule).toEqual({
        runAtMs: run,
        lockEndMs: run + 180,
        fireAtMs: [run + 300, run + 430, run + 560],
        breakAtMs: [run + 470, run + 600, run + 730],
        shrinkAtMs: strike - 130,
        goneAtMs: strike - 40,
      })
      const destroyedSchedule = waveAttackSchedule(strike, true)
      expect(destroyedSchedule.fireAtMs).toEqual([run + 300, null, run + 560])
      expect(destroyedSchedule.breakAtMs).toEqual([run + 470, null, run + 730])
      expect(run + 660).toBeLessThanOrEqual(strike - 300)
      const boundaries = [0, 500, 2600, run, run + 180, run + 470, run + 600, run + 730, strike - 40]
      for (const boundary of boundaries) for (const offset of [-.001, 0, .001]) {
        const elapsed = boundary + offset
        const frame = sampleWaveAttack(inputAt(elapsed, strike))
        for (const ship of SHIPS) expect(frame.ships[ship].beat, `S=${strike}, E=${elapsed}, ship=${ship}`).toBe(expectedBeat(elapsed, strike, ship))
      }
      for (let elapsed = 0; elapsed < run; elapsed += 17) {
        const frame = sampleWaveAttack(inputAt(elapsed, strike))
        expect(frame.pulses.every(pulse => !pulse.fired && !pulse.boltVisible)).toBe(true)
        if (strike === 3600) expect(frame.ships.every(ship => ship.beat !== 'hold')).toBe(true)
      }
      expect(sampleWaveAttack(inputAt(2800, 0))).toEqual(sampleWaveAttack(inputAt(2800, 3600)))
    }
  })

  it('fires exactly two pulses per survivor with aligned paired emitters and bounded impacts', () => {
    let maximumBolts = 0
    let minimumAimAlignment = 1
    for (const wave of WAVES) for (const strike of STRIKES) for (const destroyed of [null, 1200]) {
      const run = strike - 1000
      const seen = new Set<number>()
      const frame = createWaveAttackFrame()
      for (let elapsed = run; elapsed < strike - 40; elapsed += 5) {
        sampleWaveAttack(inputAt(elapsed, strike, wave, destroyed), frame)
        expect(frame.pulses).toHaveLength(6)
        const visibleBolts = frame.pulses.filter(pulse => pulse.boltVisible).length * 2
        maximumBolts = Math.max(maximumBolts, visibleBolts)
        for (const [recordIndex, pulse] of frame.pulses.entries()) {
          const ship = frame.ships[pulse.ship as 0 | 1 | 2]
          expect(pulse.ship).toBe(Math.floor(recordIndex / 2))
          expect(pulse.index).toBe(recordIndex % 2)
          for (const side of [0, 1] as const) {
            expect(distance(pulse.from[side], ship.emitters[side])).toBeLessThanOrEqual(1e-9)
            expect(distance(pulse.to[side], AIM)).toBeLessThan(.004)
          }
          const start = run + 300 + 130 * pulse.ship + 100 * pulse.index
          const age = elapsed - start
          const blocked = pulse.ship === 1 && destroyed !== null
          expect(pulse.fired).toBe(!blocked && age >= 0)
          expect(pulse.boltVisible).toBe(!blocked && age >= 0 && age < 70)
          expect(pulse.intensity).toBeCloseTo(!blocked && age >= 0 && age < 70 ? 1 - (age / 70) ** 2 : 0, 12)
          expect(pulse.impactFlash).toBeCloseTo(!blocked && age >= 0 && age < 140 ? .003 * Math.sin(Math.PI * age / 140) : 0, 12)
          if (pulse.fired) {
            expect(pulse.ageMs).toBe(age)
            seen.add(recordIndex)
          }
          if (pulse.boltVisible) {
            const emitter = new Vector3().fromArray(pulse.from[0]).add(new Vector3().fromArray(pulse.from[1])).multiplyScalar(.5)
            const target = new Vector3().fromArray(pulse.to[0]).add(new Vector3().fromArray(pulse.to[1])).multiplyScalar(.5)
            minimumAimAlignment = Math.min(minimumAimAlignment, forward(ship).dot(target.sub(emitter).normalize()))
          }
        }
      }
      expect([...seen].filter(index => Math.floor(index / 2) === 0)).toHaveLength(2)
      expect([...seen].filter(index => Math.floor(index / 2) === 1)).toHaveLength(destroyed === null ? 2 : 0)
      expect([...seen].filter(index => Math.floor(index / 2) === 2)).toHaveLength(2)
    }
    report.pulses = { maximumBolts, maximumAimAngleDegrees: Math.acos(minimumAimAlignment) / DEG }
    expect(maximumBolts).toBeLessThanOrEqual(4)
    expect(maximumBolts).toBe(4)
    expect(minimumAimAlignment).toBeGreaterThanOrEqual(Math.cos(50 * DEG))
  })

  it('deploys vanes without excessive overshoot and folds them over exactly 180 ms', () => {
    let minimumYaw = Infinity
    for (const strike of STRIKES) {
      const run = strike - 1000
      for (let elapsed = 0; elapsed < run; elapsed += 37) {
        for (const ship of sampleWaveAttack(inputAt(elapsed, strike)).ships) {
          expect(Math.abs(ship.vaneYaw - VANE_TUCKED.yaw)).toBeLessThanOrEqual(.5 * DEG)
          expect(ship.vanePitch).toBe(VANE_TUCKED.pitch)
        }
      }
      for (let elapsed = run; elapsed <= run + 180; elapsed++) {
        for (const ship of sampleWaveAttack(inputAt(elapsed, strike)).ships) {
          minimumYaw = Math.min(minimumYaw, ship.vaneYaw)
          expect(ship.vanePitch).toBeGreaterThanOrEqual(0)
          expect(ship.vanePitch).toBeLessThanOrEqual(8 * DEG)
        }
      }
      for (const shipIndex of SHIPS) {
        const breakAt = run + 470 + shipIndex * 130
        for (let elapsed = run + 180; elapsed < breakAt; elapsed += 7) {
          const ship = sampleWaveAttack(inputAt(elapsed, strike)).ships[shipIndex]
          expect(Math.abs(ship.vaneYaw - VANE_DEPLOYED.yaw)).toBeLessThanOrEqual(.5 * DEG)
          expect(ship.vanePitch).toBeCloseTo(VANE_DEPLOYED.pitch, 12)
        }
        const folded = sampleWaveAttack(inputAt(breakAt + 180, strike)).ships[shipIndex]
        expect(Math.abs(folded.vaneYaw - VANE_TUCKED.yaw)).toBeLessThanOrEqual(.5 * DEG)
        expect(folded.vanePitch).toBeCloseTo(0, 12)
      }
    }
    expect(minimumYaw).toBeGreaterThanOrEqual(22 * DEG)
  })

  it('transforms local emitters with an independent Three.js YXZ pose matrix', () => {
    const object = new Object3D()
    const local: Vec3 = [0, 0, 0]
    const expected = new Vector3()
    for (const wave of WAVES) for (const strike of STRIKES) {
      const run = strike - 1000
      for (const elapsed of [0, 250, 700, 1425, 2700, run, run + 90, run + 300, run + 600, run + 780, strike - 85]) {
        const frame = sampleWaveAttack(inputAt(elapsed, strike, wave, 1200))
        for (const ship of frame.ships) {
          object.position.fromArray(ship.position)
          object.rotation.set(ship.pitch, ship.yaw, ship.roll, 'YXZ')
          object.scale.setScalar(ship.scale)
          object.updateMatrix()
          for (const side of [1, -1] as const) {
            interceptorEmitterLocal(side, ship.vaneYaw, ship.vanePitch, local)
            expected.fromArray(local).applyMatrix4(object.matrix)
            const actual = side === 1 ? ship.emitters[0] : ship.emitters[1]
            expect(expected.distanceTo(new Vector3().fromArray(actual))).toBeLessThanOrEqual(1e-12)
          }
        }
      }
    }
  })

  it('uses the fixed ingress thrust, charge, muzzle and break-thrust windows', () => {
    for (const elapsed of [0, 100, 200, 300, 400, 401]) {
      const expected = .7 * (1 - Math.min(1, elapsed / 400)) ** 2
      for (const ship of sampleWaveAttack(inputAt(elapsed)).ships) expect(ship.thrust).toBeCloseTo(expected, 12)
    }
    for (const strike of STRIKES) for (const index of SHIPS) {
      const fireAt = strike - 700 + index * 130
      for (const [offset, charge] of [[-150, 0], [-75, .25], [0, 1], [170, 1], [250, 0]] as const) {
        expect(sampleWaveAttack(inputAt(fireAt + offset, strike)).ships[index].charge).toBeCloseTo(charge, 12)
      }
      for (const pulseOffset of [0, 100]) for (const [age, muzzle] of [[0, 1], [20, .5], [40, 0]] as const) {
        expect(sampleWaveAttack(inputAt(fireAt + pulseOffset + age, strike)).ships[index].muzzle).toBeCloseTo(muzzle, 12)
      }
      const breakAt = fireAt + 170
      expect(sampleWaveAttack(inputAt(breakAt, strike)).ships[index].thrust).toBe(0)
      expect(sampleWaveAttack(inputAt(breakAt + 60, strike)).ships[index].thrust).toBe(1)
      if (breakAt + 260 < strike - 40) expect(sampleWaveAttack(inputAt(breakAt + 260, strike)).ships[index].thrust).toBeCloseTo(.45, 12)
    }
  })

  it('faces velocity on ingress and exit and tracks the aim through stalk and dive', () => {
    const minima = { ingress: 1, stalk: 1, dive: 1, exit: 1 }
    const worst = { ingress: '', stalk: '', dive: '', exit: '' }
    const exitByShip: [number, number, number] = [1, 1, 1]
    const record = (phase: keyof typeof minima, value: number, label: string) => {
      if (value < minima[phase]) {
        minima[phase] = value
        worst[phase] = label
      }
    }
    for (const strike of STRIKES) for (const wave of WAVES) for (const shipIndex of SHIPS) {
      const run = strike - 1000
      const breakAt = run + 470 + shipIndex * 130
      const label = (elapsed: number) => `S=${strike}, wave=${wave}, ship=${shipIndex}, E=${elapsed}`
      for (let elapsed = 50; elapsed <= 350; elapsed += 25) {
        const input = inputAt(elapsed, strike, wave)
        record('ingress', forward(sampleWaveAttack(input).ships[shipIndex]).dot(velocity(input, shipIndex)), label(elapsed))
      }
      for (let elapsed = 700; elapsed < run; elapsed += 37) {
        const ship = sampleWaveAttack(inputAt(elapsed, strike, wave)).ships[shipIndex]
        const target = new Vector3(AIM[0] - ship.position[0], 0, AIM[2] - ship.position[2]).normalize()
        record('stalk', new Vector3(Math.sin(ship.yaw), 0, Math.cos(ship.yaw)).dot(target), label(elapsed))
        expect(ship.pitch).toBeLessThanOrEqual(18 * DEG + 1e-12)
      }
      for (let elapsed = run + 180; elapsed < breakAt; elapsed += 11) {
        const ship = sampleWaveAttack(inputAt(elapsed, strike, wave)).ships[shipIndex]
        const target = new Vector3().fromArray(AIM).sub(new Vector3().fromArray(ship.position)).normalize()
        record('dive', forward(ship).dot(target), label(elapsed))
        expect(ship.pitch).toBeLessThanOrEqual(40 * DEG + 1e-12)
      }
      for (let elapsed = breakAt + 80; elapsed < strike - 40; elapsed += 11) {
        const input = inputAt(elapsed, strike, wave)
        const alignment = forward(sampleWaveAttack(input).ships[shipIndex]).dot(velocity(input, shipIndex))
        record('exit', alignment, label(elapsed))
        exitByShip[shipIndex] = Math.min(exitByShip[shipIndex], alignment)
      }
    }
    report.heading = { minima, worst, exitByShip }
    expect(minima.ingress).toBeGreaterThanOrEqual(.85)
    expect(minima.stalk).toBeGreaterThanOrEqual(.94)
    expect(minima.dive).toBeGreaterThanOrEqual(.90)
    expect(minima.exit).toBeGreaterThanOrEqual(.85)
  })

  it('banks into each break so the emitter on the turn side is lower', () => {
    for (const wave of WAVES) for (const strike of STRIKES) for (const shipIndex of SHIPS) {
      const breakAt = strike - 530 + shipIndex * 130
      for (let elapsed = breakAt + 20; elapsed < strike - 40; elapsed += 10) {
        const ship = sampleWaveAttack(inputAt(elapsed, strike, wave)).ships[shipIndex]
        const turnSide = shipIndex === 0 ? 1 : 0
        const oppositeSide = turnSide === 0 ? 1 : 0
        expect(ship.emitters[turnSide][1], `wave=${wave}, ship=${shipIndex}, E=${elapsed}`).toBeLessThan(ship.emitters[oppositeSide][1])
        if (elapsed >= breakAt + 120) expect(Math.abs(ship.roll)).toBeCloseTo((shipIndex === 1 ? 55 : 78) * DEG, 12)
      }
    }
  })

  it('keeps visible positions and Euler angles continuous at 16 ms intervals', () => {
    // The original .0035 / .35 rad frame limits still hold everywhere except the two deliberate breakaway motions,
    // which the prescribed timing makes faster: the Hermite exit (up to .0087 per frame) and the 78° / 120 ms bank.
    // Those get physical limits instead: the exit may not move a ship more than half its own hull length per frame
    // (successive silhouettes still overlap, so it reads as motion rather than a jump), and the bank may not step further
    // than the prescribed easeOutCubic roll-in allows in its steepest 16 ms.
    const hullLength = INTERCEPTOR_ENVELOPE.max[2] - INTERCEPTOR_ENVELOPE.min[2]
    const bankStep = (bank: number) => bank * DEG * (1 - (1 - 16 / 120) ** 3)
    const maxima = { cruise: 0, breakaway: 0, heading: 0, roll: 0, rollIn: 0 }
    const cases = { cruise: '', breakaway: '', heading: '', roll: '', rollIn: '' }
    const record = (key: keyof typeof maxima, value: number, label: string) => {
      if (value > maxima[key]) {
        maxima[key] = value
        cases[key] = label
      }
    }
    for (const strike of STRIKES) for (const wave of WAVES) for (const destroyed of [null, 1200]) {
      const { breakAtMs } = waveAttackSchedule(strike, false)
      let previous = sampleWaveAttack(inputAt(0, strike, wave, destroyed))
      for (let elapsed = 16; elapsed <= strike; elapsed += 16) {
        const current = sampleWaveAttack(inputAt(elapsed, strike, wave, destroyed))
        for (const index of SHIPS) {
          const ship = current.ships[index]
          const prior = previous.ships[index]
          if (!ship.visible || !prior.visible) continue
          const label = `S=${strike}, wave=${wave}, destroyed=${destroyed}, ship=${index}, E=${elapsed}`
          const positionStep = distance(ship.position, prior.position)
          const breakAt = breakAtMs[index]!
          if (ship.beat === 'break' || prior.beat === 'break') {
            record('breakaway', positionStep / ((index === 1 ? INTERCEPTOR_SCALE.lead : INTERCEPTOR_SCALE.escort) * hullLength), label)
          } else record('cruise', positionStep, label)
          record('heading', Math.max(Math.abs(angleDelta(ship.yaw, prior.yaw)), Math.abs(angleDelta(ship.pitch, prior.pitch))), label)
          const rollStep = Math.abs(angleDelta(ship.roll, prior.roll))
          if (elapsed > breakAt && elapsed - 16 < breakAt + 120) record('rollIn', rollStep / bankStep(index === 1 ? 55 : 78), label)
          else record('roll', rollStep, label)
        }
        previous = current
      }
    }
    report.continuity = { maxima, cases }
    expect(maxima.cruise, cases.cruise).toBeLessThanOrEqual(.0035)
    expect(maxima.breakaway, cases.breakaway).toBeLessThanOrEqual(.5)
    expect(maxima.heading, cases.heading).toBeLessThanOrEqual(.35)
    expect(maxima.roll, cases.roll).toBeLessThanOrEqual(.35)
    expect(maxima.rollIn, cases.rollIn).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('has no position or orientation jump across any beat boundary', () => {
    let maximumPosition = 0
    let maximumAngle = 0
    let worst = ''
    for (const strike of STRIKES) for (const wave of WAVES) for (const destroyed of [null, 1200]) {
      const schedule = waveAttackSchedule(strike, false)
      const boundaries = [350, 500, 650, 900, 1100, 1200, 1650, 2600, schedule.runAtMs, schedule.lockEndMs,
        ...schedule.fireAtMs, ...schedule.breakAtMs, schedule.shrinkAtMs].filter((time): time is number => time !== null)
      for (const boundary of boundaries) {
        const before = sampleWaveAttack(inputAt(boundary - .0005, strike, wave, destroyed))
        const after = sampleWaveAttack(inputAt(boundary + .0005, strike, wave, destroyed))
        for (const index of SHIPS) {
          if (!before.ships[index].visible || !after.ships[index].visible) continue
          const a = before.ships[index], b = after.ships[index]
          const position = distance(a.position, b.position)
          const angle = Math.max(...(['yaw', 'pitch', 'roll', 'vaneYaw', 'vanePitch'] as const).map(axis => Math.abs(angleDelta(a[axis], b[axis]))))
          if (position > maximumPosition || angle > maximumAngle) worst = `S=${strike}, wave=${wave}, destroyed=${destroyed}, ship=${index}, E=${boundary}`
          maximumPosition = Math.max(maximumPosition, position)
          maximumAngle = Math.max(maximumAngle, angle)
        }
      }
    }
    report.boundaries = { maximumPosition, maximumAngle, worst }
    // A 1 µs window around every schedule edge: continuous motion moves < 1e-6 and turns < 1e-4 rad in it; a jump cannot.
    expect(maximumPosition, worst).toBeLessThanOrEqual(1e-5)
    expect(maximumAngle, worst).toBeLessThanOrEqual(1e-4)
  })

  it('travels at least .02 before shrinking and clears all ships and effects at the deadline', () => {
    for (const strike of STRIKES) for (const wave of WAVES) for (const destroyed of [null, 1200]) {
      for (const index of SHIPS) {
        if (index === 1 && destroyed !== null) continue
        const breakAt = strike - 530 + 130 * index
        const start = sampleWaveAttack(inputAt(breakAt, strike, wave, destroyed)).ships[index]
        const shrink = sampleWaveAttack(inputAt(strike - 130, strike, wave, destroyed)).ships[index]
        expect(distance(start.position, shrink.position)).toBeGreaterThanOrEqual(.02)
        const baseScale = index === 1 ? INTERCEPTOR_SCALE.lead : INTERCEPTOR_SCALE.escort
        expect(shrink.scale).toBe(baseScale)
        expect(sampleWaveAttack(inputAt(strike - 85, strike, wave, destroyed)).ships[index].scale).toBeCloseTo(baseScale / 2, 12)
      }
      for (const elapsed of [strike - 40, strike - 39, strike, strike + 2000]) {
        const frame = sampleWaveAttack(inputAt(elapsed, strike, wave, destroyed))
        expect(frame.effectsActive).toBe(false)
        for (const ship of frame.ships) {
          expect(ship.visible).toBe(false)
          expect(ship.scale).toBe(0)
          expect(ship.thrust).toBe(0)
          expect(ship.charge).toBe(0)
          expect(ship.muzzle).toBe(0)
        }
        expect(frame.pulses.every(pulse => !pulse.boltVisible && pulse.intensity === 0 && pulse.impactFlash === 0)).toBe(true)
      }
    }
  })

  it('samples the exact lead kill point and makes escorts jink and bank away for 450 ms', () => {
    for (const wave of WAVES) {
      const strike = OCTOGONALS.waves[wave].durationMs
      const expectedKill = sampleWaveAttack(inputAt(1200, strike, wave)).ships[1].position
      const origin = OCTOGONALS.waves[wave].origin
      const length = Math.hypot(origin[0], origin[2])
      const side = new Vector3(-origin[2] / length, 0, origin[0] / length)
      expect(sampleWaveAttack(inputAt(1199, strike, wave, 1200)).hasKillPoint).toBe(false)
      for (const elapsed of [1200, 1225, 1300, 1425, 1649, 1650, strike - 100]) {
        const frame = sampleWaveAttack(inputAt(elapsed, strike, wave, 1200))
        expect(frame.hasKillPoint).toBe(true)
        expect(distance(frame.killPoint, expectedKill)).toBeLessThanOrEqual(1e-12)
        expect(frame.ships[1].beat).toBe('destroyed')
        expect(frame.ships[1].visible).toBe(false)
        expect(frame.ships[1].scale).toBe(0)
        expect(frame.ships[1].charge).toBe(0)
        expect(frame.ships[1].muzzle).toBe(0)
        expect(frame.pulses.filter(pulse => pulse.ship === 1).every(pulse => !pulse.fired && !pulse.boltVisible && pulse.intensity === 0 && pulse.impactFlash === 0)).toBe(true)
        const baseline = sampleWaveAttack(inputAt(elapsed, strike, wave))
        for (const index of [0, 2] as const) {
          const sign = index === 0 ? -1 : 1
          const ship = frame.ships[index]
          const normal = baseline.ships[index]
          const displacement = new Vector3().fromArray(ship.position).sub(new Vector3().fromArray(normal.position))
          const active = elapsed > 1200 && elapsed < 1650
          const envelope = active ? Math.sin(Math.PI * (elapsed - 1200) / 450) : 0
          expect(displacement.dot(side)).toBeCloseTo(sign * .005 * envelope, 12)
          expect(angleDelta(ship.roll, normal.roll)).toBeCloseTo(-sign * .52 * envelope, 12)
          const boost = active ? .5 * Math.sin(Math.PI * Math.min(1, (elapsed - 1200) / 200)) : 0
          expect(ship.thrust - normal.thrust).toBeCloseTo(boost, 12)
        }
      }
    }
  })

  it('suppresses only lead pulses scheduled at or after destruction and preserves earlier legal pulses', () => {
    const strike = 6000
    const first = strike - 570
    const second = first + 100
    for (const destroyed of [first - 1, first, first + 50, second, second + 1]) {
      for (const elapsed of [first - 10, first, first + 25, first + 75, second, second + 25]) {
        const frame = sampleWaveAttack(inputAt(elapsed, strike, 0, destroyed))
        for (const pulse of frame.pulses.filter(candidate => candidate.ship === 1)) {
          const start = first + pulse.index * 100
          const legal = start < destroyed
          expect(pulse.fired).toBe(legal && elapsed >= start)
          if (!legal) {
            expect(pulse.boltVisible).toBe(false)
            expect(pulse.intensity).toBe(0)
            expect(pulse.impactFlash).toBe(0)
          }
        }
        if (elapsed >= destroyed) {
          expect(frame.ships[1].charge).toBe(0)
          expect(frame.ships[1].muzzle).toBe(0)
        }
      }
    }
  })

  it('keeps the full swept envelope above every roof and within both portrait frames', () => {
    const kit = createOctagonalKit()
    let roof = 0
    try {
      for (const kind of MONUMENT_KINDS) {
        const batches = batchOctagonalModel(kit, add => authorMonument(kind, add))
        try {
          for (const batch of batches) {
            const positions = batch.geometry.getAttribute('position')
            for (let i = 0; i < positions.count; i++) roof = Math.max(roof, positions.getY(i) * .001 + .0007)
          }
        } finally {
          for (const batch of batches) batch.geometry.dispose()
        }
      }
    } finally {
      disposeOctagonalKit(kit)
    }
    const corners: Vector3[] = []
    for (const x of [INTERCEPTOR_ENVELOPE.min[0], INTERCEPTOR_ENVELOPE.max[0]]) {
      for (const y of [INTERCEPTOR_ENVELOPE.min[1], INTERCEPTOR_ENVELOPE.max[1]]) {
        for (const z of [INTERCEPTOR_ENVELOPE.min[2], INTERCEPTOR_ENVELOPE.max[2]]) corners.push(new Vector3(x, y, z))
      }
    }
    const margins = { roof: Infinity, side: Infinity, bottom: Infinity, top: Infinity, depth: Infinity }
    const worst = { roof: '', side: '', bottom: '', top: '', depth: '' }
    const record = (key: keyof typeof margins, value: number, label: string) => {
      if (value < margins[key]) {
        margins[key] = value
        worst[key] = label
      }
    }
    const object = new Object3D()
    const localCorner = new Vector3()
    const ndc = new Vector3()
    const frame = createWaveAttackFrame()
    let combinations = 0
    let sampledCorners = 0
    for (const latitude of [-1.5, .248, 1.5]) for (const aspect of [390 / 844, 320 / 568]) {
      const site = createLandingSite(createLunarLocation(latitude, -.684, 18))
      const transform = landingSiteToRenderTransform(site)
      const world = new Matrix4().compose(transform.position, transform.orientation, new Vector3(1, 1, 1))
      const camera = new PerspectiveCamera(42, aspect, .001, 80)
      const cameraPose = sampleMonumentCamera(site, 0, aspect)
      camera.position.copy(cameraPose.position)
      camera.up.copy(cameraPose.up)
      camera.lookAt(cameraPose.target)
      camera.updateMatrixWorld()
      for (const wave of WAVES) for (const destroyed of [null, 1200]) for (const aim of FRAMING_AIMS) {
        combinations++
        const strike = OCTOGONALS.waves[wave].durationMs
        for (let elapsed = 0; elapsed <= strike; elapsed += 50) {
          sampleWaveAttack(inputAt(elapsed, strike, wave, destroyed, aim), frame)
          for (const index of SHIPS) {
            const ship = frame.ships[index]
            if (!ship.visible) continue
            object.position.fromArray(ship.position)
            object.rotation.set(ship.pitch, ship.yaw, ship.roll, 'YXZ')
            object.scale.setScalar(ship.scale)
            object.updateMatrix()
            const label = `latitude=${latitude}, aspect=${aspect}, wave=${wave}, destroyed=${destroyed}, aim=${aim}, ship=${index}, E=${elapsed}, beat=${ship.beat}`
            for (const corner of corners) {
              sampledCorners++
              localCorner.copy(corner).applyMatrix4(object.matrix)
              record('roof', localCorner.y - roof, label)
              ndc.copy(localCorner).applyMatrix4(world).project(camera)
              record('bottom', ndc.y - .1, label)
              record('depth', 1 - Math.abs(ndc.z), label)
              if (ship.beat !== 'break') {
                record('side', .98 - Math.abs(ndc.x), label)
                record('top', .96 - ndc.y, label)
              }
            }
          }
        }
      }
    }
    report.framing = { combinations, sampledCorners, roof, margins, worst }
    expect(combinations).toBe(36 * FRAMING_AIMS.length)
    expect(sampledCorners).toBeGreaterThan(80_000 * FRAMING_AIMS.length)
    for (const key of Object.keys(margins) as (keyof typeof margins)[]) expect.soft(margins[key], `${key}: ${worst[key]}`).toBeGreaterThan(0)
  })

  it('swings the hold about the monument axis, so an off-axis aim cannot move the formation', () => {
    for (const wave of WAVES) for (const strike of STRIKES) for (let elapsed = 0; elapsed <= strike; elapsed += 25) {
      const centred = sampleWaveAttack(inputAt(elapsed, strike, wave))
      const offset = sampleWaveAttack(inputAt(elapsed, strike, wave, null, [.012, .028, .043]))
      for (const index of SHIPS) expect(offset.ships[index].position).toEqual(centred.ships[index].position)
    }
  })

  it('has finite vectors, orientations and effects throughout a dense numeric sweep', () => {
    const frame = createWaveAttackFrame()
    let allFinite = true
    let minimumAltitude = Infinity
    let effectsMatch = true
    let firstFailure = ''
    for (const wave of WAVES) for (const strike of STRIKES) for (const destroyed of [null, 1200]) {
      for (let aimStep = 0; aimStep <= 11; aimStep++) {
        const aim: Vec3 = [.002, .004 + .066 * aimStep / 11, -.003]
        for (let elapsed = -32; elapsed <= strike + 64; elapsed += 8) {
          sampleWaveAttack(inputAt(elapsed, strike, wave, destroyed, aim), frame)
          if (!finiteNumbers(frame)) {
            allFinite = false
            if (!firstFailure) firstFailure = `wave=${wave}, S=${strike}, aim.y=${aim[1]}, E=${elapsed}`
          }
          for (const ship of frame.ships) minimumAltitude = Math.min(minimumAltitude, ship.position[1])
          if (elapsed < strike - 40) {
            const active = frame.ships.some(ship => ship.thrust > .02 || ship.charge > .02)
              || frame.pulses.some(pulse => pulse.fired && pulse.ageMs >= 0 && pulse.ageMs < 220)
            effectsMatch &&= frame.effectsActive === active
          } else effectsMatch &&= !frame.effectsActive
        }
      }
    }
    expect(allFinite, firstFailure).toBe(true)
    expect(minimumAltitude).toBeGreaterThanOrEqual(.096 - 1e-12)
    expect(effectsMatch).toBe(true)
  })

  it('emits deterministic bounded sparks and ends them at 220 ms', () => {
    let maximumDistance = 0
    const out: Vec3 = [0, 0, 0]
    for (const wave of WAVES) for (const impact of [AIM, [.004, .07, -.003] as Vec3]) for (let i = 0; i < 5; i++) {
      const origin = OCTOGONALS.waves[wave].origin
      const length = Math.hypot(origin[0], origin[2])
      const h = new Vector3(origin[0] / length, 0, origin[2] / length)
      const side = new Vector3(-origin[2] / length, 0, origin[0] / length)
      const direction = h.multiplyScalar(.55).add(new Vector3(0, .55 + .2 * (i % 2), 0)).addScaledVector(side, (i - 2) * .38).normalize()
      for (let age = 0; age < 220; age++) {
        const fresh: Vec3 = [0, 0, 0]
        const size = impactSpark(wave, impact, i, age, out)
        expect(size).toBe(impactSpark(wave, impact, i, age, fresh))
        expect(out).toEqual(fresh)
        const t = age / 220
        const expected = new Vector3().fromArray(impact).addScaledVector(direction, .002 + .0075 * t)
        expected.y -= .004 * t * t
        expect(new Vector3().fromArray(out).distanceTo(expected)).toBeLessThanOrEqual(1e-12)
        expect(size).toBeCloseTo(.001 * (1 - t), 12)
        maximumDistance = Math.max(maximumDistance, distance(out, impact))
      }
      for (const age of [220, 221, 1000]) expect(impactSpark(wave, impact, i, age, out)).toBe(0)
    }
    report.sparks = { maximumDistance }
    expect(maximumDistance).toBeLessThanOrEqual(.012)
  })
})
