import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  MathUtils,
  MeshStandardMaterial,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'

const CAPSULE_SCALE = 0.00029
const LANDED_HEIGHT =
  LOCAL_SURFACE_RENDER_OFFSET + 1.04 * CAPSULE_SCALE + 0.000006

interface InvasionCapsuleProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
}

function smoothstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function CapsuleModel() {
  const villainMaterialRef = useRef<MeshStandardMaterial>(null)

  useFrame((state) => {
    if (villainMaterialRef.current !== null) {
      villainMaterialRef.current.emissiveIntensity =
        2.1 + Math.sin(state.clock.elapsedTime * 5.2) * 0.45
    }
  })

  return (
    <group scale={CAPSULE_SCALE}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.58, 1.35, 16, 2]} />
        <meshStandardMaterial
          color="#292d33"
          metalness={0.68}
          roughness={0.34}
        />
      </mesh>
      <mesh castShadow position-y={1.01} receiveShadow>
        <coneGeometry args={[0.43, 0.72, 16, 2]} />
        <meshStandardMaterial
          color="#3b4148"
          metalness={0.62}
          roughness={0.28}
        />
      </mesh>
      <mesh castShadow position-y={-0.84} rotation-z={Math.PI}>
        <coneGeometry args={[0.39, 0.42, 16, 1, true]} />
        <meshStandardMaterial
          color="#191c20"
          metalness={0.74}
          roughness={0.38}
          side={DoubleSide}
        />
      </mesh>
      <mesh position-y={0.2} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.51, 0.065, 8, 24]} />
        <meshStandardMaterial
          ref={villainMaterialRef}
          color="#7c2d16"
          emissive="#ff5a1f"
          emissiveIntensity={2.1}
          metalness={0.46}
          roughness={0.3}
        />
      </mesh>
      <mesh position-y={-0.48} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.54, 0.045, 8, 24]} />
        <meshStandardMaterial
          color="#5c1f12"
          emissive="#d94718"
          emissiveIntensity={1.4}
          metalness={0.5}
          roughness={0.32}
        />
      </mesh>
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((rotation) => (
        <group key={rotation} rotation-y={rotation}>
          <mesh castShadow position={[0.58, -0.5, 0]} rotation-z={-0.24}>
            <boxGeometry args={[0.48, 0.12, 0.12]} />
            <meshStandardMaterial
              color="#24282d"
              metalness={0.64}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0.72, -0.5, 0]}>
            <boxGeometry args={[0.14, 0.035, 0.075]} />
            <meshBasicMaterial color="#ff7b32" />
          </mesh>
          <mesh
            castShadow
            position={[0.7, -0.9, 0]}
            rotation-z={-0.58}
          >
            <boxGeometry args={[0.62, 0.1, 0.12]} />
            <meshStandardMaterial
              color="#20242a"
              metalness={0.62}
              roughness={0.46}
            />
          </mesh>
          <mesh castShadow position={[0.98, -1.08, 0]}>
            <boxGeometry args={[0.28, 0.08, 0.22]} />
            <meshStandardMaterial
              color="#30343a"
              metalness={0.56}
              roughness={0.52}
            />
          </mesh>
        </group>
      ))}
      <mesh position-y={-1.03}>
        <cylinderGeometry args={[0.16, 0.28, 0.34, 12, 1, true]} />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#ff6b2b"
          depthWrite={false}
          opacity={0.86}
          side={DoubleSide}
          transparent
        />
      </mesh>
    </group>
  )
}

export function InvasionCapsule({
  site,
  phase,
}: InvasionCapsuleProps) {
  const capsuleRef = useRef<Group>(null)
  const progressRef = useCinematicProgress()
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])

  useFrame((state) => {
    const capsule = capsuleRef.current

    if (capsule === null) {
      return
    }

    const progress =
      phase === 'landed' || phase === 'returning' ? 1 : progressRef.current
    const descent = smoothstep(Math.max(0, Math.min(1, (progress - 0.06) / 0.8)))
    const remaining = 1 - descent
    const impactAge = Math.max(0, Math.min(1, (progress - 0.86) / 0.14))
    const bounce =
      Math.sin(impactAge * Math.PI * 4) *
      Math.exp(-impactAge * 4.5) *
      0.00028

    capsule.position.set(
      remaining * remaining * 0.026,
      MathUtils.lerp(0.19, LANDED_HEIGHT, descent) + bounce,
      -remaining * 0.034 + Math.sin(descent * Math.PI) * 0.005,
    )
    capsule.rotation.y =
      remaining * Math.PI * 6 + state.clock.elapsedTime * 0.08
    capsule.rotation.z = remaining * -0.2
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group ref={capsuleRef}>
        <CapsuleModel />
      </group>
    </group>
  )
}
