import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SFX_BUS_GAIN,
  audioContextConstructor,
  emitAudioAlert,
  ensureAudioEngine,
  getAudioEngine,
  isMusicAudible,
  releaseAudioSuspend,
  requestAudioSuspend,
  type AudioEngine,
} from './audioEngine.ts'
import { SOUND_OFF_FADE_SECONDS, dbToGain, type AlertCue } from './music/musicConstants.ts'

export type CinematicSoundCue =
  | 'enter'
  | 'ui-confirm'
  | 'ui-cancel'
  | 'capsule'
  | 'miner'
  | 'drill'
  | 'rival'
  | 'scan'
  | 'arm'
  | 'ignition'
  | 'flight'
  | 'impact'
  | 'complete'
  | 'threat-warning'
  | 'target-lock'
  | 'fire-window'
  | 'interceptor-launch'
  | 'near-miss'
  | 'orbital-interception'
  | 'structural-impact'

/** The SFX voices of the shared engine; they play into its sfxBus. */
export interface AudioGraph {
  readonly context: AudioContext
  readonly output: GainNode
  readonly activeVoices: Set<ActiveVoice>
  noiseBuffer: AudioBuffer | null
  /** Per-cue level trim while one cue is being voiced. */
  volumeScale?: number
}

interface ActiveVoice {
  readonly source: AudioScheduledSourceNode
  readonly nodes: readonly AudioNode[]
}

interface CinematicAudioController {
  readonly available: boolean
  readonly enabled: boolean
  readonly unlock: () => void
  /** Flips SOUND ON / OFF and returns the new state. */
  readonly toggle: () => boolean
  readonly play: (cue: CinematicSoundCue) => void
  readonly stopAll: () => void
  readonly reset: () => void
}

/** Gameplay-critical alerts duck the music bus (handoff section 5). */
const ALERT_CUES: ReadonlySet<CinematicSoundCue> = new Set<AlertCue>(['threat-warning', 'target-lock', 'fire-window'])

function graphFor(engine: AudioEngine, current: AudioGraph | null): AudioGraph {
  if (current?.context === engine.context) return current
  return { context: engine.context, output: engine.sfxBus, activeVoices: new Set(), noiseBuffer: null }
}

function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect()
  } catch {
    // A voice may already have been disconnected by its onended callback.
  }
}

function releaseVoice(graph: AudioGraph, voice: ActiveVoice): void {
  if (!graph.activeVoices.delete(voice)) return

  voice.source.onended = null
  voice.nodes.forEach(disconnectNode)
}

function trackVoice(
  graph: AudioGraph,
  source: AudioScheduledSourceNode,
  nodes: readonly AudioNode[],
): ActiveVoice {
  const voice = { source, nodes }
  graph.activeVoices.add(voice)
  source.onended = () => releaseVoice(graph, voice)
  return voice
}

function stopAllVoices(graph: AudioGraph): void {
  Array.from(graph.activeVoices).forEach((voice) => {
    try {
      voice.source.stop()
    } catch {
      // A source that ended between snapshotting and stopping is already safe.
    }

    releaseVoice(graph, voice)
  })
}

function getNoiseBuffer(graph: AudioGraph): AudioBuffer {
  if (graph.noiseBuffer !== null) return graph.noiseBuffer

  const length = Math.ceil(graph.context.sampleRate * 1.25)
  const buffer = graph.context.createBuffer(1, length, graph.context.sampleRate)
  const values = buffer.getChannelData(0)
  let randomState = 0x51a7c4a3

  for (let index = 0; index < values.length; index += 1) {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    values[index] = (randomState / 0x1_0000_0000) * 2 - 1
  }

  graph.noiseBuffer = buffer
  return buffer
}

function tone(
  graph: AudioGraph,
  frequency: number,
  durationSeconds: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency = frequency,
  delaySeconds = 0,
): void {
  const now = graph.context.currentTime + delaySeconds
  const oscillator = graph.context.createOscillator()
  const gain = graph.context.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, now)
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, endFrequency),
    now + durationSeconds,
  )
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(volume * (graph.volumeScale ?? 1), now + 0.018)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
  oscillator.connect(gain)
  gain.connect(graph.output)
  const voice = trackVoice(graph, oscillator, [oscillator, gain])

  try {
    oscillator.start(now)
    oscillator.stop(now + durationSeconds + 0.02)
  } catch {
    releaseVoice(graph, voice)
  }
}

