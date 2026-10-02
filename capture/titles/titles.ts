/**
 * ORBITAL RECORD reel titles — pure, deterministic state.
 *
 * Every visible property of the titles layer is a function of the reel frame
 * number and `reel-titles.cues.json` (the timing authority): no clocks, no
 * randomness, no browser. The overlay page only draws the primitives
 * `sceneAt()` returns, `validateCues()` proves the cue sheet against the
 * reel's protected frames, and the ffmpeg chains for the plate pushes and the
 * composite are built here so the release assembly and the local finishing
 * pass apply exactly the same transform.
 *
 * Semantics follow the cue sheet's own `conventions` block and the reference
 * prototype (digital-ziggurat docs/shoot-the-moon-reel/prototype/titles.html)
 * that rendered the approved style frames.
 */

export const CUES_SCHEMA = 'shootthemoon.reel-titles/1'

/** Checked-in inputs of the titles renderer, relative to the repo root. */
export const TITLES_INPUT_FILES = [
  'capture/titles/reel-titles.cues.json',
  'capture/titles/titles.ts',
  'capture/titles/overlay.html',
  'capture/titles/renderTitles.mjs',
  'capture/titles/fonts/Saira-VF.ttf',
  'capture/titles/fonts/IBMPlexMono-Light.ttf',
  'capture/titles/fonts/IBMPlexMono-Regular.ttf',
  'capture/titles/fonts/IBMPlexMono-Medium.ttf',
  'capture/titles/fonts/OFL-Saira.txt',
  'capture/titles/fonts/OFL-IBMPlexMono.txt',
] as const

export interface TitlesReleasePin {
  readonly schema: string
  readonly inputs: Readonly<Record<string, string>>
  readonly playwright: string
  readonly chromium: string
}

export interface TitlesManifest {
  readonly schema: string
  readonly cues: { readonly sha256: string }
  readonly inputs: Readonly<Record<string, string>>
  readonly fonts: Readonly<Record<string, string>>
  readonly browser: string
  readonly playwright: string
  readonly alpha: 'straight'
  readonly track: { readonly sha256: string; readonly codec: string; readonly pixFmt: string; readonly fps: number; readonly frames: number }
}

/** Fail closed on a stale pin, substituted font, or track from another render. */
export function checkTitlesProvenance(pin: TitlesReleasePin, actual: Readonly<Record<string, string>>, manifest?: TitlesManifest, trackHash?: string): string[] {
  const problems: string[] = []
  if (pin.schema !== 'shootthemoon.titles-release/1') problems.push('unknown titles release pin schema')
  for (const file of TITLES_INPUT_FILES) {
    if (!/^[a-f0-9]{64}$/.test(pin.inputs?.[file] ?? '') || pin.inputs[file] !== actual[file]) problems.push(`titles input differs from release pin: ${file}`)
    if (manifest && manifest.inputs?.[file] !== actual[file]) problems.push(`titles manifest input differs: ${file}`)
    if (manifest && file.endsWith('.ttf') && manifest.fonts?.[file.split('/').pop()!] !== actual[file]) problems.push(`titles manifest font differs: ${file}`)
  }
  if (manifest) {
    if (manifest.schema !== 'shootthemoon.reel-titles-track/1' || manifest.alpha !== 'straight') problems.push('titles manifest must declare a straight-alpha titles track')
    if (manifest.cues?.sha256 !== actual['capture/titles/reel-titles.cues.json']) problems.push('titles manifest cue hash differs')
    if (manifest.browser !== `chromium ${pin.chromium}` || manifest.playwright !== pin.playwright) problems.push('titles renderer/browser differs from release pin')
    if (manifest.track?.sha256 !== trackHash || !/^[a-f0-9]{64}$/.test(trackHash ?? '')) problems.push('titles track hash differs from its manifest')
    if (manifest.track?.codec !== 'qtrle' || manifest.track?.pixFmt !== 'argb' || manifest.track?.fps !== 60 || manifest.track?.frames !== 3456) problems.push('titles manifest track format differs from the locked reel')
  }
  return problems
}

