import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  Matrix4,
  Object3D,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { useFrame } from '@react-three/fiber'
import { createMiningKit, disposeMiningKit } from '../render/miningKit.ts'
import { createMiningRobotModels } from './miningModels.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
} from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import {
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import {
  E2E_HARNESS_BUILD_ENABLED,
  shouldEnableE2eHarness,
} from '../testing/e2eHarness.ts'

interface MinerRobotProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly compact?: boolean
}

interface MiningEffectsProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

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

export function calculateMiningLaser(
  terrain: SurfaceTerrainProfile,
  segments: number,
  xM: number,
  zM: number,
  headingRad: number,
) {
  const grounding = calculateMinerGrounding(terrain, segments, xM, zM, headingRad)
  const emitter = new Vector3(0, 0, 0.582)
    .applyAxisAngle(new Vector3(1, 0, 0), 0.44)
    .add(new Vector3(0, 0.65, 0.5))
    .multiplyScalar(ROBOT_MODEL_SCALE_M * LOCAL_METRES_TO_RENDER_UNITS)
    .applyQuaternion(grounding.orientation)
    .add(new Vector3(grounding.position.x, grounding.position.y, grounding.position.z))
  const ground = sampleRenderedSurface(terrain, segments,
    xM + Math.sin(headingRad) * 1.92, zM + Math.cos(headingRad) * 1.92)
  const contact = new Vector3(ground.x, ground.y + 0.015 * LOCAL_METRES_TO_RENDER_UNITS, ground.z)
  return { emitter, contact }
}

