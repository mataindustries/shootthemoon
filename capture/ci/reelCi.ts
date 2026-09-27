/**
 * Pure logic for rendering the locked reel on standard GitHub-hosted Actions
 * runners (.github/workflows/final-render.yml): how the 25 locked shot clips
 * are partitioned into independent jobs, how each clip's temporary 4K PNG
 * sequence becomes its approved 1080p60 intermediate (the exact ffmpeg
 * filter graph), what a finished clip's metadata must say, and the
 * whole-reel cross-check the final verification job runs.
 *
 * No browser, no filesystem, no child processes — so every rule here is
 * unit-tested in capture/ciPipeline.spec.ts. The capture itself is never
 * reimplemented: jobs come from capture/finalRender/plan.ts's
 * buildFinalRenderJobs(), and each clip is rendered by the unchanged
 * capture/finalRender.mjs --clip=<id>.
 */
import { ACT_ORDER, isShotClip, type CropRect, type EditAct, type FinalEdit, type ShotClip } from '../finalEdit.ts'
import { interpolateCrop, rasterizedClipSize, type FinalRenderJob } from '../finalRender/plan.ts'
import type { SourceClock } from '../finalRender/timing.ts'
import { expectedCanvasBufferSize, PROFILES, type CaptureProfileId } from '../profiles.ts'

// ---------------------------------------------------------------------------
// Timeline clips (the 25 locked shots — the end card is not a render job)
// ---------------------------------------------------------------------------

/** The render jobs for the locked timeline's shot clips only, in edit order.
 * Derivative exports (poster/stills/mobile screenshots) are single frames
 * handled separately and deliberately left out of the reel matrix. */
export function timelineJobs(edit: FinalEdit, jobs: readonly FinalRenderJob[]): FinalRenderJob[] {
  const timelineIds = new Set(edit.timeline.filter(isShotClip).map((clip) => clip.id))
  return jobs.filter((job) => timelineIds.has(job.jobId)).sort((a, b) => a.order - b.order)
}

export function shotClipById(edit: FinalEdit, clipId: string): ShotClip {
  const clip = edit.timeline.filter(isShotClip).find((item) => item.id === clipId)
  if (clip === undefined) throw new Error(`clip "${clipId}" is not a shot clip in the locked timeline`)
  return clip
}

/** Destination (final-cut) frames for a clip: its locked duration at the
 * output frame rate. For motion clips this equals the source frame count
 * (one real frame per output frame); a held still is 1 source frame
 * repeated for this many output frames. */
export function outputFrameCount(edit: FinalEdit, clip: ShotClip): number {
  return Math.round(((clip.destOutMs - clip.destInMs) / 1000) * edit.output.fps)
}

// ---------------------------------------------------------------------------
// Job partitioning (Stage 2 matrix)
// ---------------------------------------------------------------------------

/**
 * Wall-clock cost model for one clip on a 4 vCPU / 16 GB ubuntu-latest
 * runner, by the clip's source clock — the clock, not the capture profile,
 * is what run #4 showed decides the cost. Estimates are multiplied by
 * `safetyFactor` before being compared with a ceiling.
 */
export interface RenderCostModel {
  /** Per-clip fixed cost: harness build + preview server + browser context +
   * fixture + reach, before the first frame is requested. */
  readonly clipOverheadSec: number
  /** Ceiling for a clip's first captured frame (shader compile). */
  readonly firstFrameSec: number
  /** Steady-state seconds per subsequent frame, per source clock. */
  readonly secPerFrame: Readonly<Record<SourceClock, number>>
  /** Per-clip verify + encode + contact sheet cost, per source frame. */
  readonly finishSecPerFrame: number
  readonly safetyFactor: number
  readonly provenance: string
}

/** One clip's measured wall time in run #4 (GitHub Actions run
 * 36305258099 at e8989e9, ubuntu-latest). `minutes` is every attempt's
 * render time added up (renderGroup's renderSec); `finished: false` means
 * the clip was still unfinished after that long. */
export interface MeasuredClipRender {
  readonly clipId: string
  readonly frames: number
  readonly clock: SourceClock
  readonly minutes: number
  readonly finished: boolean
}

