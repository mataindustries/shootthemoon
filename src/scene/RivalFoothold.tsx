import {
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Group,
  Quaternion,
  Vector3,
} from 'three'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import type {
  RivalSignalSnapshot,
  RivalStage,
} from '../domain/rival.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_HALF_SIZE_M,
} from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  maximumRenderedSurfaceHeight,
  sampleRenderedSurface,
} from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { calculatePermanentScarFloorHeight } from './PermanentLunarScar.tsx'
import { VesperCitadel } from './VesperCitadel.tsx'
import { VesperCitadelWreck } from './VesperCitadelWreck.tsx'
import {
  CITADEL_WRECK_FOUNDATION_BOTTOM,
  CITADEL_WRECK_FOUNDATION_TOP,
} from './vesperCitadelWreckGeometry.ts'

const RIVAL_FOUNDATION_RADIUS_MODEL = 7.15
const RIVAL_FOUNDATION_CENTER_Y_MODEL = 0.34
const RIVAL_FOUNDATION_HEIGHT_MODEL = 0.72
const RIVAL_FOCUSED_SCALE_MULTIPLIER = 1.2
const RIVAL_STRATEGIC_SCALE_MULTIPLIER = 2.05
const RIVAL_FOUNDATION_BOTTOM_MODEL =
  RIVAL_FOUNDATION_CENTER_Y_MODEL - RIVAL_FOUNDATION_HEIGHT_MODEL / 2

export const RIVAL_FOUNDATION_RADIUS_M =
  RIVAL_FOUNDATION_RADIUS_MODEL * RIVAL_STRATEGIC_SCALE_MULTIPLIER
export const RIVAL_FOUNDATION_CLEARANCE_M = 0.015

export type RivalGroundingMode = 'terrain' | 'scarred'

export interface RivalGrounding {
  readonly attachmentHeight: number
  readonly foundationBottomOffset: number
  readonly maximumSurfaceHeight: number
}

export function calculateRivalFoundationBottomOffset(
  focused: boolean,
): number {
  return (
    RIVAL_FOUNDATION_BOTTOM_MODEL *
    LOCAL_METRES_TO_RENDER_UNITS *
    (focused
      ? RIVAL_FOCUSED_SCALE_MULTIPLIER
      : RIVAL_STRATEGIC_SCALE_MULTIPLIER)
  )
}

export function calculateDamagedFoundationVerticalBounds(
  attachmentHeight: number,
  focused: boolean,
): Readonly<{ bottom: number; top: number }> {
  const visualScale =
    LOCAL_METRES_TO_RENDER_UNITS *
    (focused
      ? RIVAL_FOCUSED_SCALE_MULTIPLIER
      : RIVAL_STRATEGIC_SCALE_MULTIPLIER)

  // The wreck's sunk base terrace, before its small settle tilt.
  return {
    bottom: attachmentHeight + CITADEL_WRECK_FOUNDATION_BOTTOM * visualScale,
    top: attachmentHeight + CITADEL_WRECK_FOUNDATION_TOP * visualScale,
  }
}

export interface RivalSurfaceAttachment {
  readonly position: Vector3
  readonly orientation: Quaternion
  readonly up: Vector3
}

export interface RivalStageVisualProfile {
  readonly pylonCount: number
  readonly lightCount: number
  readonly buttressCount: number
  readonly mastHeightM: number
}

const LANDED_PROFILE: RivalStageVisualProfile = Object.freeze({
  pylonCount: 0,
  lightCount: 2,
  buttressCount: 0,
  mastHeightM: 4.8,
})
const ESTABLISHING_PROFILE: RivalStageVisualProfile = Object.freeze({
  pylonCount: 2,
  lightCount: 4,
  buttressCount: 0,
  mastHeightM: 8.5,
})
const FORTIFIED_PROFILE: RivalStageVisualProfile = Object.freeze({
  pylonCount: 3,
  lightCount: 6,
  buttressCount: 6,
  mastHeightM: 12,
})

function createFoundationFootprintSamples(
  segments: number,
): readonly Readonly<{ xM: number; zM: number }>[] {
  const safeSegments = Math.max(1, Math.floor(segments))
  const points: { xM: number; zM: number }[] = [{ xM: 0, zM: 0 }]
  const ringSampleCount = Math.max(64, safeSegments)

  for (const radiusScale of [0.25, 0.5, 0.75, 1]) {
    const radiusM = RIVAL_FOUNDATION_RADIUS_M * radiusScale

    for (let index = 0; index < ringSampleCount; index += 1) {
      const angle = (index / ringSampleCount) * Math.PI * 2
      points.push({
        xM: Math.cos(angle) * radiusM,
        zM: Math.sin(angle) * radiusM,
      })
    }
  }

  // A linear rendered triangle can only introduce an interior maximum at one
  // of its vertices. Include every production grid vertex under the circular
  // foundation in addition to the boundary/radial samples above.
  const cellSizeM = (LOCAL_SURFACE_HALF_SIZE_M * 2) / safeSegments

  for (let row = 0; row <= safeSegments; row += 1) {
    const zM = -LOCAL_SURFACE_HALF_SIZE_M + row * cellSizeM

    if (Math.abs(zM) > RIVAL_FOUNDATION_RADIUS_M) continue

    for (let column = 0; column <= safeSegments; column += 1) {
      const xM = -LOCAL_SURFACE_HALF_SIZE_M + column * cellSizeM

      if (Math.hypot(xM, zM) <= RIVAL_FOUNDATION_RADIUS_M) {
        points.push({ xM, zM })
      }
    }
  }

  return points
}

