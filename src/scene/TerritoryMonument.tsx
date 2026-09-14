import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Group } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { MONUMENTS, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS as M } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { baseDetailsVisible } from './monumentPresentation.ts'
import { OctagonalModel } from './OctagonalModel.tsx'
import { authorDrone, authorMonument } from './octagonalModels.ts'
import { WaveDefense } from './WaveDefense.tsx'

/** Orbital cameras never draw the detailed base kit, even during a return journey. */
export function SurfaceDetail({ children, name }: { readonly children: ReactNode; readonly name: string }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => { if (group.current) group.current.visible = baseDetailsVisible(camera.position.length()) })
  return <group ref={group} name={name}>{children}</group>
}

export function TerritoryMonument({ monument, site, terrain, segments, onFocus, sampledAtMs, running }: {
  readonly monument: TerritoryMonumentSnapshot
  readonly site: LandingSite
  readonly terrain: SurfaceTerrainProfile | null
  readonly segments: number
  readonly onFocus: () => void
  readonly sampledAtMs: number
  readonly running: boolean
}) {
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const signal = useRef<Group>(null)
  const kit = useMemo(createOctagonalKit, [])
  const crown = monument.kind === 'CRATER_CROWN'
  // A legible perimeter around the smaller landing basin, within its terrain patch.
  // Only the presentation footprint changes; the saved territory/anchor stays canonical.
  const crownScale = crown && monument.anchor === 'outpost' ? .5 : 1
  const turretMount = useMemo<[number, number, number]>(() => {
    // Crown turret bolts to the existing front tower; other mounts seat on sampled terrain.
    if (crown) {
      const ground = monument.anchor === 'outpost' && terrain ? sampleRenderedSurface(terrain, segments, 0, .043 * crownScale / M).y : 0
      return [0, ground + .026 * crownScale + .002, .043 * crownScale]
    }
    const ground = terrain ? sampleRenderedSurface(terrain, segments, .022 / M, .013 / M).y : 0
    return [.022, ground + .0022, .013]
  }, [crown, crownScale, monument.anchor, terrain, segments])
  const model = useMemo(() => batchOctagonalModel(kit, add => authorMonument(monument.kind, (shape, finish, position, scale, rotation) => {
    if (crown && monument.anchor === 'outpost' && terrain !== null) {
      const unit = .001 * crownScale
      const ground = sampleRenderedSurface(terrain, segments, position[0] * unit / M, position[2] * unit / M).y
      // Footings start at model y=.6. Seat them on the rendered triangles + .5 m.
      position = [position[0], position[1] - .6 + (ground + .5 * M - .0007) / unit, position[2]]
    }
    add(shape, finish, position, scale, rotation)
  })), [kit, monument.kind, monument.anchor, crown, crownScale, terrain, segments])
  const fleet = useMemo(() => batchOctagonalModel(kit, authorDrone), [kit])
  useEffect(() => () => disposeOctagonalKit(kit), [kit])
  useEffect(() => () => model.forEach(batch => batch.geometry.dispose()), [model])
  useEffect(() => () => fleet.forEach(batch => batch.geometry.dispose()), [fleet])
  useFrame(({ clock, camera }) => {
    if (signal.current) signal.current.scale.setScalar(Math.max(1, Math.min(4, camera.position.distanceTo(transform.position) / .65)) * (1 + Math.sin(clock.elapsedTime * 2) * .07))
  })
  const progress = monument.workMs / MONUMENTS[monument.kind].laborMs
  const complete = monument.status === 'complete'
  const damaged = monument.status === 'damaged' || monument.status === 'repairing'
  const height = monument.kind === 'HELIOS_SPIRE' ? .075 : .045
  const signalHeight = crown ? .029 : monument.kind === 'SIGNAL_ARRAY' ? .084 : height + .016
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 10 || transform.position.dot(event.camera.position) < 1) return
    event.stopPropagation()
    onFocus()
  }
  return <group position={transform.position} quaternion={transform.orientation} name="territory-monument" onClick={onClick} dispose={null}>
    <group position-y={.0007}>
      <group name="monument-detail" rotation-z={damaged ? -.08 : 0}>
        <group scale={[.001 * crownScale, .001 * crownScale * Math.max(.08, progress), .001 * crownScale]} name="monument-construction">
          <OctagonalModel batches={model} kit={kit} />
        </group>
        {!complete && !crown ? [-1, 1].map(x => <mesh key={x} geometry={kit.shapes.box} material={kit.materials.gold}
          scale={[.0007, height, .0007]} position={[x * .016, height / 2, -.012]} />) : null}
        {damaged ? <mesh geometry={kit.shapes.bevel} material={kit.materials.dark} scale={[.012, .004, .008]} rotation-z={.3} position={[.014, .003, .017]} /> : null}
      </group>
      {complete ? <group ref={signal} name="territory-claim-signal" position-y={signalHeight}>
        <mesh geometry={kit.shapes.ring} material={kit.materials.amber} scale={[.01, .01, .007]} rotation-x={Math.PI / 2} />
        <mesh geometry={kit.shapes.bevel} material={kit.materials.amber} scale={[.0012, .012, .0012]} />
      </group> : null}
    </group>
    {monument.status === 'command' || monument.status === 'wave' ? <WaveDefense
      view={monument} kit={kit} fleet={fleet} mount={turretMount} sampledAtMs={sampledAtMs} running={running}
    /> : null}
  </group>
}
