import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

interface AudioGraph {
  readonly context: AudioContext
  readonly master: GainNode
  readonly activeVoices: Set<ActiveVoice>
  noiseBuffer: AudioBuffer | null
}

interface ActiveVoice {
  readonly source: AudioScheduledSourceNode
  readonly nodes: readonly AudioNode[]
}

interface CinematicAudioController {
  readonly available: boolean
  readonly enabled: boolean
  readonly unlock: () => void
  readonly toggle: () => void
  readonly play: (cue: CinematicSoundCue) => void
  readonly stopAll: () => void
  readonly reset: () => void
}

type AudioWindow = Window &
  typeof globalThis & {
    readonly webkitAudioContext?: typeof AudioContext
  }

function getAudioContextConstructor(): typeof AudioContext | null {
  const audioWindow = window as AudioWindow
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null
}

function createGraph(): AudioGraph | null {
  const AudioContextConstructor = getAudioContextConstructor()
  if (AudioContextConstructor === null) return null

  try {
    const context = new AudioContextConstructor()
    const master = context.createGain()
    master.gain.value = 0.16
    master.connect(context.destination)
    return { context, master, activeVoices: new Set(), noiseBuffer: null }
  } catch {
    return null
  }
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

function settleAudioOperation(operation: Promise<void>): void {
  void operation.catch(() => undefined)
}

function closeGraph(graph: AudioGraph): void {
  stopAllVoices(graph)
  disconnectNode(graph.master)
  graph.noiseBuffer = null

  if (graph.context.state !== 'closed') {
    settleAudioOperation(graph.context.close())
  }
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
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.018)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
  oscillator.connect(gain)
  gain.connect(graph.master)
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
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(graph.master)
  const voice = trackVoice(graph, source, [source, filter, gain])

  try {
    source.start(now)
    source.stop(now + Math.min(durationSeconds, 1.24))
  } catch {
    releaseVoice(graph, voice)
  }
}

function playCue(graph: AudioGraph, cue: CinematicSoundCue): void {
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
      tone(graph, 330, 0.34, 0.1, 'triangle', 284)
      tone(graph, 660, 0.18, 0.055, 'sine', 570, 0.11)
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
      tone(graph, 36, 1.05, 0.48, 'sine', 28)
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
  const available = getAudioContextConstructor() !== null

  const ensureGraph = useCallback((): AudioGraph | null => {
    if (graphRef.current?.context.state === 'closed') {
      graphRef.current = null
    }

    graphRef.current ??= createGraph()
    const graph = graphRef.current
    if (graph !== null && graph.context.state === 'suspended') {
      settleAudioOperation(graph.context.resume())
    }
    return graph
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
          playCue(graph, cue)
        } catch {
          stopAllVoices(graph)
        }
      }
    },
    [enabled, ensureGraph],
  )

  const stopAll = useCallback(() => {
    const graph = graphRef.current
    if (graph !== null) stopAllVoices(graph)
  }, [])

  const reset = useCallback(() => {
    const graph = graphRef.current
    graphRef.current = null
    if (graph !== null) closeGraph(graph)
  }, [])

  const toggle = useCallback(() => {
    const next = !enabledRef.current
    enabledRef.current = next
    setEnabled(next)
    const graph = graphRef.current

    if (graph !== null) {
      if (next) {
        graph.master.gain.setValueAtTime(0.16, graph.context.currentTime)
        settleAudioOperation(graph.context.resume())
      } else {
        stopAllVoices(graph)
        graph.master.gain.setValueAtTime(0.0001, graph.context.currentTime)
        settleAudioOperation(graph.context.suspend())
      }
    } else if (next) {
      ensureGraph()
    }
  }, [ensureGraph])

  useEffect(() => () => reset(), [reset])

  return useMemo(
    () => ({ available, enabled, unlock, toggle, play, stopAll, reset }),
    [available, enabled, play, reset, stopAll, toggle, unlock],
  )
}
