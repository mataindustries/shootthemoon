import { useEffect, useMemo } from 'react'
import { MeshStandardMaterial } from 'three'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import { MATERIAL_RESPONSE } from '../render/visualSystem.ts'
import type { RivalStageVisualProfile } from './RivalFoothold.tsx'
import {
  CITADEL_WRECK_EMBER_INTENSITY,
  createCitadelWreckGeometry,
} from './vesperCitadelWreckGeometry.ts'

export interface VesperCitadelWreckProps {
  readonly rival: RivalSignalSnapshot
  readonly profile: RivalStageVisualProfile
  readonly shadowed: boolean
}

/**
 * Static post-strike ruin of the Vesper citadel: one armor batch and one dim
 * signal batch sharing the intact citadel's vertex-colored material variant.
 * Nothing animates; the signal loop is gone with the crown.
 */
export function VesperCitadelWreck({ rival, profile, shadowed }: VesperCitadelWreckProps) {
  const identity = getRivalIdentity(rival.identityId)
  const parts = useMemo(() => createCitadelWreckGeometry(profile), [profile])
  const materials = useMemo(() => ({
    armor: new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      ...MATERIAL_RESPONSE.rivalSkeleton,
    }),
    embers: new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      emissive: identity.palette.signal,
      emissiveIntensity: CITADEL_WRECK_EMBER_INTENSITY,
      ...MATERIAL_RESPONSE.rivalPanel,
    }),
  }), [identity.palette.signal])

  useEffect(
    () => () => {
      parts.wreck.dispose()
      parts.embers.dispose()
    },
    [parts],
  )
  useEffect(
    () => () => {
      materials.armor.dispose()
      materials.embers.dispose()
    },
    [materials],
  )

  return (
    <group name="vesper-citadel-wreck">
      <mesh
        geometry={parts.wreck}
        material={materials.armor}
        castShadow={shadowed}
        receiveShadow={shadowed}
      />
      <mesh geometry={parts.embers} material={materials.embers} />
    </group>
  )
}
