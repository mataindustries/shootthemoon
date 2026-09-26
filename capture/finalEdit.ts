/**
 * Types, validation and render-plan derivation for capture/finalEdit.json —
 * the locked cut. The JSON is plain data for any later ffmpeg/editor step; it
 * only references shot ids from capture/manifest.ts and never duplicates
 * capture logic. This module imports nothing from src/ or manifest.ts
 * (callers pass a minimal shot index), so it validates anywhere.
 *
 * Source windows use each shot's native timeline: 'progress' is the [0, 1]
 * value the existing set-presentation/set-run hooks dispatch; 'elapsed-ms'
 * is fake-clock time since a named in-game anchor; 'still' is one held frame.
 * Crops are in screenshot pixels (CSS viewport x deviceScaleFactor), which
 * for PORT is 1170x2532 even though its WebGL buffer is 585x1266.
 */
import { END_CARD_FACTS } from './endCardFacts.ts'
import { PROFILES, type CaptureProfileId } from './profiles.ts'

export type EditAct =
  | 'ARRIVAL'
  | 'RIVAL'
  | 'FIRST_STRIKE'
  | 'COUNTERSTRIKE'
  | 'DIVIDER'
  | 'MONUMENTS'
  | 'CLAIMED_MOON'

export const ACT_ORDER: readonly EditAct[] = [
  'ARRIVAL',
  'RIVAL',
  'FIRST_STRIKE',
  'COUNTERSTRIKE',
  'DIVIDER',
  'MONUMENTS',
  'CLAIMED_MOON',
]

export interface CropRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type SourceWindow =
  | { readonly clock: 'still' }
  | {
      readonly clock: 'progress'
      readonly phase: string
      readonly phaseDurationMs: number
      readonly in: number
      readonly out: number
    }
  | {
      readonly clock: 'elapsed-ms'
      readonly origin: string
      readonly inMs: number
      readonly outMs: number
    }

/** cut: hard cut. flash-white / dip-black: centered on the cut point.
 * fade-black: outgoing clip only, ending exactly at the cut. */
export type TransitionType = 'cut' | 'flash-white' | 'dip-black' | 'fade-black'

export interface Transition {
  readonly type: TransitionType
  readonly durationMs: number
}

export type OutputFraming = 'full-16x9' | 'pillarbox-portrait'

export interface ShotClip {
  readonly kind: 'shot'
  readonly id: string
  readonly act: EditAct
  readonly shotId: string
  readonly profile: CaptureProfileId
  /** Whether game HUD is visible in the delivered (post-crop) frame. */
  readonly hud: boolean
  readonly source: SourceWindow
  readonly destInMs: number
  readonly destOutMs: number
  /** Source ms per output ms (<1 is slow motion). Null for held stills. */
  readonly speed: number | null
  readonly crop: CropRect
  /** Crop at the clip's last frame; interpolated linearly from `crop`. */
  readonly cropEnd?: CropRect
  readonly framing: OutputFraming
  readonly transitionOut: Transition
  readonly audioCue: string
  readonly rationale: string
}

export interface EndCard {
  readonly kind: 'end-card'
  readonly id: string
  readonly act: EditAct
  readonly destInMs: number
  readonly destOutMs: number
  readonly title: string
  /** Must match `claim` strings in capture/endCardFacts.ts exactly. */
  readonly factClaims: readonly string[]
  readonly audioCue: string
  readonly rationale: string
}

export type TimelineItem = ShotClip | EndCard

export type CueKind =
  | 'downbeat'
  | 'impact'
  | 'drop'
  | 'riser'
  | 'sting'
  | 'reversal'
  | 'escalation'
  | 'accelerate'
  | 'resolve'

export interface AudioCue {
  readonly atMs: number
  readonly kind: CueKind
  readonly label: string
  readonly note: string
}

export interface AvoidWindow {
  readonly shotId: string
  readonly in: number
  readonly out: number
  readonly reason: string
}

