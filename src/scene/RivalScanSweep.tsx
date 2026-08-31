import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
} from 'three'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import {
  createRivalSurfaceAttachment,
  type RivalSurfaceAttachment,
} from './RivalFoothold.tsx'

const SAMPLE_COUNT = 10

interface ScanSample {
  readonly angleRad: number
  readonly radiusM: number
}

export interface RivalScanSweepProps {
  readonly rival: RivalSignalSnapshot
  readonly presentation: RivalPresentationState
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}

function wrappedAngleDifference(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function createScanSamples(site: LandingSite): readonly ScanSample[] {
  const coordinateSeed =
    Math.abs(
      Math.round(site.location.latitudeRad * 10_000) ^
        Math.round(site.location.longitudeRad * 10_000),
    ) % 997
  const offset = (coordinateSeed / 997) * Math.PI * 2

  return Array.from({ length: SAMPLE_COUNT }, (_, index) => ({
    angleRad: offset + index * 2.399963229728653,
    radiusM: 5.5 + ((index * 7 + coordinateSeed) % 17),
  }))
}

export function RivalScanSweep({
  rival,
  presentation,
  terrain,
  segments,
}: RivalScanSweepProps) {
  const sweepRef = useRef<Group>(null)
  const sampleRef = useRef<InstancedMesh>(null)
  const coreRef = useRef<Group>(null)
  const dummyRef = useRef(new Object3D())
  const identity = getRivalIdentity(rival.identityId)
  const attachment: RivalSurfaceAttachment = useMemo(
    () => createRivalSurfaceAttachment(rival.site, terrain, segments),
    [rival.site, segments, terrain],
  )
  const samples = useMemo(() => createScanSamples(rival.site), [rival.site])
  const sweepGeometry = useMemo(
    () => new RingGeometry(0.94, 1, 30, 1, -0.14, 0.28),
    [],
  )
  const echoGeometry = useMemo(
    () => new RingGeometry(0.96, 1, 24, 1, -0.09, 0.18),
    [],
  )
  const sampleGeometry = useMemo(() => new BoxGeometry(0.18, 0.1, 1.1), [])
  const coreGeometry = useMemo(() => new OctahedronGeometry(0.46, 0), [])
  const sweepMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        depthWrite: false,
        emissive: identity.palette.signal,
        emissiveIntensity: EMISSIVE_LIMITS.panel,
        opacity: 0,
        roughness: 0.62,
        side: DoubleSide,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const echoMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalFrame,
        depthWrite: false,
        emissive: VISUAL_PALETTE.rivalCyanEmissive,
        emissiveIntensity: 0.3,
        opacity: 0,
        roughness: 0.72,
        side: DoubleSide,
        transparent: true,
      }),
    [],
  )
  const sampleMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        depthWrite: false,
        emissive: identity.palette.signal,
        emissiveIntensity: 0.36,
        opacity: 0,
        roughness: 0.58,
        transparent: true,
      }),
    [identity.palette.signal],
  )
  const coreMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        emissive: identity.palette.signal,
        emissiveIntensity: EMISSIVE_LIMITS.activePanel,
        ...MATERIAL_RESPONSE.rivalPanel,
      }),
    [identity.palette.signal],
  )

  useLayoutEffect(() => {
    const mesh = sampleRef.current

    if (mesh === null) {
      return
    }

    const dummy = dummyRef.current

    samples.forEach((sample, index) => {
      dummy.position.set(
        Math.sin(sample.angleRad) * sample.radiusM,
        0.22,
        Math.cos(sample.angleRad) * sample.radiusM,
      )
      dummy.rotation.set(0, sample.angleRad, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [samples])

  useEffect(
    () => () => {
      sweepGeometry.dispose()
      echoGeometry.dispose()
      sampleGeometry.dispose()
      coreGeometry.dispose()
      sweepMaterial.dispose()
      echoMaterial.dispose()
      sampleMaterial.dispose()
      coreMaterial.dispose()
    },
    [
      coreGeometry,
      coreMaterial,
      echoGeometry,
      echoMaterial,
      sampleGeometry,
      sampleMaterial,
      sweepGeometry,
      sweepMaterial,
    ],
  )

  useFrame(() => {
    const sweep = sweepRef.current
    const sampleMesh = sampleRef.current
    const core = coreRef.current

    if (sweep === null || sampleMesh === null || core === null) {
      return
    }

    const active = presentation.phase === 'scanning'
    const progress = active
      ? getRivalPresentationProgress(presentation, performance.now())
      : 0
    sweep.visible = active
    core.visible = active
    sampleMesh.visible = active

    if (!active) {
      sweepMaterial.opacity = 0
      echoMaterial.opacity = 0
      sampleMaterial.opacity = 0
      return
    }

    const eased = progress * progress * (3 - 2 * progress)
    const envelope = Math.sin(progress * Math.PI)
    const sweepAngle = -0.7 + eased * Math.PI * 2.7
    const radiusM = 4.5 + eased * 23
    sweep.rotation.y = sweepAngle
    sweep.scale.setScalar(radiusM)
    sweepMaterial.opacity = envelope * 0.42
    echoMaterial.opacity = envelope * 0.22
    sampleMaterial.opacity = 0.16 + envelope * 0.24
    core.scale.setScalar(0.84 + Math.sin(progress * Math.PI * 4) * 0.12)
    coreMaterial.emissiveIntensity =
      EMISSIVE_LIMITS.panel + envelope * 0.12

    const dummy = dummyRef.current

    samples.forEach((sample, index) => {
      const difference = Math.abs(
        wrappedAngleDifference(sample.angleRad, sweepAngle),
      )
      const response = Math.exp(-difference * 8.5) * envelope
      dummy.position.set(
        Math.sin(sample.angleRad) * sample.radiusM,
        0.22 + response * 0.34,
        Math.cos(sample.angleRad) * sample.radiusM,
      )
      dummy.rotation.set(0, sample.angleRad, 0)
      dummy.scale.set(
        0.72 + response * 0.82,
        0.7 + response * 2.1,
        0.72,
      )
      dummy.updateMatrix()
      sampleMesh.setMatrixAt(index, dummy.matrix)
    })
    sampleMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group position={attachment.position} quaternion={attachment.orientation}>
      <group
        name="rival-scan-sweep"
        position-z={-1.18 * LOCAL_METRES_TO_RENDER_UNITS}
        rotation-y={rival.surfaceHeadingRad}
        scale={LOCAL_METRES_TO_RENDER_UNITS}
      >
        <group ref={sweepRef}>
          <mesh
            geometry={sweepGeometry}
            material={sweepMaterial}
            position-y={0.3}
            rotation-x={-Math.PI / 2}
          />
          <mesh
            geometry={echoGeometry}
            material={echoMaterial}
            position-y={0.34}
            rotation-x={-Math.PI / 2}
            scale={0.78}
          />
        </group>
        <instancedMesh
          ref={sampleRef}
          args={[sampleGeometry, sampleMaterial, SAMPLE_COUNT]}
        />
        <group ref={coreRef} position-y={1.42}>
          <mesh geometry={coreGeometry} material={coreMaterial} />
        </group>
      </group>
    </group>
  )
}