export function calculateRivalGrounding(
  terrain: SurfaceTerrainProfile,
  segments: number,
  mode: RivalGroundingMode = 'terrain',
): RivalGrounding {
  if (mode === 'scarred') {
    const renderedTerrainHeight = sampleRenderedSurface(
      terrain,
      segments,
      0,
      0,
    ).y
    const scarFloorHeight = calculatePermanentScarFloorHeight(
      renderedTerrainHeight,
    )

    return {
      attachmentHeight: scarFloorHeight,
      foundationBottomOffset: 0,
      maximumSurfaceHeight: scarFloorHeight,
    }
  }

  const footprint = createFoundationFootprintSamples(segments)
  const maximumSurfaceHeight = maximumRenderedSurfaceHeight(
    terrain,
    segments,
    footprint,
  )
  const foundationBottomOffset =
    calculateRivalFoundationBottomOffset(false)

  return {
    attachmentHeight:
      maximumSurfaceHeight -
      foundationBottomOffset +
      RIVAL_FOUNDATION_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS,
    foundationBottomOffset,
    maximumSurfaceHeight,
  }
}

export function getRivalStageVisualProfile(
  stage: RivalStage | null,
): RivalStageVisualProfile {
  switch (stage) {
    case 'FORTIFIED':
      return FORTIFIED_PROFILE
    case 'ESTABLISHING':
      return ESTABLISHING_PROFILE
    case 'LANDED':
    case null:
      return LANDED_PROFILE
  }
}

export function createRivalSurfaceAttachment(
  site: LandingSite,
  terrain: SurfaceTerrainProfile,
  segments: number,
  mode: RivalGroundingMode = 'terrain',
): RivalSurfaceAttachment {
  const transform = landingSiteToRenderTransform(site)
  const attachmentHeight = calculateRivalGrounding(
    terrain,
    segments,
    mode,
  ).attachmentHeight

  return {
    position: transform.position
      .clone()
      .addScaledVector(transform.up, attachmentHeight),
    orientation: transform.orientation.clone(),
    up: transform.up.clone(),
  }
}

export interface RivalFootholdProps {
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
  readonly focused: boolean
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly closeViewShadows?: boolean
  readonly damaged?: boolean
  readonly groundingMode?: RivalGroundingMode
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function footholdArrivalScale(
  presentation: RivalPresentationState,
  nowMs: number,
): number {
  if (presentation.phase === 'capsule-approach') {
    return 0
  }

  if (presentation.phase === 'impact') {
    const progress = getRivalPresentationProgress(presentation, nowMs)
    return smoothstep((progress - 0.08) / 0.42)
  }

  return 1
}


export function RivalFoothold({
  rival,
  presentation,
  focused,
  terrain,
  segments,
  closeViewShadows = false,
  damaged = false,
  groundingMode,
}: RivalFootholdProps) {
  const arrivalRef = useRef<Group>(null)
  const effectiveGroundingMode =
    groundingMode ?? (damaged ? 'scarred' : 'terrain')
  const grounding = useMemo(
    () => calculateRivalGrounding(terrain, segments, effectiveGroundingMode),
    [effectiveGroundingMode, segments, terrain],
  )
  const attachment = useMemo(
    () =>
      createRivalSurfaceAttachment(
        rival.site,
        terrain,
        segments,
        effectiveGroundingMode,
      ),
    [effectiveGroundingMode, rival.site, segments, terrain],
  )
  const profile = getRivalStageVisualProfile(rival.stage)
  const initialArrivalScale = footholdArrivalScale(
    presentation,
    performance.now(),
  )
  const visualScale =
    LOCAL_METRES_TO_RENDER_UNITS * RIVAL_STRATEGIC_SCALE_MULTIPLIER
  const shadowed = focused || closeViewShadows

  useFrame(() => {
    const arrival = arrivalRef.current

    if (arrival === null) {
      return
    }

    arrival.scale.setScalar(footholdArrivalScale(presentation, performance.now()))
  })

  if (damaged) {
    return (
      <group position={attachment.position} quaternion={attachment.orientation}>
        <group rotation-y={rival.surfaceHeadingRad} scale={visualScale}>
          <VesperCitadelWreck rival={rival} profile={profile} shadowed={shadowed} />
        </group>
      </group>
    )
  }

  return (
    <group position={attachment.position} quaternion={attachment.orientation}>
      <group rotation-y={rival.surfaceHeadingRad} scale={visualScale}>
        <group ref={arrivalRef} scale={initialArrivalScale}>
          <VesperCitadel
            rival={rival}
            profile={profile}
            phase={presentation.phase}
            terrain={terrain}
            segments={segments}
            attachmentHeight={grounding.attachmentHeight}
            visualScale={visualScale}
            shadowed={shadowed}
          />
        </group>
      </group>
    </group>
  )
}
