import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  IcosahedronGeometry,
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
import { sampleInterceptEnergy } from './interceptPresentation.ts'
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
  const shellRef = useRef<Mesh>(null)
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
  const ringNormal = useMemo(() => interceptPoint.clone().normalize(), [interceptPoint])
  const ringAxis = useMemo(() => new Vector3(0, 0, 1), [])
  const flashGeometry = useMemo(() => new SphereGeometry(1, 12, 8), [])
  const shellGeometry = useMemo(() => new IcosahedronGeometry(1, 1), [])
  const ringGeometry = useMemo(() => new RingGeometry(0.975, 1, 48), [])
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
        color: '#fff5df',
        depthWrite: false,
        opacity: 0.82,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const shellMaterial = useMemo(() => new MeshBasicMaterial({
    color: '#ff9b32', transparent: true, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false, opacity: 0.34,
  }), [])
  const directions = useMemo(() => Array.from({ length: FRAGMENT_COUNT }, (_, index) => seededDirection(index)), [])
  const ringMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.playerAmberEmissive,
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
        color: '#9b9387',
        emissive: '#b86422',
        emissiveIntensity: 0.35,
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
        size: 0.0018,
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
        size: 0.0012,
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
      shellGeometry.dispose()
      shellMaterial.dispose()
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
      delete gl.domElement.dataset.counterstrikeEnergy
      delete gl.domElement.dataset.counterstrikeEffect
    }, [
      shellGeometry,
      shellMaterial,
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

  useFrame(() => {
    const root = rootRef.current
    const flash = flashRef.current
    const shell = shellRef.current
    const ring = ringRef.current
    const fragments = fragmentsRef.current
    const debris = debrisRef.current
    const trails = trailsRef.current
    if (
      root === null || shell === null || flash === null || ring === null || fragments === null ||
      debris === null || trails === null
    ) return

    const progress = getCounterstrikeRunProgress(run, performance.now())
    const expansion = 0.018 + progress * 0.11
    root.position.copy(interceptPoint)
    const energy = sampleInterceptEnergy(progress)
    flash.visible = energy.core > 0
    flash.scale.setScalar(0.023 + (1 - energy.core) * 0.009)
    flashMaterial.opacity = energy.core
    shell.visible = energy.shellOpacity > 0
    shell.scale.setScalar(energy.shellRadius)
    shellMaterial.opacity = energy.shellOpacity
    ring.visible = energy.ringOpacity > 0
    ring.scale.setScalar(energy.ringRadius)
    // Fixed in the orbital collision plane; parallax comes from the camera.
    ring.quaternion.setFromUnitVectors(ringAxis, ringNormal)
    ringMaterial.opacity = energy.ringOpacity

    const dummy = dummyRef.current
    for (let index = 0; index < FRAGMENT_COUNT; index += 1) {
      const direction = directions[index]!
      dummy.position.copy(direction).multiplyScalar(
        expansion * (0.42 + (index % 5) * 0.13),
      )
      dummy.rotation.set(
        index * 0.31 + progress * (2.4 + (index % 3)),
        index * 0.57 + progress * 3.1,
        index * 0.23 + progress * 1.8,
      )
      dummy.scale.set(0.005 + (index % 4) * 0.001, 0.005, 0.005)
      dummy.updateMatrix()
      fragments.setMatrixAt(index, dummy.matrix)
    }
    fragments.instanceMatrix.needsUpdate = true
    debris.scale.setScalar(0.025 + progress * 0.12)
    debris.rotation.y = progress * 1.7
    debrisMaterial.opacity = Math.max(0.18, 0.72 - progress * 0.48)
    trails.scale.setScalar(0.018 + progress * 0.1)
    // In vacuum the small hot fragments coast; there is no rising smoke plume.
    trails.position.y = 0
    trailMaterial.opacity = Math.max(0, 0.5 - progress * 0.35)
    gl.domElement.dataset.counterstrikeEffect = 'orbital-interception'
    gl.domElement.dataset.counterstrikeEnergy = JSON.stringify(energy)
  })

  return (
    <group ref={rootRef} name="counterstrike-orbital-breakup">
      <mesh ref={flashRef} geometry={flashGeometry} material={flashMaterial} />
      <mesh ref={shellRef} geometry={shellGeometry} material={shellMaterial} />
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
  const fragments = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new BoxGeometry(1, 0.34, 0.24), [])
  const material = useMemo(() => new MeshStandardMaterial({
    color: '#9b9387', metalness: 0.34, roughness: 0.64,
    emissive: '#b86422', emissiveIntensity: 0.12,
  }), [])

  useLayoutEffect(() => {
    if (fragments.current === null) return
    const dummy = new Object3D()
    // A few of the same panels continue at the final breakup positions. The
    // accepted record is static, so the outpost view keeps demand rendering.
    for (let index = 0; index < 7; index++) {
      dummy.position.copy(seededDirection(index)).multiplyScalar(0.128 * (0.42 + (index % 5) * 0.13))
      dummy.rotation.set(index * 0.31 + 2.4 + (index % 3), index * 0.57 + 3.1, index * 0.23 + 1.8)
      dummy.scale.set(0.005 + (index % 4) * 0.001, 0.005, 0.005)
      dummy.updateMatrix()
      fragments.current.setMatrixAt(index, dummy.matrix)
    }
    fragments.current.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  return <instancedMesh ref={fragments} name="accepted-intercepted-threat-record"
    position={position} args={[geometry, material, 7]} frustumCulled={false} />
}
