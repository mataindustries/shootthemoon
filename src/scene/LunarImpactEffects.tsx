import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

const DEBRIS_COUNT = 48
const DUST_COUNT = 72

interface LunarImpactEffectsProps {
  readonly rivalSite: LandingSite
  readonly presentation: FirstStrikePresentationState
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function seedForSite(site: LandingSite): number {
  return (
    Math.round(site.location.latitudeRad * 10_000_000) ^
    Math.round(site.location.longitudeRad * 10_000_000) ^
    0x51a7_c4a3
  ) >>> 0
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export function LunarImpactEffects({
  rivalSite,
  presentation,
}: LunarImpactEffectsProps) {
  const flashRef = useRef<Group>(null)
  const surfaceLightRef = useRef<Group>(null)
  const ejectaRef = useRef<InstancedMesh>(null)
  const dustRef = useRef<Points>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const transform = useMemo(
    () => landingSiteToRenderTransform(rivalSite),
    [rivalSite],
  )
  const position = useMemo(
    () => transform.position.clone().addScaledVector(transform.up, 0.00056),
    [transform.position, transform.up],
  )
  const randomValues = useMemo(() => {
    const random = createRandom(seedForSite(rivalSite))
    return Array.from({ length: DEBRIS_COUNT }, (_, index) => ({
      angle: (index / DEBRIS_COUNT) * Math.PI * 2 + random() * 0.11,
      distance: 0.48 + random() * 0.7,
      height: 0.17 + random() * 0.5,
      spin: random() * Math.PI * 2,
      size: 0.48 + random() * 0.82,
    }))
  }, [rivalSite])
  const dustValues = useMemo(() => {
    const random = createRandom(seedForSite(rivalSite) ^ 0xa2e8_19d1)
    return Array.from({ length: DUST_COUNT }, (_, index) => ({
      angle: (index / DUST_COUNT) * Math.PI * 2 + random() * 0.16,
      distance: 0.35 + random() * 0.85,
      height: 0.08 + random() * 0.3,
    }))
  }, [rivalSite])
  const dustGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const colors = new Float32Array(DUST_COUNT * 3)
    const dustColor = new Color('#d7c0ad')

    for (let index = 0; index < DUST_COUNT; index += 1) {
      dustColor.toArray(colors, index * 3)
    }

    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3),
    )
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    return geometry
  }, [])
  const flashGeometry = useMemo(() => new OctahedronGeometry(1, 2), [])
  const lightGeometry = useMemo(() => new CircleGeometry(1, 40), [])
  const curtainGeometry = useMemo(() => new RingGeometry(0.72, 1, 40), [])
  const debrisGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const flashMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#fff8e8',
        depthTest: false,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const surfaceMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#ff7d35',
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const debrisMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#d9b8a0',
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: '#ffffff',
        depthWrite: false,
        opacity: 0,
        size: 0.0044,
        sizeAttenuation: true,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const ejecta = ejectaRef.current
    if (ejecta === null) return
    ejecta.count = DEBRIS_COUNT
    ejecta.instanceMatrix.setUsage(DynamicDrawUsage)
  }, [])

  useEffect(
    () => () => {
      flashGeometry.dispose()
      lightGeometry.dispose()
      curtainGeometry.dispose()
      debrisGeometry.dispose()
      dustGeometry.dispose()
      flashMaterial.dispose()
      surfaceMaterial.dispose()
      debrisMaterial.dispose()
      dustMaterial.dispose()
      delete gl.domElement.dataset.impactEffectPhase
    }, [
      curtainGeometry,
      debrisGeometry,
      debrisMaterial,
      dustGeometry,
      dustMaterial,
      flashGeometry,
      flashMaterial,
      gl,
      lightGeometry,
      surfaceMaterial,
    ],
  )

  useFrame(() => {
    const flash = flashRef.current
    const surfaceLight = surfaceLightRef.current
    const ejecta = ejectaRef.current
    const dust = dustRef.current
    if (flash === null || surfaceLight === null || ejecta === null || dust === null) {
      return
    }

    const progress = getFirstStrikePresentationProgress(presentation)
    const flashPhase = presentation.phase === 'impact-flash'
    const ejectaPhase = presentation.phase === 'ejecta'
    const revealPhase = presentation.phase === 'crater-reveal'
    const flashPulse = flashPhase
      ? Math.sin(Math.PI * Math.min(1, progress * 1.35)) ** 0.45
      : 0
    const effectProgress = flashPhase ? 0 : ejectaPhase ? progress : 1
    const revealFade = revealPhase ? 1 - smoothstep(progress) : 1
    const expansion = smoothstep(effectProgress)

    flash.visible = flashPulse > 0.005
    flash.scale.setScalar(0.014 + progress * 0.088)
    flashMaterial.opacity = flashPulse
    surfaceLight.scale.setScalar(
      flashPhase ? 0.018 + smoothstep(progress) * 0.09 : 0.108 + expansion * 0.025,
    )
    surfaceMaterial.opacity = flashPhase
      ? flashPulse * 0.82
      : Math.max(0, (1 - expansion) * 0.44 * revealFade)

    const dummy = dummyRef.current
    for (let index = 0; index < DEBRIS_COUNT; index += 1) {
      const sample = randomValues[index]!
      const radialProgress = expansion * sample.distance
      const ballisticHeight =
        Math.sin(Math.PI * Math.min(1, effectProgress)) * sample.height
      dummy.position.set(
        Math.cos(sample.angle) * radialProgress * 0.12,
        ballisticHeight * 0.085 + 0.002,
        Math.sin(sample.angle) * radialProgress * 0.12,
      )
      dummy.rotation.set(
        sample.spin + effectProgress * 5.2,
        sample.angle,
        sample.spin * 0.4 + effectProgress * 3.8,
      )
      const size = sample.size * 0.0026 * revealFade
      dummy.scale.setScalar(size)
      dummy.updateMatrix()
      ejecta.setMatrixAt(index, dummy.matrix)
    }
    ejecta.instanceMatrix.needsUpdate = true
    debrisMaterial.opacity = ejectaPhase ? Math.max(0, 0.92 - progress * 0.5) : revealFade * 0.32

    const positions = dust.geometry.getAttribute('position') as BufferAttribute
    for (let index = 0; index < DUST_COUNT; index += 1) {
      const sample = dustValues[index]!
      const radialProgress = expansion * sample.distance
      positions.setXYZ(
        index,
        Math.cos(sample.angle) * radialProgress * 0.095,
        Math.sin(Math.PI * effectProgress) * sample.height * 0.052 + 0.001,
        Math.sin(sample.angle) * radialProgress * 0.095,
      )
    }
    positions.needsUpdate = true
    dustMaterial.opacity = ejectaPhase ? Math.max(0, 0.78 - progress * 0.54) : revealFade * 0.2
    gl.domElement.dataset.impactEffectPhase = presentation.phase
  })

  return (
    <group position={position} quaternion={transform.orientation}>
      <group ref={surfaceLightRef}>
        <mesh
          geometry={lightGeometry}
          material={surfaceMaterial}
          rotation-x={-Math.PI / 2}
        />
        <mesh
          geometry={curtainGeometry}
          material={surfaceMaterial}
          position-y={0.001}
          rotation-x={-Math.PI / 2}
          scale={1.12}
        />
      </group>
      <group ref={flashRef}>
        <mesh geometry={flashGeometry} material={flashMaterial} />
      </group>
      <instancedMesh
        ref={ejectaRef}
        args={[debrisGeometry, debrisMaterial, DEBRIS_COUNT]}
        frustumCulled={false}
      />
      <points ref={dustRef} geometry={dustGeometry} material={dustMaterial} frustumCulled={false} />
    </group>
  )
}
