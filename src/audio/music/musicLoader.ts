/**
 * Fetches, decodes and validates the music package by residency (handoff
 * 10.3). Nothing is requested before BEGIN / CONTINUE; BED loads first to set
 * the epoch; later groups load as the campaign makes them reachable; nothing
 * is released within a session (NEW GAME keeps the decoded buffers). A failed
 * asset is marked `error` and skipped; the rest still play.
 */
import type { AudioBufferLike, AudioContextLike } from '../audioTypes.ts'
import {
  GUARD_SECONDS,
  RESIDENCY_GROUPS,
  RESIDENCY_ORDER,
  type AssetId,
  type ResidencyGroup,
} from './musicConstants.ts'
import type { AssetState, MusicAssetSource } from './musicDirector.ts'
import { contentSecondsOf, manifestAsset, type MusicManifest } from './musicManifest.ts'
import type { MusicSnapshot } from './musicState.ts'

/** Which residency groups the campaign has made reachable (handoff 10.3). */
export function reachableResidencyGroups(s: MusicSnapshot): ResidencyGroup[] {
  const groups: ResidencyGroup[] = ['start']
  const rivalAwake = s.rivalRevealStatus !== null && s.rivalRevealStatus !== 'DORMANT'
  if (s.outpost?.extractorActive === true || rivalAwake) groups.push('conflict')
  if (s.firstStrikeStatus !== null && s.firstStrikeStatus !== 'LOCKED') groups.push('strike')
  const monumentsUnlocked =
    s.outpost !== null &&
    (s.outpost.monument !== null || s.outpost.siege?.status === 'operational' || s.firstStrikeStatus === 'COMPLETE')
  if (monumentsUnlocked) groups.push('claim')
  return groups
}

/** Decoded length tolerance (handoff 6.3): content + 0.4 s, −5 ms / +80 ms. */
export const DECODE_TOLERANCE = Object.freeze({ shortSeconds: 0.005, longSeconds: 0.08 })

export function validateDecodedBuffer(id: AssetId, buffer: AudioBufferLike, contextSampleRate: number): string | null {
  const expected = contentSecondsOf(id) + 2 * GUARD_SECONDS
  if (buffer.sampleRate !== contextSampleRate) return `${id} decoded at ${buffer.sampleRate} Hz, context runs at ${contextSampleRate} Hz`
  if (buffer.duration < expected - DECODE_TOLERANCE.shortSeconds || buffer.duration > expected + DECODE_TOLERANCE.longSeconds) {
    return `${id} decoded to ${buffer.duration.toFixed(4)} s, expected ${expected.toFixed(1)} s (−5 / +80 ms)`
  }
  return null
}

export interface FetchedBody {
  readonly ok: boolean
  readonly status?: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface MusicLoaderOptions {
  readonly context: AudioContextLike
  readonly loadManifest: () => Promise<MusicManifest>
  readonly fetch: (url: string) => Promise<FetchedBody>
  /** Deployment base (import.meta.env.BASE_URL); manifest URLs are root-relative. */
  readonly baseUrl?: string
  readonly onError?: (id: AssetId | 'manifest', reason: string) => void
}

export interface MusicLoader extends MusicAssetSource {
  /** Float32 PCM bytes currently resident. */
  decodedBytes(): number
}

export function createMusicLoader(options: MusicLoaderOptions): MusicLoader {
  const states = new Map<AssetId, AssetState>()
  const buffers = new Map<AssetId, AudioBufferLike>()
  const listeners = new Set<(id: AssetId) => void>()
  const requested = new Set<ResidencyGroup>()
  const queue: AssetId[] = []
  let manifest: Promise<MusicManifest | null> | null = null
  let pumping = false
  const base = (options.baseUrl ?? '/').replace(/\/?$/, '/')

  const settle = (id: AssetId, state: AssetState, buffer: AudioBufferLike | null = null, reason: string | null = null) => {
    states.set(id, state)
    if (buffer !== null) buffers.set(id, buffer)
    if (reason !== null) options.onError?.(id, reason)
    for (const listener of listeners) listener(id)
  }

  const loadManifest = () => {
    manifest ??= options.loadManifest().catch((error: unknown) => {
      options.onError?.('manifest', error instanceof Error ? error.message : String(error))
      return null
    })
    return manifest
  }

  const loadOne = async (id: AssetId, loaded: MusicManifest | null) => {
    if (loaded === null) return settle(id, 'error', null, 'no valid manifest')
    try {
      const entry = manifestAsset(loaded, id)
      const response = await options.fetch(`${base}${entry.url.replace(/^\//, '')}`)
      if (!response.ok) return settle(id, 'error', null, `HTTP ${response.status ?? '?'} for ${entry.url}`)
      const buffer = await options.context.decodeAudioData(await response.arrayBuffer())
      const problem = validateDecodedBuffer(id, buffer, options.context.sampleRate)
      if (problem !== null) return settle(id, 'error', null, problem)
      settle(id, 'ready', buffer)
    } catch (error) {
      settle(id, 'error', null, error instanceof Error ? error.message : String(error))
    }
  }

  const pump = async () => {
    if (pumping) return
    pumping = true
    try {
      while (queue.length > 0) {
        const id = queue.shift() as AssetId
        await loadOne(id, await loadManifest())
      }
    } finally {
      pumping = false
    }
  }

  return {
    request(groups) {
      let added = false
      for (const group of RESIDENCY_ORDER) {
        if (!groups.includes(group) || requested.has(group)) continue
        requested.add(group)
        for (const id of RESIDENCY_GROUPS[group]) {
          if (states.has(id)) continue
          states.set(id, 'pending')
          queue.push(id)
          added = true
        }
      }
      if (added) void pump()
    },
    buffer: (id) => buffers.get(id) ?? null,
    state: (id) => states.get(id) ?? 'pending',
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    decodedBytes: () => [...buffers.values()].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0),
  }
}
