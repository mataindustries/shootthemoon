import { describe, expect, it } from 'vitest'
import { COUNTERSTRIKE_CONTACT_MS } from './musicConstants.ts'
import { createMusicDirector } from './musicDirector.ts'
import { deriveMusicEvents, type MusicEvent, type MusicSnapshot } from './musicState.ts'
import { createFakeAssets, createFakeHost, createManualScheduler, FakeAudioContext } from './testing/fakeAudioContext.ts'
import { monument, outpost, packageBuffers, siege, snapshot } from './testing/musicFixtures.ts'

const base = snapshot({ outpost: outpost(), rivalRevealStatus: 'REVEALED', firstStrikeStatus: 'COMPLETE', phase: 'landed' })
const withSiege = (status: Parameters<typeof siege>[0], overrides: Partial<MusicSnapshot> = {}) =>
  ({ ...base, outpost: outpost({ siege: siege(status) }), ...overrides })
const withMonument = (status: Parameters<typeof monument>[0], waves = 0, overrides: Partial<MusicSnapshot> = {}) =>
  ({ ...base, monumentView: true, outpost: outpost({ monument: monument(status, { wavesResolved: waves }) }), ...overrides })

const beat = (id: string, gainDb = 0) => ({ kind: 'stinger', id, timing: 'beat', gainDb })

describe('music events (handoff 4.1)', () => {
  const edges: [string, MusicSnapshot, MusicSnapshot, MusicEvent[]][] = [
    ['rival warning', { ...base, rivalPhase: 'idle' }, { ...base, rivalPhase: 'warning' }, [beat('vesper-arrival') as MusicEvent]],
    ['strike arming', { ...base, strikePhase: 'idle' }, { ...base, strikePhase: 'arming' }, [{ kind: 'first-strike' }]],
    ['counterstrike command from dormant', { ...base, csStatus: 'dormant' }, { ...base, csStatus: 'command' }, [beat('vesper-retaliation') as MusicEvent]],
    ['counterstrike command from resolved (replay)', { ...base, csStatus: 'resolved' }, { ...base, csStatus: 'command' }, [beat('vesper-retaliation') as MusicEvent]],
    ['counterstrike success', { ...base, csStatus: 'interceptor-launched' }, { ...base, csStatus: 'success' }, [beat('outcome-hold') as MusicEvent]],
    [
      'counterstrike impact',
      { ...base, csStatus: 'missed' },
      { ...base, csStatus: 'impact', csPhaseStartedAtMs: 7_000 },
      [{ kind: 'stinger', id: 'outcome-breach', timing: 'exact', gainDb: 0, syncPerfMs: 7_000 + COUNTERSTRIKE_CONTACT_MS }],
    ],
    ['siege command while advancing', withSiege('constructing'), withSiege('command'), [beat('divider-contact') as MusicEvent]],
    ['siege defense window 1', withSiege('waves'), withSiege('waves', { platformDefenseWave: 0 }), [beat('divider-contact', 0) as MusicEvent]],
    ['siege defense window 2', withSiege('waves'), withSiege('waves', { platformDefenseWave: 1 }), [beat('divider-contact', 1) as MusicEvent]],
    ['siege defense window 3', withSiege('waves', { platformDefenseWave: 1 }), withSiege('waves', { platformDefenseWave: 2 }), [beat('divider-contact', 2) as MusicEvent]],
    ['siege waves → operational', withSiege('waves'), withSiege('operational'), [beat('outcome-hold') as MusicEvent]],
    ['siege repairing → operational', withSiege('repairing'), withSiege('operational'), [beat('outcome-hold') as MusicEvent]],
    ['siege waves → damaged', withSiege('waves'), withSiege('damaged'), [{ kind: 'stinger', id: 'outcome-breach', timing: 'immediate', gainDb: 0 }]],
    ['monument command before wave 1', withMonument('constructing'), withMonument('command'), [beat('divider-contact') as MusicEvent]],
    ['monument wave 1', withMonument('command', 0), withMonument('wave', 0), [beat('divider-contact', 0) as MusicEvent]],
    ['monument wave 3', withMonument('command', 2), withMonument('wave', 2), [beat('divider-contact', 2) as MusicEvent]],
    ['monument wave → activating', withMonument('wave', 2), withMonument('activating', 3), [beat('outcome-hold') as MusicEvent]],
    ['monument wave → damaged', withMonument('wave', 2), withMonument('damaged', 3), [{ kind: 'stinger', id: 'outcome-breach', timing: 'immediate', gainDb: 0 }]],
    [
      'monument reveal',
      withMonument('complete', 3),
      withMonument('complete', 3, { monumentRevealAtMs: 12_345 }),
      [{ kind: 'stinger', id: 'territory-claimed', timing: 'exact', gainDb: 0, syncPerfMs: 12_345 }],
    ],
  ]

  it.each(edges)('%s fires exactly once', (_name, prev, next, expected) => {
    expect(deriveMusicEvents(prev, next)).toEqual(expected)
    expect(deriveMusicEvents(next, next)).toEqual([])
    expect(deriveMusicEvents(next, { ...next })).toEqual([])
  })

  it('fires nothing for edges the table does not list', () => {
    expect(deriveMusicEvents(withSiege('command', { phase: 'orbit' }), withSiege('command', { phase: 'landed' }))).toEqual([])
    expect(deriveMusicEvents(withSiege('constructing', { phase: 'orbit' }), withSiege('command', { phase: 'orbit' }))).toEqual([])
    expect(deriveMusicEvents(withMonument('wave', 0), withMonument('command', 1))).toEqual([])
    expect(deriveMusicEvents(withMonument('constructing', 0, { monumentView: false }), withMonument('command', 0, { monumentView: false }))).toEqual([])
    expect(deriveMusicEvents({ ...base, rivalPhase: 'warning' }, { ...base, rivalPhase: 'orbital-transition' })).toEqual([])
    expect(deriveMusicEvents({ ...base, strikePhase: 'arming' }, { ...base, strikePhase: 'launch' })).toEqual([])
    expect(deriveMusicEvents(withMonument('complete', 3, { monumentRevealAtMs: 1 }), withMonument('complete', 3, { monumentRevealAtMs: 2 }))).toEqual([])
  })

  it('fires again on replays', () => {
    const review = deriveMusicEvents({ ...base, rivalPhase: 'contested' }, { ...base, rivalPhase: 'warning' })
    expect(review).toEqual([beat('vesper-arrival')])
    expect(deriveMusicEvents({ ...base, strikePhase: 'ending' }, { ...base, strikePhase: 'arming' })).toEqual([{ kind: 'first-strike' }])
    expect(deriveMusicEvents(withSiege('operational'), withSiege('command'))).toEqual([beat('divider-contact')])
    expect(deriveMusicEvents(withMonument('complete', 3), withMonument('complete', 3, { monumentRevealAtMs: 9 }))).toHaveLength(1)
  })
})

