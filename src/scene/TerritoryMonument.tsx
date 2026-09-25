import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Group } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { MONUMENTS, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS as M } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { baseDetailsVisible } from './monumentPresentation.ts'
import { OctagonalModel } from './OctagonalModel.tsx'
import { authorMonument } from './octagonalModels.ts'
import { WaveDefense } from './WaveDefense.tsx'
import { HeliosReactor } from './HeliosReactor.tsx'
import { SignalArray } from './SignalArray.tsx'
import { CraterCrown } from './CraterCrown.tsx'
import { CROWN_CLAIM_Y, CROWN_DAMAGE_TILT, craterCrownDefenseMount, craterCrownLift } from './craterCrownModel.ts'

/** Orbital cameras never draw the detailed base kit, even during a return journey. */
export function SurfaceDetail({ children, name }: { readonly children: ReactNode; readonly name: string }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => { if (group.current) group.current.visible = baseDetailsVisible(camera.position.length()) })
  return <group ref={group} name={name}>{children}</group>
}

export function TerritoryMonument({ monument, site, terrain, segments, onFocus, sampledAtMs, running, revealAtMs = null }: {
  readonly monument: TerritoryMonumentSnapshot
  readonly site: LandingSite
  readonly terrain: SurfaceTerrainProfile | null
  readonly segments: number
  readonly onFocus: () => void
  readonly sampledAtMs: number
  readonly running: boolean
  readonly revealAtMs?: number | null
}) {
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const signal = useRef<Group>(null)
  const kit = useMemo(createOctagonalKit, [])
  const crown = monument.kind === 'CRATER_CROWN'
  // A legible perimeter around the smaller landing basin, within its terrain patch.
  // Only the presentation footprint changes; the saved territory/anchor stays canonical.
  const crownScale = crown && monument.anchor === 'outpost' ? .5 : 1
  const unit = .001 * crownScale
  const progress = monument.workMs / MONUMENTS[monument.kind].laborMs
  const squash = Math.max(.08, progress)
  // One rigid machine: a single lift seats the Crown's authored lunar datum on the rendered ground at its centre.
  const crownLift = useMemo(() => crown ? craterCrownLift(monument.anchor === 'outpost' && terrain
    ? sampleRenderedSurface(terrain, segments, 0, 0).y : 0, unit) : 0, [crown, monument.anchor, terrain, segments, unit])
  const turretMount = useMemo<[number, number, number]>(() => {
    // The Crown turret sits on its cap and rises with the construction; other mounts seat on sampled terrain.
    if (crown) return craterCrownDefenseMount(unit, squash, crownLift)
    const ground = terrain ? sampleRenderedSurface(terrain, segments, .022 / M, .013 / M).y : 0
    return [.022, ground + .0022, .013]
  }, [crown, unit, squash, crownLift, terrain, segments])
  const model = useMemo(() => batchOctagonalModel(kit, add => authorMonument(monument.kind, add)), [kit, monument.kind])
  const modelTop = useMemo(() => Math.max(...model.map(batch => {
    batch.geometry.computeBoundingBox()
    return batch.geometry.boundingBox!.max.y
  })), [model])
  useEffect(() => () => disposeOctagonalKit(kit), [kit])
  useEffect(() => () => model.forEach(batch => batch.geometry.dispose()), [model])
  useFrame(({ clock, camera }) => {
    if (signal.current) signal.current.scale.setScalar(Math.max(1, Math.min(4, camera.position.distanceTo(transform.position) / .65)) * (1 + Math.sin(clock.elapsedTime * 2) * .07))
  })
  // Enemy volleys land on what is visibly built: the construction's current top (held within the interceptor
  // sampler's validated .07 aim band), or the top of the turret gun seated on the Crown's cap.
  const defenseAim: [number, number, number] = crown ? [turretMount[0], turretMount[1] + .009, turretMount[2]]
    : [0, Math.min(.07, .0007 + modelTop * .001 * squash), 0]
  const complete = monument.status === 'complete'
  const damaged = monument.status === 'damaged' || monument.status === 'repairing'
  const height = monument.kind === 'HELIOS_SPIRE' ? .075 : .045
  const signalHeight = crown ? unit * (CROWN_CLAIM_Y + crownLift) : monument.kind === 'SIGNAL_ARRAY' ? .084 : height + .016
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 10 || transform.position.dot(event.camera.position) < 1) return
    event.stopPropagation()
    onFocus()
  }
  return <group position={transform.position} quaternion={transform.orientation} name="territory-monument" onClick={onClick} dispose={null}>
    <group position-y={.0007}>
      <group name="monument-detail" rotation-z={damaged ? crown ? CROWN_DAMAGE_TILT : -.08 : 0}>
        <group scale={[unit, unit * squash, unit]} name="monument-construction">
          {crown ? <CraterCrown kit={kit} model={model} monument={monument} revealAtMs={revealAtMs} lift={crownLift} />
            : <OctagonalModel batches={model} kit={kit} />}
          {complete && monument.kind === 'HELIOS_SPIRE' ? <HeliosReactor kit={kit} running={running} revealAtMs={revealAtMs} /> : null}
          {monument.kind === 'SIGNAL_ARRAY' ? <SignalArray kit={kit} monument={monument} revealAtMs={revealAtMs} /> : null}
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
      view={monument} kit={kit} mount={turretMount} aim={defenseAim} strikeAtMs={OCTOGONALS.waves[monument.wavesResolved]!.durationMs}
      sampledAtMs={sampledAtMs} running={running}
    /> : null}
  </group>
}
