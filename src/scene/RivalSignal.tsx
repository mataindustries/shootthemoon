import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import {
  beginTouch,
  canSelectWithTouchGate,
  createTouchSelectionGate,
  endTouch,
  resetTouchSelectionGate,
} from '../interaction/touchSelectionGate.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'
import {
  E2E_HARNESS_BUILD_ENABLED,
  shouldEnableE2eHarness,
} from '../testing/e2eHarness.ts'

const TAP_DISTANCE_PX = 10
const SIGNAL_SURFACE_CLEARANCE = 0.00046

export interface RivalSignalProps {
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
  readonly focused: boolean
  readonly interactive: boolean
  readonly onFocus: () => void
}

function smoothPulse(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return Math.sin(clamped * Math.PI) ** 2
}

/** Samples Vesper's authored two-beat cadence without scheduling render work. */
export function sampleVesperSignalPulse(elapsedMs: number): number {
  const rhythm = getRivalIdentity('vesper').beaconRhythm
  const cycleTime =
    ((elapsedMs % rhythm.cycleDurationMs) + rhythm.cycleDurationMs) %
    rhythm.cycleDurationMs
  let pulse = 0

  for (const startMs of rhythm.pulseStartsMs) {
    const ageMs = cycleTime - startMs

    if (ageMs >= 0 && ageMs <= rhythm.pulseDurationMs) {
      pulse = Math.max(pulse, smoothPulse(ageMs / rhythm.pulseDurationMs))
    }
  }

  return pulse
}

function stageProngCount(rival: RivalSignalSnapshot): number {
  switch (rival.stage) {
    case 'FORTIFIED':
      return 3
    case 'ESTABLISHING':
      return 2
    case 'LANDED':
    case null:
      return 1
  }
}

