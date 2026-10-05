/**
 * The YouTube film's edit decision (youtube-film.json): types and the
 * validation every render and QA pass runs first.
 *
 * Pure: the caller parses youtube-film.json, media-sources.json,
 * finalEdit.json and youtubeTitles.cues.json. Frame numbers are 0-based film
 * frames at 60 fps unless a field says reel; ranges are inclusive.
 */
import type { FinalEdit } from '../finalEdit.ts'
import { drawnFilmFrames, resolveFilmCues, validateFilmCues, type FilmCues } from './filmScene.ts'
import { bakedTransitions, checkTimelineSources, type MediaSources, type SourceRequest } from './mediaPriority.ts'

export const FILM_SCHEMA = 'shootthemoon.youtube-film/1'
export const MAX_NEW_CAPTURES = 3
export const VO_WORDS = { min: 260, max: 360 } as const
/** Words per second a natural read can carry; above this a line is rushed. */
export const VO_MAX_RATE = 2.9
/** The cold open plays without narration for at least this long. */
export const COLD_OPEN_SILENT_S = 3

/** Everything the film's title track is drawn from (the route board reads the three game files at render time). */
export const TITLE_RENDER_INPUTS = [
  'capture/youtube/youtubeTitles.cues.json',
  'capture/youtube/filmScene.ts',
  'capture/youtube/routeDiagram.ts',
  'capture/youtube/renderYoutubeTitles.mjs',
  'capture/titles/titles.ts',
  'capture/titles/overlay.html',
  'capture/titles/fonts/Saira-VF.ttf',
  'capture/titles/fonts/IBMPlexMono-Light.ttf',
  'capture/titles/fonts/IBMPlexMono-Regular.ttf',
  'capture/titles/fonts/IBMPlexMono-Medium.ttf',
  'src/camera/strikeRoute.ts',
  'src/domain/rival.ts',
  'src/domain/lunarCoordinates.ts',
] as const

export interface ReelSource { readonly media: string; readonly from: number; readonly to: number }
export interface HoldSource { readonly media: string; readonly frame: number }
export interface AssetSource { readonly asset: string }

export interface Segment {
  readonly id: string
  readonly act: string
  readonly shot?: string
  readonly kind: 'reel' | 'hold' | 'still' | 'board' | 'black'
  readonly source?: ReelSource | HoldSource | AssetSource
  /** kind 'board': a picture board in film.boards; kind 'black': a graphics-only board in the cue sheet. */
  readonly board?: string
  readonly frames: number
  readonly from: number
  readonly to: number
  /** Plate move id in the cue sheet (a new push on a held or still picture). */
  readonly push?: string
  readonly picture: string
  readonly transitionIn: string
  readonly transitionOut: string
  readonly graphics: readonly string[]
  readonly protect?: string
  readonly nativeUi?: boolean
  readonly claim?: string
}

export interface VoLine { readonly id: string; readonly act: string; readonly from: number; readonly to: number; readonly text: string; readonly words: number }
export interface MusicMarker { readonly f: number; readonly timecode: string; readonly bar: number; readonly beat: number; readonly offFrames: number; readonly kind: string; readonly label: string; readonly note: string }
export interface Claim { readonly id: string; readonly claim: string; readonly shownIn: readonly string[]; readonly evidence: readonly string[]; readonly caveat?: string; readonly note?: string }
export interface Asset { readonly file: string; readonly kind: 'new-capture' | 'repo-recording' | 'repo-evidence'; readonly sha256: string; readonly size?: readonly [number, number]; readonly fps?: number; readonly window?: readonly [number, number]; readonly note?: string; readonly manifestShot?: string }
export interface PictureLayer { readonly asset: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly from?: number; readonly to?: number }
export interface PictureGrid { readonly media: string; readonly x: number; readonly y: number; readonly cols: number; readonly rows: number; readonly cellW: number; readonly cellH: number; readonly gap: number; readonly cells: ReadonlyArray<{ readonly shot: string; readonly frame: number }> }
export interface PictureBoard { readonly background: 'black'; readonly layers?: readonly PictureLayer[]; readonly grid?: PictureGrid }

