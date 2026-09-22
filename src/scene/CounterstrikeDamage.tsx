import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Vector2,
} from 'three'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { deriveSecondaryImpactOffset } from '../domain/counterstrike.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
} from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { CounterstrikeRunState } from '../simulation/counterstrikeSimulation.ts'
import { MATERIAL_RESPONSE, VISUAL_PALETTE } from '../render/visualSystem.ts'
import {
  COUNTERSTRIKE_IMPACT_EFFECT_MS,
  getCounterstrikeImpactElapsedMs,
  sampleCounterstrikeImpactEnergy,
} from './counterstrikeImpactPresentation.ts'

interface CounterstrikeDamageProps {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly run: CounterstrikeRunState
  readonly transientImpact: boolean
  readonly permanent: boolean
}

const CRATER_SEGMENTS = 22
const EJECTA_CHUNK_COUNT = 18
const EJECTA_STREAK_COUNT = 7
const WRECKAGE_COUNT = 8
const IMPACT_SHARD_COUNT = 16
const IMPACT_GRAIN_COUNT = 110
const CURTAIN_SEGMENTS = 28
// The hit is 8.4 m beyond the extractor. A ~6 m outer rim remains substantial
// without laying raised crater geometry over (and visually burying) machinery.
const DAMAGE_MODEL_SCALE = 0.78
// SurfacePatch is a depth-less transparent overlay drawn at renderOrder 1;
// transient impact layers must draw after it or the ground paints over them.
const EFFECT_RENDER_ORDER = 3

function deterministicVariation(index: number, salt: number): number {
  return Math.sin(index * 12.9898 + salt * 78.233) * 0.5 + 0.5
}

/**
 * The permanent mark speaks the First Strike scar's language: a carbonized
 * floor, a restrained scorch band on the inner wall, neutral grey fractured
 * rim material, and an ejecta blanket lifted toward the regolith it lands on.
 */
export function createCounterstrikeCraterColors(): {
  readonly floor: Color
  readonly innerWall: Color
  readonly rim: Color
  readonly blanket: Color
} {
  const lunar = new Color(VISUAL_PALETTE.lunarMid)
  return {
    floor: new Color(VISUAL_PALETTE.damageChar).lerp(lunar, 0.04),
    innerWall: new Color(VISUAL_PALETTE.damageFloor)
      .lerp(new Color(VISUAL_PALETTE.damageHeat), 0.3)
      .lerp(lunar, 0.08),
    rim: new Color(VISUAL_PALETTE.damageRim).lerp(lunar, 0.32),
    blanket: new Color(VISUAL_PALETTE.damageFloor).lerp(lunar, 0.45),
  }
}

