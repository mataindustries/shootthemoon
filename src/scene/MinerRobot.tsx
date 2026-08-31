import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Matrix4,
  Object3D,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

interface MinerRobotProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

interface MiningEffectsProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

const DRILL_ARM_INSTANCE_INDEX = 13
const ROBOT_MODEL_SCALE_M = 1.14
const ROBOT_LANDED_CLEARANCE_M = 0.48
const WHEEL_CENTER_Y_MODEL = -0.19
const WHEEL_RADIUS_MODEL = 0.23
const WHEEL_BOTTOM_Y_MODEL = WHEEL_CENTER_Y_MODEL - WHEEL_RADIUS_MODEL
const WHEEL_SURFACE_EMBED_M = 0.006

const WHEEL_CONTACTS = Array.from({ length: 6 }, (_, index) => ({
  xModel: (index < 3 ? -1 : 1) * 0.72,
  zModel: (index % 3 - 1) * 0.49,
}))

interface MinerWheelContact {
  readonly xM: number
  readonly zM: number
  readonly surfaceY: number
  readonly wheelBottomY: number
}

export interface MinerGrounding {
  readonly position: Readonly<{ x: number; y: number; z: number }>
  readonly orientation: Quaternion
  readonly wheelOffsetsModel: readonly number[]
  readonly wheelContacts: readonly MinerWheelContact[]
}

function sampleWheelSurfaces(
  terrain: SurfaceTerrainProfile,
  segments: number,
  centerXM: number,
  centerZM: number,
  orientation: Quaternion,
  wheelOffsetsModel: readonly number[],
) {
  return WHEEL_CONTACTS.map((contact, index) => {
    const offset = new Vector3(
      contact.xModel,
      WHEEL_BOTTOM_Y_MODEL + (wheelOffsetsModel[index] ?? 0),
      contact.zModel,
    )
      .multiplyScalar(ROBOT_MODEL_SCALE_M * LOCAL_METRES_TO_RENDER_UNITS)
      .applyQuaternion(orientation)
    const xM = centerXM + offset.x / LOCAL_METRES_TO_RENDER_UNITS
    const zM = centerZM + offset.z / LOCAL_METRES_TO_RENDER_UNITS

    return {
      offset,
      surface: sampleRenderedSurface(terrain, segments, xM, zM),
      xM,
      zM,
    }
  })
}

function solveWheelPlaneOrientation(
  headingRad: number,
  samples: ReturnType<typeof sampleWheelSurfaces>,
): Quaternion {
  const meanHeightM =
    samples.reduce(
      (sum, sample) => sum + sample.surface.y / LOCAL_METRES_TO_RENDER_UNITS,
      0,
    ) / samples.length
  let rightNumerator = 0
  let rightDenominator = 0
  let forwardNumerator = 0
  let forwardDenominator = 0

  samples.forEach((sample, index) => {
    const contact = WHEEL_CONTACTS[index]

    if (contact === undefined) {
      return
    }

    const rightM = contact.xModel * ROBOT_MODEL_SCALE_M
    const forwardM = contact.zModel * ROBOT_MODEL_SCALE_M
    const relativeHeightM =
      sample.surface.y / LOCAL_METRES_TO_RENDER_UNITS - meanHeightM
    rightNumerator += rightM * relativeHeightM
    rightDenominator += rightM * rightM
    forwardNumerator += forwardM * relativeHeightM
    forwardDenominator += forwardM * forwardM
  })

  const rightSlope =
    rightDenominator === 0 ? 0 : rightNumerator / rightDenominator
  const forwardSlope =
    forwardDenominator === 0 ? 0 : forwardNumerator / forwardDenominator
  const flatRight = new Vector3(
    Math.cos(headingRad),
    0,
    -Math.sin(headingRad),
  )
  const flatForward = new Vector3(
    Math.sin(headingRad),
    0,
    Math.cos(headingRad),
  )
  const up = new Vector3(0, 1, 0)
    .addScaledVector(flatRight, -rightSlope)
    .addScaledVector(flatForward, -forwardSlope)
    .normalize()
  const forward = flatForward
    .clone()
    .addScaledVector(up, -flatForward.dot(up))
    .normalize()
  const right = up.clone().cross(forward).normalize()
  forward.copy(right).cross(up).normalize()

  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(right, up, forward),
  )
}

