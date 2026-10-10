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

/**
 * Who holds a suspension or audible claim: the SFX layer, or one music
 * director's host. Claims are per owner, so tearing one director down releases
 * only what it held and never what another owner still needs.
 */
export type AudioOwner = object

/** The SFX layer's claims (and any caller that names no owner). */
const sharedOwner: AudioOwner = {}

let engine: AudioEngine | null = null
const suspendClaims = new Map<AudioOwner, Set<SuspendReason>>()
const delayedSuspends = new Map<AudioOwner, Map<SuspendReason, ReturnType<typeof setTimeout>>>()
const audibleOwners = new Set<AudioOwner>()
const alertListeners = new Set<(cue: AlertCue) => void>()

function suspendHeld(): boolean {
  return suspendClaims.size > 0
}

function cancelDelayedSuspend(owner: AudioOwner, reason: SuspendReason): void {
  const pending = delayedSuspends.get(owner)
  const timer = pending?.get(reason)
  if (timer !== undefined) globalThis.clearTimeout(timer)
  pending?.delete(reason)
  if (pending?.size === 0) delayedSuspends.delete(owner)
}

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
  if (context === undefined || suspendHeld()) return
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
    if (suspendHeld()) void settle(engine.context.suspend())
  }
  resumeOnGesture()
  return engine
}

/** Suspends the context for `owner`'s `reason`, at once or after a fade. */
export function requestAudioSuspend(reason: SuspendReason, afterSeconds = 0, owner: AudioOwner = sharedOwner): void {
  let reasons = suspendClaims.get(owner)
  if (reasons === undefined) suspendClaims.set(owner, (reasons = new Set()))
  reasons.add(reason)
  cancelDelayedSuspend(owner, reason)
  const context = engine?.context
  if (context === undefined) return
  if (afterSeconds <= 0) {
    void settle(context.suspend())
    return
  }
  let pending = delayedSuspends.get(owner)
  if (pending === undefined) delayedSuspends.set(owner, (pending = new Map()))
  pending.set(
    reason,
    globalThis.setTimeout(() => {
      cancelDelayedSuspend(owner, reason)
      // Only a claim still held suspends: a released or disposed owner's timer is inert.
      if (suspendClaims.get(owner)?.has(reason) === true) void settle(context.suspend())
    }, afterSeconds * 1000),
  )
}

/** Releases `owner`'s `reason`; the context resumes once no claim of any owner holds it. */
export function releaseAudioSuspend(reason: SuspendReason, owner: AudioOwner = sharedOwner): Promise<void> {
  const reasons = suspendClaims.get(owner)
  reasons?.delete(reason)
  if (reasons?.size === 0) suspendClaims.delete(owner)
  cancelDelayedSuspend(owner, reason)
  const context = engine?.context
  if (context === undefined || suspendHeld()) return Promise.resolve()
  return settle(context.resume())
}

/**
 * Drops every claim `owner` holds (a disposed music director): its suspension
 * reasons, its pending delayed suspends and its audible claim. Another owner's
 * claims stay; the context resumes only if this owner was the last holding it.
 * The shared context is never closed.
 */
export function releaseAudioOwner(owner: AudioOwner): Promise<void> {
  const held = suspendClaims.delete(owner)
  for (const timer of delayedSuspends.get(owner)?.values() ?? []) globalThis.clearTimeout(timer)
  delayedSuspends.delete(owner)
  audibleOwners.delete(owner)
  const context = engine?.context
  if (!held || context === undefined || suspendHeld()) return Promise.resolve()
  return settle(context.resume())
}

/** True while any owner's adaptive music is audible: the score then owns the sub at big impacts. */
export function isMusicAudible(): boolean {
  return audibleOwners.size > 0
}

export function setMusicAudible(audible: boolean, owner: AudioOwner = sharedOwner): void {
  if (audible) audibleOwners.add(owner)
  else audibleOwners.delete(owner)
}

/** Gameplay alerts (threat-warning, target-lock, fire-window) duck the music bus. */
export function onAudioAlert(listener: (cue: AlertCue) => void): () => void {
  alertListeners.add(listener)
  return () => alertListeners.delete(listener)
}

export function emitAudioAlert(cue: AlertCue): void {
  for (const listener of alertListeners) listener(cue)
}

/**
 * The music director's view of the engine (full mode). Each call is a new
 * owner: its suspension and audible claims are its own, and once released it
 * can no longer suspend, resume or mark music audible.
 */
export function createEngineMusicHost(): MusicHost | null {
  const current = ensureAudioEngine()
  if (current === null) return null
  const owner: AudioOwner = {}
  let released = false
  return {
    context: current.context,
    musicBus: current.musicBus,
    layersBus: current.layersBus,
    stingerBus: current.stingerBus,
    suspend(reason, afterSeconds) {
      if (!released) requestAudioSuspend(reason, afterSeconds, owner)
    },
    resume(reason) {
      return released ? Promise.resolve() : releaseAudioSuspend(reason, owner)
    },
    setMusicAudible(audible) {
      if (!released) setMusicAudible(audible, owner)
    },
    release() {
      if (released) return
      released = true
      void releaseAudioOwner(owner)
    },
  }
}

/** Tests only: forget the singleton and every registered listener. */
export function resetAudioEngineForTests(): void {
  for (const pending of delayedSuspends.values()) for (const timer of pending.values()) globalThis.clearTimeout(timer)
  delayedSuspends.clear()
  suspendClaims.clear()
  alertListeners.clear()
  audibleOwners.clear()
  if (typeof document !== 'undefined') document.removeEventListener('pointerdown', resumeOnGesture)
  engine = null
}
