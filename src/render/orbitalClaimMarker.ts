/**
 * Screen-space readability rules shared by the two orbital claim markers.
 *
 * The authored surface hardware is sized in world units, so at orbital
 * distance it projects to a handful of pixels, and a marker sitting near the
 * limb presents its surface-tangent ring edge-on. These helpers keep a
 * camera-facing beacon inside a restrained pixel band, retire that beacon once
 * the hardware reads on its own, and keep the tap target tied to whatever the
 * player can actually see. Nothing here touches lunar coordinates: the beacon
 * is a derived view of the same saved site.
 */

export const ORBITAL_CLAIM_MARKER = Object.freeze({
  /** The beacon ring is drawn around the hardware, never instead of it. */
  beaconHardwareRatio: 2.6,
  /** Restrained band, in CSS pixels, for the beacon ring diameter. */
  minimumBeaconPx: 30,
  maximumBeaconPx: 56,
  /** Wider floor reserved for the TWO CLAIMS DETECTED beat. */
  emphasisBeaconPx: 38,
  /** The beacon fades out once the hardware itself is legible. */
  beaconFadeStartPx: 58,
  beaconFadeEndPx: 124,
  /** Tap target band, in CSS pixels, matching the visible footprint. */
  touchFootprintRatio: 1.45,
  minimumTouchPx: 44,
  maximumTouchPx: 72,
  /** Cosine band used to fade a claim out as it crosses the limb. */
  horizonFadeBand: 0.05,
  /** Matches the long-standing click-side horizon tolerance. */
  horizonTolerance: 0.0004,
})

/**
 * The authored world-space sizing of each marker's surface hardware, kept here
 * so the screen-space rules above can be reasoned about — and tested — against
 * the sizes the scene actually draws.
 */
export const CLAIM_HARDWARE = Object.freeze({
  outpost: Object.freeze({
    /** Widest authored silhouette: the ground ring plus its tube. */
    unitDiameter: 1.61,
    minimumScale: 0.013,
    maximumScale: 0.021,
    idleDistanceScale: 0.0046,
    activeDistanceScale: 0.0052,
  }),
  rival: Object.freeze({
    /** Widest authored silhouette: the broken crown spread. */
    unitDiameter: 1.36,
    minimumScale: 0.013,
    maximumScale: 0.023,
    distanceScale: 0.0052,
  }),
})

/** Distance-proportional world scale, bounded so close views stay physical. */
export function claimHardwareScale(
  distance: number,
  minimumScale: number,
  maximumScale: number,
  distanceScale: number,
): number {
  return Math.max(
    minimumScale,
    Math.min(maximumScale, distance * distanceScale),
  )
}

export const CLAIM_RELATIONSHIP_ARC = Object.freeze({
  /** Moon-centred radius of the arc endpoints. */
  baseRadius: 1.004,
  /** Additional outward lift at the midpoint, so the arc clears the limb. */
  midpointLift: 0.055,
  tubeRadius: 0.004,
  tubularSegments: 72,
  radialSegments: 3,
  maximumOpacity: 0.3,
  fadeInProgress: 0.22,
  // The player's claim only crests the limb late in the beat, so the arc holds
  // until both claims have read together, then dissolves into orbit.
  fadeOutProgress: 0.88,
})

export interface ScreenProjection {
  /** Camera-to-marker distance in render units. */
  readonly distance: number
  readonly verticalFovDeg: number
  /** Canvas height in CSS pixels. */
  readonly viewportHeightPx: number
}

