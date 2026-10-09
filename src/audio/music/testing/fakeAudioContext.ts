/**
 * A recording AudioContext for the music tests. Params evaluate their
 * automation with Web Audio's event semantics (independently of GainLane), so
 * tests read back what was really scheduled: value at any time, source starts
 * and stops, suspends and resumes.
 */
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  SuspendReason,
} from '../../audioTypes.ts'
import type { AssetId } from '../musicConstants.ts'
import type { AssetState, MusicAssetSource, MusicHost, WakeScheduler } from '../musicDirector.ts'

interface ParamEvent {
  readonly kind: 'set' | 'exp' | 'lin'
  readonly time: number
  readonly value: number
}

export class FakeAudioParam implements AudioParamLike {
  value: number
  readonly calls: { readonly method: string; readonly value: number; readonly time: number }[] = []
  #events: ParamEvent[] = []

  constructor(value: number) {
    this.value = value
  }

  #insert(event: ParamEvent): this {
    let index = this.#events.length
    while (index > 0 && (this.#events[index - 1] as ParamEvent).time > event.time) index -= 1
    this.#events.splice(index, 0, event)
    return this
  }

  setValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'set', value, time })
    return this.#insert({ kind: 'set', time, value })
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) throw new RangeError('exponential ramp target must be positive')
    this.calls.push({ method: 'exp', value, time })
    return this.#insert({ kind: 'exp', time, value })
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'lin', value, time })
    return this.#insert({ kind: 'lin', time, value })
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ method: 'cancel', value: Number.NaN, time })
    this.#events = this.#events.filter((event) => event.time < time)
    return this
  }

  /** The automation value at `time`, per the Web Audio event rules. */
  valueAt(time: number): number {
    let previous: ParamEvent = { kind: 'set', time: -Infinity, value: this.value }
    for (const event of this.#events) {
      if (event.time <= time) {
        previous = event
        continue
      }
      if (event.kind === 'set') return previous.value
      const span = event.time - previous.time
      const progress = Number.isFinite(span) && span > 0 ? (time - previous.time) / span : 1
      if (event.kind === 'lin') return previous.value + (event.value - previous.value) * progress
      if (previous.value <= 0) return previous.value
      return previous.value * (event.value / previous.value) ** progress
    }
    return previous.value
  }
}

export class FakeNode implements AudioNodeLike {
  readonly connections: AudioNodeLike[] = []
  disconnected = false
  connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination)
    return destination
  }
  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeGainNode extends FakeNode implements GainNodeLike {
  readonly gain = new FakeAudioParam(1)
}

export class FakeBuffer implements AudioBufferLike {
  readonly duration: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly length: number
  constructor(duration: number, sampleRate = 48_000, numberOfChannels = 2) {
    this.duration = duration
    this.sampleRate = sampleRate
    this.numberOfChannels = numberOfChannels
    this.length = Math.round(duration * sampleRate)
  }
}

export class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  onended: ((event: Event) => void) | null = null
  readonly starts: { readonly when: number; readonly offset: number }[] = []
  readonly stops: number[] = []
  start(when = 0, offset = 0): void {
    if (this.starts.length > 0) throw new Error('InvalidStateError: start called twice')
    this.starts.push({ when, offset })
  }
  stop(when = 0): void {
    this.stops.push(when)
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0
  state = 'running'
  readonly gains: FakeGainNode[] = []
  readonly sources: FakeBufferSource[] = []
  readonly decoded: number[] = []
  suspendCalls = 0
  resumeCalls = 0
  /** When set, getOutputTimestamp() reports it. */
  outputTimestamp: { contextTime: number; performanceTime: number } | null = null
  readonly sampleRate: number

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode()
    this.gains.push(node)
    return node
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source
  }

  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decoded.push(data.byteLength)
    return Promise.resolve(new FakeBuffer(new DataView(data).getFloat64(0), this.sampleRate))
  }

  getOutputTimestamp(): { contextTime?: number; performanceTime?: number } {
    return this.outputTimestamp ?? {}
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1
    this.state = 'suspended'
    return Promise.resolve()
  }

  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }

  advance(seconds: number): void {
    if (this.state === 'running') this.currentTime += seconds
  }
}

export interface FakeHost extends MusicHost {
  readonly context: FakeAudioContext
  readonly musicBus: FakeGainNode
  readonly layersBus: FakeGainNode
  readonly stingerBus: FakeGainNode
  readonly suspendRequests: { readonly reason: SuspendReason; readonly afterSeconds: number }[]
  audible: boolean
}

/** Reason-based suspension like the engine's; delayed suspends apply at once here. */
export function createFakeHost(context = new FakeAudioContext()): FakeHost {
  const reasons = new Set<SuspendReason>()
  const host: FakeHost = {
    context,
    musicBus: context.createGain(),
    layersBus: context.createGain(),
    stingerBus: context.createGain(),
    suspendRequests: [],
    audible: false,
    suspend(reason, afterSeconds = 0) {
      host.suspendRequests.push({ reason, afterSeconds })
      reasons.add(reason)
      void context.suspend()
    },
    resume(reason) {
      reasons.delete(reason)
      return reasons.size === 0 ? context.resume() : Promise.resolve()
    },
    setMusicAudible(audible) {
      host.audible = audible
    },
  }
  return host
}

export interface FakeAssets extends MusicAssetSource {
  readonly requests: string[][]
  ready(id: AssetId, buffer: AudioBufferLike): void
  fail(id: AssetId): void
}

export function createFakeAssets(initial: Partial<Record<AssetId, AudioBufferLike>> = {}): FakeAssets {
  const buffers = new Map<AssetId, AudioBufferLike>(Object.entries(initial) as [AssetId, AudioBufferLike][])
  const failed = new Set<AssetId>()
  const listeners = new Set<(id: AssetId) => void>()
  const assets: FakeAssets = {
    requests: [],
    request(groups) {
      assets.requests.push([...groups])
    },
    buffer: (id) => buffers.get(id) ?? null,
    state: (id): AssetState => (buffers.has(id) ? 'ready' : failed.has(id) ? 'error' : 'pending'),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ready(id, buffer) {
      buffers.set(id, buffer)
      for (const listener of listeners) listener(id)
    },
    fail(id) {
      failed.add(id)
      for (const listener of listeners) listener(id)
    },
  }
  return assets
}

export interface ManualScheduler extends WakeScheduler {
  /** The pending wake, if any: delay in ms from when it was set. */
  readonly pending: { readonly callback: () => void; readonly delayMs: number } | null
  fire(): void
}

export function createManualScheduler(): ManualScheduler {
  let pending: { callback: () => void; delayMs: number; handle: number } | null = null
  let handles = 0
  return {
    get pending() {
      return pending
    },
    set(callback, delayMs) {
      handles += 1
      pending = { callback, delayMs, handle: handles }
      return handles
    },
    clear(handle) {
      if (pending?.handle === handle) pending = null
    },
    fire() {
      const current = pending
      pending = null
      current?.callback()
    },
  }
}

/** Lets resume()'s promise chain settle. */
export async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}
