import { DEPOSIT_BLUEPRINTS, ROBOT_IDLE_POSITION, type LocalSurfacePosition, type OutpostSnapshot } from '../domain/outpost.ts'
import { deriveSecondaryImpactOffset } from '../domain/counterstrike.ts'
import { getRobotKinematics, getRobotStateDurationMs } from '../simulation/outpostSimulation.ts'
import { MODULE_SOCKETS } from './moduleLayout.ts'

export const WORKER_SCALE_M = .92
export const WORKER_RADIUS_M = 1.25 * WORKER_SCALE_M
const BUFFER_M = .12
const SPEED_M_S = 2.4

/** Capsule-local service socket behind the landing legs, clear of the
 * established miner ramp and travel corridors. Workers take turns here. */
export const CAPSULE_SERVICE_ANCHOR = Object.freeze({
  name: 'capsule-service-dock', radiusM: 5.3,
  xM: Math.sin(.285) * 5.3, zM: -Math.cos(.285) * 5.3,
})
export function capsuleServiceBay(): LocalSurfacePosition {
  return { xM: CAPSULE_SERVICE_ANCHOR.xM, zM: CAPSULE_SERVICE_ANCHOR.zM }
}

export interface WorkerObstacle { a: LocalSurfacePosition; b: LocalSurfacePosition; radius: number }
const distance = (a: LocalSurfacePosition, b: LocalSurfacePosition) => Math.hypot(a.xM - b.xM, a.zM - b.zM)
const pointSegment = (p: LocalSurfacePosition, a: LocalSurfacePosition, b: LocalSurfacePosition) => {
  const dx = b.xM - a.xM, dz = b.zM - a.zM
  const t = Math.max(0, Math.min(1, ((p.xM - a.xM) * dx + (p.zM - a.zM) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p.xM - a.xM - dx * t, p.zM - a.zM - dz * t)
}
function segmentDistance(a: LocalSurfacePosition, b: LocalSurfacePosition, c: LocalSurfacePosition, d: LocalSurfacePosition) {
  const cross = (p: LocalSurfacePosition, q: LocalSurfacePosition, r: LocalSurfacePosition) =>
    (q.xM - p.xM) * (r.zM - p.zM) - (q.zM - p.zM) * (r.xM - p.xM)
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b))
}
export function workerSegmentClear(a: LocalSurfacePosition, b: LocalSurfacePosition, obstacles: readonly WorkerObstacle[]) {
  return obstacles.every(o => segmentDistance(a, b, o.a, o.b) >= o.radius - 1e-7)
}
const disc = (p: LocalSurfacePosition, radius: number): WorkerObstacle => ({ a: p, b: p, radius: radius + WORKER_RADIUS_M + BUFFER_M })

export function workerObstacles(outpost: OutpostSnapshot, _damaged: boolean): WorkerObstacle[] {
  const obstacles = [disc({ xM: 0, zM: 0 }, 3.65), disc(ROBOT_IDLE_POSITION, 1.25 * 1.14),
    ...DEPOSIT_BLUEPRINTS.map(d => disc(d.position, 1.6))]
  // Reserve the authored build slots before the first module is chosen. A
  // newly constructed coupler must never materialize around a moving worker.
  const kinds = outpost.module ? [outpost.module.kind] : ['SOLAR_WING', 'STORAGE_SILO', 'REPAIR_GANTRY'] as const
  for (const kind of kinds) {
    const socket = MODULE_SOCKETS[kind]
    if (kind === 'SOLAR_WING') {
      // Enclose the long, narrow wing in its actual orientation, not a disk
      // large enough to swallow the lander and its neighboring service bays.
      obstacles.push({ a: { xM: -6, zM: -8.9 }, b: { xM: -6, zM: 8.9 }, radius: 1.95 + WORKER_RADIUS_M + BUFFER_M })
    } else {
      obstacles.push(disc(socket, socket.clearanceRadiusM))
      obstacles.push({ a: { xM: 0, zM: 0 }, b: socket, radius: .4 + WORKER_RADIUS_M + BUFFER_M })
    }
  }
  // The impact approach is reserved before damage so a strike cannot create
  // its crater underneath an occupied route.
  obstacles.push(disc(deriveSecondaryImpactOffset(outpost), 6.5))
  // Leave the manual miner's departure fan clear even before a command, so
  // a worker never needs to dodge a launch from the adjacent ramp at close range.
  obstacles.push(...minerCorridors(outpost, false, .45))
  return obstacles
}

