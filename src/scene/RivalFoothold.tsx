import {
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
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
import {
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import { calculatePermanentScarFloorHeight } from './PermanentLunarScar.tsx'
import { VesperCitadel } from './VesperCitadel.tsx'

const RIVAL_FOUNDATION_RADIUS_MODEL = 7.15
const RIVAL_FOUNDATION_CENTER_Y_MODEL = 0.34
const RIVAL_FOUNDATION_HEIGHT_MODEL = 0.72
const RIVAL_FOCUSED_SCALE_MULTIPLIER = 1.2
const RIVAL_STRATEGIC_SCALE_MULTIPLIER = 2.05
const DAMAGED_FOUNDATION_CENTER_Y_MODEL = 0
const DAMAGED_FOUNDATION_VERTICAL_SCALE = 0.34
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
  const halfHeight =
    (RIVAL_FOUNDATION_HEIGHT_MODEL / 2) *
    DAMAGED_FOUNDATION_VERTICAL_SCALE

  return {
    bottom:
      attachmentHeight +
      (DAMAGED_FOUNDATION_CENTER_Y_MODEL - halfHeight) * visualScale,
    top:
      attachmentHeight +
      (DAMAGED_FOUNDATION_CENTER_Y_MODEL + halfHeight) * visualScale,
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
  const identity = getRivalIdentity(rival.identityId)
  const profile = getRivalStageVisualProfile(rival.stage)
  const initialArrivalScale = footholdArrivalScale(
    presentation,
    performance.now(),
  )
  const visualScale =
    LOCAL_METRES_TO_RENDER_UNITS * RIVAL_STRATEGIC_SCALE_MULTIPLIER
  const shadowed = focused || closeViewShadows

  // The wreck keeps the First Strike debris kit; the intact headquarters is
  // the Vesper citadel below.
  const foundationGeometry = useMemo(
    () => new CylinderGeometry(6.25, 7.15, 0.72, 7),
    [],
  )
  const commandGeometry = useMemo(() => new ConeGeometry(2.35, 8.4, 5), [])
  const wellGeometry = useMemo(
    () => new CylinderGeometry(1.62, 2.08, 0.62, 8),
    [],
  )
  const sensorGeometry = useMemo(() => new OctahedronGeometry(0.74, 0), [])
  const pylonGeometry = useMemo(() => new BoxGeometry(0.72, 7.2, 0.92), [])
  const crownGeometry = useMemo(() => new BoxGeometry(0.74, 4.7, 1.12), [])

  const skeletonMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalSkeleton,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
    [],
  )
  const frameMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalFrame,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
    [],
  )
  const panelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        emissive: identity.palette.signal,
        emissiveIntensity: 0.18,
        ...MATERIAL_RESPONSE.rivalPanel,
      }),
    [identity.palette.signal],
  )
  const contactMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.contactDark,
        ...MATERIAL_RESPONSE.contact,
      }),
    [],
  )

  useEffect(
    () => () => {
      foundationGeometry.dispose()
      commandGeometry.dispose()
      wellGeometry.dispose()
      sensorGeometry.dispose()
      pylonGeometry.dispose()
      crownGeometry.dispose()
      skeletonMaterial.dispose()
      frameMaterial.dispose()
      panelMaterial.dispose()
      contactMaterial.dispose()
    },
    [
      commandGeometry,
      contactMaterial,
      crownGeometry,
      foundationGeometry,
      frameMaterial,
      panelMaterial,
      pylonGeometry,
      sensorGeometry,
      skeletonMaterial,
      wellGeometry,
    ],
  )

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
          <mesh
            castShadow={shadowed}
            geometry={foundationGeometry}
            material={contactMaterial}
            position={[0.2, DAMAGED_FOUNDATION_CENTER_Y_MODEL, 0.15]}
            receiveShadow={shadowed}
            rotation={[0.08, -0.12, 0.06]}
            scale={[1, DAMAGED_FOUNDATION_VERTICAL_SCALE, 0.9]}
          />
          <mesh
            castShadow={shadowed}
            geometry={commandGeometry}
            material={skeletonMaterial}
            position={[-3.4, 1.1, 1.45]}
            rotation={[0.28, -0.22, 1.18]}
            scale={[0.96, 0.72, 1]}
          />
          <mesh
            castShadow={shadowed}
            geometry={wellGeometry}
            material={frameMaterial}
            position={[0.36, -0.05, -1.05]}
            rotation={[0.12, 0.48, -0.24]}
            scale={[1, 0.48, 0.84]}
          />
          <mesh
            castShadow={shadowed}
            geometry={pylonGeometry}
            material={skeletonMaterial}
            position={[2.7, 0.62, 3.25]}
            rotation={[0.12, -0.62, 1.3]}
            scale={[0.78, 0.58, 0.76]}
          />
          <mesh
            castShadow={shadowed}
            geometry={pylonGeometry}
            material={frameMaterial}
            position={[-1.35, 0.2, -4.35]}
            rotation={[-0.16, 0.42, -1.4]}
            scale={[0.58, 0.46, 0.58]}
          />
          <mesh
            castShadow={shadowed}
            geometry={crownGeometry}
            material={skeletonMaterial}
            position={[-4.4, 0.55, -1.7]}
            rotation={[0.22, 0.48, 1.18]}
            scale={[0.78, 0.7, 0.8]}
          />
          <mesh
            castShadow={shadowed}
            geometry={crownGeometry}
            material={frameMaterial}
            position={[3.5, 0.35, -2.2]}
            rotation={[-0.18, -0.3, -1.36]}
            scale={[0.64, 0.62, 0.72]}
          />
          <mesh
            castShadow={shadowed}
            geometry={sensorGeometry}
            material={panelMaterial}
            position={[0.45, 0.32, -1.12]}
            rotation={[0.36, 0.18, 0.7]}
            scale={0.52}
          />
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
