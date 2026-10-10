import { describe, expect, it } from 'vitest'
import { GainLane, ramp } from './gainLane.ts'
import { FakeAudioParam } from './testing/fakeAudioContext.ts'

/** The lane's own model and what Web Audio would play from its automation agree everywhere. */
function expectParamMatchesModel(lane: GainLane, param: FakeAudioParam, from: number, to: number): void {
  for (let index = 0; index <= 400; index += 1) {
    const time = from + ((to - from) * index) / 400
    expect(param.valueAt(time), `t=${time}`).toBeCloseTo(lane.valueAt(time), 9)
  }
}

describe('GainLane', () => {
  it('ramps dB-linearly from the held value to the target, and holds before the move starts', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 1)
    lane.update(0, () => false, [ramp('cue', 2, 1, 0.1)])
    expect(lane.valueAt(1.9)).toBe(1)
    expect(lane.valueAt(2.5)).toBeCloseTo(10 ** (-10 / 20), 9)
    expect(lane.valueAt(3)).toBeCloseTo(0.1, 9)
    expect(lane.finalValue).toBeCloseTo(0.1, 9)
    expectParamMatchesModel(lane, param, 0, 4)
  })

  it('turns a layer off with a ramp to −60 dB and then 0, and back on from the floor', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 0.5)
    lane.update(0, () => false, [ramp('cue', 1, 1, 0), ramp('cue', 3, 2, 0.25)])
    expect(lane.valueAt(1.999)).toBeGreaterThan(0.001)
    expect(lane.valueAt(2)).toBe(0)
    expect(lane.valueAt(2.9)).toBe(0)
    expect(lane.valueAt(3)).toBeCloseTo(0.001, 9)
    expect(lane.valueAt(4)).toBeCloseTo(Math.sqrt(0.001 * 0.25), 9)
    expect(lane.valueAt(5)).toBeCloseTo(0.25, 9)
    expectParamMatchesModel(lane, param, 0, 6)
  })

  it('re-planned mid-ramp, it continues on its own curve without a jump', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 1)
    lane.update(0, () => false, [ramp('cue', 1, 4, 0.01)])
    const before = lane.valueAt(3)
    // At t = 2, a new move is planned from t = 3: the first ramp still runs until then.
    lane.update(2, (move) => move.start >= 3, [ramp('cue', 3, 1, 0.5)])
    expect(lane.valueAt(2.5)).toBeCloseTo(10 ** ((-40 * 1.5) / 4 / 20), 9)
    expect(lane.valueAt(3)).toBeCloseTo(before, 9)
    expect(lane.valueAt(4)).toBeCloseTo(0.5, 9)
    expectParamMatchesModel(lane, param, 2, 5)
    // The AudioParam was rewritten from `now`, never read back.
    expect(param.calls.filter((call) => call.method === 'cancel').map((call) => call.time)).toEqual([0, 2])
  })

  it('supersedes moves at and after a boundary, keeps earlier ones, and folds finished moves into the model', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 0)
    lane.update(0, () => false, [ramp('start', 1, 1, 0.5), ramp('rotation', 10, 1, 0.1)])
    lane.update(5, (move) => move.owner === 'rotation' && move.start >= 6, [ramp('cue', 6, 1, 0.25)])
    expect(lane.moves.map((move) => move.owner)).toEqual(['cue'])
    expect(lane.valueAt(5.5)).toBeCloseTo(0.5, 9)
    expect(lane.valueAt(12)).toBeCloseTo(0.25, 9)
    expectParamMatchesModel(lane, param, 5, 13)
  })

  it('applies overlapping moves in time order, each from where the previous one has reached', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 1)
    lane.update(0, () => false, [ramp('cue', 1, 2, 0.01), ramp('duck', 2, 1, 1)])
    expect(lane.valueAt(2)).toBeCloseTo(0.1, 9)
    expect(lane.valueAt(3)).toBeCloseTo(1, 9)
    expectParamMatchesModel(lane, param, 0, 4)
  })

  it('hold() cancels everything and holds a value', () => {
    const param = new FakeAudioParam(0)
    const lane = new GainLane(param, 1)
    lane.update(0, () => false, [ramp('cue', 1, 1, 0.1)])
    lane.hold(0.5, 0)
    expect(lane.moves).toEqual([])
    expect(lane.valueAt(3)).toBe(0)
    expect(param.valueAt(3)).toBe(0)
  })
})
