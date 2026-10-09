/**
 * One automated gain, modeled by the director itself (handoff 6.3: "the
 * director models every lane itself; never read future values from
 * AudioParam"). A lane is a list of moves, each a dB-linear (exponential)
 * ramp from whatever the lane holds at its start to a target. Whenever moves
 * change, the lane rewrites its AudioParam from `now`:
 *
 *   cancelScheduledValues(now); setValueAtTime(model(now), now); ...moves
 *
 * so an interrupted ramp continues on its own curve and nothing jumps.
 */
import type { AudioParamLike } from '../audioTypes.ts'
import { OFF_GAIN } from './musicConstants.ts'

export type MoveOwner =
  | 'start'
  | 'cue'
  | 'rotation'
  | 'join'
  | 'plan'
  | 'duck'
  | 'alert'
  | 'mute'
  | 'stinger'

export interface LaneMove {
  readonly owner: MoveOwner
  /** When the ramp begins (audio time). */
  readonly start: number
  /** When the target is reached; equal to `start` for an instant set. */
  readonly end: number
  /** Linear gain; 0 is off (the ramp ends at −60 dB, then sets 0). */
  readonly target: number
}

interface LaneEvent {
  readonly kind: 'set' | 'exp'
  readonly time: number
  readonly value: number
}

function eventValueAt(events: readonly LaneEvent[], time: number): number {
  let index = -1
  for (let i = 0; i < events.length; i += 1) {
    if ((events[i] as LaneEvent).time <= time) index = i
    else break
  }
  if (index < 0) return events[0]?.value ?? 0
  const current = events[index] as LaneEvent
  const next = events[index + 1]
  if (next === undefined || next.kind !== 'exp' || next.time <= current.time) return current.value
  if (current.value <= 0 || next.value <= 0) return current.value
  const progress = (time - current.time) / (next.time - current.time)
  return current.value * (next.value / current.value) ** progress
}

/** Events up to `time`, with any ramp spanning it cut to end there on its own curve. */
function truncateAt(events: readonly LaneEvent[], time: number): LaneEvent[] {
  const kept = events.filter((event) => event.time <= time)
  const next = events.find((event) => event.time > time)
  if (next?.kind === 'exp') kept.push({ kind: 'exp', time, value: eventValueAt(events, time) })
  return kept
}

export class GainLane {
  readonly #param: AudioParamLike | null
  #events: LaneEvent[]
  #moves: LaneMove[] = []

  constructor(param: AudioParamLike | null, initial = 0) {
    this.#param = param
    this.#events = [{ kind: 'set', time: 0, value: initial }]
    param?.setValueAtTime(initial, 0)
  }

  valueAt(time: number): number {
    return eventValueAt(this.#events, time)
  }

  /** What the lane holds once every scheduled move has finished. */
  get finalValue(): number {
    return this.#events[this.#events.length - 1]?.value ?? 0
  }

  get moves(): readonly LaneMove[] {
    return this.#moves
  }

  /**
   * Drops the moves `remove` selects, adds `add`, and rewrites the automation
   * from `now`. Moves that have finished by `now` are folded into the model.
   */
  update(now: number, remove: (move: LaneMove) => boolean, add: readonly LaneMove[] = []): void {
    const current = this.valueAt(now)
    const moves = [...this.#moves.filter((move) => move.end > now && !remove(move)), ...add]
    moves.sort((a, b) => a.start - b.start)
    this.#moves = moves

    let events: LaneEvent[] = [{ kind: 'set', time: now, value: current }]
    for (const move of moves) {
      const start = Math.max(move.start, now)
      events = truncateAt(events, start)
      const from = eventValueAt(events, start)
      if (move.end <= start) {
        events.push({ kind: 'set', time: start, value: move.target })
        continue
      }
      events.push({ kind: 'set', time: start, value: Math.max(from, OFF_GAIN) })
      events.push({ kind: 'exp', time: move.end, value: Math.max(move.target, OFF_GAIN) })
      if (move.target <= 0) events.push({ kind: 'set', time: move.end, value: 0 })
    }
    this.#events = events
    this.#write(now)
  }

  /** Cancels every move and holds `value` from `now`. */
  hold(now: number, value: number): void {
    this.#moves = []
    this.#events = [{ kind: 'set', time: now, value }]
    this.#write(now)
  }

  #write(now: number): void {
    const param = this.#param
    if (param === null) return
    param.cancelScheduledValues(now)
    for (const event of this.#events) {
      if (event.kind === 'set') param.setValueAtTime(event.value, event.time)
      else param.exponentialRampToValueAtTime(event.value, event.time)
    }
  }
}

/** A dB-linear ramp to `target` beginning at `start`. */
export function ramp(owner: MoveOwner, start: number, duration: number, target: number): LaneMove {
  return { owner, start, end: start + Math.max(0, duration), target }
}
