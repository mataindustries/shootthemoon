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
import {
  ATTEMPT_FIXED_ALLOWANCE_MS,
  HARD_SEC_PER_FRAME,
  attemptCeilingMs,
  attemptTimeoutMs,
  rendersInOneSession,
} from './finalRender/timing.ts'
import { SHOTS } from './manifest.ts'
import {
  CLIP_METADATA_SCHEMA,
  JOB_CEILING_MINUTES,
  MAX_ATTEMPTS,
  MEASURED_COST_MODEL,
  PREFLIGHT_PARTS,
  RENDER_BUDGET_MINUTES,
  RENDER_JOB_TIMEOUT_MINUTES,
  RENDER_STEP_TIMEOUT_MINUTES,
  RUN4_MEASUREMENTS,
  RUN4_REPAIR_CLIPS,
  SOLO_CLIP_MINUTES,
  budgetedAttemptTimeoutMs,
  checkExactSampling,
  checkForcedTimeoutRecovery,
  checkProofFrameSizes,
  checkSourceFrameSizes,
  contactFrameIndices,
  decideRetry,
  estimateClipMinutes,
  expectedCanvasBuffer,
  expectedSourceFrameSize,
  intermediateFfmpegArgs,
  outputFrameCount,
  partitionForCi,
  planIntermediate,
  preflightMatrix,
  projectClipMinutes,
  repairGroups,
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
  test('full mode: every progress-event clip runs alone; cheap clips share one job per act', () => {
    const groups = partitionForCi(jobs)
    // Every clip exactly once (groups are ordered by their first clip, so a
    // shared group's later clips — c12 — sit before the solos between them).
    expect(groups.flatMap((group) => group.clipIds).sort()).toEqual(jobs.map((job) => job.jobId).sort())
    expect(new Set(groups.flatMap((group) => group.clipIds)).size).toBe(jobs.length)
    const solo = groups.filter((group) => group.clipIds.length === 1 && jobById(group.clipIds[0]!).source.clock === 'progress')
    expect(solo.map((group) => group.clipIds[0])).toEqual(
      jobs.filter((job) => job.source.clock === 'progress').map((job) => job.jobId),
    )
    for (const group of groups) {
      expect(group.estimatedMinutes, group.id).toBeLessThanOrEqual(JOB_CEILING_MINUTES)
      if (group.clipIds.length > 1) {
        for (const clipId of group.clipIds) {
          expect(estimateClipMinutes(jobById(clipId), MEASURED_COST_MODEL), clipId).toBeLessThanOrEqual(SOLO_CLIP_MINUTES)
        }
      }
    }
    expect(groups.map((group) => group.id)).toEqual([
      'act1-arrival-c01', 'act1-arrival-c02', 'act2-rival-c03', 'act2-rival-c04', 'act3-first-strike',
      'act3-first-strike-c06', 'act3-first-strike-c07', 'act3-first-strike-c08', 'act3-first-strike-c09',
      'act3-first-strike-c10', 'act3-first-strike-c11', 'act4-counterstrike', 'act4-counterstrike-c15',
      'act4-counterstrike-c16', 'act5-divider', 'act6-monuments', 'act7-claimed-moon',
    ])
    expect(groups.find((group) => group.id === 'act3-first-strike')?.clipIds).toEqual(['c05', 'c12'])
    expect(groups.find((group) => group.id === 'act5-divider')?.clipIds).toEqual(['c17', 'c18', 'c19', 'c20', 'c21'])
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length)
  })

  test('act-level grouping would have put 4-9h of run #4-measured work in one job', () => {
    // Why the matrix changed: act III alone (c05-c12) is > 10 h at run #4 rates.
    const actThree = jobs.filter((job) => job.act === 'FIRST_STRIKE')
    const minutes = actThree.reduce((sum, job) => sum + estimateClipMinutes(job, MEASURED_COST_MODEL), 0)
    expect(minutes).toBeGreaterThan(RENDER_STEP_TIMEOUT_MINUTES)
  })

  test('the heaviest clip (c01, 288 progress frames) still fits one job at the worst run #4 rate', () => {
    const c01 = estimateClipMinutes(jobById('c01'), MEASURED_COST_MODEL)
    expect(c01).toBeGreaterThan(200)
    expect(c01).toBeLessThanOrEqual(JOB_CEILING_MINUTES)
    expect(JOB_CEILING_MINUTES).toBeLessThan(RENDER_BUDGET_MINUTES)
    expect(RENDER_BUDGET_MINUTES).toBeLessThan(RENDER_STEP_TIMEOUT_MINUTES)
    expect(RENDER_STEP_TIMEOUT_MINUTES).toBeLessThan(RENDER_JOB_TIMEOUT_MINUTES)
    expect(RENDER_JOB_TIMEOUT_MINUTES).toBeLessThan(360)
  })

  test('the workflow file uses the same step/job timeouts and budget as the planner', () => {
    const workflow = readFileSync(new URL('../.github/workflows/final-render.yml', import.meta.url), 'utf8')
    expect(workflow).toContain(`timeout-minutes: ${RENDER_JOB_TIMEOUT_MINUTES}`)
    expect(workflow).toContain(`timeout-minutes: ${RENDER_STEP_TIMEOUT_MINUTES}`)
    expect(workflow).toContain(`--budget-minutes=${RENDER_BUDGET_MINUTES}`)
  })

  test('the cost model is at least as slow as every finished run #4 clip, per clock', () => {
    for (const measured of RUN4_MEASUREMENTS) {
      const job = jobById(measured.clipId)
      expect(job.frames, measured.clipId).toBe(measured.frames)
      expect(job.source.clock, measured.clipId).toBe(measured.clock)
      const unsafe = estimateClipMinutes(job, { ...MEASURED_COST_MODEL, safetyFactor: 1 })
      if (measured.finished) expect(unsafe, measured.clipId).toBeGreaterThanOrEqual(measured.minutes * 0.95)
    }
  })

  test('a single clip that alone exceeds the ceiling is a hard error, not an oversized job', () => {
    const glacial = { ...MEASURED_COST_MODEL, secPerFrame: { progress: 200, 'elapsed-ms': 200, still: 0 } }
    expect(() => partitionForCi(jobs, glacial)).toThrow(/alone is estimated/)
  })

  test('cheap clips of one act are split by whole clips, in order, if they would exceed the ceiling', () => {
    // At 60 s/frame c22/c23/c24 are 132/90/132 min: each under the solo
    // threshold used here, together over the ceiling.
    const slowElapsed = { ...MEASURED_COST_MODEL, secPerFrame: { ...MEASURED_COST_MODEL.secPerFrame, 'elapsed-ms': 60 } }
    const monumentsOnly = jobs.filter((job) => job.act === 'MONUMENTS')
    const groups = partitionForCi(monumentsOnly, slowElapsed, 230, 145)
    expect(groups.map((group) => group.id)).toEqual(['act6-monuments-p1', 'act6-monuments-p2'])
    expect(groups.flatMap((group) => group.clipIds)).toEqual(['c22', 'c23', 'c24'])
    for (const group of groups) expect(group.estimatedMinutes, group.id).toBeLessThanOrEqual(231)
  })

  test('estimates scale with frames, clock, and include the fixed per-clip cost', () => {
    const still = estimateClipMinutes({ frames: 1, source: { clock: 'still' } }, MEASURED_COST_MODEL)
    const elapsed = estimateClipMinutes(jobById('c25'), MEASURED_COST_MODEL)
    const progress = estimateClipMinutes(jobById('c07'), MEASURED_COST_MODEL)
    expect(still).toBeGreaterThan(0)
    expect(elapsed).toBeGreaterThan(still * 5)
    expect(progress).toBeGreaterThan(elapsed * 3)
  })

  test('smoke mode defaults to c07 first-strike-orbital-flight and rejects unknown clips', () => {
    const group = smokeGroup(jobs, 'c07')
    expect(group.clipIds).toEqual(['c07'])
    expect(jobById('c07').shotId).toBe('first-strike-orbital-flight')
    expect(group.sourceFrames).toBe(144)
    expect(() => smokeGroup(jobs, 'poster')).toThrow()
    expect(() => smokeGroup(jobs, 'c99')).toThrow()
  })

  test('repair mode: the run #4 failures, one job each, in edit order', () => {
    expect(RUN4_REPAIR_CLIPS).toEqual(['c01', 'c02', 'c03', 'c10', 'c16', 'c19', 'c24', 'c25'])
    const groups = repairGroups(jobs, ['c25', 'c01', 'c19', 'c01'])
    expect(groups.map((group) => group.id)).toEqual(['repair-c01', 'repair-c19', 'repair-c25'])
    expect(() => repairGroups(jobs, [])).toThrow()
    expect(() => repairGroups(jobs, ['c99'])).toThrow()
  })
})