export function createCounterstrikeCraterGeometry(
  terrain: SurfaceTerrainProfile, segments: number, offset: { xM: number; zM: number },
): BufferGeometry {
  const positions: number[] = [0, 0.025, 0]
  const colors: number[] = []
  const indices: number[] = []
  const palette = createCounterstrikeCraterColors()
  const ringColors = [palette.innerWall, palette.rim, palette.blanket]
  colors.push(palette.floor.r, palette.floor.g, palette.floor.b)

  for (let ring = 0; ring < 3; ring += 1) {
    for (let index = 0; index < CRATER_SEGMENTS; index += 1) {
      const angle = (index / CRATER_SEGMENTS) * Math.PI * 2
      const irregularity =
        Math.sin(index * 2.17 + ring * 0.8) * 0.42 +
        (deterministicVariation(index, ring) - 0.5) * 0.46
      const radius =
        ring === 0
          ? 2.5 + irregularity * 0.34
          : ring === 1
            ? 5.45 + irregularity
            : 7.7 + irregularity * 0.72
      const height =
        ring === 0
          ? 0.08 + Math.abs(irregularity) * 0.1
          : ring === 1
            ? (index % 7 === 0 ? 0.48 : 1.38) + irregularity * 0.46
            : 0.025 + Math.abs(irregularity) * 0.08
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const center = sampleRenderedSurface(terrain, segments, offset.xM, offset.zM)
      const surface = sampleRenderedSurface(terrain, segments, offset.xM + x * DAMAGE_MODEL_SCALE, offset.zM + z * DAMAGE_MODEL_SCALE)
      positions.push(x, height + (surface.y - center.y) / (LOCAL_METRES_TO_RENDER_UNITS * DAMAGE_MODEL_SCALE), z)
      // Fractured rim material alternates lighter and darker plates.
      const color = ringColors[ring]!.clone()
      if (ring === 1) color.multiplyScalar(0.84 + deterministicVariation(index, 21) * 0.3)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (let index = 0; index < CRATER_SEGMENTS; index += 1) {
    const current = 1 + index
    const next = 1 + ((index + 1) % CRATER_SEGMENTS)
    indices.push(0, next, current)
  }

  for (let ring = 0; ring < 2; ring += 1) {
    const innerStart = 1 + ring * CRATER_SEGMENTS
    const outerStart = innerStart + CRATER_SEGMENTS
    for (let index = 0; index < CRATER_SEGMENTS; index += 1) {
      const current = innerStart + index
      const next = innerStart + ((index + 1) % CRATER_SEGMENTS)
      const outerCurrent = outerStart + index
      const outerNext = outerStart + ((index + 1) % CRATER_SEGMENTS)
      indices.push(current, next, outerCurrent)
      indices.push(next, outerNext, outerCurrent)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colors), 3),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Flat unit disc or band whose vertex alpha follows `stops`, so glows, the
 * shock band and the ember fall off softly without a texture.
 */
function createSoftDiscGeometry(
  stops: ReadonlyArray<{ readonly radius: number; readonly alpha: number }>,
  segments = 36,
): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  stops.forEach((stop) => {
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2
      positions.push(Math.cos(angle) * stop.radius, Math.sin(angle) * stop.radius, 0)
      colors.push(1, 1, 1, stop.alpha)
    }
  })
  for (let ring = 0; ring < stops.length - 1; ring += 1) {
    for (let index = 0; index < segments; index += 1) {
      const a = ring * segments + index
      const b = ring * segments + ((index + 1) % segments)
      indices.push(a, a + segments, b, b, a + segments, b + segments)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/** Unit-height open cone with a ragged lip; alpha thins toward the lip. */
function createEjectaCurtainGeometry(): BufferGeometry {
  const rings = [
    { radius: 0.18, height: 0, alpha: 0.9 },
    { radius: 0.58, height: 0.46, alpha: 0.5 },
    { radius: 1, height: 1, alpha: 0 },
  ]
  const color = new Color(VISUAL_PALETTE.damageRim).lerp(
    new Color(VISUAL_PALETTE.lunarSunlit),
    0.3,
  )
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  rings.forEach((ring, ringIndex) => {
    for (let index = 0; index <= CURTAIN_SEGMENTS; index += 1) {
      const angle = (index / CURTAIN_SEGMENTS) * Math.PI * 2
      const ragged =
        ringIndex === 0
          ? 1
          : 0.7 +
            deterministicVariation(index % CURTAIN_SEGMENTS, 31 + ringIndex) *
              (ringIndex === 2 ? 0.6 : 0.3)
      positions.push(
        Math.cos(angle) * ring.radius * ragged,
        ring.height * ragged,
        Math.sin(angle) * ring.radius * ragged,
      )
      colors.push(color.r, color.g, color.b, ring.alpha)
    }
  })
  const stride = CURTAIN_SEGMENTS + 1
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let index = 0; index < CURTAIN_SEGMENTS; index += 1) {
      const a = ring * stride + index
      const b = a + stride
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function CounterstrikeDamage({
  outpost,
  terrain,
  segments,
  run,
  transientImpact,
  permanent,
}: CounterstrikeDamageProps) {
  const permanentRootRef = useRef<Group>(null)
  const transientRootRef = useRef<Group>(null)
  const coreRef = useRef<Mesh>(null)
  const haloRef = useRef<Mesh>(null)
  const billboardRef = useRef(new Quaternion())
  const ringRef = useRef<Mesh>(null)
  const curtainRef = useRef<Mesh>(null)
  const emberRef = useRef<Mesh>(null)
  const shardsRef = useRef<InstancedMesh>(null)
  const grainsRef = useRef<Points>(null)
  const ejectaChunksRef = useRef<InstancedMesh>(null)
  const ejectaStreaksRef = useRef<InstancedMesh>(null)
  const wreckageRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const offset = useMemo(() => deriveSecondaryImpactOffset(outpost), [outpost])
  const ground = useMemo(
    () => sampleRenderedSurface(terrain, segments, offset.xM, offset.zM),
    [offset.xM, offset.zM, segments, terrain],
  )
  const craterGeometry = useMemo(() => createCounterstrikeCraterGeometry(terrain, segments, offset), [terrain, segments, offset.xM, offset.zM])
  const rockGeometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const debrisGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const glowGeometry = useMemo(
    () =>
      createSoftDiscGeometry([
        { radius: 0, alpha: 1 },
        { radius: 0.28, alpha: 0.85 },
        { radius: 0.6, alpha: 0.28 },
        { radius: 1, alpha: 0 },
      ]),
    [],
  )
  const ringGeometry = useMemo(
    () =>
      createSoftDiscGeometry(
        [
          { radius: 0.78, alpha: 0 },
          { radius: 0.93, alpha: 1 },
          { radius: 1, alpha: 0 },
        ],
        56,
      ),
    [],
  )
  const curtainGeometry = useMemo(createEjectaCurtainGeometry, [])
  const grainGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(IMPACT_GRAIN_COUNT * 3), 3).setUsage(
        DynamicDrawUsage,
      ),
    )
    return geometry
  }, [])
  const craterMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        vertexColors: true,
        flatShading: true,
        ...MATERIAL_RESPONSE.lunar,
      }),
    [],
  )
  const ejectaMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color(VISUAL_PALETTE.damageRim).lerp(
          new Color(VISUAL_PALETTE.lunarMid),
          0.3,
        ),
        ...MATERIAL_RESPONSE.lunar,
        flatShading: true,
      }),
    [],
  )
  // Charred structural steel from the extractor, not the rust-red of fresh
  // player heat panels. Residual heat belongs to the transient ember only.
  const wreckageMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color(VISUAL_PALETTE.playerSteel).lerp(
          new Color(VISUAL_PALETTE.damageChar),
          0.3,
        ),
        ...MATERIAL_RESPONSE.playerSteel,
      }),
    [],
  )
  const shardMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        flatShading: true,
        ...MATERIAL_RESPONSE.lunar,
      }),
    [],
  )
  // The unlit contact layers share one program: tone mapping is off so the
  // white-hot core can exceed the lit scene for its fifth of a second.
  const coreMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.defenseImpactCore,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const haloMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#ffb676',
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const ringMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#9d978d',
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const emberMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: VISUAL_PALETTE.damageEmber,
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const curtainMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ffffff',
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  )
  const grainMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: new Color(VISUAL_PALETTE.damageRim).lerp(
          new Color(VISUAL_PALETTE.lunarSunlit),
          0.55,
        ),
        depthWrite: false,
        opacity: 0,
        size: 0.32 * LOCAL_METRES_TO_RENDER_UNITS,
        sizeAttenuation: true,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const shardFlights = useMemo(
    () =>
      Array.from({ length: IMPACT_SHARD_COUNT }, (_, index) => {
        const flightMs =
          COUNTERSTRIKE_IMPACT_EFFECT_MS.debris *
          (0.62 + deterministicVariation(index, 18) * 0.38)
        const apexM = 1.6 + deterministicVariation(index, 19) * 5.2
        return {
          angle: index * 2.399963229728653 + deterministicVariation(index, 20) * 0.4,
          rangeM: 5 + deterministicVariation(index, 22) * 11,
          apexM,
          flightMs,
          size: 0.1 + deterministicVariation(index, 23) * 0.2,
        }
      }),
    [],
  )
  // Fine regolith follows ballistic arcs in vacuum; it does not billow.
  const grainFlights = useMemo(
    () =>
      Array.from({ length: IMPACT_GRAIN_COUNT }, (_, index) => ({
        angle: index * 2.399963229728653 + deterministicVariation(index, 24) * 0.5,
        rangeM: 2.5 + deterministicVariation(index, 25) ** 0.7 * 17,
        apexM: 1 + deterministicVariation(index, 26) * 8.5,
        flightMs:
          COUNTERSTRIKE_IMPACT_EFFECT_MS.grains *
          (0.45 + deterministicVariation(index, 27) * 0.55),
      })),
    [],
  )

  useLayoutEffect(() => {
    const chunks = ejectaChunksRef.current
    const streaks = ejectaStreaksRef.current
    const wreckage = wreckageRef.current
    const shards = shardsRef.current
    const dummy = dummyRef.current

    if (chunks !== null) {
      for (let index = 0; index < EJECTA_CHUNK_COUNT; index += 1) {
        const angle = index * 2.399963229728653 + (index % 4) * 0.17
        const radius = 6.7 + deterministicVariation(index, 2) * 9.4
        dummy.position.set(
          Math.cos(angle) * radius,
          0.18 + deterministicVariation(index, 5) * 0.24,
          Math.sin(angle) * radius,
        )
        dummy.rotation.set(index * 0.43, angle * 0.72, index * 0.29)
        dummy.scale.set(
          0.34 + deterministicVariation(index, 6) * 0.62,
          0.22 + deterministicVariation(index, 7) * 0.46,
          0.38 + deterministicVariation(index, 8) * 0.72,
        )
        dummy.updateMatrix()
        chunks.setMatrixAt(index, dummy.matrix)
      }
      chunks.instanceMatrix.needsUpdate = true
    }

    if (streaks !== null) {
      for (let index = 0; index < EJECTA_STREAK_COUNT; index += 1) {
        const angle = index * 2.399963229728653 + 0.36
        const radius = 9.2 + deterministicVariation(index, 9) * 8.4
        dummy.position.set(
          Math.cos(angle) * radius,
          0.03,
          Math.sin(angle) * radius,
        )
        dummy.rotation.set(
          (deterministicVariation(index, 10) - 0.5) * 0.12,
          -angle + (deterministicVariation(index, 11) - 0.5) * 0.3,
          (deterministicVariation(index, 12) - 0.5) * 0.18,
        )
        // Low, broad ejecta rays rather than raised planks.
        dummy.scale.set(
          1.1 + deterministicVariation(index, 13) * 2.2,
          0.035 + deterministicVariation(index, 14) * 0.03,
          0.34 + deterministicVariation(index, 15) * 0.3,
        )
        dummy.updateMatrix()
        streaks.setMatrixAt(index, dummy.matrix)
      }
      streaks.instanceMatrix.needsUpdate = true
    }

    if (wreckage !== null) {
      const extractor = outpost.extractor?.position ?? { xM: 0, zM: 0 }
      const toExtractor = new Vector2(
        extractor.xM - offset.xM,
        extractor.zM - offset.zM,
      )
      if (toExtractor.lengthSq() < 1e-8) toExtractor.set(-1, -0.4)
      toExtractor.normalize()
      const side = new Vector2(-toExtractor.y, toExtractor.x)
      for (let index = 0; index < WRECKAGE_COUNT; index += 1) {
        const toward = 1.2 + (index % 5) * 0.9
        const lateral =
          (deterministicVariation(index, 16) - 0.5) * (2.4 + index * 0.18)
        dummy.position.set(
          toExtractor.x * toward + side.x * lateral,
          0.22 + (index % 3) * 0.16,
          toExtractor.y * toward + side.y * lateral,
        )
        dummy.rotation.set(index * 0.37, index * 0.61, index * 0.28)
        dummy.scale.set(
          0.35 + (index % 3) * 0.24,
          0.12 + (index % 2) * 0.14,
          0.7 + deterministicVariation(index, 17) * 1.25,
        )
        dummy.updateMatrix()
        wreckage.setMatrixAt(index, dummy.matrix)
      }
      wreckage.instanceMatrix.needsUpdate = true
    }

    if (shards !== null) {
      shards.instanceMatrix.setUsage(DynamicDrawUsage)
      const palette = createCounterstrikeCraterColors()
      const shardColors = [palette.rim, palette.blanket, palette.floor, palette.rim]
      for (let index = 0; index < IMPACT_SHARD_COUNT; index += 1) {
        shards.setColorAt(index, shardColors[index % shardColors.length]!)
        dummy.position.set(0, 0, 0)
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        shards.setMatrixAt(index, dummy.matrix)
      }
      if (shards.instanceColor !== null) shards.instanceColor.needsUpdate = true
      shards.instanceMatrix.needsUpdate = true
    }

  }, [offset.xM, offset.zM, outpost.extractor?.position, transientImpact, permanent])

  useEffect(
    () => () => {
      craterGeometry.dispose()
      rockGeometry.dispose()
      debrisGeometry.dispose()
      glowGeometry.dispose()
      ringGeometry.dispose()
      curtainGeometry.dispose()
      grainGeometry.dispose()
      craterMaterial.dispose()
      ejectaMaterial.dispose()
      wreckageMaterial.dispose()
      shardMaterial.dispose()
      coreMaterial.dispose()
      haloMaterial.dispose()
      ringMaterial.dispose()
      emberMaterial.dispose()
      curtainMaterial.dispose()
      grainMaterial.dispose()
      delete gl.domElement.dataset.counterstrikeImpactEffect
      delete gl.domElement.dataset.counterstrikeDamageField
      delete gl.domElement.dataset.counterstrikeEjectaCount
      delete gl.domElement.dataset.secondaryImpactX
      delete gl.domElement.dataset.secondaryImpactZ
    },
    [
      coreMaterial,
      craterGeometry,
      craterMaterial,
      curtainGeometry,
      curtainMaterial,
      debrisGeometry,
      ejectaMaterial,
      emberMaterial,
      gl,
      glowGeometry,
      grainGeometry,
      grainMaterial,
      haloMaterial,
      ringGeometry,
      ringMaterial,
      rockGeometry,
      shardMaterial,
      wreckageMaterial,
    ],
  )

  useFrame(() => {
    if (!transientImpact) return
    const permanentRoot = permanentRootRef.current
    const transientRoot = transientRootRef.current
    const core = coreRef.current
    const halo = haloRef.current
    const ring = ringRef.current
    const curtain = curtainRef.current
    const ember = emberRef.current
    const shards = shardsRef.current
    const grains = grainsRef.current
    if (
      permanentRoot === null ||
      transientRoot === null ||
      core === null ||
      halo === null ||
      ring === null ||
      curtain === null ||
      ember === null ||
      shards === null ||
      grains === null
    ) {
      return
    }

    const elapsedMs = getCounterstrikeImpactElapsedMs(run, performance.now())
    const contacted = elapsedMs >= 0
    const effectActive =
      contacted && elapsedMs < COUNTERSTRIKE_IMPACT_EFFECT_MS.ember
    permanentRoot.visible = permanent && contacted
    transientRoot.visible = effectActive
    gl.domElement.dataset.counterstrikeDamageField = permanentRoot.visible
      ? 'persistent'
      : 'hidden'

    if (!effectActive) {
      delete gl.domElement.dataset.counterstrikeImpactEffect
      return
    }

    const energy = sampleCounterstrikeImpactEnergy(elapsedMs)
    // Camera-facing soft discs: a white-hot core inside a short warm bloom.
    core.visible = energy.core > 0.002
    halo.visible = core.visible
    if (core.visible) {
      transientRoot.getWorldQuaternion(billboardRef.current).invert()
      billboardRef.current.multiply(camera.quaternion)
      core.quaternion.copy(billboardRef.current)
      halo.quaternion.copy(billboardRef.current)
    }
    core.scale.setScalar(energy.coreRadiusM)
    halo.scale.setScalar(energy.coreRadiusM * 2.1)
    coreMaterial.opacity = Math.min(1, energy.core * 1.4)
    haloMaterial.opacity = energy.core * 0.6

    ring.visible = energy.ringOpacity > 0.004
    ring.scale.setScalar(energy.ringRadiusM)
    ringMaterial.opacity = energy.ringOpacity * 0.8

    curtain.visible = energy.curtainOpacity > 0.004
    curtain.scale.set(
      energy.curtainRadiusM,
      Math.max(0.001, energy.curtainHeightM),
      energy.curtainRadiusM,
    )
    curtainMaterial.opacity = energy.curtainOpacity

    ember.visible = energy.ember > 0.004
    emberMaterial.opacity = energy.ember * 0.55

    const dummy = dummyRef.current
    for (let index = 0; index < IMPACT_SHARD_COUNT; index += 1) {
      const flight = shardFlights[index]!
      const t = Math.min(1, elapsedMs / flight.flightMs)
      const landed = elapsedMs >= flight.flightMs
      dummy.position.set(
        Math.cos(flight.angle) * flight.rangeM * t,
        landed ? 0.12 : 4 * flight.apexM * t * (1 - t) + 0.12,
        Math.sin(flight.angle) * flight.rangeM * t,
      )
      dummy.rotation.set(
        index * 0.37 + t * 6.2,
        index * 0.51 + t * 4.4,
        index * 0.22 + t * 5.1,
      )
      dummy.scale.setScalar(landed ? 0 : flight.size)
      dummy.updateMatrix()
      shards.setMatrixAt(index, dummy.matrix)
    }
    shards.instanceMatrix.needsUpdate = true

    const grainPositions = grains.geometry.getAttribute(
      'position',
    ) as BufferAttribute
    for (let index = 0; index < IMPACT_GRAIN_COUNT; index += 1) {
      const flight = grainFlights[index]!
      const t = Math.min(1, elapsedMs / flight.flightMs)
      const travel = 1 - (1 - t) ** 1.6
      grainPositions.setXYZ(
        index,
        Math.cos(flight.angle) * flight.rangeM * travel,
        4 * flight.apexM * t * (1 - t) + 0.08,
        Math.sin(flight.angle) * flight.rangeM * travel,
      )
    }
    grainPositions.needsUpdate = true
    grains.visible = energy.dustOpacity > 0.004
    grainMaterial.opacity = energy.dustOpacity
    gl.domElement.dataset.counterstrikeImpactEffect = 'structural-impact'
  })

  useEffect(() => {
    gl.domElement.dataset.secondaryImpactX = offset.xM.toFixed(6)
    gl.domElement.dataset.secondaryImpactZ = offset.zM.toFixed(6)
  }, [gl, offset.xM, offset.zM])

  useEffect(() => {
    gl.domElement.dataset.counterstrikeEjectaCount = permanent
      ? String(EJECTA_CHUNK_COUNT + EJECTA_STREAK_COUNT)
      : '0'
    gl.domElement.dataset.counterstrikeDamageField =
      permanent && !transientImpact ? 'persistent' : 'hidden'
    if (!transientImpact) {
      delete gl.domElement.dataset.counterstrikeImpactEffect
    }
  }, [gl, permanent, transientImpact])

  if (!transientImpact && !permanent) return null

  return (
    <group position={transform.position} quaternion={transform.orientation}>
      <group
        name="counterstrike-secondary-impact"
        position={[
          ground.x,
          ground.y + 0.000018,
          ground.z,
        ]}
      >
        {permanent ? (
          <group
            ref={permanentRootRef}
            name="counterstrike-permanent-damage-field"
            scale={LOCAL_METRES_TO_RENDER_UNITS * DAMAGE_MODEL_SCALE}
            visible={!transientImpact}
          >
            <mesh geometry={craterGeometry} material={craterMaterial} receiveShadow />
            <instancedMesh
              ref={ejectaChunksRef}
              args={[rockGeometry, ejectaMaterial, EJECTA_CHUNK_COUNT]}
            />
            <instancedMesh
              ref={ejectaStreaksRef}
              args={[debrisGeometry, ejectaMaterial, EJECTA_STREAK_COUNT]}
            />
            <instancedMesh
              ref={wreckageRef}
              args={[debrisGeometry, wreckageMaterial, WRECKAGE_COUNT]}
            />
          </group>
        ) : null}
        {transientImpact ? (
          <group
            ref={transientRootRef}
            name="counterstrike-contact-effect"
            scale={LOCAL_METRES_TO_RENDER_UNITS}
            visible={false}
          >
            <mesh
              ref={emberRef}
              geometry={glowGeometry}
              material={emberMaterial}
              position-y={0.14}
              rotation-x={-Math.PI / 2}
              scale={2.3}
              renderOrder={EFFECT_RENDER_ORDER}
            />
            <mesh
              ref={ringRef}
              geometry={ringGeometry}
              material={ringMaterial}
              position-y={0.35}
              rotation-x={-Math.PI / 2}
              renderOrder={EFFECT_RENDER_ORDER}
            />
            <mesh
              ref={curtainRef}
              geometry={curtainGeometry}
              material={curtainMaterial}
              renderOrder={EFFECT_RENDER_ORDER}
            />
            <instancedMesh
              ref={shardsRef}
              args={[rockGeometry, shardMaterial, IMPACT_SHARD_COUNT]}
              frustumCulled={false}
            />
            <points
              ref={grainsRef}
              geometry={grainGeometry}
              material={grainMaterial}
              frustumCulled={false}
              renderOrder={EFFECT_RENDER_ORDER + 1}
            />
            <mesh
              ref={haloRef}
              geometry={glowGeometry}
              material={haloMaterial}
              position-y={1.4}
              renderOrder={EFFECT_RENDER_ORDER + 2}
            />
            <mesh
              ref={coreRef}
              geometry={glowGeometry}
              material={coreMaterial}
              position-y={1.4}
              renderOrder={EFFECT_RENDER_ORDER + 2}
            />
          </group>
        ) : null}
      </group>
    </group>
  )
}
