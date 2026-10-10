import { describe, expect, it } from 'vitest'
import {
  BAR_SECONDS,
  BEAT_SECONDS,
  LAYER_IDS,
  PHRASE_SECONDS,
  SYNC_VISUAL_OFFSET_MS,
  dbToGain,
  type AssetId,
  type LayerId,
} from './musicConstants.ts'
import { createMusicDirector, projectStrikePhaseStarts, type MusicMode } from './musicDirector.ts'
import { layerStartOffset } from './musicClock.ts'
import type { MusicSnapshot } from './musicState.ts'
import {
  createFakeAssets,
  createFakeHost,
  createManualScheduler,
  FakeAudioContext,
  flushPromises,
  type FakeAudioParam,
  type FakeBuffer,
  type FakeBufferSource,
} from './testing/fakeAudioContext.ts'
import { monument, outpost, packageBuffers, siege, snapshot } from './testing/musicFixtures.ts'

const SR = 48_000
const START = 10
const EPOCH = 10.15

function rig(options: { readonly mode?: MusicMode; readonly ids?: readonly AssetId[] } = {}) {
  const context = new FakeAudioContext(SR)
  context.currentTime = START
  const host = createFakeHost(context)
  const buffers = packageBuffers(SR)
  const assets = createFakeAssets(
    options.ids === undefined
      ? buffers
      : Object.fromEntries(options.ids.map((id) => [id, buffers[id] as FakeBuffer])),
  )
  const scheduler = createManualScheduler()
  let perfNow = 50_000
  let opened = 0
  const director = createMusicDirector({
    mode: options.mode ?? 'full',
    openHost: () => {
      opened += 1
      return host
    },
    openAssets: () => assets,
    performanceNow: () => perfNow,
    scheduler,
  })
  return {
    context,
    host,
    assets,
    buffers,
    scheduler,
    director,
    get perfNow() {
      return perfNow
    },
    get opened() {
      return opened
    },
    advance(seconds: number) {
      context.currentTime += seconds
      perfNow += seconds * 1000
    },
    /** Layer gain params are created right after the host's three buses. */
    layer(id: LayerId): FakeAudioParam {
      return (context.gains[3 + LAYER_IDS.indexOf(id)] as { gain: FakeAudioParam }).gain
    },
    sourcesOf(id: AssetId): FakeBufferSource[] {
      return context.sources.filter((source) => source.buffer === buffers[id])
    },
  }
}

const g = dbToGain

/** A(perfMs) with the fake's currentTime fallback. */
function mapped(r: ReturnType<typeof rig>, perfMs: number): number {
  return r.context.currentTime + (perfMs + SYNC_VISUAL_OFFSET_MS - r.perfNow) / 1000
}

function contested(overrides: Partial<MusicSnapshot> = {}): MusicSnapshot {
  return snapshot({ outpost: outpost(), rivalRevealStatus: 'REVEALED', firstStrikeStatus: 'READY', ...overrides })
}

describe('music director: unlock and start', () => {
  it('(a) creates no context, source or request before unlock', () => {
    const r = rig()
    r.director.update(snapshot({ outpost: outpost() }))
    r.director.update(contested())
    expect(r.opened).toBe(0)
    expect(r.context.sources).toHaveLength(0)
    expect(r.assets.requests).toHaveLength(0)
    expect(r.director.debug).toMatchObject({ status: 'idle', cue: 'SILENT', arc: 'CONTESTED' })
  })

  it('(b) starts exactly five phase-locked looping sources on one epoch', () => {
    const r = rig()
    r.director.unlockAndStart(snapshot())
    expect(r.opened).toBe(1)
    expect(r.context.sources).toHaveLength(5)
    for (const source of r.context.sources) {
      expect(source.loop).toBe(true)
      expect(source.loopStart).toBe(0.2)
      expect(source.loopEnd).toBe(38.6)
      expect(source.starts).toEqual([{ when: EPOCH, offset: 0.2 }])
    }
    expect(new Set(r.context.sources.map((source) => source.buffer)).size).toBe(5)
    expect(r.director.debug).toMatchObject({ status: 'playing', arc: 'RECON', cue: 'RECON' })
    // BED swells over the first bar; everything else waits for the next bar.
    expect(r.layer('bed').valueAt(EPOCH)).toBeCloseTo(0.001, 6)
    expect(r.layer('bed').valueAt(EPOCH + BAR_SECONDS)).toBeCloseTo(g(-3), 6)
    expect(r.host.audible).toBe(true)
  })

  it('joins the other layers at the next bar on start', () => {
    const r = rig()
    r.director.unlockAndStart(contested({ phase: 'landed' }))
    expect(r.layer('engine').valueAt(EPOCH + BAR_SECONDS - 0.01)).toBe(0)
    expect(r.layer('engine').valueAt(EPOCH + 2 * BAR_SECONDS)).toBeCloseTo(g(-4), 6)
    expect(r.layer('pressure').valueAt(EPOCH + 2 * BAR_SECONDS)).toBeCloseTo(g(-10), 6)
    expect(r.layer('assault').valueAt(EPOCH + 3 * BAR_SECONDS)).toBe(0)
  })

  it('(c) ignores a StrictMode-style double start and repeated updates', () => {
    const r = rig()
    r.director.unlockAndStart(snapshot())
    r.director.unlockAndStart(snapshot())
    const same = snapshot()
    r.director.update(same)
    r.director.update(same)
    r.director.update(snapshot())
    expect(r.opened).toBe(1)
    expect(r.context.sources).toHaveLength(5)
    expect(r.director.debug.stingerCount).toBe(0)
  })

  it('requests BED and ENGINE first, then groups as they become reachable', () => {
    const r = rig()
    r.director.unlockAndStart(snapshot())
    expect(r.assets.requests[0]).toEqual(['start'])
    r.director.update(snapshot({ outpost: outpost() }))
    expect(r.assets.requests.at(-1)).toEqual(['start', 'conflict'])
    r.director.update(contested())
    expect(r.assets.requests.at(-1)).toEqual(['start', 'conflict', 'strike'])
    r.director.update(contested({ firstStrikeStatus: 'COMPLETE' }))
    expect(r.assets.requests.at(-1)).toEqual(['start', 'conflict', 'strike', 'claim'])
  })

  it('waits for BED to set the epoch, then late layers join at their current phase', () => {
    const r = rig({ ids: [] })
    r.director.unlockAndStart(contested({ phase: 'landed' }))
    expect(r.director.debug.status).toBe('loading')
    expect(r.context.sources).toHaveLength(0)
    r.advance(0.8)
    r.assets.ready('bed', r.buffers.bed as FakeBuffer)
    expect(r.director.debug.status).toBe('playing')
    const epoch = Math.round((START + 0.8 + 0.15) * SR) / SR
    expect(r.sourcesOf('bed')[0]?.starts).toEqual([{ when: epoch, offset: 0.2 }])
    r.advance(1.3)
    r.assets.ready('pressure', r.buffers.pressure as FakeBuffer)
    const join = r.sourcesOf('pressure')[0]
    const when = Math.round((r.context.currentTime + 0.1) * SR) / SR
    expect(join?.starts).toEqual([{ when, offset: layerStartOffset(when, epoch, SR) }])
    expect(join?.starts[0]?.offset).toBeCloseTo(0.2 + (when - epoch), 9)
    // Swell 1 bar, ending on the first bar boundary at least a bar after the source starts.
    const boundary = epoch + 2 * BAR_SECONDS
    expect(r.layer('pressure').valueAt(boundary - BAR_SECONDS)).toBeCloseTo(0.001, 6)
    expect(r.layer('pressure').valueAt(boundary)).toBeCloseTo(g(-10), 6)
  })

  it('reports error when neither BED nor ENGINE can play', () => {
    const r = rig({ ids: [] })
    r.director.unlockAndStart(snapshot())
    r.assets.fail('bed')
    expect(r.director.debug.status).toBe('loading')
    r.assets.fail('engine')
    expect(r.director.debug.status).toBe('error')
  })
})

