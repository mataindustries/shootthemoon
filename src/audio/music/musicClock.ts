/**
 * The shared musical clock (handoff 5 and 6.3). Every time is AudioContext
 * time in seconds, rounded to a whole frame of the context rate. Pure.
 */
import {
  BAR_SECONDS,
  BEAT_SECONDS,
  GUARD_SECONDS,
  LOOKAHEAD_SECONDS,
  LOOP_SECONDS,
  PHRASE_SECONDS,
  START_LEAD_SECONDS,
  SYNC_VISUAL_OFFSET_MS,
} from './musicConstants.ts'

export type QuantizeUnit = 'immediate' | 'beat' | 'bar' | 'phrase'

export const UNIT_SECONDS: Readonly<Record<Exclude<QuantizeUnit, 'immediate'>, number>> = Object.freeze({
  beat: BEAT_SECONDS,
  bar: BAR_SECONDS,
  phrase: PHRASE_SECONDS,
})

/** Guards ceil() against a quotient that lands a hair above a whole number. */
const BOUNDARY_EPSILON = 1e-9

export function roundToFrame(time: number, sampleRate: number): number {
  return Math.round(time * sampleRate) / sampleRate
}

/** epoch = round((currentTime + 0.15) × sr) / sr. */
export function epochFor(currentTime: number, sampleRate: number): number {
  return roundToFrame(currentTime + START_LEAD_SECONDS, sampleRate)
}

export interface BoundaryOptions {
  /** The boundary may not precede this; defaults to now + 0.10 s. */
  readonly earliest?: number
  /** Grid origin relative to the epoch (rotation uses bar 9). */
  readonly offset?: number
}

/**
 * B = epoch + ceil((now + 0.10 − epoch) / unit) × unit, then rounded to a
 * whole frame. `earliest` replaces now + 0.10 when a step must lead its
 * boundary (a BEAT stinger whose sync point is not at its start).
 */
export function nextBoundary(
  now: number,
  epoch: number,
  unitSeconds: number,
  sampleRate: number,
  options: BoundaryOptions = {},
): number {
  const origin = epoch + (options.offset ?? 0)
  const earliest = options.earliest ?? now + LOOKAHEAD_SECONDS
  const units = Math.ceil((earliest - origin) / unitSeconds - BOUNDARY_EPSILON)
  return roundToFrame(origin + units * unitSeconds, sampleRate)
}

export function quantize(unit: QuantizeUnit, now: number, epoch: number, sampleRate: number): number {
  if (unit === 'immediate') return roundToFrame(now + LOOKAHEAD_SECONDS, sampleRate)
  return nextBoundary(now, epoch, UNIT_SECONDS[unit], sampleRate)
}

/** Loop and guard lengths are whole frames at every common context rate. */
export function loopFrames(sampleRate: number): number {
  return Math.round(LOOP_SECONDS * sampleRate)
}

export function guardFrames(sampleRate: number): number {
  return Math.round(GUARD_SECONDS * sampleRate)
}

/**
 * Buffer offset for a layer started at `time`: 0.2 + mod(time − epoch, 38.4).
 * Computed in frames so every layer, started early or late, shares one playhead.
 */
export function layerStartOffset(time: number, epoch: number, sampleRate: number): number {
  const cycle = loopFrames(sampleRate)
  const elapsed = Math.round((time - epoch) * sampleRate)
  const phase = ((elapsed % cycle) + cycle) % cycle
  return (guardFrames(sampleRate) + phase) / sampleRate
}

export interface TimestampedClock {
  readonly currentTime: number
  readonly state?: string
  getOutputTimestamp?(): { readonly contextTime?: number; readonly performanceTime?: number }
}

/**
 * A larger disagreement than this between the output timestamp and the
 * currentTime fallback means one clock is not real (a test's fake timers) or
 * the timestamp is stale; the fallback is then the safer map.
 */
const OUTPUT_TIMESTAMP_SANITY_SECONDS = 1

/**
 * A(perfMs): the audio time at which a sound is heard together with the frame
 * that shows a game timestamp, including SYNC_VISUAL_OFFSET_MS.
 */
export function audioTimeFor(
  clock: TimestampedClock,
  perfMs: number,
  perfNowMs: number,
  offsetMs: number = SYNC_VISUAL_OFFSET_MS,
): number {
  const fallback = clock.currentTime + (perfMs + offsetMs - perfNowMs) / 1000
  if (clock.state !== undefined && clock.state !== 'running') return fallback
  const stamp = clock.getOutputTimestamp?.()
  const contextTime = stamp?.contextTime
  const performanceTime = stamp?.performanceTime
  if (contextTime === undefined || performanceTime === undefined || !(performanceTime > 0)) return fallback
  const mapped = contextTime + (perfMs + offsetMs - performanceTime) / 1000
  return Math.abs(mapped - fallback) <= OUTPUT_TIMESTAMP_SANITY_SECONDS ? mapped : fallback
}

export interface StingerPlacement {
  /** When the sync point sounds. */
  readonly sync: number
  /** When content 0 sounds (sync − syncSeconds); may be in the past. */
  readonly start: number
  /** Arguments for AudioBufferSourceNode.start(). */
  readonly when: number
  readonly offset: number
}

/**
 * Handoff 6.3: BEAT stingers sync on the first beat with sync − syncSeconds ≥
 * now + 0.10; EXACT and IMMEDIATE ones sync at the given time. A start in the
 * past begins now, at the elapsed offset, so the sync point stays on time.
 */
export function placeStinger(
  timing: 'beat' | 'exact' | 'immediate',
  syncSeconds: number,
  now: number,
  epoch: number,
  sampleRate: number,
  exactSync: number | null = null,
): StingerPlacement {
  let sync: number
  if (timing === 'beat') {
    sync = nextBoundary(now, epoch, BEAT_SECONDS, sampleRate, {
      earliest: now + LOOKAHEAD_SECONDS + syncSeconds,
    })
  } else if (timing === 'exact' && exactSync !== null) {
    sync = roundToFrame(exactSync, sampleRate)
  } else {
    sync = roundToFrame(now + LOOKAHEAD_SECONDS, sampleRate)
  }
  const start = roundToFrame(sync - syncSeconds, sampleRate)
  return start < now
    ? { sync, start, when: now, offset: GUARD_SECONDS + (now - start) }
    : { sync, start, when: start, offset: GUARD_SECONDS }
}
