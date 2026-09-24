import { CAPSULE_SERVICE_ANCHOR } from './miningPresentation.ts'
import {
  CAPSULE_SCALE,
  LANDER_DOOR,
  LANDER_PAD,
  createLanderGeometry,
  rampUndersidePoints,
} from './landerModel.ts'
import { createMiningMaterial } from '../render/miningKit.ts'
import { useEffect, useMemo, useRef } from 'react'
import { Group, MathUtils } from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
} from '../render/localSurface.ts'
import { maximumRenderedSurfaceHeight, sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { DEPLOYMENT_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'

const PAD_COUNT = 4
// Grounding samples the authored lander pads, so both read one definition.
const PAD_RADIUS_MODEL = LANDER_PAD.radius
const PAD_CENTER_Y_MODEL = LANDER_PAD.centerY
const PAD_HALF_HEIGHT_MODEL = LANDER_PAD.halfHeight
const PAD_HALF_X_MODEL = LANDER_PAD.halfX
const PAD_HALF_Z_MODEL = LANDER_PAD.halfZ
const PAD_BOTTOM_Y_MODEL = PAD_CENTER_Y_MODEL - PAD_HALF_HEIGHT_MODEL
const PAD_EMBED_M = 0.008
// Leg 3's pad sits on the +Z axis beside the ramp's left lip.
const FRONT_PAD_INDEX = 3
const FRONT_PAD_RADIUS_MODEL = 0.235
const RAMP_EMBED_M = 0.006

interface CapsuleGrounding {
  readonly landedHeight: number
  readonly padOffsetsModel: readonly number[]
  readonly rampOpenAngle: number
}

interface InvasionCapsuleProps {
  readonly site: LandingSite
  readonly phase: ExperiencePhase
  readonly outpost: OutpostSnapshot | null
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  /** Kept for callers; aftermath scenes show the same hero lander. */
  readonly compact?: boolean
}

function smoothstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function rotateModelPointToSurface(
  legIndex: number,
  xModel: number,
  zModel: number,
): { readonly xM: number; readonly zM: number } {
  const angle = legIndex * (Math.PI / 2)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    xM:
      (xModel * cosine + zModel * sine) *
      (CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS),
    zM:
      (-xModel * sine + zModel * cosine) *
      (CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS),
  }
}

function padFootprintPoints(legIndex: number) {
  const points: { xM: number; zM: number }[] = []

  for (const xDirection of [-1, 1]) {
    for (const zDirection of [-1, 1]) {
      points.push(
        rotateModelPointToSurface(
          legIndex,
          PAD_RADIUS_MODEL + xDirection * PAD_HALF_X_MODEL,
          zDirection * PAD_HALF_Z_MODEL,
        ),
      )
    }
  }

  return points
}

/** Lowest render-space gap between the ramp underside and its support. */
export function rampBottomClearance(
  terrain: SurfaceTerrainProfile,
  segments: number,
  landedHeight: number,
  angle: number,
  frontPadTopModel: number,
): number {
  const frontPadTop = landedHeight + frontPadTopModel * CAPSULE_SCALE
  let clearance = Number.POSITIVE_INFINITY

  for (const point of rampUndersidePoints(angle)) {
    const surface = sampleRenderedSurface(
      terrain,
      segments,
      point.x * (CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS),
      point.z * (CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS),
    )
    let support = surface.y - RAMP_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS

    // The ramp lip may rest on the front pad, never cut into it.
    if (Math.hypot(point.x, point.z - PAD_RADIUS_MODEL) < FRONT_PAD_RADIUS_MODEL) {
      support = Math.max(support, frontPadTop)
    }

    clearance = Math.min(
      clearance,
      landedHeight + point.y * CAPSULE_SCALE - support,
    )
  }

  return clearance
}

function solveRampOpenAngle(
  terrain: SurfaceTerrainProfile,
  segments: number,
  landedHeight: number,
  frontPadTopModel: number,
): number {
  let lower = Math.PI / 2
  let upper = Math.PI - 0.1

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const middle = (lower + upper) / 2

    if (
      rampBottomClearance(
        terrain,
        segments,
        landedHeight,
        middle,
        frontPadTopModel,
      ) > 0
    ) {
      lower = middle
    } else {
      upper = middle
    }
  }

  return (lower + upper) / 2
}

export function calculateCapsuleGrounding(
  terrain: SurfaceTerrainProfile,
  segments: number,
): CapsuleGrounding {
  const padSurfaceHeights = Array.from({ length: PAD_COUNT }, (_, legIndex) =>
    maximumRenderedSurfaceHeight(
      terrain,
      segments,
      padFootprintPoints(legIndex),
    ),
  )
  const maximumPadSurface = Math.max(...padSurfaceHeights)
  const landedHeight =
    maximumPadSurface -
    PAD_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS -
    PAD_BOTTOM_Y_MODEL * CAPSULE_SCALE
  const padOffsetsModel = padSurfaceHeights.map(
    (height) => (height - maximumPadSurface) / CAPSULE_SCALE,
  )
  const frontPadTopModel =
    PAD_CENTER_Y_MODEL +
    PAD_HALF_HEIGHT_MODEL +
    (padOffsetsModel[FRONT_PAD_INDEX] ?? 0)

  return {
    landedHeight,
    padOffsetsModel,
    rampOpenAngle: solveRampOpenAngle(
      terrain,
      segments,
      landedHeight,
      frontPadTopModel,
    ),
  }
}

