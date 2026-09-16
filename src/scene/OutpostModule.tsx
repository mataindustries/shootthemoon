import { E2E_HARNESS_BUILD_ENABLED, shouldEnableE2eHarness } from '../testing/e2eHarness.ts'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Group, InstancedMesh, MathUtils, Object3D, Vector3 } from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { OutpostDamageState } from '../domain/counterstrike.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { maximumRenderedSurfaceHeight, sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { MODULE_CONSTRUCTION_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'
import { createPlayerCompositeMaterial } from '../render/playerComposite.ts'
import { MODULE_SOCKETS } from './moduleLayout.ts'
import { MODULE_MODEL_SCALE, SOLAR_PANEL } from './solarWingLayout.ts'

import { RepairGantry } from './RepairGantry.tsx'

const MODEL_SCALE = MODULE_MODEL_SCALE

interface OutpostModuleProps {
  readonly outpost: OutpostSnapshot
  readonly damageState: OutpostDamageState
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

function SolarWing() {
  return (
    <group name="solar-wing-structure">
      <mesh position-y={0.13} castShadow receiveShadow>
        <cylinderGeometry args={[0.56, 0.72, 0.26, 10]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerArmor} roughness={0.68} metalness={0.66} />
      </mesh>
      <mesh position-y={0.72} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 1.25, 8]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.44} metalness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position-x={side * SOLAR_PANEL.offsetX} position-y={1.02} rotation-z={side * -SOLAR_PANEL.tilt}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[SOLAR_PANEL.width, SOLAR_PANEL.height, SOLAR_PANEL.depth]} />
            <meshStandardMaterial color="#132536" roughness={0.32} metalness={0.7} />
          </mesh>
          {[-1.05, -0.35, 0.35, 1.05].map((x) => (
            <mesh key={x} position={[x, 0.047, 0]}>
              <boxGeometry args={[0.035, 0.012, 1.28]} />
              <meshBasicMaterial color="#8fb7c8" />
            </mesh>
          ))}
          <mesh position-y={0.052}>
            <boxGeometry args={[3.02, 0.012, 0.035]} />
            <meshBasicMaterial color="#8fb7c8" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.12, 0]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerAmberPanel} emissive={VISUAL_PALETTE.playerAmberEmissive} emissiveIntensity={0.55} />
      </mesh>
    </group>
  )
}

function StorageSilo() {
  const composite = useMemo(createPlayerCompositeMaterial, [])
  const bandsRef = useRef<InstancedMesh>(null)
  const ventsRef = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const dummy = new Object3D()
    for (let index = 0; index < 3; index++) {
      dummy.position.set(0, [0.55, 1.18, 1.8][index]!, 0)
      dummy.rotation.set(Math.PI / 2, 0, 0)
      dummy.updateMatrix()
      bandsRef.current?.setMatrixAt(index, dummy.matrix)
      dummy.position.set(0, [1.08, 1.26, 1.44][index]!, 1.025)
      dummy.rotation.set(-0.25, 0, 0)
      dummy.updateMatrix()
      ventsRef.current?.setMatrixAt(index, dummy.matrix)
    }
    if (bandsRef.current) bandsRef.current.instanceMatrix.needsUpdate = true
    if (ventsRef.current) ventsRef.current.instanceMatrix.needsUpdate = true
  }, [])
  useEffect(() => () => composite.dispose(), [composite])
  return (
    <group name="storage-silo-structure">
      <mesh position-y={0.18} castShadow receiveShadow>
        <cylinderGeometry args={[1.18, 1.32, 0.36, 12]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerHeatDark} roughness={0.72} metalness={0.62} />
      </mesh>
      <mesh position-y={1.2} castShadow receiveShadow>
        <cylinderGeometry args={[0.92, 1.08, 1.85, 12]} />
        <primitive object={composite} attach="material" />
      </mesh>
      <instancedMesh ref={bandsRef} args={[undefined, undefined, 3]} castShadow>
        <torusGeometry args={[1.01, 0.09, 7, 18]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.45} metalness={0.46} />
      </instancedMesh>
      <mesh position-y={2.2} castShadow>
        <coneGeometry args={[0.86, 0.48, 12]} />
        <primitive object={composite} attach="material" />
      </mesh>
      <mesh position={[0, 1.28, 0.98]}>
        <boxGeometry args={[0.72, 0.6, 0.06]} />
        <meshStandardMaterial color={VISUAL_PALETTE.contactDark} roughness={0.85} />
      </mesh>
      <instancedMesh ref={ventsRef} args={[undefined, undefined, 3]} castShadow>
        <boxGeometry args={[0.68, 0.065, 0.12]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.5} metalness={0.46} />
      </instancedMesh>
      <mesh position={[0, 1.78, 1.02]}>
        <boxGeometry args={[0.62, 0.065, 0.08]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerAmberPanel} emissive={VISUAL_PALETTE.playerAmberEmissive} emissiveIntensity={0.42} />
      </mesh>
    </group>
  )
}

