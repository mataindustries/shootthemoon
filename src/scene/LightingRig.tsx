import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  DirectionalLight,
  Object3D,
  PointLight,
  Vector3,
  type OrthographicCamera,
} from 'three'
import {
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

const SUN_OFFSET = new Vector3(4.6, 2.6, 3.4)
const WORLD_UP = new Vector3(0, 1, 0)
const WORLD_EAST = new Vector3(1, 0, 0)
const WORLD_SOUTH = new Vector3(0, 0, 1)
const LAUNCH_LIGHT_CLEARANCE = 0.00152
const IMPACT_LIGHT_CLEARANCE = 0.00814

interface LightingRigProps {
  readonly landingSite: LandingSite | null
  readonly strategicFocusSite?: LandingSite | null
  readonly cinematicReadability?: boolean
  readonly enableSurfaceShadows: boolean
  readonly closeViewShadows: boolean
  readonly firstStrikePresentation: FirstStrikePresentationState
  readonly residualScarLight: boolean
  readonly surfaceHeight?: number | undefined
}

export function LightingRig({
  landingSite,
  strategicFocusSite = null,
  cinematicReadability = false,
  enableSurfaceShadows,
  closeViewShadows,
  firstStrikePresentation,
  residualScarLight,
  surfaceHeight = LOCAL_SURFACE_RENDER_OFFSET,
}: LightingRigProps) {
  const lightRef = useRef<DirectionalLight>(null)
  const eventLightRef = useRef<PointLight>(null)
  const targetRef = useRef<Object3D>(null)
  const castsSurfaceShadow = enableSurfaceShadows
  const activeSite = strategicFocusSite ?? landingSite
  const activeTransform = useMemo(
    () =>
      activeSite === null ? null : landingSiteToRenderTransform(activeSite),
    [activeSite],
  )
  const activeUp = activeTransform?.up ?? WORLD_UP
  const activeEast = activeTransform?.east ?? WORLD_EAST
  const activeSouth = activeTransform?.south ?? WORLD_SOUTH
  const targetPosition = useMemo(() => {
    if (activeTransform === null) {
      return new Vector3()
    }

    return castsSurfaceShadow
      ? activeTransform.position
          .clone()
          .addScaledVector(activeTransform.up, surfaceHeight)
      : activeTransform.position
  }, [activeTransform, castsSurfaceShadow, surfaceHeight])
  const lightPosition = useMemo(
    () => targetPosition.clone().add(SUN_OFFSET),
    [targetPosition],
  )
  const ambientIntensity = cinematicReadability
    ? closeViewShadows
      ? 0.45
      : 0.22
    : closeViewShadows
      ? 0.16
      : 0.04
  const scarShadowView =
    firstStrikePresentation.phase === 'impact-flash' ||
    firstStrikePresentation.phase === 'ejecta' ||
    firstStrikePresentation.phase === 'crater-reveal' ||
    firstStrikePresentation.phase === 'scar-explore'
  const shadowExtent = scarShadowView ? 0.105 : 0.022

  useFrame(() => {
    const eventLight = eventLightRef.current
    if (eventLight === null) return

    const rivalReadLight =
      firstStrikePresentation.phase === 'idle' &&
      cinematicReadability &&
      closeViewShadows
    eventLight.color.set(
      rivalReadLight ? VISUAL_PALETTE.rivalHighlight : '#ffe0c4',
    )

    if (rivalReadLight) {
      eventLight.distance = 0.065
      eventLight.position
        .copy(targetPosition)
        .addScaledVector(activeUp, 0.016)
        .addScaledVector(activeEast, 0.014)
        .addScaledVector(activeSouth, 0.012)
      eventLight.intensity = 0.034
      return
    }

    const progress = getFirstStrikePresentationProgress(
      firstStrikePresentation,
    )

    if (firstStrikePresentation.phase === 'launch') {
      eventLight.distance = 0.026
      eventLight.position
        .copy(targetPosition)
        .addScaledVector(activeUp, LAUNCH_LIGHT_CLEARANCE)
      eventLight.intensity =
        Math.sin(Math.PI * Math.min(1, progress / 0.42)) ** 1.2 * 0.006
      return
    }

    if (firstStrikePresentation.phase === 'impact-flash') {
      const flashWindow = Math.min(1, progress / 0.42)
      const flashPulse = Math.sin(Math.PI * flashWindow) ** 0.42
      eventLight.distance = 0.18
      eventLight.position
        .copy(targetPosition)
        .addScaledVector(activeUp, IMPACT_LIGHT_CLEARANCE)
      eventLight.intensity = flashPulse * 0.12
      return
    }

    if (
      firstStrikePresentation.phase === 'ejecta' ||
      firstStrikePresentation.phase === 'crater-reveal' ||
      firstStrikePresentation.phase === 'orbital-pullback' ||
      firstStrikePresentation.phase === 'scar-explore' ||
      firstStrikePresentation.phase === 'ending' ||
      residualScarLight
    ) {
      eventLight.distance =
        firstStrikePresentation.phase === 'orbital-pullback' ||
        firstStrikePresentation.phase === 'ending' ||
        firstStrikePresentation.phase === 'scar-explore' ||
        residualScarLight
          ? 0.085
          : 0.18
      eventLight.position
        .copy(targetPosition)
        .addScaledVector(activeUp, 0.035)
        .addScaledVector(activeEast, 0.038)
        .addScaledVector(activeSouth, -0.022)

      switch (firstStrikePresentation.phase) {
        case 'ejecta':
          eventLight.intensity = 0.05 - progress * 0.02
          break
        case 'crater-reveal':
          eventLight.intensity = 0.065 - progress * 0.025
          break
        case 'orbital-pullback':
          eventLight.intensity = 0.024 - progress * 0.012
          break
        case 'scar-explore':
          eventLight.intensity = 0.05
          break
        case 'ending':
          eventLight.intensity = 0.014
          break
        default:
          eventLight.intensity = 0.016
      }
      return
    }

    eventLight.intensity = 0
  })

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
    shadowCamera.left = -shadowExtent
    shadowCamera.right = shadowExtent
    shadowCamera.top = shadowExtent
    shadowCamera.bottom = -shadowExtent
    shadowCamera.near = 4.3
    shadowCamera.far = 6.8
    shadowCamera.updateProjectionMatrix()
    light.shadow.needsUpdate = true
  }, [castsSurfaceShadow, lightPosition, shadowExtent, targetPosition])

  return (
    <>
      <ambientLight color="#8895a5" intensity={ambientIntensity} />
      <directionalLight
        ref={lightRef}
        castShadow={castsSurfaceShadow}
        color="#fff4df"
        intensity={castsSurfaceShadow ? 2.55 : 2.85}
        position={lightPosition}
      />
      <pointLight
        ref={eventLightRef}
        color="#ffe0c4"
        decay={2}
        distance={0.18}
        intensity={0}
        position={targetPosition}
      />
      <object3D ref={targetRef} position={targetPosition} />
    </>
  )
}
