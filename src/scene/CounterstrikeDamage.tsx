import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  PointLight,
  SphereGeometry,
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
import {
  COUNTERSTRIKE_TIMING,
  getCounterstrikeRunProgress,
} from '../simulation/counterstrikeSimulation.ts'
import { MATERIAL_RESPONSE, VISUAL_PALETTE } from '../render/visualSystem.ts'

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
const IMPACT_SHARD_COUNT = 18
const IMPACT_DUST_COUNT = 34
// The hit is 8.4 m beyond the extractor. A ~6 m outer rim remains substantial
// without laying raised crater geometry over (and visually burying) machinery.
const DAMAGE_MODEL_SCALE = 0.78
const IMPACT_CONTACT_PROGRESS =
  COUNTERSTRIKE_TIMING.impactContactMs / COUNTERSTRIKE_TIMING.impactMs

function deterministicVariation(index: number, salt: number): number {
  return Math.sin(index * 12.9898 + salt * 78.233) * 0.5 + 0.5
}

function createCraterGeometry(): BufferGeometry {
  const positions: number[] = [0, -1.36, 0]
  const colors: number[] = []
  const indices: number[] = []
  const floorColor = new Color(VISUAL_PALETTE.damageFloor).multiplyScalar(0.56)
  const innerColor = new Color(VISUAL_PALETTE.damageFloor).multiplyScalar(0.78)
  const rimColor = new Color(VISUAL_PALETTE.damageRim).multiplyScalar(0.9)
  const outerColor = new Color(VISUAL_PALETTE.damageHeat).multiplyScalar(0.72)
  const ringColors = [innerColor, rimColor, outerColor]
  colors.push(floorColor.r, floorColor.g, floorColor.b)

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
          ? -0.82 + irregularity * 0.12
          : ring === 1
            ? 0.48 + irregularity * 0.36
            : 0.02 + irregularity * 0.08
      positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
      const color = ringColors[ring]!
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

function createImpactDustGeometry(): BufferGeometry {
  const positions = new Float32Array(IMPACT_DUST_COUNT * 3)
  for (let index = 0; index < IMPACT_DUST_COUNT; index += 1) {
    const angle = index * 2.399963229728653
    const radius = 0.8 + deterministicVariation(index, 4) * 4.8
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = 0.28 + (index % 7) * 0.34
    positions[index * 3 + 2] = Math.sin(angle) * radius
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
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
  const flashRef = useRef<Mesh>(null)
  const shardsRef = useRef<InstancedMesh>(null)
  const ejectaChunksRef = useRef<InstancedMesh>(null)
  const ejectaStreaksRef = useRef<InstancedMesh>(null)
  const wreckageRef = useRef<InstancedMesh>(null)
  const impactDustRef = useRef<Points>(null)
  const impactLightRef = useRef<PointLight>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const transform = useMemo(
    () => landingSiteToRenderTransform(outpost.site),
    [outpost.site],
  )
  const offset = useMemo(() => deriveSecondaryImpactOffset(outpost), [outpost])
  const ground = useMemo(
    () => sampleRenderedSurface(terrain, segments, offset.xM, offset.zM),
    [offset.xM, offset.zM, segments, terrain],
  )
  const craterGeometry = useMemo(createCraterGeometry, [])
  const rockGeometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const debrisGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const flashGeometry = useMemo(() => new SphereGeometry(1, 12, 8), [])
  const impactDustGeometry = useMemo(createImpactDustGeometry, [])
  const craterMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        emissive: VISUAL_PALETTE.damageEmber,
        emissiveIntensity: 0.04,
        vertexColors: true,
        ...MATERIAL_RESPONSE.contact,
      }),
    [],
  )
  const ejectaMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.damageRim,
        roughness: 0.98,
        metalness: 0,
      }),
    [],
  )
  const wreckageMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerHeatDark,
        emissive: VISUAL_PALETTE.damageEmber,
        emissiveIntensity: 0.08,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const shardMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.damageHeat,
        emissive: VISUAL_PALETTE.damageEmber,
        emissiveIntensity: 0.16,
        ...MATERIAL_RESPONSE.playerHeatDark,
      }),
    [],
  )
  const flashMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ffd7ad',
        depthWrite: false,
        opacity: 0.88,
        toneMapped: false,
        transparent: true,
      }),
    [],
  )
  const impactDustMaterial = useMemo(
    () =>
      new PointsMaterial({
        color: '#a98a70',
        depthWrite: false,
        opacity: 0.72,
        size: 0.00034,
        sizeAttenuation: true,
        toneMapped: true,
        transparent: true,
      }),
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
          0.08,
          Math.sin(angle) * radius,
        )
        dummy.rotation.set(
          (deterministicVariation(index, 10) - 0.5) * 0.12,
          -angle + (deterministicVariation(index, 11) - 0.5) * 0.3,
          (deterministicVariation(index, 12) - 0.5) * 0.18,
        )
        dummy.scale.set(
          1.1 + deterministicVariation(index, 13) * 2.2,
          0.08 + deterministicVariation(index, 14) * 0.08,
          0.18 + deterministicVariation(index, 15) * 0.22,
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
      for (let index = 0; index < IMPACT_SHARD_COUNT; index += 1) {
        dummy.position.set(0, 0, 0)
        dummy.rotation.set(index * 0.37, index * 0.51, index * 0.22)
        dummy.scale.setScalar(0.42 + (index % 5) * 0.12)
        dummy.updateMatrix()
        shards.setMatrixAt(index, dummy.matrix)
      }
      shards.instanceMatrix.needsUpdate = true
    }
  }, [offset.xM, offset.zM, outpost.extractor?.position])

  useEffect(
    () => () => {
      craterGeometry.dispose()
      rockGeometry.dispose()
      debrisGeometry.dispose()
      flashGeometry.dispose()
      impactDustGeometry.dispose()
      craterMaterial.dispose()
      ejectaMaterial.dispose()
      wreckageMaterial.dispose()
      shardMaterial.dispose()
      flashMaterial.dispose()
      impactDustMaterial.dispose()
      delete gl.domElement.dataset.counterstrikeImpactEffect
      delete gl.domElement.dataset.counterstrikeDamageField
      delete gl.domElement.dataset.counterstrikeEjectaCount
      delete gl.domElement.dataset.secondaryImpactX
      delete gl.domElement.dataset.secondaryImpactZ
    },
    [
      craterGeometry,
      craterMaterial,
      debrisGeometry,
      ejectaMaterial,
      flashGeometry,
      flashMaterial,
      gl,
      impactDustGeometry,
      impactDustMaterial,
      rockGeometry,
      shardMaterial,
      wreckageMaterial,
    ],
  )

  useFrame(() => {
    if (!transientImpact) return
    const permanentRoot = permanentRootRef.current
    const transientRoot = transientRootRef.current
    const flash = flashRef.current
    const shards = shardsRef.current
    const dust = impactDustRef.current
    const impactLight = impactLightRef.current
    if (
      permanentRoot === null ||
      transientRoot === null ||
      flash === null ||
      shards === null ||
      dust === null ||
      impactLight === null
    ) {
      return
    }

    const progress = getCounterstrikeRunProgress(run, performance.now())
    const contacted = progress >= IMPACT_CONTACT_PROGRESS
    const impactProgress = MathUtils.clamp(
      (progress - IMPACT_CONTACT_PROGRESS) / 0.34,
      0,
      1,
    )
    const effectActive = contacted && impactProgress < 1
    permanentRoot.visible = permanent && contacted
    transientRoot.visible = effectActive
    gl.domElement.dataset.counterstrikeDamageField = permanentRoot.visible
      ? 'persistent'
      : 'hidden'

    if (!effectActive) {
      impactLight.intensity = 0
      delete gl.domElement.dataset.counterstrikeImpactEffect
      return
    }

    const flashEnvelope = Math.sin(
      Math.PI * Math.min(1, impactProgress / 0.34),
    )
    flash.scale.setScalar(1.4 + impactProgress * 8.6)
    flashMaterial.opacity = Math.max(
      0,
      flashEnvelope * 0.9 - impactProgress * 0.28,
    )
    impactLight.intensity = flashEnvelope * 0.0007
    dust.scale.setScalar(0.72 + impactProgress * 3.9)
    dust.position.y =
      impactProgress * 3.4 - impactProgress * impactProgress * 1.2
    impactDustMaterial.opacity = Math.max(0, 0.76 - impactProgress * 0.68)

    const dummy = dummyRef.current
    for (let index = 0; index < IMPACT_SHARD_COUNT; index += 1) {
      const angle = index * 2.399963229728653
      const speed = 4.2 + deterministicVariation(index, 18) * 8.4
      const distance = impactProgress * speed
      dummy.position.set(
        Math.cos(angle) * distance,
        impactProgress * (3.2 + (index % 6) * 1.25) -
          impactProgress * impactProgress * 8.8,
        Math.sin(angle) * distance,
      )
      dummy.rotation.set(
        index * 0.37 + impactProgress * 4.2,
        index * 0.51 + impactProgress * 5.4,
        index * 0.22 + impactProgress * 3.8,
      )
      dummy.scale.set(
        0.36 + (index % 4) * 0.12,
        0.18 + (index % 3) * 0.08,
        0.48 + deterministicVariation(index, 19) * 0.44,
      )
      dummy.updateMatrix()
      shards.setMatrixAt(index, dummy.matrix)
    }
    shards.instanceMatrix.needsUpdate = true
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
        scale={LOCAL_METRES_TO_RENDER_UNITS * DAMAGE_MODEL_SCALE}
      >
        {permanent ? (
          <group
            ref={permanentRootRef}
            name="counterstrike-permanent-damage-field"
            visible={!transientImpact}
          >
            <mesh geometry={craterGeometry} material={craterMaterial} />
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
          <group ref={transientRootRef} visible={false}>
            <pointLight
              ref={impactLightRef}
              color="#ffb26b"
              decay={2}
              distance={0.006}
              intensity={0}
            />
            <mesh
              ref={flashRef}
              geometry={flashGeometry}
              material={flashMaterial}
            />
            <instancedMesh
              ref={shardsRef}
              args={[debrisGeometry, shardMaterial, IMPACT_SHARD_COUNT]}
            />
            <points
              ref={impactDustRef}
              geometry={impactDustGeometry}
              material={impactDustMaterial}
            />
          </group>
        ) : null}
      </group>
    </group>
  )
}
