import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { INTERNAL_FADE_SAMPLES, joinKeepRanges, narrationPlan, validateSelects, type VoSelects } from './narration.ts'

const selects = JSON.parse(readFileSync(new URL('vo-selects.json', import.meta.url), 'utf8')) as VoSelects

test('all 21 exact sample ranges fit the original 19,128,516-sample session and Option A', () => {
  assert.deepEqual(validateSelects(selects, 19_128_516), [])
  const p = narrationPlan(selects)
  assert.equal(p.length, 21)
  assert.equal(p[5]!.from, 2646) // 44.1 seconds, corrected floating-point floor.
  assert.equal(p[20]!.startSample, 8_136_000)
  assert.equal(p[20]!.endSample, 8_254_080)
  assert.equal(p.reduce((n, l) => n + l.outputSamples, 0), 5_808_476)
  assert.deepEqual(p.filter((l) => l.sourceSamples !== l.editedSourceSamples).map((l) => l.id), ['L07', 'L11', 'L15'])
})

test('sample join preserves a single take, crossfades only the overlap, and loses exactly 662 samples per selected edit', () => {
  const a = Float32Array.from({ length: 2000 }, (_, i) => i / 2000)
  const b = Float32Array.from({ length: 2000 }, (_, i) => -i / 2000)
  assert.deepEqual(joinKeepRanges([a]), a)
  const joined = joinKeepRanges([a, b])
  assert.equal(joined.length, a.length + b.length - INTERNAL_FADE_SAMPLES)
  assert.deepEqual(joined.subarray(0, a.length - INTERNAL_FADE_SAMPLES), a.subarray(0, a.length - INTERNAL_FADE_SAMPLES))
  assert.deepEqual(joined.subarray(a.length), b.subarray(INTERNAL_FADE_SAMPLES))
  assert.equal(joined[a.length - INTERNAL_FADE_SAMPLES], a[a.length - INTERNAL_FADE_SAMPLES])
  assert.ok(Math.abs(joined[a.length - 1]! - b[INTERNAL_FADE_SAMPLES - 1]!) < 1e-6)
})

test('out-of-recording ranges, overlapping samples, and unauthorized pause edits fail', () => {
  const changed = JSON.parse(JSON.stringify(selects))
  changed.lines[0].select.keep[0].toSample = 20_000_000
  assert.ok(validateSelects(changed, 19_128_516).some((p) => p.includes('invalid/overlapping')))
  changed.lines[0].select.keep = [...selects.lines[0]!.select.keep, ...selects.lines[0]!.select.keep]
  assert.ok(validateSelects(changed).some((p) => p.includes('unauthorized tightened pause')))
})
