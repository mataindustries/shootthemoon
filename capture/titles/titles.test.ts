// node --experimental-strip-types --experimental-transform-types --test capture/titles/titles.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  drawnFrames,
  formatClock,
  opacityAt,
  platePushChains,
  platePushFilter,
  sceneAt,
  textAt,
  validateCues,
  type Cues,
  type TextOp,
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
  assert.match(p1, /\(1\+0\.04\*on\/143\)/)
  assert.match(p1, /sense=source:eval=frame/)
})
