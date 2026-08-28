import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CubicBezierCurve3,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
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
  LOCAL_SURFACE_RENDER_OFFSET,
} from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { RIVAL_SURFACE_CLEARANCE } from './RivalFoothold.tsx'

const DUST_PARTICLE_COUNT = 84
const CRAFT_SCALE = LOCAL_METRES_TO_RENDER_UNITS * 1.3

interface DustCloud {
  readonly geometry: BufferGeometry
  readonly origins: Float32Array
  readonly velocities: Float32Array
}

export interface RivalRevealEffectsProps {
  readonly playerSite: LandingSite
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
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
    const speedM = 8 + random() * 18

    origins[offset] = Math.cos(angle) * radiusM
    origins[offset + 1] = 0.25 + random() * 1.4
    origins[offset + 2] = Math.sin(angle) * radiusM
    velocities[offset] = Math.cos(angle) * speedM
    velocities[offset + 1] = 5 + random() * 13
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
}: RivalRevealEffectsProps) {
  const warningRef = useRef<Group>(null)
  const warningShardRef = useRef<InstancedMesh>(null)
  const craftRef = useRef<Group>(null)
  const craftCrownRef = useRef<InstancedMesh>(null)
  const impactRef = useRef<Group>(null)
  const shockRef = useRef<InstancedMesh>(null)
  const flashRef = useRef<Group>(null)
  const scarRef = useRef<Mesh>(null)
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
          LOCAL_SURFACE_RENDER_OFFSET + 0.000016,
        ),
    [playerTransform.position, playerTransform.up],
  )
  const rivalEffectPosition = useMemo(
    () =>
      rivalTransform.position
        .clone()
        .addScaledVector(rivalTransform.up, RIVAL_SURFACE_CLEARANCE),
    [rivalTransform.position, rivalTransform.up],
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
  const craftBodyGeometry = useMemo(() => new ConeGeometry(1.38, 8.8, 3), [])
  const craftCrownGeometry = useMemo(
    () => new BoxGeometry(0.52, 3.4, 0.76),
    [],
  )
  const flashGeometry = useMemo(() => new OctahedronGeometry(1, 1), [])
  const scarGeometry = useMemo(() => new CircleGeometry(1, 28), [])
  const warningMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.signal,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const craftMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#29424d',
        emissive: identity.palette.signal,
        emissiveIntensity: 0.62,
        metalness: 0.84,
        opacity: 1,
        roughness: 0.25,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const craftEdgeMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.signal,
        depthWrite: false,
        opacity: 0.86,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const shockMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.signal,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const flashMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.highlight,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.highlight],
  )
  const scarMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: identity.palette.shadow,
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        transparent: true,
      }),
    [identity.palette.shadow],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        blending: AdditiveBlending,
        color: '#a7bbc0',
        depthWrite: false,
        opacity: 0,
        size: 0.000075,
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

      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2 + 0.22
        const radius = index % 2 === 0 ? 5.4 : 7.1
        dummy.position.set(Math.sin(angle) * radius, 0.14, Math.cos(angle) * radius)
        dummy.rotation.set(0, angle, index % 2 === 0 ? 0.22 : -0.22)
        dummy.scale.set(index % 2 === 0 ? 2.1 : 1.25, 0.12, 0.38)
        dummy.updateMatrix()
        warningShards.setMatrixAt(index, dummy.matrix)
      }

      warningShards.instanceMatrix.needsUpdate = true
    }

    if (craftCrown !== null) {
      const dummy = dummyRef.current

      for (let index = 0; index < 3; index += 1) {
        const angle = (index - 1) * 0.78
        dummy.position.set(Math.sin(angle) * 1.64, 0.75, Math.cos(angle) * 0.44)
        dummy.rotation.set(0, angle, angle * -0.28)
        dummy.scale.set(1, 0.9 + index * 0.14, 1)
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
      scarGeometry.dispose()
      dust.geometry.dispose()
      warningMaterial.dispose()
      craftMaterial.dispose()
      craftEdgeMaterial.dispose()
      shockMaterial.dispose()
      flashMaterial.dispose()
      scarMaterial.dispose()
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
      scarGeometry,
      scarMaterial,
      shardGeometry,
      shockMaterial,
      warningMaterial,
    ],
  )

  useFrame(() => {
    const nowMs = performance.now()
    const progress = getRivalPresentationProgress(presentation, nowMs)
    const warning = warningRef.current
    const craft = craftRef.current
    const impact = impactRef.current
    const shock = shockRef.current
    const flash = flashRef.current
    const scar = scarRef.current

    if (
      warning === null ||
      craft === null ||
      impact === null ||
      shock === null ||
      flash === null ||
      scar === null
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
    warning.scale.setScalar(0.84 + Math.abs(interruption) * 0.22)
    warningMaterial.opacity = warningActive
      ? (0.18 + Math.abs(interruption) * 0.34) *
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
    const craftFade =
      presentation.phase === 'impact' ? Math.max(0, 1 - progress / 0.2) : 1
    const approachScale =
      presentation.phase === 'capsule-approach'
        ? 1 +
          (1 - smoothstep((craftProgress - 0.82) / 0.18)) * 55
        : 1
    craft.scale.setScalar(CRAFT_SCALE * approachScale)
    craftMaterial.opacity = craftFade
    craftEdgeMaterial.opacity = craftFade * 0.86

    const impactState = impactSample(presentation, nowMs)
    impact.visible = impactState.visible
    const impactAge = smoothstep(impactState.age)
    const flashStrength = Math.sin(Math.min(1, impactAge * 0.92) * Math.PI)
    flash.scale.setScalar(0.8 + flashStrength * 6.2)
    flashMaterial.opacity = flashStrength * 0.92 * impactState.fade
    shockMaterial.opacity = (1 - impactAge) * 0.72 * impactState.fade
    scarMaterial.opacity = Math.min(0.64, impactAge * 0.78) *
      Math.max(0.35, impactState.fade)
    dustMaterial.opacity = Math.sin(impactAge * Math.PI) * 0.58 * impactState.fade

    const shockDummy = dummyRef.current
    const shockRadiusM = 3.2 + impactAge * 23

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2
      shockDummy.position.set(
        Math.sin(angle) * shockRadiusM,
        0.22,
        Math.cos(angle) * shockRadiusM,
      )
      shockDummy.rotation.set(0, angle, 0)
      shockDummy.scale.set(1.6 + impactAge * 1.8, 0.12, 2.8)
      shockDummy.updateMatrix()
      shock.setMatrixAt(index, shockDummy.matrix)
    }

    shock.instanceMatrix.needsUpdate = impactState.visible
    scar.scale.setScalar(3.5 + impactAge * 15.5)

    const positionAttribute = dust.geometry.getAttribute('position') as BufferAttribute
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
      <group position={playerEffectPosition} quaternion={playerTransform.orientation}>
        <group
          scale={LOCAL_METRES_TO_RENDER_UNITS}
        >
          <group ref={warningRef} name="rival-warning-disturbance">
            <instancedMesh
              ref={warningShardRef}
              args={[shardGeometry, warningMaterial, 6]}
            />
          </group>
        </group>
      </group>

      <group position={rivalTransform.position} quaternion={rivalTransform.orientation}>
        <group ref={craftRef} name="rival-insertion-craft" scale={CRAFT_SCALE}>
          <mesh
            castShadow
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

      <group position={rivalEffectPosition} quaternion={rivalTransform.orientation}>
        <group
          ref={impactRef}
          name="rival-impact-effects"
          rotation-y={rival.surfaceHeadingRad}
          scale={LOCAL_METRES_TO_RENDER_UNITS}
        >
          <mesh
            ref={scarRef}
            name="rival-impact-scar"
            geometry={scarGeometry}
            material={scarMaterial}
            position-y={0.08}
            rotation-x={-Math.PI / 2}
          />
          <instancedMesh
            ref={shockRef}
            args={[shardGeometry, shockMaterial, 8]}
          />
          <group ref={flashRef} position-y={1.1}>
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
