/**
 * Validates the locked cut (capture/finalEdit.json) against the shot manifest
 * and production timing constants. Pure data checks — no browser, no capture.
 * Run via: npx playwright test --config=capture/playwright.capture.config.ts capture/finalEdit.spec.ts
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { FIRST_STRIKE_PRESENTATION_DURATIONS_MS } from '../src/app/firstStrikePresentation.ts'
import { RIVAL_PRESENTATION_DURATIONS_MS } from '../src/app/rivalPresentation.ts'
import { MONUMENT_REVEAL_MS } from '../src/domain/territoryMonument.ts'
import { COUNTERSTRIKE_TIMING } from '../src/simulation/counterstrikeSimulation.ts'
import {
  deriveRenderPlan,
  isShotClip,
  validateFinalEdit,
  type FinalEdit,
  type ShotClip,
  type ShotIndexEntry,
  type SourceWindow,
} from './finalEdit.ts'
import { DESCENT_APPROACH_DURATION_MS, SHOTS } from './manifest.ts'

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T

const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const shotIndex: ShotIndexEntry[] = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const clips = edit.timeline.filter(isShotClip)

function variant(change: (draft: DeepMutable<FinalEdit>) => void): FinalEdit {
  const draft = structuredClone(edit) as DeepMutable<FinalEdit>
  change(draft)
  return draft as FinalEdit
}

function clip(draft: DeepMutable<FinalEdit>, id: string): DeepMutable<ShotClip> {
  const found = draft.timeline.find((item) => item.id === id)
  if (found === undefined || found.kind !== 'shot') throw new Error(`no shot clip ${id}`)
  return found
}

function allSources(): SourceWindow[] {
  const { poster, stills, mobileScreenshots } = edit.derivatives
  return [...clips.map((item) => item.source), ...[poster, ...stills, ...mobileScreenshots].map((item) => item.source)]
}

function productionPhaseDurationMs(phase: string): number | undefined {
  const [system, name] = phase.split(':') as [string, string]
  if (phase === 'moon-core:approach') return DESCENT_APPROACH_DURATION_MS
  if (phase === 'counterstrike:impact') return COUNTERSTRIKE_TIMING.impactMs
  if (system === 'rival-signal') return RIVAL_PRESENTATION_DURATIONS_MS[name as keyof typeof RIVAL_PRESENTATION_DURATIONS_MS]
  if (system === 'first-strike') {
    return FIRST_STRIKE_PRESENTATION_DURATIONS_MS[name as keyof typeof FIRST_STRIKE_PRESENTATION_DURATIONS_MS]
  }
  return undefined
}

test.describe('locked cut', () => {
  test('validates cleanly against the shot manifest', () => {
    expect(validateFinalEdit(edit, shotIndex)).toEqual([])
  })

  test('runs 55-60s, contiguous from 0, and resolves before the end card', () => {
    const last = edit.timeline[edit.timeline.length - 1]!
    expect(edit.timeline[0]!.destInMs).toBe(0)
    expect(last.kind).toBe('end-card')
    expect(last.destOutMs).toBeGreaterThanOrEqual(55_000)
    expect(last.destOutMs).toBeLessThanOrEqual(60_000)
    const resolving = edit.timeline[edit.timeline.length - 2]
    expect(resolving?.kind === 'shot' ? resolving.shotId : null).toBe('bastion-held-hero')
  })

  test('every progress window uses the real production phase duration', () => {
    for (const source of allSources()) {
      if (source.clock !== 'progress') continue
      expect(productionPhaseDurationMs(source.phase), source.phase).toBe(source.phaseDurationMs)
    }
  })

  test('monument reveal windows stay inside the reveal cinematic', () => {
    for (const source of allSources()) {
      if (source.clock === 'elapsed-ms' && source.origin === 'reveal-open') {
        expect(source.inMs).toBeGreaterThanOrEqual(0)
        expect(source.outMs).toBeLessThanOrEqual(MONUMENT_REVEAL_MS)
      }
    }
  })
})

test.describe('the validator catches broken edits', () => {
  const cases: readonly [string, (draft: DeepMutable<FinalEdit>) => void, RegExp][] = [
    ['a gap', (draft) => { clip(draft, 'c02').destInMs += 300 }, /gap before c02/],
    ['an overlap', (draft) => { clip(draft, 'c03').destInMs -= 300 }, /overlap at c03/],
    ['an off-grid edge', (draft) => { clip(draft, 'c01').destOutMs += 150; clip(draft, 'c02').destInMs += 150 }, /off the 300ms grid/],
    ['a reel under 55s', (draft) => {
      draft.timeline = draft.timeline.filter((item) => item.id !== 'c25')
      let cursor = 0
      for (const item of draft.timeline) {
        const length = item.destOutMs - item.destInMs
        item.destInMs = cursor
        item.destOutMs = cursor + length
        cursor += length
      }
    }, /outside 55000-60000ms/],
    ['an unknown shot', (draft) => { clip(draft, 'c07').shotId = 'first-strike-orbital-flight-v2' }, /does not exist in the manifest/],
    ['a crop outside the frame', (draft) => { clip(draft, 'c17').crop.x = 2000 }, /exceeds the PLATE frame 3840x2160/],
    ['a non-16:9 crop', (draft) => { clip(draft, 'c17').crop.h = 1200 }, /is not 16:9/],
    ['an upscaling crop', (draft) => { clip(draft, 'c17').crop = { x: 1030, y: 60, w: 1600, h: 900 } }, /would upscale/],
    ['a cropped portrait frame', (draft) => { clip(draft, 'c14').crop.h = 2000 }, /portrait frames are shown whole/],
    ['a speed that disagrees with its window', (draft) => { clip(draft, 'c07').speed = 0.5 }, /c07: speed 0.5 does not match/],
    ['a window inside a documented AVOID band', (draft) => {
      const target = clip(draft, 'c08')
      if (target.source.clock !== 'progress') throw new Error('c08 must be a progress window')
      target.source.in = 0.3
    }, /overlaps AVOID 0.12-0.42/],
    ['footage after the end card', (draft) => {
      const card = draft.timeline.pop()!
      const last = draft.timeline.pop()!
      const shift = card.destOutMs - card.destInMs
      card.destInMs = last.destInMs
      card.destOutMs = last.destInMs + shift
      last.destInMs = card.destOutMs
      last.destOutMs = card.destOutMs + (last.destOutMs - last.destInMs)
      draft.timeline.push(card, last)
    }, /the end card must be the final timeline item/],
    ['an unverified end-card claim', (draft) => {
      const card = draft.timeline[draft.timeline.length - 1]!
      if (card.kind !== 'end-card') throw new Error('last item must be the end card')
      card.factClaims.push('The best game ever made')
    }, /not a verified END_CARD_FACTS claim/],
  ]

  for (const [name, change, expected] of cases) {
    test(name, () => {
      const problems = validateFinalEdit(variant(change), shotIndex)
      expect(problems.some((problem) => expected.test(problem)), problems.join('\n')).toBe(true)
    })
  }
})

test.describe('render plan', () => {
  const plan = deriveRenderPlan(edit, shotIndex)

  test('captures only shots the cut or its exports actually use', () => {
    const { poster, stills, mobileScreenshots } = edit.derivatives
    const used = new Set([...clips.map((item) => item.shotId), ...[poster, ...stills, ...mobileScreenshots].map((item) => item.shotId)])
    expect(new Set(plan.map((shot) => shot.shotId))).toEqual(used)
    expect(plan.length).toBeLessThan(SHOTS.length)
    for (const rejected of ['counterstrike-interception-success', 'first-strike-crater-reveal', 'two-claims-one-moon', 'final-claimed-moon-wide']) {
      expect(plan.some((shot) => shot.shotId === rejected), rejected).toBe(false)
    }
  })

  test('motion windows get one real frame per output frame; stills get one', () => {
    for (const item of clips) {
      const window = plan.flatMap((shot) => shot.windows).find((candidate) => candidate.clipId === item.id)
      const expected = item.source.clock === 'still' ? 1 : ((item.destOutMs - item.destInMs) / 1000) * edit.output.fps
      expect(window?.frames, item.id).toBe(expected)
    }
  })
})
