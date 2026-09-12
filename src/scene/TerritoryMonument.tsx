import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { BoxGeometry, CylinderGeometry, Group, MeshStandardMaterial, TorusGeometry } from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { MONUMENTS, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { VISUAL_PALETTE as P, MATERIAL_RESPONSE, EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import { baseDetailsVisible, octogonalApproach } from './monumentPresentation.ts'
import { lunarSphereTangentHeight } from './PermanentLunarScar.tsx'

/** Orbital cameras never draw the detailed base kit, even during a return journey. */
export function SurfaceDetail({ children, name }: { readonly children: ReactNode; readonly name: string }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => { if (group.current) group.current.visible = baseDetailsVisible(camera.position.length()) })
  return <group ref={group} name={name}>{children}</group>
}

export function TerritoryMonument({ monument, site, onFocus }: {
  readonly monument: TerritoryMonumentSnapshot
  readonly site: LandingSite
  readonly onFocus: () => void
}) {
  const transform = useMemo(() => landingSiteToRenderTransform(site), [site])
  const signal = useRef<Group>(null)
  const kit = useMemo(() => ({
    box: new BoxGeometry(1, 1, 1),
    octagon: new CylinderGeometry(1, 1, 1, 8),
    taper: new CylinderGeometry(.18, 1, 1, 4),
    ring: new TorusGeometry(1, .045, 4, 8),
    steel: new MeshStandardMaterial({ color: P.playerComposite, emissive: P.playerSteel, emissiveIntensity: .18, ...MATERIAL_RESPONSE.playerSteel }),
    armor: new MeshStandardMaterial({ color: P.playerArmor, ...MATERIAL_RESPONSE.playerArmor }),
    light: new MeshStandardMaterial({ color: P.monumentIvory, emissive: P.playerAmberEmissive, emissiveIntensity: EMISSIVE_LIMITS.activePanel }),
    octogonal: new MeshStandardMaterial({ color: P.octogonalOchre, ...MATERIAL_RESPONSE.playerArmor }),
    rivalLight: new MeshStandardMaterial({ color: P.octogonalViolet, emissive: P.octogonalViolet, emissiveIntensity: EMISSIVE_LIMITS.panel }),
  }), [])
  useEffect(() => () => { Object.values(kit).forEach((resource) => resource.dispose()) }, [kit])
  useFrame(({ clock, camera }) => {
    if (signal.current) signal.current.scale.setScalar(Math.max(1, Math.min(4, camera.position.distanceTo(transform.position) / .65)) * (1 + Math.sin(clock.elapsedTime * 2) * .07))
  })
  const progress = monument.workMs / MONUMENTS[monument.kind].laborMs
  const complete = monument.status === 'complete'
  const damaged = monument.status === 'damaged' || monument.status === 'repairing'
  const crown = monument.kind === 'CRATER_CROWN'
  // Before First Strike, the authored landing terrain already has a 47 m impact basin.
  const radius = crown ? monument.anchor === 'impact-scar' ? .043 : 47 * .00012 : .018
  const crownScale = radius / .043
  const height = monument.kind === 'HELIOS_SPIRE' ? .075 : .045
  const visibleHeight = Math.max(.08, progress)
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 10 || transform.position.dot(event.camera.position) < 1) return
    event.stopPropagation()
    onFocus()
  }
  return <group position={transform.position} quaternion={transform.orientation} name="territory-monument" onClick={onClick} dispose={null}>
    <group position-y={.0007} rotation-z={damaged ? -.08 : 0}>
      {!crown ? <mesh geometry={kit.octagon} material={kit.armor} scale={[radius, .004, radius]} position-y={.002} /> : null}
      <group scale-y={visibleHeight} name="monument-construction">
        {monument.kind === 'HELIOS_SPIRE' ? <>
          <mesh geometry={kit.taper} material={kit.steel} scale={[.009, height, .009]} position-y={height / 2} />
          <mesh geometry={kit.box} material={kit.light} scale={[.002, height * .8, .002]} position={[.003, height * .55, .003]} />
          <mesh geometry={kit.octagon} material={kit.light} scale={[.004, .008, .004]} position-y={height} />
        </> : null}
        {crown ? Array.from({ length: 8 }, (_, i) => {
          const angle = i * Math.PI / 4
          const x = Math.cos(angle) * radius
          const z = Math.sin(angle) * radius
          return <group key={i} position={[x, lunarSphereTangentHeight(x, z) + .003 * crownScale, z]} rotation-y={-angle} scale={crownScale}>
            <mesh geometry={kit.taper} material={kit.steel} scale={[.006, .015, .007]} position-y={.006} />
            <mesh geometry={kit.box} material={kit.light} scale={[.004, .002, .011]} position-y={.012} />
          </group>
        }) : null}
        {monument.kind === 'BASTION_OBELISK' ? <>
          <mesh geometry={kit.taper} material={kit.steel} scale={[.014, height, .012]} position-y={height / 2} />
          {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}:${z}`} geometry={kit.box} material={kit.armor}
            position={[x * .012, .014, z * .008]} rotation-z={x * .4} scale={[.005, .029, .005]} />))}
          <mesh geometry={kit.box} material={kit.light} scale={[.015, .003, .003]} position={[0, .032, .007]} />
        </> : null}
        {monument.kind === 'SIGNAL_ARRAY' ? <>
          <mesh geometry={kit.taper} material={kit.steel} scale={[.007, .035, .007]} position-y={.018} />
          <mesh geometry={kit.ring} material={kit.steel} scale={.026} position-y={.043} rotation-x={-.25} />
          {[0, Math.PI / 2, Math.PI / 4, -Math.PI / 4].map(angle => <mesh key={angle} geometry={kit.box} material={kit.steel}
            position-y={.043} rotation-z={angle} scale={[.049, .0015, .002]} />)}
          <mesh geometry={kit.octagon} material={kit.light} scale={[.004, .007, .004]} position-y={.043} />
        </> : null}
      </group>
      {!complete && !crown ? [-1, 1].map(x => <mesh key={x} geometry={kit.box} material={kit.steel}
        scale={[.001, height, .001]} position={[x * .016, height / 2, -.012]} />) : null}
      {damaged ? <mesh geometry={kit.box} material={kit.armor} scale={[.025, .004, .008]} rotation-z={.3} position={[.014, .003, .017]} /> : null}
      {complete ? <group ref={signal} name="territory-claim-signal" position-y={crown ? .022 : height + .016}>
        <mesh geometry={kit.ring} material={kit.light} scale={.01} rotation-x={Math.PI / 2} />
        <mesh geometry={kit.octagon} material={kit.light} scale={[.0015, .015, .0015]} />
      </group> : null}
    </group>
    {monument.status === 'command' || monument.status === 'wave' ? <group name="octogonal-approach">
      {[0, 1, 2].map(ship => {
        const progress = monument.phaseElapsedMs / OCTOGONALS.waves[monument.wavesResolved]!.durationMs
        const position = octogonalApproach(monument.wavesResolved, progress, ship)
        return <group key={ship} position={position} rotation-z={Math.PI / 8}>
          <mesh geometry={kit.octagon} material={kit.octogonal} scale={[.007, .004, .007]} />
          <mesh geometry={kit.ring} material={kit.rivalLight} scale={.009} rotation-x={Math.PI / 2} />
          <mesh geometry={kit.box} material={kit.armor} scale={[.023, .002, .004]} />
        </group>
      })}
      {[.15, .35, .55, .75].map(p => <mesh key={p} position={octogonalApproach(monument.wavesResolved, p, 1)}
        geometry={kit.octagon} material={kit.rivalLight} scale={[.0015, .001, .0015]} />)}
    </group> : null}
  </group>
}
