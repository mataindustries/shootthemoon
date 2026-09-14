import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { DEFENSE_BREAKUP_MS, DEFENSE_FIRE_END_MS, DEFENSE_WINDOW_MS, defenseImpactAt } from '../domain/waveDefense.ts'
import { OCTOGONALS } from '../content/octogonals.ts'
import { batchOctagonalModel, type ModelBatch, type OctagonalKit } from '../render/octagonalKit.ts'
import { VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import { isSimulationTimePaused } from '../simulation/simulationTime.ts'
import { OctagonalModel } from './OctagonalModel.tsx'
import { defenseApproach, defenseElapsed } from './waveDefensePresentation.ts'

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const FRAGMENTS = 16
const DIRECTIONS = Array.from({ length: FRAGMENTS }, (_, i) => {
  const angle = i * 2.399963
  return new Vector3(Math.cos(angle), .22 + (i % 4) * .19, Math.sin(angle)).normalize()
})

/** A bounded, texture-free effect using the same dark armor and gold/cyan kit as the enemy. */
export function WaveDefense({ view: m, kit, fleet, mount, sampledAtMs, running }: {
  readonly view: WaveDefenseView
  readonly kit: OctagonalKit
  readonly fleet: ModelBatch[]
  readonly mount: readonly [number, number, number]
  readonly sampledAtMs: number
  readonly running: boolean
}) {
  const root = useRef<Group>(null)
  const { gl, camera, scene } = useThree()
  const fleetRefs = useRef<(InstancedMesh | null)[]>([])
  const approachGroup = useRef<Group>(null)
  const turret = useRef<Group>(null)
  const reticle = useRef<Mesh>(null)
  const beam = useRef<Mesh>(null)
  const burst = useRef<Group>(null)
  const flash = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const fragments = useRef<InstancedMesh>(null)
  const smoke = useRef<InstancedMesh>(null)
  const scratch = useMemo(() => ({ object: new Object3D(), direction: new Vector3(), muzzle: new Vector3(),
    target: new Vector3(), quaternion: new Quaternion(), parentQuaternion: new Quaternion() }), [])
  const materials = useMemo(() => {
    const fragments = kit.materials.gold.clone()
    fragments.color.set(0xffffff)
    fragments.emissive.set(0)
    return {
    fragments,
    flash: new MeshBasicMaterial({ color: P.defenseImpactCore, transparent: true, depthWrite: false }),
    energy: new MeshBasicMaterial({ color: P.monumentCyan, transparent: true, depthWrite: false }),
    smoke: new MeshBasicMaterial({ color: P.damageRim, transparent: true, opacity: .3, depthWrite: false }),
  } }, [kit])
  const flashGeometry = useMemo(() => new IcosahedronGeometry(1, 1), [])
  const gun = useMemo(() => batchOctagonalModel(kit, add => {
    add('bevel', 'dark', [0, 0, 0], [.0065, .006, .007])
    add('ring', 'gold', [0, .003, 0], [.0058, .0058, .002], [Math.PI / 2, 0, 0])
    for (const side of [-1, 1]) {
      add('box', 'dark', [side * .003, 0, .009], [.003, .003, .015])
      add('box', 'gold', [side * .003, .0016, .009], [.001, .0004, .013])
      add('bevel', 'cyan', [side * .003, 0, .0166], [.0012, .001, .0012], [Math.PI / 2, 0, 0])
    }
  }), [kit])
  useEffect(() => () => {
    Object.values(materials).forEach(material => material.dispose())
    flashGeometry.dispose()
    gun.forEach(batch => batch.geometry.dispose())
  }, [materials, gun, flashGeometry])
  useLayoutEffect(() => {
    // Armor plates, gold trim and cyan sparks share one instanced draw.
    for (let i = 0; i < FRAGMENTS + 16; i++) fragments.current?.setColorAt(i,
      new Color(i < FRAGMENTS ? P.monumentGold : i < FRAGMENTS + 8 ? P.monumentObsidian : P.monumentCyan))
    if (fragments.current?.instanceColor) fragments.current.instanceColor.needsUpdate = true
    // Compile hidden breakup materials while the allocation waits, before a thumb gesture.
    if (root.current) gl.compile(root.current, camera, scene)
  }, [gl, camera, scene])

  useFrame(({ camera }) => {
    const elapsed = defenseElapsed(m, sampledAtMs, Date.now(), running && !document.hidden && !isSimulationTimePaused())
    if (approachGroup.current) approachGroup.current.visible = elapsed < DEFENSE_WINDOW_MS
    if (elapsed >= DEFENSE_WINDOW_MS) {
      if (reticle.current) reticle.current.visible = false
      if (beam.current) beam.current.visible = false
      if (burst.current) burst.current.visible = false
      return
    }
    const shot = m.defenseShots?.[m.wavesResolved]
    const impactAt = defenseImpactAt(shot)
    const hit = impactAt !== null && elapsed >= impactAt
    const retreatAt = impactAt === null ? DEFENSE_FIRE_END_MS : impactAt + 120
    const retreat = Math.max(0, Math.min(1, (elapsed - retreatAt) / (DEFENSE_WINDOW_MS - retreatAt)))
    const target = scratch.target.copy(defenseApproach(m.wavesResolved, hit ? impactAt : elapsed, 1))
    const wave = OCTOGONALS.waves[m.wavesResolved]!
    const poses = fleetRefs.current
    for (let ship = 0; ship < 3; ship++) {
      const object = scratch.object
      object.position.copy(defenseApproach(m.wavesResolved, Math.min(elapsed, retreatAt), ship))
      // Survivors bank away and shrink into the distance before the result boundary.
      object.position.x += wave.origin[0] * retreat * .02
      object.position.z += wave.origin[2] * retreat * .02
      object.position.y += retreat * .009
      object.rotation.set(0, Math.atan2(wave.origin[0], wave.origin[2]) + retreat * 1.5, (ship - 1) * .12 + retreat * .5)
      object.scale.setScalar(hit && ship === 1 ? 0 : (ship === 1 ? .008 : .0062) * (1 - retreat) ** 2)
      object.updateMatrix()
      for (const mesh of poses) mesh?.setMatrixAt(ship, object.matrix)
    }
    for (const mesh of poses) if (mesh) {
      mesh.visible = elapsed < DEFENSE_WINDOW_MS
      mesh.instanceMatrix.needsUpdate = true
    }

    if (turret.current) {
      scratch.direction.copy(target).sub(turret.current.position).normalize()
      turret.current.quaternion.setFromUnitVectors(FORWARD, scratch.direction)
    }
    if (reticle.current) {
      reticle.current.visible = !hit && elapsed <= DEFENSE_FIRE_END_MS
      reticle.current.position.copy(target)
      camera.getWorldQuaternion(scratch.quaternion)
      reticle.current.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
      reticle.current.quaternion.copy(scratch.parentQuaternion.multiply(scratch.quaternion))
      reticle.current.scale.setScalar(elapsed < 500 ? .018 - elapsed / 500 * .005 : .013)
    }
    const age = impactAt === null ? -1 : elapsed - impactAt
    if (beam.current) {
      const lateShot = shot != null && impactAt === null && elapsed - shot < 180
      beam.current.visible = age >= 0 && age < 180 || lateShot
      scratch.muzzle.fromArray(mount).y += .006
      scratch.muzzle.addScaledVector(scratch.direction, .017)
      if (lateShot) target.x += .035
      scratch.direction.copy(target).sub(scratch.muzzle)
      beam.current.position.copy(scratch.muzzle).addScaledVector(scratch.direction, .5)
      beam.current.scale.set(.0008, scratch.direction.length(), .0008)
      beam.current.quaternion.setFromUnitVectors(UP, scratch.direction.normalize())
    }
    if (!burst.current) return
    burst.current.visible = age >= 0 && age < DEFENSE_BREAKUP_MS
    if (!burst.current.visible) return
    burst.current.position.copy(target)
    const t = age / DEFENSE_BREAKUP_MS
    if (flash.current) {
      flash.current.visible = age < 220
      flash.current.scale.setScalar(.003 + Math.sin(Math.min(1, age / 220) * Math.PI) * .011)
      materials.flash.opacity = Math.sqrt(Math.max(0, 1 - age / 220))
    }
    if (ring.current) {
      ring.current.scale.setScalar(.006 + t * .023)
      ring.current.quaternion.copy(reticle.current!.quaternion)
      materials.energy.opacity = (1 - t) * .85
    }
    for (let i = 0; i < FRAGMENTS; i++) {
      const object = scratch.object
      object.position.copy(DIRECTIONS[i]!).multiplyScalar(.003 + t * (.018 + (i % 3) * .004))
      object.rotation.set(i + t * 3, i * .7 + t * 4, i + t * 2)
      object.scale.set(.0029 * (1 - t * .7), .001 * (1 - t * .7), .004 * (1 - t * .7))
      object.updateMatrix()
      fragments.current?.setMatrixAt(i, object.matrix)
      if (i < 8) {
        object.position.multiplyScalar(.8)
        object.scale.multiplyScalar(1.2)
        object.updateMatrix()
        fragments.current?.setMatrixAt(FRAGMENTS + i, object.matrix)
        object.position.multiplyScalar(1.2)
        object.scale.setScalar(.0015 * (1 - t))
        object.updateMatrix()
        fragments.current?.setMatrixAt(FRAGMENTS + 8 + i, object.matrix)
      }
      if (i < 4) {
        object.position.copy(DIRECTIONS[i * 3]!).multiplyScalar(t * .012)
        object.scale.setScalar(.002 + t * .007)
        object.updateMatrix()
        smoke.current?.setMatrixAt(i, object.matrix)
      }
    }
    materials.smoke.opacity = Math.sin(t * Math.PI) * .3
    for (const mesh of [fragments.current, smoke.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true
  })

  return <group ref={root} name="wave-defense">
    <group name="defense-turret" position={mount}>
      <mesh geometry={kit.shapes.bevel} material={kit.materials.dark} scale={[.007, .004, .007]} />
    </group>
    <group ref={turret} position={[mount[0], mount[1] + .006, mount[2]]}>
      <OctagonalModel batches={gun} kit={kit} />
    </group>
    <group ref={approachGroup} name="octogonal-approach">
      {fleet.map((batch, i) => <instancedMesh key={batch.finish} ref={mesh => { fleetRefs.current[i] = mesh }}
        args={[batch.geometry, kit.materials[batch.finish], 3]} frustumCulled={false} />)}
    </group>
    <mesh ref={reticle} name="defense-target" geometry={kit.shapes.ring} material={kit.materials.cyan} />
    <mesh ref={beam} visible={false} name="defense-beam" geometry={kit.shapes.box} material={kit.materials.cyan} />
    <group ref={burst} visible={false} name="octogonal-destruction">
      <mesh ref={flash} geometry={flashGeometry} material={materials.flash} />
      <mesh ref={ring} geometry={kit.shapes.ring} material={materials.energy} />
      <instancedMesh ref={fragments} args={[kit.shapes.box, materials.fragments, FRAGMENTS + 16]} frustumCulled={false} />
      <instancedMesh ref={smoke} args={[kit.shapes.bevel, materials.smoke, 4]} frustumCulled={false} />
    </group>
  </group>
}
