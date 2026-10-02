// node --experimental-strip-types --experimental-transform-types --test capture/titles/titles.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkTitlesAlpha,
  checkTitlesProvenance,
  drawnFrames,
  formatClock,
  opacityAt,
  platePushChains,
  platePushFilter,
  sceneAt,
  textAt,
  TITLES_INPUT_FILES,
  validateCues,
  type Cues,
  type TextOp,
  type TitlesManifest,
  type TitlesReleasePin,
} from './titles.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const cues: Cues = JSON.parse(readFileSync(path.join(here, 'reel-titles.cues.json'), 'utf8'))
const event = (id: string) => cues.events.find((ev) => ev.id === id)!
const element = (id: string, role: string) => event(id).elements.find((el) => el.role === role)!
const texts = (f: number) => sceneAt(cues, f).filter((op): op is TextOp => op.op === 'text')

test('the cue sheet validates against the reel', () => {
  assert.deepEqual(validateCues(cues), [])
  assert.equal(cues.source.frames, 3456)
  assert.equal(cues.source.fps, 60)
})

test('pinned counter values', () => {
  assert.equal(textAt(element('E4', 'digits'), 1152), '00.99')
  assert.equal(textAt(element('E4', 'digits'), 1284), '00.00')
  assert.equal(textAt(element('E4', 'digits'), 1289), '00.00')
  assert.equal(textAt(element('E3', 'kicker'), 792), 'LAUNCH   T+00.00')
  assert.equal(textAt(element('E3', 'kicker'), 863), 'LAUNCH   T+00.76')
  assert.equal(formatClock(0.768), '00.76')
})

test('pinned roll-call swaps', () => {
  assert.equal(textAt(element('E7', 'primary'), 2555), 'HELIOS SPIRE')
  assert.equal(textAt(element('E7', 'primary'), 2556), 'SIGNAL ARRAY')
  assert.equal(textAt(element('E7', 'kicker'), 2556), 'TERRITORY MONUMENT · 2/4')
  assert.equal(textAt(element('E7', 'primary'), 2736), 'BASTION ZIGGURAT')
})

test('every exit is clear on its pinned frame', () => {
  for (const [id, role, f] of [
    ['E1', 'primary', 143],
    ['E2', 'primary', 575],
    ['E3', 'primary', 864],
    ['E5', 'primary', 1865],
    ['E6', 'primary', 2160],
    ['E7', 'primary', 2843],
    ['E9', 'primary', 3095],
  ] as const) {
    assert.equal(opacityAt(element(id, role), f), 0, `${id} ${role} at ${f}`)
  }
  for (const f of [143, 575, 864, 1290, 1865, 2160, 2843, 3095]) assert.deepEqual(sceneAt(cues, f), [], `frame ${f}`)
})

test('nothing is drawn on a protected flash, dip or fade frame', () => {
  for (const range of cues.forbidden) {
    for (let f = range.from; f <= range.to; f++) assert.deepEqual(sceneAt(cues, f), [], `frame ${f}: ${range.why}`)
  }
})

test('the closing statement completes the premise in the record slot, clear of the dip and the end card', () => {
  const closing = texts(3000)
  assert.equal(closing.length, 1)
  assert.equal(closing[0]!.text, 'NEITHER INTENDS TO SHARE.')
  assert.equal(closing[0]!.x, 120)
  assert.equal(closing[0]!.y, 910)
  const drawn = drawnFrames(cues)
  assert.ok(drawn.includes(2952) && drawn.includes(3094) && !drawn.includes(2951) && !drawn.includes(3095))
  for (let f = 2843; f < 2952; f++) assert.equal(drawn.includes(f), false, `pull-back stays clean at ${f}`)
  for (let f = 3095; f < 3168; f++) assert.equal(drawn.includes(f), false, `clean before the end card at ${f}`)
})

test('the final frame is the complete end-card lockup', () => {
  const ops = sceneAt(cues, 3455)
  const words = ops.filter((op): op is TextOp => op.op === 'text').map((op) => op.text)
  assert.deepEqual(words, ['SHOOT', 'THE', 'MOON', '1v1 LUNAR TERRITORY WARFARE', 'PLAY IN YOUR BROWSER', 'shootthemoon.pages.dev', 'ALL FOOTAGE CAPTURED IN-GAME'])
  for (const op of ops) if (op.op === 'text') assert.ok(op.fillOpacity > 0.4 - 1e-9, `${op.text} is fully in`)
  const crescent = ops.find((op) => op.op === 'crescent')
  assert.ok(crescent && crescent.op === 'crescent' && Math.abs(crescent.offset - -0.3) < 1e-9)
  assert.equal(ops.filter((op) => op.op === 'hairline').length, 2)
})

