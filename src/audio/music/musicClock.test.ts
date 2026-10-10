import { describe, expect, it } from 'vitest'
import {
  audioTimeFor,
  epochFor,
  guardFrames,
  layerStartOffset,
  loopFrames,
  nextBoundary,
  placeStinger,
  quantize,
  roundToFrame,
} from './musicClock.ts'
import { GUARD_SECONDS, LOOP_END_SECONDS, LOOP_SECONDS, LOOP_START_SECONDS, ROTATION_OFFSET_SECONDS } from './musicConstants.ts'

const RATES = [8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000] as const
const isWholeFrame = (time: number, rate: number) => Math.abs(time * rate - Math.round(time * rate)) < 1e-6

describe('music clock', () => {
  it('loop and guard are whole frames at every common context rate', () => {
    for (const rate of RATES) {
      expect(LOOP_SECONDS * rate).toBeCloseTo(Math.round(LOOP_SECONDS * rate), 6)
      expect(GUARD_SECONDS * rate).toBeCloseTo(Math.round(GUARD_SECONDS * rate), 6)
      expect(loopFrames(rate)).toBe(Math.round(38.4 * rate))
      expect(guardFrames(rate)).toBe(Math.round(0.2 * rate))
      expect(isWholeFrame(LOOP_START_SECONDS, rate) && isWholeFrame(LOOP_END_SECONDS, rate)).toBe(true)
    }
    expect(loopFrames(44_100)).toBe(1_693_440)
    expect(loopFrames(48_000)).toBe(1_843_200)
    expect(guardFrames(44_100)).toBe(8_820)
  })

  it('sets the epoch 0.15 s ahead on a whole frame', () => {
    expect(epochFor(10, 48_000)).toBe(10.15)
    const epoch = epochFor(3.000_01, 44_100)
    expect(isWholeFrame(epoch, 44_100)).toBe(true)
    expect(Math.abs(epoch - 3.150_01)).toBeLessThanOrEqual(0.5 / 44_100)
  })

  it('quantizes BEAT, BAR and PHRASE boundaries with the 0.10 s lookahead', () => {
    const epoch = 1
    expect(nextBoundary(1.55, epoch, 0.6, 48_000)).toBe(2.2)
    expect(nextBoundary(1.55, epoch, 2.4, 48_000)).toBe(3.4)
    expect(nextBoundary(1.55, epoch, 9.6, 48_000)).toBe(10.6)
    // A boundary exactly 0.10 s ahead is still usable; 0.09 s ahead is not.
    expect(nextBoundary(2.1, epoch, 0.6, 48_000)).toBe(2.2)
    expect(nextBoundary(2.11, epoch, 0.6, 48_000)).toBe(2.8)
    // Before the epoch the first boundary is the epoch itself.
    expect(nextBoundary(0.8, epoch, 2.4, 48_000)).toBe(1)
    expect(quantize('immediate', 5, epoch, 48_000)).toBe(5.1)
    expect(quantize('beat', 1.55, epoch, 48_000)).toBe(2.2)
    expect(quantize('phrase', 11, epoch, 48_000)).toBe(20.2)
  })

  it('rounds every boundary to a whole frame, also over long sessions', () => {
    for (const rate of RATES) {
      const epoch = roundToFrame(0.123_456, rate)
      for (const now of [0.5, 37.9, 1_234.567, 7_777.7]) {
        for (const unit of [0.6, 2.4, 9.6]) {
          const boundary = nextBoundary(now, epoch, unit, rate)
          expect(isWholeFrame(boundary, rate)).toBe(true)
          expect(boundary).toBeGreaterThanOrEqual(now + 0.1 - 1 / rate)
          expect(boundary - unit).toBeLessThan(now + 0.1)
          expect(Math.abs((boundary - epoch) / unit - Math.round((boundary - epoch) / unit))).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('places rotation windows on bar-9 boundaries of the loop', () => {
    const epoch = 2
    expect(nextBoundary(2, epoch, LOOP_SECONDS, 48_000, { offset: ROTATION_OFFSET_SECONDS, earliest: 2 })).toBe(21.2)
    expect(nextBoundary(30, epoch, LOOP_SECONDS, 48_000, { offset: ROTATION_OFFSET_SECONDS, earliest: 30 })).toBeCloseTo(59.6, 9)
  })

  it('late-join offset = 0.2 + mod(t − epoch, 38.4), in whole frames', () => {
    const epoch = 10.15
    expect(layerStartOffset(epoch, epoch, 48_000)).toBe(0.2)
    expect(layerStartOffset(epoch + 5, epoch, 48_000)).toBeCloseTo(5.2, 9)
    expect(layerStartOffset(epoch + 38.4, epoch, 48_000)).toBe(0.2)
    expect(layerStartOffset(epoch + 38.4 * 25 + 1.25, epoch, 48_000)).toBeCloseTo(1.45, 9)
    for (const rate of RATES) {
      const offset = layerStartOffset(epoch + 123.456, epoch, rate)
      expect(isWholeFrame(offset, rate)).toBe(true)
      expect(offset).toBeGreaterThanOrEqual(LOOP_START_SECONDS)
      expect(offset).toBeLessThan(LOOP_END_SECONDS)
    }
  })

  it('maps a performance.now() time to audio time with SYNC_VISUAL_OFFSET_MS, with or without getOutputTimestamp', () => {
    const fallback = { currentTime: 100, state: 'running' }
    expect(audioTimeFor(fallback, 5_000, 4_000)).toBeCloseTo(100 + 1.04, 9)
    expect(audioTimeFor(fallback, 5_000, 4_000, 0)).toBeCloseTo(101, 9)
    const stamped = {
      currentTime: 100,
      state: 'running',
      getOutputTimestamp: () => ({ contextTime: 99.97, performanceTime: 3_990 }),
    }
    expect(audioTimeFor(stamped, 5_000, 4_000)).toBeCloseTo(99.97 + 1.05, 9)
    // An empty or zero timestamp (context not rendering yet) falls back.
    expect(audioTimeFor({ ...stamped, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }, 5_000, 4_000)).toBeCloseTo(101.04, 9)
    expect(audioTimeFor({ ...stamped, state: 'suspended' }, 5_000, 4_000)).toBeCloseTo(101.04, 9)
    // A timestamp from another clock (a test's fake timers) is not trusted.
    expect(audioTimeFor({ ...stamped, getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 900_000 }) }, 5_000, 4_000)).toBeCloseTo(101.04, 9)
  })

  it('places BEAT stingers on the first beat their content can reach, EXACT ones on their sync time', () => {
    const epoch = 1
    expect(placeStinger('beat', 0, 1.55, epoch, 48_000)).toEqual({ sync: 2.2, start: 2.2, when: 2.2, offset: 0.2 })
    // A sync point 4.6 s into the content needs its start ≥ now + 0.10.
    const late = placeStinger('beat', 4.6, 1.55, epoch, 48_000)
    expect(late.start).toBeGreaterThanOrEqual(1.65)
    expect(late.sync - late.start).toBeCloseTo(4.6, 9)
    expect(placeStinger('exact', 4.6, 3, epoch, 48_000, 10)).toEqual({ sync: 10, start: 5.4, when: 5.4, offset: 0.2 })
    // Already past its start: begin now, at the elapsed offset, so the sync point stays on time.
    const behind = placeStinger('exact', 4.6, 7, epoch, 48_000, 10)
    expect(behind.when).toBe(7)
    expect(behind.offset).toBeCloseTo(0.2 + 1.6, 9)
    expect(placeStinger('immediate', 0, 3, epoch, 48_000)).toEqual({ sync: 3.1, start: 3.1, when: 3.1, offset: 0.2 })
  })
})
