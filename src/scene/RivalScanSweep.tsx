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
  Group,
  InstancedMesh,
  MeshBasicMaterial,
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
}: RivalScanSweepProps) {
  const sweepRef = useRef<Group>(null)
  const sampleRef = useRef<InstancedMesh>(null)
  const coreRef = useRef<Group>(null)
  const dummyRef = useRef(new Object3D())
  const identity = getRivalIdentity(rival.identityId)
  const attachment: RivalSurfaceAttachment = useMemo(
    () => createRivalSurfaceAttachment(rival.site),
    [rival.site],
  )
  const samples = useMemo(() => createScanSamples(rival.site), [rival.site])
  const sweepGeometry = useMemo(
    () => new RingGeometry(0.78, 1, 28, 1, -0.24, 0.48),
    [],
  )
  const echoGeometry = useMemo(
    () => new RingGeometry(0.9, 1, 20, 1, -0.15, 0.3),
    [],
  )
  const sampleGeometry = useMemo(() => new BoxGeometry(0.22, 0.12, 1.4), [])
  const coreGeometry = useMemo(() => new OctahedronGeometry(0.52, 0), [])
  const sweepMaterial = useMemo(
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
  const echoMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: identity.palette.highlight,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
        transparent: true,
      }),
    [identity.palette.highlight],
  )
  const sampleMaterial = useMemo(
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
    },
    [
      coreGeometry,
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

    if (!active) {
      sweepMaterial.opacity = 0
      echoMaterial.opacity = 0
      sampleMaterial.opacity = 0
      return
    }

    const eased = progress * progress * (3 - 2 * progress)
    const sweepAngle = -0.7 + eased * Math.PI * 2.7
    const radiusM = 4.5 + eased * 23
    sweep.rotation.y = sweepAngle
    sweep.scale.setScalar(radiusM)
    sweepMaterial.opacity = Math.sin(progress * Math.PI) * 0.76
    echoMaterial.opacity = Math.sin(progress * Math.PI) * 0.34
    sampleMaterial.opacity = 0.26 + Math.sin(progress * Math.PI) * 0.42
    core.scale.setScalar(0.8 + Math.sin(progress * Math.PI * 4) * 0.22)

    const dummy = dummyRef.current

    samples.forEach((sample, index) => {
      const difference = Math.abs(
        wrappedAngleDifference(sample.angleRad, sweepAngle),
      )
      const response = Math.exp(-difference * 7.5) * Math.sin(progress * Math.PI)
      dummy.position.set(
        Math.sin(sample.angleRad) * sample.radiusM,
        0.22 + response * 0.48,
        Math.cos(sample.angleRad) * sample.radiusM,
      )
      dummy.rotation.set(0, sample.angleRad, 0)
      dummy.scale.set(0.72 + response * 1.4, 0.65 + response * 3.2, 0.72)
      dummy.updateMatrix()
      sampleMesh.setMatrixAt(index, dummy.matrix)
    })
    sampleMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group position={attachment.position} quaternion={attachment.orientation}>
      <group
        name="rival-scan-sweep"
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
            position-y={0.36}
            rotation-x={-Math.PI / 2}
            scale={0.72}
          />
        </group>
        <instancedMesh
          ref={sampleRef}
          args={[sampleGeometry, sampleMaterial, SAMPLE_COUNT]}
        />
        <group ref={coreRef} position-y={0.82}>
          <mesh geometry={coreGeometry} material={echoMaterial} />
        </group>
      </group>
    </group>
  )
}
