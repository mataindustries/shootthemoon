import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
} from 'three'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_HALF_SIZE_M,
} from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { maximumRenderedSurfaceHeight } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

interface LunarWarheadSystemProps {
  readonly playerSite: LandingSite
  readonly strike: FirstStrikeSnapshot
  readonly presentation: FirstStrikePresentationState
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

const STATIC_HARDWARE_COUNT = 16
const CRADLE_PART_COUNT = 5
const WARNING_LIGHT_COUNT = 6
const LAUNCH_DUST_COUNT = 28
const SYSTEM_SCALE_MULTIPLIER = 1.42
const SYSTEM_TANGENT_SCALE_MULTIPLIER = SYSTEM_SCALE_MULTIPLIER * 1.5
const CONTACT_FOOT_CENTER_RADIUS_MODEL = 8.38
const CONTACT_FOOT_HALF_RADIAL_MODEL = 1.15 / 2
const CONTACT_FOOT_HALF_TANGENTIAL_MODEL = 1.82 / 2
const CONTACT_FOOT_CENTER_Y_MODEL = -0.02
const CONTACT_FOOT_HEIGHT_MODEL = 0.3
const CONTACT_FOOT_BOTTOM_MODEL =
  CONTACT_FOOT_CENTER_Y_MODEL - CONTACT_FOOT_HEIGHT_MODEL / 2

export const WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M =
  Math.hypot(
    CONTACT_FOOT_CENTER_RADIUS_MODEL + CONTACT_FOOT_HALF_RADIAL_MODEL,
    CONTACT_FOOT_HALF_TANGENTIAL_MODEL,
  ) * SYSTEM_TANGENT_SCALE_MULTIPLIER
export const WARHEAD_SYSTEM_GROUND_CLEARANCE_M = 0.015

export interface WarheadSystemGrounding {
  readonly attachmentHeight: number
  readonly contactBottomOffset: number
  readonly maximumSurfaceHeight: number
}

function createWarheadFootprintSamples(
  segments: number,
): readonly Readonly<{ xM: number; zM: number }>[] {
  const safeSegments = Math.max(1, Math.floor(segments))
  const points: { xM: number; zM: number }[] = [{ xM: 0, zM: 0 }]
  const ringSampleCount = Math.max(72, safeSegments)

  for (const radiusScale of [0.25, 0.5, 0.75, 1]) {
    const radiusM = WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M * radiusScale

    for (let index = 0; index < ringSampleCount; index += 1) {
      const angle = (index / ringSampleCount) * Math.PI * 2
      points.push({
        xM: Math.cos(angle) * radiusM,
        zM: Math.sin(angle) * radiusM,
      })
    }
  }

  const cellSizeM = (LOCAL_SURFACE_HALF_SIZE_M * 2) / safeSegments

  for (let row = 0; row <= safeSegments; row += 1) {
    const zM = -LOCAL_SURFACE_HALF_SIZE_M + row * cellSizeM

    if (Math.abs(zM) > WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M) continue

    for (let column = 0; column <= safeSegments; column += 1) {
      const xM = -LOCAL_SURFACE_HALF_SIZE_M + column * cellSizeM

      if (Math.hypot(xM, zM) <= WARHEAD_SYSTEM_FOOTPRINT_RADIUS_M) {
        points.push({ xM, zM })
      }
    }
  }

  return points
}

export function calculateWarheadSystemGrounding(
  terrain: SurfaceTerrainProfile,
  segments: number,
): WarheadSystemGrounding {
  const maximumSurfaceHeight = maximumRenderedSurfaceHeight(
    terrain,
    segments,
    createWarheadFootprintSamples(segments),
  )
  const contactBottomOffset =
    CONTACT_FOOT_BOTTOM_MODEL *
    LOCAL_METRES_TO_RENDER_UNITS *
    SYSTEM_SCALE_MULTIPLIER

  return {
    attachmentHeight:
      maximumSurfaceHeight -
      contactBottomOffset +
      WARHEAD_SYSTEM_GROUND_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS,
    contactBottomOffset,
    maximumSurfaceHeight,
  }
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function rangeProgress(value: number, start: number, end: number): number {
  return smoothstep((value - start) / (end - start))
}

function createLaunchDustGeometry(): BufferGeometry {
  const positions = new Float32Array(LAUNCH_DUST_COUNT * 3)

  for (let index = 0; index < LAUNCH_DUST_COUNT; index += 1) {
    const angle = index * 2.399963229728653 + (index % 4) * 0.09
    const radius = 3.5 + ((index * 17) % 13) * 0.27
    const offset = index * 3
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = 0.2 + (index % 7) * 0.12
    positions[offset + 2] = Math.sin(angle) * radius
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function LunarWarheadSystem({
  playerSite,
  strike,
  presentation,
  terrain,
  segments,
}: LunarWarheadSystemProps) {
  const leftDoorRef = useRef<Group>(null)
  const rightDoorRef = useRef<Group>(null)
  const cradleRef = useRef<Group>(null)
  const leftClampRef = useRef<Group>(null)
  const rightClampRef = useRef<Group>(null)
  const serviceMastRef = useRef<Group>(null)
  const staticHardwareRef = useRef<InstancedMesh>(null)
  const cradlePartsRef = useRef<InstancedMesh>(null)
  const warningLightsRef = useRef<InstancedMesh>(null)
  const launchDustRef = useRef<Points>(null)
  const dummyRef = useRef(new Object3D())
  const transform = useMemo(
    () => landingSiteToRenderTransform(playerSite),
    [playerSite],
  )
  const grounding = useMemo(
    () => calculateWarheadSystemGrounding(terrain, segments),
    [segments, terrain],
  )
  const attachmentPosition = useMemo(
    () =>
      transform.position
        .clone()
        .addScaledVector(transform.up, grounding.attachmentHeight),
    [grounding.attachmentHeight, transform.position, transform.up],
  )
  const systemScale =
    LOCAL_METRES_TO_RENDER_UNITS * SYSTEM_SCALE_MULTIPLIER
  const baseGeometry = useMemo(
    () => new CylinderGeometry(7.25, 8.35, 1.15, 12),
    [],
  )
  const deckGeometry = useMemo(
    () => new CylinderGeometry(6.45, 7.2, 0.58, 12),
    [],
  )
  const tubeGeometry = useMemo(
    () => new CylinderGeometry(2.38, 2.78, 7.45, 12, 1, true),
    [],
  )
  const collarGeometry = useMemo(
    () => new CylinderGeometry(3.02, 3.32, 0.52, 12),
    [],
  )
  const doorGeometry = useMemo(() => new BoxGeometry(5.45, 0.54, 2.62), [])
  const doorPanelGeometry = useMemo(
    () => new BoxGeometry(3.6, 0.12, 1.52),
    [],
  )
  const hardwareGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const clampGeometry = useMemo(() => new BoxGeometry(0.62, 1.55, 0.7), [])
  const dustGeometry = useMemo(createLaunchDustGeometry, [])
  const armorMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [],
  )
  const steelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        ...MATERIAL_RESPONSE.playerSteel,
        vertexColors: true,
      }),
    [],
  )
  const heatMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHeatDark,
        emissive: VISUAL_PALETTE.playerWarningRed,
        emissiveIntensity: 0.08,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const warningMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: 0.2,
        metalness: 0.28,
        roughness: 0.48,
      }),
    [],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.lunarMid,
        depthWrite: false,
        opacity: 0,
        size: 0.0005,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const hardware = staticHardwareRef.current
    const cradleParts = cradlePartsRef.current
    const warningLights = warningLightsRef.current

    if (hardware === null || cradleParts === null || warningLights === null) {
      return
    }

    const dummy = dummyRef.current
    const steelColor = new Color(VISUAL_PALETTE.playerSteel)
    const contactColor = new Color(VISUAL_PALETTE.contactDark)
    const heatColor = new Color(VISUAL_PALETTE.playerHeatDark)
    let hardwareIndex = 0

    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2)
      dummy.position.set(Math.cos(angle) * 7.05, 0.18, Math.sin(angle) * 7.05)
      dummy.rotation.set(0, -angle, 0)
      dummy.scale.set(3.15, 0.42, 1.18)
      dummy.updateMatrix()
      hardware.setMatrixAt(hardwareIndex, dummy.matrix)
      hardware.setColorAt(hardwareIndex, steelColor)
      hardwareIndex += 1

      dummy.position.set(Math.cos(angle) * 8.38, -0.02, Math.sin(angle) * 8.38)
      dummy.rotation.set(0, -angle, 0)
      dummy.scale.set(1.15, 0.3, 1.82)
      dummy.updateMatrix()
      hardware.setMatrixAt(hardwareIndex, dummy.matrix)
      hardware.setColorAt(hardwareIndex, contactColor)
      hardwareIndex += 1

      dummy.position.set(Math.cos(angle) * 3.22, 4.62, Math.sin(angle) * 3.22)
      dummy.rotation.set(0, -angle, index % 2 === 0 ? 0.1 : -0.1)
      dummy.scale.set(0.48, 4.05, 0.62)
      dummy.updateMatrix()
      hardware.setMatrixAt(hardwareIndex, dummy.matrix)
      hardware.setColorAt(hardwareIndex, heatColor)
      hardwareIndex += 1

      dummy.position.set(Math.cos(angle) * 4.62, 1.45, Math.sin(angle) * 4.62)
      dummy.rotation.set(0, -angle, 0)
      dummy.scale.set(1.72, 0.34, 0.48)
      dummy.updateMatrix()
      hardware.setMatrixAt(hardwareIndex, dummy.matrix)
      hardware.setColorAt(hardwareIndex, steelColor)
      hardwareIndex += 1
    }

    hardware.instanceMatrix.needsUpdate = true
    if (hardware.instanceColor !== null) hardware.instanceColor.needsUpdate = true

    const cradleDefinitions = [
      { position: [-2.05, 3.35, 0] as const, scale: [0.42, 6.7, 0.52] as const },
      { position: [2.05, 3.35, 0] as const, scale: [0.42, 6.7, 0.52] as const },
      { position: [0, 0.48, 0] as const, scale: [4.45, 0.42, 0.62] as const },
      { position: [0, 3.1, 0] as const, scale: [4.2, 0.3, 0.48] as const },
      { position: [0, 5.98, 0] as const, scale: [4.45, 0.42, 0.62] as const },
    ]

    cradleDefinitions.forEach((definition, index) => {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      dummy.updateMatrix()
      cradleParts.setMatrixAt(index, dummy.matrix)
      cradleParts.setColorAt(
        index,
        index === 3 ? heatColor : steelColor,
      )
    })
    cradleParts.instanceMatrix.needsUpdate = true
    if (cradleParts.instanceColor !== null) {
      cradleParts.instanceColor.needsUpdate = true
    }

    for (let index = 0; index < WARNING_LIGHT_COUNT; index += 1) {
      const angle = (index / WARNING_LIGHT_COUNT) * Math.PI * 2 + Math.PI / 6
      dummy.position.set(Math.cos(angle) * 6.12, 1.19, Math.sin(angle) * 6.12)
      dummy.rotation.set(0, -angle, 0)
      dummy.scale.set(0.58, 0.14, 0.2)
      dummy.updateMatrix()
      warningLights.setMatrixAt(index, dummy.matrix)
    }
    warningLights.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      baseGeometry.dispose()
      deckGeometry.dispose()
      tubeGeometry.dispose()
      collarGeometry.dispose()
      doorGeometry.dispose()
      doorPanelGeometry.dispose()
      hardwareGeometry.dispose()
      clampGeometry.dispose()
      dustGeometry.dispose()
      armorMaterial.dispose()
      steelMaterial.dispose()
      heatMaterial.dispose()
      warningMaterial.dispose()
      dustMaterial.dispose()
    }, [
      armorMaterial,
      baseGeometry,
      clampGeometry,
      collarGeometry,
      deckGeometry,
      doorGeometry,
      doorPanelGeometry,
      dustGeometry,
      dustMaterial,
      hardwareGeometry,
      heatMaterial,
      steelMaterial,
      tubeGeometry,
      warningMaterial,
    ],
  )

  useFrame((state) => {
    const leftDoor = leftDoorRef.current
    const rightDoor = rightDoorRef.current
    const cradle = cradleRef.current
    const leftClamp = leftClampRef.current
    const rightClamp = rightClampRef.current
    const serviceMast = serviceMastRef.current
    const launchDust = launchDustRef.current

    if (
      leftDoor === null ||
      rightDoor === null ||
      cradle === null ||
      leftClamp === null ||
      rightClamp === null ||
      serviceMast === null ||
      launchDust === null
    ) {
      return
    }

    const cinematicProgress = getFirstStrikePresentationProgress(presentation)
    const openProgress =
      presentation.phase === 'arming'
        ? smoothstep(cinematicProgress)
        : presentation.phase === 'launch' ||
            presentation.phase === 'orbital-flight' ||
            presentation.phase === 'vesper-transmission' ||
            presentation.phase === 'target-approach'
          ? 1
          : strike.status === 'ARMED'
            ? 0.12
            : 0
    const releaseProgress =
      presentation.phase === 'launch'
        ? rangeProgress(cinematicProgress, 0.06, 0.28)
        : presentation.phase === 'orbital-flight' ||
            presentation.phase === 'vesper-transmission' ||
            presentation.phase === 'target-approach'
          ? 1
          : 0

    leftDoor.position.x = -2.55 - openProgress * 3.55
    rightDoor.position.x = 2.55 + openProgress * 3.55
    leftDoor.rotation.z = openProgress * 0.13
    rightDoor.rotation.z = -openProgress * 0.13
    cradle.position.y = 0.72 + openProgress * 3.78 - releaseProgress * 1.36

    leftClamp.position.x = -2.2 - releaseProgress * 0.72
    rightClamp.position.x = 2.2 + releaseProgress * 0.72
    leftClamp.rotation.z = releaseProgress * 0.68
    rightClamp.rotation.z = -releaseProgress * 0.68
    serviceMast.rotation.z = -0.08 - releaseProgress * 0.74

    const armed =
      strike.status === 'ARMED' ||
      presentation.phase === 'arming' ||
      presentation.phase === 'launch'
    const pulse = 0.5 + Math.sin(state.clock.elapsedTime * (armed ? 8.2 : 2.2)) * 0.5
    warningMaterial.emissiveIntensity = armed
      ? 0.34 + pulse * (EMISSIVE_LIMITS.activePanel - 0.34)
      : 0.14 + pulse * 0.08

    if (presentation.phase === 'launch') {
      const dustProgress = rangeProgress(cinematicProgress, 0.04, 0.62)
      const dustEnvelope =
        Math.sin(Math.PI * Math.min(1, cinematicProgress / 0.64)) ** 1.35
      launchDust.visible = dustEnvelope > 0.01
      launchDust.scale.setScalar(0.78 + dustProgress * 1.75)
      launchDust.position.y = dustProgress * 1.35
      dustMaterial.opacity = dustEnvelope * 0.34
    } else {
      launchDust.visible = false
      dustMaterial.opacity = 0
    }
  })

  return (
    <group position={attachmentPosition} quaternion={transform.orientation}>
      <group scale={[systemScale * 1.5, systemScale, systemScale * 1.5]}>
        <instancedMesh
          ref={staticHardwareRef}
          args={[hardwareGeometry, steelMaterial, STATIC_HARDWARE_COUNT]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={baseGeometry}
          material={armorMaterial}
          position-y={0.56}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={deckGeometry}
          material={steelMaterial}
          position-y={1.1}
          receiveShadow
        />
        <mesh
          geometry={tubeGeometry}
          material={heatMaterial}
          position-y={4.72}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={collarGeometry}
          material={armorMaterial}
          position-y={1.58}
          receiveShadow
        />
        <mesh
          geometry={collarGeometry}
          material={steelMaterial}
          position-y={8.55}
          scale={[1.06, 0.72, 1.06]}
        />

        <group ref={cradleRef} position-y={0.72}>
          <instancedMesh
            ref={cradlePartsRef}
            args={[hardwareGeometry, steelMaterial, CRADLE_PART_COUNT]}
          />
          <group ref={leftClampRef} position={[-2.2, 6.12, 0]}>
            <mesh geometry={clampGeometry} material={heatMaterial} castShadow />
          </group>
          <group ref={rightClampRef} position={[2.2, 6.12, 0]}>
            <mesh geometry={clampGeometry} material={heatMaterial} castShadow />
          </group>
        </group>

        <group ref={serviceMastRef} position={[3.45, 1.46, 0]} rotation-z={-0.08}>
          <mesh
            geometry={hardwareGeometry}
            material={steelMaterial}
            position-y={2.75}
            scale={[0.56, 5.5, 0.62]}
            castShadow
          />
          <mesh
            geometry={hardwareGeometry}
            material={warningMaterial}
            position={[-0.44, 5.16, 0]}
            scale={[1.4, 0.26, 0.3]}
          />
        </group>

        <group ref={leftDoorRef} position={[-2.55, 9.08, 0]}>
          <mesh geometry={doorGeometry} material={armorMaterial} castShadow />
          <mesh
            geometry={doorPanelGeometry}
            material={heatMaterial}
            position-y={0.32}
          />
        </group>
        <group ref={rightDoorRef} position={[2.55, 9.08, 0]}>
          <mesh geometry={doorGeometry} material={armorMaterial} castShadow />
          <mesh
            geometry={doorPanelGeometry}
            material={heatMaterial}
            position-y={0.32}
          />
        </group>

        <instancedMesh
          ref={warningLightsRef}
          args={[hardwareGeometry, warningMaterial, WARNING_LIGHT_COUNT]}
        />
        <points
          ref={launchDustRef}
          geometry={dustGeometry}
          material={dustMaterial}
          frustumCulled={false}
          visible={false}
        />
      </group>
    </group>
  )
}
