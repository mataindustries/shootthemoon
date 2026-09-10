import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, InstancedMesh, MathUtils, MeshBasicMaterial, Object3D, PerspectiveCamera } from 'three'
import { getCounterstrikeRunProgress, type CounterstrikeRunState } from '../simulation/counterstrikeSimulation.ts'

const FRAME_RIBS = [
  [-0.94, -0.3, 0.045, 0.8, -0.08],
  [-0.77, -0.72, 0.36, 0.06, 0],
  [-0.89, -0.68, 0.045, 0.22, -0.65],
] as const

// Three low-poly structural ribs, one draw call. Confined to the lower/left
// screen edge, clear of the two vehicles and faded away as the rail opens up.
export function InterceptorFrame({ run }: { readonly run: CounterstrikeRunState }) {
  const root = useRef<Group>(null)
  const ribs = useRef<InstancedMesh>(null)
  const material = useRef<MeshBasicMaterial>(null)
  const dummy = useRef(new Object3D())
  useFrame(({ camera, gl }) => {
    if (!root.current || !ribs.current || !material.current) return
    const progress = getCounterstrikeRunProgress(run, performance.now())
    const opacity = 1 - MathUtils.smoothstep(progress, 0.12, 0.38)
    root.current.visible = run.status === 'interceptor-launched' && opacity > 0
    gl.domElement.dataset.interceptorFrame = root.current.visible ? 'visible' : 'hidden'
    if (!root.current.visible) return
    root.current.position.copy(camera.position)
    root.current.quaternion.copy(camera.quaternion)
    const projection = camera as PerspectiveCamera
    const halfHeight = Math.tan(MathUtils.degToRad(projection.fov / 2)) * 0.08
    const halfWidth = halfHeight * projection.aspect
    for (let index = 0; index < FRAME_RIBS.length; index++) {
      const [x, y, width, height, roll] = FRAME_RIBS[index]!
      dummy.current.position.set(x * halfWidth, y * halfHeight, -0.08)
      dummy.current.rotation.set(0, 0, roll)
      dummy.current.scale.set(width * halfWidth, height * halfHeight, 0.001)
      dummy.current.updateMatrix()
      ribs.current.setMatrixAt(index, dummy.current.matrix)
    }
    ribs.current.instanceMatrix.needsUpdate = true
    material.current.opacity = opacity * 0.9
  })
  return <group ref={root} name="interceptor-structural-frame">
    <instancedMesh ref={ribs} args={[undefined, undefined, 3]} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial ref={material} color="#59616b" transparent depthWrite={false} />
    </instancedMesh>
  </group>
}