export interface DeliveryFormat {
  readonly file: string
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly encode: string
  readonly audio: string
}

export interface LoopDerivative {
  readonly clipIds: readonly string[]
  readonly silent: boolean
  readonly fps: number
  readonly note: string
}

export interface StillExport {
  readonly id: string
  readonly shotId: string
  readonly source: SourceWindow
  readonly crop: CropRect
  readonly note: string
}

export interface FinalEdit {
  readonly version: number
  readonly status: string
  readonly title: string
  readonly output: { readonly width: number; readonly height: number; readonly fps: number }
  readonly tempo: { readonly bpm: number; readonly beatsPerBar: number; readonly gridMs: number }
  readonly durationLimitsMs: { readonly min: number; readonly max: number }
  readonly shotCountLimits: { readonly min: number; readonly max: number }
  readonly headFadeFromBlackMs: number
  readonly resolvingShotIds: readonly string[]
  readonly timeline: readonly TimelineItem[]
  readonly cues: readonly AudioCue[]
  readonly avoidWindows: readonly AvoidWindow[]
  readonly derivatives: {
    readonly heroReel: DeliveryFormat
    readonly webReel: DeliveryFormat
    readonly loop: LoopDerivative
    readonly poster: StillExport
    readonly stills: readonly StillExport[]
    readonly mobileScreenshots: readonly StillExport[]
  }
}

/** Minimal view of a manifest shot — enough to validate references. */
export interface ShotIndexEntry {
  readonly id: string
  readonly profile: CaptureProfileId
  readonly hudMode: 'hidden' | 'visible' | 'partial'
}

/** Pixel size of a captured screenshot for this profile. */
export function sourceFrameSize(profile: CaptureProfileId): { width: number; height: number } {
  const { cssWidth, cssHeight, deviceScaleFactor } = PROFILES[profile]
  return { width: Math.round(cssWidth * deviceScaleFactor), height: Math.round(cssHeight * deviceScaleFactor) }
}

export function sourceDurationMs(source: SourceWindow): number {
  if (source.clock === 'still') return 0
  if (source.clock === 'progress') return (source.out - source.in) * source.phaseDurationMs
  return source.outMs - source.inMs
}

export function isShotClip(item: TimelineItem): item is ShotClip {
  return item.kind === 'shot'
}

function sourceBounds(source: SourceWindow): { in: number; out: number } | null {
  if (source.clock === 'still') return null
  if (source.clock === 'progress') return { in: source.in, out: source.out }
  return { in: source.inMs, out: source.outMs }
}

function cropProblems(
  label: string,
  crop: CropRect,
  profile: CaptureProfileId,
  framing: OutputFraming,
  output: FinalEdit['output'],
): string[] {
  const problems: string[] = []
  const frame = sourceFrameSize(profile)
  if (![crop.x, crop.y, crop.w, crop.h].every(Number.isInteger)) problems.push(`${label}: crop must be integer pixels`)
  if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0) problems.push(`${label}: crop has a negative origin or empty size`)
  if (crop.x + crop.w > frame.width || crop.y + crop.h > frame.height) {
    problems.push(`${label}: crop exceeds the ${profile} frame ${frame.width}x${frame.height}`)
  }
  if (framing === 'full-16x9') {
    // 16:9 within one source pixel of rounding.
    if (Math.abs(crop.w * output.height - crop.h * output.width) > output.width) {
      problems.push(`${label}: crop ${crop.w}x${crop.h} is not 16:9`)
    }
    if (crop.w < output.width) problems.push(`${label}: crop ${crop.w}px wide would upscale past the ${output.width}px output`)
  } else if (crop.x !== 0 || crop.y !== 0 || crop.w !== frame.width || crop.h !== frame.height) {
    problems.push(`${label}: portrait frames are shown whole (${frame.width}x${frame.height}), never cropped`)
  }
  return problems
}

