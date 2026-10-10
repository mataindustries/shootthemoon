/**
 * The adaptive music director (handoff 6.4). It turns memoized game snapshots
 * into scheduled Web Audio: five phase-locked loops that only ever change by
 * gain, seven stingers, ducks, dwell and rotation, the First Strike and
 * Territory Claimed set pieces, and the suspend / resume / reset lifecycle.
 *
 * Everything runs against an injected `MusicHost`: the shared AudioEngine in
 * `full` mode, a null sink in `dry` mode (state machine and scheduling with
 * no network and no sound), nothing in `off` mode.
 */
import {
  FIRST_STRIKE_PRESENTATION_DURATIONS_MS,
  type FirstStrikePresentationPhase,
} from '../../app/firstStrikePresentation.ts'
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  GainNodeLike,
  SuspendReason,
} from '../audioTypes.ts'
import { GainLane, ramp, type LaneMove, type MoveOwner } from './gainLane.ts'
import { audioTimeFor, epochFor, layerStartOffset, nextBoundary, placeStinger, quantize, roundToFrame } from './musicClock.ts'
import {
  ALERT_DUCK,
  BAR_SECONDS,
  COUNTERSTRIKE_CONTACT_MS,
  DUCK_FADE_SECONDS,
  DWELL_SECONDS,
  FIRST_STRIKE_PLAN,
  LAYER_IDS,
  LOOKAHEAD_SECONDS,
  LOOP_END_SECONDS,
  LOOP_SECONDS,
  LOOP_START_SECONDS,
  MAX_CONCURRENT_STINGERS,
  NEW_GAME_FADE_SECONDS,
  PHRASE_SECONDS,
  ROTATION_OFFSET_SECONDS,
  SOUND_OFF_FADE_SECONDS,
  STAGE_CLEAR,
  STINGER_CUT_FADE_SECONDS,
  STINGER_RESTART_FADE_SECONDS,
  STINGER_SPECS,
  VACUUM_RAMP_SECONDS,
  dbToGain,
  gainToDb,
  type AlertCue,
  type AssetId,
  type LayerId,
  type ResidencyGroup,
  type StingerId,
} from './musicConstants.ts'
import { reachableResidencyGroups } from './musicLoader.ts'
import { isCalmCue, rotationGains, type LayerGains, type RotationKind } from './musicMix.ts'
import {
  deriveArc,
  deriveMusicEvents,
  deriveMusicTarget,
  dwellKey,
  deriveCue,
  targetForCue,
  type MusicEvent,
  type MusicSnapshot,
  type MusicTarget,
} from './musicState.ts'
import { classifyTransition, planCrossfade, TRANSITIONS, type TransitionSpec } from './musicTransitions.ts'

export type MusicMode = 'full' | 'dry' | 'off'

export type MusicStatus =
  | 'idle'
  | 'unlocked'
  | 'loading'
  | 'playing'
  | 'suspended'
  | 'stopped'
  | 'disabled'
  | 'error'

export interface MusicDebug {
  readonly status: MusicStatus
  readonly arc: string
  readonly cue: string
  readonly lastStinger: string | null
  readonly stingerCount: number
}

/** The audio graph the director plays into (handoff 6.1). */
export interface MusicHost {
  readonly context: AudioContextLike
  readonly musicBus: GainNodeLike
  readonly layersBus: GainNodeLike
  readonly stingerBus: GainNodeLike
  /** Suspends the context, at once or after a fade. */
  suspend(reason: SuspendReason, afterSeconds?: number): void
  /** Releases a reason; resolves once the context runs (or stays held by another reason). */
  resume(reason: SuspendReason): Promise<void>
  /** Lets the SFX layer hand the sub to the score (handoff section 14). */
  setMusicAudible?(audible: boolean): void
  /** Drops every suspension and audible claim this host holds, and cancels its delayed suspends (dispose). */
  release?(): void
}

export type AssetState = 'pending' | 'ready' | 'error'

export interface MusicAssetSource {
  /** Begins fetching and decoding every asset of these groups, in residency order. Idempotent. */
  request(groups: readonly ResidencyGroup[]): void
  buffer(id: AssetId): AudioBufferLike | null
  state(id: AssetId): AssetState
  subscribe(listener: (id: AssetId) => void): () => void
}