export interface Film {
  readonly schema: string
  readonly status: string
  readonly title: string
  readonly thesis: string
  readonly output: { readonly width: number; readonly height: number; readonly fps: number; readonly frames: number; readonly durationS: number; readonly encode: string; readonly audio: string }
  readonly tempo: { readonly bpm: number; readonly framesPerBeat: number; readonly framesPerBar: number; readonly bars: number }
  readonly sourcePolicy: Readonly<Record<string, string>>
  readonly acts: ReadonlyArray<{ readonly id: string; readonly from: number; readonly to: number }>
  readonly timeline: readonly Segment[]
  readonly assets: Readonly<Record<string, Asset>>
  readonly boards: Readonly<Record<string, PictureBoard>>
  readonly titles: string
  readonly voiceover: readonly VoLine[]
  readonly music: readonly MusicMarker[]
  readonly claims: readonly Claim[]
  readonly newCaptures: { readonly limit: number; readonly used: number; readonly file: string; readonly why: Readonly<Record<string, string>> }
  readonly protected: ReadonlyArray<{ readonly from: number; readonly to: number; readonly why: string }>
  /** 1280x720 candidates: one clean reel frame plus the approved wordmark (elements in the cue sheet's schema). */
  readonly thumbnails: ReadonlyArray<{ readonly id: string; readonly reelFrame: number; readonly why: string; readonly elements: readonly unknown[] }>
}

const isReel = (s: Segment['source']): s is ReelSource => s !== undefined && 'from' in s
const isHold = (s: Segment['source']): s is HoldSource => s !== undefined && 'frame' in s
const isAsset = (s: Segment['source']): s is AssetSource => s !== undefined && 'asset' in s

/** Words as a narrator reads them (dashes are pauses, not words). */
export function countWords(text: string): number {
  return text.replace(/—/g, ' ').split(/\s+/).filter(Boolean).length
}

/** Every span of media the picture reads, as mediaPriority.ts requests. */
export function sourceRequests(film: Film): SourceRequest[] {
  const requests: SourceRequest[] = []
  for (const seg of film.timeline) {
    if (isReel(seg.source)) requests.push({ media: seg.source.media, from: seg.source.from, to: seg.source.to })
    else if (isHold(seg.source)) requests.push({ media: seg.source.media, from: seg.source.frame, to: seg.source.frame })
  }
  for (const board of Object.values(film.boards)) {
    for (const cell of board.grid?.cells ?? []) requests.push({ media: board.grid!.media, from: cell.frame, to: cell.frame })
  }
  for (const thumb of film.thumbnails) requests.push({ media: 'reel-clean', from: thumb.reelFrame, to: thumb.reelFrame })
  return requests
}

/** Film frame -> segment. */
export function segmentAt(film: Film, f: number): Segment | undefined {
  return film.timeline.find((s) => f >= s.from && f <= s.to)
}

