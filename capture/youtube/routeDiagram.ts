/**
 * The First Strike route board, computed from the game's own code.
 *
 * Every number and every line on the board comes from the same functions the
 * game runs: the canonical e2e fixture site, deriveRivalSite() for the rival,
 * createStrikeRoute() for the path and sampleMinimumStrikeClearanceM() for
 * the clearance its unit test checks. Nothing here is typed by hand, so the
 * board cannot drift from the game.
 *
 * The globe is an orthographic line drawing viewed edge-on to the route's
 * plane: the great circle through both sites is the limb, so the route rises
 * above the disc at true scale (the disc radius is the 1,737.4 km datum).
 */
import { createStrikeRoute, sampleMinimumStrikeClearanceM, STRIKE_ROUTE_SAFETY } from '../../src/camera/strikeRoute.ts'
import { createLandingSite, createLunarLocation, MEAN_LUNAR_DATUM, surfaceUnitVector, type Vec3 } from '../../src/domain/lunarCoordinates.ts'
import { deriveRivalSite } from '../../src/domain/rival.ts'

/** e2e/firstStrikeFixtures.ts `SITE` (also the capture fixtures' site): latitude, longitude in radians, height in metres. */
export const CANONICAL_FIXTURE_SITE = { latitudeRad: 0.248, longitudeRad: -0.684, heightM: 18 } as const

export interface Point { readonly x: number; readonly y: number }

export interface RouteBoard {
  readonly player: { readonly latDeg: number; readonly lonDeg: number; readonly heightM: number; readonly xy: Point }
  readonly rival: { readonly latDeg: number; readonly lonDeg: number; readonly xy: Point }
  readonly separationDeg: number
  readonly peakClearanceKm: number
  readonly minimumClearanceKm: number
  readonly sampledMinimumClearanceKm: number
  readonly samples: number
  readonly datumRadiusKm: number
  /** SVG path data, board pixels. */
  readonly limb: string
  readonly graticule: readonly string[]
  readonly route: string
  /** Label anchors (text baselines, anchor middle). */
  readonly anchors: Readonly<Record<string, Point>>
  /** Template values for the cue sheet's {tokens}. */
  readonly tokens: Readonly<Record<string, string>>
}

const DEG = 180 / Math.PI
const round = (v: number) => Math.round(v * 100) / 100

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(dot(a, a)))

/** Latitude formatted the way the game formats it: three decimals, hemisphere letter. */
export function formatLat(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg >= 0 ? 'N' : 'S'}`
}
export function formatLon(deg: number): string {
  return `${Math.abs(deg).toFixed(3)}° ${deg >= 0 ? 'E' : 'W'}`
}

function pathOf(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join('')
}

export function routeBoard(center: readonly [number, number], radius: number): RouteBoard {
  const site = createLandingSite(createLunarLocation(CANONICAL_FIXTURE_SITE.latitudeRad, CANONICAL_FIXTURE_SITE.longitudeRad, CANONICAL_FIXTURE_SITE.heightM))
  const rival = deriveRivalSite(site).site
  const route = createStrikeRoute(site, rival)
  const R = MEAN_LUNAR_DATUM.referenceRadiusM
  const p = unit(surfaceUnitVector(site.location))
  const r = unit(surfaceUnitVector(rival.location))
  // Screen basis: up bisects the sites, right runs player -> rival, toward-viewer completes it.
  const up = unit(add(p, r))
  const right = unit(sub(r, p))
  const toward = unit(cross(right, up))
  const [cx, cy] = center
  const project = (v: Vec3): Point => ({ x: cx + radius * dot(v, right), y: cy - radius * dot(v, up) })

  const limb: Point[] = []
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * 2 * Math.PI
    limb.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
  }

  // Graticule: parallels every 30° and meridians every 30°, front hemisphere only.
  const graticule: string[] = []
  const lineFrom = (sample: (t: number) => Vec3, n: number) => {
    let run: Point[] = []
    for (let i = 0; i <= n; i++) {
      const v = sample(i / n)
      if (dot(v, toward) >= 0) run.push(project(v))
      else if (run.length > 0) { if (run.length > 1) graticule.push(pathOf(run)); run = [] }
    }
    if (run.length > 1) graticule.push(pathOf(run))
  }
  const surface = (latDeg: number, lonDeg: number) => surfaceUnitVector({ latitudeRad: latDeg / DEG, longitudeRad: lonDeg / DEG, heightM: 0 })
  for (let lat = -60; lat <= 60; lat += 30) lineFrom((t) => surface(lat, -180 + 360 * t), 240)
  for (let lon = -180; lon < 180; lon += 30) lineFrom((t) => surface(-89.999 + 179.998 * t, lon), 180)

  const routePoints: Point[] = []
  for (let i = 0; i <= 256; i++) {
    const q = route.getCanonicalPoint(i / 256)
    routePoints.push(project({ x: q.x / R, y: q.y / R, z: q.z / R }))
  }

  const P = project(p)
  const Q = project(r)
  const player = { latDeg: site.location.latitudeRad * DEG, lonDeg: site.location.longitudeRad * DEG, heightM: site.location.heightM, xy: P }
  const riv = { latDeg: rival.location.latitudeRad * DEG, lonDeg: rival.location.longitudeRad * DEG, xy: Q }
  const sampled = sampleMinimumStrikeClearanceM(route)
  const separationDeg = route.angularSeparationRad * DEG
  const out = 150
  return {
    player,
    rival: riv,
    separationDeg,
    peakClearanceKm: route.peakClearanceM / 1000,
    minimumClearanceKm: route.minimumClearanceM / 1000,
    sampledMinimumClearanceKm: sampled / 1000,
    samples: STRIKE_ROUTE_SAFETY.sampleCount,
    datumRadiusKm: R / 1000,
    limb: pathOf(limb) + 'Z',
    graticule,
    route: pathOf(routePoints),
    anchors: {
      'player-name': { x: P.x - out, y: P.y - 66 },
      'player-coords': { x: P.x - out, y: P.y - 38 },
      'rival-name': { x: Q.x + out, y: Q.y - 66 },
      'rival-coords': { x: Q.x + out, y: Q.y - 38 },
    },
    tokens: {
      playerCoords: `${formatLat(player.latDeg)}  ${formatLon(player.lonDeg)}`,
      rivalCoords: `${formatLat(riv.latDeg)}  ${formatLon(riv.lonDeg)}`,
      separationDeg: String(Math.round(separationDeg)),
      peakKm: String(Math.round(route.peakClearanceM / 1000)),
      minKm: String(Math.round(route.minimumClearanceM / 1000)),
      samples: STRIKE_ROUTE_SAFETY.sampleCount.toLocaleString('en-US'),
    },
  }
}