/**
 * Fits the rover to the six rendered wheel contacts, then lets each wheel's
 * short-travel suspension finish the exact contact without bobbing the root.
 */
export function calculateMinerGrounding(
  terrain: SurfaceTerrainProfile,
  segments: number,
  centerXM: number,
  centerZM: number,
  headingRad: number,
): MinerGrounding {
  const headingOrientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    headingRad,
  )
  let orientation = headingOrientation
  let samples = sampleWheelSurfaces(
    terrain,
    segments,
    centerXM,
    centerZM,
    orientation,
    WHEEL_CONTACTS.map(() => 0),
  )

  for (let iteration = 0; iteration < 2; iteration += 1) {
    orientation = solveWheelPlaneOrientation(headingRad, samples)
    samples = sampleWheelSurfaces(
      terrain,
      segments,
      centerXM,
      centerZM,
      orientation,
      WHEEL_CONTACTS.map(() => 0),
    )
  }

  const embed = WHEEL_SURFACE_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS
  const rootY = Math.max(
    ...samples.map((sample) => sample.surface.y - embed - sample.offset.y),
  )
  const localUpWorldY = new Vector3(0, 1, 0).applyQuaternion(orientation).y
  const wheelOffsetsModel = WHEEL_CONTACTS.map(() => 0)

  for (let iteration = 0; iteration < 3; iteration += 1) {
    samples = sampleWheelSurfaces(
      terrain,
      segments,
      centerXM,
      centerZM,
      orientation,
      wheelOffsetsModel,
    )
    samples.forEach((sample, index) => {
      wheelOffsetsModel[index] =
        (wheelOffsetsModel[index] ?? 0) +
        (sample.surface.y - embed - (rootY + sample.offset.y)) /
          (ROBOT_MODEL_SCALE_M *
            LOCAL_METRES_TO_RENDER_UNITS *
            localUpWorldY)
    })
  }

  samples = sampleWheelSurfaces(
    terrain,
    segments,
    centerXM,
    centerZM,
    orientation,
    wheelOffsetsModel,
  )
  const center = sampleRenderedSurface(
    terrain,
    segments,
    centerXM,
    centerZM,
  )

  return {
    position: { x: center.x, y: rootY, z: center.z },
    orientation,
    wheelOffsetsModel,
    wheelContacts: samples.map((sample) => ({
      xM: sample.xM,
      zM: sample.zM,
      surfaceY: sample.surface.y,
      wheelBottomY: rootY + sample.offset.y,
    })),
  }
}

