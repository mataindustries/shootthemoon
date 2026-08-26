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
import {
  isSimulationTimePaused,
  simulationNowMs,
} from '../simulation/simulationTime.ts'

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
        size: 0.000055,
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

  useFrame((state) => {
    if (outpost.robot.state !== 'mining' || groupRef.current === null) {
      return
    }

    const nowMs = simulationNowMs()
    const kinematics = getRobotKinematics(outpost, nowMs)
    const contactXM =
      kinematics.position.xM + Math.sin(kinematics.headingRad) * 1.05
    const contactZM =
      kinematics.position.zM + Math.cos(kinematics.headingRad) * 1.05
    const contact = localSurfaceToRender(terrain, contactXM, contactZM)
    groupRef.current.position.set(
      contact.x,
      contact.y + 0.12 * LOCAL_METRES_TO_RENDER_UNITS,
      contact.z,
    )

    const positions = geometry.getAttribute('position') as BufferAttribute
    const array = positions.array as Float32Array
    const elapsed = (nowMs - outpost.robot.stateStartedAtMs) / 1_000

    for (let index = 0; index < 24; index += 1) {
      const offset = index * 3
      const age = (elapsed * (1.35 + (index % 5) * 0.11) + index * 0.071) % 1
      const angle = index * 2.399 + elapsed * 0.7
      const radialM = age * (0.45 + (index % 4) * 0.12)
      array[offset] = Math.cos(angle) * radialM * LOCAL_METRES_TO_RENDER_UNITS
      array[offset + 1] =
        (age * 0.72 - age * age * 0.62) * LOCAL_METRES_TO_RENDER_UNITS
      array[offset + 2] = Math.sin(angle) * radialM * LOCAL_METRES_TO_RENDER_UNITS
    }

    positions.needsUpdate = true
    if (!isSimulationTimePaused()) {
      state.invalidate()
    }
  })

  return (
    <group
      ref={groupRef}
      visible={outpost.robot.state === 'mining'}
    >
      <points geometry={geometry} material={material} />
      <mesh
        position-y={0.000012}
        rotation-x={-Math.PI / 2}
        scale={0.0003}
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
  const drillArmRef = useRef<Group>(null)
  const drillBitRef = useRef<Mesh>(null)
  const statusMaterialRef = useRef<MeshStandardMaterial>(null)
  const cargoRef = useRef<Group>(null)
  const wheelDummyRef = useRef(new Object3D())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const wheelGeometry = useMemo(() => new CylinderGeometry(0.22, 0.22, 0.16, 10), [])
  const treadGeometry = useMemo(() => new BoxGeometry(0.22, 0.34, 1.42), [])
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

  useLayoutEffect(() => {
    const treadMesh = treadRef.current

    if (treadMesh === null) {
      return
    }

    const dummy = new Object3D()

    for (let index = 0; index < 2; index += 1) {
      dummy.position.set(index === 0 ? -0.66 : 0.66, -0.12, 0)
      dummy.updateMatrix()
      treadMesh.setMatrixAt(index, dummy.matrix)
    }

    treadMesh.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      wheelGeometry.dispose()
      treadGeometry.dispose()
      wheelMaterial.dispose()
      treadMaterial.dispose()
    },
    [treadGeometry, treadMaterial, wheelGeometry, wheelMaterial],
  )

  useFrame((state) => {
    const robot = robotRef.current
    const chassis = chassisRef.current
    const wheels = wheelRef.current
    const drillArm = drillArmRef.current
    const drillBit = drillBitRef.current

    if (
      robot === null ||
      chassis === null ||
      wheels === null ||
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

    robot.position.set(
      ground.x,
      ground.y + kinematics.clearanceM * LOCAL_METRES_TO_RENDER_UNITS,
      ground.z,
    )
    robot.rotation.y = kinematics.headingRad
    chassis.position.y = movingPulse * 0.035
    chassis.rotation.z = movingPulse * 0.018

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

    if (
      outpost.robot.state === 'deploying' ||
      outpost.robot.state === 'traveling' ||
      outpost.robot.state === 'mining' ||
      outpost.robot.state === 'returning' ||
      outpost.robot.state === 'unloading'
    ) {
      if (!isSimulationTimePaused()) {
        state.invalidate()
      }
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
          <mesh castShadow position-y={0.22} receiveShadow>
            <boxGeometry args={[1.16, 0.52, 1.3]} />
            <meshStandardMaterial
              color="#505861"
              emissive="#10151a"
              emissiveIntensity={0.35}
              metalness={0.7}
              roughness={0.34}
            />
          </mesh>
          <mesh castShadow position={[0, 0.61, -0.1]} receiveShadow>
            <boxGeometry args={[0.78, 0.42, 0.68]} />
            <meshStandardMaterial
              color="#414850"
              emissive="#0e1318"
              emissiveIntensity={0.28}
              metalness={0.72}
              roughness={0.3}
            />
          </mesh>
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
            <mesh castShadow position-z={0.34}>
              <boxGeometry args={[0.22, 0.2, 0.74]} />
              <meshStandardMaterial
                color="#4b5157"
                metalness={0.72}
                roughness={0.3}
              />
            </mesh>
            <mesh
              ref={drillBitRef}
              position-z={0.86}
              rotation-x={Math.PI / 2}
            >
              <coneGeometry args={[0.17, 0.55, 8, 2]} />
              <meshStandardMaterial
                color="#b4a38f"
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
          <mesh position={[0, 0.98, -0.17]}>
            <cylinderGeometry args={[0.035, 0.045, 0.5, 7]} />
            <meshStandardMaterial
              color="#5e6267"
              metalness={0.82}
              roughness={0.25}
            />
          </mesh>
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