describe('music director: transitions (d)', () => {
  function playing(start: MusicSnapshot) {
    const r = rig()
    r.director.unlockAndStart(start)
    r.advance(6)
    return r
  }

  it('calm → calm arc change: next phrase, 2-bar crossfade', () => {
    const r = playing(snapshot())
    r.director.update(snapshot({ outpost: outpost({ extractorActive: false }), phase: 'landed' }))
    const boundary = EPOCH + PHRASE_SECONDS
    expect(r.layer('bed').valueAt(boundary)).toBeCloseTo(g(-3), 6)
    expect(r.layer('engine').valueAt(boundary - 0.001)).toBe(0)
    expect(r.layer('engine').valueAt(boundary + 2 * BAR_SECONDS)).toBeCloseTo(g(-12), 6)
    expect(r.layer('bed').valueAt(boundary + 2 * BAR_SECONDS)).toBeCloseTo(1, 6)
    expect(r.director.debug.cue).toBe('FOOTHOLD')
  })

  it('FOOTHOLD → FOOTHOLD_WORKS: ENGINE enters at the next bar', () => {
    const r = playing(snapshot({ outpost: outpost({ extractorActive: false }), phase: 'landed' }))
    r.director.update(snapshot({ outpost: outpost(), phase: 'landed' }))
    const boundary = EPOCH + 3 * BAR_SECONDS
    expect(r.layer('engine').valueAt(boundary)).toBeCloseTo(g(-12), 6)
    expect(r.layer('engine').valueAt(boundary + BAR_SECONDS)).toBeCloseTo(g(-4), 6)
  })

  it('calm → tension: next bar, falls on the boundary, rises half a fall later', () => {
    const r = playing(contested())
    r.director.update(contested({ strikeConfirmationOpen: true }))
    const boundary = EPOCH + 3 * BAR_SECONDS
    expect(r.director.debug.cue).toBe('STRIKE_DECISION')
    expect(r.layer('bed').valueAt(boundary)).toBeCloseTo(1, 6)
    expect(r.layer('bed').valueAt(boundary + BAR_SECONDS)).toBeCloseTo(g(-2), 6)
    expect(r.layer('pressure').valueAt(boundary + BAR_SECONDS / 2)).toBeCloseTo(g(-10), 6)
    expect(r.layer('pressure').valueAt(boundary + 1.5 * BAR_SECONDS)).toBeCloseTo(g(-6), 6)
  })

  it('tension → combat: next bar, ASSAULT hard on the downbeat, others over a beat', () => {
    const r = playing(contested({ csStatus: 'warning' }))
    r.director.update(contested({ csStatus: 'tracking' }))
    const boundary = EPOCH + 3 * BAR_SECONDS
    expect(r.layer('assault').valueAt(boundary)).toBeCloseTo(g(-6), 6)
    expect(r.layer('assault').valueAt(boundary + 0.02)).toBeCloseTo(1, 6)
    expect(r.layer('bed').valueAt(boundary + BEAT_SECONDS)).toBeCloseTo(g(-4), 6)
    expect(r.layer('engine').valueAt(boundary + BEAT_SECONDS)).toBeCloseTo(g(-10), 6)
  })

  it('FIRE: next beat, ASSAULT hard', () => {
    const r = playing(contested({ strikeConfirmationOpen: true }))
    r.director.update(contested({ firstStrikeStatus: 'LAUNCHING', strikePhase: 'arming', strikePhaseStartedAtMs: r.perfNow }))
    const boundary = EPOCH + 10 * BEAT_SECONDS
    expect(r.director.debug.cue).toBe('FS_FLIGHT')
    expect(r.layer('assault').valueAt(boundary - 0.001)).toBe(0)
    expect(r.layer('assault').valueAt(boundary + 0.02)).toBeCloseTo(g(-1), 6)
  })

  it('set-piece steps move on the next beat over one beat', () => {
    const r = playing(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: 'capsule-approach' }))
    r.director.update(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: 'impact' }))
    const boundary = EPOCH + 10 * BEAT_SECONDS
    expect(r.layer('pressure').valueAt(boundary)).toBeCloseTo(g(-6), 6)
    expect(r.layer('pressure').valueAt(boundary + BEAT_SECONDS)).toBeCloseTo(g(-3), 6)
  })

  it('transmissions pull back immediately with a 0.4 s duck', () => {
    const r = playing(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: 'impact' }))
    r.director.update(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: 'intro-transmission' }))
    const begin = START + 6 + 0.1
    expect(r.layer('bed').valueAt(begin)).toBeCloseTo(g(-2), 6)
    expect(r.layer('bed').valueAt(begin + 0.4)).toBeCloseTo(g(-6), 6)
    expect(r.layer('engine').valueAt(begin + 0.4)).toBe(0)
    expect(r.layer('pressure').valueAt(begin + 0.4)).toBeCloseTo(g(-9), 6)
  })

  it('combat → aftermath on the next beat; aftermath → calm released over a bar from the phrase', () => {
    const r = playing(contested({ csStatus: 'tracking', firstStrikeStatus: 'COMPLETE' }))
    r.director.update(contested({ csStatus: 'success', firstStrikeStatus: 'COMPLETE' }))
    const beat = EPOCH + 10 * BEAT_SECONDS
    expect(r.layer('assault').valueAt(beat)).toBeCloseTo(1, 6)
    expect(r.layer('assault').valueAt(beat + BEAT_SECONDS)).toBeCloseTo(g(-10), 6)
    r.advance(2)
    r.director.update(contested({ csStatus: 'resolved', firstStrikeStatus: 'COMPLETE', acceptedOutcome: 'SUCCESS' }))
    const phrase = EPOCH + PHRASE_SECONDS
    expect(r.director.debug.cue).toBe('ASCENDANT')
    expect(r.layer('assault').valueAt(phrase)).toBeCloseTo(g(-10), 6)
    expect(r.layer('assault').valueAt(phrase + BAR_SECONDS)).toBe(0)
    expect(r.layer('engine').valueAt(phrase + 1.5 * BAR_SECONDS)).toBeCloseTo(g(-8), 6)
  })

  it('a view change ramps ENGINE over the camera journey', () => {
    const r = playing(snapshot({ outpost: outpost(), phase: 'landed' }))
    r.director.update(snapshot({ outpost: outpost(), phase: 'returning' }))
    const begin = START + 6 + 0.1
    expect(r.layer('engine').valueAt(begin)).toBeCloseTo(g(-4), 6)
    expect(r.layer('engine').valueAt(begin + 2.4)).toBeCloseTo(g(-8), 6)
    r.advance(3)
    r.director.update(snapshot({ outpost: outpost(), phase: 'approach' }))
    const descent = START + 9 + 0.1
    expect(r.layer('engine').valueAt(descent + 6.2)).toBeCloseTo(g(-4), 6)
    expect(r.layer('engine').valueAt(descent + 3.1)).toBeCloseTo(g(-6), 6)
  })

  it('a newer target supersedes a pending one and continues from the modeled value', () => {
    const r = playing(contested())
    r.director.update(contested({ strikeConfirmationOpen: true }))
    r.advance(0.5)
    r.director.update(contested({ csStatus: 'command', firstStrikeStatus: 'COMPLETE' }))
    const boundary = EPOCH + 3 * BAR_SECONDS
    // Both changes quantize to the same bar: only the newest target is scheduled there.
    expect(r.layer('assault').valueAt(boundary + BAR_SECONDS * 2)).toBeCloseTo(g(-14), 6)
    expect(r.layer('pressure').valueAt(boundary + BAR_SECONDS * 2)).toBeCloseTo(g(-2), 6)
  })
})

