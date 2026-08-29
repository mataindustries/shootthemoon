import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { LunarScarSnapshot } from '../domain/firstStrike.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'

export const PERMANENT_SCAR_RADIUS = 0.052
const SCAR_CLEARANCE = 0.00052

interface PermanentLunarScarProps {
  readonly scar: LunarScarSnapshot
  readonly focused: boolean
}

function createScarRayGeometry(): BufferGeometry {
  const positions: number[] = []
  const count = 14

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.08
    const innerRadius = 0.78 + (index % 4) * 0.04
    const outerRadius = 1.08 + (index % 5) * 0.055
    const innerWidth = 0.035 + (index % 2) * 0.018
    const outerWidth = innerWidth * 0.28
    const radialX = Math.sin(angle)
    const radialZ = Math.cos(angle)
    const tangentX = Math.cos(angle)
    const tangentZ = -Math.sin(angle)
    const innerLeft = [
      radialX * innerRadius + tangentX * innerWidth,
      0.004,
      radialZ * innerRadius + tangentZ * innerWidth,
    ]
    const innerRight = [
      radialX * innerRadius - tangentX * innerWidth,
      0.004,
      radialZ * innerRadius - tangentZ * innerWidth,
    ]
    const outerLeft = [
      radialX * outerRadius + tangentX * outerWidth,
      0.004,
      radialZ * outerRadius + tangentZ * outerWidth,
    ]
    const outerRight = [
      radialX * outerRadius - tangentX * outerWidth,
      0.004,
      radialZ * outerRadius - tangentZ * outerWidth,
    ]

    positions.push(
      ...innerLeft,
      ...innerRight,
      ...outerLeft,
      ...outerLeft,
      ...innerRight,
      ...outerRight,
    )
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function PermanentLunarScar({
  scar,
  focused,
}: PermanentLunarScarProps) {
  const gl = useThree((state) => state.gl)
  const projectedRef = useRef(new Vector3())
  const cameraDirectionRef = useRef(new Vector3())
  const transform = useMemo(
    () => landingSiteToRenderTransform(scar.site),
    [scar.site],
  )
  const position = useMemo(
    () =>
      transform.position.clone().addScaledVector(transform.up, SCAR_CLEARANCE),
    [transform.position, transform.up],
  )
  const outerGeometry = useMemo(() => new CircleGeometry(1, 48), [])
  const innerGeometry = useMemo(() => new CircleGeometry(0.58, 36), [])
  const rimGeometry = useMemo(() => new TorusGeometry(0.74, 0.18, 5, 40), [])
  const wreckageGeometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const failureGeometry = useMemo(() => new OctahedronGeometry(1, 0), [])
  const rayGeometry = useMemo(createScarRayGeometry, [])
  const outerMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#171313',
        metalness: 0.03,
        roughness: 1,
        side: DoubleSide,
      }),
    [],
  )
  const innerMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#261512',
        emissive: '#8b2b16',
        emissiveIntensity: focused ? 0.48 : 0.25,
        metalness: 0.08,
        roughness: 0.94,
        side: DoubleSide,
      }),
    [focused],
  )
  const rimMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#352d2b',
        emissive: '#5a1d13',
        emissiveIntensity: focused ? 0.28 : 0.1,
        metalness: 0.08,
        roughness: 1,
      }),
    [focused],
  )
  const wreckageMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#18252b',
        emissive: '#244d53',
        emissiveIntensity: 0.22,
        metalness: 0.78,
        roughness: 0.48,
      }),
    [],
  )
  const failureMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: '#74e4ec',
        depthWrite: false,
        opacity: focused ? 0.74 : 0.46,
        toneMapped: false,
        transparent: true,
      }),
    [focused],
  )

  useEffect(
    () => () => {
      outerGeometry.dispose()
      innerGeometry.dispose()
      rimGeometry.dispose()
      wreckageGeometry.dispose()
      failureGeometry.dispose()
      rayGeometry.dispose()
      outerMaterial.dispose()
      innerMaterial.dispose()
      rimMaterial.dispose()
      wreckageMaterial.dispose()
      failureMaterial.dispose()
      delete gl.domElement.dataset.scarX
      delete gl.domElement.dataset.scarY
      delete gl.domElement.dataset.scarFacingCamera
    }, [
      failureGeometry,
      failureMaterial,
      gl,
      innerGeometry,
      innerMaterial,
      outerGeometry,
      outerMaterial,
      rayGeometry,
      rimGeometry,
      rimMaterial,
      wreckageGeometry,
      wreckageMaterial,
    ],
  )

  useFrame((state) => {
    const projected = projectedRef.current.copy(position).project(state.camera)
    const cameraDirection = cameraDirectionRef.current
      .copy(state.camera.position)
      .normalize()
    gl.domElement.dataset.scarX = String(
      Math.round((projected.x * 0.5 + 0.5) * state.size.width),
    )
    gl.domElement.dataset.scarY = String(
      Math.round((-projected.y * 0.5 + 0.5) * state.size.height),
    )
    gl.domElement.dataset.scarFacingCamera = String(
      transform.up.dot(cameraDirection) > 0,
    )
  })

  return (
    <group position={position} quaternion={transform.orientation}>
      <group scale={PERMANENT_SCAR_RADIUS}>
        <mesh geometry={rayGeometry} material={outerMaterial} />
        <mesh
          geometry={outerGeometry}
          material={outerMaterial}
          rotation-x={-Math.PI / 2}
        />
        <mesh
          geometry={innerGeometry}
          material={innerMaterial}
          position-y={0.0008}
          rotation-x={-Math.PI / 2}
        />
        <mesh
          geometry={rimGeometry}
          material={rimMaterial}
          position-y={0.0016}
          rotation-x={-Math.PI / 2}
          scale={[1, 1, 0.22]}
        />

        <mesh
          geometry={wreckageGeometry}
          material={wreckageMaterial}
          position={[-0.22, 0.075, 0.06]}
          rotation={[0.2, 0.48, -0.62]}
          scale={[0.24, 0.08, 0.07]}
        />
        <mesh
          geometry={wreckageGeometry}
          material={wreckageMaterial}
          position={[0.18, 0.045, -0.17]}
          rotation={[-0.28, -0.34, 0.38]}
          scale={[0.18, 0.055, 0.08]}
        />
        <mesh
          geometry={failureGeometry}
          material={failureMaterial}
          position={[-0.18, 0.13, 0.04]}
          scale={focused ? 0.055 : 0.04}
        />
        <mesh
          geometry={failureGeometry}
          material={failureMaterial}
          position={[0.16, 0.085, -0.13]}
          scale={focused ? 0.036 : 0.026}
        />
      </group>
    </group>
  )
}
