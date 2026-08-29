import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
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

interface StrikeWarheadProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly presentation: FirstStrikePresentationState
}

const MODEL_UP = new Vector3(0, 1, 0)

function smootherstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped ** 3 * (clamped * (clamped * 6 - 15) + 10)
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

export function StrikeWarhead({
  playerSite,
  rivalSite,
  presentation,
}: StrikeWarheadProps) {
  const warheadRef = useRef<Group>(null)
  const flameRef = useRef<Group>(null)
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
    () => new CylinderGeometry(0.72, 0.9, 7.6, 10),
    [],
  )
  const noseGeometry = useMemo(() => new ConeGeometry(0.74, 3.1, 10), [])
  const finGeometry = useMemo(() => new BoxGeometry(0.18, 2.4, 1.85), [])
  const flameGeometry = useMemo(() => new ConeGeometry(0.74, 4.6, 10), [])
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#4a3831',
        emissive: '#b52d12',
        emissiveIntensity: 0.54,
        metalness: 0.78,
        roughness: 0.27,
      }),
    [],
  )
  const edgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#e7773c',
        emissive: '#ff4b1d',
        emissiveIntensity: 1.4,
        metalness: 0.58,
        roughness: 0.22,
      }),
    [],
  )
  const flameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#ffb05c',
        depthWrite: false,
        opacity: 0.9,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      bodyGeometry.dispose()
      noseGeometry.dispose()
      finGeometry.dispose()
      flameGeometry.dispose()
      bodyMaterial.dispose()
      edgeMaterial.dispose()
      flameMaterial.dispose()
      delete gl.domElement.dataset.strikeRouteProgress
      delete gl.domElement.dataset.warheadRadius
    }, [
      bodyGeometry,
      bodyMaterial,
      edgeMaterial,
      finGeometry,
      flameGeometry,
      flameMaterial,
      gl,
      noseGeometry,
    ],
  )

  useFrame((state) => {
    const warhead = warheadRef.current
    const flame = flameRef.current

    if (warhead === null || flame === null) {
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
    } else if (presentation.phase === 'launch') {
      const launchProgress = smootherstep(progress)
      temporaryPosition.current
        .copy(playerTransform.position)
        .addScaledVector(playerTransform.up, 0.0018 + launchProgress * 0.105)
      orientation.current.copy(playerTransform.orientation)
      scale *= 1 + launchProgress * 1.8
      flame.visible = progress > 0.08
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
    } else {
      warhead.visible = false
      return
    }

    warhead.visible = firstStrikeShowsWarhead(presentation.phase)
    warhead.position.copy(temporaryPosition.current)
    warhead.quaternion.copy(orientation.current)
    warhead.scale.setScalar(scale)
    const flicker = 0.82 + Math.sin(state.clock.elapsedTime * 34) * 0.14
    flame.scale.set(1, flicker, 1)
    flameMaterial.opacity = 0.74 + flicker * 0.2

    gl.domElement.dataset.strikeRouteProgress =
      routeProgress === null ? 'launch' : routeProgress.toFixed(6)
    gl.domElement.dataset.warheadRadius = temporaryPosition.current
      .length()
      .toFixed(6)
  })

  return (
    <group ref={warheadRef} visible={firstStrikeShowsWarhead(presentation.phase)}>
      <mesh geometry={bodyGeometry} material={bodyMaterial} />
      <mesh geometry={noseGeometry} material={edgeMaterial} position-y={5.34} />
      <mesh geometry={finGeometry} material={edgeMaterial} position={[0, -3.1, 0.9]} />
      <mesh
        geometry={finGeometry}
        material={edgeMaterial}
        position={[0.9, -3.1, 0]}
        rotation-y={Math.PI / 2}
      />
      <group ref={flameRef} position-y={-6.05} rotation-z={Math.PI}>
        <mesh geometry={flameGeometry} material={flameMaterial} />
      </group>
    </group>
  )
}
