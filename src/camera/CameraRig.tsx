import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CubicBezierCurve3,
  MathUtils,
  TOUCH,
  Vector3,
  type PerspectiveCamera,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  createLandingSite,
  createLunarLocation,
  type LandingSite,
} from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'
import { useCinematicProgress } from './CinematicClock.tsx'

const ORBIT_DIRECTION = new Vector3(3.2, 0.32, 0.92).normalize()
const DESKTOP_ORBIT_DISTANCE = 3.345
const PORTRAIT_ORBIT_DISTANCE = 4.7
const ORBIT_TARGET = new Vector3(0, 0, 0)
const WORLD_UP = new Vector3(0, 1, 0)

interface Journey {
  readonly path: CubicBezierCurve3
  readonly startTarget: Vector3
  readonly endTarget: Vector3
  readonly startUp: Vector3
  readonly endUp: Vector3
}

interface TestOrbitEventDetail {
  readonly latitudeRad: number
  readonly longitudeRad: number
  readonly distance?: number
}

interface CameraRigProps {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
}

function smoothstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function smootherstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10)
}

function isNarrowPortrait(camera: PerspectiveCamera): boolean {
  return camera.aspect < 0.72
}

function getOrbitHome(camera: PerspectiveCamera): Vector3 {
  return ORBIT_DIRECTION.clone().multiplyScalar(
    isNarrowPortrait(camera)
      ? PORTRAIT_ORBIT_DISTANCE
      : DESKTOP_ORBIT_DISTANCE,
  )
}

function applyOrbitProjection(camera: PerspectiveCamera): void {
  camera.fov = isNarrowPortrait(camera) ? 58 : 42
  camera.updateProjectionMatrix()
}

function updateCameraDataset(
  camera: PerspectiveCamera,
  controls: OrbitControls,
): void {
  const canvas = controls.domElement

  if (canvas === null) {
    return
  }

  canvas.dataset.cameraDistance = controls.getDistance().toFixed(6)
  canvas.dataset.cameraAzimuth = controls.getAzimuthalAngle().toFixed(6)
  canvas.dataset.cameraPolar = controls.getPolarAngle().toFixed(6)
  canvas.dataset.cameraX = camera.position.x.toFixed(6)
  canvas.dataset.cameraY = camera.position.y.toFixed(6)
  canvas.dataset.cameraZ = camera.position.z.toFixed(6)
}