export const RUN4_MEASUREMENTS: readonly MeasuredClipRender[] = [
  { clipId: 'c04', frames: 144, clock: 'progress', minutes: 54.8, finished: true },
  { clipId: 'c06', frames: 72, clock: 'progress', minutes: 55.0, finished: true },
  { clipId: 'c07', frames: 144, clock: 'progress', minutes: 52.9, finished: true },
  { clipId: 'c08', frames: 144, clock: 'progress', minutes: 45.5, finished: true },
  { clipId: 'c09', frames: 144, clock: 'progress', minutes: 34.5, finished: true },
  { clipId: 'c15', frames: 72, clock: 'progress', minutes: 50.2, finished: true },
  { clipId: 'c01', frames: 288, clock: 'progress', minutes: 92, finished: false },
  { clipId: 'c02', frames: 144, clock: 'progress', minutes: 92, finished: false },
  { clipId: 'c03', frames: 144, clock: 'progress', minutes: 92, finished: false },
  { clipId: 'c10', frames: 144, clock: 'progress', minutes: 92, finished: false },
  { clipId: 'c16', frames: 144, clock: 'progress', minutes: 92, finished: false },
  { clipId: 'c19', frames: 108, clock: 'elapsed-ms', minutes: 5.3, finished: true },
  { clipId: 'c20', frames: 72, clock: 'elapsed-ms', minutes: 3.8, finished: true },
  { clipId: 'c22', frames: 108, clock: 'elapsed-ms', minutes: 3.5, finished: true },
  { clipId: 'c23', frames: 72, clock: 'elapsed-ms', minutes: 2.5, finished: true },
  { clipId: 'c24', frames: 108, clock: 'elapsed-ms', minutes: 3.8, finished: true },
  { clipId: 'c25', frames: 432, clock: 'elapsed-ms', minutes: 22.9, finished: true },
  { clipId: 'c05', frames: 1, clock: 'still', minutes: 0.9, finished: true },
  { clipId: 'c13', frames: 1, clock: 'still', minutes: 0.4, finished: true },
  { clipId: 'c14', frames: 1, clock: 'still', minutes: 0.3, finished: true },
  { clipId: 'c21', frames: 1, clock: 'still', minutes: 0.9, finished: true },
]

/**
 * Calibrated from RUN4_MEASUREMENTS (the 2026-09-26 local c07 figure of
 * 3.46 s/frame this model used to carry was ~6x optimistic for GitHub's
 * progress-event clips): progress-event clips averaged 14.4-45.8 s/frame
 * end to end (c06 worst; c02/c03/c10/c16 >= 38 s/frame unfinished), so
 * they are costed at the worst observed 45 s/frame; elapsed-ms clips
 * averaged 1.9-3.2 s/frame (c25 worst), costed at 3.5 s/frame; stills cost
 * only the fixed overhead. With the x1.2 safety factor the heaviest clip,
 * c01 (288 progress frames), estimates at ~263 min — why every
 * progress-event clip gets a runner job of its own (partitionForCi).
 */
export const MEASURED_COST_MODEL: RenderCostModel = {
  clipOverheadSec: 60,
  firstFrameSec: 120,
  secPerFrame: { progress: 45, 'elapsed-ms': 3.5, still: 0 },
  finishSecPerFrame: 0.15,
  safetyFactor: 1.2,
  provenance: 'run #4 (36305258099) worst per-clock averages: progress 45 s/frame, elapsed-ms 3.5 s/frame',
}

/** The render step's own timeout (.github/workflows/final-render.yml keeps
 * it equal — asserted in capture/ciPipeline.spec.ts). GitHub's hard cap is
 * 360 min per job; the job itself is allowed RENDER_JOB_TIMEOUT_MINUTES so
 * checkout/setup before and the upload after the step always fit. */
export const RENDER_STEP_TIMEOUT_MINUTES = 335
export const RENDER_JOB_TIMEOUT_MINUTES = 355
/** renderGroup.mjs's --budget-minutes: it never starts (or lets run) an
 * attempt that could not finish, verify and encode inside this, so the
 * step timeout above is only ever a backstop. */
export const RENDER_BUDGET_MINUTES = 325
/** Largest estimated job the planner will emit (estimate already includes
 * the safety factor). */
export const JOB_CEILING_MINUTES = 300
/** A clip estimated over this gets a runner job to itself, so one slow clip
 * can never eat the budget of the clips queued behind it. */
export const SOLO_CLIP_MINUTES = 45

export function estimateClipMinutes(job: Pick<FinalRenderJob, 'frames' | 'source'>, model: RenderCostModel): number {
  const seconds =
    model.clipOverheadSec +
    model.firstFrameSec +
    Math.max(0, job.frames - 1) * model.secPerFrame[job.source.clock] +
    job.frames * model.finishSecPerFrame
  return (seconds * model.safetyFactor) / 60
}

export const ACT_NUMERALS: Readonly<Record<EditAct, string>> = {
  ARRIVAL: 'I',
  RIVAL: 'II',
  FIRST_STRIKE: 'III',
  COUNTERSTRIKE: 'IV',
  DIVIDER: 'V',
  MONUMENTS: 'VI',
  CLAIMED_MOON: 'VII',
}

export interface RenderGroup {
  /** Stable, artifact-safe id, e.g. "act3-first-strike", "act3-first-strike-c07". */
  readonly id: string
  readonly label: string
  readonly act: EditAct | null
  readonly clipIds: readonly string[]
  readonly sourceFrames: number
  readonly estimatedMinutes: number
}

function actSlug(act: EditAct): string {
  return `act${ACT_ORDER.indexOf(act) + 1}-${act.toLowerCase().replace(/_/g, '-')}`
}

function makeGroup(id: string, label: string, act: EditAct | null, jobs: readonly FinalRenderJob[], model: RenderCostModel): RenderGroup {
  return {
    id,
    label,
    act,
    clipIds: jobs.map((job) => job.jobId),
    sourceFrames: jobs.reduce((sum, job) => sum + job.frames, 0),
    estimatedMinutes: Math.ceil(jobs.reduce((sum, job) => sum + estimateClipMinutes(job, model), 0)),
  }
}

