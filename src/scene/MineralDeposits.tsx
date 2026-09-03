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
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { canConstructExtractor } from '../simulation/outpostSimulation.ts'
import { isSimulationTimePaused } from '../simulation/simulationTime.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import {
  E2E_HARNESS_BUILD_ENABLED,
  shouldEnableE2eHarness,
} from '../testing/e2eHarness.ts'

const CRYSTALS_PER_DEPOSIT = 3
const TAP_DISTANCE_PX = 10
const CRYSTAL_EMBED_M = 0.035

interface MineralDepositsProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly selectedDepositId: string | null
  readonly interactive: boolean
  readonly active: boolean
  readonly onSelect: (depositId: string) => void
}

interface PlacementFootprintProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly selectedDepositId: string | null
}

function PlacementFootprint({
  outpost,
  terrain,
  segments,
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

  const sample = sampleRenderedSurface(
    terrain,
    segments,
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
  segments,
  selectedDepositId,
  interactive,
  active,
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
    () =>
      shouldEnableE2eHarness(
        E2E_HARNESS_BUILD_ENABLED,
        window.location.search,
      ),
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
        const crystalXM = deposit.position.xM + Math.sin(angle) * offsetM
        const crystalZM = deposit.position.zM + Math.cos(angle) * offsetM
        const sample = sampleRenderedSurface(
          terrain,
          segments,
          crystalXM,
          crystalZM,
        )
        dummy.position.set(0, 0, 0)
        dummy.rotation.set(
          0.12 * crystalIndex,
          angle,
          0.16 - crystalIndex * 0.1,
        )
        dummy.scale.set(scale * 0.68, scale * 1.45, scale * 0.68)
        dummy.updateMatrix()
        const positions = crystalGeometry.getAttribute('position')
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
            crystalXM + vertex.x / LOCAL_METRES_TO_RENDER_UNITS,
            crystalZM + vertex.z / LOCAL_METRES_TO_RENDER_UNITS,
          )
          groundedY = Math.max(groundedY, vertexSurface.y - vertex.y)
        }

        dummy.position.set(
          sample.x,
          groundedY - CRYSTAL_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS,
          sample.z,
        )
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
  }, [
    crystalGeometry,
    crystalsVisible,
    outpost.deposits,
    outpost.extractor,
    segments,
    terrain,
  ])

  useEffect(() => {
    if (!active || !crystalsVisible) {
      return
    }

    const timer = window.setInterval(() => {
      if (!isSimulationTimePaused()) {
        invalidate()
      }
    }, 180)
    return () => window.clearInterval(timer)
  }, [active, crystalsVisible, invalidate])

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

    if (!active || !crystalsVisible || indicators === null || beams === null) {
      return
    }

    const dummy = indicatorDummyRef.current
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.8) * 0.09
    const indicatorColor = indicatorColorRef.current

    outpost.deposits.forEach((deposit, index) => {
      const sample = sampleRenderedSurface(
        terrain,
        segments,
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
          color={VISUAL_PALETTE.playerHotMetal}
          emissive={VISUAL_PALETTE.playerAmberEmissive}
          emissiveIntensity={EMISSIVE_LIMITS.activePanel}
          {...MATERIAL_RESPONSE.playerHeatDark}
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
        const sample = sampleRenderedSurface(
          terrain,
          segments,
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
        segments={segments}
        selectedDepositId={selectedDepositId}
      />
    </group>
  )
}
