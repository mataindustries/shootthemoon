import { useEffect, useMemo, useRef } from 'react'
import {
  Group,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

const TAP_DISTANCE_PX = 10

interface OutpostSignalProps {
  readonly outpost: OutpostSnapshot
  readonly focused: boolean
  readonly onFocus: () => void
}

export function OutpostSignal({
  outpost,
  focused,
  onFocus,
}: OutpostSignalProps) {
  const groupRef = useRef<Group>(null)
  const projectedPointRef = useRef(new Vector3())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const position = useMemo(
    () => transform.position.clone().multiplyScalar(1.00038),
    [transform.position],
  )
  const hitGeometry = useMemo(() => new SphereGeometry(7.5, 8, 6), [])
  const hitMaterial = useMemo(
    () => new MeshBasicMaterial({ visible: false }),
    [],
  )
  const active = outpost.stage === 'extractor-active'
  const isE2e = useMemo(
    () => new URLSearchParams(window.location.search).has('e2e'),
    [],
  )

  useEffect(
    () => () => {
      hitGeometry.dispose()
      hitMaterial.dispose()
    },
    [hitGeometry, hitMaterial],
  )

  useFrame((state) => {
    const group = groupRef.current

    if (group === null) {
      return
    }

    const distance = state.camera.position.distanceTo(position)
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.1) * 0.06
    const scale = Math.max(
      0.013,
      Math.min(0.021, distance * (active ? 0.0052 : 0.0046)),
    )
    group.scale.setScalar(scale * pulse * (focused ? 1.14 : 1))
    group.rotation.y = state.clock.elapsedTime * (active ? 0.32 : 0.18)

    if (isE2e) {
      const canvas = state.gl.domElement
      projectedPointRef.current.copy(position).project(state.camera)
      canvas.dataset.outpostSignalX = String(
        ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
      )
      canvas.dataset.outpostSignalY = String(
        ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
      )
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    const facesCamera =
      position.dot(event.camera.position) > position.lengthSq() - 0.0004

    if (!facesCamera || event.delta > TAP_DISTANCE_PX) {
      return
    }

    event.stopPropagation()
    onFocus()
  }

  return (
    <group position={position} quaternion={transform.orientation}>
      <group ref={groupRef} name="orbital-outpost-signal" onClick={handleClick}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.72, active ? 0.085 : 0.055, 7, 28]} />
          <meshBasicMaterial
            color={
              active
                ? VISUAL_PALETTE.playerAmberEmissive
                : VISUAL_PALETTE.playerAmberPanel
            }
            depthWrite={false}
            opacity={active ? 0.68 : 0.52}
            transparent
          />
        </mesh>
        <mesh position-y={0.19}>
          <cylinderGeometry args={[0.06, 0.14, 0.36, 8]} />
          <meshBasicMaterial
            color={VISUAL_PALETTE.playerWarningRed}
            depthWrite={false}
            opacity={active ? 0.7 : 0.48}
            transparent
          />
        </mesh>
        {[-0.42, 0, 0.42].map((x, index) => (
          <mesh key={x} position={[x, 0.13 + index * 0.1, 0]}>
            <octahedronGeometry args={[active ? 0.14 : 0.1, 0]} />
            <meshBasicMaterial
              color={
                index === 1
                  ? VISUAL_PALETTE.playerHotMetal
                  : VISUAL_PALETTE.playerAmberEmissive
              }
            />
          </mesh>
        ))}
        {active ? (
          <mesh position-y={0.04} rotation-x={Math.PI / 2}>
            <ringGeometry args={[0.24, 0.38, 24]} />
            <meshBasicMaterial
              color={VISUAL_PALETTE.playerHotMetal}
              depthWrite={false}
              opacity={0.44}
              transparent
            />
          </mesh>
        ) : null}
        <mesh geometry={hitGeometry} material={hitMaterial} />
      </group>
    </group>
  )
}
