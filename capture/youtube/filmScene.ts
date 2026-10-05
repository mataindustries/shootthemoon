/**
 * The YouTube film's graphics layer: ORBITAL RECORD, unchanged, at film
 * frame numbers.
 *
 * youtubeTitles.cues.json is a reel-titles/1 cue sheet: every record, card
 * and the end card resolve through capture/titles/titles.ts sceneAt() exactly
 * as the reel's do. Two film additions sit beside it:
 *
 *  - template text ({tokens}) and computed label anchors (anchorTo) on the
 *    route board, filled from routeDiagram.ts, i.e. from the game code;
 *  - boards[]: the few vector primitives the reel never needed (a phone
 *    outline, the route diagram, workflow connectors, capture ticks). They
 *    use the same in/out/draw conventions and draw under the record text.
 *
 * Pure and deterministic: a function of the frame number and the cue sheet.
 */
import { opacityAt, progress, sceneAt, validateCues, type CueElement, type Cues, type SceneOp, type Spec } from '../titles/titles.ts'
import { routeBoard, type RouteBoard } from './routeDiagram.ts'

export const FILM_TITLES_SCHEMA = 'shootthemoon.youtube-titles/1'

interface BoardBase {
  readonly id: string
  readonly segment: string
}
export interface RoundRectBoard extends BoardBase {
  readonly type: 'roundRect'
  readonly box: readonly [number, number, number, number]
  readonly radius: number
  readonly stroke: string
  readonly width: number
  readonly opacity: number
  readonly in: Spec
  readonly out: Spec
}
export interface RouteBoardSpec extends BoardBase {
  readonly type: 'route'
  readonly center: readonly [number, number]
  readonly radius: number
  readonly timing: { readonly globe: Spec; readonly sites: Spec; readonly route: Spec; readonly out: Spec }
}
export interface WorkflowBoard extends BoardBase {
  readonly type: 'workflow'
  readonly y: number
  readonly xs: readonly number[]
  readonly nodeIns: readonly number[]
  readonly loop: { readonly f: number; readonly n: number; readonly y: number }
  readonly out: Spec
}
export interface TicksBoard extends BoardBase {
  readonly type: 'ticks'
  readonly grid: { readonly x: number; readonly y: number; readonly cols: number; readonly rows: number; readonly cellW: number; readonly cellH: number; readonly gap: number }
  readonly first: number
  readonly every: number
  readonly out: Spec
}
export type Board = RoundRectBoard | RouteBoardSpec | WorkflowBoard | TicksBoard

export interface FilmCues extends Cues {
  readonly film: string
  readonly boards: readonly Board[]
}