/** Returns every problem found; an empty array means the edit is valid. */
export function validateFinalEdit(edit: FinalEdit, shots: readonly ShotIndexEntry[]): string[] {
  const problems: string[] = []
  const shotById = new Map(shots.map((shot) => [shot.id, shot]))
  const { timeline, tempo, output } = edit
  if (timeline.length === 0) return ['timeline is empty']

  const beatMs = 60_000 / tempo.bpm
  if (!Number.isInteger(beatMs) || beatMs % tempo.gridMs !== 0) {
    problems.push(`grid ${tempo.gridMs}ms does not divide the ${beatMs}ms beat`)
  }
  for (const fps of [output.fps, edit.derivatives.webReel.fps, edit.derivatives.loop.fps]) {
    if (!Number.isInteger((tempo.gridMs * fps) / 1000)) problems.push(`grid ${tempo.gridMs}ms is not a whole number of ${fps}fps frames`)
  }

  // Continuity: starts at 0, no gaps, no overlaps, every edge on the grid.
  const ids = new Set<string>()
  let cursor = 0
  for (const item of timeline) {
    if (ids.has(item.id)) problems.push(`duplicate timeline id ${item.id}`)
    ids.add(item.id)
    if (item.destInMs > cursor) problems.push(`gap before ${item.id}: ${cursor}ms -> ${item.destInMs}ms`)
    if (item.destInMs < cursor) problems.push(`overlap at ${item.id}: starts ${item.destInMs}ms, previous ends ${cursor}ms`)
    if (item.destOutMs <= item.destInMs) problems.push(`${item.id}: non-positive duration`)
    for (const edge of [item.destInMs, item.destOutMs]) {
      if (edge % tempo.gridMs !== 0) problems.push(`${item.id}: edge ${edge}ms is off the ${tempo.gridMs}ms grid`)
    }
    cursor = item.destOutMs
  }
  const totalMs = cursor
  if (totalMs < edit.durationLimitsMs.min || totalMs > edit.durationLimitsMs.max) {
    problems.push(`total ${totalMs}ms is outside ${edit.durationLimitsMs.min}-${edit.durationLimitsMs.max}ms`)
  }

  // Story order.
  let actIndex = 0
  for (const item of timeline) {
    const index = ACT_ORDER.indexOf(item.act)
    if (index === -1) problems.push(`${item.id}: unknown act ${item.act}`)
    else if (index < actIndex) problems.push(`${item.id}: act ${item.act} after ${ACT_ORDER[actIndex]}`)
    else actIndex = index
  }
  for (const act of ACT_ORDER) {
    if (!timeline.some((item) => item.act === act)) problems.push(`act ${act} has no timeline item`)
  }

  // End card: exactly one, last, preceded by a resolving shot, verified facts only.
  const endCards = timeline.filter((item): item is EndCard => item.kind === 'end-card')
  if (endCards.length !== 1) problems.push(`expected exactly one end card, found ${endCards.length}`)
  if (timeline[timeline.length - 1]!.kind !== 'end-card') problems.push('the end card must be the final timeline item')
  const beforeLast = timeline[timeline.length - 2]
  if (beforeLast === undefined || !isShotClip(beforeLast) || !edit.resolvingShotIds.includes(beforeLast.shotId)) {
    problems.push(`the shot before the end card must be one of: ${edit.resolvingShotIds.join(', ')}`)
  }
  const verifiedClaims = new Set(END_CARD_FACTS.filter((fact) => fact.verified).map((fact) => fact.claim))
  for (const card of endCards) {
    for (const claim of card.factClaims) {
      if (!verifiedClaims.has(claim)) problems.push(`end card claim is not a verified END_CARD_FACTS claim: "${claim}"`)
    }
  }

  // Per-clip checks.
  const clips = timeline.filter(isShotClip)
  if (edit.headFadeFromBlackMs > clips[0]!.destOutMs - clips[0]!.destInMs) problems.push('head fade is longer than the first clip')
  for (const clip of clips) {
    const shot = shotById.get(clip.shotId)
    if (shot === undefined) {
      problems.push(`${clip.id}: shot ${clip.shotId} does not exist in the manifest`)
      continue
    }
    if (shot.profile !== clip.profile) problems.push(`${clip.id}: profile ${clip.profile} != manifest ${shot.profile}`)
    if (clip.hud && shot.hudMode === 'hidden') problems.push(`${clip.id}: claims HUD but ${clip.shotId} captures with HUD hidden`)
    if ((clip.framing === 'pillarbox-portrait') !== (clip.profile === 'PORT')) {
      problems.push(`${clip.id}: PORT clips (and only PORT clips) use pillarbox-portrait framing`)
    }

    const destMs = clip.destOutMs - clip.destInMs
    const bounds = sourceBounds(clip.source)
    if (clip.source.clock === 'still') {
      if (clip.speed !== null) problems.push(`${clip.id}: still clips must have speed null`)
    } else {
      if (bounds !== null && bounds.out <= bounds.in) problems.push(`${clip.id}: source out must be after in`)
      if (clip.source.clock === 'progress' && (clip.source.in < 0 || clip.source.out > 1)) {
        problems.push(`${clip.id}: progress window must lie within [0, 1]`)
      }
      const derived = sourceDurationMs(clip.source) / destMs
      if (clip.speed === null || Math.abs(clip.speed - derived) > 0.005) {
        problems.push(`${clip.id}: speed ${clip.speed} does not match source/dest ${derived.toFixed(4)}`)
      }
      if (derived < 0.1 || derived > 4) problems.push(`${clip.id}: speed ${derived.toFixed(3)} is outside 0.1-4x`)
    }

    problems.push(...cropProblems(`${clip.id} crop`, clip.crop, clip.profile, clip.framing, output))
    if (clip.cropEnd !== undefined) {
      problems.push(...cropProblems(`${clip.id} cropEnd`, clip.cropEnd, clip.profile, clip.framing, output))
    }

    if (clip.transitionOut.durationMs < 0 || clip.transitionOut.durationMs > destMs) {
      problems.push(`${clip.id}: transition is longer than the clip`)
    }
    if ((clip.transitionOut.type === 'cut') !== (clip.transitionOut.durationMs === 0)) {
      problems.push(`${clip.id}: only a hard cut has zero duration`)
    }

    if (bounds !== null) {
      for (const avoid of edit.avoidWindows) {
        if (avoid.shotId === clip.shotId && bounds.in < avoid.out && bounds.out > avoid.in) {
          problems.push(`${clip.id}: source ${bounds.in}-${bounds.out} overlaps AVOID ${avoid.in}-${avoid.out} (${avoid.reason})`)
        }
      }
    }
  }

  const uniqueShots = new Set(clips.map((clip) => clip.shotId))
  if (uniqueShots.size < edit.shotCountLimits.min || uniqueShots.size > edit.shotCountLimits.max) {
    problems.push(`${uniqueShots.size} unique shots is outside ${edit.shotCountLimits.min}-${edit.shotCountLimits.max}`)
  }

  // Audio cues: ordered, inside the reel, on the grid.
  let previousCue = 0
  for (const cue of edit.cues) {
    if (cue.atMs < previousCue) problems.push(`cue ${cue.label} at ${cue.atMs}ms is out of order`)
    if (cue.atMs < 0 || cue.atMs > totalMs) problems.push(`cue ${cue.label} at ${cue.atMs}ms is outside the reel`)
    if (cue.atMs % tempo.gridMs !== 0) problems.push(`cue ${cue.label} at ${cue.atMs}ms is off the grid`)
    previousCue = cue.atMs
  }

  // Derivatives.
  const { loop, poster, stills, mobileScreenshots } = edit.derivatives
  const clipById = new Map(clips.map((clip) => [clip.id, clip]))
  let loopMs = 0
  for (const clipId of loop.clipIds) {
    const clip = clipById.get(clipId)
    if (clip === undefined) {
      problems.push(`loop references unknown clip ${clipId}`)
      continue
    }
    loopMs += clip.destOutMs - clip.destInMs
    if (clip.hud) problems.push(`loop clip ${clipId} shows HUD — the silent loop is clean plates only`)
  }
  if (loopMs < 12_000 || loopMs > 15_000) problems.push(`loop is ${loopMs}ms, outside 12-15s`)
  if (!loop.silent) problems.push('the autoplay loop must be silent')

  for (const item of [poster, ...stills, ...mobileScreenshots]) {
    const shot = shotById.get(item.shotId)
    if (shot === undefined) {
      problems.push(`export ${item.id}: shot ${item.shotId} does not exist`)
      continue
    }
    const framing: OutputFraming = shot.profile === 'PORT' ? 'pillarbox-portrait' : 'full-16x9'
    problems.push(...cropProblems(`export ${item.id}`, item.crop, shot.profile, framing, output))
    const bounds = sourceBounds(item.source)
    if (bounds !== null && bounds.in !== bounds.out) problems.push(`export ${item.id}: a still is a single instant (in == out)`)
  }
  if (shotById.get(poster.shotId)?.profile !== 'PLATE') problems.push('the poster must come from a PLATE shot')
  if (stills.length < 4 || stills.length > 5) problems.push(`expected 4-5 stills, found ${stills.length}`)
  if (mobileScreenshots.length !== 3) problems.push(`expected 3 mobile screenshots, found ${mobileScreenshots.length}`)
  for (const screenshot of mobileScreenshots) {
    if (shotById.get(screenshot.shotId)?.profile !== 'PORT') problems.push(`mobile screenshot ${screenshot.id} is not a PORT capture`)
  }

  return problems
}

