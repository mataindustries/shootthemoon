/**
 * Frame arithmetic and asset contract from handoff sections 1, 2 and 9.
 *
 *   node --experimental-strip-types --test scripts/music/musicSpec.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSET_IDS,
  bitrateFor,
  CONTEXT_SAMPLE_RATES,
  FRAMES_PER_BAR,
  FRAMES_PER_BEAT,
  GUARD_FRAMES,
  GUARDED_LOOP_FRAMES,
  LOOP_FRAMES,
  LOOP_SECONDS,
  LOOP_SPECS,
  loopRegions,
  positionToFrames,
  RENDER_FRAMES,
  RENDER_SECONDS,
  STINGER_SPECS,
  stingerFrames,
} from './musicSpec.ts'

test('100 BPM grid: beat 26,460, bar 105,840 frames at 44.1 kHz', () => {
  assert.equal(FRAMES_PER_BEAT, 26_460)
  assert.equal(FRAMES_PER_BAR, 105_840)
})

test('16-bar loop is 1,693,440 frames = 38.4 s; 48-bar render is 5,080,320 frames = 115.2 s', () => {
  assert.equal(LOOP_FRAMES, 1_693_440)
  assert.equal(LOOP_FRAMES / 44_100, LOOP_SECONDS)
  assert.equal(RENDER_FRAMES, 5_080_320)
  assert.equal(RENDER_FRAMES / 44_100, RENDER_SECONDS)
  // 61,440 ticks at 960 PPQ × 27.5625 frames per tick (bible section 6).
  assert.equal(16 * 4 * 960 * 27.5625, LOOP_FRAMES)
  // FluidSynth 64-frame blocks stay periodic.
  assert.equal(LOOP_FRAMES % 64, 0)
})

test('guard is 8,820 frames; guarded loop is 1,711,080 frames = 38.8 s', () => {
  assert.equal(GUARD_FRAMES, 8_820)
  assert.equal(GUARDED_LOOP_FRAMES, 1_711_080)
  assert.equal(GUARDED_LOOP_FRAMES / 44_100, 38.8)
})

test('cycle 2 is [1,693,440, 3,386,880); cycle 3 starts at 3,386,880; guarded source is [1,684,620, 3,395,700)', () => {
  const regions = loopRegions()
  assert.deepEqual(regions.production, { start: 1_693_440, end: 3_386_880 })
  assert.deepEqual(regions.proof, { start: 3_386_880, end: 5_080_320 })
  assert.deepEqual(regions.preGuard, { start: 1_684_620, end: 1_693_440 })
  assert.deepEqual(regions.preGuardProof, { start: 3_378_060, end: 3_386_880 })
  assert.deepEqual(regions.postGuard, { start: 3_386_880, end: 3_395_700 })
  assert.deepEqual(regions.guarded, { start: 1_684_620, end: 3_395_700 })
  assert.equal(regions.guarded.end - regions.guarded.start, GUARDED_LOOP_FRAMES)
})

test('runtime loop region [0.2 s, 38.6 s) is whole frames at every context rate', () => {
  for (const rate of CONTEXT_SAMPLE_RATES) {
    assert.ok(Number.isInteger((rate * 384) / 10), `loop at ${rate} Hz`)
    assert.ok(Number.isInteger((rate * 2) / 10), `guard at ${rate} Hz`)
    assert.ok(Number.isInteger((rate * 386) / 10), `loop end at ${rate} Hz`)
  }
  assert.equal(0.2 * 44_100, GUARD_FRAMES)
  assert.equal(Math.round(38.6 * 44_100), GUARD_FRAMES + LOOP_FRAMES)
})

test('seven stinger length contracts', () => {
  const expected: Record<string, number> = {
    'vesper-arrival': 211_680,
    'first-strike': 529_200,
    'vesper-retaliation': 105_840,
    'divider-contact': 105_840,
    'outcome-hold': 105_840,
    'outcome-breach': 211_680,
    'territory-claimed': 423_360,
  }
  assert.deepEqual(STINGER_SPECS.map((spec) => spec.id), Object.keys(expected))
  for (const spec of STINGER_SPECS) assert.equal(stingerFrames(spec), expected[spec.id], spec.id)
})

test('sync positions: first-strike impact at 2:4+1/6 = 4.6 s = 202,860 frames; others at content 0', () => {
  assert.equal(positionToFrames('2:4+1/6'), 202_860)
  assert.equal(positionToFrames('2:4+1/6') / 44_100, 4.6)
  assert.equal(positionToFrames('1:1'), 0)
  assert.equal(positionToFrames('1:1+1/16'), 6_615) // outcome-breach boom offset (+0.15 s)
  for (const spec of STINGER_SPECS) {
    if (spec.id !== 'first-strike') assert.equal(positionToFrames(spec.syncPosition), 0, spec.id)
  }
  assert.throws(() => positionToFrames('1:5'))
  assert.throws(() => positionToFrames('0:1'))
  assert.throws(() => positionToFrames('1:1+1/128'), /does not land on a frame/)
})

test('locked channel layouts, bitrates and level targets', () => {
  assert.deepEqual(
    LOOP_SPECS.map((spec) => [spec.id, spec.channels, bitrateFor(spec.channels), spec.unityLufs, spec.lufsTolerance, spec.truePeakCeilingDbtp]),
    [
      ['bed', 2, 160, -26, 1, -14],
      ['engine', 1, 96, -27, 1, -12],
      ['pressure', 1, 96, -25, 1, -12],
      ['assault', 1, 96, -20, 1, -7],
      ['claim', 2, 160, -23, 1, -10],
    ],
  )
  assert.deepEqual(
    STINGER_SPECS.map((spec) => [spec.id, spec.channels, spec.truePeakCeilingDbtp, spec.priority]),
    [
      ['vesper-arrival', 1, -9, 70],
      ['first-strike', 2, -2, 100],
      ['vesper-retaliation', 1, -9, 70],
      ['divider-contact', 1, -11, 50],
      ['outcome-hold', 1, -9, 60],
      ['outcome-breach', 1, -6, 80],
      ['territory-claimed', 2, -5, 90],
    ],
  )
  assert.equal(ASSET_IDS.length, 12)
})
