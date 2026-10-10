/** Snapshot builders for the music tests. */
import type { OrbitalSiegeSnapshot, SiegeStatus } from '../../../domain/orbitalSiege.ts'
import type { MonumentKind, MonumentStatus, TerritoryMonumentSnapshot } from '../../../domain/territoryMonument.ts'
import { LAYER_IDS, STINGER_IDS, STINGER_SPECS, type AssetId } from '../musicConstants.ts'
import type { MusicSnapshot } from '../musicState.ts'
import { FakeBuffer } from './fakeAudioContext.ts'

type Outpost = NonNullable<MusicSnapshot['outpost']>

export function outpost(overrides: Partial<Outpost> = {}): Outpost {
  return { extractorActive: true, moduleActive: false, siege: null, monument: null, ...overrides }
}

export function snapshot(overrides: Partial<MusicSnapshot> = {}): MusicSnapshot {
  return {
    entryOpen: false,
    phase: 'orbit',
    monumentView: false,
    outpost: null,
    rivalRevealStatus: null,
    rivalPhase: 'idle',
    firstStrikeStatus: null,
    strikePhase: 'idle',
    strikePhaseStartedAtMs: 0,
    strikeConfirmationOpen: false,
    acceptedOutcome: null,
    counterstrikeDamaged: false,
    csStatus: 'dormant',
    csPhaseStartedAtMs: 0,
    platformDefenseWave: null,
    monumentRevealAtMs: null,
    ...overrides,
  }
}

export function siege(status: SiegeStatus, overrides: Partial<OrbitalSiegeSnapshot> = {}): OrbitalSiegeSnapshot {
  return {
    status,
    elapsedMs: 0,
    progress: 0,
    order: status === 'waves' ? 'DEFEND' : null,
    wavesResolved: status === 'operational' || status === 'damaged' || status === 'repairing' ? 3 : 0,
    platformHealth: status === 'damaged' ? 20 : 100,
    outpostDamage: 0,
    oreLost: 0,
    energyLoss: 0,
    attempts: 1,
    ...overrides,
  }
}

export function monument(status: MonumentStatus, overrides: Partial<TerritoryMonumentSnapshot> = {}): TerritoryMonumentSnapshot {
  const after = status === 'activating' || status === 'damaged' || status === 'repairing' || status === 'complete'
  return {
    kind: 'HELIOS_SPIRE' as MonumentKind,
    anchor: 'outpost',
    status,
    phaseElapsedMs: 0,
    workMs: 0,
    repairWorkMs: 0,
    health: status === 'damaged' || status === 'repairing' ? 20 : 100,
    wavesResolved: after ? 3 : 0,
    orders: [null, null, null],
    productionPenalty: 0,
    energyLoss: 0,
    oreLost: 0,
    completedAtMs: status === 'complete' ? 1 : null,
    revealSeen: false,
    ...overrides,
  }
}

/** Decoded buffers of the exact guarded lengths, at `sampleRate`. */
export function packageBuffers(sampleRate = 48_000, ids: readonly AssetId[] = [...LAYER_IDS, ...STINGER_IDS]): Partial<Record<AssetId, FakeBuffer>> {
  const buffers: Partial<Record<AssetId, FakeBuffer>> = {}
  for (const id of ids) {
    const content = (LAYER_IDS as readonly AssetId[]).includes(id) ? 38.4 : STINGER_SPECS[id as (typeof STINGER_IDS)[number]].contentSeconds
    buffers[id] = new FakeBuffer(content + 0.4, sampleRate, 2)
  }
  return buffers
}
