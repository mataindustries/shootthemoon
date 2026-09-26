/**
 * Resume/failure-safety bookkeeping for the final render (Phase C): each job
 * gets its own output directory, a JSON metadata file tracking
 * expected-vs-rendered frame counts, a validator that detects
 * missing/corrupt/duplicate ("frozen") frames, and an atomic completion
 * marker written only after a full validation pass — so a crash mid-clip
 * never leaves a false "done" signal, and one failed clip never touches
 * another clip's already-completed output.
 */
import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { frameFilename } from '../runner.ts'
import type { FinalRenderJob } from './plan.ts'

export const FINAL_RENDER_OUTPUT_ROOT = 'capture-final'

export function jobOutputDir(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): string {
  return path.join(FINAL_RENDER_OUTPUT_ROOT, `${job.jobId}__${job.shotId}`)
}
export function jobFrameDir(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): string {
  return path.join(jobOutputDir(job), 'frames')
}
function jobMetadataPath(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): string {
  return path.join(jobOutputDir(job), 'render.json')
}
function jobCompleteMarkerPath(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): string {
  return path.join(jobOutputDir(job), '.complete')
}

export type JobStatus = 'pending' | 'in-progress' | 'complete' | 'failed'

export interface RenderJobMetadata {
  readonly jobId: string
  readonly shotId: string
  readonly profile: string
  readonly expectedFrames: number
  readonly renderedFrames: number
  readonly status: JobStatus
  readonly startedAtIso: string
  readonly updatedAtIso: string
  readonly completedAtIso: string | null
  readonly error: string | null
}

async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, contents)
  await rename(tmpPath, filePath)
}

export async function readJobMetadata(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): Promise<RenderJobMetadata | null> {
  try {
    const raw = await readFile(jobMetadataPath(job), 'utf8')
    return JSON.parse(raw) as RenderJobMetadata
  } catch {
    return null
  }
}

export async function writeJobMetadata(
  job: Pick<FinalRenderJob, 'jobId' | 'shotId'>,
  metadata: RenderJobMetadata,
): Promise<void> {
  await atomicWriteFile(jobMetadataPath(job), JSON.stringify(metadata, null, 2) + '\n')
}

export async function isJobComplete(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>): Promise<boolean> {
  try {
    await stat(jobCompleteMarkerPath(job))
    return true
  } catch {
    return false
  }
}

/** Writes the completion marker only after the caller has already validated
 * every expected frame is present, non-corrupt, and free of adjacent
 * duplicates — the marker itself is the atomic step (temp file + rename),
 * so a process killed mid-write leaves either the old state or nothing,
 * never a half-written marker that would read as "complete". */
export async function markJobComplete(
  job: Pick<FinalRenderJob, 'jobId' | 'shotId'>,
  metadata: RenderJobMetadata,
): Promise<void> {
  await writeJobMetadata(job, { ...metadata, status: 'complete', completedAtIso: new Date().toISOString() })
  await atomicWriteFile(jobCompleteMarkerPath(job), new Date().toISOString() + '\n')
}

async function sha1(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  return createHash('sha1').update(buffer).digest('hex')
}

export interface FrameValidation {
  readonly validIndices: ReadonlySet<number>
  readonly missingIndices: readonly number[]
  /** Present on disk but zero-byte or unreadable. */
  readonly corruptIndices: readonly number[]
  /** Byte-identical to the immediately preceding frame in a motion clip
   * (frames > 1) — a frozen/stuck render rather than genuine continuous
   * motion. Never flagged for a still (frames === 1). */
  readonly duplicateIndices: readonly number[]
}

/** Scans a job's frame directory against its expected frame count. Used both
 * to decide what a resume still needs to render, and (after rendering) to
 * decide whether the clip is genuinely complete. */
export async function validateJobFrames(job: FinalRenderJob): Promise<FrameValidation> {
  const frameDir = jobFrameDir(job)
  const entries = await readdir(frameDir).catch(() => [] as string[])
  const present = new Set(entries.filter((name) => name.endsWith('.png') && !name.includes('.tmp')))

  const validIndices = new Set<number>()
  const missingIndices: number[] = []
  const corruptIndices: number[] = []
  const hashByIndex = new Map<number, string>()

  for (let index = 0; index < job.frames; index += 1) {
    const filename = frameFilename(index)
    if (!present.has(filename)) {
      missingIndices.push(index)
      continue
    }
    const filePath = path.join(frameDir, filename)
    try {
      const stats = await stat(filePath)
      if (stats.size === 0) {
        corruptIndices.push(index)
        continue
      }
      hashByIndex.set(index, await sha1(filePath))
      validIndices.add(index)
    } catch {
      corruptIndices.push(index)
    }
  }

  const duplicateIndices: number[] = []
  if (job.frames > 1) {
    let previousHash: string | null = null
    let previousIndex = -1
    for (let index = 0; index < job.frames; index += 1) {
      const hash = hashByIndex.get(index)
      if (hash === undefined) continue
      if (previousHash !== null && hash === previousHash && index === previousIndex + 1) {
        duplicateIndices.push(index)
      }
      previousHash = hash
      previousIndex = index
    }
  }

  return { validIndices, missingIndices, corruptIndices, duplicateIndices }
}

/** Indices that still need a real capture: missing, corrupt, or flagged as a
 * frozen duplicate. Everything else already has a valid, distinct frame on
 * disk and is left untouched — "existing valid frames are not overwritten
 * unnecessarily". */
export function indicesNeedingRender(validation: FrameValidation): number[] {
  const bad = new Set<number>([...validation.missingIndices, ...validation.corruptIndices, ...validation.duplicateIndices])
  return [...bad].sort((a, b) => a - b)
}

export function isFullyValid(job: FinalRenderJob, validation: FrameValidation): boolean {
  return (
    validation.missingIndices.length === 0 &&
    validation.corruptIndices.length === 0 &&
    validation.duplicateIndices.length === 0 &&
    validation.validIndices.size === job.frames
  )
}

/** Deletes an existing frame file before it's re-rendered (corrupt/duplicate
 * indices only — missing ones have nothing to delete). Best-effort: a
 * missing file is not an error. */
export async function clearFrame(job: Pick<FinalRenderJob, 'jobId' | 'shotId'>, index: number): Promise<void> {
  await rm(path.join(jobFrameDir(job), frameFilename(index)), { force: true })
}

/** Recursive directory size in bytes, for the "disk consumed" line of the
 * final summary. Manual recursion (not fs.readdir's `recursive` option) so
 * the result only ever depends on Dirent.name/isDirectory/isFile, which is
 * stable across Node versions. */
export async function directorySizeBytes(dir: string): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySizeBytes(entryPath)
    } else if (entry.isFile()) {
      try {
        total += (await stat(entryPath)).size
      } catch {
        // Ignore races against a concurrently-written file.
      }
    }
  }
  return total
}