/** Actual decoded alpha maxima: every protected or undeclared frame is empty. */
export function checkTitlesAlpha(cues: Cues, maxima: readonly number[]): string[] {
  const problems: string[] = []
  if (maxima.length !== cues.source.frames) return [`titles alpha decoded ${maxima.length} frames, expected ${cues.source.frames}`]
  for (let f = 0; f < maxima.length; f++) {
    const ops = sceneAt(cues, f)
    const protectedFrame = cues.forbidden.some((range) => f >= range.from && f <= range.to)
    if (!Number.isFinite(maxima[f]) || maxima[f]! < 0 || maxima[f]! > 255) problems.push(`frame ${f}: invalid title alpha`)
    if ((protectedFrame || ops.length === 0) && maxima[f] !== 0) problems.push(`frame ${f}: title alpha on a protected or undeclared frame`)
    const visible = ops.some((op) => ('fillOpacity' in op ? op.fillOpacity : 'strokeOpacity' in op ? op.strokeOpacity : 1) >= 0.01)
    if (visible && maxima[f] === 0) problems.push(`frame ${f}: declared title is missing`)
  }
  return problems
}

export interface Spec {
  readonly f: number
  readonly fade?: number
  readonly n?: number
  readonly from?: number
  readonly to?: number
  readonly ease?: EaseName
  readonly scaleFrom?: number
  readonly origin?: string
}

export interface Counter {
  readonly token: string
  readonly f0: number
  readonly f1: number
  readonly v0: number
  readonly v1: number
}

export interface CueElement {
  readonly role: string
  readonly style?: string
  readonly x?: number
  readonly y?: number
  readonly w?: number
  readonly anchor?: 'start' | 'middle'
  readonly text?: string | ReadonlyArray<readonly [number, string]>
  readonly counter?: Counter
  readonly in?: Spec
  readonly out?: Spec
  readonly track?: Spec | readonly Spec[]
  readonly draw?: Spec
  readonly draws?: readonly Spec[]
  readonly hideGlyph?: number
  // brackets
  readonly box?: readonly [number, number, number, number]
  readonly arm?: number
  readonly stroke?: number
  readonly fill?: string
  readonly opacity?: number
  readonly followsPlate?: string
  // segment rule
  readonly segments?: number
  readonly gap?: number
  readonly unlitOpacity?: number
  // hairline
  readonly side?: 'left' | 'right'
  readonly length?: number
  readonly gapFromText?: number
  // crescent
  readonly inGlyphOf?: string
  readonly glyph?: number
  readonly diameterOfCap?: number
  readonly opticalShift?: number
  readonly occluder?: Spec
  readonly rimGlow?: { readonly opacity: number }
}

export interface CueEvent {
  readonly id: string
  readonly name: string
  readonly chapter?: string
  readonly cue?: string
  readonly from: number
  readonly to: number
  readonly elements: readonly CueElement[]
}

export interface TextStyle {
  readonly family: string
  readonly wdth?: number
  readonly wght: number
  readonly size: number
  readonly tracking: number
  readonly fill: string
  readonly opacity: number
  readonly shadow?: string
}

export interface PlateMove {
  readonly id: string
  readonly clip: string
  readonly from: number
  readonly to: number
  readonly scale: readonly [number, number]
  readonly anchor: readonly [number, number]
  readonly ease: 'linear'
}

export interface Cues {
  readonly schema: string
  readonly source: { readonly width: number; readonly height: number; readonly fps: number; readonly frames: number }
  readonly tempo: { readonly framesPerGrid: number; readonly framesPerUnit: number }
  readonly chapters: readonly string[]
  readonly tokens: {
    readonly color: Readonly<Record<string, string>>
    readonly style: Readonly<Record<string, TextStyle>>
    readonly rule: { readonly thickness: number; readonly fill: string; readonly opacity: number }
    readonly chip: { readonly size: number }
  }
  readonly forbidden: ReadonlyArray<{ readonly from: number; readonly to: number; readonly why: string }>
  readonly plateMoves: readonly PlateMove[]
  readonly events: readonly CueEvent[]
}

