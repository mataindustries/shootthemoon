import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from 'three'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

interface LunarWarheadSystemProps {
  readonly playerSite: LandingSite
  readonly strike: FirstStrikeSnapshot
  readonly presentation: FirstStrikePresentationState
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export function LunarWarheadSystem({
  playerSite,
  strike,
  presentation,
}: LunarWarheadSystemProps) {
  const leftDoorRef = useRef<Group>(null)
  const rightDoorRef = useRef<Group>(null)
  const cradleRef = useRef<Group>(null)
  const transform = useMemo(
    () => landingSiteToRenderTransform(playerSite),
    [playerSite],
  )
  const attachmentPosition = useMemo(
    () => transform.position.clone().addScaledVector(transform.up, 0.00044),
    [transform.position, transform.up],
  )
  const systemScale = LOCAL_METRES_TO_RENDER_UNITS * 1.42
  const baseGeometry = useMemo(
    () => new CylinderGeometry(5.8, 6.8, 1.35, 12),
    [],
  )
  const tubeGeometry = useMemo(
    () => new CylinderGeometry(2.05, 2.4, 8.2, 12, 1, true),
    [],
  )
  const doorGeometry = useMemo(() => new BoxGeometry(5.6, 0.58, 2.5), [])
  const railGeometry = useMemo(() => new BoxGeometry(0.52, 7.2, 0.52), [])
  const ringGeometry = useMemo(() => new RingGeometry(2.4, 3.05, 12), [])
  const structureMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#342d2a',
        emissive: '#7a2412',
        emissiveIntensity: 0.18,
        metalness: 0.8,
        roughness: 0.34,
      }),
    [],
  )
  const edgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#82513a',
        emissive: '#ff5a24',
        emissiveIntensity: 0.62,
        metalness: 0.72,
        roughness: 0.28,
      }),
    [],
  )
  const warningMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#ff7a32',
        depthWrite: false,
        opacity: strike.status === 'ARMED' ? 0.75 : 0.3,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
      }),
    [strike.status],
  )

  useEffect(
    () => () => {
      baseGeometry.dispose()
      tubeGeometry.dispose()
      doorGeometry.dispose()
      railGeometry.dispose()
      ringGeometry.dispose()
      structureMaterial.dispose()
      edgeMaterial.dispose()
      warningMaterial.dispose()
    }, [
      baseGeometry,
      doorGeometry,
      edgeMaterial,
      railGeometry,
      ringGeometry,
      structureMaterial,
      tubeGeometry,
      warningMaterial,
    ],
  )

  useFrame((state) => {
    const leftDoor = leftDoorRef.current
    const rightDoor = rightDoorRef.current
    const cradle = cradleRef.current

    if (leftDoor === null || rightDoor === null || cradle === null) {
      return
    }

    const cinematicProgress = getFirstStrikePresentationProgress(presentation)
    const openProgress =
      presentation.phase === 'arming'
        ? smoothstep(cinematicProgress)
        : presentation.phase === 'launch' ||
            presentation.phase === 'orbital-flight' ||
            presentation.phase === 'vesper-transmission' ||
            presentation.phase === 'target-approach'
          ? 1
          : strike.status === 'ARMED'
            ? 0.12
            : 0

    leftDoor.position.x = -2.55 - openProgress * 3.4
    rightDoor.position.x = 2.55 + openProgress * 3.4
    leftDoor.rotation.z = openProgress * 0.17
    rightDoor.rotation.z = -openProgress * 0.17
    cradle.position.y = 1.1 + openProgress * 4.1

    const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 7.4) * 0.5
    warningMaterial.opacity =
      0.32 + pulse * (strike.status === 'ARMED' ? 0.58 : 0.3)
  })

  return (
    <group position={attachmentPosition} quaternion={transform.orientation}>
      <group scale={systemScale}>
        <mesh geometry={baseGeometry} material={structureMaterial} position-y={0.68} />
        <mesh
          geometry={tubeGeometry}
          material={structureMaterial}
          position-y={4.55}
        />
        <mesh
          geometry={ringGeometry}
          material={edgeMaterial}
          position-y={8.68}
          rotation-x={-Math.PI / 2}
        />

        <group ref={cradleRef} position-y={1.1}>
          <mesh geometry={railGeometry} material={edgeMaterial} position-x={-2.15} />
          <mesh geometry={railGeometry} material={edgeMaterial} position-x={2.15} />
        </group>

        <group ref={leftDoorRef} position={[-2.55, 9.15, 0]}>
          <mesh geometry={doorGeometry} material={structureMaterial} />
        </group>
        <group ref={rightDoorRef} position={[2.55, 9.15, 0]}>
          <mesh geometry={doorGeometry} material={structureMaterial} />
        </group>

        <mesh
          geometry={ringGeometry}
          material={warningMaterial}
          position-y={0.08}
          rotation-x={-Math.PI / 2}
          scale={1.75}
        />
        <mesh
          geometry={ringGeometry}
          material={warningMaterial}
          position-y={8.82}
          rotation-x={-Math.PI / 2}
          scale={0.92}
        />
      </group>
    </group>
  )
}
