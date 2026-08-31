import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Vector3,
} from 'three'
import type { LunarScarSnapshot } from '../domain/firstStrike.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

export const PERMANENT_SCAR_RADIUS = 0.052
export const PERMANENT_SCAR_CLEARANCE = 0.000012
export const PERMANENT_SCAR_VERTICAL_SCALE = 0.012
export const PERMANENT_SCAR_FLOOR_HEIGHT =
  PERMANENT_SCAR_CLEARANCE + 0.00002
export const PERMANENT_SCAR_DEPTH = 0.000388
const CRATER_SECTORS = 42
const WRECKAGE_COUNT = 7
const RUBBLE_COUNT = 16
const RIM_CHUNK_COUNT = 14
const THERMAL_POINT_COUNT = 4
const DETAIL_DISTANCE = 0.72

interface PermanentLunarScarProps {
  readonly scar: LunarScarSnapshot
  readonly focused: boolean
  readonly terrain: SurfaceTerrainProfile
  readonly terrainSegments: number
}

interface CraterRing {
  readonly radius: number
  readonly lift: number
  readonly color: string
  readonly irregularity: number
}

const CRATER_RINGS: readonly CraterRing[] = Object.freeze([
  { radius: 0.22, lift: 0.00003, color: VISUAL_PALETTE.damageFloor, irregularity: 0.08 },
  { radius: 0.45, lift: 0.000045, color: VISUAL_PALETTE.damageChar, irregularity: 0.075 },
  { radius: 0.64, lift: 0.0003, color: VISUAL_PALETTE.damageHeat, irregularity: 0.08 },
  { radius: 0.8, lift: 0.0017, color: VISUAL_PALETTE.damageRim, irregularity: 0.1 },
  { radius: 0.98, lift: 0.00055, color: VISUAL_PALETTE.damageRim, irregularity: 0.085 },
  { radius: 1.14, lift: 0.000018, color: VISUAL_PALETTE.damageChar, irregularity: 0.1 },
])

/** Height of the unit Moon beneath a point in the site's tangent frame. */
export function lunarSphereTangentHeight(x: number, z: number): number {
  return Math.sqrt(Math.max(0, 1 - x * x - z * z)) - 1
}