/** Every problem with the edit decision; empty means it is safe to render. */
export function validateFilm(film: Film, sources: MediaSources, edit: FinalEdit, cues: FilmCues): string[] {
  const problems: string[] = []
  const { timeline } = film
  if (film.schema !== FILM_SCHEMA) problems.push(`schema is ${film.schema}, expected ${FILM_SCHEMA}`)
  const { width, height, fps, frames } = film.output
  if (width !== 1920 || height !== 1080 || fps !== 60) problems.push('the film is 1920x1080 at 60 fps')
  if (Math.abs(film.output.durationS - frames / fps) > 1e-9) problems.push('output.durationS disagrees with frames/fps')

  // Timeline: contiguous, sized, and every segment's source shaped for its kind.
  let cursor = 0
  const ids = new Set<string>()
  timeline.forEach((seg, i) => {
    if (ids.has(seg.id)) problems.push(`${seg.id}: duplicate segment id`)
    ids.add(seg.id)
    if (seg.from !== cursor) problems.push(`${seg.id}: starts at ${seg.from}, expected ${cursor}`)
    if (seg.frames <= 0 || seg.to !== seg.from + seg.frames - 1) problems.push(`${seg.id}: [${seg.from}, ${seg.to}] is not ${seg.frames} frames`)
    cursor = seg.to + 1
    switch (seg.kind) {
      case 'reel':
        if (!isReel(seg.source)) problems.push(`${seg.id}: a reel segment needs {media, from, to}`)
        else if (seg.source.to - seg.source.from + 1 !== seg.frames) problems.push(`${seg.id}: reel ${seg.source.from}-${seg.source.to} is not ${seg.frames} frames (no retiming)`)
        break
      case 'hold':
        if (!isHold(seg.source)) problems.push(`${seg.id}: a hold needs {media, frame}`)
        break
      case 'still':
        if (!isAsset(seg.source) || film.assets[seg.source.asset] === undefined) problems.push(`${seg.id}: a still needs a registered asset`)
        break
      case 'board':
        if (seg.board === undefined || film.boards[seg.board] === undefined) problems.push(`${seg.id}: unknown picture board ${seg.board}`)
        break
      case 'black':
        break
    }
    if (i === 0 && seg.from !== 0) problems.push('the film starts at frame 0')
  })
  if (cursor !== frames) problems.push(`timeline is ${cursor} frames, output declares ${frames}`)

  // Acts: contiguous blocks of the timeline, in order.
  let actCursor = 0
  for (const act of film.acts) {
    const segs = timeline.filter((s) => s.act === act.id)
    if (segs.length === 0 || segs[0]!.from !== act.from || segs[segs.length - 1]!.to !== act.to || act.from !== actCursor) problems.push(`act ${act.id}: [${act.from}, ${act.to}] does not match its segments`)
    actCursor = act.to + 1
  }

  // Sources: clean media only (the media-priority rule).
  problems.push(...checkTimelineSources(sources, sourceRequests(film)).map((p) => `source ${p}`))

  // Baked reel transitions survive only where the cut keeps the same neighbours.
  const runs = bakedTransitions(edit)
  timeline.forEach((seg, i) => {
    if (seg.kind !== 'reel' || !isReel(seg.source)) return
    const src = seg.source
    for (const run of runs) {
      if (run.to < src.from || run.from > src.to) continue
      if (run.from < src.from) {
        const prev = timeline[i - 1]
        const ok = i === 0 ? run.color === 'black' : prev?.kind === 'reel' && isReel(prev.source) && prev.source.to === src.from - 1
        if (!ok) problems.push(`${seg.id}: starts inside the baked ${run.color} transition ${run.from}-${run.to} without its reel neighbour`)
      }
      if (run.to > src.to) {
        const next = timeline[i + 1]
        const ok = (next?.kind === 'reel' && isReel(next.source) && next.source.from === src.to + 1) || (run.color === 'black' && next?.kind === 'black')
        if (!ok) problems.push(`${seg.id}: ends inside the baked ${run.color} transition ${run.from}-${run.to} without its reel neighbour`)
      }
    }
  })

  // Voiceover: inside the film, in order, not overlapping, natural pace, off the impacts, total in range.
  let words = 0
  let lastTo = -1
  const impacts = timeline.filter((s) => s.protect?.includes('impact'))
  for (const line of film.voiceover) {
    words += line.words
    if (line.words !== countWords(line.text)) problems.push(`${line.id}: words is ${line.words}, the text has ${countWords(line.text)}`)
    if (line.from < 0 || line.to >= frames || line.from >= line.to) problems.push(`${line.id}: [${line.from}, ${line.to}] is outside the film`)
    if (line.from <= lastTo) problems.push(`${line.id}: overlaps the previous line`)
    lastTo = line.to
    const rate = line.words / ((line.to - line.from + 1) / fps)
    if (rate > VO_MAX_RATE) problems.push(`${line.id}: ${rate.toFixed(2)} words/s is rushed (max ${VO_MAX_RATE})`)
    for (const s of impacts) if (line.from <= s.to && line.to >= s.from) problems.push(`${line.id}: narration over ${s.id} (${s.protect})`)
  }
  if (film.voiceover.length > 0 && film.voiceover[0]!.from < COLD_OPEN_SILENT_S * fps) problems.push(`the first ${COLD_OPEN_SILENT_S} s carry no narration (the cold open works without context)`)
  if (words < VO_WORDS.min || words > VO_WORDS.max) problems.push(`voiceover is ${words} words (aim ${VO_WORDS.min}-${VO_WORDS.max})`)

  // Music markers in order and inside the film; impact markers land on a flash cut.
  let lastMarker = -1
  for (const m of film.music) {
    if (m.f < lastMarker || m.f < 0 || m.f >= frames) problems.push(`music ${m.label}: frame ${m.f} out of order or outside the film`)
    lastMarker = m.f
  }

  // Claims are shown where they are made.
  for (const claim of film.claims) {
    if (claim.evidence.length === 0) problems.push(`claim ${claim.id}: no evidence`)
    for (const id of claim.shownIn) {
      const seg = timeline.find((s) => s.id === id)
      if (seg === undefined) problems.push(`claim ${claim.id}: unknown segment ${id}`)
    }
  }
  for (const seg of timeline) if (seg.claim !== undefined && !film.claims.some((c) => c.id === seg.claim && c.shownIn.includes(seg.id))) problems.push(`${seg.id}: claim ${seg.claim} is not registered for it`)

  // New captures: at most three, each a registered asset.
  const captured = Object.values(film.assets).filter((a) => a.kind === 'new-capture').length
  if (captured !== film.newCaptures.used || captured > Math.min(film.newCaptures.limit, MAX_NEW_CAPTURES)) problems.push(`${captured} new captures (limit ${MAX_NEW_CAPTURES})`)

  // Picture boards: layers inside the frame and inside their segment.
  for (const seg of timeline.filter((s) => s.kind === 'board')) {
    const board = film.boards[seg.board!]
    for (const layer of board?.layers ?? []) {
      if (film.assets[layer.asset] === undefined) problems.push(`board ${seg.board}: unknown asset ${layer.asset}`)
      if (layer.x < 0 || layer.y < 0 || layer.x + layer.w > width || layer.y + layer.h > height) problems.push(`board ${seg.board}: ${layer.asset} leaves the frame`)
      if ((layer.from ?? 0) < 0 || (layer.to ?? seg.frames - 1) >= seg.frames) problems.push(`board ${seg.board}: ${layer.asset} runs outside ${seg.id}`)
    }
  }

  // Graphics: the cue sheet matches the film, stays off protected frames, and every declared graphic exists.
  if (cues.source.frames !== frames || cues.source.fps !== fps) problems.push('cue sheet length/fps differs from the film')
  if (JSON.stringify(cues.forbidden) !== JSON.stringify(film.protected)) problems.push('cue sheet forbidden ranges differ from film.protected')
  const resolved = resolveFilmCues(cues)
  problems.push(...validateFilmCues(resolved, timeline).map((p) => `titles ${p}`))
  const graphicIds = new Set([...cues.events.map((e) => e.id), ...cues.boards.map((b) => b.id)])
  for (const seg of timeline) for (const g of seg.graphics) if (!graphicIds.has(g)) problems.push(`${seg.id}: unknown graphic ${g}`)
  for (const s of impacts) {
    const covered = film.protected.some((r) => r.from <= s.from && r.to >= s.to)
    if (!covered) problems.push(`${s.id}: impact segment is not fully protected`)
  }
  const drawn = new Set(drawnFilmFrames(resolved))
  for (const r of film.protected) for (let f = r.from; f <= r.to; f++) if (drawn.has(f)) problems.push(`frame ${f}: graphics on a protected frame (${r.why})`)

  // Pushes: one plate move per pushed segment, spanning it exactly.
  for (const seg of timeline) {
    if (seg.push === undefined) continue
    const move = cues.plateMoves.find((m) => m.id === seg.push)
    if (move === undefined || move.from !== seg.from || move.to !== seg.to) problems.push(`${seg.id}: push ${seg.push} does not span the segment`)
    if (seg.kind === 'reel') problems.push(`${seg.id}: pushes are for held or still pictures, not live footage`)
  }
  for (const move of cues.plateMoves) if (!timeline.some((s) => s.push === move.id)) problems.push(`plate move ${move.id} belongs to no segment`)
  return problems
}