describe('music director: First Strike (e)', () => {
  const NOMINAL: readonly [MusicSnapshot['strikePhase'], number][] = [
    ['launch', 2_400],
    ['orbital-flight', 5_600],
    ['vesper-transmission', 9_400],
    ['target-approach', 12_600],
    ['impact-flash', 14_800],
    ['ejecta', 16_100],
    ['crater-reveal', 19_500],
    ['orbital-pullback', 22_100],
    ['ending', 26_100],
  ]

  function fire(lateMs: Partial<Record<MusicSnapshot['strikePhase'], number>> = {}, until: MusicSnapshot['strikePhase'] = 'ending') {
    const r = rig()
    r.director.unlockAndStart(contested({ strikeConfirmationOpen: true }))
    r.advance(3)
    const t0 = r.context.currentTime
    const p0 = r.perfNow
    const strike = (phase: MusicSnapshot['strikePhase'], startedAt: number) =>
      contested({ firstStrikeStatus: 'LAUNCHING', strikePhase: phase, strikePhaseStartedAtMs: startedAt })
    r.director.update(strike('arming', p0))
    let lateness = 0
    for (const [phase, nominal] of NOMINAL) {
      lateness += lateMs[phase] ?? 0
      const at = p0 + nominal + lateness
      r.advance((at - r.perfNow) / 1000)
      r.director.update(strike(phase, at))
      if (phase === until) break
    }
    return { r, t0, p0 }
  }

  it('projects the remaining phases from the current phase start', () => {
    const starts = projectStrikePhaseStarts('launch', 1_000)
    expect(starts.arming).toBeUndefined()
    expect(starts.launch).toBe(1_000)
    expect(starts['vesper-transmission']).toBe(1_000 + 3_200 + 3_800)
    expect(starts['impact-flash']).toBe(1_000 + 3_200 + 3_800 + 3_200 + 2_200)
    expect(projectStrikePhaseStarts('idle', 0)).toEqual({})
  })

  it('with nominal phases: stinger at +10.2 s, vacuum ending at +14.2 s, breath at +19.5 s', () => {
    const { r, t0 } = fire()
    const offset = SYNC_VISUAL_OFFSET_MS / 1000
    const stinger = r.sourcesOf('first-strike')
    expect(stinger).toHaveLength(1)
    expect(stinger[0]?.starts[0]?.when).toBeCloseTo(t0 + 10.2 + offset, 4)
    expect(stinger[0]?.starts[0]?.offset).toBe(0.2)
    const vacuum = t0 + 14.2 + offset
    for (const id of ['bed', 'engine', 'pressure', 'assault'] as const) {
      expect(r.layer(id).valueAt(vacuum - 0.05)).toBeGreaterThan(0.01)
      expect(r.layer(id).valueAt(vacuum)).toBe(0)
    }
    // The impact (content 4.6 s) lands on the flash, nominally +14.8 s.
    expect((stinger[0]?.starts[0]?.when ?? 0) + 4.6).toBeCloseTo(t0 + 14.8 + offset, 4)
    // Breath: the crater-reveal edge, IMMEDIATE, BED to −8 dB over 2 s.
    const breath = t0 + 19.5 + 0.1
    expect(r.layer('bed').valueAt(breath - 0.01)).toBe(0)
    expect(r.layer('bed').valueAt(breath + 2)).toBeCloseTo(g(-8), 6)
    expect(r.layer('engine').valueAt(breath + 2)).toBe(0)
    expect(r.director.debug).toMatchObject({ lastStinger: 'first-strike', stingerCount: 1, cue: 'FS_BREATH' })
  })

  it('holds every layer off from the vacuum to the breath even as cues change', () => {
    const { r, t0 } = fire({}, 'ejecta')
    const offset = SYNC_VISUAL_OFFSET_MS / 1000
    for (const time of [14.3, 15.5, 17, 19]) {
      for (const id of LAYER_IDS) expect(r.layer(id).valueAt(t0 + time + offset)).toBe(0)
    }
  })

  it('moves every unstarted step by a late phase timer', () => {
    const { r, t0 } = fire({ launch: 300 }, 'launch')
    const offset = SYNC_VISUAL_OFFSET_MS / 1000
    const scheduled = r.sourcesOf('first-strike')
    expect(scheduled).toHaveLength(2)
    expect(scheduled[0]?.stops[0]).toBeLessThanOrEqual(scheduled[0]?.starts[0]?.when ?? 0)
    expect(scheduled[1]?.starts[0]?.when).toBeCloseTo(t0 + 10.5 + offset, 4)
    expect(r.layer('bed').valueAt(t0 + 14.5 + offset)).toBe(0)
    expect(r.layer('bed').valueAt(t0 + 14.4 + offset)).toBeGreaterThan(0)
    expect(r.director.debug.stingerCount).toBe(1)
  })

  it('a hidden-tab shift of the current phase moves the unstarted steps the same way', () => {
    const { r, t0, p0 } = fire({}, 'orbital-flight')
    r.director.update(contested({ firstStrikeStatus: 'LAUNCHING', strikePhase: 'orbital-flight', strikePhaseStartedAtMs: p0 + 5_600 + 750 }))
    const offset = SYNC_VISUAL_OFFSET_MS / 1000
    expect(r.sourcesOf('first-strike').at(-1)?.starts[0]?.when).toBeCloseTo(t0 + 10.95 + offset, 4)
  })

  it('once started, the stinger is fixed: a late approach timer cannot move its impact', () => {
    const { r, t0 } = fire({ 'target-approach': 40 }, 'impact-flash')
    expect(r.sourcesOf('first-strike')).toHaveLength(1)
    expect(r.sourcesOf('first-strike')[0]?.starts[0]?.when).toBeCloseTo(t0 + 10.2 + SYNC_VISUAL_OFFSET_MS / 1000, 4)
  })

  it('cancelled after the vacuum was planned, the lanes still land on the current target', () => {
    const { r, p0 } = fire({}, 'target-approach')
    r.advance(1)
    r.director.update(contested({ firstStrikeStatus: 'COMPLETE', strikePhase: 'idle', strikePhaseStartedAtMs: p0 + 13_600 }))
    expect(r.director.debug.cue).toBe('RETALIATION')
    const settled = r.context.currentTime + PHRASE_SECONDS + 2 * BAR_SECONDS
    expect(r.layer('bed').valueAt(settled)).toBeCloseTo(1, 6)
    expect(r.layer('engine').valueAt(settled)).toBeCloseTo(g(-10), 6)
    expect(r.layer('pressure').valueAt(settled)).toBeCloseTo(g(-5), 6)
    expect(r.layer('assault').valueAt(settled)).toBe(0)
  })

  it('is cancelled by idle before it starts, and by reset', () => {
    const { r, t0, p0 } = fire({}, 'orbital-flight')
    r.director.update(contested({ firstStrikeStatus: 'READY', strikePhase: 'idle', strikePhaseStartedAtMs: p0 + 7_000 }))
    const source = r.sourcesOf('first-strike')[0]
    expect(source?.stops[0]).toBeLessThanOrEqual(source?.starts[0]?.when ?? 0)
    expect(r.layer('bed').valueAt(t0 + 14.3)).toBeGreaterThan(0)

    const again = fire({}, 'launch')
    again.r.director.reset()
    const pending = again.r.sourcesOf('first-strike')[0]
    expect(pending?.stops[0]).toBeLessThanOrEqual(pending?.starts[0]?.when ?? 0)
  })
})

