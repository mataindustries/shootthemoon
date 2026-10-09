import { describe, expect, it } from 'vitest'
import type { FirstStrikePresentationPhase } from '../../app/firstStrikePresentation.ts'
import type { RivalPresentationPhase } from '../../app/rivalPresentation.ts'
import type { SiegeStatus } from '../../domain/orbitalSiege.ts'
import type { MonumentStatus } from '../../domain/territoryMonument.ts'
import type { CounterstrikeRunStatus } from '../../simulation/counterstrikeSimulation.ts'
import type { Cue } from './musicMix.ts'
import { deriveCue, deriveMusicTarget, presentationsIdle, siegeAdvancing, type MusicSnapshot } from './musicState.ts'
import { monument, outpost, siege, snapshot } from './testing/musicFixtures.ts'

const contested = (overrides: Partial<MusicSnapshot> = {}) =>
  snapshot({ outpost: outpost(), rivalRevealStatus: 'REVEALED', firstStrikeStatus: 'READY', ...overrides })

describe('music cue derivation (handoff 3.3)', () => {
  it('is SILENT while the launch gate is open, whatever else is happening', () => {
    expect(deriveCue(contested({ entryOpen: true, csStatus: 'tracking', strikePhase: 'launch' }))).toBe('SILENT')
  })

  it('maps every First Strike phase', () => {
    const expected: Record<FirstStrikePresentationPhase, Cue> = {
      idle: 'CONTESTED',
      arming: 'FS_FLIGHT',
      launch: 'FS_FLIGHT',
      'orbital-flight': 'FS_FLIGHT',
      'vesper-transmission': 'FS_TRANSMISSION',
      'target-approach': 'FS_FLIGHT',
      'impact-flash': 'FS_VACUUM',
      ejecta: 'FS_VACUUM',
      'crater-reveal': 'FS_BREATH',
      'orbital-pullback': 'FS_BREATH',
      'scar-explore': 'CONTESTED',
      ending: 'FS_BREATH',
    }
    for (const [phase, cue] of Object.entries(expected)) {
      expect(deriveCue(contested({ strikePhase: phase as FirstStrikePresentationPhase })), phase).toBe(cue)
    }
    // The strike outranks a Counterstrike and everything below it.
    expect(deriveCue(contested({ strikePhase: 'launch', csStatus: 'tracking', rivalPhase: 'warning' }))).toBe('FS_FLIGHT')
  })

  it('maps every Counterstrike run status; dormant and resolved fall through to the arc', () => {
    const expected: Record<CounterstrikeRunStatus, Cue> = {
      dormant: 'RETALIATION',
      command: 'CS_ALERT',
      'command-confirmed': 'CS_ALERT',
      warning: 'CS_WARNING',
      tracking: 'CS_COMBAT',
      'intercept-ready': 'CS_COMBAT',
      'interceptor-launched': 'CS_COMBAT',
      missed: 'CS_COMBAT',
      impact: 'CS_IMPACT',
      success: 'CS_SUCCESS',
      resolved: 'RETALIATION',
    }
    for (const [status, cue] of Object.entries(expected)) {
      expect(deriveCue(contested({ firstStrikeStatus: 'COMPLETE', csStatus: status as CounterstrikeRunStatus })), status).toBe(cue)
    }
  })

  it('maps every rival presentation phase', () => {
    const expected: Record<RivalPresentationPhase, Cue> = {
      idle: 'FOOTHOLD_WORKS',
      warning: 'REVEAL_APPROACH',
      'orbital-transition': 'REVEAL_APPROACH',
      'capsule-approach': 'REVEAL_APPROACH',
      impact: 'REVEAL_IMPACT',
      'intro-transmission': 'REVEAL_TRANSMISSION',
      'dual-sites': 'REVEAL_SETTLE',
      'rival-focus': 'RIVAL_FOCUS',
      'rival-focused': 'RIVAL_FOCUS',
      scanning: 'RIVAL_FOCUS',
      'scan-response': 'RIVAL_TRANSMISSION',
      contested: 'RIVAL_FOCUS',
    }
    for (const [phase, cue] of Object.entries(expected)) {
      expect(deriveCue(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: phase as RivalPresentationPhase })), phase).toBe(cue)
    }
  })

  it('siege status × {landed, orbit, monument view} × {presentations idle, busy}', () => {
    const active: Record<SiegeStatus, Cue | null> = {
      constructing: 'SIEGE_BUILD',
      command: 'SIEGE_ALERT',
      waves: 'SIEGE_COMBAT',
      repairing: 'SIEGE_REPAIR',
      operational: null,
      damaged: null,
    }
    for (const [status, cue] of Object.entries(active) as [SiegeStatus, Cue | null][]) {
      for (const view of ['landed', 'orbit', 'monument'] as const) {
        for (const busy of [false, true]) {
          const s = contested({
            outpost: outpost({ siege: siege(status) }),
            phase: view === 'landed' ? 'landed' : 'orbit',
            monumentView: view === 'monument',
            rivalPhase: busy ? 'rival-focused' : 'idle',
          })
          const advancing = cue !== null && view !== 'orbit' && !busy
          expect(siegeAdvancing(s), `${status} ${view} ${busy}`).toBe(advancing)
          const result = deriveCue(s)
          if (advancing) expect(result).toBe(cue)
          else if (busy) expect(result).toBe('RIVAL_FOCUS')
          else if (view === 'monument') expect(result).toBe('MONUMENT_CHOICES')
          else expect(result, `${status} ${view}`).toBe('CONTESTED')
        }
      }
    }
    expect(presentationsIdle(contested({ csStatus: 'resolved' }))).toBe(true)
    expect(presentationsIdle(contested({ csStatus: 'command' }))).toBe(false)
  })

  it('monument status × view', () => {
    const inView: Record<MonumentStatus, Cue> = {
      constructing: 'MONUMENT_BUILD',
      command: 'MONUMENT_ALERT',
      wave: 'MONUMENT_COMBAT',
      activating: 'MONUMENT_ACTIVATING',
      damaged: 'MONUMENT_DAMAGED',
      repairing: 'MONUMENT_DAMAGED',
      complete: 'CLAIMED',
    }
    for (const [status, cue] of Object.entries(inView) as [MonumentStatus, Cue][]) {
      const base = { outpost: outpost({ monument: monument(status) }), phase: 'landed' as const }
      expect(deriveCue(contested({ ...base, monumentView: true })), status).toBe(cue)
      expect(deriveCue(contested({ ...base, monumentView: false })), status).toBe(status === 'complete' ? 'CLAIMED' : 'CONTESTED')
    }
    expect(deriveCue(contested({ monumentView: true }))).toBe('MONUMENT_CHOICES')
    // An active siege outranks the panel because it keeps advancing behind it.
    expect(deriveCue(contested({ outpost: outpost({ siege: siege('waves') }), monumentView: true }))).toBe('SIEGE_COMBAT')
  })

  it('the confirmation dialog, scar exploration and the monument reveal', () => {
    expect(deriveCue(contested({ strikeConfirmationOpen: true }))).toBe('STRIKE_DECISION')
    const scar = deriveMusicTarget(contested({ firstStrikeStatus: 'COMPLETE', strikePhase: 'scar-explore' }))
    expect(scar.cue).toBe('RETALIATION')
    expect(scar.gains.engine).toBeUndefined()
    expect(scar.gains).toEqual({ bed: 0, pressure: -5 })
    const reveal = { outpost: outpost({ monument: monument('complete') }), monumentView: true, monumentRevealAtMs: 1 }
    expect(deriveCue(contested(reveal))).toBe('MONUMENT_REVEAL')
    // The reveal plays only in the monument view; a Counterstrike replay outranks it.
    expect(deriveCue(contested({ ...reveal, monumentView: false }))).toBe('CLAIMED')
    expect(deriveCue(contested({ ...reveal, csStatus: 'warning' }))).toBe('CS_WARNING')
  })

  it('every terminal reducer state maps to a calm cue', () => {
    const calm = new Set<Cue>(['RECON', 'FOOTHOLD', 'FOOTHOLD_WORKS', 'CONTESTED', 'RETALIATION', 'ASCENDANT', 'CLAIMED'])
    const terminal: MusicSnapshot[] = [
      contested({ csStatus: 'resolved', firstStrikeStatus: 'COMPLETE', acceptedOutcome: 'SUCCESS' }),
      contested({ csStatus: 'resolved', firstStrikeStatus: 'COMPLETE', acceptedOutcome: 'FAILURE', counterstrikeDamaged: true }),
      contested({ outpost: outpost({ siege: siege('operational') }), phase: 'landed' }),
      contested({ outpost: outpost({ siege: siege('damaged') }), phase: 'landed' }),
      contested({ outpost: outpost({ monument: monument('complete') }), phase: 'landed', monumentView: true }),
      contested({ outpost: outpost({ monument: monument('damaged') }), phase: 'landed' }),
      contested({ strikePhase: 'idle', rivalPhase: 'idle' }),
    ]
    for (const s of terminal) expect(calm.has(deriveCue(s)), JSON.stringify(s.outpost)).toBe(true)
  })
})