export interface WakeScheduler {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export interface MusicDirectorOptions {
  readonly mode: MusicMode
  /** Creates or resumes the host; called synchronously inside BEGIN / CONTINUE or SOUND ON. */
  readonly openHost: () => MusicHost | null
  /** Full mode: the loader for this host's context. */
  readonly openAssets?: (host: MusicHost) => MusicAssetSource
  readonly performanceNow?: () => number
  readonly scheduler?: WakeScheduler
}

export interface MusicDirector {
  /** Call synchronously in BEGIN / CONTINUE. */
  unlockAndStart(snapshot: MusicSnapshot): void
  /** Call on every memoized snapshot change. */
  update(snapshot: MusicSnapshot): void
  suspend(): void
  resume(snapshot: MusicSnapshot): void
  setEnabled(enabled: boolean, snapshot: MusicSnapshot): void
  notifyAlert(cue: AlertCue): void
  reset(): void
  /**
   * Tears the director down for good (hook unmount): stops every source,
   * clears wakes and pending resumes, drops its asset subscription and
   * disconnects its own nodes. The shared AudioContext, its buses and the
   * decoded buffers are left alone. Idempotent; every later call is a no-op.
   */
  dispose(): void
  readonly disposed: boolean
  readonly debug: MusicDebug
  subscribe(listener: () => void): () => void
}

const STRIKE_PHASES: readonly FirstStrikePresentationPhase[] = [
  'arming',
  'launch',
  'orbital-flight',
  'vesper-transmission',
  'target-approach',
  'impact-flash',
  'ejecta',
  'crater-reveal',
  'orbital-pullback',
  'ending',
]

/**
 * When each remaining strike phase begins: the current phase's real
 * `startedAtMs` plus the nominal durations of the phases before it. Phases
 * already passed are absent (handoff 4.2).
 */
export function projectStrikePhaseStarts(
  phase: FirstStrikePresentationPhase,
  startedAtMs: number,
): Partial<Record<FirstStrikePresentationPhase, number>> {
  const starts: Partial<Record<FirstStrikePresentationPhase, number>> = {}
  let time = startedAtMs
  for (let index = Math.max(0, STRIKE_PHASES.indexOf(phase)); index < STRIKE_PHASES.length && STRIKE_PHASES.includes(phase); index += 1) {
    const current = STRIKE_PHASES[index] as FirstStrikePresentationPhase
    starts[current] = time
    const duration = FIRST_STRIKE_PRESENTATION_DURATIONS_MS[current]
    if (duration === undefined) break
    time += duration
  }
  return starts
}

function strikeIndex(phase: FirstStrikePresentationPhase): number {
  return STRIKE_PHASES.indexOf(phase)
}

type ExactAnchor = 'first-strike' | 'counterstrike-contact' | 'monument-reveal'

interface Voice {
  readonly id: StingerId
  readonly priority: number
  readonly sync: number
  /** When the source begins playing (`source.start(when)`). */
  readonly when: number
  readonly start: number
  readonly end: number
  readonly timing: 'beat' | 'exact' | 'immediate'
  readonly anchor: ExactAnchor | null
  readonly gainDb: number
  readonly source: AudioBufferSourceNodeLike | null
  readonly node: GainNodeLike | null
  readonly lane: GainLane | null
  cutAt: number | null
}

interface Duck {
  readonly voice: Voice
  readonly start: number
  holdEnd: number
  readonly gainDb: number
}

interface StrikePlan {
  voice: Voice | null
  counted: boolean
  vacuumEnd: number | null
  vacuumCommitted: boolean
  breathed: boolean
}

interface ClaimPlan {
  readonly voice: Voice
  readonly clearAt: number
  readonly swellEnd: number
  readonly target: MusicTarget
}

interface Layer {
  readonly node: GainNodeLike
  readonly lane: GainLane
  source: AudioBufferSourceNodeLike | null
  /** When `source` begins playing. */
  sourceWhen: number
}

interface Graph {
  readonly host: MusicHost
  readonly layers: Readonly<Record<LayerId, Layer>>
  readonly layersBus: GainLane
  readonly musicBus: GainLane
}

interface Rotation {
  readonly cue: string
  readonly origin: number
  plannedUntil: number
}

/** Every move a cue transition supersedes from its boundary on. */
const RETARGETABLE: ReadonlySet<MoveOwner> = new Set(['start', 'cue', 'rotation', 'join'])
const ROTATION_CYCLE: readonly { readonly loops: number; readonly kind: RotationKind }[] = [
  { loops: 3, kind: 'thin' },
  { loops: 4, kind: 'normal' },
  { loops: 7, kind: 'thin' },
  { loops: 8, kind: 'rest' },
  { loops: 9, kind: 'normal' },
]
const ROTATION_CYCLE_LOOPS = 9
const VACUUM_TARGET_GAINS: LayerGains = {}

const defaultScheduler: WakeScheduler = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function linear(db: number | undefined): number {
  return db === undefined ? 0 : dbToGain(db)
}

class Director implements MusicDirector {
  readonly #options: MusicDirectorOptions
  readonly #scheduler: WakeScheduler
  readonly #listeners = new Set<() => void>()
  #debug: MusicDebug = { status: 'idle', arc: 'RECON', cue: 'SILENT', lastStinger: null, stingerCount: 0 }
  #status: MusicStatus = 'idle'
  #enabled = true
  #disabledBySound = false
  #hidden = false
  #soundOff = false
  #resumeToken = 0
  /**
   * SOUND ON asked for the music bus to come back. Survives a resume that a
   * hidden tab interrupted, so whichever resume finally lands does the unmute.
   */
  #unmutePending = false
  #disposed = false
  #unsubscribeAssets: (() => void) | null = null
  /** Layer sources NEW GAME left fading out: a new session cuts them before reopening the bus. */
  #retiring: { readonly source: AudioBufferSourceNodeLike; readonly stopAt: number }[] = []
  /** Stingers NEW GAME left fading on their own gain: dispose cuts them before their fade ends. */
  #retiringStingers: { readonly source: AudioBufferSourceNodeLike; readonly node: GainNodeLike | null; readonly stopAt: number }[] = []
  #snapshot: MusicSnapshot | null = null
  #baseline: MusicSnapshot | null = null
  #graph: Graph | null = null
  #assets: MusicAssetSource | null = null
  #epoch = 0
  /** The target the lanes currently move toward. */
  #target: MusicTarget | null = null
  #dwell: { key: string; since: number; decayed: boolean } | null = null
  #rotation: Rotation | null = null
  #voices: Voice[] = []
  #ducks: Duck[] = []
  #strike: StrikePlan | null = null
  #claim: ClaimPlan | null = null
  #lastStinger: StingerId | null = null
  #stingerCount = 0
  #wake: unknown = null
  /** Set when a set piece let go of the lanes: re-target even if the cue is unchanged. */
  #lanesReleased = false

  constructor(options: MusicDirectorOptions) {
    this.#options = options
    this.#scheduler = options.scheduler ?? defaultScheduler
    if (options.mode === 'off') this.#status = 'disabled'
    this.#debug = { ...this.#debug, status: this.#status }
  }

  get disposed(): boolean {
    return this.#disposed
  }

