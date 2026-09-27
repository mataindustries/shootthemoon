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
import { interpolateCrop, type FinalRenderJob } from '../finalRender/plan.ts'
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
 * Wall-clock cost model for one clip on a 4 vCPU / 16 GB runner, from a real
 * measured run (see MEASURED_COST_MODEL's provenance note). Estimates are
 * multiplied by `safetyFactor` before being compared with the ceiling.
 */
export interface RenderCostModel {
  /** Per-clip fixed cost: harness build + preview server + browser context +
   * fixture + reach, before the first frame is requested. */
  readonly clipOverheadSec: number
  /** Ceiling for a clip's first captured frame (shader compile). */
  readonly firstFrameSec: number
  /** Steady-state seconds per subsequent frame, per capture profile. */
  readonly secPerFrame: Readonly<Record<CaptureProfileId, number>>
  /** Per-clip verify + encode + contact sheet cost, per source frame. */
  readonly finishSecPerFrame: number
  readonly safetyFactor: number
  readonly provenance: string
}

/**
 * Measured on 2026-09-26 by rendering c07 (first-strike-orbital-flight, the
 * Stage-1 smoke clip: 144 frames, full 3840x2160 crop — the largest PNGs
 * any clip writes) through the unchanged capture/finalRender.mjs on a
 * 4 vCPU / 15 GiB x86_64 container, the same shape as a public-repo
 * ubuntu-latest runner:
 *   wall 522s total; ~20s fixed (harness build, server, context, reach);
 *   first frame 7.7s; steady 3.46 s/frame avg (2.1 min, 5.3 max), 0 retries;
 *   verify + encode + contact sheet 15s (~0.1 s/frame).
 * The model rounds those up (60s fixed, 3.5 s/frame, 0.15 s/frame finish),
 * budgets every clip's first frame at the engine's 120s ceiling (the worst
 * observed, capture/README.md's DIVIDER volley, was 71.5s), and costs
 * HUD/PORT at the PLATE rate even though their buffers are 4x/11x smaller.
 * The x2.25 safety factor makes the effective rate ~7.9 s/frame — the rate
 * behind capture/README.md's own "~6h for 2,749 frames" whole-reel figure —
 * covering heavier scenes than orbital flight and slower runners.
 * Recalibrate from the Stage-1 Actions run's clip.json `timing` block.
 */
export const MEASURED_COST_MODEL: RenderCostModel = {
  clipOverheadSec: 60,
  firstFrameSec: 120,
  secPerFrame: { PLATE: 3.5, HUD: 3.5, PORT: 3.5 },
  finishSecPerFrame: 0.15,
  safetyFactor: 2.25,
  provenance: 'c07 measured 3.46 s/frame on 4 vCPU/15 GiB, 2026-09-26',
}

/** Conservative per-job ceiling: GitHub's hard limit is 6h per job. */
export const JOB_CEILING_MINUTES = 270

export function estimateClipMinutes(job: Pick<FinalRenderJob, 'frames' | 'profile'>, model: RenderCostModel): number {
  const seconds =
    model.clipOverheadSec +
    model.firstFrameSec +
    Math.max(0, job.frames - 1) * model.secPerFrame[job.profile] +
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
  /** Stable, artifact-safe id, e.g. "act3-first-strike" or "act3-first-strike-p2". */
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
 * One group per act, in edit order. An act whose (safety-factored) estimate
 * exceeds the ceiling is split — greedily, in edit order, by whole clips —
 * into parts that each fit. A single clip that alone exceeds the ceiling
 * cannot be split further by this pipeline and is a hard error, never a
 * silently oversized job.
 */
export function partitionByAct(
  jobs: readonly FinalRenderJob[],
  model: RenderCostModel = MEASURED_COST_MODEL,
  ceilingMinutes: number = JOB_CEILING_MINUTES,
): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const act of ACT_ORDER) {
    const actJobs = jobs.filter((job) => job.act === act).sort((a, b) => a.order - b.order)
    if (actJobs.length === 0) continue
    const label = `Act ${ACT_NUMERALS[act]} — ${act}`
    const whole = makeGroup(actSlug(act), label, act, actJobs, model)
    if (whole.estimatedMinutes <= ceilingMinutes) {
      groups.push(whole)
      continue
    }
    const parts: FinalRenderJob[][] = []
    let current: FinalRenderJob[] = []
    let currentMinutes = 0
    for (const job of actJobs) {
      const minutes = estimateClipMinutes(job, model)
      if (minutes > ceilingMinutes) {
        throw new Error(
          `clip ${job.jobId} alone is estimated at ${minutes.toFixed(0)} min, over the ${ceilingMinutes} min job ceiling`,
        )
      }
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
      groups.push(makeGroup(`${actSlug(act)}-p${index + 1}`, `${label} (part ${index + 1}/${parts.length})`, act, part, model))
    })
  }
  return groups
}

export function smokeGroup(jobs: readonly FinalRenderJob[], clipId: string, model: RenderCostModel = MEASURED_COST_MODEL): RenderGroup {
  const job = jobs.find((candidate) => candidate.jobId === clipId)
  if (job === undefined) throw new Error(`smoke clip "${clipId}" is not one of the locked timeline's shot clips`)
  return makeGroup(`smoke-${clipId}`, `Smoke — ${clipId} ${job.shotId}`, job.act as EditAct, [job], model)
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
 * still (engine.ts screenshots a still at `job.crop` only). Endpoints are
 * exact integers; in-between frames may differ by rounding of the
 * fractional CSS clip, hence `toleranceFor()`.
 */
export function expectedSourceFrameSize(job: FinalRenderJob, index: number): FrameSize {
  if (job.source.clock === 'still' || job.frames <= 1) return { width: job.crop.w, height: job.crop.h }
  const t = index / (job.frames - 1)
  const crop = interpolateCrop(job.crop, job.cropEnd, t)
  return { width: crop.w, height: crop.h }
}

/** Allowed |actual - expected| per axis: exact at the clip's endpoints and
 * for static crops, 2px for interpolated in-between frames. */
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
