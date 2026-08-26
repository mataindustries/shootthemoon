import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointsMaterial,
  Vector3,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'

interface MinerRobotProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
}

interface MiningEffectsProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
}

function MiningEffects({ outpost, terrain }: MiningEffectsProps) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(new Float32Array(24 * 3), 3))
    return result
  }, [])
  const material = useMemo(
    () =>
      new PointsMaterial({
        color: new Color('#ff9b52'),
        depthWrite: false,
        opacity: 0.86,
        size: 0.00008,
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
    const contact = localSurfaceToRender(terrain, contactXM, contactZM)
    groupRef.current.position.set(
      contact.x,
      contact.y + (mining ? 0.12 : 0.06) * LOCAL_METRES_TO_RENDER_UNITS,
      contact.z,
    )

    material.color.set(mining ? '#ff9b52' : '#aaa49d')
    material.opacity = mining ? 0.86 : 0.3
    material.size = mining ? 0.00008 : 0.000072

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
      <mesh
        position-y={0.000012}
        rotation-x={-Math.PI / 2}
        scale={0.0003}
        visible={outpost.robot.state === 'mining'}
      >
        <ringGeometry args={[0.62, 1, 18]} />
        <meshBasicMaterial
          color="#ce5b24"
          depthWrite={false}
          opacity={0.28}
          transparent
        />
      </mesh>
    </group>
  )
}

export function MinerRobot({ outpost, terrain }: MinerRobotProps) {
  const robotRef = useRef<Group>(null)
  const chassisRef = useRef<Group>(null)
  const wheelRef = useRef<InstancedMesh>(null)
  const treadRef = useRef<InstancedMesh>(null)
  const structureRef = useRef<InstancedMesh>(null)
  const drillArmRef = useRef<Group>(null)
  const drillBitRef = useRef<Mesh>(null)
  const statusMaterialRef = useRef<MeshStandardMaterial>(null)
  const cargoRef = useRef<Group>(null)
  const wheelDummyRef = useRef(new Object3D())
  const structureDummyRef = useRef(new Object3D())
  const projectedPointRef = useRef(new Vector3())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const wheelGeometry = useMemo(() => new CylinderGeometry(0.22, 0.22, 0.16, 10), [])
  const treadGeometry = useMemo(() => new BoxGeometry(0.22, 0.34, 1.42), [])
  const structureGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const wheelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#171a1f',
        metalness: 0.58,
        roughness: 0.68,
      }),
    [],
  )
  const treadMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#262a2f',
        metalness: 0.62,
        roughness: 0.58,
      }),
    [],
  )
  const structureMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        emissive: '#596672',
        emissiveIntensity: 0.48,
        metalness: 0.72,
        roughness: 0.34,
        vertexColors: true,
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

    if (treadMesh === null || structureMesh === null) {
      return
    }

    const dummy = new Object3D()

    for (let index = 0; index < 2; index += 1) {
      dummy.position.set(index === 0 ? -0.66 : 0.66, -0.12, 0)
      dummy.updateMatrix()
      treadMesh.setMatrixAt(index, dummy.matrix)
    }

    treadMesh.instanceMatrix.needsUpdate = true

    const structureParts = [
      {
        position: [0, 0.22, 0] as const,
        scale: [1.16, 0.52, 1.3] as const,
        color: '#6f7983',
      },
      {
        position: [0, 0.61, -0.1] as const,
        scale: [0.78, 0.42, 0.68] as const,
        color: '#59636d',
      },
      {
        position: [0, 0.98, -0.17] as const,
        scale: [0.07, 0.5, 0.07] as const,
        color: '#9099a1',
      },
      {
        position: [-0.66, 0.09, 0] as const,
        scale: [0.13, 0.16, 1.46] as const,
        color: '#343a40',
      },
      {
        position: [0.66, 0.09, 0] as const,
        scale: [0.13, 0.16, 1.46] as const,
        color: '#343a40',
      },
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
      structureMesh.setColorAt(index, new Color(definition.color))
    })

    structureDummy.position.set(0, 0.294, 1.06)
    structureDummy.rotation.set(-0.04, 0, 0)
    structureDummy.scale.set(0.22, 0.2, 0.74)
    structureDummy.updateMatrix()
    structureMesh.setMatrixAt(5, structureDummy.matrix)
    structureMesh.setColorAt(5, new Color('#77808a'))

    structureMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    structureMesh.instanceMatrix.needsUpdate = true

    if (structureMesh.instanceColor !== null) {
      structureMesh.instanceColor.needsUpdate = true
    }
  }, [])

  useEffect(
    () => () => {
      wheelGeometry.dispose()
      treadGeometry.dispose()
      structureGeometry.dispose()
      wheelMaterial.dispose()
      treadMaterial.dispose()
      structureMaterial.dispose()
    },
    [
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
    const chassis = chassisRef.current
    const wheels = wheelRef.current
    const structure = structureRef.current
    const drillArm = drillArmRef.current
    const drillBit = drillBitRef.current

    if (
      robot === null ||
      chassis === null ||
      wheels === null ||
      structure === null ||
      drillArm === null ||
      drillBit === null
    ) {
      return
    }

    const nowMs = simulationNowMs()
    const kinematics = getRobotKinematics(outpost, nowMs)
    const ground = localSurfaceToRender(
      terrain,
      kinematics.position.xM,
      kinematics.position.zM,
    )
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000
    const movingPulse = kinematics.moving ? Math.sin(elapsed * 17) : 0
    const slopeSampleOffsetM = 0.72
    const eastGround = localSurfaceToRender(
      terrain,
      kinematics.position.xM + slopeSampleOffsetM,
      kinematics.position.zM,
    )
    const westGround = localSurfaceToRender(
      terrain,
      kinematics.position.xM - slopeSampleOffsetM,
      kinematics.position.zM,
    )
    const southGround = localSurfaceToRender(
      terrain,
      kinematics.position.xM,
      kinematics.position.zM + slopeSampleOffsetM,
    )
    const northGround = localSurfaceToRender(
      terrain,
      kinematics.position.xM,
      kinematics.position.zM - slopeSampleOffsetM,
    )
    const sampleSpan = slopeSampleOffsetM * 2 * LOCAL_METRES_TO_RENDER_UNITS
    const slopeX = (eastGround.y - westGround.y) / sampleSpan
    const slopeZ = (southGround.y - northGround.y) / sampleSpan
    const forwardSlope =
      slopeX * Math.sin(kinematics.headingRad) +
      slopeZ * Math.cos(kinematics.headingRad)
    const sideSlope =
      slopeX * Math.cos(kinematics.headingRad) -
      slopeZ * Math.sin(kinematics.headingRad)

    robot.position.set(
      ground.x,
      ground.y + kinematics.clearanceM * LOCAL_METRES_TO_RENDER_UNITS,
      ground.z,
    )
    robot.rotation.y = kinematics.headingRad
    chassis.position.y = movingPulse * 0.035
    chassis.rotation.x = -Math.atan(forwardSlope) + movingPulse * 0.009
    chassis.rotation.z = Math.atan(sideSlope) + movingPulse * 0.018

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
      dummy.position.set(side * 0.72, -0.19, longitudinal)
      dummy.rotation.set(wheelSpin * side, 0, Math.PI / 2)
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
    structure.setMatrixAt(5, structureDummy.matrix)
    structure.instanceMatrix.needsUpdate = true

    if (statusMaterialRef.current !== null) {
      statusMaterialRef.current.emissiveIntensity =
        1.6 + Math.sin(state.clock.elapsedTime * 6.5) * 0.5
    }

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
        scale={LOCAL_METRES_TO_RENDER_UNITS * 1.14}
        visible={outpost.robot.state !== 'stored'}
      >
        <group ref={chassisRef}>
          <instancedMesh
            ref={treadRef}
            args={[treadGeometry, treadMaterial, 2]}
            receiveShadow
          />
          <instancedMesh
            ref={wheelRef}
            args={[wheelGeometry, wheelMaterial, 6]}
          />
          <instancedMesh
            ref={structureRef}
            args={[structureGeometry, structureMaterial, 6]}
            castShadow
            receiveShadow
          />
          <mesh position={[0, 0.61, 0.255]}>
            <boxGeometry args={[0.5, 0.085, 0.035]} />
            <meshStandardMaterial
              ref={statusMaterialRef}
              color="#8e2f14"
              emissive="#ff5e21"
              emissiveIntensity={1.8}
              metalness={0.42}
              roughness={0.26}
            />
          </mesh>
          <group ref={drillArmRef} position={[0, 0.28, 0.72]}>
            <mesh
              ref={drillBitRef}
              position-z={0.86}
              rotation-x={Math.PI / 2}
            >
              <coneGeometry args={[0.22, 0.68, 8, 2]} />
              <meshStandardMaterial
                color="#e0c19c"
                emissive="#7a3a18"
                emissiveIntensity={0.45}
                metalness={0.82}
                roughness={0.24}
              />
            </mesh>
          </group>
          <group ref={cargoRef} position={[0, 0.58, -0.56]} visible={false}>
            <mesh castShadow>
              <boxGeometry args={[0.62, 0.34, 0.42]} />
              <meshStandardMaterial
                color="#5a2415"
                emissive="#a63a16"
                emissiveIntensity={0.55}
                metalness={0.48}
                roughness={0.4}
              />
            </mesh>
            <mesh position-y={0.23}>
              <octahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial
                color="#e6aa68"
                emissive="#c65b22"
                emissiveIntensity={0.8}
                metalness={0.26}
                roughness={0.52}
              />
            </mesh>
          </group>
          <mesh position={[0, 1.27, -0.17]}>
            <octahedronGeometry args={[0.09, 0]} />
            <meshBasicMaterial color="#ff7031" />
          </mesh>
        </group>
      </group>
      <MiningEffects outpost={outpost} terrain={terrain} />
    </group>
  )
}
