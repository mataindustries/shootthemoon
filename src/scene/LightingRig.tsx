import { useEffect, useMemo, useRef } from 'react'
import {
  DirectionalLight,
  Object3D,
  Vector3,
  type OrthographicCamera,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'

const SUN_OFFSET = new Vector3(4.6, 2.6, 3.4)
const CINEMATIC_KEY_DIRECTION = SUN_OFFSET.clone().normalize()

interface LightingRigProps {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
  readonly strategicFocusSite?: LandingSite | null
  readonly cinematicReadability?: boolean
  readonly followCameraForReadability?: boolean
  readonly enableSurfaceShadows: boolean
}

export function LightingRig({
  phase,
  landingSite,
  strategicFocusSite = null,
  cinematicReadability = false,
  followCameraForReadability = false,
  enableSurfaceShadows,
}: LightingRigProps) {
  const lightRef = useRef<DirectionalLight>(null)
  const targetRef = useRef<Object3D>(null)
  const temporaryKeyDirectionRef = useRef(new Vector3())
  const castsSurfaceShadow =
    enableSurfaceShadows &&
    (strategicFocusSite !== null ||
      phase === 'approach' ||
      phase === 'landed' ||
      phase === 'returning')
  const activeSite = strategicFocusSite ?? landingSite
  const targetPosition = useMemo(() => {
    if (activeSite === null) {
      return new Vector3()
    }

    const transform = landingSiteToRenderTransform(activeSite)
    return castsSurfaceShadow
      ? transform.position
          .clone()
          .addScaledVector(transform.up, LOCAL_SURFACE_RENDER_OFFSET)
      : transform.position
  }, [activeSite, castsSurfaceShadow])
  const lightPosition = useMemo(() => {
    if (!castsSurfaceShadow || activeSite === null) {
      return targetPosition.clone().add(SUN_OFFSET)
    }

    const transform = landingSiteToRenderTransform(activeSite)
    const strategicKey = strategicFocusSite !== null

    return targetPosition
      .clone()
      .addScaledVector(transform.east, strategicKey ? 3.4 : 4.8)
      .addScaledVector(transform.up, strategicKey ? 4.2 : 1.38)
      .addScaledVector(transform.south, strategicKey ? 1.4 : 2.1)
  }, [activeSite, castsSurfaceShadow, strategicFocusSite, targetPosition])
  const ambientIntensity = cinematicReadability
    ? castsSurfaceShadow
      ? 0.32
      : 0.22
    : castsSurfaceShadow
      ? 0.19
      : 0.055

  useEffect(() => {
    const light = lightRef.current
    const target = targetRef.current

    if (light === null || target === null) {
      return
    }

    target.position.copy(targetPosition)
    light.position.copy(lightPosition)
    light.target = target
    light.castShadow = castsSurfaceShadow
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.bias = -0.000012
    light.shadow.normalBias = 0.000065

    const shadowCamera = light.shadow.camera as OrthographicCamera
    shadowCamera.left = -0.022
    shadowCamera.right = 0.022
    shadowCamera.top = 0.022
    shadowCamera.bottom = -0.022
    shadowCamera.near = 4.3
    shadowCamera.far = 6.8
    shadowCamera.updateProjectionMatrix()
    light.shadow.needsUpdate = true
  }, [castsSurfaceShadow, lightPosition, targetPosition])

  useFrame((state) => {
    const light = lightRef.current
    const target = targetRef.current

    if (!followCameraForReadability || light === null || target === null) {
      return
    }

    const keyDirection = temporaryKeyDirectionRef.current
      .copy(state.camera.position)

    if (keyDirection.lengthSq() <= 1e-12) {
      keyDirection.copy(CINEMATIC_KEY_DIRECTION)
    } else {
      keyDirection
        .normalize()
        .multiplyScalar(0.86)
        .addScaledVector(CINEMATIC_KEY_DIRECTION, 0.14)
        .normalize()
    }

    light.position.copy(targetPosition).addScaledVector(keyDirection, 6)
    light.target = target
  })

  return (
    <>
      <ambientLight
        color="#68788d"
        intensity={ambientIntensity}
      />
      <directionalLight
        ref={lightRef}
        castShadow={castsSurfaceShadow}
        color="#eef3ff"
        intensity={castsSurfaceShadow ? 3.7 : 3.05}
        position={lightPosition}
      />
      <object3D ref={targetRef} position={targetPosition} />
    </>
  )
}
