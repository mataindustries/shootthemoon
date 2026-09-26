/**
 * Storage safety preflight (Phase D): estimate expected output size from the
 * job plan, check it against real free disk space, and refuse to start
 * without a safe margin — rather than trusting a fixed number carried over
 * from an earlier audit.
 */
import { statfs } from 'node:fs/promises'
import type { FinalRenderJob } from './plan.ts'

/**
 * Starting estimate only. This is NOT a measurement — it is later replaced
 * by `recalibrateBytesPerPixel()` fed real file sizes from the proof pass
 * (Phase E), which actually captures a handful of real frames per job and
 * can report their true average bytes/pixel before the expensive full
 * render commits to anything.
 */
export const DEFAULT_BYTES_PER_PIXEL_ESTIMATE = 0.55

export interface StorageEstimate {
  readonly frames: number
  readonly estimatedBytes: number
  readonly bytesPerPixelEstimate: number
}

function averageCropArea(job: FinalRenderJob): number {
  const start = job.crop.w * job.crop.h
  const end = job.cropEnd.w * job.cropEnd.h
  return (start + end) / 2
}

export function estimateStorage(
  jobs: readonly FinalRenderJob[],
  bytesPerPixel: number = DEFAULT_BYTES_PER_PIXEL_ESTIMATE,
): StorageEstimate {
  let frames = 0
  let bytes = 0
  for (const job of jobs) {
    frames += job.frames
    bytes += averageCropArea(job) * job.frames * bytesPerPixel
  }
  return { frames, estimatedBytes: Math.round(bytes), bytesPerPixelEstimate: bytesPerPixel }
}

/** Recalculates a real bytes/pixel ratio from actually-captured frames
 * (pixel count x real file size on disk), so the full-render estimate stops
 * relying on a guessed constant. */
export function recalibrateBytesPerPixel(samples: readonly { readonly pixels: number; readonly bytes: number }[]): number {
  const totalPixels = samples.reduce((sum, sample) => sum + sample.pixels, 0)
  if (totalPixels === 0) return DEFAULT_BYTES_PER_PIXEL_ESTIMATE
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0)
  return totalBytes / totalPixels
}

export interface StoragePreflightResult {
  readonly ok: boolean
  readonly estimatedBytes: number
  readonly requiredBytes: number
  readonly freeBytes: number
  readonly reasons: readonly string[]
}

/** Require the estimate plus a 25% safety margin, or a flat 2 GiB headroom
 * floor, whichever is larger — so a small render still demands sane
 * absolute headroom, and a large one scales its margin with its own size. */
const SAFETY_FACTOR = 1.25
const MINIMUM_HEADROOM_BYTES = 2 * 1024 * 1024 * 1024

export function requiredBytesFor(estimatedBytes: number): number {
  return Math.max(estimatedBytes * SAFETY_FACTOR, estimatedBytes + MINIMUM_HEADROOM_BYTES)
}

export async function checkStoragePreflight(estimatedBytes: number, targetDir: string): Promise<StoragePreflightResult> {
  const stats = await statfs(targetDir)
  const freeBytes = stats.bavail * stats.bsize
  const requiredBytes = requiredBytesFor(estimatedBytes)
  const reasons: string[] = []
  if (freeBytes < requiredBytes) {
    const gb = (bytes: number) => (bytes / 1e9).toFixed(2)
    reasons.push(
      `Only ${gb(freeBytes)} GB free at "${targetDir}"; need at least ${gb(requiredBytes)} GB ` +
        `(estimate ${gb(estimatedBytes)} GB x ${SAFETY_FACTOR} safety factor, ` +
        `floor +${(MINIMUM_HEADROOM_BYTES / 1e9).toFixed(1)} GB headroom).`,
    )
  }
  return { ok: reasons.length === 0, estimatedBytes, requiredBytes, freeBytes, reasons }
}
