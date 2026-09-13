import { useEffect, useMemo } from 'react'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { monumentModifiers } from '../domain/territoryMonument.ts'
import { SIEGE_WAVE_TIMES, siegeIsActive } from '../domain/orbitalSiege.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS as M } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { batchOctagonalModel, createOctagonalKit, disposeOctagonalKit } from '../render/octagonalKit.ts'
import { OctagonalFleet, OctagonalModel } from './OctagonalModel.tsx'
import { authorDrone, authorPlatform } from './octagonalModels.ts'

/** Same outpost anchor, assembly clock and three passes; all dimensions are presentation. */
export function OrbitalPlatform({ outpost, terrain, segments }: {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}) {
  const transform = useMemo(() => landingSiteToRenderTransform(outpost.site), [outpost.site])
  const ground = useMemo(() => sampleRenderedSurface(terrain, segments, 0, -6), [terrain, segments])
  const kit = useMemo(createOctagonalKit, [])
  const platform = useMemo(() => batchOctagonalModel(kit, authorPlatform), [kit])
  const fleet = useMemo(() => batchOctagonalModel(kit, authorDrone), [kit])
  useEffect(() => () => disposeOctagonalKit(kit), [kit])
  useEffect(() => () => [...platform, ...fleet].forEach(batch => batch.geometry.dispose()), [platform, fleet])
  const siege = outpost.orbitalSiege
  if (siege === null) return null
  const active = siegeIsActive(siege)
  const damaged = siege.platformHealth < 40
  const progress = siege.progress
  const nextWave = SIEGE_WAVE_TIMES[siege.wavesResolved]
  const approach = nextWave === undefined ? 0 : Math.max(0, 1 - (nextWave - siege.elapsedMs) / (4000 * monumentModifiers(outpost.monument).detection))
  const drones = siege.status === 'waves' && approach > 0
  return <group position={transform.position} quaternion={transform.orientation} dispose={null}>
    <group position={[ground.x, ground.y, ground.z]} scale={M} name="orbital-platform">
      <group position={[0, 11, 0]} rotation-z={damaged ? -.22 : 0} scale-y={.4 + progress * .6}>
        <OctagonalModel batches={platform} kit={kit} />
        <mesh geometry={kit.shapes.box} material={damaged ? kit.materials.amber : kit.materials.cyan}
          position={[0, .35, 2.8]} scale={[1.7 * Math.max(.05, progress), .14, .08]} />
      </group>
      {active && siege.status !== 'waves' ? [-1, 1].map(side => <mesh key={side}
        geometry={kit.shapes.taper} material={kit.materials.amber} position={[side * 2, 5.5, 0]} scale={[.025, 11, .025]} />) : null}
      {drones ? <OctagonalFleet batches={fleet} kit={kit} poses={[0, 1, 2, 3, 4].map(i => ({
        position: [(1 - approach) * (23 + i * 2) + Math.abs(i - 2) * 1.8, 14.5 + (1 - approach) * 3 + Math.abs(i - 2) * .7, (i - 2) * 3.1],
        heading: Math.PI / 2,
        bank: (i - 2) * .07,
        scale: i === 2 ? .9 : .68,
      }))} /> : null}
      {drones && siege.order !== 'MINE' ? <mesh geometry={kit.shapes.taper} material={kit.materials.cyan}
        position={[3, 6, 0]} rotation-z={-.3} scale={[.045, 11, .045]} /> : null}
      {siege.outpostDamage > 0 ? <mesh position={[5, .4, 2]} rotation-x={-Math.PI / 2}
        geometry={kit.shapes.scar} material={kit.materials.dark} /> : null}
    </group>
  </group>
}
