import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkLoopTitlesCues, loopFilterGraph, planLoop, titledLoopFilterGraph } from '../ci/assembly.ts'
import type { FinalEdit } from '../finalEdit.ts'
import { checkTitlesProvenance, drawnFrames, opacityAt, plateScaleAt, sceneAt, titlesInputFiles, validateCues, type Cues, type TextOp } from './titles.ts'

const cues = JSON.parse(readFileSync(new URL('./loop-titles.cues.json', import.meta.url), 'utf8')) as Cues
const edit = JSON.parse(readFileSync(new URL('../finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const loop = planLoop(edit)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

test('the loop contract is exactly three records and one push on the 9-frame grid', () => {
  assert.deepEqual(validateCues(cues), [])
  assert.deepEqual(checkLoopTitlesCues(loop, cues), [])
  assert.deepEqual(cues.source, { reel: 'loop-13s-1280.mp4 (capture/finalEdit.json derivatives.loop; clean remains unchanged)', width: 1280, height: 720, fps: 30, frames: 414 })
  assert.equal(cues.tempo.framesPerGrid, 9)
  assert.deepEqual(cues.events.map((e) => [e.id, e.from, e.to, e.chapter]), [['L1', 81, 125, 'OFFENSIVE'], ['L2', 216, 242, 'OFFENSIVE'], ['L3', 333, 377, 'DEFENSE']])
  assert.deepEqual(cues.events.map((e) => e.elements.map((el) => el.role)), Array.from({ length: 3 }, () => ['chip', 'kicker', 'rule', 'primary']))
  assert.deepEqual(cues.plateMoves.map((m) => [m.id, m.from, m.to, m.scale, m.anchor, m.ease]), [['LP1', 324, 413, [1, 1.025], [640, 360], 'linear']])
})

test('every protected frame and both flashes have no scene; each cue boundary is exact', () => {
  const legal = [...range(81, 125), ...range(216, 242), ...range(333, 377)]
  assert.deepEqual(drawnFrames(cues), legal)
  const legalSet = new Set(legal)
  for (let f = 0; f < 414; f++) assert.equal(sceneAt(cues, f).length > 0, legalSet.has(f), `frame ${f}`)
  for (const [before, start, last, clear] of [[80, 81, 125, 126], [215, 216, 242, 243], [332, 333, 377, 378]] as const) {
    assert.deepEqual(sceneAt(cues, before), [])
    assert.ok(sceneAt(cues, start).length > 0)
    assert.ok(sceneAt(cues, last).length > 0)
    assert.deepEqual(sceneAt(cues, clear), [])
  }
})

test('approved copy, typography, placement and shadows stay fixed during every hold', () => {
  const expected = [['TERMINAL APPROACH', 'FIRST STRIKE', 'amber'], ['HOSTILE TERMINAL APPROACH', 'COUNTERSTRIKE', 'cyan'], ['CONTACT', 'THE OCTOGONALS', 'violet']]
  assert.deepEqual(cues.layout?.envelope, [64, 545, 462, 636])
  assert.deepEqual(cues.tokens.shadow?.sigma, [0.5, 5])
  assert.deepEqual(cues.tokens.shadow?.dy, [0, 1])
  for (const [i, e] of cues.events.entries()) {
    const [chip, kicker, rule, primary] = e.elements
    assert.deepEqual([chip!.x, chip!.y, cues.tokens.chip.size, chip!.fill], [64, 556, 7, expected[i]![2]])
    assert.deepEqual([kicker!.x, kicker!.y, kicker!.text, primary!.x, primary!.y, primary!.text], [80, 564, expected[i]![0], 80, 607, expected[i]![1]])
    assert.deepEqual([rule!.x, rule!.y, rule!.w, cues.tokens.rule.thickness, cues.tokens.rule.shadow], [80, 624, 60, 2, false])
    assert.deepEqual(chip!.in, { f: e.from, fade: 5 })
    assert.deepEqual(kicker!.in, { f: e.from, fade: 5 })
    assert.deepEqual(rule!.draw, { f: e.from, n: 5, origin: 'left' })
    assert.deepEqual(primary!.in, { f: e.from + 5, fade: 5 })
    assert.deepEqual(primary!.track, { f: e.from + 5, from: .24, to: .16, n: 9 })
    const full = e.from + 13
    const holdEnd = i === 2 ? 377 : i === 1 ? 238 : 121
    for (let f = full; f <= holdEnd; f++) {
      assert.deepEqual(sceneAt(cues, f), sceneAt(cues, full), `hold ${e.id} frame ${f}`)
      const text = sceneAt(cues, f).filter((op): op is TextOp => op.op === 'text')
      assert.deepEqual(text.map((op) => [op.family, op.size, op.wght, op.wdth, op.spacingPx, op.fill, op.fillOpacity]), [['IBM Plex Mono', 13, 500, null, 2.08, '#EDE8DF', .76], ['Saira', 30, 500, 110, 4.8, '#EDE8DF', .96]])
    }
    assert.equal(opacityAt(primary!, e.to + 1), 0)
  }
})

test('the loop graph composites titles after exactly one corrected perspective push', () => {
  const sources = { shots: new Map(loop.sequence.segments.map((s, i) => [s.id, `${i}:v`])), endCard: null, width: 1920, height: 1080 }
  const clean = loopFilterGraph(loop, sources)
  const graph = titledLoopFilterGraph(loop, sources, cues, '7:v')
  assert.ok(graph.startsWith(clean.replace(/\[out\]$/, ',format=yuv444p[loopplate]')))
  assert.equal((graph.match(/perspective=/g) ?? []).length, 1)
  assert.match(graph, /\(1\+0\.025\*\(on-1\)\/89\)/)
  assert.ok(!graph.includes('zoompan'))
  assert.ok(graph.indexOf('perspective=') < graph.indexOf('overlay='))
  assert.match(graph, /trim=start_frame=324:end_frame=414/)
  assert.match(graph, /settb=1\/30,setpts=N\[out\]|format=yuv420p,setsar=1\[out\]$/)
  assert.equal(plateScaleAt(cues.plateMoves[0]!, 324), 1)
  assert.equal(plateScaleAt(cues.plateMoves[0]!, 413), 1.025)
  assert.throws(() => titledLoopFilterGraph(loop, sources, { ...cues, source: { ...cues.source, fps: 60 } }, '7:v'), /loop cues must be/)
})

test('both cue sources and the shared renderer retain strict release provenance', () => {
  const pin = JSON.parse(readFileSync(new URL('./titlesRelease.json', import.meta.url), 'utf8'))
  for (const [file, fps, frames] of [['capture/titles/reel-titles.cues.json', 60, 3456], ['capture/titles/loop-titles.cues.json', 30, 414]] as const) {
    const actual = Object.fromEntries(titlesInputFiles(file).map((input) => [input, createHash('sha256').update(readFileSync(new URL(`../../${input}`, import.meta.url))).digest('hex')]))
    assert.deepEqual(checkTitlesProvenance(pin, actual, undefined, undefined, { file, fps, frames }), [])
    assert.ok(checkTitlesProvenance(pin, { ...actual, [file]: '0'.repeat(64) }, undefined, undefined, { file, fps, frames }).length > 0)
  }
})