function MiningEffects({ outpost, terrain, segments }: MiningEffectsProps) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(new Float32Array(24 * 3), 3))
    return result
  }, [])
  const material = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.playerHotMetal,
        depthWrite: false,
        opacity: 0.72,
        size: 0.000076,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )
  const groupRef = useRef<Group>(null)

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    if (groupRef.current === null) {
      return
    }

    const nowMs = simulationNowMs()
    const kinematics = getRobotKinematics(outpost, nowMs)
    const mining = outpost.robot.state === 'mining'

    if (!mining && !kinematics.moving) {
      return
    }

    const contactXM =
      kinematics.position.xM +
      (mining ? Math.sin(kinematics.headingRad) * 1.92 : 0)
    const contactZM =
      kinematics.position.zM +
      (mining ? Math.cos(kinematics.headingRad) * 1.92 : 0)
    const contact = sampleRenderedSurface(
      terrain,
      segments,
      contactXM,
      contactZM,
    )
    groupRef.current.position.set(
      contact.x,
      contact.y + (mining ? 0.12 : 0.06) * LOCAL_METRES_TO_RENDER_UNITS,
      contact.z,
    )

    material.color.set(
      mining ? VISUAL_PALETTE.playerHotMetal : VISUAL_PALETTE.lunarSunlit,
    )
    material.opacity = mining ? 0.72 : 0.24
    material.size = mining ? 0.000076 : 0.000066

    const positions = geometry.getAttribute('position') as BufferAttribute
    const array = positions.array as Float32Array
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000

    for (let index = 0; index < 24; index += 1) {
      const offset = index * 3
      const age = (elapsed * (1.35 + (index % 5) * 0.11) + index * 0.071) % 1
      if (mining) {
        const angle = index * 2.399 + elapsed * 0.7
        const radialM = age * (0.45 + (index % 4) * 0.12)
        array[offset] = Math.cos(angle) * radialM * LOCAL_METRES_TO_RENDER_UNITS
        array[offset + 1] =
          (age * 0.72 - age * age * 0.62) * LOCAL_METRES_TO_RENDER_UNITS
        array[offset + 2] = Math.sin(angle) * radialM * LOCAL_METRES_TO_RENDER_UNITS
      } else {
        const heading = kinematics.headingRad
        const trailM = age * (0.72 + (index % 5) * 0.11)
        const lateralM = Math.sin(index * 2.17) * (0.12 + age * 0.38)
        array[offset] =
          (-Math.sin(heading) * trailM + Math.cos(heading) * lateralM) *
          LOCAL_METRES_TO_RENDER_UNITS
        array[offset + 1] =
          (0.025 + age * (1 - age) * 0.22) * LOCAL_METRES_TO_RENDER_UNITS
        array[offset + 2] =
          (-Math.cos(heading) * trailM - Math.sin(heading) * lateralM) *
          LOCAL_METRES_TO_RENDER_UNITS
      }
    }

    positions.needsUpdate = true
  })

  return (
    <group
      ref={groupRef}
      visible={
        outpost.robot.state === 'deploying' ||
        outpost.robot.state === 'traveling' ||
        outpost.robot.state === 'mining' ||
        outpost.robot.state === 'returning'
      }
    >
      <points geometry={geometry} material={material} />
    </group>
  )
}

