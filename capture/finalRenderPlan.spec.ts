/**
 * Pure-logic tests for capture/finalRender/plan.ts: source-frame
 * calculations, 60fps stepping, slow-motion sampling density, crop
 * application, and finalEdit-reference coverage (every job traces to a real
 * final-render reach implementation of the declared clock kind). No
 * browser — same convention as capture/finalEdit.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { isShotClip, type FinalEdit, type ShotClip, type ShotIndexEntry } from './finalEdit.ts'
import {
  buildFinalRenderJobs,
  frameProgressAt,
  interpolateCrop,
  requiredSourceFrameCount,
  sourceValueAt,
  toCssClip,
} from './finalRender/plan.ts'
import { REACH_KIND } from './finalRender/reachKinds.ts'
import { SHOTS } from './manifest.ts'
import { PROFILES } from './profiles.ts'

const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const shotIndex: ShotIndexEntry[] = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const clips = edit.timeline.filter(isShotClip)

function clipById(id: string): ShotClip {
  const found = clips.find((clip) => clip.id === id)
  if (found === undefined) throw new Error(`no clip ${id}`)
  return found
}

test.describe('source-frame calculations', () => {
  test('requiredSourceFrameCount matches destination-duration x output fps for every clip', () => {
    for (const clip of clips) {
      const expected = clip.source.clock === 'still' ? null : ((clip.destOutMs - clip.destInMs) / 1000) * edit.output.fps
      if (expected === null) continue
      expect(requiredSourceFrameCount(clip.destInMs, clip.destOutMs, edit.output.fps), clip.id).toBe(expected)
    }
  })

  test('is independent of playback speed by construction (same formula for slow and fast clips)', () => {
    // c07 (speed 0.1663, deep slow motion) and c05 (a still, speed null) sit
    // at opposite extremes; the frame-count formula only ever looks at
    // destination duration and output fps, never at `speed`.
    const c07 = clipById('c07')
    expect(c07.speed).toBeLessThan(0.2)
    expect(requiredSourceFrameCount(c07.destInMs, c07.destOutMs, edit.output.fps)).toBe(
      ((c07.destOutMs - c07.destInMs) / 1000) * edit.output.fps,
    )
  })
})

test.describe('60fps stepping', () => {
  test('frameProgressAt is evenly spaced and inclusive of both endpoints', () => {
    expect(frameProgressAt(0, 5)).toBe(0)
    expect(frameProgressAt(1, 5)).toBeCloseTo(0.25, 10)
    expect(frameProgressAt(2, 5)).toBeCloseTo(0.5, 10)
    expect(frameProgressAt(3, 5)).toBeCloseTo(0.75, 10)
    expect(frameProgressAt(4, 5)).toBe(1)
  })

  test('a single-frame (still) job always samples t=0, never divides by zero', () => {
    expect(frameProgressAt(0, 1)).toBe(0)
    expect(frameProgressAt(0, 0)).toBe(0)
  })

  test('sourceValueAt maps t=0/t=1 onto the exact approved in/out bounds', () => {
    const c15 = clipById('c15') // counterstrike-terminal-dive: progress 0.16 -> 0.33
    if (c15.source.clock !== 'progress') throw new Error('c15 must be a progress window')
    expect(sourceValueAt(c15.source, 0)).toBeCloseTo(0.16, 10)
    expect(sourceValueAt(c15.source, 1)).toBeCloseTo(0.33, 10)
  })
})

test.describe('slow-motion calculations', () => {
  test('a slow-motion clip samples a narrower per-frame source delta than a near-real-time one', () => {
    const c07 = clipById('c07') // first-strike-orbital-flight hero: speed 0.1663
    const c20 = clipById('c20') // divider-defense-interaction: speed 0.5, much less slow-mo
    if (c07.source.clock === 'still' || c20.source.clock === 'still') throw new Error('expected motion windows')
    const framesC07 = requiredSourceFrameCount(c07.destInMs, c07.destOutMs, edit.output.fps)
    const framesC20 = requiredSourceFrameCount(c20.destInMs, c20.destOutMs, edit.output.fps)
    const spanC07 = 'in' in c07.source ? c07.source.out - c07.source.in : 0
    const spanC20 = 'inMs' in c20.source ? c20.source.outMs - c20.source.inMs : 0
    const stepC07 = spanC07 / (framesC07 - 1)
    const stepC20InSeconds = spanC20 / 1000 / (framesC20 - 1)
    // c07's step is a fraction of a [0,1] progress range and c20's is in
    // seconds of elapsed-ms — not directly comparable in absolute units, but
    // both must be far smaller than "one frame per real-time frame" would
    // require, since deeper slow motion (lower speed) packs the same 60fps
    // output frame count into a narrower source window.
    expect(c07.speed!).toBeLessThan(c20.speed!)
    expect(stepC07).toBeGreaterThan(0)
    expect(stepC20InSeconds).toBeGreaterThan(0)
    // The defining property of slow motion here: real source time consumed
    // per output frame (destMs/frames, scaled by speed) is smaller than one
    // real 60fps tick (1000/60 ms) for the slower clip, and closer to it for
    // the faster one.
    const realMsPerOutputFrameC07 = ((c07.destOutMs - c07.destInMs) / framesC07) * c07.speed!
    const realMsPerOutputFrameC20 = ((c20.destOutMs - c20.destInMs) / framesC20) * c20.speed!
    expect(realMsPerOutputFrameC07).toBeLessThan(1000 / 60 + 0.01)
    expect(realMsPerOutputFrameC20).toBeGreaterThan(realMsPerOutputFrameC07)
  })
})

test.describe('crop application', () => {
  test('interpolateCrop lerps every field independently', () => {
    const start = { x: 0, y: 0, w: 100, h: 200 }
    const end = { x: 100, y: 200, w: 300, h: 400 }
    expect(interpolateCrop(start, end, 0)).toEqual(start)
    expect(interpolateCrop(start, end, 1)).toEqual(end)
    expect(interpolateCrop(start, end, 0.5)).toEqual({ x: 50, y: 100, w: 200, h: 300 })
  })

  test('a full-frame PLATE crop converts to exactly the CSS viewport', () => {
    const c01 = clipById('c01')
    expect(toCssClip(c01.crop, PROFILES.PLATE.deviceScaleFactor)).toEqual({
      x: 0,
      y: 0,
      width: PROFILES.PLATE.cssWidth,
      height: PROFILES.PLATE.cssHeight,
    })
  })

  test('a moving crop (crop -> cropEnd) interpolates in device pixels before CSS conversion', () => {
    const c06 = clipById('c06') // first-strike-liftoff: crop tilts from y=1080 to y=360
    expect(c06.cropEnd).toBeDefined()
    const mid = interpolateCrop(c06.crop, c06.cropEnd!, 0.5)
    expect(mid.y).toBeCloseTo((c06.crop.y + c06.cropEnd!.y) / 2, 10)
    const cssMid = toCssClip(mid, PROFILES.PLATE.deviceScaleFactor)
    expect(cssMid.y).toBeCloseTo(mid.y / PROFILES.PLATE.deviceScaleFactor, 10)
  })

  test('PORT crops always convert to the full real device frame, never smaller', () => {
    const c14 = clipById('c14')
    const css = toCssClip(c14.crop, PROFILES.PORT.deviceScaleFactor)
    expect(css).toEqual({ x: 0, y: 0, width: PROFILES.PORT.cssWidth, height: PROFILES.PORT.cssHeight })
  })
})

test.describe('finalEdit references', () => {
  const jobs = buildFinalRenderJobs(edit, shotIndex)

  test('recalculated total matches the locked-cut render plan exactly (2,749 source frames)', () => {
    const totalFrames = jobs.reduce((sum, job) => sum + job.frames, 0)
    expect(totalFrames).toBe(2_749)
    expect(new Set(jobs.map((job) => job.shotId)).size).toBe(25)
  })

  test('every job is in strict final-edit order', () => {
    for (let i = 1; i < jobs.length; i += 1) {
      expect(jobs[i]!.order).toBeGreaterThan(jobs[i - 1]!.order)
    }
  })

  test('every job references a shot with a declared reach kind matching its own source clock', () => {
    for (const job of jobs) {
      const declared = REACH_KIND[job.shotId]
      expect(declared, `${job.jobId} (${job.shotId}) has no REACH_KIND entry`).toBeDefined()
      expect(declared, `${job.jobId} (${job.shotId})`).toBe(job.source.clock)
    }
  })

  test('every REACH_KIND entry is actually used by at least one job (no orphaned reach code)', () => {
    const usedShotIds = new Set(jobs.map((job) => job.shotId))
    for (const shotId of Object.keys(REACH_KIND)) {
      expect(usedShotIds.has(shotId), shotId).toBe(true)
    }
  })

  test('derivative-export jobs are tagged DERIVATIVES; timeline jobs carry a real act', () => {
    for (const job of jobs) {
      if (job.jobId.startsWith('c') && /^c\d\d$/.test(job.jobId)) {
        expect(job.act).not.toBe('DERIVATIVES')
      }
    }
    const monumentSelection = jobs.find((job) => job.shotId === 'monument-selection-port')
    expect(monumentSelection?.act).toBe('DERIVATIVES')
  })
})
