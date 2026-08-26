import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { EXTRACTOR_CONSTRUCTION_DURATION_MS } from '../simulation/outpostSimulation.ts'
import {
  isSimulationTimePaused,
  simulationNowMs,
} from '../simulation/simulationTime.ts'

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
  const legRef = useRef<InstancedMesh>(null)
  const operationMaterialRef = useRef<MeshStandardMaterial>(null)
  const invalidate = useThree((state) => state.invalidate)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const legGeometry = useMemo(() => new BoxGeometry(0.32, 0.22, 0.62), [])
  const legMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#30353a',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )

  useLayoutEffect(() => {
    const legs = legRef.current

    if (legs === null) {
      return
    }

    const dummy = new Object3D()

    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2) + Math.PI / 4
      dummy.position.set(Math.sin(angle) * 1.08, 0.03, Math.cos(angle) * 1.08)
      dummy.rotation.y = angle
      dummy.updateMatrix()
      legs.setMatrixAt(index, dummy.matrix)
    }

    legs.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(() => {
    if (extractor?.status !== 'active') {
      return
    }

    const timer = window.setInterval(() => {
      if (!isSimulationTimePaused()) {
        invalidate()
      }
    }, 90)
    return () => window.clearInterval(timer)
  }, [extractor?.status, invalidate])

  useEffect(
    () => () => {
      legGeometry.dispose()
      legMaterial.dispose()
    },
    [legGeometry, legMaterial],
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

    if (extractor.status === 'active') {
      const elapsed = state.clock.elapsedTime
      drumRef.current.rotation.x = elapsed * 2.8
      pumpRef.current.rotation.z = -0.28 + Math.sin(elapsed * 3.4) * 0.36

      if (operationMaterialRef.current !== null) {
        operationMaterialRef.current.emissiveIntensity =
          1.65 + Math.sin(elapsed * 4.2) * 0.38
      }
    } else {
      if (!isSimulationTimePaused()) {
        state.invalidate()
      }
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
        <group ref={baseRef}>
          <instancedMesh
            ref={legRef}
            args={[legGeometry, legMaterial, 4]}
            castShadow
            receiveShadow
          />
          <mesh castShadow position-y={0.24} receiveShadow>
            <cylinderGeometry args={[1.05, 1.2, 0.46, 12]} />
            <meshStandardMaterial
              color="#252a30"
              metalness={0.76}
              roughness={0.34}
            />
          </mesh>
        </group>
        <group ref={towerRef}>
          <mesh position-y={1.15} receiveShadow>
            <cylinderGeometry args={[0.32, 0.48, 1.85, 10]} />
            <meshStandardMaterial
              color="#42484e"
              metalness={0.72}
              roughness={0.32}
            />
          </mesh>
          <mesh position-y={0.7} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.54, 0.075, 7, 22]} />
            <meshStandardMaterial
              ref={operationMaterialRef}
              color="#812d15"
              emissive="#ff5d24"
              emissiveIntensity={1.65}
              metalness={0.5}
              roughness={0.3}
            />
          </mesh>
        </group>
        <group ref={machineryRef}>
          <mesh
            ref={drumRef}
            position={[0, 1.92, 0]}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.48, 0.48, 1.02, 12]} />
            <meshStandardMaterial
              color="#31363c"
              metalness={0.82}
              roughness={0.25}
            />
          </mesh>
          <group ref={pumpRef} position={[0.74, 1.38, 0]}>
            <mesh position-y={0.5}>
              <boxGeometry args={[0.16, 1.05, 0.18]} />
              <meshStandardMaterial
                color="#6a2b18"
                metalness={0.64}
                roughness={0.33}
              />
            </mesh>
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
