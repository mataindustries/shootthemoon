import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PointsMaterial,
  Vector3,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS, ROBOT_IDLE_POSITION } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import {
  siteTerrainSeed,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

interface SurfaceDressingProps {
  readonly site: LandingSite
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly rockCount: number
}

const ROCK_EMBED_M = 0.012
const SCORCH_RADIUS_X_M = 0.00125 / LOCAL_METRES_TO_RENDER_UNITS
const SCORCH_RADIUS_Z_M = 0.00072 / LOCAL_METRES_TO_RENDER_UNITS
const SCORCH_CLEARANCE_M = 0.006

interface RockPlacement {
  readonly xM: number
  readonly zM: number
  readonly scaleM: number
  readonly rotationX: number
  readonly rotationY: number
  readonly rotationZ: number
  readonly stretched: boolean
  readonly tone: number
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function distanceToSegment(
  xM: number,
  zM: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX
  const deltaZ = endZ - startZ
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  const progress =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((xM - startX) * deltaX + (zM - startZ) * deltaZ) /
              lengthSquared,
          ),
        )
  return Math.hypot(
    xM - (startX + deltaX * progress),
    zM - (startZ + deltaZ * progress),
  )
}

function isClearPlacement(xM: number, zM: number, radiusM: number): boolean {
  if (Math.hypot(xM, zM) < radiusM + 6) {
    return false
  }

  for (const deposit of DEPOSIT_BLUEPRINTS) {
    if (
      Math.hypot(xM - deposit.position.xM, zM - deposit.position.zM) <
      radiusM + 3.4
    ) {
      return false
    }

    const firstLeg = distanceToSegment(
      xM,
      zM,
      ROBOT_IDLE_POSITION.xM,
      ROBOT_IDLE_POSITION.zM,
      deposit.routeControl.xM,
      deposit.routeControl.zM,
    )
    const secondLeg = distanceToSegment(
      xM,
      zM,
      deposit.routeControl.xM,
      deposit.routeControl.zM,
      deposit.position.xM,
      deposit.position.zM,
    )

    if (Math.min(firstLeg, secondLeg) < radiusM + 1.9) {
      return false
    }
  }

  return true
}

function createRockPlacements(
  site: LandingSite,
  count: number,
): readonly RockPlacement[] {
  const random = createRandom(siteTerrainSeed(site, 0x70c45))
  const placements: RockPlacement[] = []

  for (let attempt = 0; attempt < count * 14 && placements.length < count; attempt += 1) {
    const angle = random() * Math.PI * 2
    const distanceM = 7 + Math.pow(random(), 1.38) * 132
    const xM = Math.cos(angle) * distanceM
    const zM = Math.sin(angle) * distanceM
    const scaleM =
      0.3 +
      Math.pow(random(), 2.05) * (distanceM < 52 ? 1.02 : 2.1)

    if (!isClearPlacement(xM, zM, scaleM)) {
      continue
    }

    placements.push({
      xM,
      zM,
      scaleM,
      rotationX: (random() - 0.5) * 0.45,
      rotationY: random() * Math.PI * 2,
      rotationZ: (random() - 0.5) * 0.4,
      stretched: placements.length % 4 === 0,
      tone: random(),
    })
  }

  return placements
}

