/**
 * Pure planning logic for the final-render pipeline: turns the locked
 * capture/finalEdit.json into a flat list of render jobs (one per timeline
 * clip id or derivative export id), each carrying exactly what the engine
 * needs to capture it — no browser, no filesystem, so every calculation
 * here is unit-testable on paper.
 *
 * Frame counts are NOT recomputed independently: they are read straight out
 * of finalEdit.ts's own deriveRenderPlan(), which is already the tested
 * source of truth for "only referenced shots, only the windows the cut
 * uses, one real frame per output frame" (capture/finalEdit.spec.ts's
 * render-plan suite). This module only adds what deriveRenderPlan
 * deliberately leaves out — crop/cropEnd, act, and a stable final-edit
 * order — by joining its output back to the original timeline/derivative
 * items via clip id.
 */
import {
  deriveRenderPlan,
  isShotClip,
  type CropRect,
  type EditAct,
  type FinalEdit,
  type ShotIndexEntry,
  type SourceWindow,
} from '../finalEdit.ts'
import type { CaptureProfileId } from '../profiles.ts'

export type JobAct = EditAct | 'DERIVATIVES'

export interface FinalRenderJob {
  readonly jobId: string
  readonly shotId: string
  readonly profile: CaptureProfileId
  readonly act: JobAct
  readonly source: SourceWindow
  /** Unique real frames to capture. 1 for a still or a single-instant export. */
  readonly frames: number
  readonly crop: CropRect
  /** Equal to `crop` when the clip has no cropEnd (static crop). */
  readonly cropEnd: CropRect
  /** Position in final-edit order: timeline clips first (their own order),
   * then derivative exports (poster, stills, mobileScreenshots) in the
   * order finalEdit.json lists them. */
  readonly order: number
}

interface JobMeta {
  readonly crop: CropRect
  readonly cropEnd: CropRect
  readonly act: JobAct
  readonly order: number
}

/**
 * The exact number of unique source frames one destination clip needs:
 * destination duration x output fps. Deliberately independent of playback
 * speed — slow motion is expressed by sampling this same frame count across
 * a narrower source [in, out] window (see sourceValueAt below), never by
 * rendering extra frames. Mirrors (and is cross-checked against, in
 * capture/finalRenderPlan.spec.ts) the frame count deriveRenderPlan already
 * computes for motion clips.
 */
export function requiredSourceFrameCount(destInMs: number, destOutMs: number, outputFps: number): number {
  return Math.round(((destOutMs - destInMs) / 1000) * outputFps)
}

/** Where in a clip's own source window (native units — normalized progress
 * for 'progress', ms-since-origin for 'elapsed-ms') frame index `i` of
 * `frames` total falls. Inclusive of both endpoints (t=0 at i=0, t=1 at the
 * last index) rather than a video-frame-boundary offset: the proof pass
 * exists specifically to scrutinize the approved in/out boundaries
 * themselves, so the first and last captured frame must land exactly on
 * them, not just short of them. */
export function frameProgressAt(index: number, frames: number): number {
  if (frames <= 1) return 0
  return index / (frames - 1)
}

export function sourceValueAt(source: SourceWindow, t: number): number {
  if (source.clock === 'still') return 0
  const inValue = source.clock === 'progress' ? source.in : source.inMs
  const outValue = source.clock === 'progress' ? source.out : source.outMs
  return inValue + t * (outValue - inValue)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Linear interpolation between a clip's start crop and its cropEnd (or the
 * same crop, for a static composition) at position `t` in [0, 1]. */
export function interpolateCrop(start: CropRect, end: CropRect, t: number): CropRect {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    w: lerp(start.w, end.w, t),
    h: lerp(start.h, end.h, t),
  }
}

export interface CssClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** finalEdit.json crops are in screenshot/device pixels (CSS viewport x
 * deviceScaleFactor — see finalEdit.ts's module doc). Playwright's
 * `page.screenshot({ clip })` takes CSS pixels and multiplies by the
 * context's own deviceScaleFactor internally, so the crop must be divided
 * back down before use — otherwise a clip meant to select the full
 * 3840x2160 PLATE buffer would ask for a 3840x2160 *CSS*-pixel region (2.25x
 * too large) instead of the intended 2560x1440 CSS region. */
export function toCssClip(crop: CropRect, deviceScaleFactor: number): CssClip {
  return {
    x: crop.x / deviceScaleFactor,
    y: crop.y / deviceScaleFactor,
    width: crop.w / deviceScaleFactor,
    height: crop.h / deviceScaleFactor,
  }
}

/**
 * Builds the flat, ordered job list the final-render engine and CLI operate
 * on: exactly the shots/windows capture/finalEdit.ts's deriveRenderPlan()
 * already selects (only referenced shots, cut-referenced windows only,
 * export-instant dedup against an identical still already held by the cut),
 * with crop/cropEnd/act/order rejoined from the original timeline and
 * derivative items.
 */
export function buildFinalRenderJobs(edit: FinalEdit, shots: readonly ShotIndexEntry[]): FinalRenderJob[] {
  const metaById = new Map<string, JobMeta>()
  let order = 0
  for (const item of edit.timeline) {
    if (!isShotClip(item)) continue
    metaById.set(item.id, {
      crop: item.crop,
      cropEnd: item.cropEnd ?? item.crop,
      act: item.act,
      order: order++,
    })
  }
  const { poster, stills, mobileScreenshots } = edit.derivatives
  for (const exportItem of [poster, ...stills, ...mobileScreenshots]) {
    metaById.set(exportItem.id, {
      crop: exportItem.crop,
      cropEnd: exportItem.crop,
      act: 'DERIVATIVES',
      order: order++,
    })
  }

  const jobs: FinalRenderJob[] = []
  for (const renderShot of deriveRenderPlan(edit, shots)) {
    for (const window of renderShot.windows) {
      const meta = metaById.get(window.clipId)
      if (meta === undefined) {
        throw new Error(`final-render plan: no timeline/derivative entry for clip "${window.clipId}"`)
      }
      jobs.push({
        jobId: window.clipId,
        shotId: renderShot.shotId,
        profile: renderShot.profile,
        act: meta.act,
        source: window.source,
        frames: window.frames,
        crop: meta.crop,
        cropEnd: meta.cropEnd,
        order: meta.order,
      })
    }
  }
  return jobs.sort((a, b) => a.order - b.order)
}
