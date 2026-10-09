/**
 * The slice of the Web Audio API the music director drives. A real
 * AudioContext satisfies it structurally; so do the dry-mode null sink and the
 * recording fake used by the tests.
 */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface AudioBufferLike {
  readonly duration: number
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  loopStart: number
  loopEnd: number
  onended: ((event: Event) => void) | null
  start(when?: number, offset?: number): void
  stop(when?: number): void
}

export interface AudioTimestampLike {
  readonly contextTime?: number
  readonly performanceTime?: number
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: string
  createGain(): GainNodeLike
  createBufferSource(): AudioBufferSourceNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
  getOutputTimestamp?(): AudioTimestampLike
  suspend(): Promise<void>
  resume(): Promise<void>
}

export type SuspendReason = 'hidden' | 'sound-off'
