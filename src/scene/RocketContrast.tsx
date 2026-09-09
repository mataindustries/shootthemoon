import { useEffect, useMemo } from 'react'
import { BackSide, BufferGeometry, EdgesGeometry } from 'three'
import { EMISSIVE_LIMITS, VISUAL_PALETTE } from '../render/visualSystem.ts'

/** One-pixel, unlit edges retain contrast without brightening the armor. */
export function RocketRim({ geometry }: { readonly geometry: BufferGeometry }) {
  const edges = useMemo(() => new EdgesGeometry(geometry, 35), [geometry])
  useEffect(() => () => edges.dispose(), [edges])
  return (
    <group>
      <mesh geometry={geometry} scale={1.08} raycast={() => {}}>
        <meshBasicMaterial color={VISUAL_PALETTE.rocketRim} side={BackSide} toneMapped />
      </mesh>
      <lineSegments geometry={edges} raycast={() => {}}>
        <lineBasicMaterial color={VISUAL_PALETTE.rocketRim} toneMapped />
      </lineSegments>
    </group>
  )
}

export function RocketNoseLight({ y, rival = false }: {
  readonly y: number
  readonly rival?: boolean
}) {
  const color = rival ? VISUAL_PALETTE.rivalHighlight : VISUAL_PALETTE.rocketRim
  return (
    <mesh position-y={y}>
      <sphereGeometry args={[0.13, 6, 4]} />
      <meshStandardMaterial color={color} emissive={color}
        emissiveIntensity={EMISSIVE_LIMITS.tinyLed} roughness={0.6} />
    </mesh>
  )
}

/** A small tapered exhaust streak, contained by the owning flight visibility. */
export function RocketContrail({ y, length, rival = false }: {
  readonly y: number
  readonly length: number
  readonly rival?: boolean
}) {
  return (
    <mesh position-y={y - length / 2}>
      <cylinderGeometry args={[0.23, 0.015, length, 6, 1, true]} />
      <meshBasicMaterial
        color={rival ? VISUAL_PALETTE.rivalHighlight : VISUAL_PALETTE.rocketRim}
        transparent opacity={0.42} depthWrite={false} toneMapped
      />
    </mesh>
  )
}
