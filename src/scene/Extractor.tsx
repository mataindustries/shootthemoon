import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
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
import {
  LOCAL_METRES_TO_RENDER_UNITS,
} from '../render/localSurface.ts'
import { maximumRenderedSurfaceHeight, sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { EXTRACTOR_CONSTRUCTION_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import {
  COUNTERSTRIKE_TIMING,
  getCounterstrikeRunProgress,
  type CounterstrikeRunState,
} from '../simulation/counterstrikeSimulation.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

interface ExtractorProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly signalInterrupted?: boolean
  readonly damaged?: boolean
  readonly compact?: boolean
  readonly damageSequence?: CounterstrikeRunState | undefined
}

const EXTRACTOR_PAD_RADIUS_M = 1.08
const EXTRACTOR_PAD_HALF_X_M = 0.22
const EXTRACTOR_PAD_HALF_Z_M = 0.35
const EXTRACTOR_PAD_CENTER_Y_M = 0.04
const EXTRACTOR_PAD_HALF_HEIGHT_M = 0.08
const EXTRACTOR_PAD_BOTTOM_Y_M =
  EXTRACTOR_PAD_CENTER_Y_M - EXTRACTOR_PAD_HALF_HEIGHT_M
const EXTRACTOR_PAD_EMBED_M = 0.008

export interface ExtractorGrounding {
  readonly position: Readonly<{ x: number; y: number; z: number }>
  readonly padOffsetsModel: readonly number[]
  readonly padSurfaceHeights: readonly number[]
}

function rotateSurfacePoint(
  xM: number,
  zM: number,
  rotationRad: number,
): Readonly<{ xM: number; zM: number }> {
  const cosine = Math.cos(rotationRad)
  const sine = Math.sin(rotationRad)

  return {
    xM: xM * cosine + zM * sine,
    zM: -xM * sine + zM * cosine,
  }
}

function extractorPadFootprint(
  centerXM: number,
  centerZM: number,
  orientationRad: number,
  padIndex: number,
) {
  const padAngle = padIndex * (Math.PI / 2) + Math.PI / 4
  const padCenterX = Math.sin(padAngle) * EXTRACTOR_PAD_RADIUS_M
  const padCenterZ = Math.cos(padAngle) * EXTRACTOR_PAD_RADIUS_M
  const points: { xM: number; zM: number }[] = []

  for (const xDirection of [-1, 0, 1]) {
    for (const zDirection of [-1, 0, 1]) {
      const cornerOffset = rotateSurfacePoint(
        xDirection * EXTRACTOR_PAD_HALF_X_M,
        zDirection * EXTRACTOR_PAD_HALF_Z_M,
        padAngle,
      )
      const worldPoint = rotateSurfacePoint(
        padCenterX + cornerOffset.xM,
        padCenterZ + cornerOffset.zM,
        orientationRad,
      )
      points.push({
        xM: centerXM + worldPoint.xM,
        zM: centerZM + worldPoint.zM,
      })
    }
  }

  return points
}

/** Positions all four independently telescoping pads on the rendered mesh. */
export function calculateExtractorGrounding(
  terrain: SurfaceTerrainProfile,
  segments: number,
  centerXM: number,
  centerZM: number,
  orientationRad: number,
): ExtractorGrounding {
  const padSurfaceHeights = Array.from({ length: 4 }, (_, padIndex) =>
    maximumRenderedSurfaceHeight(
      terrain,
      segments,
      extractorPadFootprint(
        centerXM,
        centerZM,
        orientationRad,
        padIndex,
      ),
    ),
  )
  const maximumPadSurface = Math.max(...padSurfaceHeights)
  const rootY =
    maximumPadSurface -
    EXTRACTOR_PAD_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS -
    EXTRACTOR_PAD_BOTTOM_Y_M * LOCAL_METRES_TO_RENDER_UNITS
  const center = sampleRenderedSurface(
    terrain,
    segments,
    centerXM,
    centerZM,
  )

  return {
    position: { x: center.x, y: rootY, z: center.z },
    padOffsetsModel: padSurfaceHeights.map(
      (height) =>
        (height - maximumPadSurface) / LOCAL_METRES_TO_RENDER_UNITS,
    ),
    padSurfaceHeights,
  }
}

export function Extractor({
  outpost,
  terrain,
  segments,
  signalInterrupted = false,
  damaged = false,
  compact = false,
  damageSequence,
}: ExtractorProps) {
  const extractor = outpost.extractor
  const rootRef = useRef<Group>(null)
  const baseRef = useRef<Group>(null)
  const towerRef = useRef<Group>(null)
  const machineryRef = useRef<Group>(null)
  const drumRef = useRef<Mesh>(null)
  const pumpRef = useRef<Group>(null)
  const supportRef = useRef<InstancedMesh>(null)
  const serviceRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const drumAccentRef = useRef<InstancedMesh>(null)
  const pumpPartsRef = useRef<InstancedMesh>(null)
  const constructionDustRef = useRef<Group>(null)
  const damagedPartsRef = useRef<InstancedMesh>(null)
  const damageDetailsRef = useRef<Group>(null)
  const damageSparksRef = useRef<Group>(null)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const grounding = useMemo(
    () =>
      extractor === null
        ? null
        : calculateExtractorGrounding(
            terrain,
            segments,
            extractor.position.xM,
            extractor.position.zM,
            extractor.orientationRad,
          ),
    [extractor, segments, terrain],
  )
  const boxGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const serviceGeometry = useMemo(
    () => new CylinderGeometry(0.5, 0.5, 1, 10),
    [],
  )
  const armorMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        emissive: compact && damaged ? VISUAL_PALETTE.damageEmber : '#000000',
        emissiveIntensity: compact && damaged ? 0.045 : 0,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [compact, damaged],
  )
  const steelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        emissive: compact && damaged ? VISUAL_PALETTE.damageHeat : '#000000',
        emissiveIntensity: compact && damaged ? 0.035 : 0,
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [compact, damaged],
  )
  const heatMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHeatDark,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const operationMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.panel,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const damagedPartsMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHeatDark,
        emissive: VISUAL_PALETTE.damageEmber,
        emissiveIntensity: 0.08,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const damageSparkGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(10 * 3)
    for (let index = 0; index < 10; index += 1) {
      const angle = index * 2.399963229728653
      positions[index * 3] = Math.cos(angle) * (0.12 + (index % 3) * 0.08)
      positions[index * 3 + 1] = (index % 5) * 0.12
      positions[index * 3 + 2] = Math.sin(angle) * (0.12 + (index % 4) * 0.06)
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    return geometry
  }, [])
  const damageSparkMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.playerHotMetal,
        depthWrite: false,
        opacity: 0.72,
        size: 0.00008,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
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
        color: VISUAL_PALETTE.playerHotMetal,
        depthWrite: false,
        opacity: 0.3,
        size: 0.000066,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const supports = supportRef.current
    const services = serviceRef.current
    const lights = lightRef.current
    const drumAccents = drumAccentRef.current
    const pumpParts = pumpPartsRef.current

    if (
      supports === null ||
      services === null ||
      lights === null ||
      drumAccents === null ||
      pumpParts === null
    ) {
      return
    }

    const dummy = new Object3D()
    let supportIndex = 0

    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2) + Math.PI / 4
      const padOffsetModel = grounding?.padOffsetsModel[index] ?? 0

      dummy.position.set(
        Math.sin(angle) * EXTRACTOR_PAD_RADIUS_M,
        EXTRACTOR_PAD_CENTER_Y_M + padOffsetModel,
        Math.cos(angle) * EXTRACTOR_PAD_RADIUS_M,
      )
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(0.44, 0.16, 0.7)
      dummy.updateMatrix()
      supports.setMatrixAt(supportIndex, dummy.matrix)
      supportIndex += 1

      dummy.position.set(
        Math.sin(angle) * 0.78,
        0.52 + padOffsetModel / 2,
        Math.cos(angle) * 0.78,
      )
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(0.16, 0.86 - padOffsetModel, 0.18)
      dummy.updateMatrix()
      supports.setMatrixAt(supportIndex, dummy.matrix)
      supportIndex += 1

      dummy.position.set(
        Math.sin(angle) * 0.5,
        0.72 + padOffsetModel * 0.35,
        Math.cos(angle) * 0.5,
      )
      dummy.rotation.set(0, angle, index % 2 === 0 ? 0.54 : -0.54)
      dummy.scale.set(0.11, 1.05, 0.12)
      dummy.updateMatrix()
      supports.setMatrixAt(supportIndex, dummy.matrix)
      supportIndex += 1
    }

    const fixedSupports = [
      { position: [0, 0.45, 0.92] as const, scale: [0.52, 0.2, 0.72] as const },
      { position: [0, 0.8, 0.66] as const, scale: [0.32, 0.48, 0.42] as const },
      { position: [-0.58, 0.38, -0.5] as const, scale: [0.54, 0.12, 0.48] as const },
      { position: [0.58, 0.38, -0.5] as const, scale: [0.54, 0.12, 0.48] as const },
      { position: [0, 1.5, 0] as const, scale: [1.62, 0.15, 0.18] as const },
    ]

    for (const definition of fixedSupports) {
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
      supports.setMatrixAt(supportIndex, dummy.matrix)
      supportIndex += 1
    }
    supports.instanceMatrix.needsUpdate = true

    const serviceParts = [
      { position: [-0.65, 0.88, -0.53] as const, rotation: [0, 0, 0] as const, scale: [0.52, 1.05, 0.52] as const },
      { position: [0.65, 0.88, -0.53] as const, rotation: [0, 0, 0] as const, scale: [0.52, 1.05, 0.52] as const },
      { position: [-0.79, 0.78, 0.22] as const, rotation: [0, 0, 0] as const, scale: [0.13, 1.18, 0.13] as const },
      { position: [0.79, 0.78, 0.22] as const, rotation: [0, 0, 0] as const, scale: [0.13, 1.18, 0.13] as const },
      { position: [0, 1.25, 0.22] as const, rotation: [0, 0, Math.PI / 2] as const, scale: [0.13, 1.62, 0.13] as const },
      { position: [-0.43, 1.15, -0.16] as const, rotation: [Math.PI / 2, 0, 0] as const, scale: [0.1, 0.72, 0.1] as const },
      { position: [0.43, 1.15, -0.16] as const, rotation: [Math.PI / 2, 0, 0] as const, scale: [0.1, 0.72, 0.1] as const },
    ]

    serviceParts.forEach((definition, index) => {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(
        definition.rotation[0],
        definition.rotation[1],
        definition.rotation[2],
      )
      dummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      dummy.updateMatrix()
      services.setMatrixAt(index, dummy.matrix)
    })
    services.instanceMatrix.needsUpdate = true

    const lightParts = [
      { position: [-0.47, 0.29, 0.92] as const, rotationY: 0 },
      { position: [0.47, 0.29, 0.92] as const, rotationY: 0 },
      { position: [-0.94, 0.3, 0] as const, rotationY: Math.PI / 2 },
      { position: [0.94, 0.3, 0] as const, rotationY: Math.PI / 2 },
      { position: [0, 1.38, 0.25] as const, rotationY: 0 },
      { position: [0, 1.38, -0.25] as const, rotationY: 0 },
    ]

    lightParts.forEach((definition, index) => {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(0, definition.rotationY, 0)
      dummy.scale.set(0.22, 0.08, 0.035)
      dummy.updateMatrix()
      lights.setMatrixAt(index, dummy.matrix)
    })
    lights.instanceMatrix.needsUpdate = true

    for (let index = 0; index < 2; index += 1) {
      dummy.position.set(0, 0, index === 0 ? -0.47 : 0.47)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(0.13, 1.04, 0.06)
      dummy.updateMatrix()
      drumAccents.setMatrixAt(index, dummy.matrix)
    }
    drumAccents.instanceMatrix.needsUpdate = true

    const pumpDefinitions = [
      { position: [0, 0.3, 0] as const, rotationZ: 0, scale: [1.5, 0.16, 0.2] as const },
      { position: [-0.64, 0.08, 0] as const, rotationZ: 0, scale: [0.34, 0.48, 0.3] as const },
      { position: [0.62, -0.26, 0] as const, rotationZ: -0.12, scale: [0.14, 0.92, 0.14] as const },
    ]

    pumpDefinitions.forEach((definition, index) => {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(0, 0, definition.rotationZ)
      dummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      dummy.updateMatrix()
      pumpParts.setMatrixAt(index, dummy.matrix)
    })
    pumpParts.instanceMatrix.needsUpdate = true
  }, [grounding])

  useLayoutEffect(() => {
    const damagedParts = damagedPartsRef.current
    if (damagedParts === null) return

    const dummy = new Object3D()
    const definitions = [
      {
        position: [0.72, 1.82, 0.08] as const,
        rotation: [0.42, 0.3, -0.78] as const,
        scale: [0.18, 1.3, 0.16] as const,
      },
      {
        position: [-0.62, 0.32, 0.62] as const,
        rotation: [0.22, -0.5, 0.34] as const,
        scale: [0.52, 0.12, 0.28] as const,
      },
      {
        position: [0.18, 2.18, -0.12] as const,
        rotation: [-0.2, 0.52, 1.08] as const,
        scale: [0.14, 0.82, 0.13] as const,
      },
      {
        position: [-0.76, 1.22, -0.18] as const,
        rotation: [0.7, -0.24, -0.46] as const,
        scale: [0.12, 0.7, 0.11] as const,
      },
      {
        position: [0.58, 0.52, -0.54] as const,
        rotation: [0.3, 0.8, 0.52] as const,
        scale: [0.46, 0.11, 0.2] as const,
      },
    ]

    definitions.forEach((definition, index) => {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(
        definition.rotation[0],
        definition.rotation[1],
        definition.rotation[2],
      )
      dummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      dummy.updateMatrix()
      damagedParts.setMatrixAt(index, dummy.matrix)
    })
    damagedParts.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      boxGeometry.dispose()
      serviceGeometry.dispose()
      armorMaterial.dispose()
      steelMaterial.dispose()
      heatMaterial.dispose()
      operationMaterial.dispose()
      damagedPartsMaterial.dispose()
      constructionDustGeometry.dispose()
      constructionDustMaterial.dispose()
      damageSparkGeometry.dispose()
      damageSparkMaterial.dispose()
    },
    [
      armorMaterial,
      boxGeometry,
      constructionDustGeometry,
      constructionDustMaterial,
      damageSparkGeometry,
      damageSparkMaterial,
      damagedPartsMaterial,
      heatMaterial,
      operationMaterial,
      serviceGeometry,
      steelMaterial,
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
    const counterstrikeProgress =
      damageSequence?.status === 'impact'
        ? getCounterstrikeRunProgress(damageSequence, performance.now())
        : 1
    const impactContactProgress =
      COUNTERSTRIKE_TIMING.impactContactMs / COUNTERSTRIKE_TIMING.impactMs
    const damageVisible =
      damaged &&
      (damageSequence?.status !== 'impact' ||
        counterstrikeProgress >= impactContactProgress)
    const damageImpactProgress = Math.max(
      0,
      Math.min(
        1,
        (counterstrikeProgress - impactContactProgress) / 0.34,
      ),
    )
    baseRef.current.scale.set(1, baseProgress, 1)
    towerRef.current.scale.set(1, towerProgress, 1)
    machineryRef.current.scale.setScalar(machineryProgress)
    towerRef.current.rotation.z = damageVisible ? 0.27 : 0
    machineryRef.current.rotation.z = damageVisible ? -0.34 : 0
    machineryRef.current.position.x = damageVisible ? 0.28 : 0
    armorMaterial.emissiveIntensity = damageVisible ? 0.085 : 0
    steelMaterial.emissiveIntensity = damageVisible ? 0.065 : 0
    if (damagedPartsRef.current !== null) {
      damagedPartsRef.current.visible = damageVisible
    }
    if (damageDetailsRef.current !== null) {
      damageDetailsRef.current.visible = damageVisible
    }
    if (damageSparksRef.current !== null) {
      const sparkWindow =
        damageSequence?.status === 'impact' &&
        damageImpactProgress > 0.04 &&
        damageImpactProgress < 0.72
      damageSparksRef.current.visible =
        sparkWindow &&
        (Math.sin(state.clock.elapsedTime * 41) > 0.12 ||
          Math.sin(state.clock.elapsedTime * 17.7) < -0.72)
      damageSparksRef.current.position.y =
        1.36 - damageImpactProgress * 0.42
      damageSparksRef.current.rotation.y = state.clock.elapsedTime * 4.2
      damageSparkMaterial.opacity = Math.max(
        0,
        0.82 - damageImpactProgress * 0.78,
      )
    }

    if (constructionDustRef.current !== null) {
      constructionDustRef.current.rotation.y = constructionProgress * 1.8
      constructionDustRef.current.scale.setScalar(
        0.82 + Math.sin(constructionProgress * Math.PI) * 0.24,
      )
    }

    if (extractor.status === 'active') {
      const elapsed = state.clock.elapsedTime
      drumRef.current.rotation.x = damageVisible ? 0.58 : elapsed * 2.8
      pumpRef.current.rotation.z = damageVisible
        ? -0.74
        : -0.16 + Math.sin(elapsed * 3.4) * 0.22

      const interruptionGate =
        Math.sin(elapsed * 27) > 0.2 || Math.sin(elapsed * 11.4) < -0.72
      operationMaterial.emissiveIntensity = damageVisible
        ? damageSequence?.status === 'impact'
          ? damageImpactProgress < 0.16
            ? 0
            : Math.sin(elapsed * 7.4) > 0.46
              ? 0.28
              : 0.028
          : 0.08
        : signalInterrupted
        ? interruptionGate
          ? 0.05
          : 0.34
        : Math.min(
            EMISSIVE_LIMITS.activePanel,
            EMISSIVE_LIMITS.panel + Math.sin(elapsed * 3.6) * 0.055,
          )
    }
  })

  if (extractor === null || grounding === null) {
    return null
  }

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group
        ref={rootRef}
        name="lunar-ore-extractor"
        position={[
          grounding.position.x,
          grounding.position.y,
          grounding.position.z,
        ]}
        rotation-y={extractor.orientationRad}
        scale={LOCAL_METRES_TO_RENDER_UNITS}
      >
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
            ref={supportRef}
            args={[boxGeometry, armorMaterial, 17]}
            castShadow
            receiveShadow
          />
          <mesh castShadow position-y={0.26} receiveShadow material={armorMaterial}>
            <cylinderGeometry args={[1.03, 1.2, 0.5, 12]} />
          </mesh>
        </group>

        <group ref={towerRef}>
          <mesh castShadow position-y={1.08} receiveShadow material={heatMaterial}>
            <cylinderGeometry args={[0.34, 0.5, 1.7, 10]} />
          </mesh>
          <instancedMesh
            ref={serviceRef}
            args={[serviceGeometry, steelMaterial, 7]}
            castShadow
            receiveShadow
          />
          <instancedMesh
            ref={lightRef}
            args={[boxGeometry, operationMaterial, 6]}
          />
          <mesh
            castShadow
            position={[0, 0.86, 1.02]}
            material={steelMaterial}
            visible={!compact}
          >
            <cylinderGeometry args={[0.55, 0.24, 0.7, 6, 1, true]} />
          </mesh>
        </group>

        <group ref={machineryRef}>
          <mesh
            ref={drumRef}
            castShadow
            position={[0, 1.88, 0]}
            rotation-z={Math.PI / 2}
            material={steelMaterial}
          >
            <cylinderGeometry args={[0.46, 0.46, 1.08, 12]} />
            <instancedMesh
              ref={drumAccentRef}
              args={[boxGeometry, operationMaterial, 2]}
              visible={!compact}
            />
          </mesh>
          <group ref={pumpRef} position={[0, 1.38, 0]} visible={!compact}>
            <instancedMesh
              ref={pumpPartsRef}
              args={[boxGeometry, steelMaterial, 3]}
              castShadow
            />
          </group>
          <mesh
            castShadow
            position-y={-0.2}
            rotation-x={Math.PI}
            material={heatMaterial}
            visible={!compact}
          >
            <coneGeometry args={[0.24, 1.12, 8, 2]} />
          </mesh>
          {damaged ? (
            <group
              ref={damageDetailsRef}
              visible={damageSequence?.status !== 'impact'}
              name="damaged-extractor-silhouette"
            >
              <instancedMesh
                ref={damagedPartsRef}
                args={[boxGeometry, damagedPartsMaterial, 5]}
                castShadow={!compact}
              />
              <group
                ref={damageSparksRef}
                position={[0.28, 1.36, 0.12]}
                visible={false}
              >
                <points
                  geometry={damageSparkGeometry}
                  material={damageSparkMaterial}
                />
              </group>
            </group>
          ) : null}
        </group>
      </group>
    </group>
  )
}
