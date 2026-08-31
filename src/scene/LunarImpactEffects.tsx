import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  getFirstStrikePresentationProgress,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'

const DEBRIS_COUNT = 42
const DUST_COUNT = 88
const SHEET_SEGMENTS = 42

export const IMPACT_EMITTER_CLEARANCE_M = 0.015

interface LunarImpactEffectsProps {
  readonly rivalSite: LandingSite
  readonly presentation: FirstStrikePresentationState
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

export function calculateImpactEmitterHeight(
  terrain: SurfaceTerrainProfile,
  segments: number,
): number {
  return (
    sampleRenderedSurface(terrain, segments, 0, 0).y +
    IMPACT_EMITTER_CLEARANCE_M * LOCAL_METRES_TO_RENDER_UNITS
  )
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

function createRegolithSheetGeometry(seed: number): BufferGeometry {
  const random = createRandom(seed ^ 0x728e_41b5)
  const innerNoise = Array.from(
    { length: SHEET_SEGMENTS },
    () => random() * 0.13 - 0.065,
  )
  const outerNoise = Array.from(
    { length: SHEET_SEGMENTS },
    () => random() * 0.2 - 0.1,
  )
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const innerColor = new Color(VISUAL_PALETTE.damageHeat)
  const outerColor = new Color(VISUAL_PALETTE.damageRim)

  for (let index = 0; index <= SHEET_SEGMENTS; index += 1) {
    const wrapped = index % SHEET_SEGMENTS
    const angle = (wrapped / SHEET_SEGMENTS) * Math.PI * 2
    const innerRadius = 0.71 + innerNoise[wrapped]!
    const outerRadius = 1 + outerNoise[wrapped]!
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    positions.push(cosine * innerRadius, 0.0018, sine * innerRadius)
    positions.push(
      cosine * outerRadius,
      0.0005 + (wrapped % 3) * 0.00018,
      sine * outerRadius,
    )
    innerColor.toArray(colors, index * 6)
    outerColor.toArray(colors, index * 6 + 3)

    if (index < SHEET_SEGMENTS) {
      const base = index * 2
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function LunarImpactEffects({
  rivalSite,
  presentation,
  terrain,
  segments,
}: LunarImpactEffectsProps) {
  const flashRef = useRef<Group>(null)
  const surfaceSheetRef = useRef<Group>(null)
  const ejectaRef = useRef<InstancedMesh>(null)
  const dustRef = useRef<Points>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const transform = useMemo(
    () => landingSiteToRenderTransform(rivalSite),
    [rivalSite],
  )
  const emitterHeight = useMemo(
    () => calculateImpactEmitterHeight(terrain, segments),
    [segments, terrain],
  )
  const position = useMemo(
    () =>
      transform.position
        .clone()
        .addScaledVector(transform.up, emitterHeight),
    [emitterHeight, transform.position, transform.up],
  )
  const seed = useMemo(() => seedForSite(rivalSite), [rivalSite])
  const randomValues = useMemo(() => {
    const random = createRandom(seed)
    return Array.from({ length: DEBRIS_COUNT }, (_, index) => ({
      angle:
        (index / DEBRIS_COUNT) * Math.PI * 2 + (random() - 0.5) * 0.38,
      delay: random() * 0.18,
      distance: 0.48 + random() * 0.78,
      height: 0.28 + random() * 0.82,
      spin: random() * Math.PI * 2,
      size: 0.46 + random() * 0.9,
      wreckage: index % 7 === 0 || index % 11 === 0,
    }))
  }, [seed])
  const dustValues = useMemo(() => {
    const random = createRandom(seed ^ 0xa2e8_19d1)
    return Array.from({ length: DUST_COUNT }, (_, index) => ({
      angle:
        (index / DUST_COUNT) * Math.PI * 2 + (random() - 0.5) * 0.52,
      delay: random() * 0.24,
      distance: 0.4 + random() * 0.96,
      height: 0.16 + random() * 0.64,
      drift: (random() - 0.5) * 0.24,
    }))
  }, [seed])
  const dustGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const colors = new Float32Array(DUST_COUNT * 3)
    const regolithColor = new Color(VISUAL_PALETTE.damageRim)
    const charColor = new Color(VISUAL_PALETTE.damageChar)

    for (let index = 0; index < DUST_COUNT; index += 1) {
      ;(index % 5 === 0 ? charColor : regolithColor).toArray(colors, index * 3)
    }

    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3),
    )
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    return geometry
  }, [])
  const flashGeometry = useMemo(() => new SphereGeometry(1, 16, 8), [])
  const sheetGeometry = useMemo(
    () => createRegolithSheetGeometry(seed),
    [seed],
  )
  const debrisGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const flashMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ff9a55',
        depthTest: false,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const flashCoreMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#fff0ce',
        depthTest: false,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const sheetMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#c9b0a2',
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        toneMapped: true,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const debrisMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#8c8177',
        ...MATERIAL_RESPONSE.lunar,
        flatShading: true,
        vertexColors: true,
      }),
    [],
  )
  const dustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: '#a89d92',
        depthWrite: false,
        opacity: 0,
        size: 0.0028,
        sizeAttenuation: true,
        toneMapped: true,
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

    const regolith = new Color(VISUAL_PALETTE.damageRim)
    const char = new Color(VISUAL_PALETTE.damageChar)
    const wreck = new Color(VISUAL_PALETTE.rivalWreck)
    const heat = new Color(VISUAL_PALETTE.damageHeat)
    randomValues.forEach((sample, index) => {
      ejecta.setColorAt(
        index,
        sample.wreckage ? (index % 2 === 0 ? wreck : heat) : index % 4 === 0 ? char : regolith,
      )
    })
    if (ejecta.instanceColor !== null) ejecta.instanceColor.needsUpdate = true
  }, [randomValues])

  useEffect(
    () => () => {
      flashGeometry.dispose()
      sheetGeometry.dispose()
      debrisGeometry.dispose()
      dustGeometry.dispose()
      flashMaterial.dispose()
      flashCoreMaterial.dispose()
      sheetMaterial.dispose()
      debrisMaterial.dispose()
      dustMaterial.dispose()
      delete gl.domElement.dataset.impactEffectPhase
    }, [
      debrisGeometry,
      debrisMaterial,
      dustGeometry,
      dustMaterial,
      flashGeometry,
      flashMaterial,
      flashCoreMaterial,
      gl,
      sheetGeometry,
      sheetMaterial,
    ],
  )

  useFrame(() => {
    const flash = flashRef.current
    const surfaceSheet = surfaceSheetRef.current
    const ejecta = ejectaRef.current
    const dust = dustRef.current
    if (
      flash === null ||
      surfaceSheet === null ||
      ejecta === null ||
      dust === null
    ) {
      return
    }

    const progress = getFirstStrikePresentationProgress(presentation)
    const flashPhase = presentation.phase === 'impact-flash'
    const ejectaPhase = presentation.phase === 'ejecta'
    const revealPhase = presentation.phase === 'crater-reveal'
    const flashWindow = Math.min(1, progress / 0.42)
    const flashPulse = flashPhase ? Math.sin(Math.PI * flashWindow) ** 0.42 : 0
    const eventProgress = flashPhase
      ? progress * 0.18
      : ejectaPhase
        ? 0.18 + progress * 0.82
        : 1
    const expansion = smoothstep(eventProgress)
    const revealFade = revealPhase ? 1 - smoothstep(progress) : 1

    flash.visible = flashPulse > 0.005
    flash.scale.setScalar(0.003 + smoothstep(flashWindow) * 0.0085)
    flashMaterial.opacity = flashPulse * 0.56
    flashCoreMaterial.opacity = flashPulse * 0.94

    surfaceSheet.visible = !revealPhase || revealFade > 0.02
    surfaceSheet.scale.setScalar(0.014 + expansion * 0.128)
    sheetMaterial.opacity = flashPhase
      ? flashPulse * 0.34
      : ejectaPhase
        ? (1 - smoothstep(progress)) * 0.4
        : revealFade * 0.08

    const dummy = dummyRef.current
    for (let index = 0; index < DEBRIS_COUNT; index += 1) {
      const sample = randomValues[index]!
      const localProgress = Math.max(
        0,
        Math.min(1, (progress - sample.delay) / (1 - sample.delay)),
      )
      const travel = smoothstep(localProgress)
      const radialDistance = travel * sample.distance * 0.12
      const ballisticHeight = 4 * localProgress * (1 - localProgress) * sample.height
      dummy.position.set(
        Math.cos(sample.angle) * radialDistance,
        ballisticHeight * 0.075 + 0.0012,
        Math.sin(sample.angle) * radialDistance,
      )
      dummy.rotation.set(
        sample.spin + localProgress * 5.1,
        sample.angle + localProgress * 2.3,
        sample.spin * 0.4 + localProgress * 4.2,
      )
      const activeScale = ejectaPhase ? 1 : revealPhase ? revealFade : 0
      const size = sample.size * (sample.wreckage ? 0.0032 : 0.00245) * activeScale
      dummy.scale.set(size * 1.25, size * 0.75, size)
      dummy.updateMatrix()
      ejecta.setMatrixAt(index, dummy.matrix)
    }
    ejecta.instanceMatrix.needsUpdate = true

    const positions = dust.geometry.getAttribute('position') as BufferAttribute
    for (let index = 0; index < DUST_COUNT; index += 1) {
      const sample = dustValues[index]!
      const localProgress = Math.max(
        0,
        Math.min(1, (progress - sample.delay) / (1 - sample.delay)),
      )
      const travel = smoothstep(localProgress)
      const radialDistance = travel * sample.distance * 0.135
      const angle = sample.angle + sample.drift * localProgress
      positions.setXYZ(
        index,
        Math.cos(angle) * radialDistance,
        4 * localProgress * (1 - localProgress) * sample.height * 0.056 + 0.001,
        Math.sin(angle) * radialDistance,
      )
    }
    positions.needsUpdate = true
    dustMaterial.opacity = ejectaPhase
      ? Math.max(0, 0.58 - smoothstep(progress) * 0.42)
      : revealPhase
        ? revealFade * 0.11
        : 0
    gl.domElement.dataset.impactEffectPhase = presentation.phase
  })

  return (
    <group position={position} quaternion={transform.orientation}>
      <group ref={surfaceSheetRef}>
        <mesh geometry={sheetGeometry} material={sheetMaterial} />
      </group>
      <group ref={flashRef} position-y={0.003}>
        <mesh geometry={flashGeometry} material={flashMaterial} />
        <mesh
          geometry={flashGeometry}
          material={flashCoreMaterial}
          scale={0.42}
        />
      </group>
      <instancedMesh
        ref={ejectaRef}
        args={[debrisGeometry, debrisMaterial, DEBRIS_COUNT]}
        frustumCulled={false}
      />
      <points
        ref={dustRef}
        geometry={dustGeometry}
        material={dustMaterial}
        frustumCulled={false}
      />
    </group>
  )
}