function minerCorridors(outpost: OutpostSnapshot, activeOnly = false, fraction = 1): WorkerObstacle[] {
  const obstacles: WorkerObstacle[] = []
  for (const deposit of DEPOSIT_BLUEPRINTS) {
    if (deposit.id === outpost.extractor?.depositId || (activeOnly && deposit.id !== outpost.robot.targetDepositId)) continue
    const traveling = { ...outpost, robot: { ...outpost.robot, state: 'traveling' as const,
      targetDepositId: deposit.id, stateStartedAtMs: 0 } }
    const duration = getRobotStateDurationMs(traveling) ?? 1
    let previous = getRobotKinematics(traveling, 0).position
    for (let i = 1; i <= 8; i++) {
      const next = getRobotKinematics(traveling, duration * fraction * i / 8).position
      obstacles.push({ a: previous, b: next, radius: 1.25 * 1.14 + WORKER_RADIUS_M + .2 })
      previous = next
    }
  }
  return obstacles
}

/** Small deterministic visibility graph, built only when a task or topology
 * changes. Expanded capsule-shaped obstacles include chassis clearance. */
export function planWorkerPath(start: LocalSurfacePosition, end: LocalSurfacePosition, obstacles: readonly WorkerObstacle[]): LocalSurfacePosition[] {
  if (![start.xM, start.zM, end.xM, end.zM].every(Number.isFinite)) return []
  if (!workerSegmentClear(start, start, obstacles) || !workerSegmentClear(end, end, obstacles)) return []
  if (workerSegmentClear(start, end, obstacles)) return [end]
  const nodes = [start, end]
  for (const o of obstacles) for (const center of o.a === o.b ? [o.a] : [o.a, o.b]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, radius = o.radius / Math.cos(Math.PI / 16) + .04
      const p = { xM: center.xM + Math.sin(angle) * radius, zM: center.zM + Math.cos(angle) * radius }
      if (workerSegmentClear(p, p, obstacles)) nodes.push(p)
    }
  }
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>()
  costs[0] = 0
  for (let count = 0; count < nodes.length; count++) {
    let current = -1
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || costs[i]! < costs[current]!)) current = i
    if (current < 0 || !Number.isFinite(costs[current])) return []
    if (current === 1) {
      const path: LocalSurfacePosition[] = []
      for (let at = 1; at > 0; at = previous[at]!) path.unshift(nodes[at]!)
      return path
    }
    visited.add(current)
    for (let next = 1; next < nodes.length; next++) {
      if (visited.has(next)) continue
      const cost = costs[current]! + distance(nodes[current]!, nodes[next]!)
      if (cost < costs[next]! && workerSegmentClear(nodes[current]!, nodes[next]!, obstacles)) {
        costs[next] = cost; previous[next] = current
      }
    }
  }
  return []
}

