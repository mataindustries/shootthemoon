/**
 * The page's single AudioContext and its buses (handoff 6.1):
 *
 *   masterGain (−0.6 dB) → safetyLimiter → destination
 *     ├─ sfxBus      ← synthesized cinematic SFX
 *     └─ musicBus    (alert duck)
 *          ├─ layersBus  (stinger ducks) ← five layer gains ← looping sources
 *          └─ stingerBus ← one-shot stinger sources
 *
 * A module-level singleton: StrictMode remounts never build a second graph,
 * and NEW GAME stops voices instead of closing the context. The context is
 * created or resumed only from a user gesture (BEGIN / CONTINUE, SOUND ON or
 * a cue played after one).
 */
import type { SuspendReason } from './audioTypes.ts'
import { LIMITER, MASTER_GAIN_DB, dbToGain, type AlertCue } from './music/musicConstants.ts'
import type { MusicHost } from './music/musicDirector.ts'

/** The pre-music SFX master level; the SFX bus is measured against it. */
export const SFX_REFERENCE_GAIN = 0.16
/**
 * SFX re-level over the reference (handoff 10.5: about +9 to +12 dB). Measured
 * against the music's short-term level (acceptance G), even +12 dB leaves the
 * alert tones short, so the bus takes the top of the range and the shortfall
 * is trimmed per cue (useCinematicAudio MUSIC_CUE_TRIM_DB).
 */
export const SFX_RELEVEL_DB = 12
export const SFX_BUS_GAIN = SFX_REFERENCE_GAIN * dbToGain(SFX_RELEVEL_DB)

export interface AudioEngine {
  readonly context: AudioContext
  readonly master: GainNode
  readonly limiter: DynamicsCompressorNode
  readonly sfxBus: GainNode
  readonly musicBus: GainNode
  readonly layersBus: GainNode
  readonly stingerBus: GainNode
}

type AudioGlobal = typeof globalThis & {
  readonly AudioContext?: typeof AudioContext
  readonly webkitAudioContext?: typeof AudioContext
}

let engine: AudioEngine | null = null
const suspendReasons = new Set<SuspendReason>()
const delayedSuspends = new Map<SuspendReason, ReturnType<typeof setTimeout>>()
const alertListeners = new Set<(cue: AlertCue) => void>()
let musicAudible = false

function settle(operation: Promise<void>): Promise<void> {
  return operation.catch(() => undefined)
}

export function audioContextConstructor(): typeof AudioContext | null {
  const scope = globalThis as AudioGlobal
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export function getAudioEngine(): AudioEngine | null {
  return engine
}

function buildEngine(Context: typeof AudioContext): AudioEngine {
  const context = new Context()
  const master = context.createGain()
  master.gain.value = dbToGain(MASTER_GAIN_DB)
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = LIMITER.thresholdDb
  limiter.knee.value = LIMITER.kneeDb
  limiter.ratio.value = LIMITER.ratio
  limiter.attack.value = LIMITER.attackSeconds
  limiter.release.value = LIMITER.releaseSeconds
  master.connect(limiter)
  limiter.connect(context.destination)
  const sfxBus = context.createGain()
  sfxBus.gain.value = SFX_BUS_GAIN
  sfxBus.connect(master)
  const musicBus = context.createGain()
  musicBus.connect(master)
  const layersBus = context.createGain()
  layersBus.connect(musicBus)
  const stingerBus = context.createGain()
  stingerBus.connect(musicBus)
  return { context, master, limiter, sfxBus, musicBus, layersBus, stingerBus }
}

/** A context the browser suspended (iOS interruption, backgrounding) resumes on the next tap. */
function resumeOnGesture(): void {
  const context = engine?.context
  if (context === undefined || suspendReasons.size > 0) return
  if (context.state === 'suspended' || (context.state as string) === 'interrupted') void settle(context.resume())
}

/**
 * Returns the engine, creating it on first use. Call from a user gesture: a
 * context created or resumed there is allowed to start. Never resumes a
 * context held suspended for a reason (hidden tab, SOUND OFF).
 */
export function ensureAudioEngine(): AudioEngine | null {
  if (engine === null || engine.context.state === 'closed') {
    const Context = audioContextConstructor()
    if (Context === null) return null
    try {
      engine = buildEngine(Context)
    } catch {
      return null
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', resumeOnGesture, { passive: true })
    }
    if (suspendReasons.size > 0) void settle(engine.context.suspend())
  }
  resumeOnGesture()
  return engine
}

/** Suspends the context for `reason`, at once or after a fade. */
export function requestAudioSuspend(reason: SuspendReason, afterSeconds = 0): void {
  suspendReasons.add(reason)
  const pending = delayedSuspends.get(reason)
  if (pending !== undefined) globalThis.clearTimeout(pending)
  delayedSuspends.delete(reason)
  const context = engine?.context
  if (context === undefined) return
  if (afterSeconds <= 0) {
    void settle(context.suspend())
    return
  }
  delayedSuspends.set(
    reason,
    globalThis.setTimeout(() => {
      delayedSuspends.delete(reason)
      if (suspendReasons.has(reason)) void settle(context.suspend())
    }, afterSeconds * 1000),
  )
}

/** Releases `reason`; the context resumes once no reason holds it. */
export function releaseAudioSuspend(reason: SuspendReason): Promise<void> {
  suspendReasons.delete(reason)
  const pending = delayedSuspends.get(reason)
  if (pending !== undefined) globalThis.clearTimeout(pending)
  delayedSuspends.delete(reason)
  const context = engine?.context
  if (context === undefined || suspendReasons.size > 0) return Promise.resolve()
  return settle(context.resume())
}

/** True while adaptive music is audible: the score then owns the sub at big impacts. */
export function isMusicAudible(): boolean {
  return musicAudible
}

export function setMusicAudible(audible: boolean): void {
  musicAudible = audible
}

/** Gameplay alerts (threat-warning, target-lock, fire-window) duck the music bus. */
export function onAudioAlert(listener: (cue: AlertCue) => void): () => void {
  alertListeners.add(listener)
  return () => alertListeners.delete(listener)
}

export function emitAudioAlert(cue: AlertCue): void {
  for (const listener of alertListeners) listener(cue)
}

/** The music director's view of the engine (full mode). */
export function createEngineMusicHost(): MusicHost | null {
  const current = ensureAudioEngine()
  if (current === null) return null
  return {
    context: current.context,
    musicBus: current.musicBus,
    layersBus: current.layersBus,
    stingerBus: current.stingerBus,
    suspend: requestAudioSuspend,
    resume: releaseAudioSuspend,
    setMusicAudible,
  }
}

/** Tests only: forget the singleton and every registered listener. */
export function resetAudioEngineForTests(): void {
  for (const pending of delayedSuspends.values()) globalThis.clearTimeout(pending)
  delayedSuspends.clear()
  suspendReasons.clear()
  alertListeners.clear()
  musicAudible = false
  if (typeof document !== 'undefined') document.removeEventListener('pointerdown', resumeOnGesture)
  engine = null
}
