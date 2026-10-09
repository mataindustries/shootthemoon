import { describe, expect, it } from 'vitest'
import { BAR_SECONDS, LOOP_SECONDS, PHRASE_SECONDS, dbToGain, LAYER_IDS, type LayerId } from './musicConstants.ts'
import { createMusicDirector } from './musicDirector.ts'
import type { MusicSnapshot } from './musicState.ts'
import {
  createFakeAssets,
  createFakeHost,
  createManualScheduler,
  FakeAudioContext,
  type FakeAudioParam,
} from './testing/fakeAudioContext.ts'
import { monument, outpost, packageBuffers, snapshot } from './testing/musicFixtures.ts'

const EPOCH = 10.15
const g = dbToGain

function rig(start: MusicSnapshot) {
  const context = new FakeAudioContext(48_000)
  context.currentTime = 10
  let perfNow = 50_000
  const scheduler = createManualScheduler()
  const director = createMusicDirector({
    mode: 'full',
    openHost: () => createFakeHost(context),
    openAssets: () => createFakeAssets(packageBuffers()),
    performanceNow: () => perfNow,
    scheduler,
  })
  director.unlockAndStart(start)
  return {
    context,
    scheduler,
    director,
    advance(seconds: number) {
      context.currentTime += seconds
      perfNow += seconds * 1000
    },
    /** Advances to the pending wake and fires it. */
    wake() {
      const pending = scheduler.pending
      if (pending === null) throw new Error('no wake scheduled')
      context.currentTime += pending.delayMs / 1000
      perfNow += pending.delayMs
      scheduler.fire()
    },
    layer(id: LayerId): FakeAudioParam {
      return (context.gains[3 + LAYER_IDS.indexOf(id)] as { gain: FakeAudioParam }).gain
    },
  }
}

const contested = (overrides: Partial<MusicSnapshot> = {}) =>
  snapshot({ outpost: outpost(), rivalRevealStatus: 'REVEALED', firstStrikeStatus: 'READY', phase: 'landed', ...overrides })

describe('dwell decay (handoff 3.7)', () => {
  it('MONUMENT_ALERT decays to MONUMENT_ALERT_DWELL after two phrases without a change', () => {
    const waiting = contested({ monumentView: true, outpost: outpost({ monument: monument('command') }) })
    const r = rig(contested({ monumentView: true, outpost: outpost({ monument: monument('constructing') }) }))
    r.advance(5)
    r.director.update(waiting)
    expect(r.director.debug.cue).toBe('MONUMENT_ALERT')
    expect(r.scheduler.pending?.delayMs).toBeCloseTo(2 * PHRASE_SECONDS * 1000, 3)
    r.wake()
    expect(r.director.debug.cue).toBe('MONUMENT_ALERT_DWELL')
    // Released over two bars from the next phrase: ASSAULT leaves, CLAIM settles to −8 dB.
    const phrase = EPOCH + 3 * PHRASE_SECONDS
    expect(r.layer('assault').valueAt(phrase)).toBeCloseTo(g(-12), 6)
    expect(r.layer('assault').valueAt(phrase + 2 * BAR_SECONDS + 0.001)).toBe(0)
    expect(r.layer('claim').valueAt(phrase + 2 * BAR_SECONDS + 0.001)).toBeCloseTo(g(-8), 6)
    // The player finally orders the wave: combat, and the dwell timer is gone.
    r.director.update(contested({ monumentView: true, outpost: outpost({ monument: monument('wave') }) }))
    expect(r.director.debug.cue).toBe('MONUMENT_COMBAT')
  })

  it('a change of state restarts the timer', () => {
    const r = rig(contested())
    r.advance(5)
    r.director.update(contested({ strikeConfirmationOpen: true }))
    r.advance(15)
    r.director.update(contested({ strikeConfirmationOpen: false }))
    r.advance(1)
    r.director.update(contested({ strikeConfirmationOpen: true }))
    expect(r.scheduler.pending?.delayMs).toBeCloseTo(2 * PHRASE_SECONDS * 1000, 3)
    r.advance(10)
    r.director.update(contested({ strikeConfirmationOpen: true }))
    expect(r.director.debug.cue).toBe('STRIKE_DECISION')
    r.wake()
    expect(r.director.debug.cue).toBe('CONTESTED')
  })

  it('RIVAL_FOCUS decays only while the focus panel waits (rival-focused)', () => {
    const r = rig(contested({ phase: 'orbit' }))
    r.advance(3)
    r.director.update(contested({ phase: 'orbit', rivalPhase: 'rival-focus' }))
    expect(r.scheduler.pending === null || (r.scheduler.pending.delayMs ?? 0) > 60_000).toBe(true)
    r.advance(2.6)
    r.director.update(contested({ phase: 'orbit', rivalPhase: 'rival-focused' }))
    expect(r.scheduler.pending?.delayMs).toBeCloseTo(2 * PHRASE_SECONDS * 1000, 3)
    r.wake()
    expect(r.director.debug.cue).toBe('CONTESTED')
    r.director.update(contested({ phase: 'orbit', rivalPhase: 'scanning' }))
    expect(r.director.debug.cue).toBe('RIVAL_FOCUS')
  })
})

