/**
 * Resume/failure-safety tests for capture/finalRender/resume.ts: missing,
 * corrupt, and frozen/duplicate frame detection; atomic completion markers;
 * and per-job isolation. Pure Node fs, no browser — same convention as
 * capture/integrity.spec.ts's own metadata-shape tests.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { FinalRenderJob } from './finalRender/plan.ts'
import {
  directorySizeBytes,
  indicesNeedingRender,
  isFullyValid,
  isJobComplete,
  jobFrameDir,
  jobOutputDir,
  markJobComplete,
  readJobMetadata,
  validateJobFrames,
  writeJobMetadata,
  FINAL_RENDER_OUTPUT_ROOT,
  type RenderJobMetadata,
} from './finalRender/resume.ts'
import { frameFilename } from './runner.ts'

let nextTestId = 0
function makeJob(frames: number): FinalRenderJob {
  nextTestId += 1
  return {
    jobId: `.rtest-${nextTestId}`,
    shotId: 'resume-test-shot',
    profile: 'PLATE',
    act: 'DERIVATIVES',
    source: { clock: 'still' },
    frames,
    crop: { x: 0, y: 0, w: 10, h: 10 },
    cropEnd: { x: 0, y: 0, w: 10, h: 10 },
    order: 0,
  }
}

function baseMetadata(job: FinalRenderJob): RenderJobMetadata {
  return {
    jobId: job.jobId,
    shotId: job.shotId,
    profile: job.profile,
    expectedFrames: job.frames,
    renderedFrames: 0,
    status: 'in-progress',
    startedAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
    completedAtIso: null,
    error: null,
  }
}

const createdDirs: string[] = []
async function writeFrame(job: FinalRenderJob, index: number, content: string): Promise<void> {
  const dir = jobFrameDir(job)
  createdDirs.push(jobOutputDir(job))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, frameFilename(index)), content)
}

test.afterAll(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

test.describe('resume behavior', () => {
  test('missing frames are reported and queued for render; present ones are not', async () => {
    const job = makeJob(3)
    await writeFrame(job, 0, 'frame-0')
    await writeFrame(job, 2, 'frame-2')
    const validation = await validateJobFrames(job)
    expect([...validation.validIndices].sort()).toEqual([0, 2])
    expect(validation.missingIndices).toEqual([1])
    expect(indicesNeedingRender(validation)).toEqual([1])
  })

  test('an already-valid frame is left alone across a resume pass (never in indicesNeedingRender)', async () => {
    const job = makeJob(2)
    await writeFrame(job, 0, 'stable-frame-0')
    await writeFrame(job, 1, 'stable-frame-1')
    const validation = await validateJobFrames(job)
    expect(indicesNeedingRender(validation)).toEqual([])
    expect(isFullyValid(job, validation)).toBe(true)
  })

  test('zero-byte (corrupt) frames are flagged for re-render, not treated as valid', async () => {
    const job = makeJob(2)
    await writeFrame(job, 0, 'ok')
    await writeFrame(job, 1, '')
    const validation = await validateJobFrames(job)
    expect(validation.corruptIndices).toEqual([1])
    expect(indicesNeedingRender(validation)).toEqual([1])
  })
})

test.describe('duplicate/frozen frame detection', () => {
  test('byte-identical adjacent frames in a motion clip are flagged as frozen', async () => {
    const job = makeJob(3)
    await writeFrame(job, 0, 'moving-a')
    await writeFrame(job, 1, 'moving-a') // identical to frame 0 -> frozen
    await writeFrame(job, 2, 'moving-b')
    const validation = await validateJobFrames(job)
    expect(validation.duplicateIndices).toEqual([1])
    expect(indicesNeedingRender(validation)).toEqual([1])
  })

  test('a still (frames=1) is never flagged, since there is no adjacent frame to compare', async () => {
    const job = makeJob(1)
    await writeFrame(job, 0, 'only-frame')
    const validation = await validateJobFrames(job)
    expect(validation.duplicateIndices).toEqual([])
    expect(isFullyValid(job, validation)).toBe(true)
  })

  test('non-adjacent identical frames (real repeated composition, not a stall) are not flagged', async () => {
    const job = makeJob(3)
    await writeFrame(job, 0, 'a')
    await writeFrame(job, 1, 'b')
    await writeFrame(job, 2, 'a') // same bytes as frame 0, but not adjacent to it
    const validation = await validateJobFrames(job)
    expect(validation.duplicateIndices).toEqual([])
  })
})

test.describe('expected vs rendered frame count', () => {
  test('in-progress metadata records a partial rendered count distinct from expectedFrames', async () => {
    const job = makeJob(5)
    await writeFrame(job, 0, 'x')
    await writeFrame(job, 1, 'y')
    await writeJobMetadata(job, { ...baseMetadata(job), renderedFrames: 2 })
    const metadata = await readJobMetadata(job)
    expect(metadata?.expectedFrames).toBe(5)
    expect(metadata?.renderedFrames).toBe(2)
    expect(metadata?.status).toBe('in-progress')
  })
})

test.describe('completion markers', () => {
  test('a clip is not complete until markJobComplete runs after a full valid pass', async () => {
    const job = makeJob(2)
    await writeFrame(job, 0, 'x')
    await writeFrame(job, 1, 'y')
    expect(await isJobComplete(job)).toBe(false)
    const validation = await validateJobFrames(job)
    expect(isFullyValid(job, validation)).toBe(true)
    await markJobComplete(job, baseMetadata(job))
    expect(await isJobComplete(job)).toBe(true)
    const metadata = await readJobMetadata(job)
    expect(metadata?.status).toBe('complete')
    expect(metadata?.completedAtIso).not.toBeNull()
  })

  test('an incomplete clip is never marked complete', async () => {
    const job = makeJob(2)
    await writeFrame(job, 0, 'x') // frame 1 missing
    const validation = await validateJobFrames(job)
    expect(isFullyValid(job, validation)).toBe(false)
    expect(await isJobComplete(job)).toBe(false)
  })
})

test.describe('per-job isolation', () => {
  test('one job failing to validate never touches another job\'s output directory', async () => {
    const jobA = makeJob(2)
    const jobB = makeJob(2)
    await writeFrame(jobA, 0, 'a0') // jobA incomplete (missing frame 1)
    await writeFrame(jobB, 0, 'b0')
    await writeFrame(jobB, 1, 'b1')
    await markJobComplete(jobB, baseMetadata(jobB))

    const validationA = await validateJobFrames(jobA)
    expect(isFullyValid(jobA, validationA)).toBe(false)
    expect(await isJobComplete(jobA)).toBe(false)
    // jobB's completion is untouched by jobA's failure.
    expect(await isJobComplete(jobB)).toBe(true)
  })
})

test.describe('disk consumed', () => {
  test('directorySizeBytes sums nested file sizes exactly', async () => {
    const job = makeJob(2)
    await writeFrame(job, 0, '12345') // 5 bytes
    await writeFrame(job, 1, '1234567890') // 10 bytes
    const bytes = await directorySizeBytes(jobOutputDir(job))
    expect(bytes).toBe(15)
  })

  test('a nonexistent directory reports zero bytes rather than throwing', async () => {
    expect(await directorySizeBytes(path.join(FINAL_RENDER_OUTPUT_ROOT, '.does-not-exist'))).toBe(0)
  })
})
