import { useEffect, useMemo, useRef } from 'react'
import { DynamicDrawUsage, InstancedMesh, Matrix4, Object3D } from 'three'
import { useFrame } from '@react-three/fiber'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { OutpostOperationsMetrics } from '../simulation/outpostOperations.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS as M } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { createMiningKit, disposeMiningKit } from '../render/miningKit.ts'
import { createMiningRobotModels } from './miningModels.ts'
import { advanceWorkerNavigation, CAPSULE_SERVICE_ANCHOR, createWorkerNavigation, WORKER_SCALE_M } from './miningPresentation.ts'
import { useDemandAnimation } from '../render/useDemandAnimation.ts'
import { E2E_HARNESS_BUILD_ENABLED, shouldEnableE2eHarness } from '../testing/e2eHarness.ts'

interface OperationalRobotFleetProps {
  readonly outpost: OutpostSnapshot
  readonly operations: OutpostOperationsMetrics
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
  readonly damaged?: boolean
}

/** Instanced assemblies for the existing three robots. The simulation and
 * saved snapshot never consume these poses, cargo meshes or tool animations. */
export function OperationalRobotFleet({ outpost, operations, terrain, segments, damaged = false }: OperationalRobotFleetProps) {
  const motionClock = useRef(createWorkerNavigation())
  useDemandAnimation(operations.activeRobots > 0)
  const refs = useRef<Record<string, InstancedMesh | null>>({})
  const transform = useMemo(() => landingSiteToRenderTransform(outpost.site), [outpost.site])
  const kit = useMemo(createMiningKit, [])
  const models = useMemo(() => createMiningRobotModels(kit, true), [kit])
  const root = useMemo(() => new Object3D(), [])
  const part = useMemo(() => new Object3D(), [])
  const matrix = useMemo(() => new Matrix4(), [])
  const isE2e = useMemo(() => shouldEnableE2eHarness(E2E_HARNESS_BUILD_ENABLED, window.location.search), [])
  useEffect(() => () => {
    Object.values(models).forEach(geometry => geometry.dispose())
    disposeMiningKit(kit)
  }, [kit, models])

  useFrame(state => {
    if (!outpost.extractor) return
    advanceWorkerNavigation(motionClock.current, outpost, simulationNowMs(), operations.productionPerMin / 8, operations.activeRobots, damaged)
    const seconds = motionClock.current.seconds
    const modelScale = M * WORKER_SCALE_M
    const states: string[] = []
    const poses: number[][] = []
    const write = (name: keyof typeof models, index: number) => {
      part.updateMatrix()
      matrix.multiplyMatrices(root.matrix, part.matrix)
      refs.current[name]?.setMatrixAt(index, matrix)
    }
    for (let index = 0; index < 3; index++) {
      const worker = motionClock.current.workers[index]!
      const working = worker.task === 'working'
      const pose = { ...worker, working, returning: worker.task === 'returning',
        toolAngle: working ? .54 + Math.sin(seconds * 3.2 + index) * .14 : worker.task === 'servicing' ? .24 + Math.sin(seconds * 2) * .04 : -.12,
        sensorYaw: working ? -.2 : Math.sin(seconds * .7 + index) * .18 }
      const enabled = index < operations.activeRobots
      const ground = sampleRenderedSurface(terrain, segments, pose.xM, pose.zM)
      root.position.set(ground.x, ground.y + .42 * modelScale, ground.z)
      root.rotation.set(0, pose.heading, 0)
      root.scale.setScalar(enabled ? modelScale : 0)
      root.updateMatrix()
      part.position.set(0, pose.moving ? Math.sin(seconds * 9 + index) * .018 : 0, 0)
      part.rotation.set(0, 0, 0)
      part.scale.setScalar(1)
      write('body', index)
      part.position.set(-.22, 1.04, -.18)
      part.rotation.set(0, pose.sensorYaw, 0)
      write('sensor', index)
      part.position.set(0, .65, .6)
      part.rotation.set(pose.toolAngle, 0, 0)
      write('arm', index)
      part.position.set(0, .68, -.61)
      part.rotation.set(0, 0, 0)
      part.scale.setScalar(pose.returning && pose.moving ? 1 : 0)
      write('cargo', index)
      part.scale.setScalar(1)
      for (let wheel = 0; wheel < 4; wheel++) {
        const side = wheel < 2 ? -1 : 1
        const x = side * .72, z = (wheel % 2 === 0 ? -1 : 1) * .49
        const surface = sampleRenderedSurface(terrain, segments,
          pose.xM + (x * Math.cos(pose.heading) + z * Math.sin(pose.heading)) * WORKER_SCALE_M,
          pose.zM + (z * Math.cos(pose.heading) - x * Math.sin(pose.heading)) * WORKER_SCALE_M)
        part.position.set(x, -.19 + (surface.y - ground.y) / modelScale, z)
        part.rotation.set(pose.wheelSpin * side, 0, Math.PI / 2)
        write('wheel', index * 4 + wheel)
      }
      if (enabled && isE2e) {
        states.push(worker.task)
        poses.push([pose.xM, pose.zM, pose.heading, pose.toolAngle])
      }
    }
    Object.entries(refs.current).forEach(([name, mesh]) => {
      if (!mesh) return
      mesh.count = operations.activeRobots * (name === 'wheel' ? 4 : 1)
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
    if (isE2e) {
      state.gl.domElement.dataset.workerStates = JSON.stringify(states)
      state.gl.domElement.dataset.workerPoses = JSON.stringify(poses)
      state.gl.domElement.dataset.workerClock = String(seconds)
      state.gl.domElement.dataset.workerRouteRevision = String(motionClock.current.revision)
      state.gl.domElement.dataset.workerDock = CAPSULE_SERVICE_ANCHOR.name
    }
  })
  return <group position={transform.position} quaternion={transform.orientation} name="operational-robot-fleet">
    {(Object.keys(models) as (keyof typeof models)[]).map(name => <instancedMesh key={name}
      ref={mesh => { refs.current[name] = mesh; mesh?.instanceMatrix.setUsage(DynamicDrawUsage) }}
      name={`worker-${name}`} args={[models[name], kit.material, name === 'wheel' ? 12 : 3]} />)}
  </group>
}
