import { useLayoutEffect, useRef } from 'react'
import { InstancedMesh, Object3D } from 'three'
import type { ModelBatch, OctagonalKit } from '../render/octagonalKit.ts'

export function OctagonalModel({ batches, kit }: { readonly batches: ModelBatch[]; readonly kit: OctagonalKit }) {
  return batches.map(({ finish, geometry }) => <mesh key={finish} geometry={geometry} material={kit.materials[finish]} />)
}

export interface FleetPose {
  readonly position: readonly [number, number, number]
  readonly heading: number
  readonly bank: number
  readonly scale: number
}

function FleetBatch({ batch, kit, poses }: { readonly batch: ModelBatch; readonly kit: OctagonalKit; readonly poses: FleetPose[] }) {
  const mesh = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!mesh.current) return
    const transform = new Object3D()
    poses.forEach((pose, i) => {
      transform.position.fromArray(pose.position)
      transform.rotation.set(0, pose.heading, pose.bank)
      transform.scale.setScalar(pose.scale)
      transform.updateMatrix()
      mesh.current!.setMatrixAt(i, transform.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [poses])
  return <instancedMesh ref={mesh} args={[batch.geometry, kit.materials[batch.finish], poses.length]} />
}

/** The whole formation shares four draws; transforms follow authored simulation time. */
export function OctagonalFleet({ batches, kit, poses }: { readonly batches: ModelBatch[]; readonly kit: OctagonalKit; readonly poses: FleetPose[] }) {
  return batches.map(batch => <FleetBatch key={batch.finish} batch={batch} kit={kit} poses={poses} />)
}
