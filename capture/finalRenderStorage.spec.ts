/**
 * Storage-preflight tests (Phase D): expected-frame/storage estimation and
 * the free-disk-space refusal gate. No browser.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { FinalRenderJob } from './finalRender/plan.ts'
import {
  checkStoragePreflight,
  estimateStorage,
  recalibrateBytesPerPixel,
  requiredBytesFor,
  DEFAULT_BYTES_PER_PIXEL_ESTIMATE,
} from './finalRender/storage.ts'

function makeJob(overrides: Partial<FinalRenderJob>): FinalRenderJob {
  return {
    jobId: 'test',
    shotId: 'test-shot',
    profile: 'PLATE',
    act: 'DERIVATIVES',
    source: { clock: 'still' },
    frames: 1,
    crop: { x: 0, y: 0, w: 1000, h: 1000 },
    cropEnd: { x: 0, y: 0, w: 1000, h: 1000 },
    order: 0,
    ...overrides,
  }
}

test.describe('storage estimate', () => {
  test('a static-crop job estimates crop-area x frames x bytes-per-pixel', () => {
    const job = makeJob({ frames: 10, crop: { x: 0, y: 0, w: 100, h: 100 }, cropEnd: { x: 0, y: 0, w: 100, h: 100 } })
    const estimate = estimateStorage([job], 2)
    expect(estimate.frames).toBe(10)
    expect(estimate.estimatedBytes).toBe(100 * 100 * 10 * 2)
  })

  test('a moving crop (crop -> cropEnd) uses the average of the two areas', () => {
    const job = makeJob({
      frames: 4,
      crop: { x: 0, y: 0, w: 100, h: 100 }, // area 10,000
      cropEnd: { x: 0, y: 0, w: 200, h: 200 }, // area 40,000
    })
    const estimate = estimateStorage([job], 1)
    expect(estimate.estimatedBytes).toBe(((10_000 + 40_000) / 2) * 4)
  })

  test('multiple jobs sum both frames and bytes', () => {
    const jobA = makeJob({ frames: 5, crop: { x: 0, y: 0, w: 10, h: 10 }, cropEnd: { x: 0, y: 0, w: 10, h: 10 } })
    const jobB = makeJob({ frames: 3, crop: { x: 0, y: 0, w: 20, h: 20 }, cropEnd: { x: 0, y: 0, w: 20, h: 20 } })
    const estimate = estimateStorage([jobA, jobB], 1)
    expect(estimate.frames).toBe(8)
    expect(estimate.estimatedBytes).toBe(10 * 10 * 5 + 20 * 20 * 3)
  })

  test('recalibrateBytesPerPixel derives a real ratio from measured samples', () => {
    const ratio = recalibrateBytesPerPixel([
      { pixels: 1_000, bytes: 500 },
      { pixels: 1_000, bytes: 700 },
    ])
    expect(ratio).toBeCloseTo(0.6, 10) // (500+700) / (1000+1000)
  })

  test('recalibrateBytesPerPixel falls back to the default with no samples', () => {
    expect(recalibrateBytesPerPixel([])).toBe(DEFAULT_BYTES_PER_PIXEL_ESTIMATE)
  })

  test('requiredBytesFor applies the larger of a proportional margin or a flat floor', () => {
    // Small estimate: the flat 2 GiB floor dominates the 25% margin.
    const small = requiredBytesFor(1_000_000)
    expect(small).toBeCloseTo(1_000_000 + 2 * 1024 ** 3, -3)
    // Large estimate: the 25% proportional margin dominates the flat floor.
    const large = requiredBytesFor(100 * 1024 ** 3)
    expect(large).toBeCloseTo(100 * 1024 ** 3 * 1.25, -3)
  })
})

test.describe('storage preflight', () => {
  let scratchDir: string

  test.beforeEach(async () => {
    scratchDir = await mkdtemp(path.join(tmpdir(), 'final-render-storage-test-'))
  })

  test.afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true })
  })

  test('passes when the estimate comfortably fits free disk space', async () => {
    const result = await checkStoragePreflight(1_000, scratchDir) // 1 KB — trivially small
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.freeBytes).toBeGreaterThan(0)
  })

  test('refuses to start when the estimate would not leave a safe margin', async () => {
    // Ask for far more than any real disk has: the preflight must refuse
    // rather than let the run start and fail hours in.
    const impossibleEstimate = Number.MAX_SAFE_INTEGER
    const result = await checkStoragePreflight(impossibleEstimate, scratchDir)
    expect(result.ok).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0]).toMatch(/Only .* GB free/)
  })
})
