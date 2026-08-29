import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
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
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

export const RIVAL_SURFACE_CLEARANCE = 0.000018

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
): RivalSurfaceAttachment {
  const transform = landingSiteToRenderTransform(site)

  return {
    position: transform.position
      .clone()
      .addScaledVector(transform.up, RIVAL_SURFACE_CLEARANCE),
    orientation: transform.orientation.clone(),
    up: transform.up.clone(),
  }
}

export interface RivalFootholdProps {
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
  readonly focused: boolean
  readonly damaged?: boolean
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
      value = Math.max(value, Math.sin((age / rhythm.pulseDurationMs) * Math.PI) ** 2)
    }
  }

  return value
}

export function RivalFoothold({
  rival,
  presentation,
  focused,
  damaged = false,
}: RivalFootholdProps) {
  const arrivalRef = useRef<Group>(null)
  const pylonRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const buttressRef = useRef<InstancedMesh>(null)
  const shutterRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const attachment = useMemo(
    () => createRivalSurfaceAttachment(rival.site),
    [rival.site],
  )
  const identity = getRivalIdentity(rival.identityId)
  const profile = getRivalStageVisualProfile(rival.stage)
  const initialArrivalScale = footholdArrivalScale(presentation, performance.now())
  const visualScale = LOCAL_METRES_TO_RENDER_UNITS * (focused ? 1.2 : 2.05)

  const scarGeometry = useMemo(() => new CircleGeometry(18, 28), [])
  const capsuleGeometry = useMemo(() => new ConeGeometry(1.45, 9.6, 3), [])
  const collarGeometry = useMemo(() => new TorusGeometry(1.62, 0.28, 5, 12), [])
  const foundationGeometry = useMemo(
    () => new CylinderGeometry(3.1, 4.2, 0.72, 6),
    [],
  )
  const mastGeometry = useMemo(
    () => new CylinderGeometry(0.72, 1.5, 1, 5),
    [],
  )
  const pylonGeometry = useMemo(() => new BoxGeometry(0.78, 7.2, 1), [])
  const lightGeometry = useMemo(() => new OctahedronGeometry(0.42, 0), [])
  const buttressGeometry = useMemo(() => new TetrahedronGeometry(1.1, 0), [])
  const shutterGeometry = useMemo(
    () => new BoxGeometry(3.3, 0.34, 0.86),
    [],
  )
  const scarMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#101921',
        metalness: 0.08,
        opacity: 0.4,
        roughness: 1,
        transparent: true,
      }),
    [],
  )
  const structureMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#293e49',
        emissive: identity.palette.signal,
        emissiveIntensity: 0.22,
        metalness: 0.82,
        roughness: 0.32,
      }),
    [identity.palette.signal],
  )
  const edgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#9bb0b8',
        emissive: identity.palette.signal,
        emissiveIntensity: 0.7,
        metalness: 0.76,
        roughness: 0.28,
      }),
    [identity.palette.signal],
  )
  const lightMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.highlight,
        depthWrite: false,
        opacity: 0.84,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.highlight],
  )

  useLayoutEffect(() => {
    const pylons = pylonRef.current
    const lights = lightRef.current
    const buttresses = buttressRef.current
    const shutters = shutterRef.current

    if (
      pylons === null ||
      lights === null ||
      buttresses === null ||
      shutters === null
    ) {
      return
    }

    const dummy = dummyRef.current
    pylons.count = profile.pylonCount
    lights.count = profile.lightCount
    buttresses.count = profile.buttressCount
    shutters.count = profile.mastHeightM > 0 && focused ? 2 : 0

    for (let index = 0; index < profile.pylonCount; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + 0.3
      const radius = rival.stage === 'FORTIFIED' ? 7.4 : 6.2
      dummy.position.set(
        Math.sin(angle) * radius,
        3.35 + index * 0.42,
        Math.cos(angle) * radius,
      )
      dummy.rotation.set(0, angle, index % 2 === 0 ? -0.16 : 0.16)
      dummy.scale.set(1, 0.82 + index * 0.08, 1)
      dummy.updateMatrix()
      pylons.setMatrixAt(index, dummy.matrix)
    }

    for (let index = 0; index < profile.lightCount; index += 1) {
      const angle = (index / profile.lightCount) * Math.PI * 2 + 0.18
      const radius = 4.8 + (index % 2) * 2.5
      dummy.position.set(
        Math.sin(angle) * radius,
        0.72 + (index % 2) * 0.38,
        Math.cos(angle) * radius,
      )
      dummy.rotation.set(0, angle, 0)
      dummy.scale.setScalar(index < 2 ? 1 : 0.76)
      dummy.updateMatrix()
      lights.setMatrixAt(index, dummy.matrix)
    }

    for (let index = 0; index < profile.buttressCount; index += 1) {
      const angle = (index / profile.buttressCount) * Math.PI * 2
      dummy.position.set(Math.sin(angle) * 10.2, 1.05, Math.cos(angle) * 10.2)
      dummy.rotation.set(0.12, angle + Math.PI / 4, -0.28)
      dummy.scale.set(1.35, 1.9, 0.72)
      dummy.updateMatrix()
      buttresses.setMatrixAt(index, dummy.matrix)
    }

    pylons.instanceMatrix.needsUpdate = true
    lights.instanceMatrix.needsUpdate = true
    buttresses.instanceMatrix.needsUpdate = true
  }, [focused, profile, rival.stage])

  useEffect(
    () => () => {
      scarGeometry.dispose()
      capsuleGeometry.dispose()
      collarGeometry.dispose()
      foundationGeometry.dispose()
      mastGeometry.dispose()
      pylonGeometry.dispose()
      lightGeometry.dispose()
      buttressGeometry.dispose()
      shutterGeometry.dispose()
      scarMaterial.dispose()
      structureMaterial.dispose()
      edgeMaterial.dispose()
      lightMaterial.dispose()
    },
    [
      buttressGeometry,
      capsuleGeometry,
      collarGeometry,
      edgeMaterial,
      foundationGeometry,
      lightGeometry,
      lightMaterial,
      mastGeometry,
      pylonGeometry,
      scarGeometry,
      scarMaterial,
      shutterGeometry,
      structureMaterial,
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
      const motion = Math.sin(state.clock.elapsedTime * 0.74) * 0.42

      for (let index = 0; index < 2; index += 1) {
        const side = index === 0 ? -1 : 1
        dummy.position.set(side * 2, profile.mastHeightM * 0.67, 0)
        dummy.rotation.set(0, side * (0.26 + motion), side * 0.16)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        shutters.setMatrixAt(index, dummy.matrix)
      }

      shutters.instanceMatrix.needsUpdate = true
    }

    const beat = sampleBeaconBeat(state.clock.elapsedTime * 1_000, rival)
    lightMaterial.opacity = 0.7 + beat * 0.3
    edgeMaterial.emissiveIntensity = 0.58 + beat * 0.74
  })

  const hasMast = profile.mastHeightM > 0
  const fortified = rival.stage === 'FORTIFIED'

  if (damaged) {
    return (
      <group position={attachment.position} quaternion={attachment.orientation}>
        <group rotation-y={rival.surfaceHeadingRad} scale={visualScale}>
          <mesh
            geometry={capsuleGeometry}
            material={structureMaterial}
            position={[-4.2, -1.8, 1.6]}
            rotation={[0.42, -0.18, 1.08]}
            scale={[1, 0.66, 1]}
          />
          <mesh
            geometry={foundationGeometry}
            material={structureMaterial}
            position={[4.4, -0.7, -2.1]}
            rotation={[0.26, 0.52, -0.34]}
            scale={[1.05, 0.36, 0.84]}
          />
          <mesh
            geometry={pylonGeometry}
            material={edgeMaterial}
            position={[2.2, 0.15, 3.7]}
            rotation={[0.08, -0.62, 1.28]}
            scale={[0.72, 0.62, 0.72]}
          />
          <mesh
            geometry={pylonGeometry}
            material={structureMaterial}
            position={[-1.4, -0.2, -4.4]}
            rotation={[-0.16, 0.42, -1.36]}
            scale={[0.58, 0.48, 0.58]}
          />
          <mesh
            geometry={lightGeometry}
            material={lightMaterial}
            position={[-3.4, 0.48, 0.6]}
            scale={0.72}
          />
          <mesh
            geometry={lightGeometry}
            material={lightMaterial}
            position={[3.6, 0.3, -2.2]}
            scale={0.46}
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
            geometry={scarGeometry}
            material={scarMaterial}
            receiveShadow={focused}
            rotation-x={-Math.PI / 2}
          />

          <group position={[0, 4.7, 0]} rotation-z={Math.PI}>
            <mesh
              castShadow={focused}
              geometry={capsuleGeometry}
              material={structureMaterial}
            />
            <mesh
              geometry={collarGeometry}
              material={edgeMaterial}
              position-y={-1.35}
              rotation-x={Math.PI / 2}
            />
          </group>

          <mesh
            castShadow={focused}
            geometry={foundationGeometry}
            material={structureMaterial}
            position={[5.2, 0.36, 1.6]}
            receiveShadow={focused}
            visible={hasMast}
          />
          <mesh
            castShadow={focused}
            geometry={mastGeometry}
            material={structureMaterial}
            position={[5.2, profile.mastHeightM / 2 + 0.7, 1.6]}
            scale={[1, profile.mastHeightM, 1]}
            visible={hasMast}
          />
          <mesh
            geometry={lightGeometry}
            material={lightMaterial}
            position={[5.2, profile.mastHeightM + 1.3, 1.6]}
            scale={1.45}
            visible={hasMast}
          />

          <instancedMesh
            ref={pylonRef}
            args={[pylonGeometry, structureMaterial, 3]}
            castShadow={focused}
            receiveShadow={focused}
          />
          <instancedMesh
            ref={lightRef}
            args={[lightGeometry, lightMaterial, 6]}
          />
          <instancedMesh
            ref={buttressRef}
            args={[buttressGeometry, edgeMaterial, 6]}
            castShadow={focused}
            receiveShadow={focused}
          />
          <instancedMesh
            ref={shutterRef}
            args={[shutterGeometry, edgeMaterial, 2]}
          />

          <mesh
            geometry={collarGeometry}
            material={edgeMaterial}
            position-y={0.34}
            rotation-x={Math.PI / 2}
            scale={5.8}
            visible={fortified}
          />
        </group>
      </group>
    </group>
  )
}