describe('music events through the director', () => {
  function rig() {
    const context = new FakeAudioContext()
    context.currentTime = 5
    let perfNow = 10_000
    const director = createMusicDirector({
      mode: 'full',
      openHost: () => createFakeHost(context),
      openAssets: () => createFakeAssets(packageBuffers()),
      performanceNow: () => perfNow,
      scheduler: createManualScheduler(),
    })
    return {
      context,
      director,
      advance(seconds: number) {
        context.currentTime += seconds
        perfNow += seconds * 1000
      },
    }
  }

  it('takes the first snapshot as a baseline: restoring a CLAIMED save fires nothing', () => {
    const r = rig()
    const claimed = withMonument('complete', 3, { monumentView: false })
    r.director.unlockAndStart(claimed)
    r.director.update(claimed)
    r.director.update({ ...claimed })
    expect(r.director.debug).toMatchObject({ arc: 'CLAIMED', cue: 'CLAIMED', stingerCount: 0, lastStinger: null })
    // Even a restored session that comes back mid-reveal or mid-impact replays nothing.
    const midReveal = rig()
    midReveal.director.unlockAndStart(withMonument('complete', 3, { monumentRevealAtMs: 9_000 }))
    midReveal.director.update(withMonument('complete', 3, { monumentRevealAtMs: 9_000 }))
    expect(midReveal.director.debug.stingerCount).toBe(0)
    const midImpact = rig()
    midImpact.director.unlockAndStart({ ...base, csStatus: 'impact', csPhaseStartedAtMs: 9_500 })
    expect(midImpact.director.debug.stingerCount).toBe(0)
  })

  it('fires each live edge once, even when the same snapshot arrives again', () => {
    const r = rig()
    r.director.unlockAndStart(base)
    r.advance(3)
    const command = { ...base, csStatus: 'command' as const }
    r.director.update(command)
    r.director.update(command)
    r.director.update({ ...command })
    expect(r.director.debug).toMatchObject({ lastStinger: 'vesper-retaliation', stingerCount: 1 })
  })

  it('reset clears pending events', () => {
    const r = rig()
    r.director.unlockAndStart(base)
    r.advance(3)
    r.director.update({ ...base, csStatus: 'impact', csPhaseStartedAtMs: 13_000 })
    const breach = r.context.sources.at(-1)
    expect(breach?.starts[0]?.when).toBeGreaterThan(r.context.currentTime + 1)
    r.director.reset()
    expect(breach?.stops.at(-1)).toBeLessThan(breach?.starts[0]?.when ?? 0)
    expect(r.director.debug).toMatchObject({ status: 'stopped', stingerCount: 0, lastStinger: null })
    r.director.update({ ...base, csStatus: 'impact', csPhaseStartedAtMs: 13_000 })
    expect(r.director.debug.stingerCount).toBe(0)
  })
})
