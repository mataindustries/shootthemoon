import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  TorusGeometry,
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
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import { calculatePermanentScarFloorHeight } from './PermanentLunarScar.tsx'

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

const CROWN_BLADE_COUNT = 4

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

function sampleBeaconBeat(elapsedMs: number, rival: RivalSignalSnapshot): number {
  const rhythm = getRivalIdentity(rival.identityId).beaconRhythm
  const cycle =
    ((elapsedMs % rhythm.cycleDurationMs) + rhythm.cycleDurationMs) %
    rhythm.cycleDurationMs
  let value = 0

  for (const startMs of rhythm.pulseStartsMs) {
    const age = cycle - startMs

    if (age >= 0 && age <= rhythm.pulseDurationMs) {
      value = Math.max(
        value,
        Math.sin((age / rhythm.pulseDurationMs) * Math.PI) ** 2,
      )
    }
  }

  return value
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
  const pylonRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const buttressRef = useRef<InstancedMesh>(null)
  const shutterRef = useRef<InstancedMesh>(null)
  const crownRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const effectiveGroundingMode =
    groundingMode ?? (damaged ? 'scarred' : 'terrain')
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

  const foundationGeometry = useMemo(
    () => new CylinderGeometry(6.25, 7.15, 0.72, 7),
    [],
  )
  const commandGeometry = useMemo(() => new ConeGeometry(2.35, 8.4, 5), [])
  const commandCollarGeometry = useMemo(
    () => new TorusGeometry(2.42, 0.2, 5, 12),
    [],
  )
  const wellGeometry = useMemo(
    () => new CylinderGeometry(1.62, 2.08, 0.62, 8),
    [],
  )
  const coreGeometry = useMemo(
    () => new CylinderGeometry(0.62, 0.78, 1.18, 8),
    [],
  )
  const mastGeometry = useMemo(
    () => new CylinderGeometry(0.42, 0.72, 1, 6),
    [],
  )
  const sensorGeometry = useMemo(() => new OctahedronGeometry(0.74, 0), [])
  const pylonGeometry = useMemo(() => new BoxGeometry(0.72, 7.2, 0.92), [])
  const lightGeometry = useMemo(() => new BoxGeometry(0.18, 0.68, 1.05), [])
  const buttressGeometry = useMemo(() => new TetrahedronGeometry(1.1, 0), [])
  const shutterGeometry = useMemo(
    () => new BoxGeometry(2.85, 0.28, 0.72),
    [],
  )
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
  const signalMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        emissive: identity.palette.signal,
        emissiveIntensity: 0.34,
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

  useLayoutEffect(() => {
    const pylons = pylonRef.current
    const lights = lightRef.current
    const buttresses = buttressRef.current
    const shutters = shutterRef.current
    const crown = crownRef.current

    if (
      pylons === null ||
      lights === null ||
      buttresses === null ||
      shutters === null ||
      crown === null
    ) {
      return
    }

    const dummy = dummyRef.current
    pylons.count = profile.pylonCount
    lights.count = profile.lightCount
    buttresses.count = profile.buttressCount
    shutters.count = focused ? 2 : 0

    for (let index = 0; index < CROWN_BLADE_COUNT; index += 1) {
      const x = [-4.25, -2.58, -0.88, 0.08][index] ?? 0
      const y = [6.42, 8.05, 7.12, 5.9][index] ?? 6
      const z = [1.3, 1.58, 1.1, 0.38][index] ?? 1
      const lean = [-0.24, -0.08, 0.18, 0.38][index] ?? 0
      dummy.position.set(x, y, z)
      dummy.rotation.set(0.05 * index, lean * 0.38, lean)
      dummy.scale.set(1, 0.78 + index * 0.08, index === 3 ? 0.72 : 1)
      dummy.updateMatrix()
      crown.setMatrixAt(index, dummy.matrix)
    }

    for (let index = 0; index < profile.pylonCount; index += 1) {
      const angles = [0.48, 2.62, 4.68]
      const angle = angles[index] ?? 0
      const radius = rival.stage === 'FORTIFIED' ? 8.5 : 7.2
      dummy.position.set(
        Math.sin(angle) * radius,
        3.2 + index * 0.48,
        Math.cos(angle) * radius,
      )
      dummy.rotation.set(
        0.04 * index,
        angle,
        index % 2 === 0 ? -0.18 : 0.14,
      )
      dummy.scale.set(1, 0.78 + index * 0.1, 1)
      dummy.updateMatrix()
      pylons.setMatrixAt(index, dummy.matrix)
    }

    for (let index = 0; index < profile.lightCount; index += 1) {
      const angles = [0.22, 1.76, 2.92, 4.05, 4.94, 5.7]
      const angle = angles[index] ?? 0
      const radius = index < 2 ? 3.35 : 6.25 + (index % 2) * 1.45
      dummy.position.set(
        Math.sin(angle) * radius,
        0.86 + (index % 3) * 0.28,
        Math.cos(angle) * radius,
      )
      dummy.rotation.set(0, angle, index % 2 === 0 ? 0.08 : -0.08)
      dummy.scale.set(index < 2 ? 1.18 : 0.86, 1, 1)
      dummy.updateMatrix()
      lights.setMatrixAt(index, dummy.matrix)
    }

    for (let index = 0; index < profile.buttressCount; index += 1) {
      const angles = [0.18, 1.31, 2.2, 3.38, 4.16, 5.52]
      const angle = angles[index] ?? 0
      const radius = 9.15 + (index % 3) * 0.58
      dummy.position.set(
        Math.sin(angle) * radius,
        0.88,
        Math.cos(angle) * radius,
      )
      dummy.rotation.set(
        0.12,
        angle + Math.PI / 4,
        index % 2 === 0 ? -0.3 : -0.18,
      )
      dummy.scale.set(1.18 + (index % 2) * 0.24, 1.72, 0.64)
      dummy.updateMatrix()
      buttresses.setMatrixAt(index, dummy.matrix)
    }

    pylons.instanceMatrix.needsUpdate = true
    lights.instanceMatrix.needsUpdate = true
    buttresses.instanceMatrix.needsUpdate = true
    crown.instanceMatrix.needsUpdate = true
  }, [focused, profile, rival.stage])

  useEffect(
    () => () => {
      foundationGeometry.dispose()
      commandGeometry.dispose()
      commandCollarGeometry.dispose()
      wellGeometry.dispose()
      coreGeometry.dispose()
      mastGeometry.dispose()
      sensorGeometry.dispose()
      pylonGeometry.dispose()
      lightGeometry.dispose()
      buttressGeometry.dispose()
      shutterGeometry.dispose()
      crownGeometry.dispose()
      skeletonMaterial.dispose()
      frameMaterial.dispose()
      panelMaterial.dispose()
      signalMaterial.dispose()
      contactMaterial.dispose()
    },
    [
      buttressGeometry,
      commandCollarGeometry,
      commandGeometry,
      contactMaterial,
      coreGeometry,
      crownGeometry,
      foundationGeometry,
      frameMaterial,
      lightGeometry,
      mastGeometry,
      panelMaterial,
      pylonGeometry,
      sensorGeometry,
      shutterGeometry,
      signalMaterial,
      skeletonMaterial,
      wellGeometry,
    ],
  )

  useFrame((state) => {
    const arrival = arrivalRef.current
    const shutters = shutterRef.current

    if (arrival === null || shutters === null) {
      return
    }

    const arrivalScale = footholdArrivalScale(presentation, performance.now())
    arrival.scale.setScalar(arrivalScale)

    if (shutters.count > 0) {
      const dummy = dummyRef.current
      const motion = Math.sin(state.clock.elapsedTime * 0.74) * 0.28

      for (let index = 0; index < 2; index += 1) {
        const side = index === 0 ? -1 : 1
        dummy.position.set(side * 1.7, 1.3 + index * 0.18, -1.18)
        dummy.rotation.set(
          0,
          side * (0.34 + motion),
          side * (0.12 + motion * 0.2),
        )
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        shutters.setMatrixAt(index, dummy.matrix)
      }

      shutters.instanceMatrix.needsUpdate = true
    }

    const beat = sampleBeaconBeat(state.clock.elapsedTime * 1_000, rival)
    signalMaterial.emissiveIntensity =
      EMISSIVE_LIMITS.panel +
      beat * (EMISSIVE_LIMITS.activePanel - EMISSIVE_LIMITS.panel)
  })

  const hasMast = profile.mastHeightM > 0

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
          <mesh
            castShadow={shadowed}
            geometry={foundationGeometry}
            material={contactMaterial}
            position-y={0.34}
            receiveShadow={shadowed}
          />

          <group position={[-2.15, 4.72, 1.15]} rotation-z={Math.PI}>
            <mesh
              castShadow={shadowed}
              geometry={commandGeometry}
              material={skeletonMaterial}
            />
            <mesh
              geometry={commandCollarGeometry}
              material={panelMaterial}
              position-y={-1.95}
              rotation-x={Math.PI / 2}
            />
          </group>

          <instancedMesh
            ref={crownRef}
            args={[crownGeometry, skeletonMaterial, CROWN_BLADE_COUNT]}
            castShadow={shadowed}
            receiveShadow={shadowed}
          />

          <mesh
            castShadow={shadowed}
            geometry={wellGeometry}
            material={frameMaterial}
            position={[0, 0.82, -1.18]}
            receiveShadow={shadowed}
          />
          <mesh
            geometry={coreGeometry}
            material={signalMaterial}
            position={[0, 1.36, -1.18]}
          />

          <mesh
            castShadow={shadowed}
            geometry={mastGeometry}
            material={frameMaterial}
            position={[5.15, profile.mastHeightM / 2 + 0.62, -1.55]}
            scale={[1, profile.mastHeightM, 1]}
            visible={hasMast}
          />
          <mesh
            geometry={sensorGeometry}
            material={signalMaterial}
            position={[5.15, profile.mastHeightM + 1.02, -1.55]}
            scale={[0.68, 1.18, 0.68]}
            visible={hasMast}
          />

          <instancedMesh
            ref={pylonRef}
            args={[pylonGeometry, skeletonMaterial, 3]}
            castShadow={shadowed}
            receiveShadow={shadowed}
          />
          <instancedMesh
            ref={lightRef}
            args={[lightGeometry, signalMaterial, 6]}
          />
          <instancedMesh
            ref={buttressRef}
            args={[buttressGeometry, frameMaterial, 6]}
            castShadow={shadowed}
            receiveShadow={shadowed}
          />
          <instancedMesh
            ref={shutterRef}
            args={[shutterGeometry, panelMaterial, 2]}
          />
        </group>
      </group>
    </group>
  )
}