export interface FStrokeOp { readonly op: 'fstroke'; readonly d: string; readonly stroke: string; readonly width: number; readonly opacity: number; readonly drawn: number }
export interface FDotOp { readonly op: 'fdot'; readonly cx: number; readonly cy: number; readonly r: number; readonly fill: string; readonly opacity: number }
export interface FRingOp { readonly op: 'fring'; readonly cx: number; readonly cy: number; readonly r: number; readonly stroke: string; readonly width: number; readonly opacity: number }
export interface FRoundRectOp { readonly op: 'frrect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number; readonly stroke: string; readonly width: number; readonly opacity: number }
export interface FRectOp { readonly op: 'frect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly fill: string; readonly opacity: number }
export type FilmOp = FStrokeOp | FDotOp | FRingOp | FRoundRectOp | FRectOp
export type FilmSceneOp = SceneOp | FilmOp

const colorOf = (cues: Cues, name: string) => cues.tokens.color[name] ?? name
/** in/out semantics of a cue element, for a board part. */
const alpha = (inSpec: Spec, out: Spec, f: number) => opacityAt({ role: 'board', in: inSpec, out } as CueElement, f)

function routeSpec(cues: FilmCues): RouteBoardSpec | undefined {
  return cues.boards.find((b): b is RouteBoardSpec => b.type === 'route')
}

const routeCache = new Map<string, RouteBoard>()
export function routeGeometry(spec: Pick<RouteBoardSpec, 'center' | 'radius'>): RouteBoard {
  const key = `${spec.center.join(',')}:${spec.radius}`
  let board = routeCache.get(key)
  if (board === undefined) {
    board = routeBoard(spec.center, spec.radius)
    routeCache.set(key, board)
  }
  return board
}

/** The cue sheet with route tokens and anchors filled from the game code. */
export function resolveFilmCues(cues: FilmCues): FilmCues {
  if (cues.film !== FILM_TITLES_SCHEMA) throw new Error(`film cue sheet schema is ${cues.film}, expected ${FILM_TITLES_SCHEMA}`)
  const spec = routeSpec(cues)
  const route = spec === undefined ? null : routeGeometry(spec)
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = route?.tokens[token]
    if (value === undefined) throw new Error(`unknown film template ${match}`)
    return value
  })
  const events = cues.events.map((ev) => ({
    ...ev,
    elements: ev.elements.map((el) => {
      const anchorTo = (el as { anchorTo?: string }).anchorTo
      let next: CueElement = el
      if (typeof el.text === 'string' && /\{\w+\}/.test(el.text) && el.counter === undefined) next = { ...next, text: fill(el.text) }
      if (anchorTo !== undefined) {
        const at = route?.anchors[anchorTo]
        if (at === undefined) throw new Error(`${ev.id}: unknown anchor ${anchorTo}`)
        next = { ...next, x: Math.round(at.x), y: Math.round(at.y) }
      }
      return next
    }),
  }))
  return { ...cues, events }
}

/** The film-only primitives drawn at frame f (under the record text). */
export function boardOpsAt(cues: FilmCues, f: number): FilmOp[] {
  const ops: FilmOp[] = []
  const amber = colorOf(cues, 'amber')
  const ink = colorOf(cues, 'ink')
  for (const board of cues.boards) {
    switch (board.type) {
      case 'roundRect': {
        const a = alpha(board.in, board.out, f)
        if (a > 0) ops.push({ op: 'frrect', x: board.box[0], y: board.box[1], w: board.box[2], h: board.box[3], r: board.radius, stroke: colorOf(cues, board.stroke), width: board.width, opacity: board.opacity * a })
        break
      }
      case 'route': {
        const g = routeGeometry(board)
        const { globe, sites, route, out } = board.timing
        const ga = alpha(globe, out, f)
        if (ga > 0) {
          for (const d of g.graticule) ops.push({ op: 'fstroke', d, stroke: ink, width: 1, opacity: 0.13 * ga, drawn: 1 })
          ops.push({ op: 'fstroke', d: g.limb, stroke: ink, width: 1.5, opacity: 0.4 * ga, drawn: 1 })
        }
        const ra = alpha({ f: route.f, fade: 1 }, out, f)
        const drawn = progress(route, f, 'inOut')
        if (ra > 0 && drawn > 0) ops.push({ op: 'fstroke', d: g.route, stroke: amber, width: 3, opacity: 0.95 * ra, drawn })
        const sa = alpha(sites, out, f)
        if (sa > 0) {
          for (const [site, color] of [[g.player.xy, amber], [g.rival.xy, colorOf(cues, 'cyan')]] as const) {
            ops.push({ op: 'fring', cx: site.x, cy: site.y, r: 13, stroke: color, width: 1.5, opacity: 0.6 * sa })
            ops.push({ op: 'fdot', cx: site.x, cy: site.y, r: 5.5, fill: color, opacity: sa })
          }
        }
        break
      }
      case 'workflow': {
        const { xs, y, nodeIns, loop, out } = board
        xs.forEach((x, i) => {
          const a = alpha({ f: nodeIns[i]!, fade: 9 }, out, f)
          if (a > 0) ops.push({ op: 'frect', x: x - 6, y: y - 6, w: 12, h: 12, fill: i === 0 ? amber : ink, opacity: (i === 0 ? 1 : 0.85) * a })
          if (i > 0) {
            const p = progress({ f: nodeIns[i]!, n: 18 }, f)
            const la = alpha({ f: nodeIns[i]!, fade: 1 }, out, f)
            if (p > 0 && la > 0) ops.push({ op: 'fstroke', d: `M${xs[i - 1]! + 22} ${y}H${x - 22}`, stroke: ink, width: 2, opacity: 0.5 * la, drawn: p })
          }
        })
        const lp = progress({ f: loop.f, n: loop.n }, f, 'inOut')
        const la = alpha({ f: loop.f, fade: 1 }, out, f)
        if (lp > 0 && la > 0) {
          const x0 = xs[0]!
          const x1 = xs[xs.length - 1]!
          // Under the sub-labels: down from QA, back along the bottom, up to an arrowhead below DIRECTION.
          const top = loop.y - 60
          ops.push({ op: 'fstroke', d: `M${x1} ${top}V${loop.y}H${x0}V${top}M${x0 - 9} ${top + 12}L${x0} ${top}L${x0 + 9} ${top + 12}`, stroke: amber, width: 2, opacity: 0.75 * la, drawn: lp })
        }
        break
      }
      case 'ticks': {
        const { grid, first, every, out } = board
        for (let i = 0; i < grid.cols * grid.rows; i++) {
          const a = alpha({ f: first + i * every, fade: 9 }, out, f)
          if (a <= 0) continue
          const col = i % grid.cols
          const row = Math.floor(i / grid.cols)
          ops.push({ op: 'frect', x: grid.x + col * (grid.cellW + grid.gap), y: grid.y + row * (grid.cellH + grid.gap) + grid.cellH + 4, w: grid.cellW, h: 2, fill: amber, opacity: 0.9 * a })
        }
        break
      }
    }
  }
  return ops
}

