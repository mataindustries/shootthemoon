import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { useCinematicProgress } from '../camera/CinematicClock.tsx'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { maximumRenderedSurfaceHeight, sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { DEPLOYMENT_DURATION_MS } from '../simulation/outpostSimulation.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

const CAPSULE_SCALE = 0.00029
const PAD_COUNT = 4
const PAD_RADIUS_MODEL = 1.04
const PAD_CENTER_Y_MODEL = -1.08
const PAD_HALF_HEIGHT_MODEL = 0.045
const PAD_HALF_X_MODEL = 0.24
const PAD_HALF_Z_MODEL = 0.21
const PAD_BOTTOM_Y_MODEL = PAD_CENTER_Y_MODEL - PAD_HALF_HEIGHT_MODEL
const PAD_EMBED_M = 0.008
const HATCH_HINGE_Y_MODEL = -0.42
const HATCH_HINGE_Z_MODEL = 0.6
const HATCH_LENGTH_MODEL = 0.84
const HATCH_HALF_THICKNESS_MODEL = 0.0375
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

function rampBottomClearance(
  terrain: SurfaceTerrainProfile,
  segments: number,
  landedHeight: number,
  angle: number,
): number {
  const endpointZM =
    (HATCH_HINGE_Z_MODEL - HATCH_LENGTH_MODEL * Math.sin(angle)) *
    (CAPSULE_SCALE / LOCAL_METRES_TO_RENDER_UNITS)
  const endpointSurface = sampleRenderedSurface(terrain, segments, 0, endpointZM)
  const endpointBottom =
    landedHeight +
    (HATCH_HINGE_Y_MODEL +
      HATCH_LENGTH_MODEL * Math.cos(angle) -
      HATCH_HALF_THICKNESS_MODEL * Math.sin(angle)) *
      CAPSULE_SCALE

  return endpointBottom - (endpointSurface.y - RAMP_EMBED_M * LOCAL_METRES_TO_RENDER_UNITS)
}

function solveRampOpenAngle(
  terrain: SurfaceTerrainProfile,
  segments: number,
  landedHeight: number,
): number {
  let lower = Math.PI / 2
  let upper = Math.PI - 0.04

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const middle = (lower + upper) / 2

    if (rampBottomClearance(terrain, segments, landedHeight, middle) > 0) {
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

  return {
    landedHeight,
    padOffsetsModel: padSurfaceHeights.map(
      (height) => (height - maximumPadSurface) / CAPSULE_SCALE,
    ),
    rampOpenAngle: solveRampOpenAngle(terrain, segments, landedHeight),
  }
}

function CapsuleLandingGear({
  padOffsetsModel,
}: {
  readonly padOffsetsModel: readonly number[]
}) {
  const strutRef = useRef<InstancedMesh>(null)
  const padRef = useRef<InstancedMesh>(null)
  const lightRef = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const strutMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerSteel,
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [],
  )
  const padMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.contactDark,
        ...MATERIAL_RESPONSE.contact,
      }),
    [],
  )
  const lightMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.panel,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )

  useLayoutEffect(() => {
    const struts = strutRef.current
    const pads = padRef.current
    const lights = lightRef.current

    if (struts === null || pads === null || lights === null) {
      return
    }

    const root = new Object3D()
    const part = new Object3D()
    const strutDefinitions = [
      {
        position: [0.49, -0.47, 0] as const,
        rotationZ: -0.43,
        scale: [0.54, 0.13, 0.15] as const,
      },
      {
        position: [0.79, -0.82, 0] as const,
        rotationZ: -0.2,
        scale: [0.5, 0.11, 0.14] as const,
      },
      {
        position: [0.7, -0.68, 0] as const,
        rotationZ: -0.05,
        scale: [0.1, 0.48, 0.1] as const,
      },
      {
        position: [0.86, -0.85, 0] as const,
        rotationZ: 0.64,
        scale: [0.32, 0.075, 0.08] as const,
      },
    ]
    let strutIndex = 0

    for (let legIndex = 0; legIndex < 4; legIndex += 1) {
      const rotationY = legIndex * (Math.PI / 2)
      root.rotation.set(0, rotationY, 0)
      root.updateMatrixWorld(true)

      const padOffsetModel = padOffsetsModel[legIndex] ?? 0

      strutDefinitions.forEach((definition, definitionIndex) => {
        const telescoping = definitionIndex === 2
        const followsPad = definitionIndex === 3
        const partialFollow = definitionIndex === 1 ? 0.35 : 0
        part.position.set(
          definition.position[0],
          definition.position[1] +
            (telescoping ? padOffsetModel / 2 : 0) +
            (followsPad ? padOffsetModel : padOffsetModel * partialFollow),
          definition.position[2],
        )
        part.rotation.set(0, 0, definition.rotationZ)
        part.scale.set(
          definition.scale[0],
          definition.scale[1] - (telescoping ? padOffsetModel : 0),
          definition.scale[2],
        )
        root.add(part)
        part.updateMatrixWorld(true)
        struts.setMatrixAt(strutIndex, part.matrixWorld)
        root.remove(part)
        strutIndex += 1
      })

      part.position.set(
        PAD_RADIUS_MODEL,
        PAD_CENTER_Y_MODEL + padOffsetModel,
        0,
      )
      part.rotation.set(0, 0, 0)
      part.scale.set(0.48, 0.09, 0.42)
      root.add(part)
      part.updateMatrixWorld(true)
      pads.setMatrixAt(legIndex, part.matrixWorld)
      root.remove(part)

      part.position.set(0.61, -0.43, 0.12)
      part.scale.set(0.13, 0.045, 0.05)
      root.add(part)
      part.updateMatrixWorld(true)
      lights.setMatrixAt(legIndex, part.matrixWorld)
      root.remove(part)
    }

    struts.instanceMatrix.needsUpdate = true
    pads.instanceMatrix.needsUpdate = true
    lights.instanceMatrix.needsUpdate = true
  }, [padOffsetsModel])

  useEffect(
    () => () => {
      geometry.dispose()
      strutMaterial.dispose()
      padMaterial.dispose()
      lightMaterial.dispose()
    },
    [geometry, lightMaterial, padMaterial, strutMaterial],
  )

  return (
    <>
      <instancedMesh
        ref={strutRef}
        args={[geometry, strutMaterial, 16]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={padRef}
        args={[geometry, padMaterial, 4]}
        castShadow
        receiveShadow
      />
      <instancedMesh ref={lightRef} args={[geometry, lightMaterial, 4]} />
    </>
  )
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
  const hatchRef = useRef<Group>(null)
  const detailRef = useRef<InstancedMesh>(null)
  const beltRef = useRef<InstancedMesh>(null)
  const bayMaterialRef = useRef<MeshStandardMaterial>(null)
  const rampLightRef = useRef<MeshStandardMaterial>(null)
  const boxGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const beltGeometry = useMemo(() => new TorusGeometry(0.5, 0.04, 6, 16), [])
  const armorMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [],
  )
  const steelMaterial = useMemo(
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
  const beltMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )

  useLayoutEffect(() => {
    const details = detailRef.current
    const belts = beltRef.current

    if (details === null || belts === null) {
      return
    }

    const dummy = new Object3D()
    let detailIndex = 0

    for (let panelIndex = 0; panelIndex < 4; panelIndex += 1) {
      const angle = panelIndex * (Math.PI / 2)
      dummy.position.set(Math.sin(angle) * 0.515, 0.27, Math.cos(angle) * 0.515)
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(0.28, 0.8, 0.045)
      dummy.updateMatrix()
      details.setMatrixAt(detailIndex, dummy.matrix)
      detailIndex += 1
    }

    const frameParts = [
      { position: [-0.36, 0.02, 0.55] as const, scale: [0.07, 0.88, 0.08] as const },
      { position: [0.36, 0.02, 0.55] as const, scale: [0.07, 0.88, 0.08] as const },
      { position: [0, 0.47, 0.55] as const, scale: [0.78, 0.07, 0.08] as const },
      { position: [0, -0.45, 0.55] as const, scale: [0.78, 0.08, 0.08] as const },
      { position: [0, 0.58, -0.51] as const, scale: [0.48, 0.07, 0.055] as const },
      { position: [0, 0.39, -0.53] as const, scale: [0.42, 0.055, 0.05] as const },
      { position: [0, 0.2, -0.54] as const, scale: [0.36, 0.045, 0.045] as const },
      { position: [0, -0.64, 0] as const, scale: [0.86, 0.08, 0.86] as const },
    ]

    for (const definition of frameParts) {
      dummy.position.set(
        definition.position[0],
        definition.position[1],
        definition.position[2],
      )
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(
        definition.scale[0],
        definition.scale[1],
        definition.scale[2],
      )
      dummy.updateMatrix()
      details.setMatrixAt(detailIndex, dummy.matrix)
      detailIndex += 1
    }

    details.instanceMatrix.needsUpdate = true

    const beltDefinitions = [
      { positionY: 0.48, scale: 1.02 },
      { positionY: -0.43, scale: 1.08 },
    ]

    beltDefinitions.forEach((definition, index) => {
      dummy.position.set(0, definition.positionY, 0)
      dummy.rotation.set(Math.PI / 2, 0, 0)
      dummy.scale.setScalar(definition.scale)
      dummy.updateMatrix()
      belts.setMatrixAt(index, dummy.matrix)
    })
    belts.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      boxGeometry.dispose()
      beltGeometry.dispose()
      armorMaterial.dispose()
      steelMaterial.dispose()
      heatMaterial.dispose()
      beltMaterial.dispose()
    },
    [
      armorMaterial,
      beltGeometry,
      beltMaterial,
      boxGeometry,
      heatMaterial,
      steelMaterial,
    ],
  )

  useFrame((state) => {
    const hatch = hatchRef.current
    const bayMaterial = bayMaterialRef.current
    const rampLight = rampLightRef.current

    if (hatch === null) {
      return
    }

    let progress = 0

    if (outpost !== null) {
      if (outpost.robot.state === 'deploying') {
        progress = Math.max(
          0,
          Math.min(
            1,
            (simulationNowMs() - outpost.robot.stateStartedAtMs) /
              DEPLOYMENT_DURATION_MS,
          ),
        )
      } else if (outpost.robot.state !== 'stored') {
        progress = 1
      }
    }

    const eased = progress * progress * (3 - 2 * progress)
    hatch.rotation.x = -eased * rampOpenAngle

    if (bayMaterial !== null) {
      bayMaterial.emissiveIntensity =
        EMISSIVE_LIMITS.panel + Math.sin(state.clock.elapsedTime * 3.2) * 0.035
    }

    if (rampLight !== null) {
      rampLight.emissiveIntensity = Math.min(
        EMISSIVE_LIMITS.activePanel,
        0.24 + eased * 0.24,
      )
    }
  })

  return (
    <group scale={CAPSULE_SCALE}>
      <mesh castShadow receiveShadow material={armorMaterial}>
        <cylinderGeometry args={[0.46, 0.58, 1.42, 12, 2]} />
      </mesh>
      <mesh castShadow position-y={1.03} receiveShadow material={armorMaterial}>
        <coneGeometry args={[0.45, 0.76, 12, 2]} />
      </mesh>
      <mesh castShadow position-y={-0.82} rotation-z={Math.PI} material={heatMaterial}>
        <coneGeometry args={[0.42, 0.46, 12, 1, true]} />
      </mesh>
      <instancedMesh
        ref={detailRef}
        args={[boxGeometry, steelMaterial, 12]}
        castShadow
        receiveShadow
      />
      <instancedMesh ref={beltRef} args={[beltGeometry, beltMaterial, 2]} />

      <mesh position={[0, 0.01, 0.535]}>
        <boxGeometry args={[0.65, 0.84, 0.06]} />
        <meshStandardMaterial
          ref={bayMaterialRef}
          color={VISUAL_PALETTE.playerHeatDark}
          emissive={VISUAL_PALETTE.playerAmberEmissive}
          emissiveIntensity={EMISSIVE_LIMITS.panel}
          {...MATERIAL_RESPONSE.playerHeatDark}
        />
      </mesh>
      <group ref={hatchRef} position={[0, -0.42, 0.6]}>
        <mesh castShadow position-y={0.42} receiveShadow material={armorMaterial}>
          <boxGeometry args={[0.74, 0.84, 0.075]} />
        </mesh>
        <mesh position={[0, 0.42, 0.041]}>
          <boxGeometry args={[0.52, 0.06, 0.018]} />
          <meshStandardMaterial
            ref={rampLightRef}
            color={VISUAL_PALETTE.playerAmberPanel}
            emissive={VISUAL_PALETTE.playerAmberEmissive}
            emissiveIntensity={0.24}
            {...MATERIAL_RESPONSE.playerHeatDark}
          />
        </mesh>
      </group>

      <CapsuleLandingGear padOffsetsModel={padOffsetsModel} />

      <mesh position-y={-1.04} rotation-z={Math.PI} material={heatMaterial}>
        <cylinderGeometry args={[0.12, 0.28, 0.34, 10, 1, true]} />
      </mesh>
      <mesh position-y={-1.08} rotation-z={Math.PI}>
        <cylinderGeometry args={[0.075, 0.1, 0.08, 10]} />
        <meshStandardMaterial
          color={VISUAL_PALETTE.playerHotMetal}
          emissive={VISUAL_PALETTE.playerAmberEmissive}
          emissiveIntensity={EMISSIVE_LIMITS.panel}
          metalness={0.34}
          roughness={0.62}
          side={DoubleSide}
        />
      </mesh>
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
    const descent = smoothstep(Math.max(0, Math.min(1, (progress - 0.06) / 0.8)))
    const remaining = 1 - descent
    const impactAge = Math.max(0, Math.min(1, (progress - 0.86) / 0.14))
    const bounce =
      Math.sin(impactAge * Math.PI * 4) *
      Math.exp(-impactAge * 4.5) *
      0.00028

    capsule.position.set(
      remaining * remaining * 0.026,
      MathUtils.lerp(0.19, grounding.landedHeight, descent) + bounce,
      -remaining * 0.034 + Math.sin(descent * Math.PI) * 0.005,
    )
    capsule.rotation.y = remaining * Math.PI * 6
    capsule.rotation.z = remaining * -0.2
  })

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group ref={capsuleRef}>
        <CapsuleModel
          outpost={outpost}
          padOffsetsModel={grounding.padOffsetsModel}
          rampOpenAngle={grounding.rampOpenAngle}
        />
      </group>
    </group>
  )
}