test('the scene is a pure function of the frame', () => {
  for (const f of [100, 530, 850, 1230, 1845, 2120, 2680, 3000, 3455]) {
    assert.equal(JSON.stringify(sceneAt(cues, f)), JSON.stringify(sceneAt(cues, f)))
  }
})

test('chapters follow the declared hierarchy and are never drawn', () => {
  assert.deepEqual(cues.chapters, ['ARRIVAL', 'CONTACT', 'OFFENSIVE', 'DEFENSE', 'TERRITORY'])
  for (let f = 0; f < cues.source.frames; f += 3) {
    for (const op of texts(f)) assert.ok(!cues.chapters.includes(op.text) && !/^\d\d \/ /.test(op.text), op.text)
  }
})

test('plate pushes use perspective, never zoompan, and keep every frame in place', () => {
  const chains = platePushChains(cues, 'seq', 'out', 60).join(';')
  assert.ok(!/zoompan/.test(chains))
  assert.equal((chains.match(/perspective=/g) ?? []).length, cues.plateMoves.length)
  const trims = [...chains.matchAll(/trim=start_frame=(\d+):end_frame=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  let cursor = 0
  for (const [start, end] of trims) {
    assert.equal(start, cursor)
    cursor = end
  }
  assert.equal(cursor, cues.source.frames)
  const p1 = platePushFilter(cues.plateMoves[0]!, 1920, 1080)
  assert.match(p1, /\(1\+0\.04\*\(on-1\)\/143\)/)
  assert.match(p1, /sense=source:eval=frame/)
})

test('the entire native UI, impact and destruction intervals stay title-free', () => {
  // Independent locked-shot boundaries, not ranges supplied by the cue sheet.
  for (const [from, to] of [[144, 431], [576, 791], [864, 1151], [1290, 1799], [1865, 2015], [2160, 2447], [3095, 3167]]) {
    for (let f = from!; f <= to!; f++) assert.deepEqual(sceneAt(cues, f), [], `clean native frame ${f}`)
  }
})

test('decoded alpha rejects contamination at every protected boundary and missing titles', () => {
  const maxima: number[] = Array.from({ length: cues.source.frames }, (_, f) => sceneAt(cues, f).length > 0 ? 255 : 0)
  assert.deepEqual(checkTitlesAlpha(cues, maxima), [])
  for (const range of cues.forbidden) {
    for (const f of [range.from, range.to]) {
      const bad = [...maxima]
      bad[f] = 1 // Even one level of alpha must fail.
      assert.ok(checkTitlesAlpha(cues, bad).some((p) => p.startsWith(`frame ${f}:`)))
    }
  }
  const missing = [...maxima]
  missing[3455] = 0
  assert.ok(checkTitlesAlpha(cues, missing).some((p) => p.includes('3455')))
  assert.ok(checkTitlesAlpha(cues, maxima.slice(1)).length > 0)
})

test('title provenance rejects another cue sheet, font, renderer, browser or track', () => {
  const inputs = Object.fromEntries(TITLES_INPUT_FILES.map((file) => [file, 'a'.repeat(64)]))
  const pin: TitlesReleasePin = { schema: 'shootthemoon.titles-release/1', inputs, playwright: '1.62.1', chromium: '151.0.7922.34' }
  const manifest: TitlesManifest = {
    schema: 'shootthemoon.reel-titles-track/1', inputs, alpha: 'straight', playwright: pin.playwright, browser: `chromium ${pin.chromium}`,
    cues: { sha256: inputs['capture/titles/reel-titles.cues.json']! },
    fonts: Object.fromEntries(TITLES_INPUT_FILES.filter((file) => file.endsWith('.ttf')).map((file) => [path.basename(file), inputs[file]!])),
    track: { sha256: 'b'.repeat(64), codec: 'qtrle', pixFmt: 'argb', fps: 60, frames: 3456 },
  }
  assert.deepEqual(checkTitlesProvenance(pin, inputs, manifest, manifest.track.sha256), [])
  for (const file of TITLES_INPUT_FILES) assert.ok(checkTitlesProvenance(pin, { ...inputs, [file]: 'c'.repeat(64) }, manifest, manifest.track.sha256).length > 0, file)
  assert.ok(checkTitlesProvenance(pin, inputs, manifest, 'd'.repeat(64)).length > 0)
  assert.ok(checkTitlesProvenance(pin, inputs, { ...manifest, browser: 'another browser' }, manifest.track.sha256).length > 0)
  assert.ok(checkTitlesProvenance(pin, inputs, { ...manifest, track: { ...manifest.track, frames: 3455 } }, manifest.track.sha256).length > 0)
})
