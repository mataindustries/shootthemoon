import { getCounterstrikeRunProgress, type CounterstrikeRunState } from '../simulation/counterstrikeSimulation.ts'
import { sampleInterceptEnergy } from './interceptPresentation.ts'
import {
  COUNTERSTRIKE_IMPACT_LIGHT,
  getCounterstrikeImpactElapsedMs,
  sampleCounterstrikeImpactEnergy,
} from './counterstrikeImpactPresentation.ts'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
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
import {
  sampleEjectaBlastResidual,
  sampleImpactBlastEnergy,
} from './LunarImpactEffects.tsx'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

const SUN_OFFSET = new Vector3(4.6, 2.6, 3.4)
const WORLD_UP = new Vector3(0, 1, 0)
const WORLD_EAST = new Vector3(1, 0, 0)
const WORLD_SOUTH = new Vector3(0, 0, 1)
const LAUNCH_LIGHT_CLEARANCE = 0.00152
const IMPACT_LIGHT_CLEARANCE = 0.00814
// Scoped to the First Strike detonation: the blast is the only light the rival
// site gets during `impact-flash`, and it keeps burning into early `ejecta`.
const IMPACT_LIGHT_RANGE = 0.22
const IMPACT_LIGHT_PEAK = 0.55

interface LightingRigProps {
  readonly monumentReadability?: boolean
  readonly counterstrikeRun?: CounterstrikeRunState
  readonly orbitalInterceptPosition?: Vector3 | null
  readonly counterstrikeImpactPosition?: Vector3 | null
  readonly landingSite: LandingSite | null
  readonly strategicFocusSite?: LandingSite | null
  readonly cinematicReadability?: boolean
  readonly enableSurfaceShadows: boolean
  readonly closeViewShadows: boolean
  readonly firstStrikePresentation: FirstStrikePresentationState
  readonly residualScarLight: boolean
  readonly surfaceHeight?: number | undefined
  readonly closeReadLightColor?: string | undefined
}

export function LightingRig({
  monumentReadability = false,
  counterstrikeRun,
  orbitalInterceptPosition,
  counterstrikeImpactPosition,
  landingSite,
  strategicFocusSite = null,
  cinematicReadability = false,
  enableSurfaceShadows,
  closeViewShadows,
  firstStrikePresentation,
  residualScarLight,
  surfaceHeight = LOCAL_SURFACE_RENDER_OFFSET,
  closeReadLightColor,
}: LightingRigProps) {
  const gl = useThree((state) => state.gl)
  const lightRef = useRef<DirectionalLight>(null)
  const rakeRef = useRef<DirectionalLight>(null)
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
  const counterstrikeReadLight = closeReadLightColor !== undefined
  const targetPosition = useMemo(() => {
    if (activeTransform === null) {
      return new Vector3()
    }

    return castsSurfaceShadow || counterstrikeReadLight
      ? activeTransform.position
          .clone()
          .addScaledVector(activeTransform.up, surfaceHeight)
      : activeTransform.position
  }, [activeTransform, castsSurfaceShadow, counterstrikeReadLight, surfaceHeight])
  const lightPosition = useMemo(
    () => targetPosition.clone().add(SUN_OFFSET),
    [targetPosition],
  )
  const ambientIntensity = monumentReadability ? .2 : counterstrikeReadLight
    ? 0.075
    : cinematicReadability
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
    const rake = rakeRef.current
    if (rake !== null) {
      const scar =
        (scarShadowView && firstStrikePresentation.phase !== 'impact-flash') ||
        residualScarLight ||
        firstStrikePresentation.phase === 'orbital-pullback' ||
        firstStrikePresentation.phase === 'ending'
      const playerSurface = !monumentReadability && !cinematicReadability && closeViewShadows && !scar
      rake.intensity = monumentReadability ? 2.3 : counterstrikeReadLight ? 0.85 : scar ? 2.4 : playerSurface ? 1.6 : 0
      // Fixed in the site's tangent frame, independent of camera motion.
      rake.position.copy(targetPosition)
        .addScaledVector(activeEast, playerSurface ? 0.08 : -0.14)
        .addScaledVector(activeSouth, playerSurface ? 0.14 : 0.055)
        .addScaledVector(activeUp, monumentReadability ? .16 : playerSurface ? 0.08 : 0.035)
      if (targetRef.current !== null) rake.target = targetRef.current
    }
    const eventLight = eventLightRef.current
    if (eventLight === null) return

    if (counterstrikeRun?.status === 'success' && orbitalInterceptPosition != null) {
      const energy = sampleInterceptEnergy(getCounterstrikeRunProgress(counterstrikeRun, performance.now()))
      eventLight.color.set('#ffc280')
      eventLight.position.copy(orbitalInterceptPosition)
      eventLight.distance = 1.2
      eventLight.intensity = energy.surfacePulse * 0.8
      return
    }

    // Rival warhead contact: a sharp, short pulse from the hit itself that
    // lights the extractor and the rising regolith, then hands back to the
    // close read lighting below.
    if (counterstrikeRun?.status === 'impact' && counterstrikeImpactPosition != null) {
      const energy = sampleCounterstrikeImpactEnergy(
        getCounterstrikeImpactElapsedMs(counterstrikeRun, performance.now()),
      )
      eventLight.color.set(COUNTERSTRIKE_IMPACT_LIGHT.color)
      eventLight.position.copy(counterstrikeImpactPosition)
      eventLight.distance = COUNTERSTRIKE_IMPACT_LIGHT.range
      eventLight.intensity = energy.light * COUNTERSTRIKE_IMPACT_LIGHT.peakIntensity
      gl.domElement.dataset.counterstrikeImpactLight = energy.light.toFixed(3)
      return
    }
    if (gl.domElement.dataset.counterstrikeImpactLight !== undefined) {
      delete gl.domElement.dataset.counterstrikeImpactLight
    }

    const closeReadLight =
      counterstrikeReadLight ||
      (firstStrikePresentation.phase === 'idle' &&
        cinematicReadability &&
        closeViewShadows)
    eventLight.color.set(
      closeReadLight
        ? closeReadLightColor ?? VISUAL_PALETTE.rivalHighlight
        : '#ffe0c4',
    )

    if (counterstrikeReadLight) {
      eventLight.intensity = 0
      return
    }

    if (closeReadLight) {
      eventLight.distance = 0.065
      eventLight.position.copy(targetPosition)
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

    const detonation = firstStrikePresentation.phase === 'impact-flash'
    const blastAfterglow =
      firstStrikePresentation.phase === 'ejecta' && !residualScarLight

    // The detonation drives this light through `impact-flash` and hands its
    // tail to the opening of `ejecta`, so the crater and the debris rising out
    // of it keep the blast's light instead of cutting straight to the scar rake.
    if (detonation || blastAfterglow) {
      eventLight.distance = IMPACT_LIGHT_RANGE
      eventLight.position
        .copy(targetPosition)
        .addScaledVector(activeUp, IMPACT_LIGHT_CLEARANCE)
      eventLight.intensity =
        (detonation
          ? sampleImpactBlastEnergy(progress)
          : sampleEjectaBlastResidual(progress)) * IMPACT_LIGHT_PEAK
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
      eventLight.intensity = 0
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
      <directionalLight ref={rakeRef} color="#b5b9bd" intensity={0} />
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
