import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  firstStrikeShowsWarhead,
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import { createStrikeRoute } from '../camera/strikeRoute.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

interface StrikeWarheadProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly presentation: FirstStrikePresentationState
}

const MODEL_UP = new Vector3(0, 1, 0)
const FIN_COUNT = 4
const PANEL_COUNT = 4
const EXHAUST_SPARK_COUNT = 16

function smootherstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped ** 3 * (clamped * (clamped * 6 - 15) + 10)
}

function smoothRange(value: number, start: number, end: number): number {
  return smootherstep((value - start) / (end - start))
}

function routeProgressForPresentation(
  presentation: FirstStrikePresentationState,
  progress: number,
): number | null {
  switch (presentation.phase) {
    case 'orbital-flight':
      return 0.08 + progress * 0.48
    case 'vesper-transmission':
      return 0.56 + progress * 0.2
    case 'target-approach':
      return 0.76 + progress * 0.24
    default:
      return null
  }
}

function createExhaustSparkGeometry(): BufferGeometry {
  const positions = new Float32Array(EXHAUST_SPARK_COUNT * 3)

  for (let index = 0; index < EXHAUST_SPARK_COUNT; index += 1) {
    const angle = index * 2.399963229728653
    const radius = 0.08 + (index % 5) * 0.055
    const offset = index * 3
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = -0.7 - (index % 8) * 0.43
    positions[offset + 2] = Math.sin(angle) * radius
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function StrikeWarhead({
  playerSite,
  rivalSite,
  presentation,
}: StrikeWarheadProps) {
  const warheadRef = useRef<Group>(null)
  const modelRef = useRef<Group>(null)
  const flameRef = useRef<Group>(null)
  const sparkRef = useRef<Points>(null)
  const finsRef = useRef<InstancedMesh>(null)
  const panelsRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const route = useMemo(
    () => createStrikeRoute(playerSite, rivalSite),
    [playerSite, rivalSite],
  )
  const playerTransform = useMemo(
    () => landingSiteToRenderTransform(playerSite),
    [playerSite],
  )
  const temporaryPosition = useRef(new Vector3())
  const previousPosition = useRef(new Vector3())
  const nextPosition = useRef(new Vector3())
  const direction = useRef(new Vector3())
  const orientation = useRef(new Quaternion())
  const bodyGeometry = useMemo(
    () => new CylinderGeometry(0.74, 0.9, 6.25, 12),
    [],
  )
  const shoulderGeometry = useMemo(
    () => new CylinderGeometry(0.58, 0.76, 1.15, 12),
    [],
  )
  const noseGeometry = useMemo(() => new ConeGeometry(0.6, 2.65, 12), [])
  const bandGeometry = useMemo(
    () => new CylinderGeometry(0.88, 0.88, 0.48, 12),
    [],
  )
  const bellGeometry = useMemo(
    () => new CylinderGeometry(0.98, 0.58, 1.22, 12, 1, true),
    [],
  )
  const coreGeometry = useMemo(
    () => new CylinderGeometry(0.38, 0.46, 0.3, 12),
    [],
  )
  const finGeometry = useMemo(() => new BoxGeometry(0.18, 2.1, 1.62), [])
  const panelGeometry = useMemo(() => new BoxGeometry(0.09, 1.42, 0.42), [])
  const innerFlameGeometry = useMemo(
    () => new ConeGeometry(0.38, 3.7, 10),
    [],
  )
  const outerFlameGeometry = useMemo(
    () => new ConeGeometry(0.76, 4.35, 10),
    [],
  )
  const sparkGeometry = useMemo(createExhaustSparkGeometry, [])
  const armorMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [],
  )
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [],
  )
  const heatMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHeatDark,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const accentMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: 0.16,
        metalness: 0.3,
        roughness: 0.46,
      }),
    [],
  )
  const engineMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHotMetal,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: 0.14,
        metalness: 0.24,
        roughness: 0.42,
      }),
    [],
  )
  const innerFlameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ffb05f',
        depthTest: false,
        depthWrite: false,
        opacity: 0.78,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const outerFlameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.playerAmberEmissive,
        depthTest: false,
        depthWrite: false,
        opacity: 0.3,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const sparkMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.playerHotMetal,
        depthWrite: false,
        opacity: 0.56,
        size: 0.001,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const fins = finsRef.current
    const panels = panelsRef.current
    if (fins === null || panels === null) return

    const dummy = dummyRef.current
    for (let index = 0; index < FIN_COUNT; index += 1) {
      const angle = index * (Math.PI / 2)
      dummy.position.set(Math.sin(angle) * 0.9, -2.56, Math.cos(angle) * 0.9)
      dummy.rotation.set(0, angle, index % 2 === 0 ? 0.05 : -0.05)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      fins.setMatrixAt(index, dummy.matrix)

      dummy.position.set(Math.sin(angle) * 0.755, 0.52, Math.cos(angle) * 0.755)
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      panels.setMatrixAt(index, dummy.matrix)
    }
    fins.instanceMatrix.needsUpdate = true
    panels.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      bodyGeometry.dispose()
      shoulderGeometry.dispose()
      noseGeometry.dispose()
      bandGeometry.dispose()
      bellGeometry.dispose()
      coreGeometry.dispose()
      finGeometry.dispose()
      panelGeometry.dispose()
      innerFlameGeometry.dispose()
      outerFlameGeometry.dispose()
      sparkGeometry.dispose()
      armorMaterial.dispose()
      bodyMaterial.dispose()
      heatMaterial.dispose()
      accentMaterial.dispose()
      engineMaterial.dispose()
      innerFlameMaterial.dispose()
      outerFlameMaterial.dispose()
      sparkMaterial.dispose()
      delete gl.domElement.dataset.strikeRouteProgress
      delete gl.domElement.dataset.warheadRadius
    }, [
      accentMaterial,
      armorMaterial,
      bandGeometry,
      bellGeometry,
      bodyGeometry,
      bodyMaterial,
      coreGeometry,
      engineMaterial,
      finGeometry,
      gl,
      heatMaterial,
      innerFlameGeometry,
      innerFlameMaterial,
      noseGeometry,
      outerFlameGeometry,
      outerFlameMaterial,
      panelGeometry,
      shoulderGeometry,
      sparkGeometry,
      sparkMaterial,
    ],
  )

  useFrame((state) => {
    const warhead = warheadRef.current
    const model = modelRef.current
    const flame = flameRef.current
    const sparks = sparkRef.current

    if (warhead === null || model === null || flame === null || sparks === null) {
      return
    }

    const progress = getFirstStrikePresentationProgress(presentation)
    const routeProgress = routeProgressForPresentation(presentation, progress)
    let scale = LOCAL_METRES_TO_RENDER_UNITS * 1.46

    if (presentation.phase === 'arming') {
      temporaryPosition.current
        .copy(playerTransform.position)
        .addScaledVector(playerTransform.up, 0.0013 + smootherstep(progress) * 0.00075)
      orientation.current.copy(playerTransform.orientation)
      flame.visible = false
      sparks.visible = false
    } else if (presentation.phase === 'launch') {
      const launchProgress = smootherstep(progress)
      temporaryPosition.current
        .copy(playerTransform.position)
        .addScaledVector(playerTransform.up, 0.0018 + launchProgress * 0.105)
      orientation.current.copy(playerTransform.orientation)
      scale *= 1 + launchProgress * 1.8
      flame.visible = progress > 0.06
      sparks.visible = progress > 0.08
    } else if (routeProgress !== null) {
      route.getRenderPoint(routeProgress, temporaryPosition.current)
      route.getRenderPoint(Math.max(0, routeProgress - 0.002), previousPosition.current)
      route.getRenderPoint(Math.min(1, routeProgress + 0.002), nextPosition.current)
      direction.current
        .copy(nextPosition.current)
        .sub(previousPosition.current)
        .normalize()
      orientation.current.setFromUnitVectors(MODEL_UP, direction.current)
      scale =
        presentation.phase === 'target-approach'
          ? 0.0065 - progress * 0.0038
          : 0.0072
      flame.visible = true
      sparks.visible = true
    } else {
      warhead.visible = false
      return
    }

    warhead.visible = firstStrikeShowsWarhead(presentation.phase)
    warhead.position.copy(temporaryPosition.current)
    warhead.quaternion.copy(orientation.current)
    warhead.scale.setScalar(scale)

    const anticipation =
      presentation.phase === 'arming' ? smoothRange(progress, 0.7, 1) : 0
    const launchVibration =
      presentation.phase === 'launch'
        ? 1 - smoothRange(progress, 0.16, 0.46)
        : 0
    const vibration = Math.max(anticipation * 0.5, launchVibration)
    model.position.set(
      Math.sin(state.clock.elapsedTime * 43) * 0.018 * vibration,
      0,
      Math.cos(state.clock.elapsedTime * 37) * 0.013 * vibration,
    )

    const flicker = 0.82 + Math.sin(state.clock.elapsedTime * 34) * 0.12
    const ignition = flame.visible ? 1 : anticipation
    engineMaterial.emissiveIntensity = Math.min(
      EMISSIVE_LIMITS.tinyLed,
      0.14 + ignition * 0.54 + flicker * 0.08,
    )
    flame.scale.set(1 + (1 - flicker) * 0.12, 0.88 + flicker * 0.28, 1)
    innerFlameMaterial.opacity = 0.64 + flicker * 0.18
    outerFlameMaterial.opacity = 0.18 + flicker * 0.15
    sparks.rotation.y = state.clock.elapsedTime * 3.2
    sparks.scale.setScalar(0.82 + flicker * 0.3)
    sparkMaterial.opacity = 0.34 + flicker * 0.22

    gl.domElement.dataset.strikeRouteProgress =
      routeProgress === null ? 'launch' : routeProgress.toFixed(6)
    gl.domElement.dataset.warheadRadius = temporaryPosition.current
      .length()
      .toFixed(6)
  })

  return (
    <group ref={warheadRef} visible={firstStrikeShowsWarhead(presentation.phase)}>
      <group ref={modelRef}>
        <mesh geometry={bodyGeometry} material={bodyMaterial} castShadow />
        <mesh
          geometry={shoulderGeometry}
          material={armorMaterial}
          position-y={3.68}
          castShadow
        />
        <mesh
          geometry={noseGeometry}
          material={heatMaterial}
          position-y={5.58}
          castShadow
        />
        <mesh geometry={bandGeometry} material={accentMaterial} position-y={-2.08} />
        <mesh
          geometry={bellGeometry}
          material={heatMaterial}
          position-y={-3.73}
          castShadow
        />
        <mesh geometry={coreGeometry} material={engineMaterial} position-y={-4.43} />
        <instancedMesh
          ref={finsRef}
          args={[finGeometry, armorMaterial, FIN_COUNT]}
          castShadow
        />
        <instancedMesh
          ref={panelsRef}
          args={[panelGeometry, accentMaterial, PANEL_COUNT]}
        />
        <group ref={flameRef} position-y={-5.04} rotation-z={Math.PI}>
          <mesh geometry={outerFlameGeometry} material={outerFlameMaterial} />
          <mesh geometry={innerFlameGeometry} material={innerFlameMaterial} />
        </group>
        <points
          ref={sparkRef}
          geometry={sparkGeometry}
          material={sparkMaterial}
          position-y={-4.58}
          frustumCulled={false}
        />
      </group>
    </group>
  )
}