describe('music director: exact stingers (f)', () => {
  it('lands the Counterstrike breach on the contact, 1.5 s into impact, plus the visual offset', () => {
    const r = rig()
    r.director.unlockAndStart(contested({ csStatus: 'missed', firstStrikeStatus: 'COMPLETE' }))
    r.advance(4)
    const startedAt = r.perfNow - 120
    r.director.update(contested({ csStatus: 'impact', csPhaseStartedAtMs: startedAt, firstStrikeStatus: 'COMPLETE' }))
    const breach = r.sourcesOf('outcome-breach')[0]
    expect(breach?.starts[0]?.when).toBeCloseTo(mapped(r, startedAt + 1_500), 6)
    expect(breach?.starts[0]?.offset).toBe(0.2)
    expect(r.director.debug.lastStinger).toBe('outcome-breach')
  })

  it('uses getOutputTimestamp when the context provides it', () => {
    const r = rig()
    r.director.unlockAndStart(contested({ csStatus: 'missed', firstStrikeStatus: 'COMPLETE' }))
    r.advance(4)
    r.context.outputTimestamp = { contextTime: r.context.currentTime - 0.03, performanceTime: r.perfNow - 5 }
    r.director.update(contested({ csStatus: 'impact', csPhaseStartedAtMs: r.perfNow, firstStrikeStatus: 'COMPLETE' }))
    const expected = r.context.currentTime - 0.03 + (1_500 + SYNC_VISUAL_OFFSET_MS + 5) / 1000
    expect(r.sourcesOf('outcome-breach')[0]?.starts[0]?.when).toBeCloseTo(expected, 6)
  })

  it('lands territory-claimed on the reveal, clears the stage and swells CLAIMED in at the phrase', () => {
    const r = rig()
    const claimed = (revealAt: number | null) =>
      snapshot({
        outpost: outpost({ moduleActive: true, monument: monument('complete', { kind: 'SIGNAL_ARRAY' }) }),
        rivalRevealStatus: 'REVEALED',
        monumentView: true,
        phase: 'landed',
        monumentRevealAtMs: revealAt,
      })
    r.director.unlockAndStart(snapshot({ outpost: outpost({ monument: monument('activating') }), monumentView: true, phase: 'landed' }))
    r.advance(12)
    const revealAt = r.perfNow
    r.director.update(claimed(revealAt))
    const sync = mapped(r, revealAt)
    const voice = r.sourcesOf('territory-claimed')[0]
    expect(voice?.starts[0]?.when).toBeCloseTo(sync, 6)
    expect(r.layer('bed').valueAt(sync + 0.3)).toBeCloseTo(g(-12), 6)
    expect(r.layer('engine').valueAt(sync + 0.3)).toBe(0)
    expect(r.layer('claim').valueAt(sync + 0.3)).toBe(0)
    // The reveal cue does not raise the cleared layers.
    r.advance(2)
    r.director.update(claimed(revealAt))
    expect(r.layer('claim').valueAt(sync + 5)).toBe(0)
    const phrase = EPOCH + 3 * PHRASE_SECONDS
    expect(phrase).toBeGreaterThanOrEqual(sync + 8.4)
    expect(phrase - PHRASE_SECONDS).toBeLessThan(sync + 8.4)
    expect(r.layer('claim').valueAt(phrase - BAR_SECONDS)).toBeCloseTo(0.001, 6)
    expect(r.layer('claim').valueAt(phrase)).toBeCloseTo(1, 6)
    expect(r.layer('bed').valueAt(phrase)).toBeCloseTo(1, 6)
    expect(r.layer('engine').valueAt(phrase)).toBeCloseTo(g(-12), 6)
    expect(r.director.debug.lastStinger).toBe('territory-claimed')
  })
})

