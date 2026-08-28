import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CubicBezierCurve3,
  MathUtils,
  Quaternion,
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
import type { OutpostSnapshot, RobotState } from '../domain/outpost.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { getRobotKinematics } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import {
  localSurfaceToRender,
  type SurfaceTerrainProfile,
} from '../render/surfaceTerrain.ts'
import { useCinematicProgress } from './CinematicClock.tsx'
import {
  getRivalPresentationProgress,
  rivalPresentationLocksCamera,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'

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
  readonly orbitalFocusSite: LandingSite | null
  readonly outpost: OutpostSnapshot | null
  readonly terrain: SurfaceTerrainProfile | null
  readonly rivalSite: LandingSite | null
  readonly dualOrbitPreferred: boolean
  readonly rivalPresentation: RivalPresentationState
}

type SurfaceFocusKind =
  | 'deployment'
  | 'travel'
  | 'mining'
  | 'return'
  | 'unloading'
  | 'construction'
  | 'activation'

interface SurfaceCameraPose {
  readonly position: Vector3
  readonly target: Vector3
  readonly up: Vector3
}

interface SavedSurfaceView {
  readonly position: Vector3
  readonly target: Vector3
}

interface OrbitControlsCoordinateFrame {
  readonly _quat: Quaternion
  readonly _quatInverse: Quaternion
}