function noise(
  graph: AudioGraph,
  durationSeconds: number,
  volume: number,
  frequency: number,
  delaySeconds = 0,
): void {
  const now = graph.context.currentTime + delaySeconds
  const source = graph.context.createBufferSource()
  const filter = graph.context.createBiquadFilter()
  const gain = graph.context.createGain()
  source.buffer = getNoiseBuffer(graph)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(frequency, now)
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(80, frequency * 0.34),
    now + durationSeconds,
  )
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(volume * (graph.volumeScale ?? 1), now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(graph.output)
  const voice = trackVoice(graph, source, [source, filter, gain])

  try {
    source.start(now)
    source.stop(now + Math.min(durationSeconds, 1.24))
  } catch {
    releaseVoice(graph, voice)
  }
}

/**
 * While the adaptive score is audible, `rival` speaks Vesper's E♭→D collapse
 * instead of E-glides that clash with her motif, and `impact` leaves the sub
 * to the first-strike stinger (bible section 14).
 */
export function playCue(graph: AudioGraph, cue: CinematicSoundCue, musicAudible: boolean): void {
  graph.volumeScale = musicAudible ? dbToGain(MUSIC_CUE_TRIM_DB[cue] ?? 0) : 1
  try {
    voiceCue(graph, cue, musicAudible)
  } finally {
    graph.volumeScale = 1
  }
}

/**
 * Measured against the score's short-term level at each moment (acceptance G:
 * impact and alert peaks ≥ 6 dB above the music, alert duck included). The
 * bus re-level alone leaves these alert tones and the strike impact short.
 */
export const MUSIC_CUE_TRIM_DB: Readonly<Partial<Record<CinematicSoundCue, number>>> = Object.freeze({
  'threat-warning': 1,
  'target-lock': 9,
  'fire-window': 6,
  impact: 3,
})

function voiceCue(graph: AudioGraph, cue: CinematicSoundCue, musicAudible: boolean): void {
  switch (cue) {
    case 'enter':
      tone(graph, 52, 0.7, 0.3, 'sine', 72)
      tone(graph, 104, 0.48, 0.11, 'triangle', 118, 0.08)
      break
    case 'ui-confirm':
      tone(graph, 290, 0.09, 0.12, 'triangle', 430)
      break
    case 'ui-cancel':
      tone(graph, 180, 0.11, 0.09, 'sine', 118)
      break
    case 'capsule':
      tone(graph, 64, 0.38, 0.22, 'sawtooth', 48)
      noise(graph, 0.28, 0.08, 620)
      break
    case 'miner':
      tone(graph, 118, 0.22, 0.12, 'square', 96)
      tone(graph, 236, 0.1, 0.06, 'triangle', 280, 0.08)
      break
    case 'drill':
      noise(graph, 0.42, 0.16, 1_100)
      tone(graph, 76, 0.38, 0.13, 'sawtooth', 66)
      break
    case 'rival':
      if (musicAudible) {
        tone(graph, 311.13, 0.34, 0.1, 'triangle', 293.66)
        tone(graph, 622.25, 0.18, 0.055, 'sine', 587.33, 0.11)
      } else {
        tone(graph, 330, 0.34, 0.1, 'triangle', 284)
        tone(graph, 660, 0.18, 0.055, 'sine', 570, 0.11)
      }
      break
    case 'scan':
      tone(graph, 210, 0.62, 0.09, 'sine', 880)
      break
    case 'arm':
      tone(graph, 48, 0.78, 0.27, 'sawtooth', 61)
      tone(graph, 96, 0.42, 0.09, 'triangle', 122, 0.16)
      break
    case 'ignition':
      noise(graph, 1.08, 0.34, 1_450)
      tone(graph, 42, 1.12, 0.35, 'sawtooth', 86)
      break
    case 'flight':
      tone(graph, 72, 0.52, 0.16, 'triangle', 92)
      break
    case 'impact':
      noise(graph, 1.18, 0.42, 1_900)
      if (!musicAudible) tone(graph, 36, 1.05, 0.48, 'sine', 28)
      tone(graph, 82, 0.44, 0.16, 'square', 44)
      break
    case 'complete':
      tone(graph, 55, 0.9, 0.24, 'sine', 82)
      tone(graph, 110, 0.7, 0.1, 'triangle', 164, 0.16)
      break
    case 'threat-warning':
      tone(graph, 148, 0.2, 0.16, 'square', 116)
      tone(graph, 148, 0.2, 0.14, 'square', 116, 0.34)
      noise(graph, 0.7, 0.045, 920)
      break
    case 'target-lock':
      tone(graph, 240, 0.42, 0.09, 'triangle', 620)
      tone(graph, 620, 0.12, 0.075, 'sine', 760, 0.4)
      break
    case 'fire-window':
      tone(graph, 430, 0.12, 0.1, 'triangle', 610)
      tone(graph, 540, 0.12, 0.11, 'triangle', 760, 0.18)
      tone(graph, 680, 0.18, 0.12, 'sine', 920, 0.36)
      break
    case 'interceptor-launch':
      noise(graph, 0.62, 0.2, 1_750)
      tone(graph, 84, 0.66, 0.24, 'sawtooth', 172)
      break
    case 'near-miss':
      tone(graph, 410, 0.24, 0.1, 'triangle', 172)
      noise(graph, 0.25, 0.055, 1_200, 0.08)
      break
    case 'orbital-interception':
      noise(graph, 0.72, 0.27, 2_200)
      tone(graph, 96, 0.82, 0.28, 'sine', 58)
      tone(graph, 720, 0.28, 0.08, 'triangle', 310, 0.04)
      break
    case 'structural-impact':
      noise(graph, 0.96, 0.32, 1_300)
      tone(graph, 34, 1.08, 0.38, 'sine', 24)
      tone(graph, 124, 0.32, 0.11, 'square', 66, 0.05)
      break
  }
}

