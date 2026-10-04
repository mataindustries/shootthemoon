/**
 * Media priority for the YouTube film (docs/YOUTUBE_MEDIA_PRIORITY.md).
 *
 * The clean deliverables are the footage. The titled ORBITAL RECORD
 * deliverables are creative reference: they show the approved motion
 * language and are never cut into the YouTube timeline. A shot picked from a
 * titled deliverable resolves to the clean frames that carry the same
 * picture, so new graphics can never land on top of baked ORBITAL RECORD
 * graphics or plate pushes.
 *
 * Pure: the caller parses media-sources.json, finalEdit.json and the cue
 * sheets. Frame numbers are 0-based and every range is inclusive.
 */
import { applyFrameOverrides, expandIntervalOverrides, expectedFrames, planLoop, planReel, RELEASE_INTERVAL_OVERRIDES, type ExpectedFrame } from '../ci/assembly.ts'
import type { FinalEdit } from '../finalEdit.ts'
import type { Cues } from '../titles/titles.ts'

export const MEDIA_SOURCES_SCHEMA = 'shootthemoon.youtube-media-sources/1'

export type MediaRole = 'primary-clean' | 'creative-reference'

export interface MediaSource {
  readonly id: string
  readonly role: MediaRole
  /** Canonical deliverable name. Identify a file by sha256, never by name. */
  readonly file: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: number
  /** creative-reference only: the clean deliverable with the same picture. */
  readonly cleanCounterpart?: string
  /** creative-reference only: the cue sheet the titled file was built from. */
  readonly cues?: string
  /** loop-clean only: every frame is a frame of this deliverable. */
  readonly derivedFrom?: string
  readonly note: string
}

export interface FootageEntry {
  readonly clip: string
  readonly reelFrames: readonly [number, number]
  /** live footage, one frame held, a still capture, a cover duplicating its neighbour, or the end card. */
  readonly picture: 'live' | 'held' | 'still' | 'duplicate' | 'card'
  readonly grade: 'hero' | 'strong' | 'usable' | 'limited' | 'none'
  /** Screen-space game UI is part of the picture and must stay unobstructed. */
  readonly nativeUi: boolean
  readonly note: string
}

export interface MediaSources {
  readonly schema: string
  readonly note: string
  readonly policy: readonly string[]
  readonly media: readonly MediaSource[]
  readonly footage: readonly FootageEntry[]
}

export interface FrameRange {
  readonly from: number
  readonly to: number
}

/** What a titled deliverable changes relative to its clean counterpart. */
export interface Alteration extends FrameRange {
  readonly id: string
  readonly kind: 'graphics' | 'plate-push' | 'plate-replaced'
}

/** A span of frames a YouTube timeline entry takes from one deliverable. */
export interface SourceRequest extends FrameRange {
  readonly media: string
}

export interface ResolvedRange extends FrameRange {
  readonly clip: string
}

export interface ResolvedSource {
  /** Always a primary-clean deliverable. */
  readonly media: string
  readonly ranges: readonly ResolvedRange[]
  /** The titled alterations the clean frames leave behind. Reapply only what the new film needs. */
  readonly replaces: readonly Alteration[]
}

export function mediaById(sources: MediaSources, id: string): MediaSource {
  const media = sources.media.find((entry) => entry.id === id)
  if (media === undefined) throw new Error(`unknown media ${id}`)
  return media
}

/** The deliverable a file is, by its sha256. Both loops share a file name. */
export function identifyMedia(sources: MediaSources, sha256: string): MediaSource | null {
  return sources.media.find((entry) => entry.sha256 === sha256.toLowerCase()) ?? null
}

/** The clean reel as released, frame by frame: the locked plan with the
 * release interval overrides applied (the c03/c04 holds replace their own
 * fade frames, and c14/c18 show their covers). */
export function releasedReelFrames(edit: FinalEdit): ExpectedFrame[] {
  return applyFrameOverrides(expectedFrames(planReel(edit)), expandIntervalOverrides(RELEASE_INTERVAL_OVERRIDES))
}

/** Clean-loop frame -> the clean-reel frame showing the same source frame and fade. */
export function loopToReelFrames(edit: FinalEdit): number[] {
  const reel = releasedReelFrames(edit)
  const index = new Map<string, number>()
  reel.forEach((frame, reelFrame) => {
    const key = `${frame.segment}#${frame.frame}`
    if (!index.has(key)) index.set(key, reelFrame)
  })
  const loop = planLoop(edit)
  return expectedFrames(loop.sequence, loop.step).map((frame, loopFrame) => {
    const reelFrame = index.get(`${frame.segment}#${frame.frame}`)
    const shown = reelFrame === undefined ? undefined : reel[reelFrame]
    if (reelFrame === undefined || shown?.fade?.color !== frame.fade?.color || shown?.fade?.amount !== frame.fade?.amount) {
      throw new Error(`loop frame ${loopFrame} (${frame.segment}#${frame.frame}) is not shown the same way in the clean reel`)
    }
    return reelFrame
  })
}

