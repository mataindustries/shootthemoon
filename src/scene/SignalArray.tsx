import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { monumentModifiers, type TerritoryMonumentSnapshot } from '../domain/territoryMonument.ts'
import type { OctagonalKit } from '../render/octagonalKit.ts'
import {
  applySignalSweepRanges, createSignalArrayHead, disposeSignalArrayHead, poseSignalArrayHead,
  sampleSignalArray, signalArrayPoseTime, SIGNAL_STOWED_MS, type SignalArrayPose,
} from './signalArrayModel.ts'

/** Gameplay truth: the head deploys only while the Array's detection modifier is live. */
export function signalArrayMonumentPoseTime(monument: TerritoryMonumentSnapshot, revealAtMs: number | null,
  nowMs: number, reducedMotion: boolean): number {
  return signalArrayPoseTime({ complete: monumentModifiers(monument).detection > 1, revealAtMs, nowMs, reducedMotion })
}

/** Owned instances of the kit's gold and amber finishes: the same programs, independently animated emissive. */
export function createSignalArrayParts(kit: OctagonalKit) {
  return { head: createSignalArrayHead(kit), glow: kit.materials.gold.clone(), emitter: kit.materials.amber.clone() }
}
export type SignalArrayParts = ReturnType<typeof createSignalArrayParts>

export function poseSignalArrayParts({ head, glow, emitter }: SignalArrayParts, pose: SignalArrayPose): void {
  poseSignalArrayHead(head, pose)
  applySignalSweepRanges(head, pose.lit)
  glow.emissiveIntensity = pose.glow
  emitter.emissiveIntensity = pose.emitter
}

export function disposeSignalArrayParts({ head, glow, emitter }: SignalArrayParts): void {
  disposeSignalArrayHead(head)
  glow.dispose()
  emitter.dispose()
}

export function SignalArray({ kit, monument, revealAtMs }: {
  readonly kit: OctagonalKit
  readonly monument: TerritoryMonumentSnapshot
  readonly revealAtMs: number | null
}) {
  const [parts, setParts] = useState<SignalArrayParts | null>(null)
  const glowMesh = useRef<Mesh>(null)
  const posedAt = useRef<number | null>(null)
  const pose = useMemo(() => sampleSignalArray(SIGNAL_STOWED_MS), [])
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  // Head disposal is final (it releases the rest pose), so an effect owns each instance:
  // StrictMode's rehearsal unmount then disposes only its own copy.
  useLayoutEffect(() => {
    const created = createSignalArrayParts(kit)
    posedAt.current = null
    setParts(created)
    return () => disposeSignalArrayParts(created)
  }, [kit])
  // Frames come only from the existing reveal and heartbeat demand; a settled pose is not re-uploaded.
  useFrame(() => {
    if (parts === null) return
    const time = signalArrayMonumentPoseTime(monument, revealAtMs, performance.now(), reducedMotion)
    if (time === posedAt.current) return
    posedAt.current = time
    poseSignalArrayParts(parts, sampleSignalArray(time, pose))
    if (glowMesh.current) glowMesh.current.visible = pose.lit > 0
  })
  if (parts === null) return null
  return <group name="signal-array-head">
    <mesh geometry={parts.head.dark} material={kit.materials.dark} />
    <mesh geometry={parts.head.gold} material={kit.materials.gold} />
    <mesh ref={glowMesh} geometry={parts.head.goldGlow} material={parts.glow} visible={false} />
    <mesh geometry={parts.head.emitter} material={parts.emitter} />
  </group>
}
