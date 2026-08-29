import { MathUtils, Vector3 } from 'three'

const DIRECTION_EPSILON = 1e-10
const RADIUS_EPSILON = 1e-9

export type OrbitalPathTiming =
  | 'balanced'
  | 'climb-before-arc'
  | 'arc-before-descent'

export interface CameraPose {
  readonly position: Vector3
  readonly target: Vector3
  readonly up: Vector3
}

export interface SafeOrbitalCameraPathOptions {
  readonly start: CameraPose
  readonly end: CameraPose
  /** Absolute Moon-centred radius, not altitude above the surface. */
  readonly minimumRadius: number
  readonly timing?: OrbitalPathTiming
  /** Optional outward elevation added between the exact endpoints. */
  readonly arcHeight?: number
  /** Optional unit-ish direction used to resolve or bias ambiguous arcs. */
  readonly preferredArcDirection?: Vector3
  /** Optional direction that the angular route must pass through. */
  readonly waypointDirection?: Vector3 | null
}

export interface SafeOrbitalCameraSample {
  readonly position: Vector3
  readonly target: Vector3
  readonly up: Vector3
}

export interface SafeOrbitalCameraPath {
  readonly start: CameraPose
  readonly end: CameraPose
  readonly minimumRadius: number
  readonly timing: OrbitalPathTiming
  readonly arcHeight: number
  getPoint(progress: number, target?: Vector3): Vector3
  sample(
    progress: number,
    positionTarget?: Vector3,
    lookTarget?: Vector3,
    upTarget?: Vector3,
  ): SafeOrbitalCameraSample
}

interface ProgressChannels {
  readonly angular: number
  readonly radial: number
  readonly target: number
}

function clampProgress(progress: number): number {
  return MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1)
}

function smootherstep(progress: number): number {
  const clamped = clampProgress(progress)
  return (
    clamped *
    clamped *
    clamped *
    (clamped * (clamped * 6 - 15) + 10)
  )
}

function deterministicPerpendicular(
  direction: Vector3,
  preferredDirection?: Vector3,
): Vector3 {
  if (preferredDirection !== undefined) {
    const projected = preferredDirection
      .clone()
      .addScaledVector(direction, -preferredDirection.dot(direction))

    if (projected.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON) {
      return projected.normalize()
    }
  }

  const absoluteX = Math.abs(direction.x)
  const absoluteY = Math.abs(direction.y)
  const absoluteZ = Math.abs(direction.z)
  const leastAlignedAxis =
    absoluteX <= absoluteY && absoluteX <= absoluteZ
      ? new Vector3(1, 0, 0)
      : absoluteY <= absoluteZ
        ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1)

  return leastAlignedAxis
    .addScaledVector(direction, -leastAlignedAxis.dot(direction))
    .normalize()
}

function normalizedDirection(
  vector: Vector3,
  fallback?: Vector3,
): Vector3 {
  if (vector.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON) {
    return vector.clone().normalize()
  }

  if (
    fallback !== undefined &&
    fallback.lengthSq() > DIRECTION_EPSILON * DIRECTION_EPSILON
  ) {
    return fallback.clone().normalize()
  }

  return new Vector3(0, 0, 1)
}

/**
 * Stable unit-vector interpolation. Longitude never enters this calculation,
 * and exact antipodes use a deterministic, optionally illuminated tangent.
 */
export function slerpUnitDirections(
  start: Vector3,
  end: Vector3,
  progress: number,
  preferredDirection?: Vector3,
  target = new Vector3(),
): Vector3 {
  const t = clampProgress(progress)
  const from = normalizedDirection(start, end)
  const to = normalizedDirection(end, from)

  if (t === 0) {
    return target.copy(from)
  }

  if (t === 1) {
    return target.copy(to)
  }

  const cosine = MathUtils.clamp(from.dot(to), -1, 1)

  if (cosine > 1 - DIRECTION_EPSILON) {
    return target.copy(from).lerp(to, t).normalize()
  }

  const angle = Math.acos(cosine)
  const tangent = to.clone().addScaledVector(from, -cosine)

  if (tangent.lengthSq() <= DIRECTION_EPSILON * DIRECTION_EPSILON) {
    tangent.copy(deterministicPerpendicular(from, preferredDirection))
  } else {
    tangent.normalize()
  }

  return target
    .copy(from)
    .multiplyScalar(Math.cos(angle * t))
    .addScaledVector(tangent, Math.sin(angle * t))
    .normalize()
}

function safePose(
  pose: CameraPose,
  minimumRadius: number,
  fallbackDirection: Vector3,
): CameraPose {
  const direction = normalizedDirection(pose.position, fallbackDirection)
  const radius = Math.max(minimumRadius, pose.position.length())

  return {
    position: direction.multiplyScalar(radius),
    target: pose.target.clone(),
    up: normalizedDirection(pose.up, new Vector3(0, 1, 0)),
  }
}

function getProgressChannels(
  progress: number,
  timing: OrbitalPathTiming,
): ProgressChannels {
  const t = clampProgress(progress)

  if (timing === 'climb-before-arc') {
    return {
      radial: smootherstep(t / 0.58),
      angular: smootherstep((t - 0.12) / 0.88),
      target: smootherstep((t - 0.08) / 0.92),
    }
  }

  if (timing === 'arc-before-descent') {
    return {
      angular: smootherstep(t / 0.76),
      target: smootherstep(t / 0.84),
      radial: smootherstep((t - 0.18) / 0.82),
    }
  }

  const eased = smootherstep(t)
  return { angular: eased, radial: eased, target: eased }
}

function angularDistance(first: Vector3, second: Vector3): number {
  return Math.acos(
    MathUtils.clamp(
      normalizedDirection(first).dot(normalizedDirection(second)),
      -1,
      1,
    ),
  )
}

