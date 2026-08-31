import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

interface LandingMarkerProps {
  readonly site: LandingSite
}

export function LandingMarker({ site }: LandingMarkerProps) {
  const groupRef = useRef<Group>(null)
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const position = useMemo(
    () => transform.position.clone().multiplyScalar(1.00008),
    [transform],
  )

  useFrame((state) => {
    const group = groupRef.current
    if (group === null) {
      return
    }

    const distance = state.camera.position.distanceTo(position)
    const markerScale = Math.min(0.026, Math.max(0.0003, distance * 0.013))
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.08

    group.scale.setScalar(markerScale * pulse)
    group.rotation.y = state.clock.elapsedTime * 0.32
    state.invalidate()
  })

  return (
    <group
      ref={groupRef}
      position={position}
      quaternion={transform.orientation}
    >
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.72, 0.045, 6, 30]} />
        <meshBasicMaterial
          color="#ba5429"
          depthWrite={false}
          opacity={0.74}
          transparent
        />
      </mesh>
      <mesh position-y={0.02} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.25, 0.36, 6]} />
        <meshBasicMaterial
          color="#d87842"
          depthWrite={false}
          opacity={0.58}
          side={2}
          transparent
        />
      </mesh>
    </group>
  )
}