function createDustGeometry(
  site: LandingSite,
  terrain: SurfaceTerrainProfile,
  segments: number,
): BufferGeometry {
  const random = createRandom(siteTerrainSeed(site, 0xd0575))
  const positions = new Float32Array(54 * 3)

  for (let index = 0; index < 54; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2
    const distanceM = 5 + random() * 74
    const xM = Math.cos(angle) * distanceM
    const zM = Math.sin(angle) * distanceM
    const ground = sampleRenderedSurface(terrain, segments, xM, zM)

    positions[offset] = ground.x
    positions[offset + 1] =
      ground.y + (0.04 + random() * 0.48) * LOCAL_METRES_TO_RENDER_UNITS
    positions[offset + 2] = ground.z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

function createScorchGeometry(
  terrain: SurfaceTerrainProfile,
  segments: number,
): BufferGeometry {
  const radialSegments = 4
  const edgeSegments = 28
  const positions = new Float32Array(
    (radialSegments * edgeSegments + 1) * 3,
  )
  const indices: number[] = []
  const clearance = SCORCH_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS
  const center = sampleRenderedSurface(terrain, segments, 0, 0)
  positions[0] = center.x
  positions[1] = center.y + clearance
  positions[2] = center.z

  for (let ring = 1; ring <= radialSegments; ring += 1) {
    const radius = ring / radialSegments

    for (let index = 0; index < edgeSegments; index += 1) {
      const angle = (index / edgeSegments) * Math.PI * 2
      const xM = Math.cos(angle) * SCORCH_RADIUS_X_M * radius
      const zM = Math.sin(angle) * SCORCH_RADIUS_Z_M * radius
      const surface = sampleRenderedSurface(terrain, segments, xM, zM)
      const vertexIndex = 1 + (ring - 1) * edgeSegments + index
      const offset = vertexIndex * 3
      positions[offset] = surface.x
      positions[offset + 1] = surface.y + clearance
      positions[offset + 2] = surface.z

      const nextIndex = (index + 1) % edgeSegments

      if (ring === 1) {
        indices.push(0, 1 + nextIndex, vertexIndex)
      } else {
        const innerIndex = 1 + (ring - 2) * edgeSegments + index
        const innerNext = 1 + (ring - 2) * edgeSegments + nextIndex
        const outerNext = 1 + (ring - 1) * edgeSegments + nextIndex
        indices.push(
          innerIndex,
          innerNext,
          outerNext,
          innerIndex,
          outerNext,
          vertexIndex,
        )
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function SurfaceDressing({
  site,
  terrain,
  segments,
  rockCount,
}: SurfaceDressingProps) {
  const rockRef = useRef<InstancedMesh>(null)
  const ridgeRef = useRef<InstancedMesh>(null)
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const placements = useMemo(
    () => createRockPlacements(site, rockCount),
    [rockCount, site],
  )
  const rocks = useMemo(
    () => placements.filter((placement) => !placement.stretched),
    [placements],
  )
  const ridges = useMemo(
    () => placements.filter((placement) => placement.stretched),
    [placements],
  )
  const rockGeometry = useMemo(() => new DodecahedronGeometry(1, 0), [])
  const ridgeGeometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const rockMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#4e5255',
        metalness: 0.03,
        roughness: 1,
      }),
    [],
  )
  const ridgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#3d4246',
        metalness: 0.02,
        roughness: 1,
      }),
    [],
  )
  const dustGeometry = useMemo(
    () => createDustGeometry(site, terrain, segments),
    [segments, site, terrain],
  )
  const scorchGeometry = useMemo(
    () => createScorchGeometry(terrain, segments),
    [segments, terrain],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: '#bdc4c9',
        depthWrite: false,
        opacity: 0.18,
        size: 0.000035,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const dummy = new Object3D()
    const color = new Color()

    const populate = (
      mesh: InstancedMesh | null,
      entries: readonly RockPlacement[],
      stretched: boolean,
    ) => {
      if (mesh === null) {
        return
      }

      entries.forEach((placement, index) => {
        const sample = sampleRenderedSurface(
          terrain,
          segments,
          placement.xM,
          placement.zM,
        )
        const scale = placement.scaleM * LOCAL_METRES_TO_RENDER_UNITS
        dummy.position.set(0, 0, 0)
        dummy.rotation.set(
          placement.rotationX,
          placement.rotationY,
          placement.rotationZ,
        )
        dummy.scale.set(
          scale * (stretched ? 1.82 : 1.12),
          scale * (stretched ? 0.52 : 0.72),
          scale * (stretched ? 0.72 : 1),
        )
        dummy.updateMatrix()
        const geometry = stretched ? ridgeGeometry : rockGeometry
        const positions = geometry.getAttribute('position')
        const vertex = new Vector3()
        let groundedY = Number.NEGATIVE_INFINITY

        for (
          let vertexIndex = 0;
          vertexIndex < positions.count;
          vertexIndex += 1
        ) {
          vertex
            .fromBufferAttribute(positions, vertexIndex)
            .applyMatrix4(dummy.matrix)
          const vertexSurface = sampleRenderedSurface(
            terrain,
            segments,
            placement.xM + vertex.x / LOCAL_METRES_TO_RENDER_UNITS,
            placement.zM + vertex.z / LOCAL_METRES_TO_RENDER_UNITS,
          )
          groundedY = Math.max(groundedY, vertexSurface.y - vertex.y)
        }

        dummy.position.set(
          sample.x,
          groundedY - ROCK_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS,
          sample.z,
        )
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
        color
          .set(stretched ? '#34393d' : '#4d5154')
          .lerp(new Color('#777875'), placement.tone * 0.3)
        mesh.setColorAt(index, color)
      })
      mesh.instanceMatrix.needsUpdate = true

      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true
      }
    }

    populate(rockRef.current, rocks, false)
    populate(ridgeRef.current, ridges, true)
  }, [ridgeGeometry, ridges, rockGeometry, rocks, segments, terrain])

  useEffect(
    () => () => {
      rockGeometry.dispose()
      ridgeGeometry.dispose()
      rockMaterial.dispose()
      ridgeMaterial.dispose()
      dustGeometry.dispose()
      dustMaterial.dispose()
      scorchGeometry.dispose()
    },
    [
      dustGeometry,
      dustMaterial,
      ridgeGeometry,
      ridgeMaterial,
      rockGeometry,
      rockMaterial,
      scorchGeometry,
    ],
  )

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <instancedMesh
        ref={rockRef}
        args={[rockGeometry, rockMaterial, rocks.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={ridgeRef}
        args={[ridgeGeometry, ridgeMaterial, ridges.length]}
        castShadow
        receiveShadow
      />
      <mesh geometry={scorchGeometry}>
        <meshBasicMaterial
          color={VISUAL_PALETTE.damageChar}
          depthWrite={false}
          opacity={0.5}
          polygonOffset
          polygonOffsetFactor={-2}
          transparent
        />
      </mesh>
      <points geometry={dustGeometry} material={dustMaterial} />
    </group>
  )
}