export function useCinematicAudio(): CinematicAudioController {
  const graphRef = useRef<AudioGraph | null>(null)
  const [enabled, setEnabled] = useState(true)
  const enabledRef = useRef(true)
  const available = audioContextConstructor() !== null

  const ensureGraph = useCallback((): AudioGraph | null => {
    const engine = ensureAudioEngine()
    if (engine === null) return null
    graphRef.current = graphFor(engine, graphRef.current)
    return graphRef.current
  }, [])

  const unlock = useCallback(() => {
    if (!enabled) return
    ensureGraph()
  }, [enabled, ensureGraph])

  const play = useCallback(
    (cue: CinematicSoundCue) => {
      if (!enabled) return
      const graph = ensureGraph()
      if (graph !== null) {
        try {
          playCue(graph, cue, isMusicAudible())
        } catch {
          stopAllVoices(graph)
        }
        if (ALERT_CUES.has(cue)) emitAudioAlert(cue as AlertCue)
      }
    },
    [enabled, ensureGraph],
  )

  const stopAll = useCallback(() => {
    const graph = graphRef.current
    if (graph !== null) stopAllVoices(graph)
  }, [])

  // NEW GAME stops every voice but keeps the shared context (and the music's decoded buffers).
  const reset = useCallback(() => {
    const graph = graphRef.current
    if (graph !== null) stopAllVoices(graph)
  }, [])

  const toggle = useCallback((): boolean => {
    const next = !enabledRef.current
    enabledRef.current = next
    setEnabled(next)

    if (next) {
      void releaseAudioSuspend('sound-off')
      const engine = ensureAudioEngine()
      engine?.sfxBus.gain.setValueAtTime(SFX_BUS_GAIN, engine.context.currentTime)
    } else {
      const graph = graphRef.current
      if (graph !== null) stopAllVoices(graph)
      const engine = getAudioEngine()
      engine?.sfxBus.gain.setValueAtTime(0, engine.context.currentTime)
      // The music bus fades out over this time before the shared context suspends.
      requestAudioSuspend('sound-off', SOUND_OFF_FADE_SECONDS)
    }
    return next
  }, [])

  useEffect(() => () => reset(), [reset])

  return useMemo(
    () => ({ available, enabled, unlock, toggle, play, stopAll, reset }),
    [available, enabled, play, reset, stopAll, toggle, unlock],
  )
}