export interface Vec3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface ClaimMarkerReadout {
  /** Projected diameter of the authored surface hardware. */
  readonly hardwareDiameterPx: number
  /** Projected diameter of the camera-facing beacon ring. */
  readonly beaconDiameterPx: number
  /** World diameter to scale a unit-diameter beacon ring by. */
  readonly beaconWorldDiameter: number
  /** Outward offset that keeps the billboarded ring clear of the surface. */
  readonly beaconSurfaceOffset: number
  readonly beaconOpacity: number
  readonly touchDiameterPx: number
  readonly touchWorldRadius: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function smoothstep(value: number, edge0: number, edge1: number): number {
  if (edge1 <= edge0) {
    return value < edge0 ? 0 : 1
  }

  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** CSS pixels covered by one render unit at the given distance. */
export function pixelsPerWorldUnit(projection: ScreenProjection): number {
  const { distance, verticalFovDeg, viewportHeightPx } = projection

  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(viewportHeightPx) ||
    viewportHeightPx <= 0 ||
    !Number.isFinite(verticalFovDeg) ||
    verticalFovDeg <= 0 ||
    verticalFovDeg >= 180
  ) {
    return 0
  }

  return (
    viewportHeightPx /
    (2 * distance * Math.tan((verticalFovDeg * Math.PI) / 360))
  )
}

export function screenPixelsForWorldSize(
  worldSize: number,
  projection: ScreenProjection,
): number {
  return worldSize * pixelsPerWorldUnit(projection)
}

export function worldSizeForScreenPixels(
  pixels: number,
  projection: ScreenProjection,
): number {
  const density = pixelsPerWorldUnit(projection)
  return density <= 0 ? 0 : pixels / density
}

/** The beacon tracks the hardware, then holds a readable floor and a cap. */
export function claimBeaconDiameterPx(
  hardwareDiameterPx: number,
  emphasised: boolean,
): number {
  const floor = emphasised
    ? ORBITAL_CLAIM_MARKER.emphasisBeaconPx
    : ORBITAL_CLAIM_MARKER.minimumBeaconPx

  return clamp(
    hardwareDiameterPx * ORBITAL_CLAIM_MARKER.beaconHardwareRatio,
    floor,
    ORBITAL_CLAIM_MARKER.maximumBeaconPx,
  )
}

/** Once the hardware is large enough to read, the beacon gets out of the way. */
export function claimBeaconOpacity(hardwareDiameterPx: number): number {
  return (
    1 -
    smoothstep(
      hardwareDiameterPx,
      ORBITAL_CLAIM_MARKER.beaconFadeStartPx,
      ORBITAL_CLAIM_MARKER.beaconFadeEndPx,
    )
  )
}

/** The tap target follows the larger of the two drawn footprints. */
export function claimTouchDiameterPx(
  hardwareDiameterPx: number,
  beaconDiameterPx: number,
): number {
  return clamp(
    Math.max(hardwareDiameterPx, beaconDiameterPx) *
      ORBITAL_CLAIM_MARKER.touchFootprintRatio,
    ORBITAL_CLAIM_MARKER.minimumTouchPx,
    ORBITAL_CLAIM_MARKER.maximumTouchPx,
  )
}

/**
 * Resolves every per-frame screen-space value for one claim marker.
 *
 * `hardwareWorldDiameter` is the already-scaled world diameter of the authored
 * surface hardware, so this stays agnostic about each marker's own silhouette.
 */
export function resolveClaimMarkerReadout(
  hardwareWorldDiameter: number,
  projection: ScreenProjection,
  emphasised = false,
): ClaimMarkerReadout {
  const hardwareDiameterPx = screenPixelsForWorldSize(
    hardwareWorldDiameter,
    projection,
  )
  const beaconDiameterPx = claimBeaconDiameterPx(
    hardwareDiameterPx,
    emphasised,
  )
  const beaconWorldDiameter = worldSizeForScreenPixels(
    beaconDiameterPx,
    projection,
  )
  const touchDiameterPx = claimTouchDiameterPx(
    hardwareDiameterPx,
    beaconDiameterPx,
  )

  return {
    hardwareDiameterPx,
    beaconDiameterPx,
    beaconWorldDiameter,
    // A camera-facing disc of radius r lifted r along the surface normal never
    // dips below the local tangent plane, so it cannot clip the Moon.
    beaconSurfaceOffset: beaconWorldDiameter * 0.52,
    beaconOpacity: claimBeaconOpacity(hardwareDiameterPx),
    touchDiameterPx,
    touchWorldRadius: worldSizeForScreenPixels(touchDiameterPx, projection) / 2,
  }
}

/**
 * The long-standing selection test: a claim may be picked only while it sits
 * above the camera's horizon on the near side of the Moon.
 */
export function claimFacesCamera(
  sitePosition: Vec3Like,
  cameraPosition: Vec3Like,
  tolerance = ORBITAL_CLAIM_MARKER.horizonTolerance,
): boolean {
  const dot =
    sitePosition.x * cameraPosition.x +
    sitePosition.y * cameraPosition.y +
    sitePosition.z * cameraPosition.z
  const lengthSq =
    sitePosition.x * sitePosition.x +
    sitePosition.y * sitePosition.y +
    sitePosition.z * sitePosition.z

  return dot > lengthSq - tolerance
}

/**
 * Drawn-side companion to `claimFacesCamera`: a short fade so a claim does not
 * pop as it crosses the limb, reaching zero exactly where picking stops.
 */
export function claimHorizonVisibility(
  sitePosition: Vec3Like,
  cameraPosition: Vec3Like,
  tolerance = ORBITAL_CLAIM_MARKER.horizonTolerance,
): number {
  const dot =
    sitePosition.x * cameraPosition.x +
    sitePosition.y * cameraPosition.y +
    sitePosition.z * cameraPosition.z
  const lengthSq =
    sitePosition.x * sitePosition.x +
    sitePosition.y * sitePosition.y +
    sitePosition.z * sitePosition.z
  const cameraLength = Math.hypot(
    cameraPosition.x,
    cameraPosition.y,
    cameraPosition.z,
  )
  const siteLength = Math.sqrt(lengthSq)

  if (siteLength <= 0 || cameraLength <= 0) {
    return 0
  }

  if (dot <= lengthSq - tolerance) {
    return 0
  }

  const margin = (dot - (lengthSq - tolerance)) / (siteLength * cameraLength)
  return smoothstep(margin, 0, ORBITAL_CLAIM_MARKER.horizonFadeBand)
}

/** Trapezoidal fade for the TWO CLAIMS DETECTED relationship arc. */
export function claimRelationshipArcOpacity(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    return 0
  }

  const rampIn = smoothstep(progress, 0, CLAIM_RELATIONSHIP_ARC.fadeInProgress)
  const rampOut =
    1 - smoothstep(progress, CLAIM_RELATIONSHIP_ARC.fadeOutProgress, 1)

  return CLAIM_RELATIONSHIP_ARC.maximumOpacity * Math.min(rampIn, rampOut)
}

/** Restrained two-beat swell used only while a reveal is emphasising a claim. */
export function claimEmphasisPulse(elapsedSeconds: number): number {
  const eased = smoothstep(elapsedSeconds, 0, 0.45)
  return eased * (0.5 + 0.5 * Math.sin(elapsedSeconds * 3.4 - Math.PI / 2))
}