interface ConfiguredRivalPresentation {
  readonly phase: RivalPresentationState['phase']
  readonly replay: boolean
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

function getOrbitViewForSite(
  camera: PerspectiveCamera,
  site: LandingSite,
): Vector3 {
  const transform = landingSiteToRenderTransform(site)
  const distance = isNarrowPortrait(camera)
    ? PORTRAIT_ORBIT_DISTANCE
    : DESKTOP_ORBIT_DISTANCE

  return transform.up
    .clone()
    .multiplyScalar(distance)
    .addScaledVector(transform.east, distance * 0.075)
    .addScaledVector(transform.south, distance * 0.038)
    .setLength(distance)
}

function getDualOrbitView(
  camera: PerspectiveCamera,
  playerSite: LandingSite,
  rivalSite: LandingSite,
): Vector3 {
  const player = landingSiteToRenderTransform(playerSite)
  const rival = landingSiteToRenderTransform(rivalSite)
  const distance = isNarrowPortrait(camera)
    ? PORTRAIT_ORBIT_DISTANCE
    : DESKTOP_ORBIT_DISTANCE
  const midpoint = player.up.clone().add(rival.up).normalize()
  const oppositionAxis = rival.up.clone().cross(player.up).normalize()

  return midpoint
    .multiplyScalar(distance)
    .addScaledVector(oppositionAxis, distance * 0.075)
    .setLength(distance)
}

function localPointToWorld(
  site: LandingSite,
  x: number,
  y: number,
  z: number,
): Vector3 {
  const transform = landingSiteToRenderTransform(site)

  return new Vector3(x, y, z)
    .applyQuaternion(transform.orientation)
    .add(transform.position)
}

function getSurfaceCameraPose(
  site: LandingSite,
  terrain: SurfaceTerrainProfile | null,
): SurfaceCameraPose {
  const transform = landingSiteToRenderTransform(site)
  const targetXM = 1.6
  const targetZM = -7.5
  const targetGround =
    terrain === null
      ? LOCAL_SURFACE_RENDER_OFFSET
      : localSurfaceToRender(terrain, targetXM, targetZM).y

  return {
    position: localPointToWorld(site, 0.00115, 0.00255, 0.0043),
    target: localPointToWorld(
      site,
      targetXM * LOCAL_METRES_TO_RENDER_UNITS,
      targetGround + 1.05 * LOCAL_METRES_TO_RENDER_UNITS,
      targetZM * LOCAL_METRES_TO_RENDER_UNITS,
    ),
    up: transform.up.clone(),
  }
}

function getRivalSurfaceCameraPose(site: LandingSite): SurfaceCameraPose {
  const transform = landingSiteToRenderTransform(site)

  return {
    position: localPointToWorld(site, 0.0065, 0.0095, 0.0195),
    target: localPointToWorld(site, 0, 0.00065, 0),
    up: transform.up.clone(),
  }
}

function getSurfaceFocusKind(
  outpost: OutpostSnapshot,
  nowMs: number,
): SurfaceFocusKind | null {
  const robotFocusByState: Partial<Record<RobotState, SurfaceFocusKind>> = {
    deploying: 'deployment',
    traveling: 'travel',
    mining: 'mining',
    returning: 'return',
    unloading: 'unloading',
  }
  const robotFocus = robotFocusByState[outpost.robot.state]

  if (robotFocus !== undefined) {
    return robotFocus
  }

  if (outpost.extractor?.status === 'constructing') {
    return 'construction'
  }

  if (
    outpost.extractor?.status === 'active' &&
    nowMs - outpost.extractor.activationTimestampMs < 1_650
  ) {
    return 'activation'
  }

  return null
}

function getSurfaceFocusPose(
  site: LandingSite,
  terrain: SurfaceTerrainProfile,
  outpost: OutpostSnapshot,
  kind: SurfaceFocusKind,
  nowMs: number,
): SurfaceCameraPose {
  const transform = landingSiteToRenderTransform(site)
  const extractorFocus = kind === 'construction' || kind === 'activation'
  const kinematics = getRobotKinematics(outpost, nowMs)
  let focusPosition =
    extractorFocus && outpost.extractor !== null
      ? outpost.extractor.position
      : kinematics.position
  const targetDeposit =
    kind === 'mining' && outpost.robot.targetDepositId !== null
      ? outpost.deposits.find(
          (deposit) => deposit.id === outpost.robot.targetDepositId,
        ) ?? null
      : null

  if (targetDeposit !== null) {
    focusPosition = {
      xM: (kinematics.position.xM + targetDeposit.position.xM) / 2,
      zM: (kinematics.position.zM + targetDeposit.position.zM) / 2,
    }
  }
  const ground = localSurfaceToRender(
    terrain,
    focusPosition.xM,
    focusPosition.zM,
  )
  const offsetX =
    kind === 'mining' ? 0.00128 : extractorFocus ? 0.00028 : 0.00124
  const offsetY =
    kind === 'mining' ? 0.00085 : extractorFocus ? 0.00068 : 0.00134
  const offsetZ =
    kind === 'mining' ? 0.00056 : extractorFocus ? 0.00122 : 0.00248
  const targetY =
    ground.y +
    (extractorFocus ? 1.25 : 0.9) * LOCAL_METRES_TO_RENDER_UNITS

  return {
    position: localPointToWorld(
      site,
      ground.x + offsetX,
      targetY + offsetY,
      ground.z + offsetZ,
    ),
    target: localPointToWorld(site, ground.x, targetY, ground.z),
    up: transform.up.clone(),
  }
}

function applyOrbitProjection(camera: PerspectiveCamera): void {
  camera.fov = isNarrowPortrait(camera) ? 58 : 42
  camera.updateProjectionMatrix()
}

function applySurfaceProjection(camera: PerspectiveCamera): void {
  camera.near = 0.000012
  camera.far = 3
  camera.fov = isNarrowPortrait(camera) ? 54 : 42
  camera.updateProjectionMatrix()
}

function setControlsUpDirection(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  up: Vector3,
): void {
  camera.up.copy(up)
  const coordinateFrame = controls as unknown as OrbitControlsCoordinateFrame
  coordinateFrame._quat.setFromUnitVectors(camera.up, WORLD_UP)
  coordinateFrame._quatInverse.copy(coordinateFrame._quat).invert()
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

export function CameraRig({
  phase,
  landingSite,
  orbitalFocusSite,
  outpost,
  terrain,
  rivalSite,
  dualOrbitPreferred,
  rivalPresentation,
}: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const viewportSize = useThree((state) => state.size)
  const progressRef = useCinematicProgress()
  const controlsRef = useRef<OrbitControls | null>(null)
  const journeyRef = useRef<Journey | null>(null)
  const rivalJourneyRef = useRef<Journey | null>(null)
  const configuredRivalPresentationRef =
    useRef<ConfiguredRivalPresentation | null>(null)
  const temporaryPositionRef = useRef(new Vector3())
  const temporaryTargetRef = useRef(new Vector3())
  const temporaryUpRef = useRef(new Vector3())
  const closeProjectionAppliedRef = useRef(false)
  const surfaceFocusKindRef = useRef<SurfaceFocusKind | null>(null)
  const savedSurfaceViewRef = useRef<SavedSurfaceView | null>(null)
  const returningToSurfaceViewRef = useRef(false)

  useEffect(() => {
    camera.position.copy(
      orbitalFocusSite === null
        ? getOrbitHome(camera)
        : getOrbitViewForSite(camera, orbitalFocusSite),
    )
    applyOrbitProjection(camera)
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.enablePan = false
    controls.minDistance = 2.12
    controls.maxDistance = isNarrowPortrait(camera) ? 5.8 : 5.2
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
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

    const rivalPhase = rivalPresentation.phase

    if (rivalPhase !== 'idle') {
      if (
        configuredRivalPresentationRef.current?.phase === rivalPhase &&
        configuredRivalPresentationRef.current.replay ===
          rivalPresentation.replay
      ) {
        controls.enabled = rivalPhase === 'rival-focused'
        updateCameraDataset(camera, controls)
        invalidate()
        return
      }

      configuredRivalPresentationRef.current = {
        phase: rivalPhase,
        replay: rivalPresentation.replay,
      }
      journeyRef.current = null
      rivalJourneyRef.current = null
      controls.enabled = false
      gl.domElement.dataset.cameraInteracting = 'false'
      gl.domElement.dataset.cameraMode = `rival-${rivalPhase}`

      if (rivalPhase === 'warning') {
        invalidate()
        return
      }

      if (rivalSite === null || orbitalFocusSite === null) {
        invalidate()
        return
      }

      const rivalTransform = landingSiteToRenderTransform(rivalSite)
      const playerTransform = landingSiteToRenderTransform(orbitalFocusSite)
      const rivalSurfacePose = getRivalSurfaceCameraPose(rivalSite)

      if (rivalPhase === 'rival-focused') {
        camera.position.copy(rivalSurfacePose.position)
        setControlsUpDirection(camera, controls, rivalSurfacePose.up)
        controls.target.copy(rivalSurfacePose.target)
        controls.enabled = true
        controls.enablePan = false
        controls.minDistance = 0.018
        controls.maxDistance = 0.065
        controls.minPolarAngle = 0.32
        controls.maxPolarAngle = 1.48
        controls.rotateSpeed = 0.38
        controls.zoomSpeed = 0.56
        camera.near = 0.00001
        camera.far = 4
        camera.fov = isNarrowPortrait(camera) ? 50 : 40
        camera.updateProjectionMatrix()
        controls.update()
        updateCameraDataset(camera, controls)
        invalidate()
        return
      }

      if (
        rivalPhase === 'intro-transmission' ||
        rivalPhase === 'scanning' ||
        rivalPhase === 'scan-response'
      ) {
        camera.near = 0.00001
        camera.far = 4
        camera.fov = isNarrowPortrait(camera) ? 50 : 40
        camera.updateProjectionMatrix()
        updateCameraDataset(camera, controls)
        invalidate()
        return
      }

      const start = camera.position.clone()
      let endPosition: Vector3
      let endTarget: Vector3
      let endUp: Vector3
      let controlOne: Vector3
      let controlTwo: Vector3

      if (rivalPhase === 'orbital-transition') {
        endPosition = getOrbitViewForSite(camera, orbitalFocusSite)
        endTarget = ORBIT_TARGET.clone()
        endUp = WORLD_UP.clone()
        controlOne = playerTransform.up
          .clone()
          .multiplyScalar(1.34)
          .addScaledVector(playerTransform.east, 0.045)
        controlTwo = endPosition.clone().multiplyScalar(0.68)
      } else if (rivalPhase === 'capsule-approach') {
        endPosition = getOrbitViewForSite(camera, rivalSite).setLength(
          isNarrowPortrait(camera) ? 2.72 : 2.36,
        )
        endTarget = ORBIT_TARGET.clone()
        endUp = WORLD_UP.clone()
        controlOne = start.clone().multiplyScalar(0.94)
        controlTwo = rivalTransform.up
          .clone()
          .multiplyScalar(isNarrowPortrait(camera) ? 2.9 : 2.5)
          .addScaledVector(rivalTransform.east, 0.18)
      } else if (rivalPhase === 'impact') {
        endPosition = rivalSurfacePose.position
        endTarget = rivalSurfacePose.target
        endUp = rivalSurfacePose.up
        controlOne = rivalTransform.up
          .clone()
          .multiplyScalar(1.7)
          .addScaledVector(rivalTransform.east, 0.08)
        controlTwo = rivalTransform.position
          .clone()
          .addScaledVector(rivalTransform.up, 0.095)
          .addScaledVector(rivalTransform.east, 0.025)
          .addScaledVector(rivalTransform.south, 0.045)
      } else if (rivalPhase === 'rival-focus') {
        endPosition = rivalSurfacePose.position
        endTarget = rivalSurfacePose.target
        endUp = rivalSurfacePose.up
        controlOne = start.clone().multiplyScalar(0.86)
        controlTwo = rivalTransform.position
          .clone()
          .addScaledVector(rivalTransform.up, 0.11)
          .addScaledVector(rivalTransform.east, 0.035)
          .addScaledVector(rivalTransform.south, 0.055)
      } else {
        endPosition = getDualOrbitView(
          camera,
          orbitalFocusSite,
          rivalSite,
        )
        endTarget = ORBIT_TARGET.clone()
        endUp = WORLD_UP.clone()
        controlOne = rivalTransform.up
          .clone()
          .multiplyScalar(1.38)
          .addScaledVector(rivalTransform.east, 0.08)
        controlTwo = endPosition.clone().multiplyScalar(0.7)
      }

      rivalJourneyRef.current = {
        path: new CubicBezierCurve3(start, controlOne, controlTwo, endPosition),
        startTarget: controls.target.clone(),
        endTarget,
        startUp: camera.up.clone(),
        endUp,
      }
      camera.near =
        rivalPhase === 'impact' || rivalPhase === 'rival-focus'
          ? 0.001
          : 0.01
      camera.far = 80
      camera.fov = isNarrowPortrait(camera) ? 56 : 42
      camera.updateProjectionMatrix()
      invalidate()
      return
    }

    const exitedRivalPresentation =
      configuredRivalPresentationRef.current !== null
    configuredRivalPresentationRef.current = null
    rivalJourneyRef.current = null

    if (phase === 'approach' && landingSite !== null) {
      const transform = landingSiteToRenderTransform(landingSite)
      const surfacePose = getSurfaceCameraPose(landingSite, terrain)
      const start = camera.position.clone()
      const end = surfacePose.position
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
        endTarget: surfacePose.target,
        startUp: camera.up.clone(),
        endUp: surfacePose.up,
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
      const orbitHome =
        dualOrbitPreferred &&
        orbitalFocusSite !== null &&
        rivalSite !== null
          ? getDualOrbitView(camera, orbitalFocusSite, rivalSite)
          : landingSite === null
            ? getOrbitHome(camera)
            : getOrbitViewForSite(camera, landingSite)
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
      surfaceFocusKindRef.current = null
      savedSurfaceViewRef.current = null
      returningToSurfaceViewRef.current = false
      controls.enabled = true
      controls.enablePan = false
      controls.minDistance = 0.00265
      controls.maxDistance = 0.0074
      controls.minPolarAngle = 0.48
      controls.maxPolarAngle = 1.43
      controls.rotateSpeed = 0.44
      controls.zoomSpeed = 0.62

      if (landingSite !== null) {
        const surfacePose = getSurfaceCameraPose(landingSite, terrain)
        camera.position.copy(surfacePose.position)
        setControlsUpDirection(camera, controls, surfacePose.up)
        camera.lookAt(surfacePose.target)
        controls.target.copy(surfacePose.target)
      }

      applySurfaceProjection(camera)
      controls.update()
      gl.domElement.dataset.cameraMode = 'surface-player'
      updateCameraDataset(camera, controls)
      invalidate()
      return
    }

    const restoreOrbitPose =
      phase === 'orbit' &&
      (exitedRivalPresentation ||
        journeyRef.current !== null ||
        camera.position.length() < 2)

    if (restoreOrbitPose) {
      camera.position.copy(
        exitedRivalPresentation &&
          orbitalFocusSite !== null &&
          rivalSite !== null
          ? getDualOrbitView(camera, orbitalFocusSite, rivalSite)
          : dualOrbitPreferred &&
              orbitalFocusSite !== null &&
              rivalSite !== null
            ? getDualOrbitView(camera, orbitalFocusSite, rivalSite)
          : landingSite === null
            ? getOrbitHome(camera)
            : getOrbitViewForSite(camera, landingSite),
      )
    }

    journeyRef.current = null
    closeProjectionAppliedRef.current = false
    surfaceFocusKindRef.current = null
    savedSurfaceViewRef.current = null
    returningToSurfaceViewRef.current = false
    controls.enabled = true
    controls.minDistance = 2.12
    controls.maxDistance = isNarrowPortrait(camera) ? 5.8 : 5.2
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.rotateSpeed = 0.56
    controls.zoomSpeed = 0.72
    gl.domElement.dataset.cameraInteracting = 'false'
    gl.domElement.dataset.cameraMode = 'orbit'
    controls.target.copy(ORBIT_TARGET)
    setControlsUpDirection(camera, controls, WORLD_UP)
    camera.near = 0.01
    camera.far = 80
    applyOrbitProjection(camera)
    controls.update()
    updateCameraDataset(camera, controls)
    invalidate()
  }, [
    camera,
    dualOrbitPreferred,
    gl,
    invalidate,
    landingSite,
    orbitalFocusSite,
    phase,
    rivalPresentation,
    rivalSite,
    terrain,
  ])

  useEffect(() => {
    const controls = controlsRef.current

    if (controls === null) {
      return
    }

    if (
      rivalPresentationLocksCamera(rivalPresentation.phase) ||
      rivalPresentation.phase === 'rival-focused' ||
      rivalPresentation.phase === 'warning'
    ) {
      updateCameraDataset(camera, controls)
      invalidate()
      return
    }

    if (phase === 'landed') {
      const focused = surfaceFocusKindRef.current !== null
      camera.fov = isNarrowPortrait(camera)
        ? focused
          ? 49
          : 54
        : focused
          ? 38
          : 42
      camera.updateProjectionMatrix()
    } else if (phase === 'orbit' || phase === 'selected') {
      controls.maxDistance = isNarrowPortrait(camera) ? 5.8 : 5.2
      applyOrbitProjection(camera)
    }

    updateCameraDataset(camera, controls)
    invalidate()
  }, [
    camera,
    invalidate,
    phase,
    rivalPresentation.phase,
    viewportSize.height,
    viewportSize.width,
  ])

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

    if (rivalPresentation.phase !== 'idle') {
      if (rivalPresentation.phase === 'rival-focused') {
        controls.enabled = true
        controls.update(Math.min(delta, 0.05))
        return
      }

      controls.enabled = false
      const rivalJourney = rivalJourneyRef.current

      if (rivalJourney === null) {
        return
      }

      const progress = getRivalPresentationProgress(rivalPresentation)
      const closesOnSurface =
        rivalPresentation.phase === 'impact' ||
        rivalPresentation.phase === 'rival-focus'
      const positionProgress = smootherstep(
        closesOnSurface ? Math.min(1, progress * 1.15) : progress,
      )
      const targetProgress = smoothstep(
        closesOnSurface ? Math.min(1, progress * 1.35) : progress,
      )

      rivalJourney.path.getPoint(
        positionProgress,
        temporaryPositionRef.current,
      )
      temporaryTargetRef.current
        .copy(rivalJourney.startTarget)
        .lerp(rivalJourney.endTarget, targetProgress)
      temporaryUpRef.current
        .copy(rivalJourney.startUp)
        .lerp(rivalJourney.endUp, targetProgress)
        .normalize()

      camera.position.copy(temporaryPositionRef.current)
      camera.up.copy(temporaryUpRef.current)
      camera.lookAt(temporaryTargetRef.current)
      controls.target.copy(temporaryTargetRef.current)

      if (
        (rivalPresentation.phase === 'impact' ||
          rivalPresentation.phase === 'rival-focus') &&
        progress > 0.58
      ) {
        camera.fov = MathUtils.lerp(
          isNarrowPortrait(camera) ? 56 : 42,
          isNarrowPortrait(camera) ? 50 : 40,
          smoothstep((progress - 0.58) / 0.42),
        )
        camera.near = MathUtils.lerp(
          0.001,
          0.00001,
          smoothstep((progress - 0.58) / 0.42),
        )
        camera.far = MathUtils.lerp(80, 4, smoothstep((progress - 0.58) / 0.42))
        camera.updateProjectionMatrix()
      }

      updateCameraDataset(camera, controls)

      if (progress < 1) {
        state.invalidate()
      }
      return
    }

    if (phase === 'orbit' || phase === 'selected') {
      controls.update(Math.min(delta, 0.05))
      return
    }

    if (
      phase === 'landed' &&
      landingSite !== null &&
      terrain !== null &&
      outpost !== null
    ) {
      const nowMs = simulationNowMs()
      const focusKind = getSurfaceFocusKind(outpost, nowMs)

      if (focusKind !== null) {
        if (
          surfaceFocusKindRef.current === null &&
          savedSurfaceViewRef.current === null
        ) {
          savedSurfaceViewRef.current = {
            position: camera.position.clone(),
            target: controls.target.clone(),
          }
        }

        surfaceFocusKindRef.current = focusKind
        returningToSurfaceViewRef.current = false
        controls.enabled = false
        const focusPose = getSurfaceFocusPose(
          landingSite,
          terrain,
          outpost,
          focusKind,
          nowMs,
        )
        const easing = 1 - Math.exp(-Math.min(delta, 0.05) * 4.8)
        camera.position.lerp(focusPose.position, easing)
        camera.up.lerp(focusPose.up, easing).normalize()
        controls.target.lerp(focusPose.target, easing)
        camera.lookAt(controls.target)
        const focusFov = isNarrowPortrait(camera) ? 49 : 38
        const nextFov = MathUtils.damp(camera.fov, focusFov, 4.8, delta)

        if (Math.abs(nextFov - camera.fov) > 0.001) {
          camera.fov = nextFov
          camera.updateProjectionMatrix()
        }

        gl.domElement.dataset.cameraMode = `surface-focus-${focusKind}`
        updateCameraDataset(camera, controls)

        if (
          camera.position.distanceToSquared(focusPose.position) > 1e-11 ||
          controls.target.distanceToSquared(focusPose.target) > 1e-11
        ) {
          state.invalidate()
        }
        return
      }

      if (surfaceFocusKindRef.current !== null) {
        surfaceFocusKindRef.current = null
        returningToSurfaceViewRef.current = true
      }

      if (
        returningToSurfaceViewRef.current &&
        savedSurfaceViewRef.current !== null
      ) {
        const savedView = savedSurfaceViewRef.current
        const easing = 1 - Math.exp(-Math.min(delta, 0.2) * 4.2)
        camera.position.lerp(savedView.position, easing)
        controls.target.lerp(savedView.target, easing)
        camera.lookAt(controls.target)
        camera.fov = MathUtils.damp(
          camera.fov,
          isNarrowPortrait(camera) ? 54 : 42,
          4.2,
          delta,
        )
        camera.updateProjectionMatrix()
        gl.domElement.dataset.cameraMode = 'surface-returning-control'
        updateCameraDataset(camera, controls)

        if (
          camera.position.distanceToSquared(savedView.position) < 1e-11 &&
          controls.target.distanceToSquared(savedView.target) < 1e-11
        ) {
          camera.position.copy(savedView.position)
          controls.target.copy(savedView.target)
          camera.lookAt(controls.target)
          savedSurfaceViewRef.current = null
          returningToSurfaceViewRef.current = false
          controls.enabled = true
          gl.domElement.dataset.cameraMode = 'surface-player'
        } else {
          state.invalidate()
        }
        return
      }

      controls.enabled = true
      gl.domElement.dataset.cameraMode = 'surface-player'
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
      applySurfaceProjection(camera)
    }

    updateCameraDataset(camera, controls)
    state.invalidate()
  })

  return null
}