/**
 * The render matrix: every clip estimated over SOLO_CLIP_MINUTES in a runner
 * job of its own (in practice every progress-event motion clip), and the
 * remaining cheap clips — stills and the fast elapsed-ms clips — grouped per
 * act, split by whole clips only if a group would exceed the ceiling. Groups
 * come out in edit order of their first clip. A clip that alone exceeds the
 * ceiling is a hard error, never a silently oversized job.
 */
export function partitionForCi(
  jobs: readonly FinalRenderJob[],
  model: RenderCostModel = MEASURED_COST_MODEL,
  ceilingMinutes: number = JOB_CEILING_MINUTES,
  soloMinutes: number = SOLO_CLIP_MINUTES,
): RenderGroup[] {
  const groups: { readonly order: number; readonly group: RenderGroup }[] = []
  for (const act of ACT_ORDER) {
    const actJobs = jobs.filter((job) => job.act === act).sort((a, b) => a.order - b.order)
    if (actJobs.length === 0) continue
    const label = `Act ${ACT_NUMERALS[act]} — ${act}`
    const shared: FinalRenderJob[] = []
    for (const job of actJobs) {
      const minutes = estimateClipMinutes(job, model)
      if (minutes > ceilingMinutes) {
        throw new Error(`clip ${job.jobId} alone is estimated at ${minutes.toFixed(0)} min, over the ${ceilingMinutes} min job ceiling`)
      }
      if (minutes > soloMinutes) {
        groups.push({ order: job.order, group: makeGroup(`${actSlug(act)}-${job.jobId}`, `${label} — ${job.jobId} ${job.shotId}`, act, [job], model) })
      } else {
        shared.push(job)
      }
    }
    const parts: FinalRenderJob[][] = []
    let current: FinalRenderJob[] = []
    let currentMinutes = 0
    for (const job of shared) {
      const minutes = estimateClipMinutes(job, model)
      if (current.length > 0 && currentMinutes + minutes > ceilingMinutes) {
        parts.push(current)
        current = []
        currentMinutes = 0
      }
      current.push(job)
      currentMinutes += minutes
    }
    if (current.length > 0) parts.push(current)
    parts.forEach((part, index) => {
      const id = parts.length === 1 ? actSlug(act) : `${actSlug(act)}-p${index + 1}`
      const partLabel = parts.length === 1 ? `${label} (${part.map((job) => job.jobId).join(', ')})` : `${label} (part ${index + 1}/${parts.length})`
      groups.push({ order: part[0]!.order, group: makeGroup(id, partLabel, act, part, model) })
    })
  }
  return groups.sort((a, b) => a.order - b.order).map((entry) => entry.group)
}

export function smokeGroup(jobs: readonly FinalRenderJob[], clipId: string, model: RenderCostModel = MEASURED_COST_MODEL): RenderGroup {
  const job = jobs.find((candidate) => candidate.jobId === clipId)
  if (job === undefined) throw new Error(`smoke clip "${clipId}" is not one of the locked timeline's shot clips`)
  return makeGroup(`smoke-${clipId}`, `Smoke — ${clipId} ${job.shotId}`, job.act as EditAct, [job], model)
}

/** Clips a targeted `repair` run re-renders by default: every clip run #4
 * failed (timeouts: c01 c02 c03 c10 c16; frozen frames: c19; 2559px crop:
 * c24 c25). Run #4's c17/c20/c22/c23 "verified" outputs were sampled at the
 * drifting pre-fix source times too (see capture/runner.ts
 * installHeldAnimationFrames) and c11/c12 never started, so a complete reel
 * still needs a full run at one SHA. */
export const RUN4_REPAIR_CLIPS: readonly string[] = ['c01', 'c02', 'c03', 'c10', 'c16', 'c19', 'c24', 'c25']

/** A `repair` run: the listed clips, each in a runner job of its own (they
 * are the expensive/at-risk ones), in edit order. */
export function repairGroups(jobs: readonly FinalRenderJob[], clipIds: readonly string[], model: RenderCostModel = MEASURED_COST_MODEL): RenderGroup[] {
  const wanted = [...new Set(clipIds)]
  if (wanted.length === 0) throw new Error('repair mode needs at least one clip id')
  return wanted
    .map((clipId) => {
      const job = jobs.find((candidate) => candidate.jobId === clipId)
      if (job === undefined) throw new Error(`repair clip "${clipId}" is not one of the locked timeline's shot clips`)
      return job
    })
    .sort((a, b) => a.order - b.order)
    .map((job) => makeGroup(`repair-${job.jobId}`, `Repair — ${job.jobId} ${job.shotId}`, job.act as EditAct, [job], model))
}

// ---------------------------------------------------------------------------
// Per-clip attempt budget + retry policy (renderGroup.mjs)
// ---------------------------------------------------------------------------

/** Minutes renderGroup keeps back per clip for verify + encode + contact
 * sheets + metadata after its render (run #4: 5-20s per clip; generous). */
export function finishReserveMinutes(job: Pick<FinalRenderJob, 'frames'>): number {
  return 2 + (job.frames * 0.3) / 60
}

/** An attempt shorter than this is not worth starting: the page load +
 * reach + first frame alone can take a few minutes. */