// ---------------------------------------------------------------------------
// Easing (CSS cubic-bezier, solved numerically, deterministic)
// ---------------------------------------------------------------------------

type EaseName = 'out' | 'inOut' | 'linear'

function bezier(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      const d = dx(t)
      if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-6) break
      t -= e / d
    }
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30 && Math.abs(sx(t) - x) > 1e-7; i++) {
      if (sx(t) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

export const EASE: Readonly<Record<EaseName, (x: number) => number>> = {
  out: bezier(0.22, 1, 0.36, 1),
  inOut: bezier(0.65, 0, 0.35, 1),
  linear: (x) => Math.max(0, Math.min(1, x)),
}

// ---------------------------------------------------------------------------
// Element state at a frame
// ---------------------------------------------------------------------------

function firstFrame(el: CueElement): number {
  return el.in?.f ?? el.draw?.f ?? el.draws?.[0]?.f ?? el.occluder?.f ?? 0
}

/** Opacity 0..1 (fadeIn / fadeOut / hardOut conventions). */
export function opacityAt(el: CueElement, f: number): number {
  if (f < firstFrame(el)) return 0
  let a = 1
  if (el.in?.fade) {
    const k = f - el.in.f
    if (k < el.in.fade) a = EASE.out((k + 1) / el.in.fade)
  }
  if (el.out) {
    const k = f - el.out.f
    if (el.out.fade) {
      if (k >= el.out.fade - 1) return 0
      if (k >= 0) a *= 1 - EASE.out((k + 1) / el.out.fade)
    } else if (k >= 0) return 0
  }
  return a
}

/** Eased 0..1 progress of a track/draw/occluder spec. */
export function progress(spec: Spec | undefined, f: number, ease: EaseName = 'out'): number {
  if (!spec || f < spec.f) return 0
  const k = f - spec.f
  const n = spec.n ?? 1
  return k >= n ? 1 : EASE[spec.ease ?? ease]((k + 1) / n)
}

/** Letter-spacing in em. */
export function trackingAt(el: CueElement, style: TextStyle, f: number): number {
  const tracks = el.track === undefined ? [] : Array.isArray(el.track) ? (el.track as readonly Spec[]) : [el.track as Spec]
  let current: Spec | null = null
  for (const t of tracks) if (f >= t.f) current = t
  if (current === null) return tracks.length > 0 ? tracks[0]!.from! : style.tracking
  return current.from! + (current.to! - current.from!) * progress(current, f)
}

/** SS.hh, floored to hundredths. */
export function formatClock(value: number): string {
  const cents = Math.floor(value * 100 + 1e-6)
  return `${String(Math.floor(cents / 100)).padStart(2, '0')}.${String(cents % 100).padStart(2, '0')}`
}

export function textAt(el: CueElement, f: number): string {
  let s: string
  if (Array.isArray(el.text)) {
    const swaps = el.text as ReadonlyArray<readonly [number, string]>
    s = swaps[0]![1]
    for (const [frame, str] of swaps) if (f >= frame) s = str
  } else s = (el.text as string) ?? ''
  if (el.counter) {
    const c = el.counter
    const r = Math.max(0, Math.min(1, (f - c.f0) / (c.f1 - c.f0)))
    const v = Math.max(Math.min(c.v0, c.v1), Math.min(Math.max(c.v0, c.v1), c.v0 + (c.v1 - c.v0) * r))
    s = s.replace(`{${c.token}}`, formatClock(v))
  }
  return s
}

/** s(f) of a plate move, clamped to its interval. */
export function plateScaleAt(move: PlateMove, f: number): number {
  const r = Math.max(0, Math.min(1, (f - move.from) / (move.to - move.from)))
  return move.scale[0] + (move.scale[1] - move.scale[0]) * r
}

export function plateMoveAt(cues: Cues, f: number): PlateMove | null {
  return cues.plateMoves.find((move) => f >= move.from && f <= move.to) ?? null
}

// ---------------------------------------------------------------------------
// Scene: resolved draw primitives for one frame (JSON, drawn by overlay.html)
// ---------------------------------------------------------------------------

export interface TextOp {
  readonly op: 'text'
  readonly role: string
  readonly x: number
  readonly y: number
  readonly anchor: 'start' | 'middle'
  readonly text: string
  readonly family: string
  readonly size: number
  readonly wght: number
  readonly wdth: number | null
  readonly spacingPx: number
  readonly fill: string
  readonly fillOpacity: number
  readonly shadow: boolean
  readonly hideGlyph: number | null
}
export interface RectOp {
  readonly op: 'rect'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly fill: string
  readonly fillOpacity: number
  readonly shadow: boolean
}
export interface PathOp {
  readonly op: 'path'
  readonly d: string
  readonly stroke: string
  readonly strokeWidth: number
  readonly strokeOpacity: number
  readonly shadow: boolean
}
/** Hairline beside a centred word: its x depends on the word's measured width. */
export interface HairlineOp {
  readonly op: 'hairline'
  readonly side: 'left' | 'right'
  readonly y: number
  readonly length: number
  readonly gapFromText: number
  readonly height: number
  readonly fill: string
  readonly fillOpacity: number
  /** The word, fully tracked, to measure (never drawn). */
  readonly measure: TextOp
}
/** Crescent drawn in place of a hidden glyph of a text op of the same frame. */
export interface CrescentOp {
  readonly op: 'crescent'
  readonly hostRole: string
  readonly glyph: number
  readonly diameterOfCap: number
  readonly opticalShift: number
  /** Occluder offset in diameters (0 = new moon, -0.30 = final crescent). */
  readonly offset: number
  readonly glowOpacity: number
  readonly glowFill: string
}
export type SceneOp = TextOp | RectOp | PathOp | HairlineOp | CrescentOp

const TEXT_ROLES = new Set(['primary', 'kicker', 'data', 'digits', 'tagline', 'cta', 'url', 'footer', 'wordmarkTop', 'wordmarkBottom', 'the'])

function colorOf(cues: Cues, name: string): string {
  return cues.tokens.color[name] ?? name
}

function textOp(cues: Cues, el: CueElement, f: number, a: number, trackOverride?: number): TextOp {
  const style = cues.tokens.style[el.style!]
  if (style === undefined) throw new Error(`${el.role}: unknown style ${el.style}`)
  const spacingPx = (trackOverride ?? trackingAt(el, style, f)) * style.size
  const middle = el.anchor === 'middle'
  return {
    op: 'text',
    role: el.role,
    x: middle ? el.x! + spacingPx / 2 : el.x!,
    y: el.y!,
    anchor: middle ? 'middle' : 'start',
    text: textAt(el, f),
    family: style.family,
    size: style.size,
    wght: style.wght,
    wdth: style.wdth ?? null,
    spacingPx,
    fill: colorOf(cues, style.fill),
    fillOpacity: style.opacity * a,
    shadow: style.shadow !== undefined,
    hideGlyph: el.hideGlyph ?? null,
  }
}

function bracketsPath(cues: Cues, el: CueElement, f: number): string {
  let [x0, y0, x1, y1] = el.box!
  const k = f - el.in!.f
  const p = k < el.in!.fade! ? EASE.out((k + 1) / el.in!.fade!) : 1
  const sc = el.in!.scaleFrom! + (1 - el.in!.scaleFrom!) * p
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  ;[x0, x1] = [cx + (x0 - cx) * sc, cx + (x1 - cx) * sc]
  ;[y0, y1] = [cy + (y0 - cy) * sc, cy + (y1 - cy) * sc]
  if (el.followsPlate) {
    const move = cues.plateMoves.find((m) => m.id === el.followsPlate)
    if (move === undefined) throw new Error(`brackets follow unknown plate move ${el.followsPlate}`)
    const s = plateScaleAt(move, f)
    const [ax, ay] = move.anchor
    ;[x0, x1, y0, y1] = [ax + (x0 - ax) * s, ax + (x1 - ax) * s, ay + (y0 - ay) * s, ay + (y1 - ay) * s]
  }
  const L = el.arm!
  return [
    `M${x0} ${y0 + L}V${y0}H${x0 + L}`,
    `M${x1 - L} ${y0}H${x1}V${y0 + L}`,
    `M${x1} ${y1 - L}V${y1}H${x1 - L}`,
    `M${x0 + L} ${y1}H${x0}V${y1 - L}`,
  ].join('')
}

/** Everything drawn at reel frame f, in paint order. Empty = transparent frame. */
export function sceneAt(cues: Cues, f: number): SceneOp[] {
  const ops: SceneOp[] = []
  const late: SceneOp[] = []
  const { rule, chip } = cues.tokens
  for (const ev of cues.events) {
    for (const el of ev.elements) {
      if (el.role === 'hairline') {
        const the = ev.elements.find((e) => e.role === 'the')
        const p = progress(el.draw, f)
        if (the === undefined || p <= 0) continue
        const theStyle = cues.tokens.style[the.style!]!
        late.push({
          op: 'hairline',
          side: el.side!,
          y: el.y!,
          length: el.length! * p,
          gapFromText: el.gapFromText!,
          height: el.stroke!,
          fill: colorOf(cues, el.fill!),
          fillOpacity: el.opacity!,
          measure: textOp(cues, the, f, 0, theStyle.tracking),
        })
        continue
      }
      if (el.role === 'crescent') {
        const o = el.occluder!
        if (f < o.f) continue
        const p = progress(o, f, 'inOut')
        late.push({
          op: 'crescent',
          hostRole: el.inGlyphOf!,
          glyph: el.glyph!,
          diameterOfCap: el.diameterOfCap!,
          opticalShift: el.opticalShift ?? 0,
          offset: o.from! + (o.to! - o.from!) * p,
          glowOpacity: el.rimGlow!.opacity * p,
          glowFill: colorOf(cues, 'amber'),
        })
        continue
      }
      const a = opacityAt(el, f)
      if (a <= 0) continue
      if (TEXT_ROLES.has(el.role)) {
        ops.push(textOp(cues, el, f, a))
        continue
      }
      switch (el.role) {
        case 'rule': {
          const w = el.w! * (el.draw ? progress(el.draw, f) : 1)
          if (w > 0) ops.push({ op: 'rect', x: el.x!, y: el.y!, w, h: rule.thickness, fill: colorOf(cues, rule.fill), fillOpacity: rule.opacity * a, shadow: true })
          break
        }
        case 'segmentRule': {
          const segW = (el.w! - el.gap! * (el.segments! - 1)) / el.segments!
          for (let i = 0; i < el.segments!; i++) {
            const x = el.x! + i * (segW + el.gap!)
            ops.push({ op: 'rect', x, y: el.y!, w: segW, h: rule.thickness, fill: colorOf(cues, rule.fill), fillOpacity: el.unlitOpacity! * a, shadow: false })
            const p = progress(el.draws![i], f)
            if (p > 0) ops.push({ op: 'rect', x, y: el.y!, w: segW * p, h: rule.thickness, fill: colorOf(cues, 'amber'), fillOpacity: 0.9 * a, shadow: false })
          }
          break
        }
        case 'chip':
          ops.push({ op: 'rect', x: el.x!, y: el.y!, w: chip.size, h: chip.size, fill: colorOf(cues, el.fill!), fillOpacity: a, shadow: false })
          break
        case 'brackets':
          ops.push({ op: 'path', d: bracketsPath(cues, el, f), stroke: colorOf(cues, el.fill!), strokeWidth: el.stroke!, strokeOpacity: el.opacity! * a, shadow: true })
          break
        default:
          throw new Error(`${ev.id}: unknown element role ${el.role}`)
      }
    }
  }
  return [...ops, ...late]
}

/** Frames with anything drawn, ascending. */
export function drawnFrames(cues: Cues): number[] {
  const frames: number[] = []
  for (let f = 0; f < cues.source.frames; f++) if (sceneAt(cues, f).length > 0) frames.push(f)
  return frames
}

/** The event that owns a frame (for reports), or null. */
export function eventAt(cues: Cues, f: number): CueEvent | null {
  return cues.events.find((ev) => f >= ev.from && f <= ev.to) ?? null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Frames an off-unit exit may end on: the first frame of a protected
 * transition, or the frame just before it (f1290, f1865). */
export function transitionBoundaries(cues: Cues): Set<number> {
  return new Set(cues.forbidden.flatMap((range) => [range.from, range.from - 1]))
}

/**
 * Every problem with the cue sheet, empty when it is safe to render:
 * events and elements inside the reel, nothing drawn on a forbidden frame or
 * outside its event, entrances on the 9-frame unit and events on the 18-frame
 * grid, exits on the unit or ending on a transition boundary, plate moves
 * inside the reel and disjoint, chapters in their declared order.
 */
export function validateCues(cues: Cues): string[] {
  const problems: string[] = []
  const { frames } = cues.source
  const unit = cues.tempo.framesPerUnit
  const grid = cues.tempo.framesPerGrid
  if (cues.schema !== CUES_SCHEMA) problems.push(`schema is ${cues.schema}, expected ${CUES_SCHEMA}`)
  const boundaries = transitionBoundaries(cues)
  for (const ev of cues.events) {
    if (ev.from < 0 || ev.to >= frames || ev.from > ev.to) problems.push(`${ev.id}: [${ev.from}, ${ev.to}] is outside the reel`)
    if (ev.from % grid !== 0) problems.push(`${ev.id}: starts at ${ev.from}, off the ${grid}-frame grid`)
    for (const el of ev.elements) {
      const entrances = [el.in?.f, el.draw?.f, el.occluder?.f, ...(el.draws ?? []).map((d) => d.f)]
      const tracks = el.track === undefined ? [] : Array.isArray(el.track) ? (el.track as readonly Spec[]) : [el.track as Spec]
      entrances.push(...tracks.map((t) => t.f))
      if (Array.isArray(el.text)) entrances.push(...(el.text as ReadonlyArray<readonly [number, string]>).map(([frame]) => frame))
      for (const frame of entrances) {
        if (frame !== undefined && frame % unit !== 0) problems.push(`${ev.id}/${el.role}: entrance at ${frame} is off the ${unit}-frame unit`)
      }
      if (el.out !== undefined) {
        const gone = el.out.fade ? el.out.f + el.out.fade - 1 : el.out.f
        if (el.out.f % unit !== 0 && !boundaries.has(gone)) problems.push(`${ev.id}/${el.role}: exit at ${el.out.f} is neither on the unit nor ending on a transition`)
      }
    }
  }
  for (let f = 0; f < frames; f++) {
    const scene = sceneAt(cues, f)
    if (scene.length === 0) continue
    const owner = eventAt(cues, f)
    if (owner === null) problems.push(`frame ${f}: drawn outside every event`)
    const banned = cues.forbidden.find((range) => f >= range.from && f <= range.to)
    if (banned !== undefined) problems.push(`frame ${f}: drawn on a forbidden frame (${banned.why})`)
  }
  const moves = [...cues.plateMoves].sort((a, b) => a.from - b.from)
  moves.forEach((move, index) => {
    if (move.from < 0 || move.to >= frames || move.from >= move.to) problems.push(`${move.id}: [${move.from}, ${move.to}] is outside the reel`)
    if (index > 0 && move.from <= moves[index - 1]!.to) problems.push(`${move.id}: overlaps ${moves[index - 1]!.id}`)
    if (move.ease !== 'linear') problems.push(`${move.id}: plate moves are linear`)
    if (Math.min(...move.scale) < 1) problems.push(`${move.id}: a push never scales below 1 (it would expose the frame edge)`)
  })
  const named = cues.events.flatMap((ev) => (ev.chapter === undefined ? [] : [ev.chapter]))
  const order = named.map((chapter) => cues.chapters.indexOf(chapter))
  if (order.some((index) => index < 0)) problems.push(`unknown chapter in ${named.join(', ')}`)
  if (order.some((index, i) => i > 0 && index < order[i - 1]!)) problems.push(`chapters out of order: ${named.join(', ')}`)
  return problems
}

// ---------------------------------------------------------------------------
// ffmpeg: plate pushes and the titles composite (shared by assembly and the
// local finishing pass, so both apply exactly one transform)
// ---------------------------------------------------------------------------

const SCALE_FLAGS = 'lanczos+accurate_rnd+full_chroma_int'

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(9).replace(/0+$/, '')
}

/**
 * One plate move applied to a trimmed segment (frame 0 = move.from). The
 * frame is upsampled 2x and resampled by `perspective` with a per-frame scale
 * about the anchor, then brought back to size: smooth sub-pixel motion every
 * frame. (ffmpeg's zoompan rounds its crop window to whole pixels and visibly
 * steps every 3-4 frames, so it is never used for these pushes.)
 */
export function platePushFilter(move: PlateMove, width: number, height: number): string {
  const W2 = width * 2
  const H2 = height * 2
  const AX = num(move.anchor[0] * 2)
  const AY = num(move.anchor[1] * 2)
  // perspective's output counter is one-based; the trimmed move is zero-based.
  const S = `(${num(move.scale[0])}+${num(move.scale[1] - move.scale[0])}*(on-1)/${move.to - move.from})`
  const left = `${AX}-${AX}/${S}`
  const right = `${AX}+(W-${AX})/${S}`
  const top = `${AY}-${AY}/${S}`
  const bottom = `${AY}+(H-${AY})/${S}`
  return [
    `scale=${W2}:${H2}:flags=${SCALE_FLAGS}`,
    'format=yuv444p',
    `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':interpolation=cubic:sense=source:eval=frame`,
    `scale=${width}:${height}:flags=${SCALE_FLAGS}`,
    'setsar=1',
  ].join(',')
}

/**
 * Filter chains taking `[input]` (the whole yuv444p sequence, pts = frame
 * index) to `[output]` with every plate move applied in place: the sequence
 * is split into consecutive runs, each move's run is pushed, everything is
 * concatenated back in order, so no frame moves in time.
 */
export function platePushChains(cues: Cues, input: string, output: string, fps: number): string[] {
  const { frames, width, height } = cues.source
  const moves = [...cues.plateMoves].sort((a, b) => a.from - b.from)
  const runs: Array<{ from: number; to: number; move: PlateMove | null }> = []
  let cursor = 0
  for (const move of moves) {
    if (move.from > cursor) runs.push({ from: cursor, to: move.from - 1, move: null })
    runs.push({ from: move.from, to: move.to, move })
    cursor = move.to + 1
  }
  if (cursor < frames) runs.push({ from: cursor, to: frames - 1, move: null })
  const chains = [`[${input}]split=${runs.length}${runs.map((_, i) => `[pp${i}]`).join('')}`]
  runs.forEach((run, i) => {
    const trim = `trim=start_frame=${run.from}:end_frame=${run.to + 1},setpts=PTS-STARTPTS`
    chains.push(`[pp${i}]${trim}${run.move === null ? '' : `,${platePushFilter(run.move, width, height)}`}[pq${i}]`)
  })
  chains.push(`${runs.map((_, i) => `[pq${i}]`).join('')}concat=n=${runs.length}:v=1:a=0,settb=1/${fps},setpts=N[${output}]`)
  return chains
}

/**
 * The titles track (RGBA, straight alpha, 0 = transparent) over `[input]`:
 * converted to BT.709 limited-range YUVA so the composite happens in the
 * sequence's own 4:4:4 space before the delivery scale.
 */
export function titlesOverlayChains(titles: string, input: string, output: string, fps: number): string[] {
  return [
    `[${titles}]settb=1/${fps},setpts=N,scale=out_color_matrix=bt709:out_range=tv,format=yuva444p[titlesyuv]`,
    `[${input}][titlesyuv]overlay=format=yuv444:alpha=straight:eof_action=pass:repeatlast=0,settb=1/${fps},setpts=N[${output}]`,
  ]
}

/** The titled finish of a whole `[input]` sequence: pushes, then titles. */
export function titledChains(cues: Cues, input: string, titles: string, output: string, fps: number): string[] {
  return [...platePushChains(cues, input, 'pushed', fps), ...titlesOverlayChains(titles, 'pushed', output, fps)]
}