export function CameraRig({ phase, landingSite }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const progressRef = useCinematicProgress()
  const controlsRef = useRef<OrbitControls | null>(null)
  const journeyRef = useRef<Journey | null>(null)
  const temporaryPositionRef = useRef(new Vector3())
  const temporaryTargetRef = useRef(new Vector3())
  const temporaryUpRef = useRef(new Vector3())
  const closeProjectionAppliedRef = useRef(false)

  useEffect(() => {
    camera.position.copy(getOrbitHome(camera))
    applyOrbitProjection(camera)
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.enablePan = false
    controls.minDistance = 2.12
    controls.maxDistance = isNarrowPortrait(camera) ? 5.8 : 5.2
    controls.rotateSpeed = 0.56
    controls.zoomSpeed = 0.72
    controls.touches.ONE = TOUCH.ROTATE
    controls.touches.TWO = TOUCH.DOLLY_ROTATE
    controls.target.copy(ORBIT_TARGET)
    controls.update()
    controls.saveState()
    controlsRef.current = controls

    const handleChange = () => invalidate()
    const handleStart = () => {
      gl.domElement.dataset.cameraInteracting = 'true'
      invalidate()
    }
    const handleEnd = () => {
      gl.domElement.dataset.cameraInteracting = 'false'
      updateCameraDataset(camera, controls)
      invalidate()
    }
    const preventContextMenu = (event: MouseEvent) => event.preventDefault()

    controls.addEventListener('change', handleChange)
    controls.addEventListener('start', handleStart)
    controls.addEventListener('end', handleEnd)
    gl.domElement.addEventListener('contextmenu', preventContextMenu)
    updateCameraDataset(camera, controls)
    invalidate()

    return () => {
      controls.removeEventListener('change', handleChange)
      controls.removeEventListener('start', handleStart)
      controls.removeEventListener('end', handleEnd)
      gl.domElement.removeEventListener('contextmenu', preventContextMenu)
      controls.dispose()
      controlsRef.current = null
    }
  }, [camera, gl, invalidate])

  useEffect(() => {
    const controls = controlsRef.current

    if (controls === null) {
      return
    }

    if (phase === 'approach' && landingSite !== null) {
      const transform = landingSiteToRenderTransform(landingSite)
      const start = camera.position.clone()
      const end = transform.up
        .clone()
        .multiplyScalar(1.0032 + LOCAL_SURFACE_RENDER_OFFSET)
        .addScaledVector(transform.east, 0.0038)
        .addScaledVector(transform.south, 0.008)
      const controlOne = start
        .clone()
        .lerp(transform.up.clone().multiplyScalar(2.15), 0.46)
        .addScaledVector(transform.east, 0.08)
      const controlTwo = transform.up
        .clone()
        .multiplyScalar(1.13)
        .addScaledVector(transform.east, 0.036)
        .addScaledVector(transform.south, 0.072)

      journeyRef.current = {
        path: new CubicBezierCurve3(start, controlOne, controlTwo, end),
        startTarget: controls.target.clone(),
        endTarget: transform.up
          .clone()
          .multiplyScalar(1.000025 + LOCAL_SURFACE_RENDER_OFFSET),
        startUp: camera.up.clone(),
        endUp: transform.up.clone(),
      }
      closeProjectionAppliedRef.current = false
      controls.enabled = false
      camera.near = 0.0005
      camera.far = 40
      camera.updateProjectionMatrix()
      invalidate()
      return
    }

    if (phase === 'returning') {
      const orbitHome = getOrbitHome(camera)
      const start = camera.position.clone()
      const outward = start.clone().normalize().multiplyScalar(1.28)
      const controlOne = start.clone().lerp(outward, 0.72)
      const controlTwo = orbitHome.clone().multiplyScalar(0.82)

      journeyRef.current = {
        path: new CubicBezierCurve3(
          start,
          controlOne,
          controlTwo,
          orbitHome,
        ),
        startTarget: controls.target.clone(),
        endTarget: ORBIT_TARGET.clone(),
        startUp: camera.up.clone(),
        endUp: WORLD_UP.clone(),
      }
      controls.enabled = false
      applyOrbitProjection(camera)
      camera.near = 0.0001
      camera.far = 40
      camera.updateProjectionMatrix()
      invalidate()
      return
    }

    if (phase === 'landed') {
      controls.enabled = false
      camera.near = 0.00001
      camera.far = 3
      camera.updateProjectionMatrix()
      updateCameraDataset(camera, controls)
      invalidate()
      return
    }

    journeyRef.current = null
    closeProjectionAppliedRef.current = false
    controls.enabled = true
    gl.domElement.dataset.cameraInteracting = 'false'
    controls.target.copy(ORBIT_TARGET)
    camera.up.copy(WORLD_UP)
    camera.near = 0.01
    camera.far = 80
    applyOrbitProjection(camera)
    controls.update()
    updateCameraDataset(camera, controls)
    invalidate()
  }, [camera, gl, invalidate, landingSite, phase])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('e2e')) {
      return
    }

    const setOrbitView = (event: Event) => {
      const controls = controlsRef.current

      if (controls === null || phase === 'approach' || phase === 'returning') {
        return
      }

      const detail = (event as CustomEvent<TestOrbitEventDetail>).detail
      const testSite = createLandingSite(
        createLunarLocation(detail.latitudeRad, detail.longitudeRad),
      )
      const transform = landingSiteToRenderTransform(testSite)
      const distance = detail.distance ?? 3.25
      const position = transform.up
        .clone()
        .multiplyScalar(distance)
        .addScaledVector(transform.east, 0.12)
        .addScaledVector(transform.south, 0.06)
        .setLength(distance)

      camera.position.copy(position)
      camera.up.copy(WORLD_UP)
      controls.target.copy(ORBIT_TARGET)
      controls.update()
      updateCameraDataset(camera, controls)
      invalidate()
    }

    window.addEventListener('moon-core:set-orbit-view', setOrbitView)
    return () =>
      window.removeEventListener('moon-core:set-orbit-view', setOrbitView)
  }, [camera, invalidate, phase])

  useFrame((state, delta) => {
    const controls = controlsRef.current

    if (controls === null) {
      return
    }

    if (phase === 'orbit' || phase === 'selected') {
      controls.update(Math.min(delta, 0.05))
      return
    }

    const journey = journeyRef.current

    if (
      journey === null ||
      (phase !== 'approach' && phase !== 'returning')
    ) {
      return
    }

    const progress = progressRef.current
    const positionProgress = smootherstep(progress)
    const targetProgress =
      phase === 'approach'
        ? smoothstep(Math.min(1, progress / 0.72))
        : smoothstep(progress)

    journey.path.getPoint(positionProgress, temporaryPositionRef.current)
    temporaryTargetRef.current
      .copy(journey.startTarget)
      .lerp(journey.endTarget, targetProgress)
    temporaryUpRef.current
      .copy(journey.startUp)
      .lerp(journey.endUp, targetProgress)
      .normalize()

    camera.position.copy(temporaryPositionRef.current)
    camera.up.copy(temporaryUpRef.current)
    camera.lookAt(temporaryTargetRef.current)
    controls.target.copy(temporaryTargetRef.current)

    if (
      phase === 'approach' &&
      progress >= 0.68 &&
      !closeProjectionAppliedRef.current
    ) {
      closeProjectionAppliedRef.current = true
      camera.near = 0.00001
      camera.far = 3
      camera.fov = isNarrowPortrait(camera) ? 48 : 38
      camera.updateProjectionMatrix()
    }

    updateCameraDataset(camera, controls)
    state.invalidate()
  })

  return null
}
