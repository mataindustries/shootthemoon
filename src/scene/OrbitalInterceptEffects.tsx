import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { CounterstrikeRunState } from '../simulation/counterstrikeSimulation.ts'
import { getCounterstrikeRunProgress } from '../simulation/counterstrikeSimulation.ts'
import { createCounterstrikeRoute } from '../camera/counterstrikeRoute.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

interface OrbitalInterceptEffectsProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly secondaryImpactSite: LandingSite
  readonly run: CounterstrikeRunState
}

interface InterceptedThreatRecordProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly secondaryImpactSite: LandingSite
  readonly interceptProgress?: number
}

const FRAGMENT_COUNT = 18
const DEBRIS_POINT_COUNT = 26
const TRAIL_POINT_COUNT = 12

function seededDirection(index: number): Vector3 {
  const angle = index * 2.399963229728653
  const vertical = -0.62 + ((index * 7) % 17) / 14
  return new Vector3(
    Math.cos(angle) * (0.55 + (index % 4) * 0.13),
    vertical,
    Math.sin(angle) * (0.55 + ((index + 2) % 5) * 0.1),
  ).normalize()
}

function createDebrisGeometry(count: number, radius = 1): BufferGeometry {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const direction = seededDirection(index)
    const spread = radius * (0.28 + ((index * 11) % 19) / 20)
    positions[index * 3] = direction.x * spread
    positions[index * 3 + 1] = direction.y * spread
    positions[index * 3 + 2] = direction.z * spread
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function OrbitalInterceptEffects({
  playerSite,
  rivalSite,
  secondaryImpactSite,
  run,
}: OrbitalInterceptEffectsProps) {
  const rootRef = useRef<Group>(null)
  const flashRef = useRef<Mesh>(null)
  const ringRef = useRef<Mesh>(null)
  const fragmentsRef = useRef<InstancedMesh>(null)
  const debrisRef = useRef<Points>(null)
  const trailsRef = useRef<Points>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const route = useMemo(
    () => createCounterstrikeRoute(playerSite, rivalSite, secondaryImpactSite),
    [playerSite, rivalSite, secondaryImpactSite],
  )
  const interceptProgress = run.interceptRouteProgress ?? 0.7
  const interceptPoint = useMemo(
    () => route.getRenderPoint(interceptProgress),
    [interceptProgress, route],
  )
  const flashGeometry = useMemo(() => new SphereGeometry(1, 12, 8), [])
  const ringGeometry = useMemo(() => new RingGeometry(0.82, 1, 32), [])
  const fragmentGeometry = useMemo(() => new BoxGeometry(1, 0.34, 0.24), [])
  const debrisGeometry = useMemo(
    () => createDebrisGeometry(DEBRIS_POINT_COUNT),
    [],
  )
  const trailGeometry = useMemo(
    () => createDebrisGeometry(TRAIL_POINT_COUNT, 0.72),
    [],
  )
  const flashMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#d8ffff',
        depthWrite: false,
        opacity: 0.82,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const ringMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        depthWrite: false,
        opacity: 0.46,
        side: 2,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const fragmentMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalFrame,
        metalness: 0.34,
        roughness: 0.64,
      }),
    [],
  )
  const debrisMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.rivalHighlight,
        depthWrite: false,
        opacity: 0.68,
        size: 0.008,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const trailMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.playerHotMetal,
        depthWrite: false,
        opacity: 0.42,
        size: 0.005,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const fragments = fragmentsRef.current
    if (fragments === null) return
    const dummy = dummyRef.current
    for (let index = 0; index < FRAGMENT_COUNT; index += 1) {
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(index * 0.31, index * 0.57, index * 0.23)
      dummy.scale.set(
        0.54 + (index % 4) * 0.18,
        0.48 + (index % 3) * 0.12,
        0.46,
      )
      dummy.updateMatrix()
      fragments.setMatrixAt(index, dummy.matrix)
    }
    fragments.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      flashGeometry.dispose()
      ringGeometry.dispose()
      fragmentGeometry.dispose()
      debrisGeometry.dispose()
      trailGeometry.dispose()
      flashMaterial.dispose()
      ringMaterial.dispose()
      fragmentMaterial.dispose()
      debrisMaterial.dispose()
      trailMaterial.dispose()
      delete gl.domElement.dataset.counterstrikeEffect
    }, [
      debrisGeometry,
      debrisMaterial,
      flashGeometry,
      flashMaterial,
      fragmentGeometry,
      fragmentMaterial,
      gl,
      ringGeometry,
      ringMaterial,
      trailGeometry,
      trailMaterial,
    ],
  )

  useFrame((state) => {
    const root = rootRef.current
    const flash = flashRef.current
    const ring = ringRef.current
    const fragments = fragmentsRef.current
    const debris = debrisRef.current
    const trails = trailsRef.current
    if (
      root === null || flash === null || ring === null || fragments === null ||
      debris === null || trails === null
    ) return

    const progress = getCounterstrikeRunProgress(run, performance.now())
    const expansion = 0.018 + progress * 0.11
    root.position.copy(interceptPoint)
    flash.scale.setScalar(0.024 * (1 + progress * 1.7))
    flashMaterial.opacity = Math.max(0, 0.86 - progress * 1.4)
    ring.scale.setScalar(0.028 + progress * 0.15)
    ring.quaternion.copy(state.camera.quaternion)
    ringMaterial.opacity = Math.max(0, 0.5 - progress * 0.42)

    const dummy = dummyRef.current
    for (let index = 0; index < FRAGMENT_COUNT; index += 1) {
      const direction = seededDirection(index)
      const fall = index % 4 === 0 ? progress * progress * -0.05 : 0
      dummy.position.copy(direction).multiplyScalar(
        expansion * (0.42 + (index % 5) * 0.13),
      )
      dummy.position.y += fall
      dummy.rotation.set(
        index * 0.31 + progress * (2.4 + (index % 3)),
        index * 0.57 + progress * 3.1,
        index * 0.23 + progress * 1.8,
      )
      dummy.scale.setScalar(0.0024)
      dummy.updateMatrix()
      fragments.setMatrixAt(index, dummy.matrix)
    }
    fragments.instanceMatrix.needsUpdate = true
    debris.scale.setScalar(0.025 + progress * 0.12)
    debris.rotation.y = progress * 1.7
    debrisMaterial.opacity = Math.max(0.18, 0.72 - progress * 0.48)
    trails.scale.setScalar(0.018 + progress * 0.1)
    trails.position.y = -progress * progress * 0.045
    trailMaterial.opacity = Math.max(0, 0.5 - progress * 0.35)
    gl.domElement.dataset.counterstrikeEffect = 'orbital-interception'
  })

  return (
    <group ref={rootRef} name="counterstrike-orbital-breakup">
      <mesh ref={flashRef} geometry={flashGeometry} material={flashMaterial} />
      <mesh ref={ringRef} geometry={ringGeometry} material={ringMaterial} />
      <instancedMesh
        ref={fragmentsRef}
        args={[fragmentGeometry, fragmentMaterial, FRAGMENT_COUNT]}
        frustumCulled={false}
      />
      <points ref={debrisRef} geometry={debrisGeometry} material={debrisMaterial} />
      <points ref={trailsRef} geometry={trailGeometry} material={trailMaterial} />
    </group>
  )
}

export function InterceptedThreatRecord({
  playerSite,
  rivalSite,
  secondaryImpactSite,
  interceptProgress = 0.7,
}: InterceptedThreatRecordProps) {
  const route = useMemo(
    () => createCounterstrikeRoute(playerSite, rivalSite, secondaryImpactSite),
    [playerSite, rivalSite, secondaryImpactSite],
  )
  const position = useMemo(
    () => route.getRenderPoint(interceptProgress),
    [interceptProgress, route],
  )
  const geometry = useMemo(() => createDebrisGeometry(14, 0.6), [])
  const material = useMemo(
    () =>
      new PointsMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        opacity: 0.32,
        size: 0.005,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return (
    <points
      name="accepted-intercepted-threat-record"
      position={position}
      scale={0.055}
      geometry={geometry}
      material={material}
    />
  )
}