function sampleAngularRoute(
  start: Vector3,
  end: Vector3,
  waypoint: Vector3 | null,
  progress: number,
  preferredDirection: Vector3 | undefined,
  target: Vector3,
): Vector3 {
  if (waypoint === null) {
    return slerpUnitDirections(
      start,
      end,
      progress,
      preferredDirection,
      target,
    )
  }

  const firstLength = angularDistance(start, waypoint)
  const secondLength = angularDistance(waypoint, end)
  const totalLength = firstLength + secondLength

  if (totalLength <= DIRECTION_EPSILON) {
    return target.copy(start)
  }

  const firstShare = firstLength / totalLength

  if (progress <= firstShare) {
    return slerpUnitDirections(
      start,
      waypoint,
      firstShare <= DIRECTION_EPSILON ? 1 : progress / firstShare,
      preferredDirection,
      target,
    )
  }

  return slerpUnitDirections(
    waypoint,
    end,
    secondLength <= DIRECTION_EPSILON
      ? 1
      : (progress - firstShare) / (1 - firstShare),
    preferredDirection,
    target,
  )
}

export function createSafeOrbitalCameraPath(
  options: SafeOrbitalCameraPathOptions,
): SafeOrbitalCameraPath {
  if (
    !Number.isFinite(options.minimumRadius) ||
    options.minimumRadius <= 0
  ) {
    throw new RangeError('minimumRadius must be positive and finite.')
  }

  const arcHeight = options.arcHeight ?? 0

  if (!Number.isFinite(arcHeight) || arcHeight < 0) {
    throw new RangeError('arcHeight must be finite and non-negative.')
  }

  const preferredDirection = options.preferredArcDirection?.clone().normalize()
  const fallbackDirection =
    preferredDirection ?? normalizedDirection(options.end.position)
  const start = safePose(
    options.start,
    options.minimumRadius,
    fallbackDirection,
  )
  const end = safePose(options.end, options.minimumRadius, start.position)
  const startDirection = start.position.clone().normalize()
  const endDirection = end.position.clone().normalize()
  const waypoint =
    options.waypointDirection === undefined ||
    options.waypointDirection === null
      ? null
      : normalizedDirection(options.waypointDirection, preferredDirection)
  const timing = options.timing ?? 'balanced'
  const temporaryDirection = new Vector3()

  const getPoint = (progress: number, target = new Vector3()): Vector3 => {
    const clamped = clampProgress(progress)

    if (clamped === 0) {
      return target.copy(start.position)
    }

    if (clamped === 1) {
      return target.copy(end.position)
    }

    const channels = getProgressChannels(clamped, timing)
    sampleAngularRoute(
      startDirection,
      endDirection,
      waypoint,
      channels.angular,
      preferredDirection,
      temporaryDirection,
    )
    const radius =
      MathUtils.lerp(
        start.position.length(),
        end.position.length(),
        channels.radial,
      ) + Math.sin(Math.PI * smootherstep(clamped)) * arcHeight

    return target
      .copy(temporaryDirection)
      .multiplyScalar(Math.max(options.minimumRadius, radius))
  }

  const sample = (
    progress: number,
    positionTarget = new Vector3(),
    lookTarget = new Vector3(),
    upTarget = new Vector3(),
  ): SafeOrbitalCameraSample => {
    const clamped = clampProgress(progress)
    const channels = getProgressChannels(clamped, timing)
    getPoint(clamped, positionTarget)
    lookTarget.copy(start.target).lerp(end.target, channels.target)
    slerpUnitDirections(
      start.up,
      end.up,
      channels.target,
      preferredDirection,
      upTarget,
    )

    return {
      position: positionTarget,
      target: lookTarget,
      up: upTarget,
    }
  }

  return {
    start,
    end,
    minimumRadius: options.minimumRadius,
    timing,
    arcHeight,
    getPoint,
    sample,
  }
}

/** Returns the lowest Moon-centred radius observed at evenly spaced samples. */
export function sampleMinimumCameraRadius(
  path: SafeOrbitalCameraPath,
  sampleCount = 512,
): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('sampleCount must be a positive integer.')
  }

  const point = new Vector3()
  let minimum = Number.POSITIVE_INFINITY

  for (let index = 0; index <= sampleCount; index += 1) {
    minimum = Math.min(
      minimum,
      path.getPoint(index / sampleCount, point).length(),
    )
  }

  return minimum
}

/**
 * Produces a modestly sun-biased waypoint without turning a short route into a
 * confusing long-way-around arc.
 */
export function createIlluminatedArcWaypoint(
  startDirection: Vector3,
  endDirection: Vector3,
  illuminatedDirection: Vector3,
  maximumDetourRad = MathUtils.degToRad(28),
): Vector3 {
  const start = normalizedDirection(startDirection)
  const end = normalizedDirection(endDirection, start)
  const light = normalizedDirection(illuminatedDirection, start)
  const midpoint = slerpUnitDirections(start, end, 0.5, light)
  const directLength = angularDistance(start, end)

  for (const lightWeight of [0.72, 0.5, 0.32, 0.16, 0] as const) {
    const candidate = midpoint
      .clone()
      .multiplyScalar(1 - lightWeight)
      .addScaledVector(light, lightWeight)

    if (candidate.lengthSq() <= DIRECTION_EPSILON * DIRECTION_EPSILON) {
      continue
    }

    candidate.normalize()
    const routedLength =
      angularDistance(start, candidate) + angularDistance(candidate, end)

    if (routedLength <= directLength + maximumDetourRad + RADIUS_EPSILON) {
      return candidate
    }
  }

  return midpoint
}