/** Clean-reel frames with a baked flash, dip or fade. Keep them only where the
 * YouTube cut keeps the same two shots adjacent. */
export function bakedTransitions(edit: FinalEdit): (FrameRange & { readonly color: string })[] {
  const runs: { from: number; to: number; color: string }[] = []
  releasedReelFrames(edit).forEach((frame, reelFrame) => {
    if (frame.fade === null) return
    const last = runs[runs.length - 1]
    if (last !== undefined && last.to === reelFrame - 1 && last.color === frame.fade.color) last.to = reelFrame
    else runs.push({ from: reelFrame, to: reelFrame, color: frame.fade.color })
  })
  return runs
}

/** Every span a titled deliverable alters, from the cue sheet that built it. */
export function titledAlterations(cues: Cues): Alteration[] {
  const graphics = cues.events.map((ev): Alteration => ({ id: ev.id, kind: 'graphics', from: ev.from, to: ev.to }))
  const pushes = cues.plateMoves.map((move): Alteration => ({ id: move.id, kind: 'plate-push', from: move.from, to: move.to }))
  const plates = cues.events.filter((ev) => 'plate' in ev).map((ev): Alteration => ({ id: ev.id, kind: 'plate-replaced', from: ev.from, to: ev.to }))
  return [...graphics, ...pushes, ...plates].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))
}

function checkRange(media: MediaSource, range: FrameRange): string | null {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to >= media.frames || range.from > range.to) {
    return `${media.id}: [${range.from}, ${range.to}] is outside its ${media.frames} frames`
  }
  return null
}

/** Reel frame -> its timeline slot (c14 and c18 stay their own slots under their covers). */
function reelSlots(edit: FinalEdit): string[] {
  return planReel(edit).segments.flatMap((segment) => Array.from({ length: segment.frames }, () => segment.id))
}

/** Clean-reel ranges for clean-reel frames, split where the slot changes. */
function reelRanges(slots: readonly string[], frames: readonly number[]): ResolvedRange[] {
  const ranges: { from: number; to: number; clip: string }[] = []
  for (const reelFrame of frames) {
    const clip = slots[reelFrame]!
    const last = ranges[ranges.length - 1]
    if (last !== undefined && last.clip === clip && last.to === reelFrame - 1) last.to = reelFrame
    else ranges.push({ from: reelFrame, to: reelFrame, clip })
  }
  return ranges
}

/**
 * The clean frames for a span of any deliverable. Titled frames map to the
 * same frames of their clean counterpart. Clean-loop frames map to the
 * clean reel: a loop frame is one reel frame shown for two reel frames, so
 * each resolves to that frame and the next one of the same clip, and the
 * result splits at every cut.
 */
export function resolveCleanSource(sources: MediaSources, edit: FinalEdit, cuesFor: (path: string) => Cues, request: SourceRequest): ResolvedSource {
  const media = mediaById(sources, request.media)
  const problem = checkRange(media, request)
  if (problem !== null) throw new Error(problem)
  let replaces: Alteration[] = []
  let clean = media
  if (media.role === 'creative-reference') {
    if (media.cleanCounterpart === undefined || media.cues === undefined) throw new Error(`${media.id}: a titled deliverable needs cleanCounterpart and cues`)
    replaces = titledAlterations(cuesFor(media.cues)).filter((alt) => alt.from <= request.to && alt.to >= request.from)
    clean = mediaById(sources, media.cleanCounterpart)
  }
  const slots = reelSlots(edit)
  const span = Array.from({ length: request.to - request.from + 1 }, (_, i) => request.from + i)
  if (clean.derivedFrom === undefined) return { media: clean.id, ranges: reelRanges(slots, span), replaces }
  const toReel = loopToReelFrames(edit)
  const reelFrames = span.flatMap((loopFrame) => {
    const reelFrame = toReel[loopFrame]!
    return slots[reelFrame + 1] === slots[reelFrame] ? [reelFrame, reelFrame + 1] : [reelFrame]
  })
  return { media: clean.derivedFrom, ranges: reelRanges(slots, reelFrames), replaces }
}

/** Problems with a YouTube timeline's sources. Empty means every entry cuts clean footage. */
export function checkTimelineSources(sources: MediaSources, entries: readonly SourceRequest[]): string[] {
  const problems: string[] = []
  entries.forEach((entry, i) => {
    const media = sources.media.find((m) => m.id === entry.media)
    if (media === undefined) {
      problems.push(`entry ${i}: unknown media ${entry.media}`)
      return
    }
    const range = checkRange(media, entry)
    if (range !== null) problems.push(`entry ${i}: ${range}`)
    if (media.role !== 'primary-clean') {
      problems.push(`entry ${i}: ${media.id} is creative reference (titled ORBITAL RECORD). Source ${media.cleanCounterpart ?? 'the clean counterpart'} frames instead (resolveCleanSource)`)
    }
  })
  return problems
}