  get debug(): MusicDebug {
    return this.#debug
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  unlockAndStart(snapshot: MusicSnapshot): void {
    if (this.#disposed) return
    this.#snapshot = snapshot
    if (this.#options.mode === 'off') return this.#publish()
    if (this.#status === 'unlocked' || this.#status === 'loading' || this.#status === 'playing' || this.#status === 'suspended') return
    if (!this.#enabled) {
      this.#disabledBySound = true
      this.#setStatus('disabled')
      return
    }
    this.#start()
  }

  #start(): void {
    let host = this.#graph?.host ?? null
    try {
      host ??= this.#options.openHost()
    } catch {
      host = null
    }
    if (host === null) {
      this.#setStatus('error')
      return
    }
    this.#disabledBySound = false
    this.#ensureGraph(host)
    this.#clearPlayback()
    this.#setStatus('unlocked')
    if (this.#options.mode === 'dry') {
      this.#beginPlayback()
      return
    }
    if (this.#assets === null && this.#options.openAssets !== undefined) {
      this.#assets = this.#options.openAssets(host)
      this.#unsubscribeAssets = this.#assets.subscribe((id) => this.#onAssetSettled(id))
    }
    this.#setStatus('loading')
    this.#requestResidency()
    this.#maybeBeginPlayback()
  }

  #ensureGraph(host: MusicHost): Graph {
    if (this.#graph?.host === host) return this.#graph
    const layers = {} as Record<LayerId, Layer>
    for (const id of LAYER_IDS) {
      const node = host.context.createGain()
      node.connect(host.layersBus)
      layers[id] = { node, lane: new GainLane(node.gain, 0), source: null, sourceWhen: 0 }
    }
    this.#graph = {
      host,
      layers,
      layersBus: new GainLane(host.layersBus.gain, 1),
      musicBus: new GainLane(host.musicBus.gain, 1),
    }
    return this.#graph
  }

  #maybeBeginPlayback(): void {
    const assets = this.#assets
    if (this.#status !== 'loading' || assets === null) return
    const bed = assets.state('bed')
    if (bed === 'pending') return
    const anyLayerReady = LAYER_IDS.some((id) => assets.state(id) === 'ready')
    if (anyLayerReady) {
      this.#beginPlayback()
      return
    }
    const startSettled = assets.state('engine') !== 'pending'
    if (startSettled) this.#setStatus('error')
  }

  #beginPlayback(): void {
    const graph = this.#graph
    const snapshot = this.#snapshot
    if (graph === null || snapshot === null) return
    const now = this.#now()
    const sampleRate = graph.host.context.sampleRate
    this.#epoch = epochFor(now, sampleRate)
    this.#baseline = snapshot
    // The previous session's fading layers would sound again through the reopened bus.
    for (const retiring of this.#retiring) if (retiring.stopAt > now) this.#stopSource(retiring.source, now)
    this.#retiring = []
    this.#unmutePending = false
    graph.musicBus.hold(now, this.#soundOff ? 0 : 1)
    graph.layersBus.hold(now, 1)
    for (const id of LAYER_IDS) {
      const layer = graph.layers[id]
      layer.lane.hold(now, 0)
      this.#startLayerSource(id, this.#epoch)
    }
    const target = deriveMusicTarget(snapshot)
    this.#target = target
    this.#dwell = null
    this.#updateDwell(now)
    for (const id of LAYER_IDS) {
      const gain = target.gains[id]
      if (gain === undefined || !this.#layerPlaying(id)) continue
      const begin = id === 'bed' ? this.#epoch : roundToFrame(this.#epoch + BAR_SECONDS, sampleRate)
      const end = roundToFrame(begin + BAR_SECONDS, sampleRate)
      graph.layers[id].lane.update(now, () => true, [{ owner: 'start', start: begin, end, target: dbToGain(gain) }])
    }
    this.#rotation = null
    this.#beginRotation(target, this.#epoch + 2 * BAR_SECONDS)
    graph.host.setMusicAudible?.(this.#options.mode === 'full')
    this.#setStatus(this.#hidden || this.#soundOff ? 'suspended' : 'playing')
    this.#scheduleWake()
  }

  #startLayerSource(id: LayerId, when: number): void {
    const graph = this.#graph
    if (graph === null || this.#options.mode !== 'full') return
    const layer = graph.layers[id]
    const buffer = this.#assets?.buffer(id) ?? null
    if (buffer === null || layer.source !== null) return
    const context = graph.host.context
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopStart = LOOP_START_SECONDS
    source.loopEnd = LOOP_END_SECONDS
    source.connect(layer.node)
    source.start(when, layerStartOffset(when, this.#epoch, context.sampleRate))
    layer.source = source
    layer.sourceWhen = when
  }

  #layerPlaying(id: LayerId): boolean {
    if (this.#options.mode === 'dry') return true
    return this.#graph?.layers[id].source !== null
  }

  #onAssetSettled(id: AssetId): void {
    if (this.#status === 'loading') {
      this.#maybeBeginPlayback()
      return
    }
    if ((this.#status === 'playing' || this.#status === 'suspended') && (LAYER_IDS as readonly string[]).includes(id)) {
      this.#joinLayer(id as LayerId)
    }
  }

  /** A layer decoded after the epoch joins at its current phase and swells in over one bar (handoff 5). */
  #joinLayer(id: LayerId): void {
    const graph = this.#graph
    if (graph === null || graph.layers[id].source !== null) return
    const context = graph.host.context
    const now = this.#now()
    const when = roundToFrame(now + LOOKAHEAD_SECONDS, context.sampleRate)
    this.#startLayerSource(id, when)
    if (graph.layers[id].source === null || this.#target === null) return
    const gain = this.#effectiveGains(this.#target, when)[id]
    if (gain === undefined) return
    const boundary = nextBoundary(now, this.#epoch, BAR_SECONDS, context.sampleRate, { earliest: when + BAR_SECONDS })
    if (this.#ownedAt(boundary - BAR_SECONDS)) return
    const swellBegin = roundToFrame(boundary - BAR_SECONDS, context.sampleRate)
    graph.layers[id].lane.update(now, () => true, [{ owner: 'join', start: swellBegin, end: boundary, target: dbToGain(gain) }])
  }

  update(snapshot: MusicSnapshot): void {
    if (this.#disposed) return
    this.#snapshot = snapshot
    if (this.#status === 'loading' || this.#status === 'unlocked' || this.#status === 'playing' || this.#status === 'suspended') {
      this.#requestResidency()
    }
    if (this.#status !== 'playing') {
      this.#publish()
      return
    }
    const previous = this.#baseline ?? snapshot
    this.#baseline = snapshot
    const events = previous === snapshot ? [] : deriveMusicEvents(previous, snapshot)
    for (const event of events) this.#handleEvent(event)
    if (
      this.#strike !== null &&
      (previous.strikePhase !== snapshot.strikePhase || previous.strikePhaseStartedAtMs !== snapshot.strikePhaseStartedAtMs)
    ) {
      this.#projectStrike()
    }
    this.#retarget('change')
    this.#forgetFinishedVoices()
    this.#scheduleWake()
    this.#publish()
  }

  suspend(): void {
    if (this.#disposed) return
    this.#hidden = true
    this.#resumeToken += 1
    if (this.#graph === null || !this.#running()) return
    this.#graph.host.suspend('hidden')
    if (this.#status === 'playing') this.#setStatus('suspended')
    this.#clearWake()
  }

  resume(snapshot: MusicSnapshot): void {
    if (this.#disposed) return
    this.#snapshot = snapshot
    if (!this.#hidden) return
    this.#hidden = false
    const graph = this.#graph
    if (graph === null || !this.#running()) {
      // A claim made before NEW GAME outlives the session: the shown page must not stay held.
      if (graph !== null) void graph.host.resume('hidden')
      this.#publish()
      return
    }
    const token = ++this.#resumeToken
    void graph.host.resume('hidden').then(() => {
      if (token === this.#resumeToken) this.#completeResume()
    })
  }

  setEnabled(enabled: boolean, snapshot: MusicSnapshot): void {
    if (this.#disposed) return
    this.#snapshot = snapshot
    if (enabled === this.#enabled) return
    this.#enabled = enabled
    const graph = this.#graph
    if (!enabled) {
      if (graph === null || !this.#running()) return
      this.#soundOff = true
      this.#unmutePending = false
      this.#resumeToken += 1
      if (this.#status === 'playing') {
        const now = this.#now()
        graph.musicBus.update(now, (move) => move.owner === 'mute' || move.owner === 'alert', [
          ramp('mute', now, SOUND_OFF_FADE_SECONDS, 0),
        ])
        this.#setStatus('suspended')
      }
      graph.host.suspend('sound-off', SOUND_OFF_FADE_SECONDS)
      this.#clearWake()
      return
    }
    if (this.#status === 'disabled' && this.#disabledBySound) {
      this.#start()
      return
    }
    if (!this.#soundOff || graph === null) return
    this.#soundOff = false
    this.#unmutePending = true
    const token = ++this.#resumeToken
    void graph.host.resume('sound-off').then(() => {
      if (token === this.#resumeToken) this.#completeResume()
    })
  }

  reset(): void {
    if (this.#disposed) return
    this.#clearWake()
    this.#resumeToken += 1
    const graph = this.#graph
    if (graph !== null) {
      const context = graph.host.context
      const now = context.currentTime
      const fading = this.#status === 'playing'
      if (fading) graph.musicBus.update(now, () => true, [ramp('mute', now, NEW_GAME_FADE_SECONDS, 0)])
      // Sources already sounding fade out with the bus; one that has not started never will.
      const fadesOut = (when: number) => fading && when <= now
      const stopAt = now + NEW_GAME_FADE_SECONDS
      for (const id of LAYER_IDS) {
        const layer = graph.layers[id]
        const source = layer.source
        if (source !== null && fadesOut(layer.sourceWhen)) {
          this.#stopSource(source, stopAt)
          this.#retiring.push({ source, stopAt })
        } else {
          this.#stopSource(source, now)
        }
        layer.source = null
      }
      this.#retiringStingers = this.#retiringStingers.filter((retiring) => retiring.stopAt > now)
      for (const voice of this.#voices) {
        if (fadesOut(voice.when)) {
          // On its own gain too: a quick next BEGIN reopens the music bus under it.
          voice.lane?.update(now, () => true, [ramp('stinger', now, NEW_GAME_FADE_SECONDS, 0)])
          this.#stopSource(voice.source, stopAt)
          if (voice.source !== null) this.#retiringStingers.push({ source: voice.source, node: voice.node, stopAt })
        } else {
          this.#stopSource(voice.source, now)
        }
      }
      graph.host.setMusicAudible?.(false)
      // The next session starts with SOUND on: drop this director's claim and its pending fade-out suspend.
      if (this.#soundOff) void graph.host.resume('sound-off')
    }
    this.#clearPlayback()
    this.#lastStinger = null
    this.#stingerCount = 0
    this.#soundOff = false
    this.#unmutePending = false
    this.#disabledBySound = false
    if (this.#options.mode === 'off') this.#setStatus('disabled')
    else if (this.#status !== 'idle') this.#setStatus('stopped')
    else this.#publish()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#clearWake()
    this.#resumeToken += 1
    this.#unmutePending = false
    this.#unsubscribeAssets?.()
    this.#unsubscribeAssets = null
    const graph = this.#graph
    if (graph !== null) {
      const now = graph.host.context.currentTime
      for (const id of LAYER_IDS) {
        const layer = graph.layers[id]
        this.#stopSource(layer.source, now)
        layer.source = null
        layer.node.disconnect()
      }
      for (const voice of this.#voices) {
        this.#stopSource(voice.source, now)
        voice.node?.disconnect()
      }
      for (const retiring of this.#retiring) this.#stopSource(retiring.source, now)
      for (const retiring of this.#retiringStingers) {
        this.#stopSource(retiring.source, now)
        retiring.source.disconnect()
        retiring.node?.disconnect()
      }
      if (this.#running()) graph.host.setMusicAudible?.(false)
      graph.host.release?.()
    }
    this.#retiring = []
    this.#retiringStingers = []
    this.#clearPlayback()
    this.#status = this.#options.mode === 'off' ? 'disabled' : 'stopped'
    this.#debug = { ...this.#debug, status: this.#status, cue: 'SILENT' }
    this.#listeners.clear()
  }

  notifyAlert(_cue: AlertCue): void {
    const graph = this.#graph
    if (graph === null || this.#status !== 'playing') return
    const now = this.#now()
    const ducked = dbToGain(ALERT_DUCK.gainDb)
    const released = now + ALERT_DUCK.attackSeconds + ALERT_DUCK.holdSeconds
    graph.musicBus.update(now, (move) => move.owner === 'alert', [
      ramp('alert', now, ALERT_DUCK.attackSeconds, ducked),
      ramp('alert', released, ALERT_DUCK.releaseSeconds, 1),
    ])
  }

  #running(): boolean {
    return this.#status === 'unlocked' || this.#status === 'loading' || this.#status === 'playing' || this.#status === 'suspended'
  }

  /** A hidden-tab or SOUND ON resume landed; the token check already passed. */
  #completeResume(): void {
    if (this.#hidden || this.#soundOff || this.#status !== 'suspended') return
    const soundOn = this.#unmutePending
    this.#unmutePending = false
    this.#afterResume(soundOn)
  }

  /** Return from a hidden tab or SOUND OFF (handoff 6.2). */
  #afterResume(soundOn: boolean): void {
    const graph = this.#graph
    const snapshot = this.#snapshot
    if (graph === null || snapshot === null) return
    this.#setStatus('playing')
    const now = this.#now()
    this.#baseline = snapshot
    this.#restartStingers(now)
    if (this.#strike !== null) this.#projectStrike()
    if (soundOn) {
      // The game kept running while the sound was off: land on its current state at once.
      const target = deriveMusicTarget(snapshot)
      this.#target = target
      this.#dwell = null
      this.#updateDwell(now)
      if (!this.#ownedAt(now)) {
        for (const id of LAYER_IDS) {
          if (!this.#layerPlaying(id)) continue
          graph.layers[id].lane.update(now, (move) => RETARGETABLE.has(move.owner), [ramp('cue', now, 0, linear(target.gains[id]))])
        }
      }
      this.#rotation = null
      this.#beginRotation(target, now)
      graph.musicBus.update(now, (move) => move.owner === 'mute' || move.owner === 'alert', [
        ramp('mute', now, SOUND_OFF_FADE_SECONDS, 1),
      ])
    } else {
      this.#retarget('change')
    }
    this.#scheduleWake()
    this.#publish()
  }

  /**
   * Fade out every stinger still playing and restart each EXACT one whose
   * re-anchored sync point is still ahead; nothing else replays (handoff 6.2).
   */
  #restartStingers(now: number): void {
    const active = this.#voices.filter((voice) => voice.cutAt === null && voice.end > now)
    for (const voice of active) this.#cutVoice(voice, now, STINGER_RESTART_FADE_SECONDS)
    if (this.#strike !== null && this.#strike.voice !== null && active.includes(this.#strike.voice)) this.#strike.voice = null
    for (const voice of active) {
      if (voice.anchor === null || voice.anchor === 'first-strike') continue
      const sync = this.#reanchor(voice.anchor)
      if (sync === null || sync <= now) continue
      const restarted = this.#playStinger(voice.id, 'exact', {
        exactSync: sync,
        anchor: voice.anchor,
        gainDb: voice.gainDb,
        count: false,
        fadeIn: true,
      })
      if (this.#claim?.voice === voice) {
        this.#claim = restarted === null ? null : { ...this.#claim, voice: restarted }
      }
    }
    if (this.#claim !== null && this.#claim.voice.cutAt !== null) this.#releaseClaim()
  }

  #reanchor(anchor: ExactAnchor): number | null {
    const snapshot = this.#snapshot
    if (snapshot === null) return null
    if (anchor === 'counterstrike-contact') {
      return snapshot.csStatus === 'impact' ? this.#audioTime(snapshot.csPhaseStartedAtMs + COUNTERSTRIKE_CONTACT_MS) : null
    }
    if (anchor === 'monument-reveal') {
      return snapshot.monumentRevealAtMs === null ? null : this.#audioTime(snapshot.monumentRevealAtMs)
    }
    return null
  }

  // -------------------------------------------------------------------------
  // Targets, transitions, dwell and rotation
  // -------------------------------------------------------------------------

  /** Updates the dwell timer and reports whether this snapshot's tension has decayed. */
  #updateDwell(now: number): boolean {
    const snapshot = this.#snapshot
    if (snapshot === null) return false
    const key = dwellKey(snapshot, deriveCue(snapshot))
    if (key === null) {
      this.#dwell = null
      return false
    }
    if (this.#dwell?.key !== key) this.#dwell = { key, since: now, decayed: false }
    if (!this.#dwell.decayed && now >= this.#dwell.since + DWELL_SECONDS - 1e-6) this.#dwell.decayed = true
    return this.#dwell.decayed
  }

  #retarget(reason: 'change' | 'dwell'): void {
    const graph = this.#graph
    const snapshot = this.#snapshot
    if (graph === null || snapshot === null || this.#status !== 'playing') return
    const now = this.#now()
    const decayed = this.#updateDwell(now)
    const target = deriveMusicTarget(snapshot, { decayed })
    const current = this.#target
    const unchanged = current !== null && current.cue === target.cue && current.viewAway === target.viewAway && sameGains(current.gains, target.gains)
    if (unchanged && !this.#lanesReleased) return
    if (this.#ownedAt(now)) return
    this.#lanesReleased = false
    const transition = classifyTransition(current, target, reason === 'dwell' && current?.cue !== target.cue ? 'dwell' : 'change')
    const sameStretch = current !== null && current.cue === target.cue && this.#rotation?.cue === target.cue
    this.#target = target
    const boundary = quantize(transition.unit, now, this.#epoch, graph.host.context.sampleRate)
    if (!sameStretch) this.#rotation = null
    this.#transition(this.#effectiveGains(target, boundary), boundary, transition, now)
    if (sameStretch) this.#planRotation(boundary)
    else this.#beginRotation(target, boundary)
  }

  /** The target with the current rotation window applied. */
  #effectiveGains(target: MusicTarget, time: number): LayerGains {
    const rotation = this.#rotation
    if (rotation === null || rotation.cue !== target.cue) return target.gains
    return rotationGains(target.gains, this.#rotationKindAt(rotation, target.cue, time))
  }

  #transition(to: LayerGains, boundary: number, transition: TransitionSpec, now: number, owner: MoveOwner = 'cue'): void {
    const graph = this.#graph
    if (graph === null) return
    const playing = LAYER_IDS.filter((id) => this.#layerPlaying(id))
    const from: Partial<Record<LayerId, number>> = {}
    for (const id of playing) {
      const value = graph.layers[id].lane.valueAt(boundary)
      if (value > 0) from[id] = gainToDb(value)
    }
    const window = this.#ownershipStart()
    const plan = planCrossfade(from, to, boundary, transition, playing)
    const frame = (time: number) => roundToFrame(time, graph.host.context.sampleRate)
    for (const id of playing) {
      const moves = plan
        .filter((move) => move.layer === id && (window === null || move.start < window))
        .map((move) => ({ owner, start: frame(move.start), end: frame(move.end), target: linear(move.targetDb ?? undefined) }))
      const supersedes = (move: LaneMove) => RETARGETABLE.has(move.owner) && move.start >= boundary
      graph.layers[id].lane.update(now, supersedes, moves)
    }
  }

  #beginRotation(target: MusicTarget, from: number): void {
    const graph = this.#graph
    if (graph === null || !isCalmCue(target.cue)) {
      this.#rotation = null
      return
    }
    const origin = nextBoundary(from, this.#epoch, LOOP_SECONDS, graph.host.context.sampleRate, {
      offset: ROTATION_OFFSET_SECONDS,
      earliest: from,
    })
    this.#rotation = { cue: target.cue, origin, plannedUntil: origin }
    this.#planRotation(from)
  }

  #rotationKindAt(rotation: Rotation, cue: string, time: number): RotationKind {
    if (time < rotation.origin) return 'normal'
    const position = Math.floor((time - rotation.origin) / LOOP_SECONDS + 1e-9) % ROTATION_CYCLE_LOOPS
    const kind: RotationKind = position === 3 || position === 7 ? 'thin' : position === 8 ? 'rest' : 'normal'
    return kind === 'rest' && cue === 'RECON' ? 'normal' : kind
  }

  /** Thins every 4th loop and rests the 9th, on bar-9 boundaries, two cycles ahead (handoff 3.7). */
  #planRotation(from: number): void {
    const graph = this.#graph
    const rotation = this.#rotation
    const target = this.#target
    if (graph === null || rotation === null || target === null) return
    const now = this.#now()
    const sampleRate = graph.host.context.sampleRate
    const cycleSeconds = ROTATION_CYCLE_LOOPS * LOOP_SECONDS
    const firstCycle = Math.max(0, Math.floor((from - rotation.origin) / cycleSeconds))
    const playing = LAYER_IDS.filter((id) => this.#layerPlaying(id))
    const moves = new Map<LayerId, LaneMove[]>(LAYER_IDS.map((id) => [id, []]))
    let previous: RotationKind = 'normal'
    for (let cycle = firstCycle; cycle < firstCycle + 2; cycle += 1) {
      for (const step of ROTATION_CYCLE) {
        const boundary = rotation.origin + (cycle * ROTATION_CYCLE_LOOPS + step.loops) * LOOP_SECONDS
        const kind = step.kind === 'rest' && target.cue === 'RECON' ? 'normal' : step.kind
        const prior = previous
        previous = kind
        if (boundary < from || this.#ownedAt(boundary) || kind === prior) continue
        const plan = planCrossfade(
          rotationGains(target.gains, prior),
          rotationGains(target.gains, kind),
          roundToFrame(boundary, sampleRate),
          TRANSITIONS.rotation,
          playing,
        )
        for (const move of plan) {
          moves.get(move.layer)?.push({
            owner: 'rotation',
            start: roundToFrame(move.start, sampleRate),
            end: roundToFrame(move.end, sampleRate),
            target: linear(move.targetDb ?? undefined),
          })
        }
      }
    }
    for (const id of LAYER_IDS) {
      graph.layers[id].lane.update(now, (move) => move.owner === 'rotation' && move.start >= from, moves.get(id))
    }
    rotation.plannedUntil = rotation.origin + (firstCycle + 2) * cycleSeconds
  }

  // -------------------------------------------------------------------------
  // Events and stingers
  // -------------------------------------------------------------------------

  #handleEvent(event: MusicEvent): void {
    if (event.kind === 'first-strike') {
      this.#armStrike()
      return
    }
    if (event.timing === 'exact') {
      const anchor: ExactAnchor = event.id === 'territory-claimed' ? 'monument-reveal' : 'counterstrike-contact'
      const voice = this.#playStinger(event.id, 'exact', {
        exactSync: this.#audioTime(event.syncPerfMs),
        anchor,
        gainDb: event.gainDb,
      })
      if (voice !== null && event.id === 'territory-claimed') this.#beginClaim(voice)
      return
    }
    this.#playStinger(event.id, event.timing, { gainDb: event.gainDb })
  }

  #playStinger(
    id: StingerId,
    timing: 'beat' | 'exact' | 'immediate',
    options: {
      readonly exactSync?: number
      readonly anchor?: ExactAnchor
      readonly gainDb?: number
      readonly count?: boolean
      readonly fadeIn?: boolean
    } = {},
  ): Voice | null {
    const graph = this.#graph
    if (graph === null) return null
    const spec = STINGER_SPECS[id]
    const buffer = this.#options.mode === 'full' ? (this.#assets?.buffer(id) ?? null) : null
    if (this.#options.mode === 'full' && buffer === null) return null
    const context = graph.host.context
    const now = this.#now()
    const placement = placeStinger(timing, spec.syncSeconds, now, this.#epoch, context.sampleRate, options.exactSync ?? null)
    const end = placement.start + spec.contentSeconds
    if (end <= now + LOOKAHEAD_SECONDS) return null
    const live = this.#voices.filter((voice) => voice.cutAt === null && voice.end > placement.when)
    if (live.some((voice) => voice.id === id)) return null
    for (const voice of live) {
      if (voice.priority < spec.priority && voice.start < end) {
        this.#cutVoice(voice, Math.max(now, placement.when), STINGER_CUT_FADE_SECONDS)
      }
    }
    const overlapping = this.#voices.filter((voice) => voice.cutAt === null && voice.end > placement.when && voice.start < end)
    if (overlapping.length >= MAX_CONCURRENT_STINGERS) return null

    const gainDb = options.gainDb ?? 0
    // A start inside the content (late, or restarted on resume) fades in over 20 ms instead of clicking.
    const fadeIn = options.fadeIn ?? placement.start < now
    let source: AudioBufferSourceNodeLike | null = null
    let node: GainNodeLike | null = null
    let lane: GainLane | null = null
    if (buffer !== null) {
      node = context.createGain()
      node.connect(graph.host.stingerBus)
      lane = new GainLane(node.gain, fadeIn ? 0 : dbToGain(gainDb))
      if (fadeIn) lane.update(now, () => true, [ramp('stinger', placement.when, STINGER_RESTART_FADE_SECONDS, dbToGain(gainDb))])
      source = context.createBufferSource()
      source.buffer = buffer
      source.connect(node)
      source.start(placement.when, placement.offset)
      const started = source
      const gainNode = node
      started.onended = () => {
        started.disconnect()
        gainNode.disconnect()
      }
    }
    const voice: Voice = {
      id,
      priority: spec.priority,
      sync: placement.sync,
      when: placement.when,
      start: placement.start,
      end,
      timing,
      anchor: options.anchor ?? null,
      gainDb,
      source,
      node,
      lane,
      cutAt: null,
    }
    this.#voices.push(voice)
    if (spec.duck.kind === 'duck') {
      this.#ducks.push({
        voice,
        start: placement.start,
        holdEnd: placement.start + spec.duck.bars * BAR_SECONDS,
        gainDb: spec.duck.gainDb,
      })
      this.#applyDucks()
    }
    if (options.count !== false) {
      this.#lastStinger = id
      this.#stingerCount += 1
    }
    return voice
  }

  #cutVoice(voice: Voice, at: number, fadeSeconds: number): void {
    if (voice.cutAt !== null) return
    const now = this.#now()
    voice.cutAt = at
    voice.lane?.update(now, () => true, [ramp('stinger', at, fadeSeconds, 0)])
    this.#stopSource(voice.source, at + fadeSeconds)
    let ducksChanged = false
    for (const duck of this.#ducks) {
      if (duck.voice === voice && duck.holdEnd > at) {
        duck.holdEnd = Math.max(duck.start, at)
        ducksChanged = true
      }
    }
    if (ducksChanged) this.#applyDucks()
  }

  #stopSource(source: AudioBufferSourceNodeLike | null, at: number): void {
    if (source === null) return
    try {
      source.stop(at)
    } catch {
      // Already stopped: nothing left to schedule.
    }
  }

  /** Stinger ducks on the layers bus: the deepest active duck wins, so ducks never raise a layer. */
  #applyDucks(): void {
    const graph = this.#graph
    if (graph === null) return
    const now = this.#now()
    this.#ducks = this.#ducks.filter((duck) => duck.holdEnd + DUCK_FADE_SECONDS > now)
    const times = [...new Set(this.#ducks.flatMap((duck) => [duck.start, duck.holdEnd]))].sort((a, b) => a - b)
    const levelAt = (time: number) =>
      Math.min(0, ...this.#ducks.filter((duck) => duck.start <= time && time < duck.holdEnd).map((duck) => duck.gainDb))
    const moves: LaneMove[] = []
    let previous = 0
    for (const time of times) {
      const level = levelAt(time)
      if (level === previous) continue
      moves.push(ramp('duck', time, DUCK_FADE_SECONDS, dbToGain(level)))
      previous = level
    }
    graph.layersBus.update(now, (move) => move.owner === 'duck', moves)
  }

  #forgetFinishedVoices(): void {
    const now = this.#now()
    this.#voices = this.#voices.filter((voice) => (voice.cutAt ?? voice.end) + 0.5 > now)
  }

  // -------------------------------------------------------------------------
  // First Strike (handoff 4.2)
  // -------------------------------------------------------------------------

  #armStrike(): void {
    if (this.#strike !== null) this.#cancelStrike()
    this.#strike = { voice: null, counted: false, vacuumEnd: null, vacuumCommitted: false, breathed: false }
    this.#projectStrike()
  }

  /**
   * Re-anchors every step that has not started on the current strike phase:
   * its real start plus the remaining nominal durations. Called on every
   * strike-phase edge and on resume.
   */
  #projectStrike(): void {
    const plan = this.#strike
    const snapshot = this.#snapshot
    const graph = this.#graph
    if (plan === null || snapshot === null || graph === null) return
    const phase = snapshot.strikePhase
    if (phase === 'idle' || phase === 'scar-explore') {
      this.#cancelStrike()
      return
    }
    const now = this.#now()
    const sampleRate = graph.host.context.sampleRate
    const starts = projectStrikePhaseStarts(phase, snapshot.strikePhaseStartedAtMs)
    const index = strikeIndex(phase)

    const committed = plan.voice !== null && plan.voice.start <= now + LOOKAHEAD_SECONDS
    if (!committed) {
      const syncSeconds = STINGER_SPECS['first-strike'].syncSeconds
      const transmission = starts['vesper-transmission']
      const impact = starts['impact-flash']
      const startPerf =
        transmission !== undefined
          ? transmission + FIRST_STRIKE_PLAN.stingerAfterTransmissionStartMs
          : impact !== undefined
            ? impact - syncSeconds * 1000
            : null
      const sync = startPerf === null ? null : roundToFrame(this.#audioTime(startPerf) + syncSeconds, sampleRate)
      if (sync !== null && (plan.voice === null || Math.abs(plan.voice.sync - sync) > 0.5 / sampleRate)) {
        const previous = plan.voice
        if (previous !== null) {
          this.#cutVoice(previous, now, 0)
          this.#voices = this.#voices.filter((voice) => voice !== previous)
        }
        plan.voice = sync > now ? this.#playStinger('first-strike', 'exact', { exactSync: sync, anchor: 'first-strike', count: !plan.counted }) : null
        if (plan.voice !== null) plan.counted = true
      }
    }

    if (!plan.vacuumCommitted && !plan.breathed) {
      const approach = starts['target-approach']
      if (approach !== undefined) {
        plan.vacuumEnd = roundToFrame(this.#audioTime(approach + FIRST_STRIKE_PLAN.vacuumAfterApproachStartMs), sampleRate)
      } else if (index >= strikeIndex('impact-flash') && index < strikeIndex('crater-reveal')) {
        plan.vacuumEnd = roundToFrame(now + LOOKAHEAD_SECONDS + VACUUM_RAMP_SECONDS, sampleRate)
      }
      if (plan.vacuumEnd !== null) {
        // A vacuum whose time has already passed (a late update) empties the lanes at once.
        const vacuumEnd = Math.max(plan.vacuumEnd, now + VACUUM_RAMP_SECONDS)
        const vacuumStart = vacuumEnd - VACUUM_RAMP_SECONDS
        for (const id of LAYER_IDS) {
          graph.layers[id].lane.update(
            now,
            (move) => (move.owner === 'plan' && move.start > now) || (RETARGETABLE.has(move.owner) && move.start >= vacuumStart),
            [{ owner: 'plan', start: vacuumStart, end: vacuumEnd, target: 0 }],
          )
        }
        plan.vacuumCommitted = vacuumStart <= now + LOOKAHEAD_SECONDS
      }
    }

    if (index >= strikeIndex('crater-reveal') && !plan.breathed) this.#breathe(now)
    if (phase === 'ending' && plan.breathed) this.#strike = null
  }

  /** The crater-reveal edge: BED returns to −8 dB over 2 s and the plan lets go of the lanes. */
  #breathe(now: number): void {
    const plan = this.#strike
    const graph = this.#graph
    const snapshot = this.#snapshot
    if (plan === null || graph === null || snapshot === null) return
    plan.breathed = true
    const breath = targetForCue(snapshot, 'FS_BREATH')
    const begin = roundToFrame(now + LOOKAHEAD_SECONDS, graph.host.context.sampleRate)
    for (const id of LAYER_IDS) {
      if (!this.#layerPlaying(id)) continue
      graph.layers[id].lane.update(now, (move) => (move.owner === 'plan' && move.start > now) || (RETARGETABLE.has(move.owner) && move.start >= begin), [
        ramp('plan', begin, TRANSITIONS.breath.fadeSeconds, linear(breath.gains[id])),
      ])
    }
    this.#target = breath
    this.#rotation = null
  }

  /** Strike went idle or to the scar before finishing: cancel what has not started. */
  #cancelStrike(): void {
    const plan = this.#strike
    if (plan === null) return
    this.#strike = null
    const graph = this.#graph
    if (graph === null) return
    const now = this.#now()
    if (plan.voice !== null && plan.voice.start > now + LOOKAHEAD_SECONDS) this.#cutVoice(plan.voice, now, 0)
    const vacuumStarted = plan.vacuumEnd !== null && plan.vacuumEnd - VACUUM_RAMP_SECONDS <= now
    for (const id of LAYER_IDS) graph.layers[id].lane.update(now, (move) => move.owner === 'plan' && move.start > now)
    if (vacuumStarted && !plan.breathed) {
      // The lanes were emptied by the vacuum: move from there to the current target.
      this.#target = { ...(this.#target ?? deriveMusicTarget(this.#snapshot as MusicSnapshot)), cue: 'FS_VACUUM', gains: VACUUM_TARGET_GAINS }
    }
    // Cue moves inside the cancelled window were never scheduled: re-target from the lanes' real values.
    this.#lanesReleased = true
  }

  // -------------------------------------------------------------------------
  // Territory Claimed (handoff 4.2)
  // -------------------------------------------------------------------------

  /** Stage clear on the arrival, then the CLAIMED mix swells in to the first phrase boundary ≥ sync + 8.4 s. */
  #beginClaim(voice: Voice): void {
    const graph = this.#graph
    const snapshot = this.#snapshot
    if (graph === null || snapshot === null) return
    const now = this.#now()
    const sampleRate = graph.host.context.sampleRate
    const clearAt = roundToFrame(Math.max(now, voice.start), sampleRate)
    const swellEnd = nextBoundary(now, this.#epoch, PHRASE_SECONDS, sampleRate, {
      earliest: voice.sync + STAGE_CLEAR.resumeAfterSeconds,
    })
    const swellBegin = roundToFrame(swellEnd - STAGE_CLEAR.resumeSwellBars * BAR_SECONDS, sampleRate)
    const claimed = targetForCue(snapshot, 'CLAIMED')
    for (const id of LAYER_IDS) {
      if (!this.#layerPlaying(id)) continue
      graph.layers[id].lane.update(now, (move) => (RETARGETABLE.has(move.owner) || move.owner === 'plan') && move.start >= clearAt, [
        ramp('plan', clearAt, STAGE_CLEAR.fadeSeconds, id === 'bed' ? dbToGain(STAGE_CLEAR.bedGainDb) : 0),
        ramp('plan', swellBegin, swellEnd - swellBegin, linear(claimed.gains[id])),
      ])
    }
    this.#claim = { voice, clearAt, swellEnd, target: claimed }
    this.#rotation = null
  }

  #releaseClaim(): void {
    const claim = this.#claim
    const graph = this.#graph
    if (claim === null || graph === null) return
    this.#claim = null
    const now = this.#now()
    if (now < claim.swellEnd) {
      for (const id of LAYER_IDS) graph.layers[id].lane.update(now, (move) => move.owner === 'plan' && move.start > now)
      this.#target = { ...claim.target, cue: 'MONUMENT_REVEAL', gains: { bed: STAGE_CLEAR.bedGainDb } }
    } else {
      this.#target = claim.target
      this.#beginRotation(claim.target, claim.swellEnd)
    }
    this.#retarget('change')
  }

  // -------------------------------------------------------------------------
  // Ownership, residency, clock, wake, debug
  // -------------------------------------------------------------------------

  /** When a set-piece plan owns the layer lanes, cue transitions wait (handoff 4.2). */
  #ownershipStart(): number | null {
    const strike = this.#strike
    const vacuum = strike !== null && !strike.breathed && strike.vacuumEnd !== null ? strike.vacuumEnd - VACUUM_RAMP_SECONDS : null
    const claim = this.#claim?.clearAt ?? null
    if (vacuum === null) return claim
    return claim === null ? vacuum : Math.min(vacuum, claim)
  }

  #ownedAt(time: number): boolean {
    const start = this.#ownershipStart()
    return start !== null && time >= start
  }

  #requestResidency(): void {
    if (this.#assets !== null && this.#snapshot !== null) this.#assets.request(reachableResidencyGroups(this.#snapshot))
  }

  #now(): number {
    return this.#graph?.host.context.currentTime ?? 0
  }

  #audioTime(perfMs: number): number {
    const context = this.#graph?.host.context
    if (context === undefined) return 0
    const performanceNow = this.#options.performanceNow ?? (() => performance.now())
    return audioTimeFor(context, perfMs, performanceNow())
  }

  #clearPlayback(): void {
    this.#voices = []
    this.#ducks = []
    this.#strike = null
    this.#claim = null
    this.#dwell = null
    this.#rotation = null
    this.#target = null
    this.#baseline = null
  }

  #clearWake(): void {
    if (this.#wake !== null) this.#scheduler.clear(this.#wake)
    this.#wake = null
  }

  /** One timer for whatever the audio clock must do next: dwell, rotation, the claim swell. */
  #scheduleWake(): void {
    this.#clearWake()
    if (this.#status !== 'playing' || this.#graph === null) return
    const now = this.#now()
    const due: number[] = []
    if (this.#dwell !== null && !this.#dwell.decayed) due.push(this.#dwell.since + DWELL_SECONDS)
    if (this.#claim !== null) due.push(this.#claim.swellEnd)
    if (this.#rotation !== null) due.push(this.#rotation.plannedUntil - LOOP_SECONDS)
    if (due.length === 0) return
    const next = Math.min(...due)
    this.#wake = this.#scheduler.set(() => this.tick(), Math.max(0, (next - now) * 1000))
  }

  /** The wake timer fired. Exposed for tests that drive a fake clock. */
  tick(): void {
    this.#wake = null
    if (this.#disposed || this.#status !== 'playing' || this.#graph === null) return
    const now = this.#now()
    const claim = this.#claim
    if (claim !== null && now >= claim.swellEnd - 1e-6) this.#releaseClaim()
    const dwell = this.#dwell
    if (dwell !== null && !dwell.decayed && now >= dwell.since + DWELL_SECONDS - 1e-6) this.#retarget('dwell')
    const rotation = this.#rotation
    if (rotation !== null && now >= rotation.plannedUntil - LOOP_SECONDS - 1e-6) this.#planRotation(rotation.plannedUntil)
    this.#forgetFinishedVoices()
    this.#scheduleWake()
    this.#publish()
  }

  #setStatus(status: MusicStatus): void {
    this.#status = status
    this.#publish()
  }

  #publish(): void {
    const snapshot = this.#snapshot
    const arc = snapshot === null ? 'RECON' : deriveArc(snapshot)
    let cue = 'SILENT'
    if (snapshot !== null && (this.#status === 'playing' || this.#status === 'suspended')) {
      cue = deriveMusicTarget(snapshot, { decayed: this.#dwell?.decayed === true }).cue
    }
    const next: MusicDebug = {
      status: this.#status,
      arc,
      cue,
      lastStinger: this.#lastStinger,
      stingerCount: this.#stingerCount,
    }
    const previous = this.#debug
    if (
      previous.status === next.status &&
      previous.arc === next.arc &&
      previous.cue === next.cue &&
      previous.lastStinger === next.lastStinger &&
      previous.stingerCount === next.stingerCount
    ) {
      return
    }
    this.#debug = next
    for (const listener of this.#listeners) listener()
  }
}

function sameGains(a: LayerGains, b: LayerGains): boolean {
  return LAYER_IDS.every((id) => {
    const left = a[id]
    const right = b[id]
    return left === undefined || right === undefined ? left === right : Math.abs(left - right) < 1e-9
  })
}

export function createMusicDirector(options: MusicDirectorOptions): MusicDirector & { tick(): void } {
  return new Director(options)
}