export function MinerRobot({ outpost, terrain, segments }: MinerRobotProps) {
  const robotRef = useRef<Group>(null)
  const upperMachineryRef = useRef<Group>(null)
  const wheelRef = useRef<InstancedMesh>(null)
  const treadRef = useRef<InstancedMesh>(null)
  const structureRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const drillArmRef = useRef<Group>(null)
  const drillBitRef = useRef<Mesh>(null)
  const cargoRef = useRef<Group>(null)
  const wheelDummyRef = useRef(new Object3D())
  const structureDummyRef = useRef(new Object3D())
  const projectedPointRef = useRef(new Vector3())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const wheelGeometry = useMemo(
    () => new CylinderGeometry(0.23, 0.23, 0.18, 12),
    [],
  )
  const treadGeometry = useMemo(() => new BoxGeometry(0.24, 0.34, 1.46), [])
  const structureGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const wheelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [],
  )
  const treadMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.contactDark,
        ...MATERIAL_RESPONSE.contact,
      }),
    [],
  )
  const structureMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [],
  )
  const lightMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.panel,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const isE2e = useMemo(
    () => new URLSearchParams(window.location.search).has('e2e'),
    [],
  )

  useLayoutEffect(() => {
    const treadMesh = treadRef.current
    const structureMesh = structureRef.current
    const lights = lightRef.current

    if (treadMesh === null || structureMesh === null || lights === null) {
      return
    }

    const dummy = new Object3D()

    for (let index = 0; index < 2; index += 1) {
      dummy.position.set(index === 0 ? -0.61 : 0.61, -0.1, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(0.55, 0.72, 1)
      dummy.updateMatrix()
      treadMesh.setMatrixAt(index, dummy.matrix)
    }
    treadMesh.instanceMatrix.needsUpdate = true

    const structureParts = [
      { position: [0, 0.2, 0] as const, scale: [1.14, 0.42, 1.18] as const },
      { position: [0, 0.58, -0.14] as const, scale: [0.72, 0.36, 0.64] as const },
      { position: [0, 0.49, 0.46] as const, scale: [0.9, 0.28, 0.34] as const },
      { position: [-0.61, 0.08, 0] as const, scale: [0.16, 0.25, 1.4] as const },
      { position: [0.61, 0.08, 0] as const, scale: [0.16, 0.25, 1.4] as const },
      { position: [0, 0.55, -0.6] as const, scale: [0.86, 0.1, 0.5] as const },
      { position: [-0.43, 0.73, -0.62] as const, scale: [0.08, 0.36, 0.58] as const },
      { position: [0.43, 0.73, -0.62] as const, scale: [0.08, 0.36, 0.58] as const },
      { position: [0, 0.73, -0.89] as const, scale: [0.86, 0.36, 0.08] as const },
      { position: [0, 0.65, -0.35] as const, scale: [0.86, 0.2, 0.08] as const },
      { position: [0, 1, -0.17] as const, scale: [0.08, 0.6, 0.08] as const },
      { position: [0, 0.13, 0.73] as const, scale: [1.02, 0.15, 0.13] as const },
      { position: [0, 0.39, 0.63] as const, scale: [0.48, 0.18, 0.2] as const },
      { position: [0, 0.28, 1.06] as const, scale: [0.22, 0.2, 0.74] as const },
    ]
    const structureDummy = structureDummyRef.current

    structureParts.forEach((definition, index) => {
      structureDummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      structureDummy.rotation.set(0, 0, 0)
      structureDummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      structureDummy.updateMatrix()
      structureMesh.setMatrixAt(index, structureDummy.matrix)
    })

    structureMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    structureMesh.instanceMatrix.needsUpdate = true

    const lightParts = [
      { position: [-0.32, 0.55, 0.65] as const, scale: [0.18, 0.11, 0.045] as const },
      { position: [0.32, 0.55, 0.65] as const, scale: [0.18, 0.11, 0.045] as const },
      { position: [0, 1.31, -0.17] as const, scale: [0.13, 0.08, 0.13] as const },
    ]

    lightParts.forEach((definition, index) => {
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
      lights.setMatrixAt(index, dummy.matrix)
    })
    lights.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      wheelGeometry.dispose()
      treadGeometry.dispose()
      structureGeometry.dispose()
      wheelMaterial.dispose()
      treadMaterial.dispose()
      structureMaterial.dispose()
      lightMaterial.dispose()
    },
    [
      lightMaterial,
      structureGeometry,
      structureMaterial,
      treadGeometry,
      treadMaterial,
      wheelGeometry,
      wheelMaterial,
    ],
  )

  useFrame((state) => {
    const robot = robotRef.current
    const upperMachinery = upperMachineryRef.current
    const wheels = wheelRef.current
    const structure = structureRef.current
    const drillArm = drillArmRef.current
    const drillBit = drillBitRef.current

    if (
      robot === null ||
      upperMachinery === null ||
      wheels === null ||
      structure === null ||
      drillArm === null ||
      drillBit === null
    ) {
      return
    }

    const nowMs = simulationNowMs()
    const kinematics = getRobotKinematics(outpost, nowMs)
    const grounding = calculateMinerGrounding(
      terrain,
      segments,
      kinematics.position.xM,
      kinematics.position.zM,
      kinematics.headingRad,
    )
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000
    const movingPulse = kinematics.moving ? Math.sin(elapsed * 17) : 0
    const deploymentLiftM = Math.max(
      0,
      kinematics.clearanceM - ROBOT_LANDED_CLEARANCE_M,
    )

    robot.position.set(
      grounding.position.x,
      grounding.position.y + deploymentLiftM * LOCAL_METRES_TO_RENDER_UNITS,
      grounding.position.z,
    )
    robot.quaternion.copy(grounding.orientation)
    upperMachinery.position.y = movingPulse * 0.024
    upperMachinery.rotation.x = movingPulse * 0.006
    upperMachinery.rotation.z = movingPulse * 0.01

    if (isE2e && outpost.robot.state !== 'stored') {
      projectedPointRef.current
        .set(
          robot.position.x,
          robot.position.y + 0.95 * LOCAL_METRES_TO_RENDER_UNITS,
          robot.position.z,
        )
        .applyQuaternion(transform.orientation)
        .add(transform.position)
        .project(state.camera)
      const canvas = state.gl.domElement
      canvas.dataset.robotX = String(
        ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
      )
      canvas.dataset.robotY = String(
        ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
      )
    }

    const dummy = wheelDummyRef.current
    const wheelSpin = kinematics.moving ? elapsed * 13.5 : 0

    for (let index = 0; index < 6; index += 1) {
      const side = index < 3 ? -1 : 1
      const longitudinal = (index % 3 - 1) * 0.49
      dummy.position.set(
        side * 0.72,
        WHEEL_CENTER_Y_MODEL + (grounding.wheelOffsetsModel[index] ?? 0),
        longitudinal,
      )
      dummy.rotation.set(wheelSpin * side, 0, Math.PI / 2)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      wheels.setMatrixAt(index, dummy.matrix)
    }

    wheels.instanceMatrix.setUsage(DynamicDrawUsage)
    wheels.instanceMatrix.needsUpdate = true

    const mining = outpost.robot.state === 'mining'
    drillArm.rotation.x = mining ? -0.19 + Math.sin(elapsed * 14) * 0.055 : -0.04
    drillArm.position.z = mining ? 0.78 + Math.sin(elapsed * 11) * 0.05 : 0.72
    drillBit.rotation.z = mining ? elapsed * 28 : 0

    const structureDummy = structureDummyRef.current
    const armAngle = drillArm.rotation.x
    structureDummy.position.set(
      0,
      drillArm.position.y - Math.sin(armAngle) * 0.34,
      drillArm.position.z + Math.cos(armAngle) * 0.34,
    )
    structureDummy.rotation.set(armAngle, 0, 0)
    structureDummy.scale.set(0.22, 0.2, 0.74)
    structureDummy.updateMatrix()
    structure.setMatrixAt(DRILL_ARM_INSTANCE_INDEX, structureDummy.matrix)
    structure.instanceMatrix.needsUpdate = true

    lightMaterial.emissiveIntensity = Math.min(
      EMISSIVE_LIMITS.activePanel,
      EMISSIVE_LIMITS.panel + Math.sin(state.clock.elapsedTime * 4.1) * 0.045,
    )

    if (cargoRef.current !== null) {
      const unloadingScale =
        outpost.robot.state === 'unloading'
          ? Math.max(0, 1 - kinematics.stateProgress)
          : 1
      cargoRef.current.scale.setScalar(unloadingScale)
      cargoRef.current.visible =
        outpost.robot.carriedOre > 0 && unloadingScale > 0.02
    }
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group
        ref={robotRef}
        name="miner-robot"
        scale={LOCAL_METRES_TO_RENDER_UNITS * ROBOT_MODEL_SCALE_M}
        visible={outpost.robot.state !== 'stored'}
      >
        <instancedMesh
          ref={treadRef}
          args={[treadGeometry, treadMaterial, 2]}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={wheelRef}
          args={[wheelGeometry, wheelMaterial, 6]}
          castShadow
        />
        <group ref={upperMachineryRef}>
          <instancedMesh
            ref={structureRef}
            args={[structureGeometry, structureMaterial, 14]}
            castShadow
            receiveShadow
          />
          <instancedMesh
            ref={lightRef}
            args={[structureGeometry, lightMaterial, 3]}
          />
          <group ref={drillArmRef} position={[0, 0.28, 0.72]}>
            <mesh
              ref={drillBitRef}
              position-z={0.86}
              rotation-x={Math.PI / 2}
              castShadow
            >
              <coneGeometry args={[0.23, 0.7, 10, 3]} />
              <meshStandardMaterial
                color={VISUAL_PALETTE.neutralMachinery}
                {...MATERIAL_RESPONSE.neutralMachinery}
              />
            </mesh>
          </group>
          <group ref={cargoRef} position={[0, 0.77, -0.62]} visible={false}>
            <mesh castShadow scale={[1.3, 0.72, 1]}>
              <octahedronGeometry args={[0.24, 0]} />
              <meshStandardMaterial
                color={VISUAL_PALETTE.playerHotMetal}
                emissive={VISUAL_PALETTE.damageHeat}
                emissiveIntensity={0.16}
                metalness={0.22}
                roughness={0.78}
              />
            </mesh>
          </group>
        </group>
      </group>
      <MiningEffects outpost={outpost} terrain={terrain} segments={segments} />
    </group>
  )
}
