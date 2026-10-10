/**
 * Teardown ownership on the production host: every music director owns its
 * own suspension and audible claims on the shared engine, and dispose releases
 * only those.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineMusicHost, isMusicAudible, releaseAudioSuspend, requestAudioSuspend, resetAudioEngineForTests } from './audioEngine.ts'
import { SOUND_OFF_FADE_SECONDS } from './music/musicConstants.ts'
import { createMusicDirector } from './music/musicDirector.ts'
import { createFakeAssets, createManualScheduler, FakeAudioContext, FakeNode, flushPromises } from './music/testing/fakeAudioContext.ts'
import { packageBuffers, snapshot } from './music/testing/musicFixtures.ts'

class EngineContext extends FakeAudioContext {
  static instances: EngineContext[] = []
  readonly destination = new FakeNode()
  constructor() {
    super()
    this.currentTime = 10
    EngineContext.instances.push(this)
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    })
  }
}

function context(): EngineContext {
  return EngineContext.instances[0] as EngineContext
}

function director() {
  const assets = createFakeAssets(packageBuffers(48_000))
  return createMusicDirector({
    mode: 'full',
    openHost: createEngineMusicHost,
    openAssets: () => assets,
    scheduler: createManualScheduler(),
  })
}

function loopsSounding(): number {
  return context().sources.filter((source) => source.loop && source.stops.length === 0).length
}

beforeEach(() => {
  EngineContext.instances = []
  vi.stubGlobal('AudioContext', EngineContext)
  vi.useFakeTimers()
})

afterEach(() => {
  resetAudioEngineForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('music director ownership on the shared engine', () => {
  it('SOUND OFF completed, dispose, remount with SOUND on: BEGIN plays on a running context', async () => {
    const first = director()
    first.unlockAndStart(snapshot())
    first.setEnabled(false, snapshot())
    vi.advanceTimersByTime(SOUND_OFF_FADE_SECONDS * 1000)
    expect(context().state).toBe('suspended')
    first.dispose()
    await flushPromises()

    const second = director()
    second.unlockAndStart(snapshot())
    await flushPromises()
    expect(second.debug.status).toBe('playing')
    expect(context().state).toBe('running')
    expect(context().state).not.toBe('closed')
    expect(EngineContext.instances).toHaveLength(1)
    second.dispose()
  })

  it('a delayed SOUND OFF suspend pending at dispose cannot suspend the next director', async () => {
    const first = director()
    first.unlockAndStart(snapshot())
    first.setEnabled(false, snapshot())
    expect(context().state).toBe('running')
    first.dispose()

    const second = director()
    second.unlockAndStart(snapshot())
    vi.advanceTimersByTime(SOUND_OFF_FADE_SECONDS * 1000 * 4)
    await flushPromises()
    expect(second.debug.status).toBe('playing')
    expect(context().state).toBe('running')
    expect(context().suspendCalls).toBe(0)
    second.dispose()
  })

  it('disposing one director neither resumes nor suspends for another', async () => {
    const a = director()
    const b = director()
    a.unlockAndStart(snapshot())
    b.unlockAndStart(snapshot())
    // B is hidden-suspended; A is not.
    b.suspend()
    expect(context().state).toBe('suspended')
    const resumes = context().resumeCalls
    a.dispose()
    await flushPromises()
    // A held nothing: B's claim keeps the context suspended.
    expect(context().resumeCalls).toBe(resumes)
    expect(context().state).toBe('suspended')
    expect(b.debug.status).toBe('suspended')
    b.resume(snapshot())
    await flushPromises()
    expect(b.debug.status).toBe('playing')
    expect(context().state).toBe('running')

    // Now the other way round: C holds SOUND OFF, B plays; disposing C frees the context for B.
    const c = director()
    c.unlockAndStart(snapshot())
    c.setEnabled(false, snapshot())
    vi.advanceTimersByTime(SOUND_OFF_FADE_SECONDS * 1000)
    expect(context().state).toBe('suspended')
    const suspends = context().suspendCalls
    c.dispose()
    await flushPromises()
    expect(context().state).toBe('running')
    expect(b.debug.status).toBe('playing')
    expect(context().suspendCalls).toBe(suspends)
    b.dispose()
  })

  it('dispose never drops a claim the SFX layer or another director still holds', async () => {
    const a = director()
    a.unlockAndStart(snapshot())
    requestAudioSuspend('sound-off')
    a.dispose()
    await flushPromises()
    expect(context().state).toBe('suspended')
    await releaseAudioSuspend('sound-off')
    expect(context().state).toBe('running')
  })

  it('keeps music audible while any director plays; only the last dispose clears it', () => {
    const a = director()
    const b = director()
    a.unlockAndStart(snapshot())
    b.unlockAndStart(snapshot())
    expect(a.debug.status).toBe('playing')
    expect(b.debug.status).toBe('playing')
    expect(loopsSounding()).toBe(10)
    expect(isMusicAudible()).toBe(true)
    a.dispose()
    expect(loopsSounding()).toBe(5)
    expect(b.debug.status).toBe('playing')
    expect(isMusicAudible()).toBe(true)
    b.dispose()
    expect(loopsSounding()).toBe(0)
    expect(isMusicAudible()).toBe(false)
  })
})
