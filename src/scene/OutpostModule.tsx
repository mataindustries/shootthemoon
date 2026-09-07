import { useMemo, useRef } from 'react'
import { Group, MathUtils, Points, PointsMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { OutpostDamageState } from '../domain/counterstrike.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { MODULE_CONSTRUCTION_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'
import { MODULE_MODEL_SCALE, SOLAR_PANEL, SOLAR_WING_SLOT } from './solarWingLayout.ts'

const SLOT_X_M = -1.8
const SLOT_Z_M = -1.45
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
  return (
    <group name="storage-silo-structure">
      <mesh position-y={0.18} castShadow receiveShadow>
        <cylinderGeometry args={[1.18, 1.32, 0.36, 12]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerHeatDark} roughness={0.72} metalness={0.62} />
      </mesh>
      <mesh position-y={1.2} castShadow receiveShadow>
        <cylinderGeometry args={[0.92, 1.08, 1.85, 12]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerArmor} roughness={0.62} metalness={0.72} />
      </mesh>
      {[0.55, 1.18, 1.8].map((y) => (
        <mesh key={y} position-y={y} rotation-x={Math.PI / 2} castShadow>
          <torusGeometry args={[1.01, 0.09, 7, 18]} />
          <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.45} metalness={0.82} />
        </mesh>
      ))}
      <mesh position-y={2.2} castShadow>
        <coneGeometry args={[0.86, 0.48, 12]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerArmor} roughness={0.58} metalness={0.7} />
      </mesh>
      <mesh position={[0, 1.22, 0.93]}>
        <boxGeometry args={[0.82, 0.46, 0.08]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerAmberPanel} emissive={VISUAL_PALETTE.playerAmberEmissive} emissiveIntensity={0.42} />
      </mesh>
    </group>
  )
}

function RepairGantry({ repairing }: { readonly repairing: boolean }) {
  const dronesRef = useRef<Group>(null)
  const sparksRef = useRef<Points>(null)

  useFrame((state) => {
    if (!repairing) return
    const drones = dronesRef.current
    const sparks = sparksRef.current
    if (drones !== null) {
      drones.position.y = 1.45 + Math.sin(state.clock.elapsedTime * 3) * 0.12
      drones.rotation.z = Math.sin(state.clock.elapsedTime * 1.8) * 0.06
    }
    if (sparks !== null) {
      sparks.rotation.y = state.clock.elapsedTime * 4.2
      ;(sparks.material as PointsMaterial).opacity =
        0.28 + Math.abs(Math.sin(state.clock.elapsedTime * 9)) * 0.55
    }
  })

  const sparkPositions = useMemo(
    () =>
      new Float32Array(
        Array.from({ length: 18 }, (_, index) => {
          const angle = index * 2.399963
          return [
            Math.cos(angle) * (0.2 + (index % 4) * 0.08),
            (index % 6) * 0.09,
            Math.sin(angle) * (0.2 + (index % 3) * 0.1),
          ]
        }).flat(),
      ),
    [],
  )

  return (
    <group name="repair-gantry-structure">
      <mesh position-y={0.12} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.24, 1.8]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerHeatDark} roughness={0.74} metalness={0.65} />
      </mesh>
      {[-1.45, 1.45].map((x) => (
        <mesh key={x} position={[x, 1.35, 0]} castShadow>
          <boxGeometry args={[0.2, 2.5, 0.25]} />
          <meshStandardMaterial color={VISUAL_PALETTE.playerArmor} roughness={0.58} metalness={0.75} />
        </mesh>
      ))}
      <mesh position-y={2.56} castShadow>
        <boxGeometry args={[3.18, 0.22, 0.28]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.42} metalness={0.84} />
      </mesh>
      <mesh position={[0, 2.25, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.72, 8]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerSteel} roughness={0.4} metalness={0.86} />
      </mesh>
      <group ref={dronesRef} visible={repairing}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.82, 0, 1.08]}>
            <mesh>
              <octahedronGeometry args={[0.27, 0]} />
              <meshBasicMaterial color={VISUAL_PALETTE.playerHotMetal} />
            </mesh>
            <mesh rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.38, 0.055, 6, 14]} />
              <meshBasicMaterial color={VISUAL_PALETTE.playerAmberEmissive} />
            </mesh>
            <mesh position-y={-0.3}>
              <cylinderGeometry args={[0.025, 0.025, 0.48, 5]} />
              <meshBasicMaterial color={VISUAL_PALETTE.playerHotMetal} transparent opacity={0.72} />
            </mesh>
          </group>
        ))}
      </group>
      <points ref={sparksRef} position={[0, 0.72, 1.12]} visible={repairing}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[sparkPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#ffd2a0" size={0.000055} transparent depthWrite={false} />
      </points>
      {repairing ? (
        <group position={[0, 0.65, 1.13]}>
          {[-0.42, -0.18, 0.2, 0.46].map((x, index) => (
            <mesh key={x} position={[x, (index % 2) * 0.22, 0]} rotation-z={x * 0.9}>
              <boxGeometry args={[0.045, 0.5, 0.045]} />
              <meshBasicMaterial color={index % 2 === 0 ? '#fff1c2' : VISUAL_PALETTE.playerHotMetal} />
            </mesh>
          ))}
        </group>
      ) : null}
      <mesh position={[0, 0.5, 0.92]}>
        <boxGeometry args={[1.1, 0.4, 0.08]} />
        <meshStandardMaterial color={VISUAL_PALETTE.playerAmberPanel} emissive={VISUAL_PALETTE.playerAmberEmissive} emissiveIntensity={repairing ? 0.65 : 0.22} />
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
  const slotXM = solar ? SOLAR_WING_SLOT.xM : SLOT_X_M
  const slotZM = solar ? SOLAR_WING_SLOT.zM : SLOT_Z_M
  const rootRef = useRef<Group>(null)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const ground = useMemo(
    () => sampleRenderedSurface(terrain, segments, slotXM, slotZM),
    [segments, terrain, slotXM, slotZM],
  )

  useFrame(() => {
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
    root.position.y = ground.y + MODEL_SCALE * (-0.75 + eased * 0.75)
    root.rotation.y = (solar ? SOLAR_WING_SLOT.headingRad : 0) + (1 - eased) * -0.18
  })

  if (module === null) return null
  const repairing =
    module.kind === 'REPAIR_GANTRY' &&
    module.status === 'active' &&
    module.repairProgress < 1 &&
    damageState === 'DAMAGED'

  return (
    <group position={transform.position} quaternion={transform.orientation}>
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
        position={[
          slotXM * LOCAL_METRES_TO_RENDER_UNITS,
          ground.y,
          slotZM * LOCAL_METRES_TO_RENDER_UNITS,
        ]}
        scale={MODEL_SCALE}
        rotation-y={solar ? SOLAR_WING_SLOT.headingRad : 0}
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
