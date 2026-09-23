import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { useDemandAnimation } from '../render/useDemandAnimation.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import type { RivalPresentationPhase } from '../app/rivalPresentation.ts'
import type { RivalStageVisualProfile } from './RivalFoothold.tsx'
import {
  CITADEL_ARRAY_PIVOT,
  CITADEL_CROWN_PIVOT,
  createCitadelFoundation,
  createCitadelGeometry,
} from './vesperCitadelGeometry.ts'
import { poseCitadelSignal, sampleCitadelSignal } from './vesperSignal.ts'

/**
 * Close rival views that the presentation clock holds still. The citadel loop
 * asks for frames only here; animated phases already render continuously and
 * orbital cameras never draw SurfaceDetail.
 */
export function citadelLoopNeedsFrames(phase: RivalPresentationPhase): boolean {
  return (
    phase === 'intro-transmission' ||
    phase === 'rival-focused' ||
    phase === 'scan-response'
  )
}

export interface VesperCitadelProps {
  readonly rival: RivalSignalSnapshot
  readonly profile: RivalStageVisualProfile
  readonly phase: RivalPresentationPhase
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  /** Render-unit height of the model origin above the site tangent plane. */
  readonly attachmentHeight: number
  /** Render units per model unit. */
  readonly visualScale: number
  readonly shadowed: boolean
}

export function VesperCitadel({
  rival,
  profile,
  phase,
  terrain,
  segments,
  attachmentHeight,
  visualScale,
  shadowed,
}: VesperCitadelProps) {
  const crownRef = useRef<Group>(null)
  const arrayRef = useRef<Group>(null)
  const beamRef = useRef<Group>(null)
  const identity = getRivalIdentity(rival.identityId)
  useDemandAnimation(citadelLoopNeedsFrames(phase))

  const parts = useMemo(() => createCitadelGeometry(profile), [profile])
  const foundation = useMemo(() => {
    // Model space is rotated by the surface heading before it meets the patch.
    const cos = Math.cos(rival.surfaceHeadingRad)
    const sin = Math.sin(rival.surfaceHeadingRad)
    const metresPerModel = visualScale / LOCAL_METRES_TO_RENDER_UNITS
    return createCitadelFoundation((x, z) => {
      const xM = (x * cos + z * sin) * metresPerModel
      const zM = (-x * sin + z * cos) * metresPerModel
      const y = sampleRenderedSurface(terrain, segments, xM, zM).y
      return (y - attachmentHeight) / visualScale
    })
  }, [attachmentHeight, rival.surfaceHeadingRad, segments, terrain, visualScale])
  const beamGeometry = useMemo(() => {
    // A narrow open wedge, pivoted at its tip so it projects from the crown.
    const geometry = new ConeGeometry(0.55, 9, 6, 1, true)
    geometry.translate(0, -4.5, 0)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])

  const materials = useMemo(() => {
    const signal = (intensity: number) =>
      new MeshStandardMaterial({
        color: '#ffffff',
        vertexColors: true,
        emissive: identity.palette.signal,
        emissiveIntensity: intensity,
        ...MATERIAL_RESPONSE.rivalPanel,
      })
    return {
      armor: new MeshStandardMaterial({
        color: '#ffffff',
        vertexColors: true,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
      core: signal(0.2),
      routing: signal(0.12),
      lamps: signal(EMISSIVE_LIMITS.panel),
      crown: signal(0.3),
      array: signal(0.2),
      beam: new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    }
  }, [identity.palette.signal])

  useEffect(
    () => () => {
      Object.values(parts).forEach((geometry) => geometry.dispose())
    },
    [parts],
  )
  useEffect(() => () => foundation.dispose(), [foundation])
  useEffect(() => () => beamGeometry.dispose(), [beamGeometry])
  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose())
    },
    [materials],
  )

  useFrame((state) => {
    const crown = crownRef.current
    const array = arrayRef.current
    const beam = beamRef.current

    if (crown === null || array === null || beam === null) return

    const signal = sampleCitadelSignal(state.clock.elapsedTime * 1_000)
    const pose = poseCitadelSignal(signal, state.clock.elapsedTime * 1_000)
    crown.rotation.y = pose.crownYaw
    array.rotation.set(pose.arrayPitch, pose.arrayYaw, 0)
    materials.core.emissiveIntensity = pose.core
    materials.routing.emissiveIntensity = pose.routing
    materials.crown.emissiveIntensity = pose.crown
    materials.array.emissiveIntensity = pose.array
    materials.beam.opacity = pose.beam
    beam.visible = pose.beam > 0.004
    beam.rotation.y = pose.crownYaw
  })

  const [crownX, crownY, crownZ] = CITADEL_CROWN_PIVOT
  return (
    <group name="vesper-citadel">
      <mesh
        geometry={foundation}
        material={materials.armor}
        receiveShadow={shadowed}
      />
      <mesh
        geometry={parts.architecture}
        material={materials.armor}
        castShadow={shadowed}
        receiveShadow={shadowed}
      />
      <mesh geometry={parts.core} material={materials.core} />
      <mesh geometry={parts.routing} material={materials.routing} />
      <mesh geometry={parts.lamps} material={materials.lamps} />
      <group ref={crownRef} name="vesper-listening-crown" position={CITADEL_CROWN_PIVOT}>
        <mesh
          geometry={parts.crown}
          material={materials.armor}
          castShadow={shadowed}
        />
        <mesh geometry={parts.crownSignal} material={materials.crown} />
      </group>
      <group ref={arrayRef} name="vesper-phased-array" position={CITADEL_ARRAY_PIVOT}>
        <mesh
          geometry={parts.array}
          material={materials.armor}
          castShadow={shadowed}
        />
        <mesh geometry={parts.arraySignal} material={materials.array} />
      </group>
      <group
        ref={beamRef}
        name="vesper-transmission"
        position={[crownX, crownY + 2.5, crownZ]}
        visible={false}
      >
        <mesh
          geometry={beamGeometry}
          material={materials.beam}
          rotation-x={-0.5}
          renderOrder={2}
        />
      </group>
    </group>
  )
}