export interface RenderWindow {
  readonly clipId: string
  readonly source: SourceWindow
  /** Unique frames to capture: one per output frame for motion, 1 for a still. */
  readonly frames: number
}

export interface RenderShot {
  readonly shotId: string
  readonly profile: CaptureProfileId
  readonly windows: readonly RenderWindow[]
  readonly frames: number
}

/**
 * The exact final-render workload implied by the cut: only referenced shots,
 * only the windows the timeline uses, one captured frame per output frame
 * (slow motion is real frames, never interpolation), one frame per still,
 * plus the single-frame poster/still/mobile exports.
 */
export function deriveRenderPlan(edit: FinalEdit, shots: readonly ShotIndexEntry[]): readonly RenderShot[] {
  const profileById = new Map(shots.map((shot) => [shot.id, shot.profile]))
  const byShot = new Map<string, { profile: CaptureProfileId; windows: RenderWindow[] }>()
  const add = (shotId: string, window: RenderWindow) => {
    const profile = profileById.get(shotId)
    if (profile === undefined) throw new Error(`render plan references unknown shot ${shotId}`)
    const entry = byShot.get(shotId) ?? { profile, windows: [] }
    entry.windows.push(window)
    byShot.set(shotId, entry)
  }
  const clips = edit.timeline.filter(isShotClip)
  for (const clip of clips) {
    const destMs = clip.destOutMs - clip.destInMs
    const frames = clip.source.clock === 'still' ? 1 : Math.round((destMs / 1000) * edit.output.fps)
    add(clip.shotId, { clipId: clip.id, source: clip.source, frames })
  }
  const heldInCut = new Set(clips.filter((clip) => clip.source.clock === 'still').map((clip) => clip.shotId))
  const { poster, stills, mobileScreenshots } = edit.derivatives
  for (const item of [poster, ...stills, ...mobileScreenshots]) {
    // A still export of a shot the cut already holds as a still reuses that frame.
    if (item.source.clock === 'still' && heldInCut.has(item.shotId)) continue
    add(item.shotId, { clipId: item.id, source: item.source, frames: 1 })
  }
  return [...byShot.entries()].map(([shotId, { profile, windows }]) => ({
    shotId,
    profile,
    windows,
    frames: windows.reduce((total, window) => total + window.frames, 0),
  }))
}