describe('rotation in long calm (handoff 3.7)', () => {
  /** Rotation loop k (1-based) of a stretch whose first bar-9 boundary is `origin`. */
  const loopMid = (origin: number, k: number) => origin + (k - 1) * LOOP_SECONDS + LOOP_SECONDS / 2

  it('plays N N N T N N N T R on bar-9 boundaries, then starts again', () => {
    const r = rig(contested())
    const origin = EPOCH + 2 * PHRASE_SECONDS
    const pattern = ['N', 'N', 'N', 'T', 'N', 'N', 'N', 'T', 'R', 'N', 'N', 'N', 'T'].map((kind, index) => {
      const time = loopMid(origin, index + 1)
      const engine = r.layer('engine').valueAt(time)
      const pressure = r.layer('pressure').valueAt(time)
      const bed = r.layer('bed').valueAt(time)
      if (bed === 0 && engine === 0 && pressure === 0) return 'R'
      if (engine === 0 && Math.abs(pressure - g(-16)) < 1e-6) return 'T'
      expect(engine).toBeCloseTo(g(-4), 6)
      expect(pressure).toBeCloseTo(g(-10), 6)
      return kind === 'N' ? 'N' : `?${kind}`
    })
    expect(pattern.join(' ')).toBe('N N N T N N N T R N N N T')
    // Windows begin on bar 9 (P3), never at the loop seam.
    const thinStart = origin + 3 * LOOP_SECONDS
    expect(r.layer('engine').valueAt(thinStart)).toBeCloseTo(g(-4), 6)
    expect(r.layer('engine').valueAt(thinStart + BAR_SECONDS)).toBe(0)
    expect((thinStart - EPOCH) % LOOP_SECONDS).toBeCloseTo(2 * PHRASE_SECONDS, 6)
  })

  it('extends the plan beyond two cycles when it wakes', () => {
    const r = rig(contested())
    const origin = EPOCH + 2 * PHRASE_SECONDS
    const planned = origin + 18 * LOOP_SECONDS
    expect(r.scheduler.pending?.delayMs).toBeCloseTo((planned - LOOP_SECONDS - r.context.currentTime) * 1000, 3)
    r.wake()
    expect(r.layer('engine').valueAt(loopMid(origin, 22))).toBe(0)
    expect(r.layer('bed').valueAt(loopMid(origin, 27))).toBe(0)
    expect(r.layer('bed').valueAt(loopMid(origin, 28))).toBeCloseTo(1, 6)
  })

  it('RECON never rests', () => {
    const r = rig(snapshot())
    const origin = EPOCH + 2 * PHRASE_SECONDS
    for (let k = 1; k <= 18; k += 1) expect(r.layer('bed').valueAt(loopMid(origin, k))).toBeCloseTo(g(-3), 6)
  })

  it('a non-calm cue cancels a rest at the next bar', () => {
    const r = rig(contested())
    const origin = EPOCH + 2 * PHRASE_SECONDS
    const inRest = loopMid(origin, 9)
    r.advance(inRest - r.context.currentTime)
    expect(r.layer('bed').valueAt(r.context.currentTime)).toBe(0)
    r.director.update(contested({ strikeConfirmationOpen: true }))
    const bar = EPOCH + Math.ceil((r.context.currentTime + 0.1 - EPOCH) / BAR_SECONDS) * BAR_SECONDS
    expect(r.layer('bed').valueAt(bar + BAR_SECONDS + 0.01)).toBeCloseTo(g(-2), 4)
    expect(r.layer('pressure').valueAt(bar + BAR_SECONDS + 0.01)).toBeCloseTo(g(-6), 4)
    // ...and the old rest window no longer ends with a swell back to CONTESTED.
    expect(r.layer('pressure').valueAt(loopMid(origin, 10))).toBeCloseTo(g(-6), 6)
  })

  it('a change of calm cue restarts the count', () => {
    const r = rig(contested())
    const origin = EPOCH + 2 * PHRASE_SECONDS
    r.advance(origin + 2 * LOOP_SECONDS - r.context.currentTime)
    r.director.update(contested({ firstStrikeStatus: 'COMPLETE', acceptedOutcome: 'SUCCESS' }))
    // Old pattern would thin loop 4; the ASCENDANT stretch counts from its own first bar 9.
    expect(r.layer('engine').valueAt(loopMid(origin, 4))).toBeCloseTo(g(-4), 6)
  })
})