test.describe('attempt budget and retry policy', () => {
  const attempt = (n: number, exitCode: number, validBefore: number, validAfter: number) => ({
    attempt: n, exitCode, timeoutMs: 1, elapsedMs: 1, validBefore, validAfter,
  })

  test('a success is never retried; a first failure with progress is resumed', () => {
    const c07 = jobById('c07')
    expect(decideRetry(c07, [], 300).retry).toBe(true)
    // A clip queued behind slow ones never starts an attempt it cannot finish.
    expect(decideRetry(c07, [], 4)).toMatchObject({ retry: false, reason: expect.stringMatching(/budget exhausted/) })
    expect(decideRetry(c07, [attempt(1, 0, 0, 144)], 300).retry).toBe(false)
    expect(decideRetry(c07, [attempt(1, 1, 0, 90)], 300)).toMatchObject({ retry: true })
  })

  test('two consecutive attempts without a new valid frame stop the clip', () => {
    const c07 = jobById('c07')
    expect(decideRetry(c07, [attempt(1, 1, 0, 0)], 300).retry).toBe(true)
    expect(decideRetry(c07, [attempt(1, 1, 0, 0), attempt(2, 1, 0, 0)], 300)).toMatchObject({ retry: false })
    expect(decideRetry(c07, [attempt(1, 1, 0, 50), attempt(2, 1, 50, 50)], 300).retry).toBe(true)
    expect(decideRetry(c07, [attempt(1, 1, 0, 50), attempt(2, 1, 50, 90), attempt(3, 1, 90, 120)], 300)).toMatchObject({ retry: false })
  })

  test('elapsed-ms clips get one whole-clip retry; never past the job budget', () => {
    const c19 = jobById('c19')
    expect(MAX_ATTEMPTS['elapsed-ms']).toBe(2)
    expect(decideRetry(c19, [attempt(1, 1, 0, 84)], 300).retry).toBe(true)
    expect(decideRetry(c19, [attempt(1, 1, 0, 84), attempt(2, 1, 0, 84)], 300).retry).toBe(false)
    expect(decideRetry(c19, [attempt(1, 1, 0, 84)], 3)).toMatchObject({ retry: false })
  })

  test('an attempt gets the derived ceiling unless the job budget is tighter', () => {
    const c01 = jobById('c01')
    const ceilingMs = 400 * 60_000
    expect(budgetedAttemptTimeoutMs(ceilingMs, 1_000, c01)).toBe(ceilingMs)
    const capped = budgetedAttemptTimeoutMs(ceilingMs, RENDER_BUDGET_MINUTES, c01)
    expect(capped).toBeLessThan(RENDER_BUDGET_MINUTES * 60_000)
    expect(capped).toBeGreaterThan((RENDER_BUDGET_MINUTES - 5) * 60_000)
    expect(budgetedAttemptTimeoutMs(ceilingMs, 1, c01)).toBe(0)
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

  // Run #4: c24 and c25 rendered in full and were then rejected with
  // "frame 0: 2559x1440, expected 2560x1440 (±0)". Their 2560x1440 end of the
  // crop push is 1706.667 CSS px wide at DPR 1.5; screenshot clips are whole
  // CSS px, so the browser can only ever produce 2559 (or 2561) there.
  test('c24/c25: the 2560px crop endpoint is expected at its rasterized 2559px, exactly', () => {
    for (const id of ['c24', 'c25']) {
      const job = jobById(id)
      const first = expectedSourceFrameSize(job, 0)
      expect(first, id).toEqual({ width: 2559, height: 1440 })
      const sizes = Array.from({ length: job.frames }, (_, index) => {
        const size = expectedSourceFrameSize(job, index)
        return { width: Math.round(size.width), height: Math.round(size.height) }
      })
      expect(checkSourceFrameSizes(job, sizes), id).toEqual([])
      // Exactly run #4's rejected first frame now passes...
      expect(checkSourceFrameSizes(job, [{ width: 2559, height: 1440 }, ...sizes.slice(1)]), id).toEqual([])
      // ...but a genuinely different crop is still rejected, either way.
      for (const wrong of [{ width: 2560, height: 1440 }, { width: 2558, height: 1440 }, { width: 2561, height: 1440 }, { width: 2559, height: 1439 }]) {
        expect(checkSourceFrameSizes(job, [wrong, ...sizes.slice(1)]), `${id} ${wrong.width}x${wrong.height}`).toHaveLength(1)
      }
    }
    expect(expectedSourceFrameSize(jobById('c24'), jobById('c24').frames - 1)).toEqual({ width: 1920, height: 1080 })
    expect(expectedSourceFrameSize(jobById('c25'), jobById('c25').frames - 1)).toEqual({ width: 3840, height: 2160 })
  })

  test('c16: a STATIC 2560x1440 crop is also exactly 2559x1440 on every frame', () => {
    const job = jobById('c16')
    expect(job.crop).toEqual({ x: 620, y: 380, w: 2560, h: 1440 })
    const sizes = Array.from({ length: job.frames }, () => ({ width: 2559, height: 1440 }))
    expect(checkSourceFrameSizes(job, sizes)).toEqual([])
    expect(checkSourceFrameSizes(job, [...sizes.slice(1), { width: 2560, height: 1440 }])).toHaveLength(1)
  })

  test('PLATE / HUD / PORT sizes that are whole CSS pixels stay strict and unchanged', () => {
    // Every other locked crop is a whole number of CSS pixels at its DPR, so
    // its expectation is the literal crop size, still with zero tolerance.
    const unaffected = clips.filter((clip) => !['c16', 'c24', 'c25'].includes(clip.id))
    for (const clip of unaffected) {
      const job = jobById(clip.id)
      expect(expectedSourceFrameSize(job, 0), clip.id).toEqual({ width: job.crop.w, height: job.crop.h })
      if (job.frames > 1) {
        expect(expectedSourceFrameSize(job, job.frames - 1), clip.id).toEqual({ width: job.cropEnd.w, height: job.cropEnd.h })
      }
    }
    for (const [id, size] of [['c04', { width: 1920, height: 1080 }], ['c14', { width: 1170, height: 2532 }], ['c18', { width: 1170, height: 2532 }]] as const) {
      const job = jobById(id)
      expect(checkSourceFrameSizes(job, [{ width: size.width - 1, height: size.height }, ...Array(job.frames - 1).fill(size)]), id).toHaveLength(1)
    }
  })

  test('a still with a crop push is captured at its start crop only', () => {
    expect(expectedSourceFrameSize(jobById('c21'), 0)).toEqual({ width: 2880, height: 1620 })
  })
})

test.describe('expected canvas buffer', () => {
  // Regression coverage for the run-#3 c18 failure: renderGroup.mjs's
  // finishClip() compared the real (correct, DPR-capped) canvas buffer
  // capture-health.json recorded against this function — which used to
  // delegate to finalEdit.ts's sourceFrameSize(), the *screenshot* pixel
  // size (CSS viewport x deviceScaleFactor, uncapped). That coincides with
  // the real buffer for PLATE/HUD (their capture/initCapture.ts DPR
  // override keeps the production megapixel cap from ever binding), which
  // is exactly why the bug was invisible there and only ever fired for
  // PORT, whose buffer is genuinely capped smaller than its screenshot.
  test('PORT: capped by the forced-high-tier maxDpr, smaller than its screenshot size', () => {
    expect(expectedCanvasBuffer('PORT')).toEqual({ width: 585, height: 1266 })
    expect(expectedCanvasBuffer('PORT')).not.toEqual({ width: 1170, height: 2532 })
  })

  test('PLATE and HUD: the DPR override keeps the buffer equal to cssSize x deviceScaleFactor', () => {
    expect(expectedCanvasBuffer('PLATE')).toEqual({ width: 3840, height: 2160 })
    expect(expectedCanvasBuffer('HUD')).toEqual({ width: 1920, height: 1080 })
  })

  test('every clip in the locked timeline reports a real, matching canvas buffer', () => {
    for (const job of jobs) {
      const buffer = expectedCanvasBuffer(job.profile)
      expect(buffer.width, job.jobId).toBeGreaterThan(0)
      expect(buffer.height, job.jobId).toBeGreaterThan(0)
    }
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

test.describe('attempt ceilings (capture/finalRender/timing.ts)', () => {
  test('derived from frames x clock: a healthy slow clip gets far more than the old flat 30 min', () => {
    const OLD_FLAT_MS = 30 * 60_000
    // Every progress clip run #4 timed out at 30 min, measured wall time vs ceiling.
    for (const measured of RUN4_MEASUREMENTS.filter((entry) => entry.clock === 'progress' && entry.finished)) {
      const ceiling = attemptCeilingMs(jobById(measured.clipId), measured.frames)
      expect(ceiling, measured.clipId).toBeGreaterThan(OLD_FLAT_MS)
      expect(ceiling, measured.clipId).toBeGreaterThan(measured.minutes * 60_000 * 1.5)
    }
    for (const measured of RUN4_MEASUREMENTS.filter((entry) => entry.clock === 'elapsed-ms')) {
      expect(attemptCeilingMs(jobById(measured.clipId), measured.frames), measured.clipId).toBeGreaterThan(measured.minutes * 60_000 * 3)
    }
    expect(attemptCeilingMs(jobById('c18'), 1)).toBe(ATTEMPT_FIXED_ALLOWANCE_MS)
    expect(HARD_SEC_PER_FRAME).toEqual({ progress: 90, 'elapsed-ms': 20, still: 0 })
  })

  test('a resumed attempt only budgets the frames it still has to render', () => {
    const c07 = jobById('c07')
    expect(attemptCeilingMs(c07, 10)).toBeLessThan(attemptCeilingMs(c07, 144))
  })

  test('CAPTURE_FINAL_TIMEOUT_MS overrides the derived ceiling; garbage is rejected', () => {
    const c07 = jobById('c07')
    expect(attemptTimeoutMs(c07, 144, undefined)).toBe(attemptCeilingMs(c07, 144))
    expect(attemptTimeoutMs(c07, 144, '')).toBe(attemptCeilingMs(c07, 144))
    expect(attemptTimeoutMs(c07, 144, '90000')).toBe(90_000)
    expect(() => attemptTimeoutMs(c07, 144, '0')).toThrow()
    expect(() => attemptTimeoutMs(c07, 144, 'soon')).toThrow()
  })

  test('only elapsed-ms clips are re-rendered whole instead of resumed per frame', () => {
    const oneSession = jobs.filter((job) => rendersInOneSession(job)).map((job) => job.jobId)
    expect(oneSession).toEqual(['c17', 'c19', 'c20', 'c22', 'c23', 'c24', 'c25'])
  })
})

test.describe('final-preflight', () => {
  test('four parallel parts cover every run #4 failure class, each well under 45 min', () => {
    expect(PREFLIGHT_PARTS.map((part) => part.id)).toEqual(['c19-dense', 'crops-port', 'progress-c07', 'timeout-resume'])
    const touched = new Set(PREFLIGHT_PARTS.flatMap((part) => part.clipIds))
    for (const clipId of ['c19', 'c24', 'c25', 'c16', 'c18', 'c07']) expect(touched.has(clipId), clipId).toBe(true)
    for (const part of PREFLIGHT_PARTS) expect(part.estimatedMinutes, part.id).toBeLessThanOrEqual(30)
    const matrix = preflightMatrix()
    expect(matrix.include.map((row) => [row.group, row.part, row.kind])).toEqual(
      PREFLIGHT_PARTS.map((part) => [`preflight-${part.id}`, part.id, 'preflight']),
    )
  })

  const c19 = () => jobById('c19')
  const evidence = (drift: (index: number) => number) =>
    Array.from({ length: 108 }, (_, index) => {
      const requested = 80 + (index * 600) / 107
      return { index, tookMs: 2_000, requestedSource: requested, renderedSourceMs: Math.ceil(requested) + drift(index) }
    })

  test('exact-sampling check passes whole-ms rounding and catches run #4\'s drift', () => {
    expect(checkExactSampling(c19(), evidence(() => 0))).toEqual([])
    // Run #4: +16ms per frame, then +80ms per frame after the volley.
    const drifted = checkExactSampling(c19(), evidence((index) => index * (16 - 600 / 107)))
    expect(drifted.length).toBeGreaterThan(100)
    expect(checkExactSampling(c19(), evidence(() => 0).slice(1))).toEqual(['c19 frame 0: no render-time evidence'])
    const repeated = evidence(() => 0)
    repeated[5] = { ...repeated[5]!, renderedSourceMs: repeated[4]!.renderedSourceMs }
    expect(checkExactSampling(c19(), repeated).some((problem) => /not after the previous/.test(problem))).toBe(true)
    // Progress-event clips carry no source-time evidence and are not checked here.
    expect(checkExactSampling(jobById('c07'), [])).toEqual([])
  })

  test('proof sizes are checked exactly against the rasterized crop', () => {
    const c24 = jobById('c24')
    const good = new Map([[0, { width: 2559, height: 1440 }], [53, { width: 2243, height: 1262 }], [107, { width: 1920, height: 1080 }]])
    expect(checkProofFrameSizes(c24, good)).toEqual([])
    expect(checkProofFrameSizes(c24, new Map([[53, { width: 2240, height: 1262 }]]))).toHaveLength(1)
    expect(checkProofFrameSizes(c24, new Map([[0, { width: 2560, height: 1440 }]]))).toHaveLength(1)
    expect(checkProofFrameSizes(jobById('c07'), new Map([[71, { width: 3840, height: 2160 }]]))).toEqual([])
  })

  test('forced-timeout recovery requires a real mid-render cut and a completed retry', () => {
    const cut = { attempt: 1, exitCode: 1, timeoutMs: 120_000, elapsedMs: 125_000, validBefore: 0, validAfter: 31 }
    const done = { attempt: 2, exitCode: 0, timeoutMs: 46 * 60_000, elapsedMs: 240_000, validBefore: 31, validAfter: 108 }
    expect(checkForcedTimeoutRecovery([cut, done], 2)).toEqual([])
    expect(checkForcedTimeoutRecovery([done], 2)).toHaveLength(1)
    expect(checkForcedTimeoutRecovery([{ ...cut, exitCode: 0 }, done], 2).length).toBeGreaterThan(0)
    expect(checkForcedTimeoutRecovery([{ ...cut, validAfter: 0 }, done], 2).length).toBeGreaterThan(0)
    expect(checkForcedTimeoutRecovery([cut, { ...done, exitCode: 1 }], 2).length).toBeGreaterThan(0)
  })

  test('c01 projection at a sampled per-frame rate', () => {
    const c01 = jobById('c01')
    expect(projectClipMinutes(c01, 45)).toBeLessThan(JOB_CEILING_MINUTES)
    expect(projectClipMinutes(c01, 70)).toBeGreaterThan(JOB_CEILING_MINUTES)
  })
})
