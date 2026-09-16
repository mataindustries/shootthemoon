import { useEffect, useMemo, useRef } from 'react'
import { Group, Mesh, Points, PointsMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import { createMiningKit, disposeMiningKit } from '../render/miningKit.ts'
import { VISUAL_PALETTE as P } from '../render/visualSystem.ts'
import { simulationNowMs } from '../simulation/simulationTime.ts'
import { createRepairCradle } from './miningModels.ts'

export function RepairGantry({ repairing }: { readonly repairing: boolean }) {
  const kit = useMemo(createMiningKit, [])
  const models = useMemo(() => createRepairCradle(kit), [kit])
  const toolRef = useRef<Group>(null)
  const glowRef = useRef<Mesh>(null)
  const sparksRef = useRef<Points>(null)
  const sparks = useMemo(() => new Float32Array(Array.from({ length: 10 }, (_, i) => {
    const angle = i * 2.399
    return [Math.cos(angle) * (.045 + i * .012), (i % 4) * .045, Math.sin(angle) * (.045 + i * .012)]
  }).flat()), [])
  useEffect(() => () => {
    Object.values(models).forEach(geometry => geometry.dispose())
    disposeMiningKit(kit)
  }, [kit, models])
  useFrame(() => {
    const t = simulationNowMs() / 1000
    if (toolRef.current) {
      toolRef.current.position.set(repairing ? Math.sin(t * .8) * .15 : .68, repairing ? 1.95 + Math.sin(t * 2) * .015 : 2.02, 0)
    }
    if (glowRef.current && repairing) glowRef.current.scale.setScalar(.032 + Math.sin(t * 11) * .005)
    if (sparksRef.current && repairing) {
      sparksRef.current.rotation.y = t * 1.7
      ;(sparksRef.current.material as PointsMaterial).opacity = .22 + Math.abs(Math.sin(t * 8)) * .18
    }
  })
  return <group name="repair-gantry-structure">
    <mesh geometry={models.frame} material={kit.material} castShadow receiveShadow />
    <group ref={toolRef} name="gantry-service-tool" position={[.68, 2.02, 0]}>
      <mesh geometry={models.tool} material={kit.material} />
      <group visible={repairing} position={[0, -.77, .14]}>
        <mesh ref={glowRef} scale={.035} renderOrder={2}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshBasicMaterial color={P.playerLaserCore} transparent opacity={.65} depthWrite={false} />
        </mesh>
        <points ref={sparksRef} renderOrder={2}>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[sparks, 3]} /></bufferGeometry>
          <pointsMaterial color={P.monumentAmber} size={.000008} transparent opacity={.3} depthWrite={false} />
        </points>
      </group>
    </group>
  </group>
}