export function RivalSignal({
  rival,
  presentation,
  focused,
  interactive,
  onFocus,
}: RivalSignalProps) {
  const signalRef = useRef<Group>(null)
  const shuttersRef = useRef<InstancedMesh>(null)
  const crownRef = useRef<InstancedMesh>(null)
  const projectedPointRef = useRef(new Vector3())
  const dummyRef = useRef(new Object3D())
  const invalidate = useThree((state) => state.invalidate)
  const gl = useThree((state) => state.gl)
  const touchSelectionGate = useMemo(createTouchSelectionGate, [])
  const transform = useMemo(
    () => landingSiteToRenderTransform(rival.site),
    [rival.site],
  )
  const position = useMemo(
    () =>
      transform.position
        .clone()
        .addScaledVector(transform.up, SIGNAL_SURFACE_CLEARANCE),
    [transform.position, transform.up],
  )
  const prongGeometry = useMemo(() => new BoxGeometry(0.15, 0.92, 0.1), [])
  const shutterGeometry = useMemo(
    () => new BoxGeometry(0.52, 0.075, 0.12),
    [],
  )
  const spearGeometry = useMemo(() => new ConeGeometry(0.17, 1.34, 3), [])
  const pulseGeometry = useMemo(() => new OctahedronGeometry(0.23, 0), [])
  const crownGeometry = useMemo(
    () => new RingGeometry(0.48, 0.62, 6, 1, 0.42, Math.PI * 1.52),
    [],
  )
  const hitGeometry = useMemo(() => new SphereGeometry(7.4, 8, 6), [])
  const structureMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        depthWrite: false,
        opacity: 0.54,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const highlightMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        depthWrite: false,
        opacity: 0.62,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const crownMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        depthWrite: false,
        opacity: 0.34,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const hitMaterial = useMemo(
    () => new MeshBasicMaterial({ visible: false }),
    [],
  )
  const isE2e = useMemo(
    () =>
      shouldEnableE2eHarness(
        E2E_HARNESS_BUILD_ENABLED,
        window.location.search,
      ),
    [],
  )

  useLayoutEffect(() => {
    const crown = crownRef.current

    if (crown === null) {
      return
    }

    const dummy = dummyRef.current
    const count = stageProngCount(rival)
    crown.count = count

    for (let index = 0; index < count; index += 1) {
      const angle = (index - (count - 1) / 2) * 0.72
      dummy.position.set(Math.sin(angle) * 0.54, 0.15, Math.cos(angle) * 0.16)
      dummy.rotation.set(-0.08, angle, angle * -0.32)
      dummy.scale.set(1, 0.82 + index * 0.14, 1)
      dummy.updateMatrix()
      crown.setMatrixAt(index, dummy.matrix)
    }

    crown.instanceMatrix.needsUpdate = true
  }, [rival])

  useEffect(() => {
    const canvas = gl.domElement
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        beginTouch(touchSelectionGate, event.pointerId)
      }
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        endTouch(touchSelectionGate, event.pointerId, performance.now())
      }
    }
    const handleWindowBlur = () => resetTouchSelectionGate(touchSelectionGate)

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('lostpointercapture', handlePointerEnd)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('lostpointercapture', handlePointerEnd)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
      window.removeEventListener('blur', handleWindowBlur)
      resetTouchSelectionGate(touchSelectionGate)
    }
  }, [gl, touchSelectionGate])

  useLayoutEffect(() => {
    resetTouchSelectionGate(touchSelectionGate)
    invalidate()
  }, [focused, interactive, invalidate, presentation.phase, touchSelectionGate])

  useEffect(
    () => () => {
      prongGeometry.dispose()
      shutterGeometry.dispose()
      spearGeometry.dispose()
      pulseGeometry.dispose()
      crownGeometry.dispose()
      hitGeometry.dispose()
      structureMaterial.dispose()
      highlightMaterial.dispose()
      crownMaterial.dispose()
      hitMaterial.dispose()

      if (isE2e) {
        delete gl.domElement.dataset.rivalSignalX
        delete gl.domElement.dataset.rivalSignalY
      }
    },
    [
      crownGeometry,
      crownMaterial,
      gl,
      highlightMaterial,
      hitGeometry,
      hitMaterial,
      isE2e,
      prongGeometry,
      pulseGeometry,
      shutterGeometry,
      spearGeometry,
      structureMaterial,
    ],
  )

  useFrame((state) => {
    const signal = signalRef.current
    const shutters = shuttersRef.current

    if (signal === null || shutters === null) {
      return
    }

    const elapsedMs = state.clock.elapsedTime * 1_000
    const beat = sampleVesperSignalPulse(elapsedMs)
    const distance = state.camera.position.distanceTo(position)
    const baseScale = Math.max(0.013, Math.min(0.023, distance * 0.0052))
    const presentationProgress = getRivalPresentationProgress(
      presentation,
      performance.now(),
    )
    const impactEmphasis =
      presentation.phase === 'impact'
        ? Math.sin(presentationProgress * Math.PI) * 0.34
        : presentation.phase === 'dual-sites'
          ? (1 - presentationProgress) * 0.12
          : 0
    signal.scale.setScalar(
      baseScale *
        (1 + beat * 0.14 + impactEmphasis) *
        (focused ? 1.18 : 1),
    )

    const dummy = dummyRef.current
    const shutterAngle = 0.12 + beat * 0.24

    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? -1 : 1
      dummy.position.set(side * 0.34, 0.32, 0)
      dummy.rotation.set(0, side * shutterAngle, side * (0.24 + beat * 0.12))
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      shutters.setMatrixAt(index, dummy.matrix)
    }

    shutters.instanceMatrix.needsUpdate = true
    highlightMaterial.opacity = 0.52 + beat * 0.18
    crownMaterial.opacity = 0.26 + beat * 0.18 + (focused ? 0.08 : 0)

    if (isE2e) {
      projectedPointRef.current.copy(position).project(state.camera)
      const canvas = state.gl.domElement
      canvas.dataset.rivalSignalX = String(
        ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
      )
      canvas.dataset.rivalSignalY = String(
        ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
      )
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    const facesCamera =
      position.dot(event.camera.position) > position.lengthSq() - 0.0004

    if (
      !interactive ||
      !facesCamera ||
      event.delta > TAP_DISTANCE_PX ||
      !canSelectWithTouchGate(touchSelectionGate, performance.now())
    ) {
      return
    }

    event.stopPropagation()
    onFocus()
  }

  return (
    <group position={position} quaternion={transform.orientation}>
      <group rotation-y={rival.surfaceHeadingRad}>
        <group
          ref={signalRef}
          name="orbital-rival-signal"
          onClick={handleClick}
        >
          <instancedMesh
            ref={crownRef}
            args={[prongGeometry, structureMaterial, 3]}
          />
          <instancedMesh
            ref={shuttersRef}
            args={[shutterGeometry, highlightMaterial, 2]}
          />
          <mesh geometry={spearGeometry} material={structureMaterial} position-y={0.68} />
          <mesh geometry={pulseGeometry} material={highlightMaterial} position-y={1.28} />
          <mesh
            geometry={crownGeometry}
            material={crownMaterial}
            position-y={0.08}
            rotation-x={Math.PI / 2}
          />
          <mesh geometry={hitGeometry} material={hitMaterial} />
        </group>
      </group>
    </group>
  )
}
