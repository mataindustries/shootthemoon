import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Color,
  CylinderGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { canConstructExtractor } from '../simulation/outpostSimulation.ts'
import { isSimulationTimePaused } from '../simulation/simulationTime.ts'

const CRYSTALS_PER_DEPOSIT = 3
const TAP_DISTANCE_PX = 10

interface MineralDepositsProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly selectedDepositId: string | null
  readonly interactive: boolean
  readonly onSelect: (depositId: string) => void
}

interface PlacementFootprintProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly selectedDepositId: string | null
}

function PlacementFootprint({
  outpost,
  terrain,
  selectedDepositId,
}: PlacementFootprintProps) {
  const deposit =
    selectedDepositId === null
      ? null
      : outpost.deposits.find((candidate) => candidate.id === selectedDepositId) ??
        null

  if (
    deposit === null ||
    !canConstructExtractor(outpost, deposit.id)
  ) {
    return null
  }

  const sample = localSurfaceToRender(
    terrain,
    deposit.position.xM,
    deposit.position.zM,
  )

  return (
    <group
      position={[sample.x, sample.y + 0.000012, sample.z]}
      rotation-y={deposit.orientationRad}
    >
      <mesh rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.00032, 0.00036, 6]} />
        <meshBasicMaterial
          color="#ff9a58"
          depthWrite={false}
          opacity={0.54}
          transparent
        />
      </mesh>
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((rotation) => (
        <mesh key={rotation} rotation-y={rotation} position-z={0.0004}>
          <boxGeometry args={[0.00008, 0.000012, 0.00017]} />
          <meshBasicMaterial color="#e16b32" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

export function MineralDeposits({
  outpost,
  terrain,
  selectedDepositId,
  interactive,
  onSelect,
}: MineralDepositsProps) {
  const crystalRef = useRef<InstancedMesh>(null)
  const indicatorRef = useRef<InstancedMesh>(null)
  const beamRef = useRef<InstancedMesh>(null)
  const projectedPointRef = useRef(new Vector3())
  const indicatorDummyRef = useRef(new Object3D())
  const indicatorColorRef = useRef(new Color())
  const invalidate = useThree((state) => state.invalidate)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const crystalGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const indicatorGeometry = useMemo(
    () => new TorusGeometry(1, 0.045, 6, 28),
    [],
  )
  const beamGeometry = useMemo(
    () => new CylinderGeometry(0.08, 0.34, 1.8, 8, 1, true),
    [],
  )
  const hitGeometry = useMemo(() => new SphereGeometry(1, 8, 6), [])
  const hitMaterial = useMemo(
    () => new MeshBasicMaterial({ visible: false }),
    [],
  )
  const crystalsVisible = outpost.stage !== 'capsule-landed'
  const isE2e = useMemo(
    () => new URLSearchParams(window.location.search).has('e2e'),
    [],
  )

  useLayoutEffect(() => {
    const mesh = crystalRef.current

    if (mesh === null) {
      return
    }

    const dummy = new Object3D()
    const depletedColor = new Color('#665f58')
    const oreColor = new Color('#d8b284')

    outpost.deposits.forEach((deposit, depositIndex) => {
      const sample = localSurfaceToRender(
        terrain,
        deposit.position.xM,
        deposit.position.zM,
      )
      const yieldRatio = deposit.remainingYield / deposit.initialYield
      const occupiedScale =
        outpost.extractor?.depositId === deposit.id ? 0.46 : 1

      for (let crystalIndex = 0; crystalIndex < CRYSTALS_PER_DEPOSIT; crystalIndex += 1) {
        const instanceIndex =
          depositIndex * CRYSTALS_PER_DEPOSIT + crystalIndex
        const angle =
          deposit.orientationRad + crystalIndex * ((Math.PI * 2) / 3)
        const offsetM = crystalIndex === 0 ? 0 : 0.5
        const sizeM =
          (crystalIndex === 0 ? 0.92 : 0.6) *
          (0.58 + yieldRatio * 0.42) *
          occupiedScale
        const scale = sizeM * LOCAL_METRES_TO_RENDER_UNITS
        dummy.position.set(
          sample.x + Math.sin(angle) * offsetM * LOCAL_METRES_TO_RENDER_UNITS,
          sample.y + scale * 0.78,
          sample.z + Math.cos(angle) * offsetM * LOCAL_METRES_TO_RENDER_UNITS,
        )
        dummy.rotation.set(0.12 * crystalIndex, angle, 0.16 - crystalIndex * 0.1)
        dummy.scale.set(scale * 0.68, scale * 1.45, scale * 0.68)
        dummy.updateMatrix()
        mesh.setMatrixAt(instanceIndex, dummy.matrix)
        mesh.setColorAt(
          instanceIndex,
          depletedColor.clone().lerp(oreColor, 0.3 + yieldRatio * 0.7),
        )
      }
    })

    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [crystalsVisible, outpost.deposits, outpost.extractor, terrain])

  useEffect(() => {
    if (!crystalsVisible) {
      return
    }

    const timer = window.setInterval(() => {
      if (!isSimulationTimePaused()) {
        invalidate()
      }
    }, 180)
    return () => window.clearInterval(timer)
  }, [crystalsVisible, invalidate])

  useEffect(
    () => () => {
      crystalGeometry.dispose()
      indicatorGeometry.dispose()
      beamGeometry.dispose()
      hitGeometry.dispose()
      hitMaterial.dispose()
    },
    [
      beamGeometry,
      crystalGeometry,
      hitGeometry,
      hitMaterial,
      indicatorGeometry,
    ],
  )

  useFrame((state) => {
    const indicators = indicatorRef.current
    const beams = beamRef.current

    if (!crystalsVisible || indicators === null || beams === null) {
      return
    }

    const dummy = indicatorDummyRef.current
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.8) * 0.09
    const indicatorColor = indicatorColorRef.current

    outpost.deposits.forEach((deposit, index) => {
      const sample = localSurfaceToRender(
        terrain,
        deposit.position.xM,
        deposit.position.zM,
      )
      const selected = deposit.id === selectedDepositId
      const scale = (selected ? 2.78 : 2.05) * LOCAL_METRES_TO_RENDER_UNITS * pulse
      dummy.position.set(sample.x, sample.y + 0.00002, sample.z)
      dummy.rotation.set(Math.PI / 2, 0, deposit.orientationRad)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      indicators.setMatrixAt(index, dummy.matrix)
      indicatorColor.set(selected ? '#ffb26e' : '#b96a3c')
      indicators.setColorAt(index, indicatorColor)

      const beamScale = (selected ? 1.24 : 1.02) * LOCAL_METRES_TO_RENDER_UNITS
      dummy.position.set(
        sample.x,
        sample.y + 0.95 * LOCAL_METRES_TO_RENDER_UNITS,
        sample.z,
      )
      dummy.rotation.set(0, -deposit.orientationRad, 0)
      dummy.scale.setScalar(beamScale)
      dummy.updateMatrix()
      beams.setMatrixAt(index, dummy.matrix)
      beams.setColorAt(index, indicatorColor)

      if (isE2e) {
        projectedPointRef.current
          .set(
            sample.x,
            sample.y + 0.7 * LOCAL_METRES_TO_RENDER_UNITS,
            sample.z,
          )
          .applyQuaternion(transform.orientation)
          .add(transform.position)
          .project(state.camera)
        const key = deposit.id.replace('deposit-', '')
        const prefix = key.charAt(0).toUpperCase() + key.slice(1)
        const canvas = state.gl.domElement
        canvas.dataset['deposit' + prefix + 'X'] = String(
          ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
        )
        canvas.dataset['deposit' + prefix + 'Y'] = String(
          ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
        )
      }
    })

    indicators.instanceMatrix.needsUpdate = true
    beams.instanceMatrix.needsUpdate = true

    if (indicators.instanceColor !== null) {
      indicators.instanceColor.needsUpdate = true
    }

    if (beams.instanceColor !== null) {
      beams.instanceColor.needsUpdate = true
    }
  })

  const selectDeposit = (depositId: string, delta: number) => {
    if (!interactive || delta > TAP_DISTANCE_PX) {
      return
    }

    onSelect(depositId)
  }

  const handleCrystalClick = (event: ThreeEvent<MouseEvent>) => {
    const instanceId = event.instanceId

    if (instanceId === undefined) {
      return
    }

    const deposit = outpost.deposits[Math.floor(instanceId / CRYSTALS_PER_DEPOSIT)]

    if (deposit === undefined) {
      return
    }

    event.stopPropagation()
    selectDeposit(deposit.id, event.delta)
  }

  if (!crystalsVisible) {
    return null
  }

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <instancedMesh
        ref={crystalRef}
        args={[
          crystalGeometry,
          undefined,
          outpost.deposits.length * CRYSTALS_PER_DEPOSIT,
        ]}
        castShadow
        onClick={handleCrystalClick}
      >
        <meshStandardMaterial
          color="#d9ae7a"
          emissive="#9e401a"
          emissiveIntensity={1.15}
          metalness={0.28}
          roughness={0.48}
          vertexColors
        />
      </instancedMesh>
      <instancedMesh
        ref={indicatorRef}
        args={[indicatorGeometry, undefined, outpost.deposits.length]}
      >
        <meshBasicMaterial
          color="#d77a43"
          depthWrite={false}
          opacity={0.5}
          transparent
          vertexColors
        />
      </instancedMesh>
      <instancedMesh
        ref={beamRef}
        args={[beamGeometry, undefined, outpost.deposits.length]}
      >
        <meshBasicMaterial
          color="#ff9b5c"
          depthWrite={false}
          opacity={0.32}
          transparent
          vertexColors
        />
      </instancedMesh>
      {outpost.deposits.map((deposit) => {
        const sample = localSurfaceToRender(
          terrain,
          deposit.position.xM,
          deposit.position.zM,
        )

        return (
          <mesh
            key={deposit.id}
            geometry={hitGeometry}
            material={hitMaterial}
            position={[
              sample.x,
              sample.y + 0.8 * LOCAL_METRES_TO_RENDER_UNITS,
              sample.z,
            ]}
            scale={2.6 * LOCAL_METRES_TO_RENDER_UNITS}
            onClick={(event) => {
              event.stopPropagation()
              selectDeposit(deposit.id, event.delta)
            }}
          />
        )
      })}
      <PlacementFootprint
        outpost={outpost}
        terrain={terrain}
        selectedDepositId={selectedDepositId}
      />
    </group>
  )
}
