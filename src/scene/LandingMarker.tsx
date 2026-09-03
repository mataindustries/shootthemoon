import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useLowFrequencyDemandAnimation } from '../render/useDemandAnimation.ts'
import {
  LANDING_MARKER_OUTER_RING_Y,
  getLandingMarkerOuterPulse,
  getLandingMarkerPosition,
  getLandingMarkerScale,
} from './landingMarkerLayout.ts'

interface LandingMarkerProps {
  readonly site: LandingSite
  readonly active: boolean
}

export function LandingMarker({ site, active }: LandingMarkerProps) {
  const groupRef = useRef<Group>(null)
  const outerRingRef = useRef<Group>(null)
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const position = useMemo(() => getLandingMarkerPosition(transform), [transform])

  useLowFrequencyDemandAnimation(active, 80)

  useFrame((state) => {
    const group = groupRef.current
    const outerRing = outerRingRef.current
    if (group === null || outerRing === null) {
      return
    }

    const distance = state.camera.position.distanceTo(position)
    group.scale.setScalar(getLandingMarkerScale(distance))
    outerRing.scale.setScalar(
      getLandingMarkerOuterPulse(state.clock.elapsedTime),
    )
  })

  return (
    <group
      ref={groupRef}
      position={position}
      quaternion={transform.orientation}
    >
      <group ref={outerRingRef}>
        <mesh
          position-y={LANDING_MARKER_OUTER_RING_Y}
          renderOrder={3}
          rotation-x={Math.PI / 2}
        >
          <torusGeometry args={[0.72, 0.045, 6, 30]} />
          <meshBasicMaterial
            color="#ff5128"
            depthTest
            depthWrite={false}
            opacity={0.9}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-4}
            toneMapped={false}
            transparent
          />
        </mesh>
      </group>
      <mesh position-y={0.014} renderOrder={4} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.25, 0.36, 6]} />
        <meshBasicMaterial
          color="#ff7540"
          depthTest
          depthWrite={false}
          opacity={0.88}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-4}
          side={2}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  )
}