export const MIN_ATTEMPT_MINUTES = 5

export interface AttemptRecord {
  readonly attempt: number
  readonly exitCode: number
  readonly timeoutMs: number
  readonly elapsedMs: number
  /** Valid, distinct frames on disk before and after the attempt. */
  readonly validBefore: number
  readonly validAfter: number
}

export type RetryDecision = { readonly retry: true; readonly reason: string } | { readonly retry: false; readonly reason: string }

/** Attempts per clip: resuming progress-event clips, or retrying a failed
 * elapsed-ms clip once from scratch (renders in one session anyway). */
export const MAX_ATTEMPTS: Readonly<Record<SourceClock, number>> = { progress: 3, 'elapsed-ms': 2, still: 2 }

/**
 * Whether renderGroup should start another attempt at a clip whose last
 * attempt failed. Never retries merely to wait out a timeout: attempts get a
 * frame-count-derived timeout (capture/finalRender/timing.ts), so a healthy
 * clip normally finishes in its first attempt; a retry is for a crash /
 * watchdog / frozen-frame failure, and a progress-event clip is only resumed
 * while attempts keep adding valid frames — two attempts in a row without
 * progress means the failure is not transient.
 */
export function decideRetry(
  job: Pick<FinalRenderJob, 'source' | 'frames'>,
  attempts: readonly AttemptRecord[],
  remainingBudgetMinutes: number,
): RetryDecision {
  const needed = MIN_ATTEMPT_MINUTES + finishReserveMinutes(job)
  const budgetLeft = remainingBudgetMinutes >= needed
  const exhausted = `job budget exhausted (${remainingBudgetMinutes.toFixed(1)} min left, ${needed.toFixed(1)} needed)`
  const last = attempts[attempts.length - 1]
  if (last === undefined) return budgetLeft ? { retry: true, reason: 'first attempt' } : { retry: false, reason: exhausted }
  if (last.exitCode === 0) return { retry: false, reason: 'last attempt succeeded' }
  const max = MAX_ATTEMPTS[job.source.clock]
  if (attempts.length >= max) return { retry: false, reason: `${attempts.length}/${max} attempt(s) used` }
  if (job.source.clock === 'progress') {
    const stalled = attempts.slice(-2).filter((attempt) => attempt.validAfter <= attempt.validBefore)
    if (attempts.length >= 2 && stalled.length === 2) {
      return { retry: false, reason: 'two consecutive attempts added no valid frame' }
    }
  }
  if (!budgetLeft) return { retry: false, reason: exhausted }
  const progressNote = last.validAfter > last.validBefore ? `made progress (${last.validBefore} -> ${last.validAfter} valid)` : 'made no progress'
  return { retry: true, reason: `attempt ${last.attempt} failed but ${progressNote}` }
}

/** The CAPTURE_FINAL_TIMEOUT_MS renderGroup gives one attempt: the derived
 * ceiling for the frames still to render, capped so the attempt plus its
 * clip's verify/encode still fit the job's remaining budget. */
export function budgetedAttemptTimeoutMs(ceilingMs: number, remainingBudgetMinutes: number, job: Pick<FinalRenderJob, 'frames'>): number {
  const budgetMs = (remainingBudgetMinutes - finishReserveMinutes(job)) * 60_000
  return Math.max(0, Math.floor(Math.min(ceilingMs, budgetMs)))
}

// ---------------------------------------------------------------------------
// Source-frame expectations
// ---------------------------------------------------------------------------

export interface FrameSize {
  readonly width: number
  readonly height: number
}

/**
 * The PNG size the engine should have written for frame `index`: the
 * interpolated crop (device pixels) for a motion clip, the start crop for a
 * still (engine.ts screenshots a still at `job.crop` only) — as the browser
 * actually rasterizes a screenshot clip of that size (plan.ts's
 * rasterizedClipSize: whole-CSS-pixel clip sizes, so a 2560px-wide crop at
 * DPR 1.5 is exactly 2559px). Endpoints and static crops are whole device
 * pixels and are checked exactly against that; in-between frames of a crop
 * push start from a fractional crop (origin included), hence
 * `sourceSizeTolerance()`.
 */
export function expectedSourceFrameSize(job: FinalRenderJob, index: number): FrameSize {
  const deviceScaleFactor = PROFILES[job.profile].deviceScaleFactor
  if (job.source.clock === 'still' || job.frames <= 1) return rasterizedClipSize(job.crop, deviceScaleFactor)
  const t = index / (job.frames - 1)
  return rasterizedClipSize(interpolateCrop(job.crop, job.cropEnd, t), deviceScaleFactor)
}

/** Allowed |actual - expected| per axis: exact (against the modeled
 * rasterization) at the clip's endpoints and for static crops, 2px for
 * interpolated in-between frames. */
export function sourceSizeTolerance(job: FinalRenderJob, index: number): number {
  const moving = job.crop.w !== job.cropEnd.w || job.crop.h !== job.cropEnd.h || job.crop.x !== job.cropEnd.x || job.crop.y !== job.cropEnd.y
  if (!moving || job.source.clock === 'still' || index === 0 || index === job.frames - 1) return 0
  return 2
}