/** Quadratic ease-out that completes at 1 / rate of the deployment. */
export function leafOpenProgress(deployment: number, rate: number): number {
  return 1 - (1 - Math.min(1, rate * deployment)) ** 2
}

function CapsuleModel({
  outpost,
  padOffsetsModel,
  rampOpenAngle,
}: {
  readonly outpost: OutpostSnapshot | null
  readonly padOffsetsModel: readonly number[]
  readonly rampOpenAngle: number
}) {
  const rampRef = useRef<Group>(null)
  const visorRef = useRef<Group>(null)
  // One opaque draw per batch: vertex colour and miningFinish carry the
  // graphite, steel, amber, hazard and residual-heat finishes.
  const material = useMemo(() => createMiningMaterial(), [])
  const model = useMemo(
    () => createLanderGeometry(padOffsetsModel),
    [padOffsetsModel],
  )

  useEffect(() => () => material.dispose(), [material])
  useEffect(
    () => () => {
      model.hull.dispose()
      model.ramp.dispose()
      model.visor.dispose()
    },
    [model],
  )

  useFrame(() => {
    const ramp = rampRef.current
    const visor = visorRef.current

    if (ramp === null || visor === null) {
      return
    }

    let progress = 0

    if (outpost !== null) {
      if (outpost.robot.state === 'deploying') {
        progress = MathUtils.clamp(
          (simulationNowMs() - outpost.robot.stateStartedAtMs) /
            DEPLOYMENT_DURATION_MS,
          0,
          1,
        )
      } else if (outpost.robot.state !== 'stored') {
        progress = 1
      }
    }

    // Both leaves finish early in deployment, before the miner reaches the
    // garage mouth.
    ramp.rotation.x = leafOpenProgress(progress, 4) * rampOpenAngle
    visor.rotation.x =
      -leafOpenProgress(progress, 3) * LANDER_DOOR.visorOpenAngle
  })

  return (
    <group scale={CAPSULE_SCALE}>
      <mesh geometry={model.hull} material={material} castShadow receiveShadow />
      <group position={model.rampPivot} rotation-y={model.yaw}>
        <group ref={rampRef}>
          <mesh geometry={model.ramp} material={material} castShadow receiveShadow />
        </group>
      </group>
      <group position={model.visorPivot} rotation-y={model.yaw}>
        <group ref={visorRef}>
          <mesh geometry={model.visor} material={material} castShadow receiveShadow />
        </group>
      </group>
    </group>
  )
}

export function InvasionCapsule({
  site,
  phase,
  outpost,
  terrain,
  segments,
}: InvasionCapsuleProps) {
  const capsuleRef = useRef<Group>(null)
  const progressRef = useCinematicProgress()
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const grounding = useMemo(
    () => calculateCapsuleGrounding(terrain, segments),
    [segments, terrain],
  )

  useFrame(() => {
    const capsule = capsuleRef.current

    if (capsule === null) {
      return
    }

    const progress =
      outpost !== null || phase === 'landed' || phase === 'returning'
        ? 1
        : progressRef.current
    const landedHeight = grounding.landedHeight
    const descent = smoothstep(Math.max(0, Math.min(1, (progress - 0.06) / 0.8)))
    const remaining = 1 - descent
    const impactAge = Math.max(0, Math.min(1, (progress - 0.86) / 0.14))
    const bounce =
      Math.sin(impactAge * Math.PI * 4) *
      Math.exp(-impactAge * 4.5) *
      0.00028

    capsule.position.set(
      remaining * remaining * 0.026,
      MathUtils.lerp(0.19, landedHeight, descent) + bounce,
      -remaining * 0.034 + Math.sin(descent * Math.PI) * 0.005,
    )
    capsule.rotation.y = remaining * Math.PI * 6
    capsule.rotation.z = remaining * -0.2
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group ref={capsuleRef} name="player-lander">
        <group name={CAPSULE_SERVICE_ANCHOR.name} position={[
          CAPSULE_SERVICE_ANCHOR.xM * LOCAL_METRES_TO_RENDER_UNITS, 0,
          CAPSULE_SERVICE_ANCHOR.zM * LOCAL_METRES_TO_RENDER_UNITS,
        ]} />
        <CapsuleModel
          outpost={outpost}
          padOffsetsModel={grounding.padOffsetsModel}
          rampOpenAngle={grounding.rampOpenAngle}
        />
      </group>
    </group>
  )
}
