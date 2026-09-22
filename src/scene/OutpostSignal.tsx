import { useEffect, useMemo, useRef } from 'react'
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  CLAIM_HARDWARE,
  claimEmphasisPulse,
  claimFacesCamera,
  claimHardwareScale,
  claimHorizonVisibility,
  resolveClaimMarkerReadout,
} from '../render/orbitalClaimMarker.ts'
import { createClaimBeaconGeometry } from './claimBeaconGeometry.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'
import {
  E2E_HARNESS_BUILD_ENABLED,
  shouldEnableE2eHarness,
} from '../testing/e2eHarness.ts'

const TAP_DISTANCE_PX = 10
const HARDWARE = CLAIM_HARDWARE.outpost

interface OutpostSignalProps {
  readonly outpost: OutpostSnapshot
  readonly interactive?: boolean
  readonly focused: boolean
  /** Raised while the reveal is deliberately reading both claims at once. */
  readonly emphasised?: boolean
  readonly onFocus: () => void
}

export function OutpostSignal({
  outpost,
  focused,
  interactive = true,
  emphasised = false,
  onFocus,
}: OutpostSignalProps) {
  const groupRef = useRef<Group>(null)
  const beaconRef = useRef<Mesh>(null)
  const hitRef = useRef<Mesh>(null)
  const emphasisSecondsRef = useRef(0)
  const projectedPointRef = useRef(new Vector3())
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const position = useMemo(
    () => transform.position.clone().multiplyScalar(1.00038),
    [transform.position],
  )
  const hitGeometry = useMemo(() => new SphereGeometry(1, 8, 6), [])
  const hitMaterial = useMemo(
    () => new MeshBasicMaterial({ visible: false }),
    [],
  )
  const beaconGeometry = useMemo(() => createClaimBeaconGeometry('block'), [])
  const beaconMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.playerAmberEmissive,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      }),
    [],
  )
  const active = outpost.stage === 'extractor-active'
  const isE2e = useMemo(
    () =>
      shouldEnableE2eHarness(
        E2E_HARNESS_BUILD_ENABLED,
        window.location.search,
      ),
    [],
  )

  useEffect(
    () => () => {
      hitGeometry.dispose()
      hitMaterial.dispose()
      beaconGeometry.dispose()
      beaconMaterial.dispose()
    },
    [beaconGeometry, beaconMaterial, hitGeometry, hitMaterial],
  )

  useFrame((state, delta) => {
    const group = groupRef.current
    const beacon = beaconRef.current
    const hit = hitRef.current

    if (group === null || beacon === null || hit === null) {
      return
    }

    const distance = state.camera.position.distanceTo(position)
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.1) * 0.06
    const scale = claimHardwareScale(
      distance,
      HARDWARE.minimumScale,
      HARDWARE.maximumScale,
      active ? HARDWARE.activeDistanceScale : HARDWARE.idleDistanceScale,
    )
    const hardwareScale = scale * pulse * (focused ? 1.14 : 1)
    group.scale.setScalar(hardwareScale)
    group.rotation.y = state.clock.elapsedTime * (active ? 0.32 : 0.18)

    emphasisSecondsRef.current = emphasised
      ? emphasisSecondsRef.current + delta
      : 0
    const emphasis = emphasised
      ? claimEmphasisPulse(emphasisSecondsRef.current)
      : 0
    const readout = resolveClaimMarkerReadout(
      hardwareScale * HARDWARE.unitDiameter,
      {
        distance,
        verticalFovDeg: (state.camera as PerspectiveCamera).fov,
        viewportHeightPx: state.size.height,
      },
      emphasised,
    )
    const horizon = claimHorizonVisibility(position, state.camera.position)
    const beaconOpacity = readout.beaconOpacity * horizon

    beacon.visible = beaconOpacity > 0.02
    beacon.quaternion.copy(state.camera.quaternion)
    beacon.position
      .copy(transform.up)
      .multiplyScalar(readout.beaconSurfaceOffset)
    beacon.scale.setScalar(readout.beaconWorldDiameter * (1 + emphasis * 0.08))
    beaconMaterial.opacity =
      beaconOpacity * (0.62 + (focused ? 0.16 : 0) + emphasis * 0.22)

    hit.position.copy(beacon.position)
    hit.scale.setScalar(readout.touchWorldRadius)

    if (isE2e) {
      const canvas = state.gl.domElement
      projectedPointRef.current.copy(position).project(state.camera)
      canvas.dataset.outpostSignalX = String(
        ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
      )
      canvas.dataset.outpostSignalY = String(
        ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
      )
      canvas.dataset.outpostSignalPx = readout.beaconDiameterPx.toFixed(2)
      canvas.dataset.outpostSignalTouchPx = readout.touchDiameterPx.toFixed(2)
      // The drawn ring and its tap target share this anchor.
      beacon.getWorldPosition(projectedPointRef.current).project(state.camera)
      canvas.dataset.outpostBeaconX = String(
        ((projectedPointRef.current.x + 1) / 2) * canvas.clientWidth,
      )
      canvas.dataset.outpostBeaconY = String(
        ((1 - projectedPointRef.current.y) / 2) * canvas.clientHeight,
      )
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (
      !interactive ||
      !claimFacesCamera(position, event.camera.position) ||
      event.delta > TAP_DISTANCE_PX
    ) {
      return
    }

    event.stopPropagation()
    onFocus()
  }

  return (
    <group position={position} onClick={handleClick}>
      <group quaternion={transform.orientation}>
        <group ref={groupRef} name="orbital-outpost-signal">
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.72, active ? 0.085 : 0.055, 7, 28]} />
            <meshBasicMaterial
              color={
                active
                  ? VISUAL_PALETTE.playerAmberEmissive
                  : VISUAL_PALETTE.playerAmberPanel
              }
              depthWrite={false}
              opacity={active ? 0.68 : 0.52}
              transparent
            />
          </mesh>
          <mesh position-y={0.19}>
            <cylinderGeometry args={[0.06, 0.14, 0.36, 8]} />
            <meshBasicMaterial
              color={VISUAL_PALETTE.playerWarningRed}
              depthWrite={false}
              opacity={active ? 0.7 : 0.48}
              transparent
            />
          </mesh>
          {[-0.42, 0, 0.42].map((x, index) => (
            <mesh key={x} position={[x, 0.13 + index * 0.1, 0]}>
              <octahedronGeometry args={[active ? 0.14 : 0.1, 0]} />
              <meshBasicMaterial
                color={
                  index === 1
                    ? VISUAL_PALETTE.playerHotMetal
                    : VISUAL_PALETTE.playerAmberEmissive
                }
              />
            </mesh>
          ))}
          {active ? (
            <mesh position-y={0.04} rotation-x={Math.PI / 2}>
              <ringGeometry args={[0.24, 0.38, 24]} />
              <meshBasicMaterial
                color={VISUAL_PALETTE.playerHotMetal}
                depthWrite={false}
                opacity={0.44}
                transparent
              />
            </mesh>
          ) : null}
        </group>
      </group>
      <mesh
        ref={beaconRef}
        name="orbital-outpost-beacon"
        geometry={beaconGeometry}
        material={beaconMaterial}
        frustumCulled={false}
      />
      <mesh ref={hitRef} geometry={hitGeometry} material={hitMaterial} />
    </group>
  )
}