export interface WorkerPose {
  xM: number; zM: number
  heading: number; task: 'servicing' | 'traveling' | 'working' | 'returning'
  path: LocalSurfacePosition[]; dwell: number; wheelSpin: number; moving: boolean; blockedAt: string; yielding: boolean
}
export interface WorkerNavigation {
  workers: WorkerPose[]; lastNowMs: number | null; topology: string
  obstacles: WorkerObstacle[]; revision: number; seconds: number; nextWorker: number; trafficRevision: number; workBays: LocalSurfacePosition[]; initialized: boolean; minerCorridor: WorkerObstacle[]
}
export function createWorkerNavigation(): WorkerNavigation {
  return { workers: [0, 1, 2].map(() => ({ ...capsuleServiceBay(),
    heading: Math.atan2(-capsuleServiceBay().xM, -capsuleServiceBay().zM),
    task: 'servicing', path: [], dwell: 1, wheelSpin: 0, moving: false, blockedAt: '', yielding: false })),
  lastNowMs: null, topology: '', obstacles: [], revision: 0, seconds: 0, nextWorker: 0, trafficRevision: 0, workBays: [], initialized: false, minerCorridor: [] }
}
function planWorkBays(outpost: OutpostSnapshot): LocalSurfacePosition[] {
  const target = outpost.extractor!.position
  // Keep task endpoints outside every future module and the possible impact
  // scar, even before construction/damage. Their identities never drift with
  // a repair percentage or changing production rate.
  const obstacles = [...workerObstacles({ ...outpost, module: null }, true), ...minerCorridors(outpost)]
  const bays: LocalSurfacePosition[] = []
  const facing = Math.atan2(-target.xM, -target.zM)
  for (let index = 0; index < 3; index++) {
    const desired = facing + (index - 1) * .8
    let best: LocalSurfacePosition | null = null, score = Infinity
    for (const radius of [3.8, 4.5, 5.2, 5.9]) for (let i = 0; i < 64; i++) {
      const angle = facing + i * Math.PI / 32
      const p = { xM: target.xM + Math.sin(angle) * radius, zM: target.zM + Math.cos(angle) * radius }
      const cost = radius + Math.abs(Math.atan2(Math.sin(angle - desired), Math.cos(angle - desired))) * 2
      if (cost < score && workerSegmentClear(p, p, obstacles) && bays.every(b => distance(p, b) > WORKER_RADIUS_M * 2 + .25)) {
        best = p; score = cost
      }
    }
    if (best) bays.push(best)
  }
  return bays
}

/** Presentation-only task controller. One robot owns the narrow travel corridor
 * at a time; the others keep servicing/mining. Parked robots are obstacles, so
 * incoming and returning traffic cannot overlap or deadlock head-on. */
