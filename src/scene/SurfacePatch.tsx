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
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'

const PATCH_HALF_SIZE = 0.03
const DETAIL_TEXTURE_SIZE = 128

interface Crater {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly depth: number
}

interface SurfacePatchProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
  readonly segments: number
}

interface DetailCrater {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly depth: number
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function smoothValue(value: number): number {
  return value * value * (3 - 2 * value)
}

function hashGrid(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff
}

function valueNoise(x: number, z: number, seed: number): number {
  const cellX = Math.floor(x)
  const cellZ = Math.floor(z)
  const fractionX = smoothValue(x - cellX)
  const fractionZ = smoothValue(z - cellZ)
  const lowerLeft = hashGrid(cellX, cellZ, seed)
  const lowerRight = hashGrid(cellX + 1, cellZ, seed)
  const upperLeft = hashGrid(cellX, cellZ + 1, seed)
  const upperRight = hashGrid(cellX + 1, cellZ + 1, seed)
  const lower = lowerLeft + (lowerRight - lowerLeft) * fractionX
  const upper = upperLeft + (upperRight - upperLeft) * fractionX

  return lower + (upper - lower) * fractionZ
}

function fractalNoise(x: number, z: number, seed: number): number {
  let amplitude = 0.55
  let frequency = 85
  let value = 0
  let normalization = 0

  for (let octave = 0; octave < 4; octave += 1) {
    value +=
      (valueNoise(x * frequency, z * frequency, seed + octave * 977) * 2 - 1) *
      amplitude
    normalization += amplitude
    amplitude *= 0.48
    frequency *= 2.08
  }

  return value / normalization
}

function craterRelief(x: number, z: number, craters: readonly Crater[]): number {
  let height = 0

  for (const crater of craters) {
    const distance = Math.hypot(x - crater.x, z - crater.z)
    const normalizedDistance = distance / crater.radius

    if (normalizedDistance < 0.82) {
      const bowl = 1 - normalizedDistance / 0.82
      height -= crater.depth * bowl * bowl
    } else if (normalizedDistance < 1.28) {
      const rimDistance = (normalizedDistance - 1) / 0.28
      height +=
        crater.depth *
        0.46 *
        Math.exp(-rimDistance * rimDistance * 4.2)
    }
  }

  return height
}

function createSurfaceDetailTexture(site: LandingSite): DataTexture {
  const seed =
    (Math.round(site.location.latitudeRad * 10_000_000) ^
      Math.round(site.location.longitudeRad * 10_000_000) ^
      0x5a7face) >>>
    0
  const random = createRandom(seed)
  const craters: DetailCrater[] = []
  const data = new Uint8Array(DETAIL_TEXTURE_SIZE * DETAIL_TEXTURE_SIZE)

  for (let index = 0; index < 38; index += 1) {
    craters.push({
      x: random() * 2 - 1,
      z: random() * 2 - 1,
      radius: 0.018 + random() * 0.075,
      depth: 0.14 + random() * 0.2,
    })
  }

  for (let row = 0; row < DETAIL_TEXTURE_SIZE; row += 1) {
    const z = (row / (DETAIL_TEXTURE_SIZE - 1)) * 2 - 1

    for (let column = 0; column < DETAIL_TEXTURE_SIZE; column += 1) {
      const x = (column / (DETAIL_TEXTURE_SIZE - 1)) * 2 - 1
      let height =
        fractalNoise(x * 0.047, z * 0.047, seed + 313) * 0.2 +
        fractalNoise(x * 0.19, z * 0.19, seed + 977) * 0.08

      for (const crater of craters) {
        const normalizedDistance =
          Math.hypot(x - crater.x, z - crater.z) / crater.radius

        if (normalizedDistance < 0.78) {
          const bowl = 1 - normalizedDistance / 0.78
          height -= crater.depth * bowl * bowl
        } else if (normalizedDistance < 1.2) {
          const rim = (normalizedDistance - 0.98) / 0.22
          height += crater.depth * 0.34 * Math.exp(-rim * rim * 4)
        }
      }

      data[row * DETAIL_TEXTURE_SIZE + column] = Math.round(
        Math.max(0, Math.min(255, 136 + height * 190)),
      )
    }
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

function createSurfaceGeometry(site: LandingSite, segments: number): BufferGeometry {
  const seed =
    (Math.round((site.location.latitudeRad + Math.PI / 2) * 1_000_000) ^
      Math.round((site.location.longitudeRad + Math.PI) * 1_000_000)) >>>
    0
  const random = createRandom(seed)
  const craters: Crater[] = []

  for (let index = 0; index < 26; index += 1) {
    const radius = 0.00065 + random() * 0.0026
    craters.push({
      x: (random() * 2 - 1) * (PATCH_HALF_SIZE - radius),
      z: (random() * 2 - 1) * (PATCH_HALF_SIZE - radius),
      radius,
      depth: radius * (0.045 + random() * 0.04),
    })
  }

  craters.push(
    { x: -0.0064, z: 0.0042, radius: 0.0048, depth: 0.00034 },
    { x: 0.0068, z: -0.0028, radius: 0.0033, depth: 0.00024 },
    { x: 0.0024, z: 0.009, radius: 0.0021, depth: 0.00015 },
  )

  const vertexCount = (segments + 1) * (segments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices: number[] = []
  const dark = new Color('#747a81')
  const light = new Color('#b8bcc1')
  const temporaryColor = new Color()

  const reliefAt = (x: number, z: number) =>
    fractalNoise(x, z, seed) * 0.000025 + craterRelief(x, z, craters)
  const centerRelief = reliefAt(0, 0)

  for (let row = 0; row <= segments; row += 1) {
    const z = ((row / segments) * 2 - 1) * PATCH_HALF_SIZE

    for (let column = 0; column <= segments; column += 1) {
      const x = ((column / segments) * 2 - 1) * PATCH_HALF_SIZE
      const index = row * (segments + 1) + column
      const offset = index * 3
      const edgeDistance = Math.max(Math.abs(x), Math.abs(z)) / PATCH_HALF_SIZE
      const edgeBlend = smoothValue(Math.max(0, 1 - edgeDistance))
      const relief = (reliefAt(x, z) - centerRelief) * edgeBlend
      const sphereCurve = Math.sqrt(Math.max(0, 1 - x * x - z * z)) - 1
      const height =
        sphereCurve +
        (LOCAL_SURFACE_RENDER_OFFSET + relief) * edgeBlend
      const colorMix = Math.max(
        0,
        Math.min(1, 0.5 + relief / 0.00016 + fractalNoise(x, z, seed + 41) * 0.1),
      )

      positions[offset] = x
      positions[offset + 1] = height
      positions[offset + 2] = z
      temporaryColor.copy(dark).lerp(light, colorMix)
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

export function SurfacePatch({
  site,
  phase,
  segments,
}: SurfacePatchProps) {
  const materialRef = useRef<MeshStandardMaterial>(null)
  const progressRef = useCinematicProgress()
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const geometry = useMemo(
    () => createSurfaceGeometry(site, segments),
    [segments, site],
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
    material.opacity = smoothValue(reveal)
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
          bumpScale={0.000075}
          color="#a5a9ae"
          emissive="#111821"
          emissiveIntensity={0.7}
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
