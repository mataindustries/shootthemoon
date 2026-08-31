import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CubicBezierCurve3,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PointsMaterial,
  Vector3,
} from 'three'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
} from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import { createRivalSurfaceAttachment } from './RivalFoothold.tsx'

const DUST_PARTICLE_COUNT = 68
const CRAFT_SCALE = LOCAL_METRES_TO_RENDER_UNITS * 1.3
const IMPACT_FRAGMENT_COUNT = 8

interface DustCloud {
  readonly geometry: BufferGeometry
  readonly origins: Float32Array
  readonly velocities: Float32Array
}

export interface RivalRevealEffectsProps {
  readonly playerSite: LandingSite
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
  readonly playerTerrain: SurfaceTerrainProfile
  readonly playerTerrainSegments: number
  readonly rivalTerrain: SurfaceTerrainProfile
  readonly rivalTerrainSegments: number
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function createDustCloud(site: LandingSite): DustCloud {
  const seed =
    (Math.round(site.location.latitudeRad * 10_000_000) ^
      Math.round(site.location.longitudeRad * 10_000_000) ^
      0x0e5e_9a11) >>>
    0
  const random = createRandom(seed)
  const origins = new Float32Array(DUST_PARTICLE_COUNT * 3)
  const velocities = new Float32Array(DUST_PARTICLE_COUNT * 3)
  const positions = new Float32Array(DUST_PARTICLE_COUNT * 3)

  for (let index = 0; index < DUST_PARTICLE_COUNT; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2
    const radiusM = 0.8 + random() * 3.8
    const speedM = 7 + random() * 16

    origins[offset] = Math.cos(angle) * radiusM
    origins[offset + 1] = 0.2 + random() * 1.1
    origins[offset + 2] = Math.sin(angle) * radiusM
    velocities[offset] = Math.cos(angle) * speedM
    velocities[offset + 1] = 4 + random() * 11
    velocities[offset + 2] = Math.sin(angle) * speedM
    positions[offset] = origins[offset] ?? 0
    positions[offset + 1] = origins[offset + 1] ?? 0
    positions[offset + 2] = origins[offset + 2] ?? 0
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()

  return { geometry, origins, velocities }
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function impactSample(
  presentation: RivalPresentationState,
  nowMs: number,
): { age: number; fade: number; visible: boolean } {
  if (presentation.phase === 'impact') {
    const progress = getRivalPresentationProgress(presentation, nowMs)
    return { age: progress, fade: 1, visible: true }
  }

  if (presentation.phase === 'intro-transmission') {
    const progress = getRivalPresentationProgress(presentation, nowMs)
    return {
      age: 1,
      fade: Math.max(0, 1 - progress * 4.5),
      visible: progress < 0.23,
    }
  }

  return { age: 0, fade: 0, visible: false }
}

export function RivalRevealEffects({
  playerSite,
  rival,
  presentation,
  playerTerrain,
  playerTerrainSegments,
  rivalTerrain,
  rivalTerrainSegments,
}: RivalRevealEffectsProps) {
  const warningRef = useRef<Group>(null)
  const warningShardRef = useRef<InstancedMesh>(null)
  const craftRef = useRef<Group>(null)
  const craftBodyRef = useRef<Mesh>(null)
  const craftCrownRef = useRef<InstancedMesh>(null)
  const impactRef = useRef<Group>(null)
  const fragmentRef = useRef<InstancedMesh>(null)
  const flashRef = useRef<Group>(null)
  const dummyRef = useRef(new Object3D())
  const temporaryPositionRef = useRef(new Vector3())
  const playerTransform = useMemo(
    () => landingSiteToRenderTransform(playerSite),
    [playerSite],
  )
  const rivalTransform = useMemo(
    () => landingSiteToRenderTransform(rival.site),
    [rival.site],
  )
  const playerEffectPosition = useMemo(
    () =>
      playerTransform.position
        .clone()
        .addScaledVector(
          playerTransform.up,
          sampleRenderedSurface(
            playerTerrain,
            playerTerrainSegments,
            0,
            0,
          ).y + 0.000016,
        ),
    [
      playerTerrain,
      playerTerrainSegments,
      playerTransform.position,
      playerTransform.up,
    ],
  )
  const rivalEffectPosition = useMemo(
    () =>
      createRivalSurfaceAttachment(
        rival.site,
        rivalTerrain,
        rivalTerrainSegments,
      ).position,
    [rival.site, rivalTerrain, rivalTerrainSegments],
  )
  const identity = getRivalIdentity(rival.identityId)
  const craftPath = useMemo(
    () =>
      new CubicBezierCurve3(
        new Vector3(-0.025, 0.032, -0.018),
        new Vector3(-0.015, 0.018, -0.012),
        new Vector3(0.007, 0.007, -0.004),
        new Vector3(0, 4.45 * CRAFT_SCALE, 0),
      ),
    [],
  )
  const dust = useMemo(() => createDustCloud(rival.site), [rival.site])

  const shardGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const craftBodyGeometry = useMemo(() => new ConeGeometry(1.38, 8.8, 5), [])
  const craftCrownGeometry = useMemo(
    () => new BoxGeometry(0.38, 3.6, 0.68),
    [],
  )
  const flashGeometry = useMemo(() => new OctahedronGeometry(1, 1), [])

  const warningMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        depthWrite: false,
        emissive: identity.palette.signal,
        emissiveIntensity: 0.26,
        opacity: 0,
        roughness: 0.62,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const craftMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalSkeleton,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
    [],
  )
  const craftEdgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        emissive: identity.palette.signal,
        emissiveIntensity: 0.28,
        ...MATERIAL_RESPONSE.rivalPanel,
      }),
    [identity.palette.signal],
  )
  const fragmentMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.lunarShadow,
        depthWrite: false,
        opacity: 0,
        roughness: 0.96,
        transparent: true,
      }),
    [],
  )
  const flashMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalHighlight,
        depthWrite: false,
        emissive: VISUAL_PALETTE.rivalCyanEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.activePanel,
        opacity: 0,
        roughness: 0.38,
        transparent: true,
      }),
    [],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.lunarMid,
        depthWrite: false,
        opacity: 0,
        size: 0.000065,
        sizeAttenuation: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const warningShards = warningShardRef.current
    const craftCrown = craftCrownRef.current

    if (warningShards !== null) {
      const dummy = dummyRef.current
      const angles = [0.28, 1.18, 2.34, 3.26, 4.58, 5.72]
      const radii = [5.2, 7.25, 5.86, 7.62, 6.35, 5.45]

      for (let index = 0; index < angles.length; index += 1) {
        const angle = angles[index] ?? 0
        const radius = radii[index] ?? 6
        dummy.position.set(
          Math.sin(angle) * radius,
          0.14 + (index % 2) * 0.06,
          Math.cos(angle) * radius,
        )
        dummy.rotation.set(0, angle, index % 2 === 0 ? 0.18 : -0.12)
        dummy.scale.set(
          index % 2 === 0 ? 1.65 : 1.08,
          0.09,
          0.24 + (index % 3) * 0.05,
        )
        dummy.updateMatrix()
        warningShards.setMatrixAt(index, dummy.matrix)
      }

      warningShards.instanceMatrix.needsUpdate = true
    }

    if (craftCrown !== null) {
      const dummy = dummyRef.current

      for (let index = 0; index < 3; index += 1) {
        const angle = [-0.72, 0.08, 0.84][index] ?? 0
        dummy.position.set(
          Math.sin(angle) * 1.52,
          0.48 + index * 0.34,
          Math.cos(angle) * 0.4,
        )
        dummy.rotation.set(0, angle, angle * -0.24)
        dummy.scale.set(1, 0.84 + index * 0.12, 1)
        dummy.updateMatrix()
        craftCrown.setMatrixAt(index, dummy.matrix)
      }

      craftCrown.instanceMatrix.needsUpdate = true
    }
  }, [])

  useEffect(
    () => () => {
      shardGeometry.dispose()
      craftBodyGeometry.dispose()
      craftCrownGeometry.dispose()
      flashGeometry.dispose()
      dust.geometry.dispose()
      warningMaterial.dispose()
      craftMaterial.dispose()
      craftEdgeMaterial.dispose()
      fragmentMaterial.dispose()
      flashMaterial.dispose()
      dustMaterial.dispose()
    },
    [
      craftBodyGeometry,
      craftCrownGeometry,
      craftEdgeMaterial,
      craftMaterial,
      dust,
      dustMaterial,
      flashGeometry,
      flashMaterial,
      fragmentMaterial,
      shardGeometry,
      warningMaterial,
    ],
  )

  useFrame(() => {
    const nowMs = performance.now()
    const progress = getRivalPresentationProgress(presentation, nowMs)
    const warning = warningRef.current
    const craft = craftRef.current
    const craftBody = craftBodyRef.current
    const impact = impactRef.current
    const fragments = fragmentRef.current
    const flash = flashRef.current

    if (
      warning === null ||
      craft === null ||
      craftBody === null ||
      impact === null ||
      fragments === null ||
      flash === null
    ) {
      return
    }

    const warningActive =
      presentation.phase === 'warning' ||
      (presentation.phase === 'orbital-transition' && progress < 0.16)
    const warningProgress =
      presentation.phase === 'warning'
        ? progress
        : Math.max(0, 1 - progress / 0.16)
    const interruption =
      Math.sin(warningProgress * Math.PI * 9) * 0.5 +
      Math.sin(warningProgress * Math.PI * 3.4) * 0.5
    warning.visible = warningActive
    warning.rotation.y = warningProgress * 0.52
    warning.scale.setScalar(0.9 + Math.abs(interruption) * 0.12)
    warningMaterial.opacity = warningActive
      ? (0.12 + Math.abs(interruption) * 0.2) *
        (presentation.phase === 'warning' ? 1 : warningProgress)
      : 0

    const craftActive =
      presentation.phase === 'capsule-approach' ||
      (presentation.phase === 'impact' && progress < 0.2)
    const craftProgress =
      presentation.phase === 'capsule-approach' ? smoothstep(progress) : 1
    craft.visible = craftActive
    craftPath.getPoint(craftProgress, temporaryPositionRef.current)
    craft.position.copy(temporaryPositionRef.current)
    craft.rotation.set(
      0.14 * (1 - craftProgress),
      rival.surfaceHeadingRad + craftProgress * 0.28,
      -0.48 * (1 - craftProgress),
    )
    const distanceReadabilityScale =
      presentation.phase === 'capsule-approach'
        ? 1 + (1 - smoothstep((craftProgress - 0.7) / 0.3)) * 18
        : 1
    const settlingScale =
      presentation.phase === 'impact'
        ? 1 - smoothstep(progress / 0.2) * 0.18
        : 1
    craft.scale.setScalar(
      CRAFT_SCALE * distanceReadabilityScale * settlingScale,
    )
    craftBody.castShadow = craftProgress > 0.94

    const impactState = impactSample(presentation, nowMs)
    impact.visible = impactState.visible
    const impactAge = smoothstep(impactState.age)
    const flashCycle = Math.min(1, impactAge * 3.4)
    const flashStrength = Math.sin(flashCycle * Math.PI)
    flash.scale.setScalar(0.7 + flashStrength * 3.1)
    flashMaterial.opacity = flashStrength * 0.5 * impactState.fade
    fragmentMaterial.opacity =
      Math.sin(impactAge * Math.PI) * 0.52 * impactState.fade
    dustMaterial.opacity =
      Math.sin(impactAge * Math.PI) * 0.42 * impactState.fade

    const fragmentDummy = dummyRef.current
    const fragmentAngles = [0.16, 0.92, 1.84, 2.58, 3.42, 4.18, 5.06, 5.78]
    const fragmentRanges = [8.2, 12.5, 9.6, 14.2, 10.8, 13.4, 8.9, 11.7]

    for (let index = 0; index < IMPACT_FRAGMENT_COUNT; index += 1) {
      const angle = fragmentAngles[index] ?? 0
      const range = fragmentRanges[index] ?? 10
      const radiusM = 2.2 + impactAge * range
      const lift =
        0.14 +
        Math.sin(impactAge * Math.PI) * (0.26 + (index % 3) * 0.16)
      fragmentDummy.position.set(
        Math.sin(angle) * radiusM,
        lift,
        Math.cos(angle) * radiusM,
      )
      fragmentDummy.rotation.set(
        index * 0.11,
        angle + index * 0.04,
        index % 2 === 0 ? 0.16 : -0.12,
      )
      fragmentDummy.scale.set(
        0.72 + (index % 3) * 0.28,
        0.08 + impactAge * 0.08,
        0.78 + (index % 2) * 0.42,
      )
      fragmentDummy.updateMatrix()
      fragments.setMatrixAt(index, fragmentDummy.matrix)
    }

    fragments.instanceMatrix.needsUpdate = impactState.visible

    const positionAttribute = dust.geometry.getAttribute(
      'position',
    ) as BufferAttribute
    const positions = positionAttribute.array as Float32Array

    for (let index = 0; index < DUST_PARTICLE_COUNT; index += 1) {
      const offset = index * 3
      const originX = dust.origins[offset] ?? 0
      const originY = dust.origins[offset + 1] ?? 0
      const originZ = dust.origins[offset + 2] ?? 0
      const velocityX = dust.velocities[offset] ?? 0
      const velocityY = dust.velocities[offset + 1] ?? 0
      const velocityZ = dust.velocities[offset + 2] ?? 0
      const flightTime = impactAge * 0.82
      positions[offset] = originX + velocityX * flightTime
      positions[offset + 1] = Math.max(
        0.12,
        originY + velocityY * flightTime - 18 * flightTime * flightTime,
      )
      positions[offset + 2] = originZ + velocityZ * flightTime
    }

    positionAttribute.needsUpdate = impactState.visible
  })

  return (
    <>
      <group
        position={playerEffectPosition}
        quaternion={playerTransform.orientation}
      >
        <group scale={LOCAL_METRES_TO_RENDER_UNITS}>
          <group ref={warningRef} name="rival-warning-disturbance">
            <instancedMesh
              ref={warningShardRef}
              args={[shardGeometry, warningMaterial, 6]}
            />
          </group>
        </group>
      </group>

      <group
        position={rivalTransform.position}
        quaternion={rivalTransform.orientation}
      >
        <group ref={craftRef} name="rival-insertion-craft" scale={CRAFT_SCALE}>
          <mesh
            ref={craftBodyRef}
            geometry={craftBodyGeometry}
            material={craftMaterial}
            rotation-z={Math.PI}
          />
          <instancedMesh
            ref={craftCrownRef}
            args={[craftCrownGeometry, craftEdgeMaterial, 3]}
          />
        </group>
      </group>

      <group
        position={rivalEffectPosition}
        quaternion={rivalTransform.orientation}
      >
        <group
          ref={impactRef}
          name="rival-impact-effects"
          rotation-y={rival.surfaceHeadingRad}
          scale={LOCAL_METRES_TO_RENDER_UNITS}
        >
          <instancedMesh
            ref={fragmentRef}
            args={[shardGeometry, fragmentMaterial, IMPACT_FRAGMENT_COUNT]}
          />
          <group ref={flashRef} position-y={0.92}>
            <mesh geometry={flashGeometry} material={flashMaterial} />
          </group>
          <points
            frustumCulled={false}
            geometry={dust.geometry}
            material={dustMaterial}
          />
        </group>
      </group>
    </>
  )
}