function scarSurfaceHeight(x: number, z: number, lift: number): number {
  return lunarSphereTangentHeight(x, z) + lift
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function seedForScar(scar: LunarScarSnapshot): number {
  return (
    Math.round(scar.site.location.latitudeRad * 10_000_000) ^
    Math.round(scar.site.location.longitudeRad * 10_000_000) ^
    0x9f03_82d7
  ) >>> 0
}

function appendColor(target: number[], source: Color, brightness: number): void {
  target.push(
    Math.min(1, source.r * brightness),
    Math.min(1, source.g * brightness),
    Math.min(1, source.b * brightness),
  )
}

function liftedDamageColor(source: string, amount: number): Color {
  return new Color(source).lerp(new Color(VISUAL_PALETTE.lunarMid), amount)
}

function rimBreakFactor(index: number): number {
  if ((index >= 5 && index <= 8) || (index >= 23 && index <= 26)) {
    return 0.34
  }

  if (index === 16 || index === 17 || index === 35) {
    return 0.58
  }

  return 1
}

export function calculatePermanentScarFloorHeight(
  renderedTerrainHeight: number,
): number {
  return Math.max(
    PERMANENT_SCAR_FLOOR_HEIGHT,
    renderedTerrainHeight - PERMANENT_SCAR_DEPTH,
  )
}

export function createCraterGeometry(
  seed: number,
  floorHeight = PERMANENT_SCAR_FLOOR_HEIGHT,
): BufferGeometry {
  const random = createRandom(seed)
  const radialNoise = CRATER_RINGS.map(() =>
    Array.from({ length: CRATER_SECTORS }, () => random() * 2 - 1),
  )
  const heightNoise = CRATER_RINGS.map(() =>
    Array.from({ length: CRATER_SECTORS }, () => random() * 2 - 1),
  )
  const positions: number[] = [0, floorHeight, 0]
  const colors: number[] = []
  const indices: number[] = []
  appendColor(
    colors,
    liftedDamageColor(VISUAL_PALETTE.damageFloor, 0.08),
    0.9,
  )

  CRATER_RINGS.forEach((ring, ringIndex) => {
    const lift = [0.08, 0.12, 0.16, 0.3, 0.38, 0.34][ringIndex] ?? 0.12
    const baseColor = liftedDamageColor(ring.color, lift)

    for (let index = 0; index <= CRATER_SECTORS; index += 1) {
      const wrapped = index % CRATER_SECTORS
      const angle = (wrapped / CRATER_SECTORS) * Math.PI * 2
      const wave = Math.sin(angle * 3 + ringIndex * 0.7) * 0.018
      const radius =
        ring.radius *
        (1 + radialNoise[ringIndex]![wrapped]! * ring.irregularity + wave)
      const breakFactor = ringIndex === 3 ? rimBreakFactor(wrapped) : 1
      const x = Math.cos(angle) * radius * PERMANENT_SCAR_RADIUS
      const z = Math.sin(angle) * radius * PERMANENT_SCAR_RADIUS
      const liftNoise =
        heightNoise[ringIndex]![wrapped]! *
        (ringIndex === 3 ? 0.000075 : 0.000018)
      const lift = Math.max(
        PERMANENT_SCAR_CLEARANCE,
        ring.lift * breakFactor + liftNoise,
      )
      positions.push(x, scarSurfaceHeight(x, z, lift), z)
      appendColor(
        colors,
        baseColor,
        1 + heightNoise[ringIndex]![wrapped]! * 0.1,
      )
    }
  })

  const firstRingStart = 1
  for (let index = 0; index < CRATER_SECTORS; index += 1) {
    indices.push(0, firstRingStart + index + 1, firstRingStart + index)
  }

  const verticesPerRing = CRATER_SECTORS + 1
  for (let ringIndex = 0; ringIndex < CRATER_RINGS.length - 1; ringIndex += 1) {
    const innerStart = 1 + ringIndex * verticesPerRing
    const outerStart = innerStart + verticesPerRing

    for (let index = 0; index < CRATER_SECTORS; index += 1) {
      const inner = innerStart + index
      const outer = outerStart + index
      indices.push(inner, outer + 1, outer, inner, inner + 1, outer + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function appendEjectaPatch(
  positions: number[],
  colors: number[],
  indices: number[],
  angle: number,
  startRadius: number,
  endRadius: number,
  startWidth: number,
  endWidth: number,
  bend: number,
  startLift: number,
  endLift: number,
  color: Color,
): void {
  const radialX = Math.cos(angle)
  const radialZ = Math.sin(angle)
  const tangentX = -Math.sin(angle)
  const tangentZ = Math.cos(angle)
  const vertexStart = positions.length / 3
  const endCenterX = radialX * endRadius + tangentX * bend
  const endCenterZ = radialZ * endRadius + tangentZ * bend

  const vertices = [
    [radialX * startRadius + tangentX * startWidth, radialZ * startRadius + tangentZ * startWidth, startLift],
    [radialX * startRadius - tangentX * startWidth, radialZ * startRadius - tangentZ * startWidth, startLift * 0.92],
    [endCenterX + tangentX * endWidth, endCenterZ + tangentZ * endWidth, endLift],
    [endCenterX - tangentX * endWidth, endCenterZ - tangentZ * endWidth, endLift * 0.9],
  ] as const

  for (const [normalizedX, normalizedZ, lift] of vertices) {
    const x = normalizedX * PERMANENT_SCAR_RADIUS
    const z = normalizedZ * PERMANENT_SCAR_RADIUS
    positions.push(
      x,
      scarSurfaceHeight(x, z, Math.max(PERMANENT_SCAR_CLEARANCE, lift)),
      z,
    )
  }
  appendColor(colors, color, 0.94)
  appendColor(colors, color, 0.78)
  appendColor(colors, color, 0.72)
  appendColor(colors, color, 0.6)
  indices.push(
    vertexStart,
    vertexStart + 1,
    vertexStart + 2,
    vertexStart + 2,
    vertexStart + 1,
    vertexStart + 3,
  )
}

export function createEjectaGeometry(seed: number): BufferGeometry {
  const random = createRandom(seed ^ 0x67d2_14ab)
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const charColor = liftedDamageColor(VISUAL_PALETTE.damageChar, 0.28)
  const rimColor = liftedDamageColor(VISUAL_PALETTE.damageRim, 0.34)
  const heatColor = liftedDamageColor(VISUAL_PALETTE.damageHeat, 0.24)
  const rayCount = 9

  for (let index = 0; index < rayCount; index += 1) {
    const angle =
      (index / rayCount) * Math.PI * 2 + (random() - 0.5) * 0.46
    const start = 0.96 + random() * 0.14
    const end = 1.2 + random() * 0.34
    const split = start + (end - start) * (0.34 + random() * 0.18)
    const width = 0.085 + random() * 0.095
    const bend = (random() - 0.5) * 0.18
    const color = index % 4 === 0 ? heatColor : index % 3 === 0 ? rimColor : charColor

    appendEjectaPatch(
      positions,
      colors,
      indices,
      angle,
      start,
      split,
      width,
      width * (0.52 + random() * 0.16),
      bend * 0.34,
      0.000055 + random() * 0.000018,
      0.000026 + random() * 0.000012,
      color,
    )

    if (index % 3 !== 1) {
      const gap = 0.045 + random() * 0.08
      appendEjectaPatch(
        positions,
        colors,
        indices,
        angle + (random() - 0.5) * 0.035,
        split + gap,
        end,
        width * (0.38 + random() * 0.14),
        width * (0.22 + random() * 0.18),
        bend,
        0.000024 + random() * 0.000008,
        0.000015 + random() * 0.000005,
        color,
      )
    }
  }

  for (let index = 0; index < 7; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 1.08 + random() * 0.58
    const size = 0.025 + random() * 0.055
    const centerX = Math.cos(angle) * radius
    const centerZ = Math.sin(angle) * radius
    const vertexStart = positions.length / 3
    const patchVertices = [
      [centerX - size, centerZ - size * 0.35, 0.000022],
      [centerX + size * 0.72, centerZ - size * 0.62, 0.000016],
      [centerX + size * 0.18, centerZ + size, 0.000025],
    ] as const
    for (const [normalizedX, normalizedZ, lift] of patchVertices) {
      const x = normalizedX * PERMANENT_SCAR_RADIUS
      const z = normalizedZ * PERMANENT_SCAR_RADIUS
      positions.push(x, scarSurfaceHeight(x, z, lift), z)
    }
    const patchColor = index % 2 === 0 ? rimColor : charColor
    appendColor(colors, patchColor, 0.72)
    appendColor(colors, patchColor, 0.6)
    appendColor(colors, patchColor, 0.82)
    indices.push(vertexStart, vertexStart + 1, vertexStart + 2)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function PermanentLunarScar({
  scar,
  focused,
  terrain,
  terrainSegments,
}: PermanentLunarScarProps) {
  const gl = useThree((state) => state.gl)
  const projectedRef = useRef(new Vector3())
  const cameraDirectionRef = useRef(new Vector3())
  const detailRef = useRef<Group>(null)
  const wreckageRef = useRef<InstancedMesh>(null)
  const rubbleRef = useRef<InstancedMesh>(null)
  const rimChunkRef = useRef<InstancedMesh>(null)
  const thermalRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const transform = useMemo(
    () => landingSiteToRenderTransform(scar.site),
    [scar.site],
  )
  const position = useMemo(
    () => transform.position.clone(),
    [transform.position],
  )
  const seed = useMemo(() => seedForScar(scar), [scar])
  const floorHeight = useMemo(
    () =>
      calculatePermanentScarFloorHeight(
        sampleRenderedSurface(terrain, terrainSegments, 0, 0).y,
      ),
    [terrain, terrainSegments],
  )
  const craterGeometry = useMemo(
    () => createCraterGeometry(seed, floorHeight),
    [floorHeight, seed],
  )
  const ejectaGeometry = useMemo(() => createEjectaGeometry(seed), [seed])
  const wreckageGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const rubbleGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const thermalGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const craterMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#b8b3ad',
        ...MATERIAL_RESPONSE.lunar,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: DoubleSide,
        vertexColors: true,
      }),
    [],
  )
  const wreckageMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalWreck,
        emissive: VISUAL_PALETTE.rivalCyanPanel,
        emissiveIntensity: 0.035,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
    [],
  )
  const rubbleMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.damageRim,
        ...MATERIAL_RESPONSE.lunar,
        flatShading: true,
      }),
    [],
  )
  const thermalMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.damageHeat,
        emissive: VISUAL_PALETTE.damageEmber,
        emissiveIntensity: focused ? EMISSIVE_LIMITS.residualHeat : 0.14,
        metalness: 0.08,
        roughness: 0.82,
      }),
    [focused],
  )

  useLayoutEffect(() => {
    const wreckage = wreckageRef.current
    const rubble = rubbleRef.current
    const rimChunks = rimChunkRef.current
    const thermal = thermalRef.current
    if (
      wreckage === null ||
      rubble === null ||
      rimChunks === null ||
      thermal === null
    ) return

    const dummy = dummyRef.current
    const wreckageDefinitions = [
      { position: [-0.28, 0.06, 0.08] as const, rotation: [0.14, 0.48, -0.54] as const, scale: [0.34, 0.055, 0.095] as const },
      { position: [0.2, 0.045, -0.18] as const, rotation: [-0.22, -0.31, 0.38] as const, scale: [0.26, 0.045, 0.08] as const },
      { position: [0.42, 0.03, 0.09] as const, rotation: [0.08, 0.92, -0.3] as const, scale: [0.19, 0.035, 0.055] as const },
      { position: [-0.08, 0.03, -0.34] as const, rotation: [0.38, -0.62, 0.12] as const, scale: [0.22, 0.04, 0.06] as const },
      { position: [-0.48, 0.04, -0.18] as const, rotation: [-0.18, 0.24, 0.72] as const, scale: [0.3, 0.038, 0.052] as const },
      { position: [0.05, 0.028, 0.3] as const, rotation: [0.3, -0.44, -0.16] as const, scale: [0.16, 0.032, 0.11] as const },
      { position: [0.5, 0.05, -0.3] as const, rotation: [-0.16, 0.7, 0.46] as const, scale: [0.24, 0.036, 0.048] as const },
    ]

    wreckageDefinitions.forEach((definition, index) => {
      const x = definition.position[0] * PERMANENT_SCAR_RADIUS
      const z = definition.position[2] * PERMANENT_SCAR_RADIUS
      dummy.position.set(
        x,
        scarSurfaceHeight(
          x,
          z,
          definition.position[1] * PERMANENT_SCAR_VERTICAL_SCALE,
        ),
        z,
      )
      dummy.rotation.set(
        definition.rotation[0],
        definition.rotation[1],
        definition.rotation[2],
      )
      dummy.scale.set(
        definition.scale[0] * PERMANENT_SCAR_RADIUS,
        definition.scale[1] * PERMANENT_SCAR_VERTICAL_SCALE,
        definition.scale[2] * PERMANENT_SCAR_RADIUS,
      )
      dummy.updateMatrix()
      wreckage.setMatrixAt(index, dummy.matrix)
    })
    wreckage.instanceMatrix.needsUpdate = true

    const random = createRandom(seed ^ 0x41ce_8a25)
    for (let index = 0; index < RUBBLE_COUNT; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = 0.28 + random() * 0.66
      const size = 0.018 + random() * 0.038
      const x = Math.cos(angle) * radius * PERMANENT_SCAR_RADIUS
      const z = Math.sin(angle) * radius * PERMANENT_SCAR_RADIUS
      dummy.position.set(
        x,
        scarSurfaceHeight(
          x,
          z,
          (0.025 + random() * 0.075) * PERMANENT_SCAR_VERTICAL_SCALE,
        ),
        z,
      )
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      dummy.scale.set(
        size * 1.4 * PERMANENT_SCAR_RADIUS,
        size * 0.72 * PERMANENT_SCAR_VERTICAL_SCALE,
        size * PERMANENT_SCAR_RADIUS,
      )
      dummy.updateMatrix()
      rubble.setMatrixAt(index, dummy.matrix)
    }
    rubble.instanceMatrix.needsUpdate = true

    const rimRandom = createRandom(seed ^ 0x75e3_20c1)
    for (let index = 0; index < RIM_CHUNK_COUNT; index += 1) {
      const angle =
        (index / RIM_CHUNK_COUNT) * Math.PI * 2 +
        (rimRandom() - 0.5) * 0.22
      const radius = 0.74 + rimRandom() * 0.12
      const collapsed = index === 3 || index === 9 || index === 10
      const x = Math.cos(angle) * radius * PERMANENT_SCAR_RADIUS
      const z = Math.sin(angle) * radius * PERMANENT_SCAR_RADIUS
      dummy.position.set(
        x,
        scarSurfaceHeight(
          x,
          z,
          (collapsed ? 0.075 : 0.1 + rimRandom() * 0.045) *
            PERMANENT_SCAR_VERTICAL_SCALE,
        ),
        z,
      )
      dummy.rotation.set(
        rimRandom() * 0.7,
        -angle + rimRandom() * 0.35,
        (rimRandom() - 0.5) * 0.6,
      )
      dummy.scale.set(
        (0.05 + rimRandom() * 0.055) * PERMANENT_SCAR_RADIUS,
        (collapsed ? 0.035 : 0.08 + rimRandom() * 0.06) *
          PERMANENT_SCAR_VERTICAL_SCALE,
        (0.1 + rimRandom() * 0.11) * PERMANENT_SCAR_RADIUS,
      )
      dummy.updateMatrix()
      rimChunks.setMatrixAt(index, dummy.matrix)
    }
    rimChunks.instanceMatrix.needsUpdate = true

    const thermalDefinitions = [
      [-0.18, 0.06, 0.02, 0.025],
      [0.15, 0.05, -0.12, 0.018],
      [0.38, 0.09, 0.08, 0.014],
      [-0.42, 0.11, -0.16, 0.012],
    ] as const
    thermalDefinitions.forEach((definition, index) => {
      const x = definition[0] * PERMANENT_SCAR_RADIUS
      const z = definition[2] * PERMANENT_SCAR_RADIUS
      dummy.position.set(
        x,
        scarSurfaceHeight(
          x,
          z,
          definition[1] * PERMANENT_SCAR_VERTICAL_SCALE,
        ),
        z,
      )
      dummy.rotation.set(0, index * 0.72, 0)
      dummy.scale.set(
        definition[3] * PERMANENT_SCAR_RADIUS,
        definition[3] * PERMANENT_SCAR_VERTICAL_SCALE,
        definition[3] * PERMANENT_SCAR_RADIUS,
      )
      dummy.updateMatrix()
      thermal.setMatrixAt(index, dummy.matrix)
    })
    thermal.instanceMatrix.needsUpdate = true
  }, [seed])

  useEffect(
    () => () => {
      craterGeometry.dispose()
      ejectaGeometry.dispose()
      wreckageGeometry.dispose()
      rubbleGeometry.dispose()
      thermalGeometry.dispose()
      craterMaterial.dispose()
      wreckageMaterial.dispose()
      rubbleMaterial.dispose()
      thermalMaterial.dispose()
      delete gl.domElement.dataset.scarX
      delete gl.domElement.dataset.scarY
      delete gl.domElement.dataset.scarFacingCamera
    }, [
      craterGeometry,
      craterMaterial,
      ejectaGeometry,
      gl,
      rubbleGeometry,
      rubbleMaterial,
      thermalGeometry,
      thermalMaterial,
      wreckageGeometry,
      wreckageMaterial,
    ],
  )

  useFrame((state) => {
    const detail = detailRef.current
    const projected = projectedRef.current.copy(position).project(state.camera)
    const cameraDirection = cameraDirectionRef.current
      .copy(state.camera.position)
      .normalize()
    if (detail !== null) {
      detail.visible =
        focused ||
        state.camera.position.distanceToSquared(position) < DETAIL_DISTANCE ** 2
    }
    if (focused) {
      thermalMaterial.emissiveIntensity = Math.min(
        EMISSIVE_LIMITS.residualHeat,
        0.23 + Math.sin(state.clock.elapsedTime * 2.4) * 0.045,
      )
    }
    gl.domElement.dataset.scarX = String(
      Math.round((projected.x * 0.5 + 0.5) * state.size.width),
    )
    gl.domElement.dataset.scarY = String(
      Math.round((-projected.y * 0.5 + 0.5) * state.size.height),
    )
    gl.domElement.dataset.scarFacingCamera = String(
      transform.up.dot(cameraDirection) > 0,
    )
  })

  return (
    <group position={position} quaternion={transform.orientation}>
      <group>
        <mesh
          geometry={ejectaGeometry}
          material={craterMaterial}
          receiveShadow
        />
        <mesh
          geometry={craterGeometry}
          material={craterMaterial}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={rimChunkRef}
          args={[rubbleGeometry, rubbleMaterial, RIM_CHUNK_COUNT]}
          castShadow
        />

        <group ref={detailRef}>
          <instancedMesh
            ref={wreckageRef}
            args={[wreckageGeometry, wreckageMaterial, WRECKAGE_COUNT]}
            castShadow
          />
          <instancedMesh
            ref={rubbleRef}
            args={[rubbleGeometry, rubbleMaterial, RUBBLE_COUNT]}
            castShadow
          />
          <instancedMesh
            ref={thermalRef}
            args={[thermalGeometry, thermalMaterial, THERMAL_POINT_COUNT]}
          />
        </group>
      </group>
    </group>
  )
}