export function checkSourceFrameSizes(job: FinalRenderJob, sizes: readonly FrameSize[]): string[] {
  const problems: string[] = []
  if (sizes.length !== job.frames) problems.push(`${job.jobId}: ${sizes.length} source frame(s), expected ${job.frames}`)
  sizes.forEach((size, index) => {
    const expected = expectedSourceFrameSize(job, index)
    const tolerance = sourceSizeTolerance(job, index)
    if (Math.abs(size.width - expected.width) > tolerance || Math.abs(size.height - expected.height) > tolerance) {
      problems.push(
        `${job.jobId} frame ${index}: ${size.width}x${size.height}, expected ${Math.round(expected.width)}x${Math.round(expected.height)} (±${tolerance})`,
      )
    }
  })
  return problems
}

/**
 * The full WebGL backing buffer the page must have rendered at — NOT the
 * same thing as a screenshot's pixel size (sourceFrameSize/crop space,
 * CSS viewport x deviceScaleFactor). They coincide for PLATE/HUD (their
 * capture/initCapture.ts DPR override keeps calculateDpr's megapixel cap
 * from ever binding, so the live buffer lands exactly at
 * cssWidth/cssHeight x deviceScaleFactor), but PORT deliberately runs the
 * real, uncapped production DPR formula with no override: its
 * megapixel-capped buffer (585x1266) is smaller than its 1170x2532
 * screenshot. Mirrors the same expectedCanvasBufferSize() calculation
 * capture/initCapture.ts's preparePage() already asserts live, in-browser,
 * against this profile's actual canvas buffer.
 */
export function expectedCanvasBuffer(profile: CaptureProfileId): FrameSize {
  const { width, height } = expectedCanvasBufferSize(PROFILES[profile])
  return { width, height }
}

// ---------------------------------------------------------------------------
// 1080p60 intermediate encode
// ---------------------------------------------------------------------------

/**
 * Near-transparent mezzanine for the later final edit. H.264 High 4:4:4
 * Predictive (libx264, 8-bit yuv444p): full chroma resolution so red HUD
 * text / thin UI lines are not chroma-subsampled twice (once here, once in
 * the delivered 4:2:0 reel). CRF 10 at preset "slower", measured on the real
 * c07 4K frames against a lossless 1080p reference: PSNR 58.3 dB avg (57.1
 * min), SSIM 0.99904, 1.57 MB for 2.4s (~5 Mb/s) — vs 3.06 MB at CRF 6 for
 * +1.9 dB, ProRes 422 HQ 52 MB, FFV1 37 MB. 30-frame (0.5s) closed GOPs keep
 * frame-accurate seeking cheap for the edit. BT.709 matrix, limited range,
 * tagged — the hero reel's own declared colour space.
 */
export const INTERMEDIATE = {
  codec: 'libx264',
  profile: 'high444',
  pixFmt: 'yuv444p',
  crf: 10,
  preset: 'slower',
  gop: 30,
  container: 'mp4',
} as const

const SCALE_FLAGS = 'lanczos+accurate_rnd+full_chroma_int'
const COLOR = `out_color_matrix=bt709:out_range=tv`

export type IntermediateKind = 'motion' | 'still' | 'still-push' | 'portrait-still'

export interface IntermediatePlan {
  readonly kind: IntermediateKind
  readonly outputFrames: number
  readonly filter: string
  /** ffmpeg input options + the frame input path pattern relative to frameDir. */
  readonly inputArgs: readonly string[]
}

function fmt(value: number): string {
  // Plain decimal for ffmpeg expressions (no exponent notation).
  return Number.isInteger(value) ? String(value) : value.toFixed(6)
}

/**
 * A held still whose locked edit asks for a crop push (crop -> cropEnd):
 * the engine captures the still at `crop` only, so the push is applied here,
 * following the engine's own interpolateCrop() linear path. The still is
 * first Lanczos-upsampled 2x so zoompan's whole-pixel rect positions land on
 * a 0.5-source-pixel grid (<= 1/3 output px), then zoompan resamples the
 * moving rect straight to the output size — a fixed-size stage, because
 * ffmpeg's crop filter does not track an upstream size that changes per
 * frame (caught by capture/ci/encoderSelfTest.mjs).
 */
function stillPushFilter(start: CropRect, end: CropRect, frames: number, out: FrameSize, fps: number): string {
  const upsample = 2
  const t = `(on/${fmt(Math.max(1, frames - 1))})`
  const rectW = `(${fmt(start.w)}+(${fmt(end.w - start.w)})*${t})`
  return [
    `scale=${start.w * upsample}:${start.h * upsample}:flags=${SCALE_FLAGS}:${COLOR}`,
    'format=yuv444p',
    `zoompan=z='${fmt(start.w)}/${rectW}':x='${fmt((end.x - start.x) * upsample)}*${t}':y='${fmt((end.y - start.y) * upsample)}*${t}'` +
      `:d=1:s=${out.width}x${out.height}:fps=${fps}`,
    'setsar=1',
  ].join(',')
}