function MiningEffects({ outpost, terrain, segments }: MiningEffectsProps) {
  // Mining holds the rover still. Solve terrain attachment once per job,
  // leaving only the small pulse and twelve particle positions to animate.
  const laser = useMemo(() => {
    if (outpost.robot.state !== 'mining') return null
    const pose = getRobotKinematics(outpost, outpost.robot.stateStartedAtMs)
    return calculateMiningLaser(terrain, segments, pose.position.xM, pose.position.zM, pose.headingRad)
  }, [terrain, segments, outpost.robot.state, outpost.robot.stateStartedAtMs, outpost.robot.targetDepositId])
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(new Float32Array(12 * 3), 3))
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
  const beamRef = useRef<Mesh>(null)
  const heatRef = useRef<Mesh>(null)
  const beamDirection = useMemo(() => new Vector3(), [])
  const beamUp = useMemo(() => new Vector3(0, 1, 0), [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((state) => {
    state.gl.domElement.dataset.miningLaser = outpost.robot.state === 'mining' ? 'contact' : 'off'
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
    const contact = laser?.contact ?? sampleRenderedSurface(
      terrain,
      segments,
      contactXM,
      contactZM,
    )
    groupRef.current.position.set(contact.x, contact.y + 0.015 * LOCAL_METRES_TO_RENDER_UNITS, contact.z)
    if (mining && laser !== null && beamRef.current !== null) {
      groupRef.current.position.copy(laser.contact)
      beamDirection.copy(laser.emitter).sub(laser.contact)
      beamRef.current.position.copy(beamDirection).multiplyScalar(0.5)
      beamRef.current.scale.set(0.022 * LOCAL_METRES_TO_RENDER_UNITS, beamDirection.length(), 0.022 * LOCAL_METRES_TO_RENDER_UNITS)
      beamRef.current.quaternion.setFromUnitVectors(beamUp, beamDirection.normalize())
      if (heatRef.current !== null) {
        const pulse = 0.94 + Math.sin(nowMs * 0.009) * 0.06
        heatRef.current.scale.set(0.24 * pulse, 0.045, 0.18 * pulse)
      }
    }

    material.color.set(
      mining ? VISUAL_PALETTE.playerHotMetal : VISUAL_PALETTE.lunarSunlit,
    )
    material.opacity = mining ? 0.36 : 0.24
    material.size = mining ? 0.000026 : 0.000066

    const positions = geometry.getAttribute('position') as BufferAttribute
    const array = positions.array as Float32Array
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000

    for (let index = 0; index < 12; index += 1) {
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
      <points geometry={geometry} material={material} renderOrder={2} />
      <group name="laser-extraction" visible={outpost.robot.state === 'mining'}>
        {/* SurfacePatch is translucent at order 1. Effects follow it while
            still depth-testing against opaque machinery and the Moon. */}
        <mesh ref={beamRef} name="mining-laser-beam" renderOrder={2}>
          <cylinderGeometry args={[1, 0.65, 1, 6]} />
          <meshBasicMaterial color={VISUAL_PALETTE.playerLaserCore} transparent opacity={0.62} depthWrite={false} />
        </mesh>
        <group scale={LOCAL_METRES_TO_RENDER_UNITS}>
          <mesh scale={[0.065, 0.045, 0.065]} name="mining-contact-glow" renderOrder={2}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={VISUAL_PALETTE.playerLaserCore} transparent opacity={0.72} depthWrite={false} />
          </mesh>
          <mesh ref={heatRef} scale={[0.24, 0.045, 0.18]} renderOrder={2}>
            <sphereGeometry args={[1, 10, 6]} />
            <meshBasicMaterial color={VISUAL_PALETTE.playerAmberEmissive} transparent opacity={0.22} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export function MinerRobot({ outpost, terrain, segments, compact = false }: MinerRobotProps) {
  const robotRef = useRef<Group>(null)
  const upperRef = useRef<Group>(null)
  const wheelRef = useRef<InstancedMesh>(null)
  const laserArmRef = useRef<Group>(null)
  const sensorRef = useRef<Group>(null)
  const cargoRef = useRef<Group>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const projected = useMemo(() => new Vector3(), [])
  const transform = useMemo(() => landingSiteToRenderTransform(outpost.site), [outpost.site])
  const kit = useMemo(createMiningKit, [])
  const models = useMemo(() => createMiningRobotModels(kit), [kit])
  const isE2e = useMemo(() => shouldEnableE2eHarness(E2E_HARNESS_BUILD_ENABLED, window.location.search), [])
  useLayoutEffect(() => { wheelRef.current?.instanceMatrix.setUsage(DynamicDrawUsage) }, [])
  useEffect(() => () => {
    Object.values(models).forEach(geometry => geometry.dispose())
    disposeMiningKit(kit)
  }, [kit, models])

  useFrame((state) => {
    const robot = robotRef.current, upper = upperRef.current, wheels = wheelRef.current
    if (!robot || !upper || !wheels) return
    const nowMs = simulationNowMs()
    const kinematics = getRobotKinematics(outpost, nowMs)
    const grounding = calculateMinerGrounding(terrain, segments, kinematics.position.xM, kinematics.position.zM, kinematics.headingRad)
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000
    const movingPulse = kinematics.moving ? Math.sin(elapsed * 17) : 0
    const liftM = Math.max(0, kinematics.clearanceM - ROBOT_LANDED_CLEARANCE_M)
    robot.position.set(grounding.position.x, grounding.position.y + liftM * LOCAL_METRES_TO_RENDER_UNITS, grounding.position.z)
    robot.quaternion.copy(grounding.orientation)
    upper.position.y = movingPulse * .024
    upper.rotation.set(movingPulse * .006, 0, movingPulse * .01)
    const mining = outpost.robot.state === 'mining'
    if (sensorRef.current) sensorRef.current.rotation.y = mining ? 0 : Math.sin(nowMs * .00065) * .22
    if (laserArmRef.current) {
      // Preserve the proven muzzle pose and contact line exactly.
      laserArmRef.current.rotation.x = mining ? .44 : -.04
      laserArmRef.current.position.z = mining ? .5 : .72
    }
    for (let index = 0; index < 6; index++) {
      const side = index < 3 ? -1 : 1
      dummy.position.set(side * .72, WHEEL_CENTER_Y_MODEL + (grounding.wheelOffsetsModel[index] ?? 0), (index % 3 - 1) * .49)
      dummy.rotation.set(kinematics.moving ? elapsed * 13.5 * side : 0, 0, Math.PI / 2)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      wheels.setMatrixAt(index, dummy.matrix)
    }
    wheels.instanceMatrix.needsUpdate = true
    wheels.computeBoundingSphere()
    if (cargoRef.current) {
      const unload = outpost.robot.state === 'unloading' ? Math.max(0, 1 - kinematics.stateProgress) : 1
      cargoRef.current.scale.setScalar(unload)
      cargoRef.current.visible = outpost.robot.carriedOre > 0 && unload > .02
    }
    if (isE2e && outpost.robot.state !== 'stored') {
      projected.set(robot.position.x, robot.position.y + .95 * LOCAL_METRES_TO_RENDER_UNITS, robot.position.z)
        .applyQuaternion(transform.orientation).add(transform.position).project(state.camera)
      state.gl.domElement.dataset.robotX = String((projected.x + 1) * state.size.width / 2)
      state.gl.domElement.dataset.robotY = String((1 - projected.y) * state.size.height / 2)
    }
  })
  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group ref={robotRef} name="miner-robot" scale={LOCAL_METRES_TO_RENDER_UNITS * ROBOT_MODEL_SCALE_M} visible={outpost.robot.state !== 'stored'}>
        <instancedMesh ref={wheelRef} args={[models.wheel, kit.material, 6]} />
        <group ref={upperRef}>
          <mesh name="miner-carbon-chassis" geometry={models.body} material={kit.material} castShadow receiveShadow />
          <group ref={sensorRef} position={[0, 1.04, -.18]} visible={!compact}>
            <mesh geometry={models.sensor} material={kit.material} />
          </group>
          <group ref={laserArmRef} position={[0, .65, .72]} visible={!compact}>
            <mesh name="miner-articulated-laser" geometry={models.arm} material={kit.material} />
          </group>
          <group ref={cargoRef} position={[0, .68, -.61]} visible={false}>
            <mesh geometry={models.cargo} material={kit.material} />
          </group>
        </group>
      </group>
      {!compact ? <MiningEffects outpost={outpost} terrain={terrain} segments={segments} /> : null}
    </group>
  )
}
