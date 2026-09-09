import { useLayoutEffect, useRef } from 'react'
import { InstancedMesh, Object3D, type Material } from 'three'
import { EMISSIVE_LIMITS, MATERIAL_RESPONSE, VISUAL_PALETTE } from '../render/visualSystem.ts'

type Part = readonly [x: number, y: number, z: number, width: number, height: number, depth: number, lean?: number]

// All additions stay inside the existing foundation and crown envelope.
const ARMOR: readonly Part[] = [
  [-3.8, 3.4, 1.1, 1.4, 4.6, 2.4, -0.16],
  [-2.1, 4.4, 1.1, 1.15, 5.8, 2.7, 0.06],
  [-0.65, 3.2, 1.1, 0.9, 3.9, 2.3, 0.2],
  [-3.6, 1.15, -2.1, 2.6, 0.65, 2.8],
  [2.7, 1.15, 1.7, 2.5, 0.65, 3.2],
  [2.7, 1.65, 1.7, 2.1, 0.28, 2.8],
  [2.6, 2.45, -2.5, 1.8, 1.6, 1.5],
  [2.2, 3.15, -3.5, 0.24, 0.3, 2.7],
  [2.95, 3.15, -3.5, 0.24, 0.3, 2.7],
  [-4.1, 8.3, 1.2, 0.16, 2.1, 0.18],
  [-4.1, 8.85, 1.2, 1.45, 0.12, 0.16],
]
const FACETS: readonly Part[] = [
  [-3.85, 6.65, 1.1, 0.18, 2.3, 1.4, -0.16],
  [-0.5, 6.65, 1.1, 0.18, 2.3, 1.4, 0.16],
  [-2.15, 6.65, -0.7, 1.2, 2.3, 0.16],
  [-2.15, 6.65, 3, 1.2, 2.3, 0.16],
  [-3.8, 4.15, -0.16, 0.85, 2.1, 0.12, -0.16],
  [-2.1, 5.05, -0.32, 0.64, 2.4, 0.12, 0.06],
  [-0.65, 3.7, -0.12, 0.44, 1.5, 0.12, 0.2],
  [-3.8, 4.15, 2.36, 0.85, 2.1, 0.12, -0.16],
  [-2.1, 5.05, 2.52, 0.64, 2.4, 0.12, 0.06],
  [2.7, 1.83, 1.7, 1.5, 0.1, 2.1],
]
const LIGHTS: readonly Part[] = [
  [-3.8, 5.25, -0.25, 0.65, 0.09, 0.1, -0.16],
  [-2.1, 6.3, -0.4, 0.5, 0.09, 0.1, 0.06],
  [-3.8, 5.25, 2.45, 0.65, 0.09, 0.1, -0.16],
  [-2.1, 6.3, 2.6, 0.5, 0.09, 0.1, 0.06],
  [2.6, 2.8, -3.29, 0.8, 0.12, 0.1],
  [-4.1, 9.4, 1.2, 0.2, 0.16, 0.2],
]

function Panels({ parts, material, shadowed = false, lights = false }: {
  readonly parts: readonly Part[]
  readonly material?: Material
  readonly shadowed?: boolean
  readonly lights?: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const dummy = new Object3D()
    parts.forEach(([x, y, z, width, height, depth, lean = 0], index) => {
      dummy.position.set(x, y, z)
      dummy.scale.set(width, height, depth)
      dummy.rotation.set(0, 0, lean)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [parts])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, parts.length]}
      {...(material ? { material } : {})} castShadow={shadowed} receiveShadow={shadowed}>
      <boxGeometry />
      {!material && <meshStandardMaterial
        color={lights ? VISUAL_PALETTE.rivalHighlight : VISUAL_PALETTE.rivalSurgical}
        emissive={VISUAL_PALETTE.rivalCyanEmissive}
        emissiveIntensity={lights ? EMISSIVE_LIMITS.panel : 0.22}
        {...MATERIAL_RESPONSE.rivalPanel}
      />}
    </instancedMesh>
  )
}

export function RivalStructuralPanels({ material, shadowed }: {
  readonly material: Material
  readonly shadowed: boolean
}) {
  return (
    <group name="rival-layered-structure">
      <Panels parts={ARMOR} material={material} shadowed={shadowed} />
      <Panels parts={FACETS} shadowed={shadowed} />
      <Panels parts={LIGHTS} lights />
    </group>
  )
}
