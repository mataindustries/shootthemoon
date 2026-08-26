import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointsMaterial,
  TorusGeometry,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { EXTRACTOR_CONSTRUCTION_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'

interface ExtractorProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
}

export function Extractor({ outpost, terrain }: ExtractorProps) {
  const extractor = outpost.extractor
  const rootRef = useRef<Group>(null)
  const baseRef = useRef<Group>(null)
  const towerRef = useRef<Group>(null)
  const machineryRef = useRef<Group>(null)
  const drumRef = useRef<Mesh>(null)
  const pumpRef = useRef<Group>(null)
  const pumpPartsRef = useRef<InstancedMesh>(null)
  const legRef = useRef<InstancedMesh>(null)
  const constructionDustRef = useRef<Group>(null)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const legGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const operationRingGeometry = useMemo(
    () => new TorusGeometry(1, 0.13, 7, 22),
    [],
  )
  const legMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#4c555f',
        emissive: '#161d25',
        emissiveIntensity: 0.28,
        metalness: 0.7,
        roughness: 0.46,
      }),
    [],
  )
  const operationMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#812d15',
        emissive: '#ff5d24',
        emissiveIntensity: 1.65,
        metalness: 0.5,
        roughness: 0.3,
      }),
    [],
  )
  const constructionDustGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(30 * 3)

    for (let index = 0; index < 30; index += 1) {
      const offset = index * 3
      const angle = index * 2.399
      const radius = 1.05 + (index % 7) * 0.14
      positions[offset] = Math.cos(angle) * radius
      positions[offset + 1] = 0.04 + (index % 5) * 0.045
      positions[offset + 2] = Math.sin(angle) * radius
    }

    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    return geometry
  }, [])
  const constructionDustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: '#d09a72',
        depthWrite: false,
        opacity: 0.34,
        size: 0.00007,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const legs = legRef.current
    const pumpParts = pumpPartsRef.current

    if (legs === null || pumpParts === null) {
      return
    }

    const dummy = new Object3D()

    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2) + Math.PI / 4
      dummy.position.set(Math.sin(angle) * 1.08, 0.03, Math.cos(angle) * 1.08)
      dummy.rotation.y = angle
      dummy.scale.set(0.36, 0.2, 0.68)
      dummy.updateMatrix()
      legs.setMatrixAt(index, dummy.matrix)

      dummy.position.set(Math.sin(angle) * 0.72, 0.58, Math.cos(angle) * 0.72)
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(0.16, 0.92, 0.18)
      dummy.updateMatrix()
      legs.setMatrixAt(index + 4, dummy.matrix)
    }

    legs.instanceMatrix.needsUpdate = true

    dummy.position.set(0.72, 0.46, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(0.18, 1.25, 0.2)
    dummy.updateMatrix()
    pumpParts.setMatrixAt(0, dummy.matrix)

    dummy.position.set(0, 1.08, 0)
    dummy.scale.set(1.72, 0.18, 0.24)
    dummy.updateMatrix()
    pumpParts.setMatrixAt(1, dummy.matrix)
    pumpParts.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      legGeometry.dispose()
      legMaterial.dispose()
      operationRingGeometry.dispose()
      operationMaterial.dispose()
      constructionDustGeometry.dispose()
      constructionDustMaterial.dispose()
    },
    [
      constructionDustGeometry,
      constructionDustMaterial,
      legGeometry,
      legMaterial,
      operationMaterial,
      operationRingGeometry,
    ],
  )

  useFrame((state) => {
    if (
      extractor === null ||
      rootRef.current === null ||
      baseRef.current === null ||
      towerRef.current === null ||
      machineryRef.current === null ||
      drumRef.current === null ||
      pumpRef.current === null
    ) {
      return
    }

    const nowMs = simulationNowMs()
    const constructionProgress =
      extractor.status === 'active'
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (nowMs - extractor.constructionStartedAtMs) /
                EXTRACTOR_CONSTRUCTION_DURATION_MS,
            ),
          )
    const baseProgress = Math.min(1, constructionProgress / 0.34)
    const towerProgress = Math.max(
      0,
      Math.min(1, (constructionProgress - 0.2) / 0.48),
    )
    const machineryProgress = Math.max(
      0,
      Math.min(1, (constructionProgress - 0.57) / 0.43),
    )
    baseRef.current.scale.set(1, baseProgress, 1)
    towerRef.current.scale.set(1, towerProgress, 1)
    machineryRef.current.scale.setScalar(machineryProgress)

    if (constructionDustRef.current !== null) {
      constructionDustRef.current.rotation.y = constructionProgress * 1.8
      constructionDustRef.current.scale.setScalar(
        0.82 + Math.sin(constructionProgress * Math.PI) * 0.24,
      )
    }

    if (extractor.status === 'active') {
      const elapsed = state.clock.elapsedTime
      drumRef.current.rotation.x = elapsed * 2.8
      pumpRef.current.rotation.z = -0.28 + Math.sin(elapsed * 3.4) * 0.36

      operationMaterial.emissiveIntensity =
        1.65 + Math.sin(elapsed * 4.2) * 0.38
    }
  })

  if (extractor === null) {
    return null
  }

  const ground = localSurfaceToRender(
    terrain,
    extractor.position.xM,
    extractor.position.zM,
  )

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group
        ref={rootRef}
        name="lunar-ore-extractor"
        position={[ground.x, ground.y, ground.z]}
        rotation-y={extractor.orientationRad}
        scale={LOCAL_METRES_TO_RENDER_UNITS}
      >
        <mesh position-y={0.025} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.25, 1.42, 18]} />
          <meshBasicMaterial
            color="#bd5124"
            depthWrite={false}
            opacity={0.4}
            transparent
          />
        </mesh>
        <group
          ref={constructionDustRef}
          visible={extractor.status === 'constructing'}
        >
          <points
            geometry={constructionDustGeometry}
            material={constructionDustMaterial}
          />
        </group>
        <group ref={baseRef}>
          <instancedMesh
            ref={legRef}
            args={[legGeometry, legMaterial, 8]}
            castShadow
            receiveShadow
          />
          <mesh castShadow position-y={0.24} receiveShadow>
            <cylinderGeometry args={[1.05, 1.2, 0.46, 12]} />
            <meshStandardMaterial
              color="#46505a"
              emissive="#141b22"
              emissiveIntensity={0.32}
              metalness={0.7}
              roughness={0.42}
            />
          </mesh>
        </group>
        <group ref={towerRef}>
          <mesh position-y={1.15} receiveShadow>
            <cylinderGeometry args={[0.32, 0.48, 1.85, 10]} />
            <meshStandardMaterial
              color="#65717d"
              emissive="#18212a"
              emissiveIntensity={0.32}
              metalness={0.66}
              roughness={0.38}
            />
          </mesh>
          <mesh
            geometry={operationRingGeometry}
            material={operationMaterial}
            position-y={0.7}
            rotation-x={Math.PI / 2}
            scale={0.54}
          />
          <mesh
            geometry={operationRingGeometry}
            material={operationMaterial}
            position-y={1.42}
            rotation-x={Math.PI / 2}
            scale={0.44}
          />
        </group>
        <group ref={machineryRef}>
          <mesh
            ref={drumRef}
            position={[0, 1.92, 0]}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.48, 0.48, 1.02, 12]} />
            <meshStandardMaterial
              color="#59646f"
              emissive="#35414d"
              emissiveIntensity={0.58}
              metalness={0.74}
              roughness={0.31}
            />
            <mesh
              geometry={legGeometry}
              material={operationMaterial}
              position-z={0.47}
              scale={[0.14, 1.04, 0.07]}
            />
          </mesh>
          <group ref={pumpRef} position={[0, 1.38, 0]}>
            <instancedMesh
              ref={pumpPartsRef}
              args={[legGeometry, operationMaterial, 2]}
            />
          </group>
          <mesh castShadow position-y={-0.22} rotation-x={Math.PI}>
            <coneGeometry args={[0.22, 1.08, 8, 2]} />
            <meshStandardMaterial
              color="#a89a89"
              metalness={0.85}
              roughness={0.22}
            />
          </mesh>
        </group>
      </group>
    </group>
  )
}
