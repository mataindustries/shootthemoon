import { DEPOSIT_BLUEPRINTS, type LocalSurfacePosition } from '../domain/outpost.ts'

/**
 * Composition solver for the first mining beat.
 *
 * The hero of this shot is the triad MINER -> ORE -> LASER CONTACT. The pose is
 * derived from where those three points actually are and how much of the canvas
 * the HUD is currently covering, instead of from fixed offsets tuned against one
 * viewport and an operations panel that is not mounted during the first job.
 */

/** Rover roof, in local metres above the sampled ground. */
const MINER_HEIGHT_M = 1.42
/** Tallest crystal in a full-yield cluster, in local metres above the ground. */
const DEPOSIT_HEIGHT_M = 2.35
/** Where the beam meets the regolith, ahead of the parked rover. */
export const LASER_CONTACT_STANDOFF_M = 1.92
/**
 * Half-extents of each silhouette, so bodies rather than bare anchor points
 * stay framed. The beam contact is a few centimetres across and must not be
 * padded like a rover, or it pushes a narrow frame much further back than the
 * composition needs.
 */
const MINER_PADDING_M = 1.35
const DEPOSIT_PADDING_M = 1.15
const CONTACT_PADDING_M = 0.4
const VERTICAL_PADDING_M = 0.45

/** Local-metre bounds on the solved standoff. Keeps the shot spatial. */
const MINIMUM_DISTANCE_M = 11
const MAXIMUM_DISTANCE_M = 24
/** How far the top of the frame must stay below the horizon. */
const HORIZON_MARGIN_RAD = 0.12
/** Steepest pitch allowed, short of a top-down map view. */
const MAXIMUM_ELEVATION_RAD = 0.95

export interface SurfaceSafeArea {
  /** Fraction of canvas height obscured by HUD chrome at the top. */
  readonly top: number
  /** Fraction obscured at the bottom, counting only the centre column. */
  readonly bottom: number
}

export const FULL_SAFE_AREA: SurfaceSafeArea = { top: 0, bottom: 0 }

export interface MiningFramingInput {
  readonly miner: LocalSurfacePosition
  readonly deposit: LocalSurfacePosition
  /** Rover heading, used for the beam contact point. */
  readonly headingRad: number
  /** Canvas aspect (width / height). */
  readonly aspect: number
  /** Vertical field of view the focus settles on, in degrees. */
  readonly fovDeg: number
  readonly safeArea: SurfaceSafeArea
}

export interface MiningFraming {
  /** Camera offset from the framed ground point, in local metres. */
  readonly offsetXM: number
  readonly offsetYM: number
  readonly offsetZM: number
  /** The framed ground point, in local metres. */
  readonly focusXM: number
  readonly focusZM: number
  /** Vertical offset applied to the look-at point, in local metres. */
  readonly targetLiftM: number
  /** Solved standoff, exposed for tests and scatter suppression. */
  readonly distanceM: number
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function mix(low: number, high: number, amount: number): number {
  return low + (high - low) * amount
}

/**
 * Portrait needs a different framing axis, not just a different FOV. A pure
 * side view spends its whole budget on width, which is exactly what a 390px
 * frame lacks, so the camera swings toward the rover's quarter-rear as the
 * frame narrows. The pair then reads diagonally across a tall frame while the
 * muzzle and the contact stay on the camera side of the chassis.
 */
export function framingNarrowness(aspect: number): number {
  return clamp((1.6 - aspect) / (1.6 - 0.55), 0, 1)
}

export function laserContactPosition(
  miner: LocalSurfacePosition,
  headingRad: number,
): LocalSurfacePosition {
  return {
    xM: miner.xM + Math.sin(headingRad) * LASER_CONTACT_STANDOFF_M,
    zM: miner.zM + Math.cos(headingRad) * LASER_CONTACT_STANDOFF_M,
  }
}

export function solveMiningFraming({
  miner,
  deposit,
  headingRad,
  aspect,
  fovDeg,
  safeArea,
}: MiningFramingInput): MiningFraming {
  const contact = laserContactPosition(miner, headingRad)
  // Frame the whole triad, weighted so the ore and the contact sit central and
  // the rover reads as the actor entering from the side.
  const focusXM = miner.xM * 0.36 + deposit.xM * 0.4 + contact.xM * 0.24
  const focusZM = miner.zM * 0.36 + deposit.zM * 0.4 + contact.zM * 0.24

  const spanX = deposit.xM - miner.xM
  const spanZ = deposit.zM - miner.zM
  const span = Math.max(0.001, Math.hypot(spanX, spanZ))
  const beamX = spanX / span
  const beamZ = spanZ / span
  // Keep the camera on the rover's right, as the settled shot already does.
  const rightX = beamZ
  const rightZ = -beamX

  const narrow = framingNarrowness(aspect)
  const swingRad = mix(0.2, 0.62, narrow)
  const baseElevationRad = mix(0.58, 0.68, narrow)
  const fillX = mix(0.68, 0.84, narrow)
  const fillY = 0.6

  const swungX = rightX * Math.cos(swingRad) - beamX * Math.sin(swingRad)
  const swungZ = rightZ * Math.cos(swingRad) - beamZ * Math.sin(swingRad)
  const swungLength = Math.max(0.001, Math.hypot(swungX, swungZ))
  const horizontalX = swungX / swungLength
  const horizontalZ = swungZ / swungLength

  const anchors: readonly (readonly [number, number, number, number])[] = [
    [miner.xM - focusXM, MINER_HEIGHT_M, miner.zM - focusZM, MINER_PADDING_M],
    [
      deposit.xM - focusXM,
      DEPOSIT_HEIGHT_M,
      deposit.zM - focusZM,
      DEPOSIT_PADDING_M,
    ],
    [contact.xM - focusXM, 0.12, contact.zM - focusZM, CONTACT_PADDING_M],
  ]

  // Usable band, in NDC, after the HUD takes its share.
  const usableHalfHeight = Math.max(0.2, 1 - safeArea.top - safeArea.bottom)
  const usableCentreNdcY = safeArea.bottom - safeArea.top
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360)
  const halfFovRad = (fovDeg * Math.PI) / 360
  const horizontalAspect = Math.max(0.001, aspect)
  const horizontalLimit = fillX
  const verticalLimit = usableHalfHeight * fillY

