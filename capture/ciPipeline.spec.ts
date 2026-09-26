/**
 * Pure-logic tests for capture/ci/reelCi.ts — the GitHub Actions render
 * pipeline around the unchanged final renderer: job partitioning, expected
 * source-frame sizes, the 1080p60 intermediate plan per clip kind, and the
 * whole-reel verifier. No browser, no ffmpeg (capture/ci/encoderSelfTest.mjs
 * exercises the real encoder) — same convention as finalRenderPlan.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { isShotClip, type FinalEdit, type ShotIndexEntry } from './finalEdit.ts'
import { buildFinalRenderJobs } from './finalRender/plan.ts'
import { SHOTS } from './manifest.ts'
import {
  CLIP_METADATA_SCHEMA,
  JOB_CEILING_MINUTES,
  MEASURED_COST_MODEL,
  checkSourceFrameSizes,
  contactFrameIndices,
  estimateClipMinutes,
  expectedSourceFrameSize,
  intermediateFfmpegArgs,
  outputFrameCount,
  partitionByAct,
  planIntermediate,
  smokeGroup,
  timelineJobs,
  verifyReelRecords,
  type ClipRecord,
} from './ci/reelCi.ts'

const edit = JSON.parse(readFileSync(new URL('./finalEdit.json', import.meta.url), 'utf8')) as FinalEdit
const shotIndex: ShotIndexEntry[] = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const allJobs = buildFinalRenderJobs(edit, shotIndex)
const jobs = timelineJobs(edit, allJobs)
const clips = edit.timeline.filter(isShotClip)
const jobById = (id: string) => {
  const job = jobs.find((candidate) => candidate.jobId === id)
  if (job === undefined) throw new Error(`no job ${id}`)
  return job
}

test.describe('timeline jobs', () => {
  test('exactly the 25 locked shot clips, in edit order, no derivatives', () => {
    expect(jobs.map((job) => job.jobId)).toEqual(clips.map((clip) => clip.id))
    expect(jobs).toHaveLength(25)
    expect(jobs.some((job) => job.act === 'DERIVATIVES')).toBe(false)
  })

  test('the 25 clips tile 0 -> 52.8s and the end card completes the locked 57.6s', () => {
    const shotMs = clips.reduce((sum, clip) => sum + clip.destOutMs - clip.destInMs, 0)
    expect(shotMs).toBe(52_800)
    expect(edit.timeline[edit.timeline.length - 1]!.destOutMs).toBe(57_600)
  })

  test('motion clips: output frames == source frames (never retimed); stills: 1 source frame', () => {
    for (const job of jobs) {
      const clip = clips.find((candidate) => candidate.id === job.jobId)!
      const out = outputFrameCount(edit, clip)
      if (clip.source.clock === 'still') expect(job.frames, job.jobId).toBe(1)
      else expect(job.frames, job.jobId).toBe(out)
    }
    expect(clips.reduce((sum, clip) => sum + outputFrameCount(edit, clip), 0)).toBe(52_800 * 60 / 1000)
  })
})

test.describe('partitioning', () => {
  test('full mode: one job per act, every clip exactly once, all under the 4.5h ceiling', () => {
    const groups = partitionByAct(jobs)
    expect(groups.map((group) => group.act)).toEqual([
      'ARRIVAL', 'RIVAL', 'FIRST_STRIKE', 'COUNTERSTRIKE', 'DIVIDER', 'MONUMENTS', 'CLAIMED_MOON',
    ])
    expect(groups.flatMap((group) => group.clipIds)).toEqual(jobs.map((job) => job.jobId))
    for (const group of groups) expect(group.estimatedMinutes, group.id).toBeLessThanOrEqual(JOB_CEILING_MINUTES)
    expect(JOB_CEILING_MINUTES).toBe(270)
  })

  test('an act over the ceiling is split by whole clips, in order, each part under it', () => {
    const slow = { ...MEASURED_COST_MODEL, secPerFrame: { PLATE: 12, HUD: 12, PORT: 12 } }
    const groups = partitionByAct(jobs, slow)
    const firstStrike = groups.filter((group) => group.act === 'FIRST_STRIKE')
    expect(firstStrike.length).toBeGreaterThan(1)
    expect(firstStrike.flatMap((group) => group.clipIds)).toEqual(jobs.filter((job) => job.act === 'FIRST_STRIKE').map((job) => job.jobId))
    for (const group of groups) expect(group.estimatedMinutes, group.id).toBeLessThanOrEqual(JOB_CEILING_MINUTES + 1)
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length)
  })

  test('a single clip that alone exceeds the ceiling is a hard error, not an oversized job', () => {
    const glacial = { ...MEASURED_COST_MODEL, secPerFrame: { PLATE: 200, HUD: 200, PORT: 200 } }
    expect(() => partitionByAct(jobs, glacial)).toThrow(/alone is estimated/)
  })

  test('estimates scale with frames and include the fixed per-clip cost', () => {
    const still = estimateClipMinutes({ frames: 1, profile: 'HUD' }, MEASURED_COST_MODEL)
    const long = estimateClipMinutes({ frames: 432, profile: 'PLATE' }, MEASURED_COST_MODEL)
    expect(still).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(still * 5)
  })

  test('smoke mode defaults to c07 first-strike-orbital-flight and rejects unknown clips', () => {
    const group = smokeGroup(jobs, 'c07')
    expect(group.clipIds).toEqual(['c07'])
    expect(jobById('c07').shotId).toBe('first-strike-orbital-flight')
    expect(group.sourceFrames).toBe(144)
    expect(() => smokeGroup(jobs, 'poster')).toThrow()
    expect(() => smokeGroup(jobs, 'c99')).toThrow()
  })
})

test.describe('source frame expectations', () => {
  test('c07 is full 3840x2160 on every frame (exact)', () => {
    const job = jobById('c07')
    const sizes = Array.from({ length: job.frames }, () => ({ width: 3840, height: 2160 }))
    expect(checkSourceFrameSizes(job, sizes)).toEqual([])
    expect(checkSourceFrameSizes(job, [...sizes.slice(1), { width: 3840, height: 2159 }])).not.toEqual([])
    expect(checkSourceFrameSizes(job, sizes.slice(1))).not.toEqual([])
  })

  test('moving crops are exact at the endpoints and allow rounding in between', () => {
    const job = jobById('c01')
    expect(expectedSourceFrameSize(job, 0)).toEqual({ width: 3840, height: 2160 })
    expect(expectedSourceFrameSize(job, job.frames - 1)).toEqual({ width: 3200, height: 1800 })
    const sizes = Array.from({ length: job.frames }, (_, index) => {
      const size = expectedSourceFrameSize(job, index)
      return { width: Math.round(size.width), height: Math.round(size.height) }
    })
    sizes[100] = { width: sizes[100]!.width + 1, height: sizes[100]!.height }
    expect(checkSourceFrameSizes(job, sizes)).toEqual([])
    sizes[0] = { width: 3839, height: 2160 }
    expect(checkSourceFrameSizes(job, sizes)).toHaveLength(1)
  })

  test('a still with a crop push is captured at its start crop only', () => {
    expect(expectedSourceFrameSize(jobById('c21'), 0)).toEqual({ width: 2880, height: 1620 })
  })
})

test.describe('1080p60 intermediate plan', () => {
  test('every locked clip gets a plan with the locked output frame count', () => {
    for (const job of jobs) {
      const clip = clips.find((candidate) => candidate.id === job.jobId)!
      const plan = planIntermediate(edit, job)
      expect(plan.outputFrames, job.jobId).toBe(outputFrameCount(edit, clip))
      expect(plan.filter, job.jobId).toContain('out_color_matrix=bt709')
      expect(plan.filter, job.jobId).toMatch(/1920[:x]1080/)
      expect(plan.filter, job.jobId).not.toMatch(/minterpolate|framerate=|tblend/)
    }
  })

  test('clip kinds: motion / still / still-push (c21) / portrait-still (c14, c18)', () => {
    const kinds = Object.fromEntries(jobs.map((job) => [job.jobId, planIntermediate(edit, job).kind]))
    expect(kinds.c07).toBe('motion')
    expect(kinds.c05).toBe('still')
    expect(kinds.c12).toBe('still')
    expect(kinds.c21).toBe('still-push')
    expect(kinds.c14).toBe('portrait-still')
    expect(kinds.c18).toBe('portrait-still')
    expect(Object.values(kinds).filter((kind) => kind === 'motion')).toHaveLength(19)
  })

  test('motion reads the PNG sequence at 60fps; stills loop one frame', () => {
    const motion = planIntermediate(edit, jobById('c07'))
    expect(motion.inputArgs).toEqual(['-framerate', '60', '-start_number', '0', '-i', '%06d.png'])
    const still = planIntermediate(edit, jobById('c05'))
    expect(still.inputArgs).toEqual(['-loop', '1', '-framerate', '60', '-i', '000000.png'])
    expect(still.outputFrames).toBe(72)
  })

  test('c21 push goes from its crop to its cropEnd over its 108 output frames', () => {
    const plan = planIntermediate(edit, jobById('c21'))
    expect(plan.outputFrames).toBe(108)
    expect(plan.filter).toContain('zoompan=')
    expect(plan.filter).toContain('(on/107)')
    expect(plan.filter).toContain('2880/(2880+(-960)*(on/107))')
    expect(plan.filter).toContain("x='960*(on/107)'")
    expect(plan.filter).toContain("y='1080*(on/107)'")
    expect(plan.filter).toContain(':fps=60')
  })

  test('ffmpeg args: x264 High 4:4:4, CRF 10, CFR 60, exact frame count, BT.709 tags, no audio', () => {
    const plan = planIntermediate(edit, jobById('c07'))
    const args = intermediateFfmpegArgs(plan, '/out/c07.mp4', 60)
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    expect(after('-c:v')).toBe('libx264')
    expect(after('-profile:v')).toBe('high444')
    expect(after('-pix_fmt')).toBe('yuv444p')
    expect(after('-crf')).toBe('10')
    expect(after('-preset')).toBe('slower')
    expect(after('-frames:v')).toBe('144')
    expect(after('-r')).toBe('60')
    expect(after('-fps_mode')).toBe('cfr')
    expect(after('-colorspace')).toBe('bt709')
    expect(args).toContain('-an')
    expect(args[args.length - 1]).toBe('/out/c07.mp4')
  })

  test('contact frames: first / middle / last, deduplicated', () => {
    expect(contactFrameIndices(144)).toEqual([0, 71, 143])
    expect(contactFrameIndices(2)).toEqual([0, 1])
    expect(contactFrameIndices(1)).toEqual([0])
  })
})

test.describe('reel verification', () => {
  const SHA = 'a'.repeat(40)
  function recordFor(clipId: string, overrides: Partial<ClipRecord> = {}): ClipRecord {
    const clip = clips.find((candidate) => candidate.id === clipId)!
    const frames = outputFrameCount(edit, clip)
    return {
      schema: CLIP_METADATA_SCHEMA,
      status: 'verified',
      gitSha: SHA,
      group: 'g',
      act: clip.act,
      clipId,
      shotId: clip.shotId,
      dest: { inMs: clip.destInMs, outMs: clip.destOutMs, durationMs: clip.destOutMs - clip.destInMs },
      source: { frames: clip.source.clock === 'still' ? 1 : frames, width: clip.crop.w, height: clip.crop.h },
      output: { file: `${clipId}.mp4`, frames, width: 1920, height: 1080, fps: 60, durationSec: frames / 60, sha256: 'f'.repeat(64), decodedAdjacentDuplicates: 0 },
      ...overrides,
    }
  }
  const allIds = clips.map((clip) => clip.id)
  const full = () => allIds.map((id) => recordFor(id))

  test('all 25 verified records from one SHA pass; 52.8s footage + 4.8s end card = 57.6s', () => {
    const result = verifyReelRecords(edit, full(), allIds, SHA)
    expect(result.problems).toEqual([])
    expect(result.clipCount).toBe(25)
    expect(result.shotFootageMs).toBe(52_800)
    expect(result.timelineMs).toBe(57_600)
    expect(result.gitShas).toEqual([SHA])
  })

  test('a missing clip is reported', () => {
    const result = verifyReelRecords(edit, full().filter((record) => record.clipId !== 'c19'), allIds, SHA)
    expect(result.problems).toContain('c19: missing')
  })

  test('a duplicate clip is reported', () => {
    const result = verifyReelRecords(edit, [...full(), recordFor('c07')], allIds, SHA)
    expect(result.problems.some((problem) => problem.startsWith('c07: 2 duplicate'))).toBe(true)
  })

  test('a clip from another git SHA is reported', () => {
    const records = full()
    records[3] = recordFor(records[3]!.clipId, { gitSha: 'b'.repeat(40) })
    expect(verifyReelRecords(edit, records, allIds, SHA).problems.some((problem) => problem.includes('rendered from'))).toBe(true)
  })

  test('wrong fps, wrong frame count, wrong size and frozen frames are reported', () => {
    const base = recordFor('c07')
    const records = full().filter((record) => record.clipId !== 'c07')
    for (const output of [
      { ...base.output, fps: 30 },
      { ...base.output, frames: 143 },
      { ...base.output, width: 3840, height: 2160 },
      { ...base.output, decodedAdjacentDuplicates: 2 },
    ]) {
      const result = verifyReelRecords(edit, [...records, { ...base, output }], allIds, SHA)
      expect(result.problems.length, JSON.stringify(output)).toBeGreaterThan(0)
    }
  })

  test('smoke mode only expects its one clip', () => {
    expect(verifyReelRecords(edit, [recordFor('c07')], ['c07'], SHA).problems).toEqual([])
    expect(verifyReelRecords(edit, [recordFor('c07'), recordFor('c08')], ['c07'], SHA).problems).toContain('c08: not expected in this run')
  })
})
