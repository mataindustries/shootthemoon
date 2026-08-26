import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  RedFormat,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_HALF_SIZE_M } from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  sampleTerrainHeightM,
  siteTerrainSeed,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'

const DETAIL_TEXTURE_SIZE = 128

interface SurfacePatchProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
  readonly segments: number
  readonly terrain: SurfaceTerrainProfile
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function createSurfaceDetailTexture(site: LandingSite): DataTexture {
  const random = createRandom(siteTerrainSeed(site, 0x5a7face))
  const data = new Uint8Array(DETAIL_TEXTURE_SIZE * DETAIL_TEXTURE_SIZE)

  for (let index = 0; index < data.length; index += 1) {
    const grain = (random() - 0.5) * 25
    const fleck = random() > 0.984 ? (random() - 0.5) * 56 : 0
    data[index] = Math.round(Math.max(48, Math.min(212, 132 + grain + fleck)))
  }

  const texture = new DataTexture(
    data,
    DETAIL_TEXTURE_SIZE,
    DETAIL_TEXTURE_SIZE,
    RedFormat,
  )
  texture.magFilter = LinearFilter
  texture.name = 'procedural-lunar-surface-detail'
  texture.needsUpdate = true
  return texture
}

function createSurfaceGeometry(
  terrain: SurfaceTerrainProfile,
  segments: number,
): BufferGeometry {
  const vertexCount = (segments + 1) * (segments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices: number[] = []
  const shadow = new Color('#545c65')
  const midtone = new Color('#9299a1')
  const highlight = new Color('#bdc1c4')
  const temporaryColor = new Color()

  for (let row = 0; row <= segments; row += 1) {
    const zM = ((row / segments) * 2 - 1) * LOCAL_SURFACE_HALF_SIZE_M

    for (let column = 0; column <= segments; column += 1) {
      const xM = ((column / segments) * 2 - 1) * LOCAL_SURFACE_HALF_SIZE_M
      const index = row * (segments + 1) + column
      const offset = index * 3
      const sample = localSurfaceToRender(terrain, xM, zM)
      const reliefM = sampleTerrainHeightM(terrain, xM, zM)
      const tone = Math.max(0, Math.min(1, 0.48 + reliefM * 0.12))

      positions[offset] = sample.x
      positions[offset + 1] = sample.y
      positions[offset + 2] = sample.z
      temporaryColor
        .copy(tone < 0.5 ? shadow : midtone)
        .lerp(
          tone < 0.5 ? midtone : highlight,
          tone < 0.5 ? tone * 2 : (tone - 0.5) * 2,
        )
      colors[offset] = temporaryColor.r
      colors[offset + 1] = temporaryColor.g
      colors[offset + 2] = temporaryColor.b
      uvs[index * 2] = column / segments
      uvs[index * 2 + 1] = 1 - row / segments
    }
  }

  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const topLeft = row * (segments + 1) + column
      const topRight = topLeft + 1
      const bottomLeft = (row + 1) * (segments + 1) + column
      const bottomRight = bottomLeft + 1
      indices.push(
        topLeft,
        bottomLeft,
        topRight,
        topRight,
        bottomLeft,
        bottomRight,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export function SurfacePatch({
  site,
  phase,
  segments,
  terrain,
}: SurfacePatchProps) {
  const materialRef = useRef<MeshStandardMaterial>(null)
  const progressRef = useCinematicProgress()
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const geometry = useMemo(
    () => createSurfaceGeometry(terrain, segments),
    [segments, terrain],
  )
  const detailTexture = useMemo(() => createSurfaceDetailTexture(site), [site])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => detailTexture.dispose(), [detailTexture])

  useFrame(() => {
    const material = materialRef.current

    if (material === null) {
      return
    }

    const progress =
      phase === 'landed' || phase === 'returning' ? 1 : progressRef.current
    const reveal = Math.max(0, Math.min(1, (progress - 0.5) / 0.2))
    material.opacity = smoothstep(reveal)
    material.depthWrite = reveal > 0.96
  })

  return (
    <group
      position={transform.position}
      quaternion={transform.orientation}
      visible={
        phase === 'approach' || phase === 'landed' || phase === 'returning'
      }
    >
      <mesh geometry={geometry} receiveShadow renderOrder={1}>
        <meshStandardMaterial
          ref={materialRef}
          bumpMap={detailTexture}
          bumpScale={0.000055}
          color="#9aa0a7"
          emissive="#101721"
          emissiveIntensity={0.55}
          metalness={0}
          opacity={phase === 'landed' ? 1 : 0}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          roughness={1}
          transparent
          vertexColors
        />
      </mesh>
    </group>
  )
}
