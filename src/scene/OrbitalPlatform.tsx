import { useMemo } from 'react'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import { monumentModifiers } from '../domain/territoryMonument.ts'
import { SIEGE_WAVE_TIMES, siegeIsActive } from '../domain/orbitalSiege.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { LOCAL_METRES_TO_RENDER_UNITS as M } from '../render/localSurface.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'
import type { SurfaceTerrainProfile } from '../render/surfaceTerrain.ts'

/** Small deterministic assembly and three authored drone passes, in outpost coordinates. */
export function OrbitalPlatform({ outpost, terrain, segments }: {
  readonly outpost: OutpostSnapshot
  readonly terrain: SurfaceTerrainProfile
  readonly segments: number
}) {
  const transform = useMemo(() => landingSiteToRenderTransform(outpost.site), [outpost.site])
  const ground = useMemo(() => sampleRenderedSurface(terrain, segments, 0, -6), [terrain, segments])
  const siege = outpost.orbitalSiege
  if (siege === null) return null
  const active = siegeIsActive(siege)
  const damaged = siege.platformHealth < 40
  const progress = siege.progress
  const nextWave = SIEGE_WAVE_TIMES[siege.wavesResolved]
  const approach = nextWave === undefined ? 0 : Math.max(0, 1 - (nextWave - siege.elapsedMs) / (4000 * monumentModifiers(outpost.monument).detection))
  const drones = siege.status === 'waves' && approach > 0
  const color = damaged ? '#ff7044' : siege.status === 'operational' ? '#80f0e4' : '#e9b576'
  return <group position={transform.position} quaternion={transform.orientation}>
    <group position={[ground.x, ground.y, ground.z]} scale={M} name="orbital-platform">
      <group position={[0, 11, 0]} rotation-z={damaged ? -0.22 : 0}>
        <mesh><boxGeometry args={[4, 1.1, 2.4]} /><meshStandardMaterial color={damaged ? '#302a2a' : '#778891'} metalness={0.7} roughness={0.45} wireframe={progress < 0.2} /></mesh>
        {[-1, 1].map((side) => <group key={side} position-x={side * (3.8 + (1 - progress) * 3)} rotation-z={damaged && side === 1 ? -0.7 : 0}>
          <mesh><boxGeometry args={[3.4, .18, 3]} /><meshStandardMaterial color="#1d3c51" metalness={0.6} roughness={0.4} wireframe={progress < 0.55} /></mesh>
          {[0, 1, 2].map((i) => <mesh key={i} position={[i - 1, .12, 0]}><boxGeometry args={[.07, .04, 2.8]} /><meshBasicMaterial color={color} /></mesh>)}
        </group>)}
        {progress > .7 ? <mesh position-y={1.2}><coneGeometry args={[.5, 1.8, 8]} /><meshStandardMaterial color="#acbdc4" /></mesh> : null}
        <mesh position={[0, 0, 1.25]}><boxGeometry args={[2.5 * Math.max(.05, progress), .24, .1]} /><meshBasicMaterial color={color} /></mesh>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[6.5, .05, 4, 40]} /><meshBasicMaterial color={color} transparent opacity={.5} /></mesh>
      </group>
      {active && siege.status !== 'waves' ? [-1, 1].map((side) => <mesh key={side} position={[side * 2, 5.5, 0]}><cylinderGeometry args={[.035, .1, 11, 4]} /><meshBasicMaterial color="#f5b267" transparent opacity={.35} /></mesh>) : null}
      {drones ? [0, 1, 2, 3, 4].map((i) => <group key={`${siege.wavesResolved}-${i}`} position={[(1 - approach) * (23 + i * 2) + i - 2, 11 + (1 - approach) * 6 + (i % 2), (i - 2) * 2]}>
        <mesh rotation-z={Math.PI / 4}><octahedronGeometry args={[.7]} /><meshBasicMaterial color="#ff674a" /></mesh>
        <mesh><boxGeometry args={[2, .15, .3]} /><meshStandardMaterial color="#522b28" /></mesh>
      </group>) : null}
      {drones && siege.order !== 'MINE' ? <mesh position={[3, 6, 0]} rotation-z={-.3}><cylinderGeometry args={[.05, .09, 11, 4]} /><meshBasicMaterial color="#99fcf4" /></mesh> : null}
      {siege.outpostDamage > 0 ? <mesh position={[5, .4, 2]} rotation-x={-Math.PI / 2}><ringGeometry args={[1.4, 3.8, 12]} /><meshBasicMaterial color="#512c28" /></mesh> : null}
    </group>
  </group>
}