export function OutpostModule({
  outpost,
  damageState,
  terrain,
  segments,
}: OutpostModuleProps) {
  const module = outpost.module
  // The wing spans 17.7 metres. Run that span beside the capsule, never
  // toward its hull. Both use the same site frame, independent of camera.
  const solar = module?.kind === 'SOLAR_WING'
  const socket = MODULE_SOCKETS[module?.kind ?? 'SOLAR_WING']
  const slotXM = socket.xM
  const slotZM = socket.zM
  const rootRef = useRef<Group>(null)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const ground = useMemo(
    () => {
      const sample = sampleRenderedSurface(terrain, segments, slotXM, slotZM)
      if (module?.kind !== 'REPAIR_GANTRY') return sample
      // The heavy cradle rests on its whole footprint, with 2 cm of skirt
      // embedded. Do not inherit the centre height for the outer supports.
      const points = [-1.5, 0, 1.5].flatMap(x => [-.78, 0, .78].map(z => ({
        xM: slotXM + x * MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS,
        zM: slotZM + z * MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS,
      })))
      return { ...sample, y: maximumRenderedSurfaceHeight(terrain, segments, points) - .02 * LOCAL_METRES_TO_RENDER_UNITS }
    },
    [segments, terrain, slotXM, slotZM, module?.kind],
  )

  const projected = useMemo(() => new Vector3(), [])
  const isE2e = useMemo(() => shouldEnableE2eHarness(E2E_HARNESS_BUILD_ENABLED, window.location.search), [])
  useFrame((state) => {
    const root = rootRef.current
    if (root === null || module === null) return
    const progress =
      module.status === 'active'
        ? 1
        : MathUtils.clamp(
            (simulationNowMs() - module.constructionStartedAtMs) /
              MODULE_CONSTRUCTION_DURATION_MS,
            0,
            1,
          )
    const eased = progress * progress * (3 - 2 * progress)
    root.scale.setScalar(MODEL_SCALE * (0.15 + eased * 0.85))
    root.position.y = ground.y + socket.heightM * LOCAL_METRES_TO_RENDER_UNITS + MODEL_SCALE * (-0.75 + eased * 0.75)
    root.rotation.y = socket.headingRad + (1 - eased) * -0.18
    if (!isE2e) return
    root.updateWorldMatrix(true, false)
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]
    const cradle = module.kind === 'REPAIR_GANTRY'
    for (const x of [-1, 1]) for (const y of [0, cradle ? 2.35 : 2.45]) for (const z of [-1, 1]) {
      projected.set(x * (cradle ? 1.77 : 1.32), y, z * (cradle ? 1.03 : 1.32)).applyMatrix4(root.matrixWorld).project(state.camera)
      bounds[0] = Math.min(bounds[0]!, (projected.x + 1) * state.size.width / 2)
      bounds[1] = Math.min(bounds[1]!, (1 - projected.y) * state.size.height / 2)
      bounds[2] = Math.max(bounds[2]!, (projected.x + 1) * state.size.width / 2)
      bounds[3] = Math.max(bounds[3]!, (1 - projected.y) * state.size.height / 2)
    }
    state.gl.domElement.dataset.moduleBounds = JSON.stringify(bounds)
    state.gl.domElement.dataset.moduleSocket = JSON.stringify([slotXM, socket.heightM, slotZM, socket.headingRad])
  })

  if (module === null) return null
  const repairing =
    module.kind === 'REPAIR_GANTRY' &&
    module.status === 'active' &&
    module.repairProgress < 1 &&
    damageState === 'DAMAGED'

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      {!solar ? (
        <group position={[slotXM * LOCAL_METRES_TO_RENDER_UNITS / 2, ground.y + 0.0001, slotZM * LOCAL_METRES_TO_RENDER_UNITS / 2]}
          rotation-y={Math.atan2(slotXM, slotZM)} name="module-structural-coupler">
          <mesh castShadow>
            <boxGeometry args={[0.00008, 0.00006, (Math.hypot(slotXM, slotZM) - 2) * LOCAL_METRES_TO_RENDER_UNITS]} />
            <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.56} metalness={0.46} />
          </mesh>
        </group>
      ) : null}
      {solar ? (
        <group position={[-3.7 * LOCAL_METRES_TO_RENDER_UNITS, ground.y + 0.00014, 0]}>
          <mesh castShadow name="solar-wing-coupling">
            <boxGeometry args={[4.6 * LOCAL_METRES_TO_RENDER_UNITS, 0.000035, 0.000045]} />
            <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.5} metalness={0.8} />
          </mesh>
          <mesh position-y={0.000021}>
            <boxGeometry args={[4.6 * LOCAL_METRES_TO_RENDER_UNITS, 0.000008, 0.000012]} />
            <meshBasicMaterial color={VISUAL_PALETTE.playerAmberPanel} />
          </mesh>
        </group>
      ) : null}
      <group
        ref={rootRef}
        name="construction-module-socket"
        position={[
          slotXM * LOCAL_METRES_TO_RENDER_UNITS,
          ground.y + socket.heightM * LOCAL_METRES_TO_RENDER_UNITS,
          slotZM * LOCAL_METRES_TO_RENDER_UNITS,
        ]}
        scale={MODEL_SCALE}
        rotation-y={socket.headingRad}
      >
        {module.kind === 'SOLAR_WING' ? <SolarWing /> : null}
        {module.kind === 'STORAGE_SILO' ? <StorageSilo /> : null}
        {module.kind === 'REPAIR_GANTRY' ? <RepairGantry repairing={repairing} /> : null}
        {module.status === 'constructing' ? (
          <mesh position-y={0.08} rotation-x={-Math.PI / 2}>
            <ringGeometry args={solar ? [0.9, 1.05, 28] : [1.7, 1.85, 28]} />
            <meshBasicMaterial color={VISUAL_PALETTE.playerHotMetal} transparent opacity={0.52} depthWrite={false} />
          </mesh>
        ) : null}
      </group>
    </group>
  )
}
