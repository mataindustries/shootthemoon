import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import type { OctagonalKit } from '../render/octagonalKit.ts'
import { useDemandAnimation } from '../render/useDemandAnimation.ts'
import { MATERIAL_RESPONSE as R, VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import { OctagonalModel } from './OctagonalModel.tsx'
import {
  createHeliosReactorGeometry, heliosLoopNeedsFrames, heliosLoopRemainingMs,
  heliosLoopTime, heliosOpenOrigin, heliosRailPoint, heliosRevealOrigin,
  HELIOS_PATH_SEGMENT_VERTICES, PITCH, RINGS, sampleHelios,
} from './heliosReactorModel.ts'

export function HeliosReactor({ kit, running, revealAtMs }: {
  readonly kit: OctagonalKit
  readonly running: boolean
  readonly revealAtMs: number | null
}) {
  const parts = useMemo(() => createHeliosReactorGeometry(kit), [kit])
  const rings = useRef<(Group | null)[]>([])
  const sled = useRef<Group>(null)
  const payload = useRef<Group>(null)
  const powerPath = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const trail = useRef<Mesh>(null)
  const firstFrame = useRef(true)
  const pose = useMemo(() => sampleHelios(0), [])
  const point = useMemo<[number, number]>(() => [0, 0], [])
  const muzzle = useMemo(() => heliosRailPoint(95), [])
  const originRef = useRef<number | null>(null)
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [withinLimit, setWithinLimit] = useState(false)
  const looping = running && !reducedMotion
  useEffect(() => {
    if (!looping) {
      originRef.current = null
      setWithinLimit(false)
      return
    }
    const now = performance.now()
    originRef.current = revealAtMs !== null ? heliosRevealOrigin(revealAtMs) : (originRef.current ?? heliosOpenOrigin(now))
    const remaining = heliosLoopRemainingMs(now, originRef.current)
    setWithinLimit(remaining > 0)
    if (remaining > 0) {
      const timer = window.setTimeout(() => setWithinLimit(false), remaining)
      return () => window.clearTimeout(timer)
    }
  }, [looping, revealAtMs])
  useDemandAnimation(heliosLoopNeedsFrames({ looping, revealing: revealAtMs !== null, withinLimit }))

  const materials = useMemo(() => {
    const additive = () => new MeshBasicMaterial({ color: P.defenseImpactCore, transparent: true, opacity: 0,
      depthWrite: false, blending: AdditiveBlending })
    return {
      core: new MeshStandardMaterial({ color: P.monumentIvory, emissive: P.defenseImpactCore, metalness: .1, roughness: .5 }),
      powerPath: new MeshStandardMaterial({ color: P.monumentAmber, emissive: P.monumentAmber, metalness: .2, roughness: .4 }),
      railHeat: new MeshStandardMaterial({ color: P.monumentObsidian, emissive: P.playerAmberEmissive, ...R.monumentTrim }),
      payload: new MeshStandardMaterial({ color: P.monumentIvory, emissive: P.defenseImpactCore, ...R.monumentCeramic }),
      flash: additive(), trail: additive(),
    }
  }, [])
  useEffect(() => () => {
    parts.static.forEach(batch => batch.geometry.dispose())
    ;[parts.ring, parts.core, parts.powerPath, parts.railHeat, parts.sled, parts.payload, parts.cone].forEach(geometry => geometry.dispose())
  }, [parts])
  useEffect(() => () => Object.values(materials).forEach(material => material.dispose()), [materials])

  useFrame(() => {
    sampleHelios(heliosLoopTime(performance.now(), originRef.current), pose)
    for (let i = 0; i < RINGS.length; i++) {
      const ring = rings.current[i]
      if (ring) ring.rotation.y = pose.ringAngles[i]!
    }
    materials.core.emissiveIntensity = pose.core
    materials.powerPath.emissiveIntensity = pose.powerPath
    materials.railHeat.emissiveIntensity = pose.railHeatI
    materials.payload.emissiveIntensity = pose.payloadI
    parts.powerPath.setDrawRange(pose.pathStart * HELIOS_PATH_SEGMENT_VERTICES, pose.pathCount * HELIOS_PATH_SEGMENT_VERTICES)
    if (powerPath.current) powerPath.current.visible = pose.pathCount > 0
    heliosRailPoint(pose.sledS, 0, point)
    sled.current?.position.set(point[0], point[1], 0)
    if (payload.current) {
      payload.current.visible = pose.payloadVisible
      heliosRailPoint(pose.payloadS ?? 0, 0, point)
      payload.current.position.set(point[0], point[1], 0)
      payload.current.scale.setScalar(pose.payloadScale)
    }
    if (trail.current) {
      trail.current.position.x = -(3.6 + pose.trailLength)
      trail.current.scale.set(pose.trailLength, 1.5, 1.5)
      trail.current.visible = firstFrame.current || pose.trailOpacity > .004
    }
    if (flash.current) flash.current.visible = firstFrame.current || pose.flashOpacity > .004
    materials.trail.opacity = firstFrame.current ? 0 : pose.trailOpacity
    materials.flash.opacity = firstFrame.current ? 0 : pose.flashOpacity
    firstFrame.current = false
  })

  return <group name="helios-reactor">
    <OctagonalModel batches={parts.static} kit={kit} />
    {RINGS.map((ring, i) => <group key={i} ref={node => { rings.current[i] = node }} position-y={ring.y}>
      <mesh geometry={parts.ring} material={kit.materials.gold} scale={ring.radius} rotation-x={ring.tilt} />
    </group>)}
    <mesh geometry={parts.core} material={materials.core} />
    <mesh ref={powerPath} geometry={parts.powerPath} material={materials.powerPath} />
    <mesh geometry={parts.railHeat} material={materials.railHeat} />
    <group rotation-y={Math.PI}>
      <group ref={sled} rotation-z={PITCH}><mesh geometry={parts.sled} material={kit.materials.dark} /></group>
      <group ref={payload} rotation-z={PITCH}>
        <mesh geometry={parts.payload} material={materials.payload} />
        <mesh ref={trail} geometry={parts.cone} material={materials.trail} renderOrder={2} />
      </group>
      <group position={[muzzle[0], muzzle[1], 0]} rotation-z={PITCH}>
        <mesh ref={flash} geometry={parts.cone} material={materials.flash} scale={[16, 6.5, 6.5]} renderOrder={2} />
      </group>
    </group>
  </group>
}
