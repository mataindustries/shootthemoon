import { describe, expect, it } from 'vitest'
import { bindDirectorLifetime, resolveMusicMode } from './useAdaptiveMusic.ts'
import { createMusicDirector, type MusicDirector } from './music/musicDirector.ts'
import { createFakeAssets, createFakeHost, createManualScheduler, FakeAudioContext, type FakeBufferSource } from './music/testing/fakeAudioContext.ts'
import { packageBuffers, snapshot } from './music/testing/musicFixtures.ts'

describe('music mode', () => {
  it('plays in full by default, dry inside the e2e harness, off for ?music=0', () => {
    expect(resolveMusicMode('', false, true)).toBe('full')
    expect(resolveMusicMode('?e2e', true, true)).toBe('dry')
    expect(resolveMusicMode('?e2e&music=full', true, true)).toBe('full')
    expect(resolveMusicMode('?music=0', false, true)).toBe('off')
    expect(resolveMusicMode('?e2e&music=0', true, true)).toBe('off')
    expect(resolveMusicMode('?music=off', false, true)).toBe('off')
    // ?e2e alone in an ordinary build is not the harness: the caller decides that.
    expect(resolveMusicMode('?e2e', false, true)).toBe('full')
    expect(resolveMusicMode('', false, false)).toBe('off')
    expect(resolveMusicMode('?e2e', true, false)).toBe('dry')
  })
})

/** One page: one shared context and host, a fresh director (and loader) per mount, as the hook builds them. */
function page() {
  const context = new FakeAudioContext()
  context.currentTime = 5
  const host = createFakeHost(context)
  const buffers = packageBuffers()
  const create = (): MusicDirector =>
    createMusicDirector({ mode: 'full', openHost: () => host, openAssets: () => createFakeAssets(buffers), scheduler: createManualScheduler() })
  /** Sources that can still sound from now on. */
  const sounding = (): FakeBufferSource[] =>
    context.sources.filter((source) => {
      const stop = source.stops.at(-1)
      return stop === undefined || stop > Math.max(context.currentTime, source.starts[0]?.when ?? 0)
    })
  return { context, create, sounding }
}

/** The hook's lifetime effect: `director` is the state value, `replace` its setter. */
function mount(create: () => MusicDirector) {
  let director = create()
  let cleanup: (() => void) | undefined
  const effect = () => {
    cleanup = bindDirectorLifetime(director, () => {
      director = create()
    })
  }
  return {
    get director() {
      return director
    },
    effect,
    cleanup: () => cleanup?.(),
  }
}

describe('adaptive music hook lifetime', () => {
  it('mount → BEGIN → unmount stops every source; a remount plays exactly one set of loops', () => {
    const p = page()
    const first = mount(p.create)
    first.effect()
    first.director.unlockAndStart(snapshot())
    expect(p.sounding()).toHaveLength(5)
    p.context.currentTime += 3
    first.cleanup()
    expect(first.director.disposed).toBe(true)
    expect(p.sounding()).toEqual([])

    const second = mount(p.create)
    second.effect()
    second.director.unlockAndStart(snapshot())
    expect(second.director.debug.status).toBe('playing')
    const sounding = p.sounding()
    expect(sounding).toHaveLength(5)
    expect(new Set(sounding.map((source) => source.buffer)).size).toBe(5)
    second.cleanup()
    expect(p.sounding()).toEqual([])
  })

  it('a StrictMode effect replay swaps in a fresh director instead of reviving the disposed one', () => {
    const p = page()
    const hook = mount(p.create)
    const original = hook.director
    hook.effect()
    // StrictMode: cleanup, then the same effect again with the same state.
    hook.cleanup()
    hook.effect()
    expect(original.disposed).toBe(true)
    const replacement = hook.director
    expect(replacement).not.toBe(original)
    // The re-render with the new state runs the effect for it.
    hook.effect()
    expect(replacement.disposed).toBe(false)
    hook.director.unlockAndStart(snapshot())
    expect(hook.director.debug.status).toBe('playing')
    expect(p.sounding()).toHaveLength(5)
    // A later BEGIN on the disposed one does nothing.
    original.unlockAndStart(snapshot())
    expect(p.sounding()).toHaveLength(5)
    hook.cleanup()
    expect(p.sounding()).toEqual([])
  })
})
