import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SFX_BUS_GAIN,
  SFX_REFERENCE_GAIN,
  SFX_RELEVEL_DB,
  createEngineMusicHost,
  emitAudioAlert,
  ensureAudioEngine,
  getAudioEngine,
  isMusicAudible,
  onAudioAlert,
  releaseAudioSuspend,
  requestAudioSuspend,
  resetAudioEngineForTests,
} from './audioEngine.ts'
import { FakeAudioParam, FakeGainNode, FakeNode } from './music/testing/fakeAudioContext.ts'

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeAudioParam(-24)
  readonly knee = new FakeAudioParam(30)
  readonly ratio = new FakeAudioParam(12)
  readonly attack = new FakeAudioParam(0.003)
  readonly release = new FakeAudioParam(0.25)
}

class EngineContext {
  static instances: EngineContext[] = []
  state = 'running'
  currentTime = 0
  readonly destination = new FakeNode()
  suspendCalls = 0
  resumeCalls = 0
  closeCalls = 0
  constructor() {
    EngineContext.instances.push(this)
  }
  createGain() {
    return new FakeGainNode()
  }
  createDynamicsCompressor() {
    return new FakeCompressor()
  }
  suspend() {
    this.suspendCalls += 1
    this.state = 'suspended'
    return Promise.resolve()
  }
  resume() {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.closeCalls += 1
    return Promise.resolve()
  }
}

beforeEach(() => {
  EngineContext.instances = []
  vi.stubGlobal('AudioContext', EngineContext)
})

afterEach(() => {
  resetAudioEngineForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared audio engine', () => {
  it('creates nothing until asked, then exactly one context for SFX and music', () => {
    expect(getAudioEngine()).toBeNull()
    expect(EngineContext.instances).toHaveLength(0)
    const engine = ensureAudioEngine()
    expect(ensureAudioEngine()).toBe(engine)
    expect(createEngineMusicHost()?.context).toBe(engine?.context)
    expect(EngineContext.instances).toHaveLength(1)
  })

  it('builds masterGain (−0.6 dB) → limiter → destination with the SFX and music buses', () => {
    const engine = ensureAudioEngine()!
    const context = engine.context as unknown as EngineContext
    const node = (value: unknown) => value as FakeNode
    expect((engine.master.gain as unknown as FakeAudioParam).value).toBeCloseTo(10 ** (-0.6 / 20), 9)
    expect(node(engine.master).connections).toEqual([engine.limiter])
    expect(node(engine.limiter).connections).toEqual([context.destination])
    const limiter = engine.limiter as unknown as FakeCompressor
    expect([limiter.threshold.value, limiter.knee.value, limiter.ratio.value, limiter.attack.value, limiter.release.value]).toEqual([-1, 0, 20, 0.003, 0.25])
    expect(node(engine.sfxBus).connections).toEqual([engine.master])
    expect(node(engine.musicBus).connections).toEqual([engine.master])
    expect(node(engine.layersBus).connections).toEqual([engine.musicBus])
    expect(node(engine.stingerBus).connections).toEqual([engine.musicBus])
    expect((engine.sfxBus.gain as unknown as FakeAudioParam).value).toBeCloseTo(SFX_BUS_GAIN, 9)
    expect(SFX_BUS_GAIN).toBeCloseTo(SFX_REFERENCE_GAIN * 10 ** (SFX_RELEVEL_DB / 20), 9)
  })

  it('suspends for each reason and resumes only once none holds it; never closes', async () => {
    vi.useFakeTimers()
    const context = ensureAudioEngine()!.context as unknown as EngineContext
    requestAudioSuspend('hidden')
    expect(context.suspendCalls).toBe(1)
    requestAudioSuspend('sound-off', 0.15)
    expect(context.suspendCalls).toBe(1)
    vi.advanceTimersByTime(150)
    expect(context.suspendCalls).toBe(2)
    await releaseAudioSuspend('hidden')
    expect(context.resumeCalls).toBe(0)
    // A gesture or a cue never resumes a context held for a reason.
    ensureAudioEngine()
    expect(context.resumeCalls).toBe(0)
    await releaseAudioSuspend('sound-off')
    expect(context.resumeCalls).toBe(1)
    expect(context.closeCalls).toBe(0)
  })

  it('cancels a delayed SOUND OFF suspend when SOUND comes back first', async () => {
    vi.useFakeTimers()
    const context = ensureAudioEngine()!.context as unknown as EngineContext
    requestAudioSuspend('sound-off', 0.15)
    await releaseAudioSuspend('sound-off')
    vi.advanceTimersByTime(500)
    expect(context.suspendCalls).toBe(0)
  })

  it('resumes a context the browser suspended on the next use', () => {
    const context = ensureAudioEngine()!.context as unknown as EngineContext
    context.state = 'suspended'
    ensureAudioEngine()
    expect(context.resumeCalls).toBe(1)
  })

  it('relays gameplay alerts and the music-audible flag', () => {
    const heard: string[] = []
    const unsubscribe = onAudioAlert((cue) => heard.push(cue))
    emitAudioAlert('fire-window')
    unsubscribe()
    emitAudioAlert('target-lock')
    expect(heard).toEqual(['fire-window'])
    const host = createEngineMusicHost()!
    expect(isMusicAudible()).toBe(false)
    host.setMusicAudible?.(true)
    expect(isMusicAudible()).toBe(true)
  })

  it('is unavailable without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(ensureAudioEngine()).toBeNull()
    expect(createEngineMusicHost()).toBeNull()
  })
})
