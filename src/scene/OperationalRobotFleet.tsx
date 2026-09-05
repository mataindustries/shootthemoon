import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { OutpostOperationsMetrics } from '../simulation/outpostOperations.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { MATERIAL_RESPONSE, VISUAL_PALETTE } from '../render/visualSystem.ts'

interface OperationalRobotFleetProps {
  readonly outpost: OutpostSnapshot
  readonly operations: OutpostOperationsMetrics
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

/** Three tiny autonomous haulers make the operating-mode robot count legible. */
export function OperationalRobotFleet({
  outpost,
  operations,
  terrain,
  segments,
}: OperationalRobotFleetProps) {
  const bodyRef = useRef<InstancedMesh>(null)
  const bodyDummyRef = useRef(new Object3D())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: 0.04,
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      bodyMaterial.dispose()
    },
    [bodyMaterial, geometry],
  )

  useFrame(() => {
    const bodies = bodyRef.current
    if (bodies === null || outpost.extractor === null) return

    const nowSeconds = simulationNowMs() / 1_000
    const activity = Math.max(0.18, Math.min(1, operations.productionPerMin / 8))
    const cycleSeconds = 15 - activity * 8
    const target = outpost.extractor.position

    const bodyDummy = bodyDummyRef.current
    const modelScale = LOCAL_METRES_TO_RENDER_UNITS * 0.72

    for (let index = 0; index < 3; index += 1) {
      const enabled = index < operations.activeRobots
      if (!enabled) {
        bodyDummy.scale.setScalar(0)
        bodyDummy.updateMatrix()
        bodies.setMatrixAt(index, bodyDummy.matrix)
        continue
      }

      const phase = ((nowSeconds / cycleSeconds + index / 3) % 1 + 1) % 1
      const travel = 0.5 - Math.cos(phase * Math.PI * 2) * 0.5
      const lateral = (index - 1) * 1.15 + Math.sin(phase * Math.PI * 2) * 0.32
      const directionLength = Math.max(0.001, Math.hypot(target.xM, target.zM))
      const directionX = target.xM / directionLength
      const directionZ = target.zM / directionLength
      const xM = target.xM - directionX * (2.6 + travel * 4.8) + directionZ * lateral
      const zM = target.zM - directionZ * (2.6 + travel * 4.8) - directionX * lateral
      const surface = sampleRenderedSurface(terrain, segments, xM, zM)
      const heading =
        Math.atan2(directionX, directionZ) + (phase < 0.5 ? Math.PI : 0)
      bodyDummy.position.set(
        surface.x,
        surface.y + 0.18 * LOCAL_METRES_TO_RENDER_UNITS,
        surface.z,
      )
      bodyDummy.rotation.set(0, heading, 0)
      bodyDummy.scale.set(
        0.78 * modelScale,
        0.34 * modelScale,
        1.12 * modelScale,
      )
      bodyDummy.updateMatrix()
      bodies.setMatrixAt(index, bodyDummy.matrix)
    }
    bodies.instanceMatrix.needsUpdate = true

    const energyPulse =
      operations.energyThrottle >= 0.999 || Math.sin(nowSeconds * 3.1) > 0.35
    bodyMaterial.emissiveIntensity = energyPulse
      ? 0.08 + operations.energyThrottle * 0.2
      : 0.005
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <instancedMesh
        ref={bodyRef}
        name="operational-robot-fleet"
        args={[geometry, bodyMaterial, 3]}
      />
    </group>
  )
}
