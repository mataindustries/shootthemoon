import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'

const PARTICLE_COUNT = 144

interface ImpactEffectsProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

interface DustGeometry {
  readonly geometry: BufferGeometry
  readonly origins: Float32Array
  readonly velocities: Float32Array
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function createDustGeometry(site: LandingSite): DustGeometry {
  const seed =
    (Math.round(site.location.latitudeRad * 10_000_000) ^
      Math.round(site.location.longitudeRad * 10_000_000) ^
      0xd057c10d) >>>
    0
  const random = createRandom(seed)
  const origins = new Float32Array(PARTICLE_COUNT * 3)
  const velocities = new Float32Array(PARTICLE_COUNT * 3)
  const positions = new Float32Array(PARTICLE_COUNT * 3)

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2
    const radius = random() * 0.00025
    const speed = 0.0005 + random() * 0.002

    origins[offset] = Math.cos(angle) * radius
    origins[offset + 1] = 0.000025 + random() * 0.00008
    origins[offset + 2] = Math.sin(angle) * radius
    velocities[offset] = Math.cos(angle) * speed
    velocities[offset + 1] = 0.0005 + random() * 0.0017
    velocities[offset + 2] = Math.sin(angle) * speed
    positions[offset] = origins[offset] ?? 0
    positions[offset + 1] = origins[offset + 1] ?? 0
    positions[offset + 2] = origins[offset + 2] ?? 0
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  return { geometry, origins, velocities }
}

export function ImpactEffects({
  site,
  phase,
  terrain,
  segments,
}: ImpactEffectsProps) {
  const progressRef = useCinematicProgress()
  const dustMaterialRef = useRef<ShaderMaterial>(null)
  const ringMaterialRef = useRef<MeshBasicMaterial>(null)
  const ringRef = useRef<Mesh>(null)
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const dust = useMemo(() => createDustGeometry(site), [site])
  const surfaceHeight = useMemo(
    () => sampleRenderedSurface(terrain, segments, 0, 0).y,
    [segments, terrain],
  )

  useEffect(() => () => dust.geometry.dispose(), [dust])

  useFrame(() => {
    const progress =
      phase === 'landed' || phase === 'returning' ? 1 : progressRef.current
    const impactAge = Math.max(0, Math.min(1, (progress - 0.78) / 0.22))
    const positionAttribute = dust.geometry.getAttribute(
      'position',
    ) as BufferAttribute
    const positions = positionAttribute.array as Float32Array

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3
      const originX = dust.origins[offset] ?? 0
      const originY = dust.origins[offset + 1] ?? 0
      const originZ = dust.origins[offset + 2] ?? 0
      const velocityX = dust.velocities[offset] ?? 0
      const velocityY = dust.velocities[offset + 1] ?? 0
      const velocityZ = dust.velocities[offset + 2] ?? 0

      positions[offset] = originX + velocityX * impactAge
      positions[offset + 1] = Math.max(
        0.000012,
        originY + velocityY * impactAge - 0.0016 * impactAge * impactAge,
      )
      positions[offset + 2] = originZ + velocityZ * impactAge
    }

    positionAttribute.needsUpdate = impactAge > 0

    if (dustMaterialRef.current !== null) {
      const opacityUniform = dustMaterialRef.current.uniforms.opacity

      if (opacityUniform !== undefined) {
        opacityUniform.value =
          impactAge <= 0 ? 0 : Math.sin(impactAge * Math.PI) * 0.72
      }
    }

    if (ringRef.current !== null && ringMaterialRef.current !== null) {
      const ringScale = 0.00012 + impactAge * 0.0019
      ringRef.current.scale.setScalar(ringScale)
      ringMaterialRef.current.opacity =
        impactAge <= 0 ? 0 : (1 - impactAge) * 0.64
    }
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <points
        geometry={dust.geometry}
        position-y={surfaceHeight}
        renderOrder={5}
      >
        <shaderMaterial
          ref={dustMaterialRef}
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          transparent
          uniforms={{
            dustColor: { value: new Color('#d9bea2') },
            opacity: { value: 0 },
          }}
          vertexShader={[
            'void main() {',
            '  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);',
            '  gl_PointSize = 3.2;',
            '  gl_Position = projectionMatrix * viewPosition;',
            '}',
          ].join('\n')}
          fragmentShader={[
            'uniform vec3 dustColor;',
            'uniform float opacity;',
            'void main() {',
            '  float radius = length(gl_PointCoord - vec2(0.5));',
            '  float softEdge = 1.0 - smoothstep(0.28, 0.5, radius);',
            '  if (softEdge <= 0.01) discard;',
            '  gl_FragColor = vec4(dustColor, opacity * softEdge);',
            '}',
          ].join('\n')}
        />
      </points>
      <mesh
        ref={ringRef}
        position-y={surfaceHeight + 0.00008}
        renderOrder={4}
        rotation-x={-Math.PI / 2}
      >
        <ringGeometry args={[0.965, 1, 64]} />
        <meshBasicMaterial
          ref={ringMaterialRef}
          blending={AdditiveBlending}
          color="#ff7a32"
          depthTest={false}
          depthWrite={false}
          opacity={0}
          side={DoubleSide}
          toneMapped
          transparent
        />
      </mesh>
    </group>
  )
}
