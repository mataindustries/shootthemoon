/**
 * Mix-table transcription, arithmetic headroom bounds (reproducing the
 * bible's verification record, section 24), stinger contexts, duck
 * envelopes and audition definitions.
 *
 *   node --experimental-strip-types --test scripts/music/combinations.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  arithmeticLayerPeakDbfs,
  arithmeticStingerPeakDbfs,
  AUDITIONS,
  auditionGains,
  findVariant,
  layerGainAt,
  layerMixVariants,
  mixLayers,
  peakSummary,
  renderStingerWindows,
  stingerAuditContexts,
} from './combinations.ts'
import { FRAMES_PER_BAR, LOOP_IDS, LOOP_SPECS, type LoopId, MIX_TABLE, STINGER_SPECS, type StingerId } from './musicSpec.ts'

const CEILINGS = Object.fromEntries(LOOP_SPECS.map((spec) => [spec.id, spec.truePeakCeilingDbtp])) as Record<LoopId, number>
const stinger = (id: StingerId) => STINGER_SPECS.find((spec) => spec.id === id)!
const round2 = (value: number) => Math.round(value * 100) / 100

test('layer mix variants: every audible cue, siege arc cells resolved, gain-raising modifiers at maximum', () => {
  const variants = layerMixVariants()
  const ids = variants.map((variant) => variant.id)
  assert.ok(!ids.includes('SILENT') && !ids.includes('FS_VACUUM'))
  for (const cue of Object.keys(MIX_TABLE)) if (Object.keys(MIX_TABLE[cue as keyof typeof MIX_TABLE]).length > 0) assert.ok(ids.includes(cue), cue)
  assert.deepEqual(findVariant(variants, 'SIEGE_COMBAT').gains, { bed: -4, engine: -8, assault: 0 })
  assert.deepEqual(findVariant(variants, 'SIEGE_COMBAT@CONTESTED').gains, { bed: -4, engine: -8, pressure: -12, assault: 0 })
  assert.deepEqual(findVariant(variants, 'SIEGE_COMBAT@CLAIMED').gains, { bed: -4, engine: -8, assault: 0, claim: -10 })
  assert.deepEqual(findVariant(variants, 'CONTESTED+tier').gains, { bed: 0, engine: -2, pressure: -10 })
  assert.deepEqual(findVariant(variants, 'ASCENDANT+tier+damaged').gains, { bed: 0, engine: -5, pressure: -14 })
  assert.deepEqual(findVariant(variants, 'CLAIMED+helios').gains, { bed: 0, engine: -4, claim: 0 })
  assert.equal(new Set(ids).size, ids.length)
  // Invariant I1: CLAIM and PRESSURE never sound together; I2: nothing above 0 dB.
  for (const variant of variants) {
    assert.ok(!(variant.gains.claim !== undefined && variant.gains.pressure !== undefined), variant.id)
    for (const layer of LOOP_IDS) assert.ok((variant.gains[layer] ?? -Infinity) <= 0, `${variant.id} ${layer}`)
  }
})

test('arithmetic H1 reproduces the bible: worst layer mix CS_COMBAT at −1.40 dBFS', () => {
  const variants = layerMixVariants()
  const bound = (id: string) => round2(arithmeticLayerPeakDbfs(findVariant(variants, id).gains, CEILINGS))
  assert.equal(bound('CS_COMBAT'), -1.4)
  assert.equal(bound('RECON'), -17)
  assert.equal(bound('FOOTHOLD'), -11.61)
  assert.equal(bound('CLAIMED'), -4.21) // bible 4.4: −4.2
  assert.equal(bound('SIEGE_COMBAT@CLAIMED'), -2.24) // bible 4.4 footnote: worst arc addition −2.2 dBFS
  assert.equal(bound('SIEGE_COMBAT@CONTESTED'), -2.67)
  const worst = variants.reduce((best, variant) => (arithmeticLayerPeakDbfs(variant.gains, CEILINGS) > arithmeticLayerPeakDbfs(best.gains, CEILINGS) ? variant : best))
  assert.equal(worst.id, 'CS_COMBAT')
  for (const variant of variants) assert.ok(arithmeticLayerPeakDbfs(variant.gains, CEILINGS) <= -1, variant.id)
})

test('arithmetic H2 reproduces the bible: worst pair MONUMENT_COMBAT + third-wave divider-contact at −1.13 dBFS', () => {
  const variants = layerMixVariants()
  const contexts = stingerAuditContexts(variants, STINGER_SPECS)
  const bound = (context: (typeof contexts)[number]) => arithmeticStingerPeakDbfs(context, stinger(context.stinger), CEILINGS, stinger(context.stinger).truePeakCeilingDbtp)
  const worst = contexts.reduce((best, context) => (bound(context) > bound(best) ? context : best))
  assert.equal(worst.id, 'divider-contact|MONUMENT_COMBAT|+2dB')
  assert.equal(round2(bound(worst)), -1.13)
  for (const context of contexts) assert.ok(bound(context) <= -1, context.id)
})

test('stinger contexts cover every stinger on both sides of its edges', () => {
  const contexts = stingerAuditContexts(layerMixVariants(), STINGER_SPECS)
  const ids = new Set(contexts.map((context) => context.id))
  for (const spec of STINGER_SPECS) assert.ok(contexts.some((context) => context.stinger === spec.id), spec.id)
  for (const id of [
    'vesper-arrival|REVEAL_APPROACH',
    'vesper-arrival|FOOTHOLD_WORKS+tier',
    'first-strike|FS_TRANSMISSION',
    'vesper-retaliation|CS_ALERT',
    'divider-contact|SIEGE_ALERT@CONTESTED',
    'divider-contact|SIEGE_COMBAT@CLAIMED|+1dB',
    'divider-contact|MONUMENT_COMBAT|+2dB',
    'outcome-hold|MONUMENT_ACTIVATING',
    'outcome-breach|CS_IMPACT',
    'territory-claimed|MONUMENT_REVEAL',
  ]) {
    assert.ok(ids.has(id), id)
  }
  assert.equal(ids.size, contexts.length)
  assert.ok(contexts.filter((context) => context.stinger === 'territory-claimed').every((context) => context.resumeVariant?.id === 'CLAIMED+helios'))
})

test('duck envelope: dB-linear 0.4 s attack from the stinger start, hold, release', () => {
  const variants = layerMixVariants()
  const [context] = stingerAuditContexts(variants, STINGER_SPECS).filter((entry) => entry.id === 'outcome-hold|CS_COMBAT')
  const spec = stinger('outcome-hold')
  const gainDb = (t: number) => 20 * Math.log10(layerGainAt(context!, spec, 'assault', t, 44_100))
  assert.ok(Math.abs(gainDb(-1)) < 1e-9)
  assert.ok(Math.abs(gainDb(0)) < 1e-9)
  assert.ok(Math.abs(gainDb(8_820) + 4) < 1e-9) // halfway through the 0.4 s fade
  assert.ok(Math.abs(gainDb(17_640) + 8) < 1e-9)
  assert.ok(Math.abs(gainDb(FRAMES_PER_BAR - 1) + 8) < 1e-9)
  assert.ok(Math.abs(gainDb(FRAMES_PER_BAR + 17_640)) < 1e-9)
  assert.equal(layerGainAt(context!, spec, 'claim', 0, 44_100), 0) // not in the mix
})

test('vacuum: every layer is off 0.6 s before the first-strike impact (content 4.0 s)', () => {
  const [context] = stingerAuditContexts(layerMixVariants(), STINGER_SPECS).filter((entry) => entry.id === 'first-strike|FS_FLIGHT')
  const spec = stinger('first-strike')
  const end = 4.0 * 44_100
  assert.ok(layerGainAt(context!, spec, 'assault', end - 1_765, 44_100) > 0.8)
  assert.ok(layerGainAt(context!, spec, 'assault', end - 1, 44_100) < 0.01)
  assert.equal(layerGainAt(context!, spec, 'assault', end, 44_100), 0)
  assert.equal(layerGainAt(context!, spec, 'bed', 202_860, 44_100), 0)
})

test('stage clear: bed to −12 dB and every other layer off over 0.3 s, then CLAIMED from +8.4 s', () => {
  const [context] = stingerAuditContexts(layerMixVariants(), STINGER_SPECS).filter((entry) => entry.id === 'territory-claimed|MONUMENT_REVEAL')
  const spec = stinger('territory-claimed')
  const db = (layer: LoopId, t: number) => 20 * Math.log10(layerGainAt(context!, spec, layer, t, 44_100))
  assert.ok(Math.abs(db('bed', -1) + 4) < 1e-9)
  assert.ok(Math.abs(db('bed', 13_230) + 12) < 1e-9)
  assert.equal(layerGainAt(context!, spec, 'claim', 13_230, 44_100), 0)
  assert.ok(Math.abs(db('claim', 370_440)) < 1e-9)
  assert.ok(Math.abs(db('engine', 370_440) + 4) < 1e-9)
})

test('stinger windows: 16 evenly spaced loop offsets, faded edges, stinger summed at its gain', () => {
  const cycleFrames = 1_600
  const layer = new Float32Array(cycleFrames * 2).fill(0.1)
  const stingerSignal = new Float32Array(200 * 2).fill(0.25)
  const [context] = stingerAuditContexts(layerMixVariants(), STINGER_SPECS).filter((entry) => entry.id === 'divider-contact|MONUMENT_COMBAT|+2dB')
  const result = renderStingerWindows({
    context: context!,
    spec: stinger('divider-contact'),
    layers: { bed: layer, engine: layer, assault: layer, claim: layer },
    stinger: stingerSignal,
    cycleFrames,
    sampleRate: 44_100,
    marginFrames: 50,
    gapFrames: 10,
  })
  assert.deepEqual(result.offsetsFrames, Array.from({ length: 16 }, (_, k) => k * 100))
  assert.equal(result.samples.length, 16 * (300 + 10) * 2)
  assert.equal(result.samples[0], 0) // raised-cosine edge
  const atStart = result.samples[2 * 50] as number
  const expected = 0.1 * (10 ** (-4 / 20) + 10 ** (-10 / 20) + 1 + 10 ** (-5 / 20)) + 0.25 * 10 ** (2 / 20)
  assert.ok(Math.abs(atStart - expected) < 1e-6, `${atStart} vs ${expected}`)
  assert.equal(result.windowPeaks.length, 16)
})

test('mixLayers sums at unclamped float and peakSummary counts overs', () => {
  const a = new Float32Array([0.6, -0.6, 0.6, 0.6])
  const mix = mixLayers({ bed: 0, assault: 0 }, { bed: a, assault: a }, 2, 2)
  assert.equal(mix.length, 8)
  assert.ok(Math.abs((mix[0] as number) - 1.2) < 1e-6)
  assert.deepEqual(peakSummary(mix).overs, 8)
  assert.throws(() => mixLayers({ claim: 0 }, { bed: a }, 2), /needs layer claim/)
})

test('auditions A–E use the handoff cue gains for exactly the requested layer sets', () => {
  assert.deepEqual(
    AUDITIONS.map((audition) => [audition.id, audition.cue, auditionGains(audition)]),
    [
      ['A', 'RECON', { bed: -3 }],
      ['B', 'FOOTHOLD_WORKS', { bed: 0, engine: -4 }],
      ['C', 'CONTESTED', { bed: 0, engine: -4, pressure: -10 }],
      ['D', 'CS_COMBAT', { bed: -4, engine: -10, pressure: -2, assault: 0 }],
      ['E', 'CLAIMED', { bed: 0, engine: -8, claim: 0 }],
    ],
  )
  for (const audition of AUDITIONS) assert.deepEqual(Object.keys(auditionGains(audition)), audition.layers)
})