describe('music director: stinger concurrency (g)', () => {
  it('ducks the layers, ignores the same id while playing, keeps at most two and lets priority cut', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.update({ ...base, csStatus: 'command' })
    const retaliation = r.sourcesOf('vesper-retaliation')[0]
    const start = retaliation?.starts[0]?.when ?? 0
    expect(start).toBeCloseTo(EPOCH + 10 * BEAT_SECONDS, 6)
    const layersBus = r.host.layersBus.gain
    expect(layersBus.valueAt(start + 0.4)).toBeCloseTo(g(-3), 6)
    expect(layersBus.valueAt(start + BAR_SECONDS + 0.4)).toBeCloseTo(1, 6)

    r.director.update({ ...base, csStatus: 'resolved' })
    r.director.update({ ...base, csStatus: 'command' })
    expect(r.sourcesOf('vesper-retaliation')).toHaveLength(1)

    r.director.update({ ...base, csStatus: 'success' })
    expect(r.sourcesOf('outcome-hold')).toHaveLength(1)
    // −8 dB duck is deeper than −3: the deepest active duck wins, never a raise.
    const hold = r.sourcesOf('outcome-hold')[0]?.starts[0]?.when ?? 0
    expect(layersBus.valueAt(hold + 0.4)).toBeCloseTo(g(-8), 6)

    const withSiege = { ...base, csStatus: 'success' as const, outpost: outpost({ siege: siege('waves') }), platformDefenseWave: 0 }
    r.director.update(withSiege)
    expect(r.sourcesOf('divider-contact')).toHaveLength(0)
    expect(r.director.debug.stingerCount).toBe(2)

    r.director.update({ ...withSiege, platformDefenseWave: null, outpost: outpost({ siege: siege('damaged') }) })
    const breach = r.sourcesOf('outcome-breach')[0]
    const breachAt = breach?.starts[0]?.when ?? 0
    expect(breachAt).toBeCloseTo(Math.round((r.context.currentTime + 0.1) * SR) / SR, 6)
    for (const cut of [retaliation, r.sourcesOf('outcome-hold')[0]]) {
      expect(cut?.stops.at(-1)).toBeCloseTo(breachAt + 0.05, 6)
    }
    expect(r.director.debug).toMatchObject({ lastStinger: 'outcome-breach', stingerCount: 3 })
  })

  it('raises divider-contact by +1 / +2 dB on waves 2 and 3', () => {
    const r = rig()
    const base = snapshot({ outpost: outpost({ monument: monument('command', { wavesResolved: 1 }) }), monumentView: true, phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(5)
    r.director.update({ ...base, outpost: outpost({ monument: monument('wave', { wavesResolved: 1 }) }) })
    const source = r.sourcesOf('divider-contact')[0]
    const gain = (r.context.gains.find((node) => node.connections.length > 0 && source?.connections.includes(node)) as { gain: FakeAudioParam } | undefined)?.gain
    expect(gain?.valueAt(source?.starts[0]?.when ?? 0)).toBeCloseTo(g(1), 6)
  })
})

describe('music director: lifecycle (h–k)', () => {
  it('(h) hidden: suspends at once; return takes a new baseline and replays nothing past', async () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(4)
    r.director.suspend()
    expect(r.host.suspendRequests).toEqual([{ reason: 'hidden', afterSeconds: 0 }])
    expect(r.context.suspendCalls).toBe(1)
    expect(r.director.debug.status).toBe('suspended')
    r.director.update({ ...base, csStatus: 'command' })
    r.director.resume({ ...base, csStatus: 'command' })
    await flushPromises()
    expect(r.context.resumeCalls).toBe(1)
    expect(r.director.debug).toMatchObject({ status: 'playing', stingerCount: 0, cue: 'CS_ALERT' })
    r.director.update({ ...base, csStatus: 'command' })
    expect(r.sourcesOf('vesper-retaliation')).toHaveLength(0)
  })

  it('(h) restarts a stinger paused mid-riser at its re-anchored offset; one past its sync is not replayed', async () => {
    const r = rig()
    r.director.unlockAndStart(contested({ strikeConfirmationOpen: true }))
    r.advance(3)
    const p0 = r.perfNow
    const strike = (phase: MusicSnapshot['strikePhase'], startedAt: number) =>
      contested({ firstStrikeStatus: 'LAUNCHING', strikePhase: phase, strikePhaseStartedAtMs: startedAt })
    r.director.update(strike('arming', p0))
    r.advance(9.4)
    r.director.update(strike('vesper-transmission', p0 + 9_400))
    r.advance(2)
    const first = r.sourcesOf('first-strike')[0]
    const firstStart = first?.starts[0]?.when ?? 0
    expect(firstStart).toBeLessThan(r.context.currentTime)
    // Hidden for 5 s: the audio clock stops; the game shifts the current phase start.
    r.director.suspend()
    r.context.suspendCalls = 0
    const frozen = r.context.currentTime
    r.advance(5)
    r.context.currentTime = frozen
    const shifted = strike('vesper-transmission', p0 + 9_400 + 5_000)
    r.director.resume(shifted)
    await flushPromises()
    expect(first?.stops.at(-1)).toBeCloseTo(frozen + 0.02, 6)
    const restarted = r.sourcesOf('first-strike')[1]
    expect(restarted?.starts[0]?.when).toBeCloseTo(frozen, 6)
    expect(restarted?.starts[0]?.offset).toBeCloseTo(0.2 + (frozen - firstStart), 3)
    expect(r.director.debug.stingerCount).toBe(1)

    // Past its sync point: stopped, not replayed.
    r.advance(4)
    r.director.update(strike('target-approach', p0 + 9_400 + 5_000 + 3_200))
    r.director.suspend()
    r.director.resume(strike('impact-flash', r.perfNow - 500))
    await flushPromises()
    expect(r.sourcesOf('first-strike')).toHaveLength(2)
  })

  it('(i) SOUND OFF fades the music bus then suspends; SOUND ON lands on the current state', async () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    const off = r.context.currentTime
    r.director.setEnabled(false, base)
    expect(r.host.musicBus.gain.valueAt(off)).toBeCloseTo(1, 6)
    expect(r.host.musicBus.gain.valueAt(off + 0.15)).toBe(0)
    expect(r.host.suspendRequests).toEqual([{ reason: 'sound-off', afterSeconds: 0.15 }])
    expect(r.director.debug.status).toBe('suspended')
    // The game keeps running while the sound is off.
    const later = { ...base, csStatus: 'command' as const }
    r.director.update(later)
    r.director.setEnabled(true, later)
    await flushPromises()
    const on = r.context.currentTime
    expect(r.director.debug).toMatchObject({ status: 'playing', cue: 'CS_ALERT', stingerCount: 0 })
    expect(r.layer('assault').valueAt(on)).toBeCloseTo(g(-14), 6)
    expect(r.host.musicBus.gain.valueAt(on + 0.15)).toBeCloseTo(1, 6)
  })

  it('(i) SOUND OFF at BEGIN disables music without a fetch; SOUND ON then starts it', () => {
    const r = rig()
    r.director.setEnabled(false, snapshot())
    r.director.unlockAndStart(snapshot())
    expect(r.director.debug.status).toBe('disabled')
    expect(r.opened).toBe(0)
    expect(r.assets.requests).toHaveLength(0)
    r.director.setEnabled(true, snapshot())
    expect(r.director.debug.status).toBe('playing')
    expect(r.context.sources).toHaveLength(5)
  })

  it('(j) NEW GAME fades, stops every source, clears schedules, keeps buffers; next BEGIN gets a new epoch', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.update({ ...base, csStatus: 'command' })
    const resetAt = r.context.currentTime
    r.director.reset()
    expect(r.director.debug).toMatchObject({ status: 'stopped', cue: 'SILENT', stingerCount: 0, lastStinger: null })
    // Sounding sources fade with the bus; the retaliation scheduled on the next beat never starts.
    for (const source of r.context.sources) {
      const started = (source.starts[0]?.when ?? 0) <= resetAt
      expect(source.stops.at(-1)).toBeCloseTo(started ? resetAt + 0.5 : resetAt, 6)
    }
    expect(r.sourcesOf('vesper-retaliation')[0]?.stops.at(-1)).toBe(resetAt)
    expect(r.host.musicBus.gain.valueAt(resetAt + 0.5)).toBe(0)
    expect(r.scheduler.pending).toBeNull()
    expect(r.opened).toBe(1)
    r.advance(30)
    const sourcesBefore = r.context.sources.length
    r.director.unlockAndStart(snapshot())
    const epoch = Math.round((r.context.currentTime + 0.15) * SR) / SR
    const fresh = r.context.sources.slice(sourcesBefore)
    expect(fresh).toHaveLength(5)
    for (const source of fresh) expect(source.starts).toEqual([{ when: epoch, offset: 0.2 }])
    expect(r.opened).toBe(1)
    expect(r.host.musicBus.gain.valueAt(epoch)).toBe(1)
  })

  it('(k) dry mode runs the state machine with no fetch and no decode; off does nothing', () => {
    const context = new FakeAudioContext(SR)
    const host = createFakeHost(context)
    let assetsOpened = 0
    const dry = createMusicDirector({
      mode: 'dry',
      openHost: () => host,
      openAssets: () => {
        assetsOpened += 1
        return createFakeAssets()
      },
      scheduler: createManualScheduler(),
    })
    dry.unlockAndStart(snapshot())
    dry.update(snapshot({ outpost: outpost(), rivalRevealStatus: 'CINEMATIC', rivalPhase: 'warning' }))
    expect(dry.debug).toMatchObject({ status: 'playing', cue: 'REVEAL_APPROACH', lastStinger: 'vesper-arrival', stingerCount: 1 })
    expect(assetsOpened).toBe(0)
    expect(context.sources).toHaveLength(0)
    expect(context.decoded).toHaveLength(0)

    let opened = 0
    const off = createMusicDirector({ mode: 'off', openHost: () => { opened += 1; return host }, scheduler: createManualScheduler() })
    off.unlockAndStart(snapshot())
    off.update(snapshot({ rivalPhase: 'warning' }))
    off.suspend()
    off.resume(snapshot())
    off.setEnabled(false, snapshot())
    off.reset()
    expect(opened).toBe(0)
    expect(off.debug).toMatchObject({ status: 'disabled', cue: 'SILENT', stingerCount: 0 })
  })

  it('combat releases when the reducers reach their terminal states', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart({ ...base, csStatus: 'tracking' })
    r.advance(4)
    r.director.update({ ...base, csStatus: 'resolved', acceptedOutcome: 'FAILURE', counterstrikeDamaged: true })
    r.advance(PHRASE_SECONDS + BAR_SECONDS)
    expect(r.director.debug.cue).toBe('ASCENDANT')
    expect(r.layer('assault').valueAt(r.context.currentTime)).toBe(0)
  })

  it('ducks the music bus for gameplay alerts: −4 dB, 20 ms attack, 0.4 s hold, 0.6 s release', () => {
    const r = rig()
    r.director.unlockAndStart(contested({ csStatus: 'tracking', firstStrikeStatus: 'COMPLETE' }))
    r.advance(3)
    const at = r.context.currentTime
    r.director.notifyAlert('target-lock')
    const bus = r.host.musicBus.gain
    expect(bus.valueAt(at)).toBeCloseTo(1, 6)
    expect(bus.valueAt(at + 0.02)).toBeCloseTo(g(-4), 6)
    expect(bus.valueAt(at + 0.42)).toBeCloseTo(g(-4), 6)
    expect(bus.valueAt(at + 1.02)).toBeCloseTo(1, 6)
  })
})