/** Everything drawn at film frame f: boards first (underneath), then the ORBITAL RECORD scene. */
export function filmSceneAt(resolved: FilmCues, f: number): FilmSceneOp[] {
  return [...boardOpsAt(resolved, f), ...sceneAt(resolved, f)]
}

export function drawnFilmFrames(resolved: FilmCues): number[] {
  const frames: number[] = []
  for (let f = 0; f < resolved.source.frames; f++) if (filmSceneAt(resolved, f).length > 0) frames.push(f)
  return frames
}

/** validateCues() for the record events, plus: boards stay inside their segment and off every forbidden frame. */
export function validateFilmCues(resolved: FilmCues, segments: ReadonlyArray<{ readonly id: string; readonly from: number; readonly to: number }>): string[] {
  const problems = validateCues(resolved)
  const byId = new Map(segments.map((s) => [s.id, s]))
  for (const board of resolved.boards) {
    const seg = byId.get(board.segment)
    if (seg === undefined) {
      problems.push(`${board.id}: unknown segment ${board.segment}`)
      continue
    }
    for (let f = 0; f < resolved.source.frames; f++) {
      if (boardOpsAt({ ...resolved, boards: [board] }, f).length === 0) continue
      if (f < seg.from || f > seg.to) problems.push(`${board.id}: drawn at frame ${f}, outside ${board.segment} [${seg.from}, ${seg.to}]`)
      const banned = resolved.forbidden.find((range) => f >= range.from && f <= range.to)
      if (banned !== undefined) problems.push(`${board.id}: drawn on forbidden frame ${f} (${banned.why})`)
    }
  }
  for (const ev of resolved.events) {
    const owner = segments.find((s) => ev.from >= s.from && ev.from <= s.to)
    const last = segments.find((s) => ev.to >= s.from && ev.to <= s.to)
    if (owner === undefined || last === undefined) problems.push(`${ev.id}: [${ev.from}, ${ev.to}] is outside the film`)
  }
  return problems
}