  // Standoff, look-at height and pitch are coupled. Sliding the look-at point
  // up to seat the triad on the usable centre also tilts the camera up, and a
  // shot that tilts past its own horizon fills the space it just freed with the
  // far deposit field instead of ground. So the pitch is steepened by whatever
  // the lift costs, and all three are solved together by fixed point.
  let distanceM = 14
  let targetLiftM = 0
  let elevationRad = baseElevationRad
  let offsetDirX = 0
  let offsetDirY = 0
  let offsetDirZ = 0

  for (let pass = 0; pass < 8; pass += 1) {
    elevationRad = clamp(
      Math.max(
        baseElevationRad,
        halfFovRad + HORIZON_MARGIN_RAD + Math.atan2(
          Math.max(0, targetLiftM),
          Math.max(1, distanceM),
        ),
      ),
      baseElevationRad,
      MAXIMUM_ELEVATION_RAD,
    )
    // offsetDir points from the focus to the camera.
    const cosElevation = Math.cos(elevationRad)
    offsetDirX = horizontalX * cosElevation
    offsetDirY = Math.sin(elevationRad)
    offsetDirZ = horizontalZ * cosElevation
    // right = normalize(cross(forward, worldUp)) with forward = -offsetDir.
    const rawRightLength = Math.max(0.001, Math.hypot(offsetDirZ, offsetDirX))
    const unitRightX = offsetDirZ / rawRightLength
    const unitRightZ = -offsetDirX / rawRightLength
    // up = cross(right, forward)
    const cameraUpX = unitRightZ * offsetDirY
    const cameraUpY = unitRightX * offsetDirZ - unitRightZ * offsetDirX
    const cameraUpZ = -unitRightX * offsetDirY
    // Camera-space offsets are fixed for a pitch; only depth follows distance.
    const projected = anchors.map(([ax, ay, az, padding]) => ({
      right: ax * unitRightX + az * unitRightZ,
      up: ax * cameraUpX + ay * cameraUpY + az * cameraUpZ,
      towardCamera: ax * offsetDirX + ay * offsetDirY + az * offsetDirZ,
      padding,
    }))
    const depths = projected.map((anchor) =>
      Math.max(1, distanceM - anchor.towardCamera),
    )
    // Padded NDC extents at zero lift, plus how fast each moves with the lift.
    const tops = projected.map(
      (anchor, index) =>
        (anchor.up + VERTICAL_PADDING_M) / (depths[index]! * tanHalfFov),
    )
    const bottoms = projected.map(
      (anchor, index) =>
        (anchor.up - VERTICAL_PADDING_M) / (depths[index]! * tanHalfFov),
    )
    const slopes = depths.map(
      (depth) => Math.max(0.2, cameraUpY) / (depth * tanHalfFov),
    )
    let topIndex = 0
    let bottomIndex = 0

    for (let index = 1; index < projected.length; index += 1) {
      if (tops[index]! > tops[topIndex]!) topIndex = index
      if (bottoms[index]! < bottoms[bottomIndex]!) bottomIndex = index
    }

    // Put the triad's vertical midpoint on the centre of whatever the HUD
    // leaves free, rather than on the geometric centre of the canvas.
    targetLiftM =
      (tops[topIndex]! + bottoms[bottomIndex]! - 2 * usableCentreNdcY) /
      (slopes[topIndex]! + slopes[bottomIndex]!)
    const halfSpreadY =
      (tops[topIndex]! -
        slopes[topIndex]! * targetLiftM -
        (bottoms[bottomIndex]! - slopes[bottomIndex]! * targetLiftM)) /
      2
    let halfSpreadX = 0

    for (let index = 0; index < projected.length; index += 1) {
      halfSpreadX = Math.max(
        halfSpreadX,
        (Math.abs(projected[index]!.right) + projected[index]!.padding) /
          (depths[index]! * tanHalfFov * horizontalAspect),
      )
    }

    const overflow = Math.max(
      halfSpreadY / verticalLimit,
      halfSpreadX / horizontalLimit,
    )
    distanceM = clamp(
      distanceM * overflow,
      MINIMUM_DISTANCE_M,
      MAXIMUM_DISTANCE_M,
    )
  }

  return {
    offsetXM: offsetDirX * distanceM,
    offsetYM: offsetDirY * distanceM,
    offsetZM: offsetDirZ * distanceM,
    focusXM,
    focusZM,
    targetLiftM,
    distanceM,
  }
}

/**
 * Deterministic mining pose for a deposit, used by callers that need the shot
 * before the camera adopts it: the travel arrival blend, and the foreground
 * scatter suppression volume.
 */
export function miningFramingForDeposit(
  depositId: string | null,
  minerPosition: LocalSurfacePosition,
  headingRad: number,
  aspect: number,
  fovDeg: number,
  safeArea: SurfaceSafeArea,
): MiningFraming | null {
  const blueprint =
    depositId === null
      ? undefined
      : DEPOSIT_BLUEPRINTS.find((candidate) => candidate.id === depositId)

  if (blueprint === undefined) {
    return null
  }

  return solveMiningFraming({
    miner: minerPosition,
    deposit: blueprint.position,
    headingRad,
    aspect,
    fovDeg,
    safeArea,
  })
}
