/**
 * The `dry` sink (handoff 6.2): the full state machine and scheduling run
 * against inert nodes, with no network, no decoding and no sound. Its clock
 * follows performance.now(), so test fake clocks drive it, and it freezes
 * while suspended, as a real AudioContext's does.
 */
import type {
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioParamLike,
  GainNodeLike,
  SuspendReason,
} from '../audioTypes.ts'
import type { MusicHost } from './musicDirector.ts'

function nullParam(): AudioParamLike {
  const param: AudioParamLike = {
    value: 0,
    setValueAtTime: () => param,
    exponentialRampToValueAtTime: () => param,
    linearRampToValueAtTime: () => param,
    cancelScheduledValues: () => param,
  }
  return param
}

function nullGain(): GainNodeLike {
  return { gain: nullParam(), connect: () => undefined, disconnect: () => undefined }
}

function nullSource(): AudioBufferSourceNodeLike {
  return {
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    onended: null,
    start: () => undefined,
    stop: () => undefined,
    connect: () => undefined,
    disconnect: () => undefined,
  }
}

export function createNullAudioContext(performanceNow: () => number = () => performance.now(), sampleRate = 48_000): AudioContextLike {
  const origin = performanceNow()
  let pausedMs = 0
  let suspendedAt: number | null = null
  const seconds = () => ((suspendedAt ?? performanceNow()) - origin - pausedMs) / 1000
  return {
    get currentTime() {
      return seconds()
    },
    sampleRate,
    get state() {
      return suspendedAt === null ? 'running' : 'suspended'
    },
    createGain: nullGain,
    createBufferSource: nullSource,
    decodeAudioData: () => Promise.reject(new Error('dry mode never decodes')),
    getOutputTimestamp: () => ({ contextTime: seconds(), performanceTime: performanceNow() }),
    suspend() {
      suspendedAt ??= performanceNow()
      return Promise.resolve()
    },
    resume() {
      if (suspendedAt !== null) {
        pausedMs += performanceNow() - suspendedAt
        suspendedAt = null
      }
      return Promise.resolve()
    },
  }
}

export function createNullMusicHost(performanceNow?: () => number): MusicHost {
  const context = createNullAudioContext(performanceNow)
  const reasons = new Set<SuspendReason>()
  return {
    context,
    musicBus: context.createGain(),
    layersBus: context.createGain(),
    stingerBus: context.createGain(),
    suspend(reason) {
      reasons.add(reason)
      void context.suspend()
    },
    resume(reason) {
      reasons.delete(reason)
      return reasons.size === 0 ? context.resume() : Promise.resolve()
    },
  }
}
