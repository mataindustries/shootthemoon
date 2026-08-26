import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { DEPLOYMENT_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'

const CAPSULE_SCALE = 0.00029
const LANDED_HEIGHT =
  LOCAL_SURFACE_RENDER_OFFSET + 1.04 * CAPSULE_SCALE + 0.000006

interface InvasionCapsuleProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
  readonly outpost: OutpostSnapshot | null
}

function smoothstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function CapsuleLandingLegs() {
  const structureRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const structureMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        metalness: 0.64,
        roughness: 0.44,
        vertexColors: true,
      }),
    [],
  )
  const lightMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ff8a45',
        emissive: '#ff5b21',
        emissiveIntensity: 1.8,
        metalness: 0.2,
        roughness: 0.36,
      }),
    [],
  )

  useLayoutEffect(() => {
    const structure = structureRef.current
    const lights = lightRef.current

    if (structure === null || lights === null) {
      return
    }

    const root = new Object3D()
    const part = new Object3D()
    const parts = [
      {
        position: [0.58, -0.5, 0] as const,
        rotationZ: -0.24,
        scale: [0.48, 0.12, 0.12] as const,
        color: new Color('#282d33'),
      },
      {
        position: [0.7, -0.9, 0] as const,
        rotationZ: -0.58,
        scale: [0.62, 0.1, 0.12] as const,
        color: new Color('#22272c'),
      },
      {
        position: [0.98, -1.08, 0] as const,
        rotationZ: 0,
        scale: [0.28, 0.08, 0.22] as const,
        color: new Color('#353a40'),
      },
      {
        position: [0.82, -0.76, 0] as const,
        rotationZ: -0.18,
        scale: [0.09, 0.5, 0.09] as const,
        color: new Color('#59616a'),
      },
    ]
    let structureIndex = 0

    for (let legIndex = 0; legIndex < 4; legIndex += 1) {
      const rotationY = legIndex * (Math.PI / 2)
      root.rotation.set(0, rotationY, 0)
      root.updateMatrixWorld(true)

      for (const definition of parts) {
        part.position.set(
          definition.position[0],
          definition.position[1],
          definition.position[2],
        )
        part.rotation.set(0, 0, definition.rotationZ)
        part.scale.set(
          definition.scale[0],
          definition.scale[1],
          definition.scale[2],
        )
        root.add(part)
        part.updateMatrixWorld(true)
        structure.setMatrixAt(structureIndex, part.matrixWorld)
        structure.setColorAt(structureIndex, definition.color)
        root.remove(part)
        structureIndex += 1
      }

      part.position.set(0.72, -0.5, 0)
      part.rotation.set(0, 0, 0)
      part.scale.set(0.14, 0.035, 0.075)
      root.add(part)
      part.updateMatrixWorld(true)
      lights.setMatrixAt(legIndex, part.matrixWorld)
      root.remove(part)
    }

    structure.instanceMatrix.needsUpdate = true
    lights.instanceMatrix.needsUpdate = true

    if (structure.instanceColor !== null) {
      structure.instanceColor.needsUpdate = true
    }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      structureMaterial.dispose()
      lightMaterial.dispose()
    },
    [geometry, lightMaterial, structureMaterial],
  )

  return (
    <>
      <instancedMesh
        ref={structureRef}
        args={[geometry, structureMaterial, 16]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={lightRef}
        args={[geometry, lightMaterial, 4]}
      />
    </>
  )
}

function CapsuleModel({ outpost }: { readonly outpost: OutpostSnapshot | null }) {
  const villainMaterialRef = useRef<MeshStandardMaterial>(null)
  const hatchRef = useRef<Group>(null)
  const rampLightRef = useRef<MeshStandardMaterial>(null)

  useFrame((state) => {
    if (villainMaterialRef.current !== null) {
      villainMaterialRef.current.emissiveIntensity =
        2.1 + Math.sin(state.clock.elapsedTime * 5.2) * 0.45
    }

    const hatch = hatchRef.current
    const rampLight = rampLightRef.current

    if (hatch === null) {
      return
    }

    let progress = 0

    if (outpost !== null) {
      if (outpost.robot.state === 'deploying') {
        progress = Math.max(
          0,
          Math.min(
            1,
            (simulationNowMs() - outpost.robot.stateStartedAtMs) /
              DEPLOYMENT_DURATION_MS,
          ),
        )
      } else if (outpost.robot.state !== 'stored') {
        progress = 1
      }
    }

    const eased = progress * progress * (3 - 2 * progress)
    hatch.rotation.x = -eased * 1.34

    if (rampLight !== null) {
      rampLight.emissiveIntensity = 0.6 + eased * 2.2
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
      <mesh position={[0, 0.02, 0.535]}>
        <boxGeometry args={[0.62, 0.82, 0.055]} />
        <meshStandardMaterial
          color="#080b0e"
          emissive="#5b1f0c"
          emissiveIntensity={1.35}
          metalness={0.32}
          roughness={0.7}
        />
      </mesh>
      <group ref={hatchRef} position={[0, -0.39, 0.6]}>
        <mesh castShadow position-y={0.39} receiveShadow>
          <boxGeometry args={[0.72, 0.78, 0.07]} />
          <meshStandardMaterial
            color="#252a30"
            metalness={0.7}
            roughness={0.34}
          />
        </mesh>
        <mesh position={[0, 0.39, 0.041]}>
          <boxGeometry args={[0.48, 0.055, 0.018]} />
          <meshStandardMaterial
            ref={rampLightRef}
            color="#7b2b14"
            emissive="#ff6426"
            emissiveIntensity={0.6}
            metalness={0.35}
            roughness={0.34}
          />
        </mesh>
      </group>
      <CapsuleLandingLegs />
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
  outpost,
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
      outpost !== null || phase === 'landed' || phase === 'returning'
        ? 1
        : progressRef.current
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
        <CapsuleModel outpost={outpost} />
      </group>
    </group>
  )
}
