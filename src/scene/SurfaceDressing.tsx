import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  PointsMaterial,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { DEPOSIT_BLUEPRINTS, ROBOT_IDLE_POSITION } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  siteTerrainSeed,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'

interface SurfaceDressingProps {
  readonly site: LandingSite
  readonly terrain: SurfaceTerrainProfile
  readonly rockCount: number
}

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
    const distanceM = 7 + Math.pow(random(), 0.72) * 150
    const xM = Math.cos(angle) * distanceM
    const zM = Math.sin(angle) * distanceM
    const scaleM =
      0.34 +
      Math.pow(random(), 2.2) * (distanceM < 48 ? 1.25 : 2.35)

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

function createDustGeometry(site: LandingSite): BufferGeometry {
  const random = createRandom(siteTerrainSeed(site, 0xd0575))
  const positions = new Float32Array(54 * 3)

  for (let index = 0; index < 54; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2
    const distanceM = 5 + random() * 74

    positions[offset] =
      Math.cos(angle) * distanceM * LOCAL_METRES_TO_RENDER_UNITS
    positions[offset + 1] =
      LOCAL_SURFACE_RENDER_OFFSET +
      (0.16 + random() * 2.1) * LOCAL_METRES_TO_RENDER_UNITS
    positions[offset + 2] =
      Math.sin(angle) * distanceM * LOCAL_METRES_TO_RENDER_UNITS
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

export function SurfaceDressing({
  site,
  terrain,
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
        color: '#6f767e',
        metalness: 0.03,
        roughness: 1,
      }),
    [],
  )
  const ridgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#5f666e',
        metalness: 0.02,
        roughness: 1,
      }),
    [],
  )
  const dustGeometry = useMemo(() => createDustGeometry(site), [site])
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
        const sample = localSurfaceToRender(terrain, placement.xM, placement.zM)
        const scale = placement.scaleM * LOCAL_METRES_TO_RENDER_UNITS
        dummy.position.set(
          sample.x,
          sample.y + scale * (stretched ? 0.48 : 0.62),
          sample.z,
        )
        dummy.rotation.set(
          placement.rotationX,
          placement.rotationY,
          placement.rotationZ,
        )
        dummy.scale.set(
          scale * (stretched ? 2.3 : 1.15),
          scale * (stretched ? 0.52 : 0.72),
          scale * (stretched ? 0.72 : 1),
        )
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
        color
          .set(stretched ? '#4f565e' : '#6c737b')
          .lerp(new Color('#9ba0a4'), placement.tone * 0.34)
        mesh.setColorAt(index, color)
      })
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.instanceMatrix.needsUpdate = true

      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true
      }
    }

    populate(rockRef.current, rocks, false)
    populate(ridgeRef.current, ridges, true)
  }, [ridges, rocks, terrain])

  useEffect(
    () => () => {
      rockGeometry.dispose()
      ridgeGeometry.dispose()
      rockMaterial.dispose()
      ridgeMaterial.dispose()
      dustGeometry.dispose()
      dustMaterial.dispose()
    },
    [
      dustGeometry,
      dustMaterial,
      ridgeGeometry,
      ridgeMaterial,
      rockGeometry,
      rockMaterial,
    ],
  )

  const scorchMatrix = useMemo(() => new Matrix4().makeScale(1, 1, 1), [])

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
      <mesh
        matrix={scorchMatrix}
        position-y={LOCAL_SURFACE_RENDER_OFFSET + 0.000004}
        rotation-x={-Math.PI / 2}
        scale={[0.00125, 0.00072, 1]}
      >
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial
          color="#17191d"
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
