import { useMemo, useRef } from 'react'
import { AdditiveBlending, Group, MeshBasicMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

interface LandingMarkerProps {
  readonly site: LandingSite
}

export function LandingMarker({ site }: LandingMarkerProps) {
  const groupRef = useRef<Group>(null)
  const beamMaterialRef = useRef<MeshBasicMaterial>(null)
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const position = useMemo(
    () => transform.position.clone().multiplyScalar(1.00008),
    [transform],
  )

  useFrame((state) => {
    const group = groupRef.current
    const beamMaterial = beamMaterialRef.current

    if (group === null || beamMaterial === null) {
      return
    }

    const distance = state.camera.position.distanceTo(position)
    const markerScale = Math.min(0.034, Math.max(0.0003, distance * 0.017))
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.08

    group.scale.setScalar(markerScale * pulse)
    group.rotation.y = state.clock.elapsedTime * 0.32
    beamMaterial.opacity = 0.11 + (pulse - 0.92) * 0.35
    state.invalidate()
  })

  return (
    <group
      ref={groupRef}
      position={position}
      quaternion={transform.orientation}
    >
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.72, 0.045, 8, 48]} />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#ff9a4d"
          depthWrite={false}
          opacity={0.88}
          transparent
        />
      </mesh>
      <mesh position-y={0.86}>
        <cylinderGeometry args={[0.025, 0.14, 1.7, 12, 1, true]} />
        <meshBasicMaterial
          ref={beamMaterialRef}
          blending={AdditiveBlending}
          color="#ff6b35"
          depthWrite={false}
          opacity={0.16}
          side={2}
          transparent
        />
      </mesh>
      <mesh position-y={0.02} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.28, 0.38, 32]} />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#ffd09a"
          depthWrite={false}
          opacity={0.68}
          side={2}
          transparent
        />
      </mesh>
    </group>
  )
}
