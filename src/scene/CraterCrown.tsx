import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { monumentModifiers, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import { batchOctagonalModel, type ModelBatch, type OctagonalKit } from '../render/octagonalKit.ts'
import {
  authorCraterCrownBore, craterCrownPoseTime, sampleCraterCrown, CROWN_STOWED_MS, type CraterCrownPose,
} from './craterCrownModel.ts'

/** Gameplay truth: the bore is down only while the Crown's extraction modifier is live. */
export function craterCrownMonumentPoseTime(monument: TerritoryMonumentSnapshot, revealAtMs: number | null,
  nowMs: number, reducedMotion: boolean): number {
  return craterCrownPoseTime({ live: monumentModifiers(monument).extraction > 1, revealAtMs, nowMs, reducedMotion })
}

/** One dark bore batch, authored deployed, and an owned instance of the kit's amber for the extraction glow. */
export function createCraterCrownParts(kit: OctagonalKit) {
  return { bore: batchOctagonalModel(kit, authorCraterCrownBore)[0]!.geometry, glow: kit.materials.amber.clone() }
}
export type CraterCrownParts = ReturnType<typeof createCraterCrownParts>

/** A rigid model-metre translation raises the bore by its stroke; the glow maps 1:1 to emissive intensity. */
export function poseCraterCrownParts({ glow }: CraterCrownParts, bore: Group, pose: CraterCrownPose): void {
  bore.position.y = pose.bore
  glow.emissiveIntensity = pose.glow
}

export function disposeCraterCrownParts({ bore, glow }: CraterCrownParts): void {
  bore.dispose()
  glow.dispose()
}

/** The static Crown batches (amber on the owned glow) and the bore, raised together by the rigid ground lift. */
export function CraterCrown({ kit, model, monument, revealAtMs, lift }: {
  readonly kit: OctagonalKit
  readonly model: ModelBatch[]
  readonly monument: TerritoryMonumentSnapshot
  readonly revealAtMs: number | null
  /** Model metres, from craterCrownLift. */
  readonly lift: number
}) {
  const [parts, setParts] = useState<CraterCrownParts | null>(null)
  const bore = useRef<Group>(null)
  const posedAt = useRef<number | null>(null)
  const pose = useMemo(() => sampleCraterCrown(CROWN_STOWED_MS), [])
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  // An effect owns each instance, so StrictMode's rehearsal unmount disposes only its own copy.
  useLayoutEffect(() => {
    const created = createCraterCrownParts(kit)
    posedAt.current = null
    setParts(created)
    return () => disposeCraterCrownParts(created)
  }, [kit])
  // Frames come only from the existing reveal and heartbeat demand; a settled pose is not re-applied.
  useFrame(() => {
    if (parts === null || bore.current === null) return
    const time = craterCrownMonumentPoseTime(monument, revealAtMs, performance.now(), reducedMotion)
    if (time === posedAt.current) return
    posedAt.current = time
    poseCraterCrownParts(parts, bore.current, sampleCraterCrown(time, pose))
  })
  if (parts === null) return null
  return <group name="crater-crown" position-y={lift}>
    {model.map(({ finish, geometry }) => <mesh key={finish} geometry={geometry}
      material={finish === 'amber' ? parts.glow : kit.materials[finish]} />)}
    <group ref={bore} name="crater-crown-bore">
      <mesh geometry={parts.bore} material={kit.materials.dark} />
    </group>
  </group>
}