/** Holds every host.resume() promise until settle(): the context's resume() is asynchronous in a browser. */
function deferResumes(r: ReturnType<typeof rig>) {
  const pending: (() => void)[] = []
  const original = r.host.resume.bind(r.host)
  r.host.resume = (reason) => {
    const done = original(reason)
    return new Promise<void>((resolve) => pending.push(() => void done.then(resolve)))
  }
  return {
    get pending() {
      return pending.length
    },
    async settle() {
      for (const resolve of pending.splice(0)) resolve()
      await flushPromises()
    },
  }
}

function gainOf(r: ReturnType<typeof rig>, source: FakeBufferSource | undefined): FakeAudioParam | undefined {
  return (r.context.gains.find((node) => source?.connections.includes(node)) as { gain: FakeAudioParam } | undefined)?.gain
}

/** Every source that can still produce sound after `time`. */
function soundingAfter(r: ReturnType<typeof rig>, time: number): FakeBufferSource[] {
  return r.context.sources.filter((source) => {
    const stop = source.stops.at(-1)
    return stop === undefined || stop > Math.max(time, source.starts[0]?.when ?? 0)
  })
}

describe('music director: lifecycle races', () => {
  it('SOUND ON whose resume a hidden tab interrupts still unmutes when the tab returns', async () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    const resumes = deferResumes(r)
    r.director.setEnabled(false, base)
    r.advance(0.2)
    expect(r.host.musicBus.gain.valueAt(r.context.currentTime)).toBe(0)
    // The game moves on while the sound is off: Vesper answers, unheard.
    const later = { ...base, csStatus: 'command' as const }
    r.director.update(later)
    const sourcesBefore = r.context.sources.length

    r.director.setEnabled(true, later)
    expect(resumes.pending).toBe(1)
    r.director.suspend()
    // The interrupted SOUND ON resume lands late: stale, it must not start playback.
    await resumes.settle()
    expect(r.director.debug.status).toBe('suspended')

    r.director.resume(later)
    expect(r.director.debug.status).toBe('suspended')
    await resumes.settle()
    const on = r.context.currentTime
    expect(r.director.debug).toMatchObject({ status: 'playing', cue: 'CS_ALERT', stingerCount: 0 })
    expect(r.host.musicBus.gain.valueAt(on + 0.15)).toBeCloseTo(1, 6)
    expect(r.layer('assault').valueAt(on)).toBeCloseTo(g(-14), 6)
    // No new layer source, no replayed stinger.
    expect(r.context.sources).toHaveLength(sourcesBefore)
    expect(r.sourcesOf('vesper-retaliation')).toHaveLength(0)
    expect(soundingAfter(r, on)).toHaveLength(5)

    // The pending unmute was consumed: a later hidden round trip lands as a plain resume.
    r.director.update(later)
    r.director.suspend()
    r.director.resume(later)
    await resumes.settle()
    expect(r.context.sources).toHaveLength(sourcesBefore)
    expect(r.host.musicBus.gain.valueAt(r.context.currentTime + 1)).toBeCloseTo(1, 6)
  })

  it('SOUND ON pressed while hidden unmutes once the tab is visible', async () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.setEnabled(false, base)
    r.advance(0.2)
    r.director.suspend()
    r.director.setEnabled(true, base)
    await flushPromises()
    expect(r.director.debug.status).toBe('suspended')
    r.director.resume(base)
    await flushPromises()
    expect(r.director.debug.status).toBe('playing')
    expect(r.host.musicBus.gain.valueAt(r.context.currentTime + 0.15)).toBeCloseTo(1, 6)
  })

  it('NEW GAME then a quick BEGIN: a stinger that had not started never sounds in the new session', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.update({ ...base, csStatus: 'command' })
    const old = r.sourcesOf('vesper-retaliation')[0]
    const oldWhen = old?.starts[0]?.when ?? 0
    const resetAt = r.context.currentTime
    expect(oldWhen).toBeGreaterThan(resetAt)
    r.director.reset()
    // BEGIN again inside the 0.5 s reset fade, before the old stinger's start.
    r.advance(0.1)
    const beginAt = r.context.currentTime
    expect(beginAt).toBeLessThan(oldWhen)
    const before = r.context.sources.slice()
    r.director.unlockAndStart(snapshot())
    expect(r.director.debug).toMatchObject({ status: 'playing', cue: 'RECON', stingerCount: 0, lastStinger: null })
    expect(r.host.musicBus.gain.valueAt(beginAt)).toBe(1)
    // Stopped no later than its start: it never plays.
    expect(old?.stops.at(-1)).toBeLessThanOrEqual(oldWhen)
    expect(old?.stops.at(-1)).toBe(resetAt)
    // No source of the old session sounds past the new BEGIN.
    for (const source of before) expect(source.stops.at(-1)).toBeLessThanOrEqual(Math.max(beginAt, source.starts[0]?.when ?? 0))
    const fresh = r.context.sources.slice(before.length)
    expect(fresh).toHaveLength(5)
    expect(soundingAfter(r, beginAt)).toEqual(fresh)
  })

  it('NEW GAME fades a stinger that is already playing on its own gain, even under a quick BEGIN', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.update({ ...base, csStatus: 'command' })
    const playing = r.sourcesOf('vesper-retaliation')[0]
    r.advance(0.5)
    const resetAt = r.context.currentTime
    expect(playing?.starts[0]?.when).toBeLessThan(resetAt)
    const gain = gainOf(r, playing)
    const level = gain?.valueAt(resetAt) ?? 0
    expect(level).toBeGreaterThan(0)
    r.director.reset()
    expect(playing?.stops.at(-1)).toBeCloseTo(resetAt + 0.5, 6)
    expect(r.host.musicBus.gain.valueAt(resetAt + 0.5)).toBe(0)
    expect(gain?.valueAt(resetAt + 0.25)).toBeLessThan(level)
    expect(gain?.valueAt(resetAt + 0.5)).toBeCloseTo(0, 6)
    for (const id of LAYER_IDS) expect(r.sourcesOf(id)[0]?.stops.at(-1)).toBeCloseTo(resetAt + 0.5, 6)

    r.advance(0.1)
    const beginAt = r.context.currentTime
    r.director.unlockAndStart(snapshot())
    // The reopened bus cannot bring it back: it keeps fading on its own gain to the same stop.
    expect(playing?.stops.at(-1)).toBeCloseTo(resetAt + 0.5, 6)
    expect(gain?.valueAt(resetAt + 0.5)).toBeCloseTo(0, 6)
    // The old layers share the new session's layer gains: they stop as it begins.
    for (const id of LAYER_IDS) {
      expect(r.sourcesOf(id)).toHaveLength(2)
      expect(r.sourcesOf(id)[0]?.stops.at(-1)).toBe(beginAt)
    }
  })

  it('dispose during the NEW GAME fade cuts a stinger still fading on its own gain', () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    r.director.update({ ...base, csStatus: 'command' })
    const playing = r.sourcesOf('vesper-retaliation')[0]
    r.advance(0.5)
    const resetAt = r.context.currentTime
    const node = r.context.gains.find((gain) => playing?.connections.includes(gain))
    r.director.reset()
    // The ordinary reset fade is kept.
    expect(playing?.stops.at(-1)).toBeCloseTo(resetAt + 0.5, 6)
    r.advance(0.2)
    const disposeAt = r.context.currentTime
    r.director.dispose()
    expect(playing?.stops.at(-1)).toBe(disposeAt)
    expect(playing?.disconnected).toBe(true)
    expect(node?.disconnected).toBe(true)
    expect(soundingAfter(r, disposeAt)).toEqual([])
    expect(r.host.releases).toBe(1)
  })

  it('dispose stops every source, clears wakes, ignores later calls and pending resumes, and is idempotent', async () => {
    const r = rig()
    const base = contested({ firstStrikeStatus: 'COMPLETE', phase: 'landed' })
    r.director.unlockAndStart(base)
    r.advance(6)
    expect(r.scheduler.pending).not.toBeNull()
    r.director.update({ ...base, csStatus: 'command' })
    const resumes = deferResumes(r)
    r.director.setEnabled(false, base)
    r.director.setEnabled(true, base)
    const at = r.context.currentTime
    const sources = r.context.sources.length
    r.director.dispose()
    r.director.dispose()
    expect(r.director.disposed).toBe(true)
    expect(r.director.debug).toMatchObject({ status: 'stopped', cue: 'SILENT' })
    expect(soundingAfter(r, at)).toEqual([])
    expect(r.scheduler.pending).toBeNull()
    for (const id of LAYER_IDS) expect((r.context.gains[3 + LAYER_IDS.indexOf(id)] as { disconnected: boolean }).disconnected).toBe(true)
    // The shared buses stay connected; the context is not closed.
    expect(r.host.musicBus.disconnected).toBe(false)
    expect(r.context.state).not.toBe('closed')

    await resumes.settle()
    r.director.update({ ...base, csStatus: 'success' })
    r.director.unlockAndStart(base)
    r.director.notifyAlert('target-lock')
    r.director.suspend()
    r.director.resume(base)
    r.director.setEnabled(false, base)
    r.director.reset()
    r.assets.ready('bed', r.buffers.bed as FakeBuffer)
    await flushPromises()
    expect(r.context.sources).toHaveLength(sources)
    expect(r.director.debug.status).toBe('stopped')
    expect(r.scheduler.pending).toBeNull()
  })

  it('a second director on the same host after dispose plays exactly one set of loops', () => {
    const r = rig()
    r.director.unlockAndStart(snapshot())
    r.advance(4)
    r.director.dispose()
    const second = createMusicDirector({ mode: 'full', openHost: () => r.host, openAssets: () => r.assets, scheduler: r.scheduler })
    second.unlockAndStart(snapshot())
    const at = r.context.currentTime
    expect(second.debug.status).toBe('playing')
    const sounding = soundingAfter(r, at)
    expect(sounding).toHaveLength(5)
    expect(new Set(sounding.map((source) => source.buffer)).size).toBe(5)
    // RECON rotation keeps a wake pending: disposing clears it.
    expect(r.scheduler.pending).not.toBeNull()
    second.dispose()
    expect(r.scheduler.pending).toBeNull()
    expect(soundingAfter(r, at)).toEqual([])
  })
})
