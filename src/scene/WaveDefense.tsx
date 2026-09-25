import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, Color, Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { DEFENSE_BREAKUP_MS, DEFENSE_FIRE_END_MS, DEFENSE_WINDOW_MS, defenseImpactAt } from '../domain/waveDefense.ts'
import { batchOctagonalModel, type OctagonalKit } from '../render/octagonalKit.ts'
import { VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import { isSimulationTimePaused } from '../simulation/simulationTime.ts'
import { OctagonalModel } from './OctagonalModel.tsx'
import { authorInterceptorHull, authorInterceptorVane, type Vec3 } from './interceptorModel.ts'
import { createWaveAttackFrame, sampleWaveAttack } from './interceptorFlight.ts'
import { createWaveAttackScratch, defenseElapsed, poseWaveAttack, WAVE_ATTACK_CAPACITY as CAPACITY, waveAttackInput,
  type WaveAttackMeshes } from './waveDefensePresentation.ts'

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const FRAGMENTS = 16
// The landed SurfacePatch is a depth-less transparent overlay at renderOrder 1; transient enemy effects draw after it.
const EFFECT_ORDER = 2
const DIRECTIONS = Array.from({ length: FRAGMENTS }, (_, i) => {
  const angle = i * 2.399963
  return new Vector3(Math.cos(angle), .22 + (i % 4) * .19, Math.sin(angle)).normalize()
})

/**
 * A bounded, texture-free effect using the same dark armor and gold/cyan kit as the enemy. The simulation decides the
 * outcome; the three DIVIDER interceptors only replay it: approach, lock, two violet volleys each, bank and break away.
 */
export function WaveDefense({ view: m, kit, mount, aim, strikeAtMs = DEFENSE_WINDOW_MS, sampledAtMs, running }: {
  readonly view: WaveDefenseView
  readonly kit: OctagonalKit
  readonly mount: readonly [number, number, number]
  /** The visible player structure the volleys land on, in this component's frame. */
  readonly aim: Readonly<Vec3>
  /** When the existing simulation resolves this wave; the attack run ends just before it. */
  readonly strikeAtMs?: number
  readonly sampledAtMs: number
  readonly running: boolean
}) {
  const root = useRef<Group>(null)
  const { gl, camera, scene } = useThree()
  const hullRefs = useRef<(InstancedMesh | null)[]>([])
  const vanes = useRef<InstancedMesh>(null)
  const thrust = useRef<InstancedMesh>(null)
  const fire = useRef<InstancedMesh>(null)
  const impacts = useRef<InstancedMesh>(null)
  const cores = useRef<InstancedMesh>(null)
  const attackMeshes = useRef<WaveAttackMeshes | null>(null)
  const attack = useMemo(() => ({ frame: createWaveAttackFrame(), scratch: createWaveAttackScratch() }), [])
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
    // Enemy fire is the only violet in the scene; contact reads violet-white, exhaust keeps the kit's amber.
    fire: new MeshBasicMaterial({ color: P.octogonalViolet, transparent: true, depthWrite: false }),
    hit: new MeshBasicMaterial({ color: new Color(P.octogonalViolet).lerp(new Color(P.defenseImpactCore), .3),
      transparent: true, depthWrite: false }),
    hitCore: new MeshBasicMaterial({ color: new Color(P.octogonalViolet).lerp(new Color(P.defenseImpactCore), .6),
      transparent: true, depthWrite: false, blending: AdditiveBlending }),
    exhaust: new MeshBasicMaterial({ color: P.monumentAmber, transparent: true, opacity: .8, depthWrite: false, blending: AdditiveBlending }),
  } }, [kit])
  const interceptor = useMemo(() => ({
    hull: batchOctagonalModel(kit, authorInterceptorHull),
    vane: batchOctagonalModel(kit, authorInterceptorVane)[0]!,
  }), [kit])
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
    ;[...gun, ...interceptor.hull, interceptor.vane].forEach(batch => batch.geometry.dispose())
  }, [materials, gun, interceptor, flashGeometry])
  useLayoutEffect(() => {
    const hull = hullRefs.current.filter((mesh): mesh is InstancedMesh => mesh !== null)
    attackMeshes.current = vanes.current && thrust.current && fire.current && impacts.current && cores.current
      ? { hull, vanes: vanes.current, thrust: thrust.current, fire: fire.current, impacts: impacts.current, cores: cores.current } : null
  }, [interceptor])
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
    const frame = sampleWaveAttack(waveAttackInput(m, elapsed, strikeAtMs, aim), attack.frame)
    if (attackMeshes.current && approachGroup.current) {
      approachGroup.current.visible = poseWaveAttack(frame, m.wavesResolved, attackMeshes.current, attack.scratch).shipsVisible
    }
    const shot = m.defenseShots?.[m.wavesResolved]
    const impactAt = defenseImpactAt(shot)
    const hit = impactAt !== null && elapsed >= impactAt
    // The turret tracks the sampled lead; a hit breaks it up at the sampler's exact kill point.
    const target = scratch.target.fromArray(hit ? frame.killPoint : frame.ships[1].position)

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
      {interceptor.hull.map((batch, i) => <instancedMesh key={batch.finish} ref={mesh => { hullRefs.current[i] = mesh }}
        args={[batch.geometry, kit.materials[batch.finish], CAPACITY.ships]} frustumCulled={false} />)}
      <instancedMesh ref={vanes} args={[interceptor.vane.geometry, kit.materials.gold, CAPACITY.vanes]} frustumCulled={false} />
      <instancedMesh ref={thrust} name="octogonal-thrust" visible={false} renderOrder={EFFECT_ORDER}
        args={[kit.shapes.taper, materials.exhaust, CAPACITY.thrust]} frustumCulled={false} />
    </group>
    <instancedMesh ref={fire} name="octogonal-fire" visible={false} renderOrder={EFFECT_ORDER}
      args={[kit.shapes.box, materials.fire, CAPACITY.fire]} frustumCulled={false} />
    <instancedMesh ref={impacts} name="octogonal-impact" visible={false} renderOrder={EFFECT_ORDER}
      args={[flashGeometry, materials.hit, CAPACITY.impacts]} frustumCulled={false} />
    <instancedMesh ref={cores} visible={false} renderOrder={EFFECT_ORDER + 1}
      args={[flashGeometry, materials.hitCore, CAPACITY.cores]} frustumCulled={false} />
    <mesh ref={reticle} name="defense-target" geometry={kit.shapes.ring} material={kit.materials.cyan} />
    <mesh ref={beam} visible={false} name="defense-beam" geometry={kit.shapes.box} material={kit.materials.cyan} />
    <group ref={burst} visible={false} name="octogonal-destruction">
      <mesh ref={flash} geometry={flashGeometry} material={materials.flash} renderOrder={EFFECT_ORDER} />
      <mesh ref={ring} geometry={kit.shapes.ring} material={materials.energy} renderOrder={EFFECT_ORDER} />
      <instancedMesh ref={fragments} args={[kit.shapes.box, materials.fragments, FRAGMENTS + 16]} frustumCulled={false} renderOrder={EFFECT_ORDER} />
      <instancedMesh ref={smoke} args={[kit.shapes.bevel, materials.smoke, 4]} frustumCulled={false} renderOrder={EFFECT_ORDER} />
    </group>
  </group>
}