export function advanceWorkerNavigation(nav: WorkerNavigation, outpost: OutpostSnapshot, nowMs: number,
  activity: number, activeRobots: number, damaged: boolean): void {
  if (!Number.isFinite(nowMs) || !outpost.extractor) return
  const target = outpost.extractor.position
  if (![target.xM, target.zM].every(Number.isFinite) || Math.hypot(target.xM, target.zM) < 8) {
    nav.workers.forEach(w => { w.moving = false })
    return
  }
  const dt = nav.lastNowMs === null ? 0 : Math.max(0, Math.min(.1, (nowMs - nav.lastNowMs) / 1000))
  nav.lastNowMs = nowMs
  const rate = Number.isFinite(activity) && activity > 0 ? .55 + .45 * Math.min(1, activity) : 0
  nav.seconds += dt
  const topology = `${outpost.extractor.position.xM}:${outpost.extractor.position.zM}:${outpost.module?.kind ?? ''}:${damaged}:${activeRobots}:${outpost.robot.state}:${outpost.robot.targetDepositId}`
  const changed = topology !== nav.topology
  if (changed) {
    nav.topology = topology; nav.obstacles = workerObstacles(outpost, damaged); nav.revision++
    nav.minerCorridor = ['traveling', 'mining', 'returning'].includes(outpost.robot.state) ? minerCorridors(outpost, true) : []
    if (!nav.workBays.length) nav.workBays = planWorkBays(outpost)
  }
  if (!nav.initialized) {
    if (nav.workBays.length !== 3) return
    // Initialization precedes the first rendered instance matrices. Only one
    // worker starts at the shared berth; the others service the extractor.
    nav.workers.forEach((w, i) => {
      Object.assign(w, i === 0 ? capsuleServiceBay() : nav.workBays[i])
      w.task = i === 0 ? 'servicing' : 'working'
    })
    nav.initialized = true
  }
  const obstaclesFor = (index: number) => [...nav.obstacles, ...nav.workers.flatMap((w, i) =>
    i !== index ? [disc(w, WORKER_RADIUS_M)] : [])]
  const destination = (w: WorkerPose, index: number) => w.task === 'returning' ? capsuleServiceBay() : nav.workBays[index] ?? capsuleServiceBay()
  let traveler = nav.workers.findIndex((w, i) => i < activeRobots && (w.task === 'traveling' || w.task === 'returning'))
  for (let i = 0; i < nav.workers.length; i++) {
    const w = nav.workers[i]!
    w.moving = false
    if (w.task === 'working' || w.task === 'servicing') {
      const aim = w.task === 'servicing' ? { xM: 0, zM: 0 } : outpost.extractor.position
      const heading = Math.atan2(aim.xM - w.xM, aim.zM - w.zM)
      const turn = Math.atan2(Math.sin(heading - w.heading), Math.cos(heading - w.heading))
      w.heading += Math.max(-dt * 3.5, Math.min(dt * 3.5, turn))
    }
    if (i < activeRobots) w.dwell = Math.max(0, w.dwell - dt * rate)
    if (changed && (w.task === 'traveling' || w.task === 'returning')) {
      const fixed = obstaclesFor(i), obstacles = [...fixed, ...nav.minerCorridor], points = [w, ...w.path]
      if (w.yielding || !w.path.length || points.some((p, j) => j > 0 && !workerSegmentClear(points[j - 1]!, p, obstacles))) {
        w.path = planWorkerPath(w, destination(w, i), obstacles)
        w.yielding = !w.path.length && nav.minerCorridor.length > 0
        // If a manual job starts while this worker is crossing its corridor,
        // clear the crossing first, then wait for that job's state transition.
        if (w.yielding && !workerSegmentClear(w, w, nav.minerCorridor)) {
          let escape: LocalSurfacePosition | null = null
          for (const radius of [.8, 1.6, 2.4, 3.2, 4, 5, 6]) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
              const p = { xM: w.xM + Math.sin(angle) * radius, zM: w.zM + Math.cos(angle) * radius }
              if (workerSegmentClear(w, p, fixed) && workerSegmentClear(p, p, nav.minerCorridor)) { escape = p; break }
            }
            if (escape) break
          }
          if (escape) w.path = [escape]
        }
      }
    }
  }
  if (traveler < 0 && rate > 0) {
    for (let offset = 0; offset < 3; offset++) {
      const i = (nav.nextWorker + offset) % 3, w = nav.workers[i]!
      const attempt = `${nav.revision}:${nav.trafficRevision}`
      if (i >= activeRobots || w.dwell > 0 || w.blockedAt === attempt) continue
      const task = w.task === 'working' ? 'returning' : 'traveling'
      const path = planWorkerPath(w, task === 'returning' ? capsuleServiceBay() : nav.workBays[i] ?? capsuleServiceBay(), [...obstaclesFor(i), ...nav.minerCorridor])
      if (!path.length) { w.blockedAt = attempt; continue }
      w.task = task; w.path = path; w.yielding = false; traveler = i; nav.nextWorker = (i + 1) % 3; break
    }
  }
  if (traveler < 0) return
  const w = nav.workers[traveler]!, next = w.path[0]
  if (!next || rate === 0) return
  const gap = distance(w, next)
  let heading = Math.atan2(next.xM - w.xM, next.zM - w.zM)
  const reverse = w.yielding && Math.cos(heading - w.heading) < 0
  if (reverse) heading += Math.PI
  const turn = Math.atan2(Math.sin(heading - w.heading), Math.cos(heading - w.heading))
  const maxTurn = dt * 3.5
  w.heading += Math.max(-maxTurn, Math.min(maxTurn, turn))
  // Turn on the spot at corners, never cut through an expanded obstacle.
  if (Math.abs(turn) > .12) return
  const step = Math.min(gap, dt * SPEED_M_S * rate)
  const candidate = gap > 0 ? { xM: w.xM + (next.xM - w.xM) * step / gap,
    zM: w.zM + (next.zM - w.zM) * step / gap } : next
  // Yield before entering a commanded miner's corridor. A worker already
  // crossing finishes clearing it; route progress resumes when the job ends.
  if (!w.yielding && workerSegmentClear(w, w, nav.minerCorridor) && !workerSegmentClear(w, candidate, nav.minerCorridor)) return
  if (gap > 0) { w.xM += (next.xM - w.xM) * step / gap; w.zM += (next.zM - w.zM) * step / gap }
  w.moving = step > 0; w.wheelSpin += (reverse ? -step : step) / (.23 * WORKER_SCALE_M)
  if (gap <= step + 1e-8) {
    w.path.shift()
    if (!w.path.length && !w.yielding) {
      w.task = w.task === 'returning' ? 'servicing' : 'working'; w.dwell = 1.8; nav.trafficRevision++
    }
  }
}