export function planIntermediate(edit: FinalEdit, job: FinalRenderJob): IntermediatePlan {
  const clip = shotClipById(edit, job.jobId)
  const out = { width: edit.output.width, height: edit.output.height }
  const outputFrames = outputFrameCount(edit, clip)
  const fps = edit.output.fps
  const sequenceInput = ['-framerate', String(fps), '-start_number', '0', '-i', '%06d.png']
  const stillInput = ['-loop', '1', '-framerate', String(fps), '-i', '000000.png']

  if (clip.framing === 'pillarbox-portrait') {
    if (clip.source.clock !== 'still') throw new Error(`${clip.id}: portrait motion clips are not part of the locked cut`)
    return {
      kind: 'portrait-still',
      outputFrames,
      inputArgs: stillInput,
      filter: [
        `scale=-1:${out.height}:flags=${SCALE_FLAGS}:${COLOR}`,
        'format=yuv444p',
        `pad=${out.width}:${out.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
        'setsar=1',
      ].join(','),
    }
  }

  const toOutput = `scale=${out.width}:${out.height}:flags=${SCALE_FLAGS}:${COLOR},format=yuv444p,setsar=1`
  if (clip.source.clock === 'still') {
    const end = clip.cropEnd
    const pushes = end !== undefined && (end.x !== clip.crop.x || end.y !== clip.crop.y || end.w !== clip.crop.w || end.h !== clip.crop.h)
    if (pushes) {
      return { kind: 'still-push', outputFrames, inputArgs: stillInput, filter: stillPushFilter(clip.crop, end, outputFrames, out, fps) }
    }
    return { kind: 'still', outputFrames, inputArgs: stillInput, filter: toOutput }
  }

  if (job.frames !== outputFrames) {
    throw new Error(`${clip.id}: ${job.frames} source frames but ${outputFrames} output frames — motion is never retimed`)
  }
  // Motion: the engine already baked each frame's (interpolated) crop into
  // the PNG via Playwright's screenshot clip, so only the 1080p scale
  // remains. ffmpeg re-initialises the scaler if a moving crop's PNG size
  // changes by a rounding pixel between frames.
  return { kind: 'motion', outputFrames, inputArgs: sequenceInput, filter: toOutput }
}

/** Full ffmpeg argv (without the leading "ffmpeg"), run with cwd = frameDir. */
export function intermediateFfmpegArgs(plan: IntermediatePlan, outputPath: string, fps: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    ...plan.inputArgs,
    '-vf',
    plan.filter,
    '-frames:v',
    String(plan.outputFrames),
    '-fps_mode',
    'cfr',
    '-an',
    '-c:v',
    INTERMEDIATE.codec,
    '-profile:v',
    INTERMEDIATE.profile,
    '-pix_fmt',
    INTERMEDIATE.pixFmt,
    '-preset',
    INTERMEDIATE.preset,
    '-crf',
    String(INTERMEDIATE.crf),
    '-g',
    String(INTERMEDIATE.gop),
    '-keyint_min',
    String(INTERMEDIATE.gop),
    '-sc_threshold',
    '0',
    '-flags',
    '+cgop',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-r',
    String(fps),
    '-movflags',
    '+faststart',
    outputPath,
  ]
}

/** first / middle / last output-frame indices (deduplicated). */
export function contactFrameIndices(frames: number): number[] {
  return [...new Set([0, Math.floor((frames - 1) / 2), frames - 1])].filter((index) => index >= 0 && index < frames)
}

// ---------------------------------------------------------------------------
// Per-clip metadata + whole-reel verification
// ---------------------------------------------------------------------------

export const CLIP_METADATA_SCHEMA = 'shootthemoon.reel-clip/1'

/** The subset of clip.json the reel verifier relies on. */
export interface ClipRecord {
  readonly schema: string
  readonly status: 'verified'
  readonly gitSha: string
  readonly group: string
  readonly act: string
  readonly clipId: string
  readonly shotId: string
  readonly dest: { readonly inMs: number; readonly outMs: number; readonly durationMs: number }
  readonly source: { readonly frames: number; readonly width: number; readonly height: number }
  readonly output: {
    readonly file: string
    readonly frames: number
    readonly width: number
    readonly height: number
    readonly fps: number
    readonly durationSec: number
    readonly sha256: string
    readonly decodedAdjacentDuplicates: number
  }
}

export interface ReelVerification {
  readonly problems: readonly string[]
  readonly clipCount: number
  readonly shotFootageMs: number
  readonly timelineMs: number
  readonly gitShas: readonly string[]
}

/**
 * Cross-checks every clip.json a run produced against the locked edit.
 * `expectedClipIds` is all 25 shot clips for the full reel, or just the
 * smoke clip for Stage 1. Expected SHA is the one the plan job resolved.
 */
export function verifyReelRecords(
  edit: FinalEdit,
  records: readonly ClipRecord[],
  expectedClipIds: readonly string[],
  expectedSha: string,
): ReelVerification {
  const problems: string[] = []
  const clips = edit.timeline.filter(isShotClip)
  const clipById = new Map(clips.map((clip) => [clip.id, clip]))
  const seen = new Map<string, number>()

  for (const record of records) {
    seen.set(record.clipId, (seen.get(record.clipId) ?? 0) + 1)
    const clip = clipById.get(record.clipId)
    if (record.schema !== CLIP_METADATA_SCHEMA) problems.push(`${record.clipId}: unknown metadata schema ${record.schema}`)
    if (record.status !== 'verified') problems.push(`${record.clipId}: status ${String(record.status)}`)
    if (record.gitSha !== expectedSha) problems.push(`${record.clipId}: rendered from ${record.gitSha}, expected ${expectedSha}`)
    if (clip === undefined) {
      problems.push(`${record.clipId}: not a shot clip in the locked timeline`)
      continue
    }
    if (!expectedClipIds.includes(record.clipId)) problems.push(`${record.clipId}: not expected in this run`)
    if (record.shotId !== clip.shotId) problems.push(`${record.clipId}: shot ${record.shotId}, locked edit says ${clip.shotId}`)
    if (record.act !== clip.act) problems.push(`${record.clipId}: act ${record.act}, locked edit says ${clip.act}`)
    const durationMs = clip.destOutMs - clip.destInMs
    if (record.dest.inMs !== clip.destInMs || record.dest.outMs !== clip.destOutMs || record.dest.durationMs !== durationMs) {
      problems.push(`${record.clipId}: destination window drifted from the locked edit`)
    }
    const frames = outputFrameCount(edit, clip)
    const out = record.output
    if (out.frames !== frames) problems.push(`${record.clipId}: ${out.frames} output frames, expected ${frames}`)
    if (out.fps !== edit.output.fps) problems.push(`${record.clipId}: ${out.fps} fps, expected ${edit.output.fps}`)
    if (out.width !== edit.output.width || out.height !== edit.output.height) {
      problems.push(`${record.clipId}: ${out.width}x${out.height}, expected ${edit.output.width}x${edit.output.height}`)
    }
    if (Math.abs(out.durationSec * 1000 - durationMs) > 1000 / edit.output.fps / 2) {
      problems.push(`${record.clipId}: output duration ${out.durationSec}s != locked ${durationMs / 1000}s`)
    }
    const expectedSourceFrames = clip.source.clock === 'still' ? 1 : frames
    if (record.source.frames !== expectedSourceFrames) {
      problems.push(`${record.clipId}: ${record.source.frames} source frames, expected ${expectedSourceFrames}`)
    }
    if (clip.source.clock !== 'still' && out.decodedAdjacentDuplicates !== 0) {
      problems.push(`${record.clipId}: ${out.decodedAdjacentDuplicates} frozen frame(s) in the decoded intermediate`)
    }
    if (!/^[0-9a-f]{64}$/.test(out.sha256)) problems.push(`${record.clipId}: missing output sha256`)
  }

  for (const [clipId, count] of seen) if (count > 1) problems.push(`${clipId}: ${count} duplicate records`)
  for (const clipId of expectedClipIds) if (!seen.has(clipId)) problems.push(`${clipId}: missing`)

  const shotFootageMs = records.reduce((sum, record) => sum + record.dest.durationMs, 0)
  const timelineMs = edit.timeline[edit.timeline.length - 1]!.destOutMs
  const allExpected = clips.length === expectedClipIds.length
  if (allExpected) {
    // Full reel: shot footage + the (not rendered) end card must tile the
    // locked timeline exactly, and the timeline must still be 57.6s.
    const endCardMs = edit.timeline.filter((item) => !isShotClip(item)).reduce((sum, item) => sum + item.destOutMs - item.destInMs, 0)
    if (timelineMs !== 57_600) problems.push(`locked timeline is ${timelineMs}ms, expected 57600ms`)
    if (shotFootageMs + endCardMs !== timelineMs) {
      problems.push(`shot footage ${shotFootageMs}ms + end card ${endCardMs}ms != timeline ${timelineMs}ms`)
    }
  }

  return {
    problems,
    clipCount: records.length,
    shotFootageMs,
    timelineMs,
    gitShas: [...new Set(records.map((record) => record.gitSha))],
  }
}

// ---------------------------------------------------------------------------
// final-preflight: the cheap CI gate before another full run
// ---------------------------------------------------------------------------

export interface PreflightPart {
  /** Artifact-safe id, also capture/ci/preflight.mjs's --part. */
  readonly id: string
  readonly label: string
  /** Every locked clip the part renders (fully or as proof frames). */
  readonly clipIds: readonly string[]
  readonly estimatedMinutes: number
}

/**
 * The four parallel jobs of the `final-preflight` workflow mode — each one
 * exercises a failure class run #4 hit, on the real GitHub runner, in
 * minutes instead of hours (estimates are render-step minutes; each job
 * adds ~2 min of setup).
 */
export const PREFLIGHT_PARTS: readonly PreflightPart[] = [
  {
    id: 'c19-dense',
    label: 'c19 divider-weapon-volley at its real 108-frame density: full render, exact source times, 0 frozen frames, encode',
    clipIds: ['c19'],
    estimatedMinutes: 12,
  },
  {
    id: 'crops-port',
    label: 'crop quantization (c24, c25, c16 first/mid/last at their exact rasterized sizes) + c18 PORT still end to end',
    clipIds: ['c24', 'c25', 'c16', 'c18'],
    estimatedMinutes: 14,
  },
  {
    id: 'progress-c07',
    label: 'c07 progress-clock no-regression: 12 frames spread over the clip, exact 4K size, per-frame cost on this runner',
    clipIds: ['c07'],
    estimatedMinutes: 14,
  },
  {
    id: 'timeout-resume',
    label: 'c22 with its first attempt cut short (fault injection): the clip must still verify through the retry policy',
    clipIds: ['c22'],
    estimatedMinutes: 10,
  },
]

export const PREFLIGHT_PROGRESS_SAMPLE_FRAMES = 12
/** Fault injection for the timeout-resume part (renderGroup
 * --first-attempt-timeout-minutes): long enough to render some of c22,
 * far too short for all 108 frames. */
export const PREFLIGHT_FORCED_TIMEOUT_MINUTES = 2

export function preflightMatrix(): {
  include: { group: string; part: string; label: string; clips: string; estimated_minutes: number; kind: 'preflight' }[]
} {
  return {
    include: PREFLIGHT_PARTS.map((part) => ({
      group: `preflight-${part.id}`,
      part: part.id,
      label: `Preflight — ${part.label}`,
      clips: part.clipIds.join(','),
      estimated_minutes: part.estimatedMinutes,
      kind: 'preflight' as const,
    })),
  }
}

/** One captured frame's evidence as capture/finalRender/engine.ts records it. */
export interface FrameEvidence {
  readonly index: number
  readonly tookMs: number
  readonly requestedSource?: number
  readonly renderedSourceMs?: number
}

/**
 * elapsed-ms clips: every frame must have rendered at its requested source
 * time (whole-ms tick rounding only) in strictly increasing order — the
 * property run #4's drifting sampler violated (c19 frame 107 rendered at
 * +5952ms for a +680ms request).
 */
export function checkExactSampling(job: FinalRenderJob, frames: readonly FrameEvidence[], expectedIndices?: readonly number[]): string[] {
  if (job.source.clock !== 'elapsed-ms') return []
  const problems: string[] = []
  const indices = expectedIndices ?? Array.from({ length: job.frames }, (_, index) => index)
  const byIndex = new Map(frames.map((frame) => [frame.index, frame]))
  let previous = -Infinity
  for (const index of indices) {
    const frame = byIndex.get(index)
    const requested = frame?.requestedSource
    const rendered = frame?.renderedSourceMs
    if (frame === undefined || requested === undefined || rendered === undefined) {
      problems.push(`${job.jobId} frame ${index}: no render-time evidence`)
      continue
    }
    if (!(rendered - requested >= 0 && rendered - requested < 1)) {
      problems.push(`${job.jobId} frame ${index}: rendered at source ${rendered}ms, requested ${requested}ms`)
    }
    if (rendered <= previous) problems.push(`${job.jobId} frame ${index}: source time ${rendered}ms not after the previous frame's`)
    previous = rendered
  }
  return problems
}

/** Proof frames: the exact rasterized size at each captured index. */
export function checkProofFrameSizes(job: FinalRenderJob, sizes: ReadonlyMap<number, FrameSize>): string[] {
  const problems: string[] = []
  for (const [index, size] of sizes) {
    const expected = expectedSourceFrameSize(job, index)
    const tolerance = sourceSizeTolerance(job, index)
    if (Math.abs(size.width - expected.width) > tolerance || Math.abs(size.height - expected.height) > tolerance) {
      problems.push(`${job.jobId} proof frame ${index}: ${size.width}x${size.height}, expected ${expected.width}x${expected.height} (±${tolerance})`)
    }
  }
  return problems
}

/** The forced-timeout part: attempt 1 must have been cut off by the
 * injected cap while making progress, and the retry must have finished. */
export function checkForcedTimeoutRecovery(attempts: readonly AttemptRecord[], forcedMinutes: number): string[] {
  const problems: string[] = []
  const [first, second] = attempts
  if (attempts.length !== 2 || first === undefined || second === undefined) {
    return [`expected exactly 2 attempts (forced timeout, then recovery), got ${attempts.length}`]
  }
  if (first.exitCode === 0) problems.push('attempt 1 finished inside the injected cap — the fault was not exercised')
  if (first.timeoutMs > forcedMinutes * 60_000) problems.push(`attempt 1 ran with a ${first.timeoutMs}ms timeout, not the injected ${forcedMinutes} min`)
  if (first.validAfter <= 0) problems.push('attempt 1 rendered no frame before its cap — not a healthy clip outliving its timeout')
  if (second.exitCode !== 0) problems.push(`attempt 2 exited ${second.exitCode}`)
  if (second.timeoutMs <= first.timeoutMs) problems.push('attempt 2 did not get a longer, derived timeout')
  return problems
}

/** Full-clip minutes at a measured steady per-frame rate (+ the fixed
 * per-clip cost), for the progress-c07 part's projection of c01. */
export function projectClipMinutes(job: Pick<FinalRenderJob, 'frames'>, steadySecPerFrame: number, model: RenderCostModel = MEASURED_COST_MODEL): number {
  return (model.clipOverheadSec + model.firstFrameSec + job.frames * (steadySecPerFrame + model.finishSecPerFrame)) / 60
}
