import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { deriveRivalSite } from '../domain/rival.ts'
import { deriveSecondaryImpactSite } from '../domain/counterstrike.ts'
import { createInitialOutpost } from './outpostSimulation.ts'
import { COUNTERSTRIKE_TIMING, counterstrikeRunReducer, createCounterstrikeRunState, getCounterstrikeRunDurationMs } from './counterstrikeSimulation.ts'
import { INTERCEPTOR_CONTACT_RADIUS, THREAT_CONTACT_RADIUS, planInterceptorContact, sweptSphereContact } from './interceptorCollision.ts'
import { createCounterstrikeRoute, createInterceptorRoute } from '../camera/counterstrikeRoute.ts'
import { createCounterstrikeCameraPlan, sampleCounterstrikeInterceptionCamera } from '../camera/counterstrikeCameraPlan.ts'

const player = createLandingSite(createLunarLocation(.248, -.684, 18))
const rival = deriveRivalSite(player).site
const impact = deriveSecondaryImpactSite(createInitialOutpost(player, 0))
function launch(attempt: 1 | 2 = 1) {
  const tracking = { ...createCounterstrikeRunState(null), status: 'tracking' as const,
    attemptStartedAtMs: 0, attemptNumber: attempt, attemptsUsed: (attempt - 1) as 0 | 1,
    threatProgressStart: attempt === 1 ? .4 : .78, threatProgressEnd: attempt === 1 ? .58 : .91 }
  const fired = counterstrikeRunReducer(tracking, { type: 'fire', clockMs: 6000 })
  return { ...fired, contact: planInterceptorContact(player, rival, impact, fired) }
}

describe('swept interceptor contact', () => {
  it('detects tunneling even when neither endpoint overlaps, and rejects misses', () => {
    const origin = new Vector3()
    expect(sweptSphereContact(new Vector3(-10, 0, 0), new Vector3(10, 0, 0), 1, origin, origin, 1)).toBe(.4)
    expect(sweptSphereContact(new Vector3(-10, 3, 0), new Vector3(10, 3, 0), 1, origin, origin, 1)).toBeNull()
    expect(sweptSphereContact(origin, origin, 1, origin, origin, 1)).toBe(0)
    expect(sweptSphereContact(new Vector3(3, 0, 0), new Vector3(3, 0, 0), 1, origin, origin, 1)).toBeNull()
  })

  it.each([1, 2] as const)('ends attempt %s before mesh overlap with a stable shared collision point', (attempt) => {
    const run = launch(attempt)
    const contact = run.contact!
    expect(contact.flightProgress).toBeLessThan(1)
    expect(contact.flightProgress).toBeGreaterThan(.5)
    const threat = createCounterstrikeRoute(player, rival, impact)
    const interceptor = createInterceptorRoute(player, threat, run.interceptRouteProgress!)
    const p = contact.flightProgress
    const a = threat.getRenderPoint(contact.threatProgress)
    const b = interceptor.getRenderPoint(p * p * (3 - 2 * p))
    expect(a.distanceTo(b)).toBeCloseTo(THREAT_CONTACT_RADIUS + INTERCEPTOR_CONTACT_RADIUS, 5)
    expect(new Vector3(contact.point.x, contact.point.y, contact.point.z).distanceTo(a)).toBeCloseTo(THREAT_CONTACT_RADIUS, 5)
    expect(getCounterstrikeRunDurationMs(run)).toBe(COUNTERSTRIKE_TIMING.launchedValidMs * p)
    const at = run.phaseStartedAtMs + getCounterstrikeRunDurationMs(run)!
    expect(counterstrikeRunReducer(run, { type: 'advance', clockMs: at })).toBe(run)
    expect(counterstrikeRunReducer(run, { type: 'contact', launchAtMs: run.phaseStartedAtMs, clockMs: at - 1 })).toBe(run)
    const event = { type: 'contact' as const, launchAtMs: run.phaseStartedAtMs, clockMs: at + 200 }
    const success = counterstrikeRunReducer(run, event)
    expect(success.status).toBe('success')
    expect(success.phaseStartedAtMs).toBe(at)
    expect(success.contact).toBe(contact)
    expect(counterstrikeRunReducer(success, event)).toBe(success)
    expect(counterstrikeRunReducer(run, { ...event, launchAtMs: -1 })).toBe(run)
    const shifted = counterstrikeRunReducer(run, { type: 'shiftClock', durationMs: 20000 })
    expect(shifted.contact).toBe(contact)
    expect(counterstrikeRunReducer(shifted, event)).toBe(shifted)
    expect(counterstrikeRunReducer(success, { type: 'reset', clockMs: at }).contact).toBeNull()
  })

  it('holds exactly the contact camera through the success transition, then pulls back without a jump', () => {
    const run = launch()
    const plan = createCounterstrikeCameraPlan(player, rival, impact, 390 / 844,
      run.interceptRouteProgress!, run.contact!.launchThreatProgress, run.contact)
    const last = [new Vector3(), new Vector3(), new Vector3()] as const
    const next = [new Vector3(), new Vector3(), new Vector3()] as const
    sampleCounterstrikeInterceptionCamera(plan, 'interceptor-launched', 1, ...last)
    sampleCounterstrikeInterceptionCamera(plan, 'success', 0, ...next)
    expect(next).toEqual(last)
    sampleCounterstrikeInterceptionCamera(plan, 'success', .1, ...next)
    expect(next).toEqual(last)
    sampleCounterstrikeInterceptionCamera(plan, 'success', 1, ...next)
    expect(next[0].distanceTo(plan.successPose.position)).toBeLessThan(1e-12)
  })

  it('does not manufacture collisions for early or late firing', () => {
    for (const judgement of ['EARLY', 'LATE'] as const) {
      expect(planInterceptorContact(player, rival, impact, { ...launch(), judgement })).toBeNull()
    }
  })
})
