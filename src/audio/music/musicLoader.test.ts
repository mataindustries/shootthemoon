import { describe, expect, it } from 'vitest'
import { LAYER_IDS, STINGER_IDS, STINGER_SPECS, type AssetId } from './musicConstants.ts'
import { createMusicLoader, reachableResidencyGroups, validateDecodedBuffer } from './musicLoader.ts'
import type { MusicManifest } from './musicManifest.ts'
import { FakeAudioContext, FakeBuffer, flushPromises } from './testing/fakeAudioContext.ts'
import { monument, outpost, siege, snapshot } from './testing/musicFixtures.ts'

const contentOf = (id: AssetId) =>
  (LAYER_IDS as readonly AssetId[]).includes(id) ? 38.4 : STINGER_SPECS[id as (typeof STINGER_IDS)[number]].contentSeconds

/** A manifest whose URLs name the asset; the fake decoder reads the duration from the body. */
const MANIFEST: MusicManifest = {
  loops: LAYER_IDS.map((id) => ({
    id,
    url: `/music/${id}.0123456789.mp3`,
    sha256: '0'.repeat(64),
    bytes: 1,
    channels: id === 'bed' || id === 'claim' ? 2 : 1,
    bitrateKbps: 96,
    frames: 1_711_080,
    durationSeconds: 38.8,
    contentStartSeconds: 0.2,
    contentEndSeconds: 38.6,
    loopStartSeconds: 0.2,
    loopEndSeconds: 38.6,
  })),
  stingers: STINGER_IDS.map((id) => ({
    id,
    url: `/music/${id}.0123456789.mp3`,
    sha256: '0'.repeat(64),
    bytes: 1,
    channels: STINGER_SPECS[id].channels,
    bitrateKbps: 96,
    frames: 1,
    durationSeconds: STINGER_SPECS[id].contentSeconds + 0.4,
    contentStartSeconds: 0.2,
    contentEndSeconds: STINGER_SPECS[id].contentSeconds + 0.2,
    bars: STINGER_SPECS[id].bars,
    contentSeconds: STINGER_SPECS[id].contentSeconds,
    syncSeconds: STINGER_SPECS[id].syncSeconds,
    priority: STINGER_SPECS[id].priority,
  })),
}

function body(seconds: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setFloat64(0, seconds)
  return buffer
}

function rig(options: { readonly durations?: Partial<Record<AssetId, number>>; readonly failing?: readonly AssetId[]; readonly manifest?: () => Promise<MusicManifest> } = {}) {
  const context = new FakeAudioContext(48_000)
  const fetched: string[] = []
  const errors: string[] = []
  const loader = createMusicLoader({
    context,
    loadManifest: options.manifest ?? (() => Promise.resolve(MANIFEST)),
    fetch: (url) => {
      fetched.push(url)
      const id = url.split('/').pop()?.split('.')[0] as AssetId
      if (options.failing?.includes(id)) return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
      const seconds = options.durations?.[id] ?? contentOf(id) + 0.4
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(body(seconds)) })
    },
    baseUrl: '/',
    onError: (id, reason) => errors.push(`${id}: ${reason}`),
  })
  return { context, loader, fetched, errors }
}

async function settleAll(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await flushPromises()
}

describe('music residency (handoff 10.3)', () => {
  it('starts with BED + ENGINE and adds groups as the campaign reaches them', () => {
    expect(reachableResidencyGroups(snapshot())).toEqual(['start'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost({ extractorActive: false }) }))).toEqual(['start'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost() }))).toEqual(['start', 'conflict'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost({ extractorActive: false }), rivalRevealStatus: 'QUEUED' }))).toEqual(['start', 'conflict'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost(), firstStrikeStatus: 'LOCKED' }))).toEqual(['start', 'conflict'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost(), firstStrikeStatus: 'READY' }))).toEqual(['start', 'conflict', 'strike'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost(), firstStrikeStatus: 'COMPLETE' }))).toEqual(['start', 'conflict', 'strike', 'claim'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost({ siege: siege('operational') }) }))).toEqual(['start', 'conflict', 'claim'])
    expect(reachableResidencyGroups(snapshot({ outpost: outpost({ monument: monument('constructing') }) }))).toEqual(['start', 'conflict', 'claim'])
  })
})

describe('music loader', () => {
  it('fetches nothing until asked, then BED first, serially, in residency order', async () => {
    const r = rig()
    await settleAll()
    expect(r.fetched).toEqual([])
    r.loader.request(['start', 'claim'])
    r.loader.request(['start'])
    await settleAll()
    expect(r.fetched).toEqual(['/music/bed.0123456789.mp3', '/music/engine.0123456789.mp3', '/music/claim.0123456789.mp3', '/music/territory-claimed.0123456789.mp3'])
    expect(r.loader.state('bed')).toBe('ready')
    expect(r.loader.state('pressure')).toBe('pending')
    r.loader.request(['start', 'conflict', 'claim'])
    await settleAll()
    expect(r.fetched.slice(4).map((url) => url.split('/').pop()?.split('.')[0])).toEqual([
      'vesper-arrival',
      'pressure',
      'assault',
      'vesper-retaliation',
      'divider-contact',
      'outcome-hold',
      'outcome-breach',
    ])
    expect(r.context.decoded).toHaveLength(11)
  })

  it('notifies listeners as each asset settles and reports resident decoded bytes', async () => {
    const r = rig()
    const settled: string[] = []
    r.loader.subscribe((id) => settled.push(`${id}:${r.loader.state(id)}`))
    r.loader.request(['start'])
    await settleAll()
    expect(settled).toEqual(['bed:ready', 'engine:ready'])
    expect(r.loader.decodedBytes()).toBe(2 * Math.round(38.8 * 48_000) * 2 * 4)
  })

  it('skips an asset that fails to fetch or validate and keeps loading the rest', async () => {
    const r = rig({ failing: ['bed'], durations: { engine: 38.8 + 0.2 } })
    r.loader.request(['start', 'conflict'])
    await settleAll()
    expect(r.loader.state('bed')).toBe('error')
    expect(r.loader.state('engine')).toBe('error')
    expect(r.loader.state('pressure')).toBe('ready')
    expect(r.loader.buffer('bed')).toBeNull()
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toContain('404')
    expect(r.errors[1]).toContain('engine decoded to 39.0000 s')
  })

  it('marks everything requested as unavailable when the manifest is invalid', async () => {
    const r = rig({ manifest: () => Promise.reject(new Error('manifest grid differs')) })
    r.loader.request(['start'])
    await settleAll()
    expect(r.fetched).toEqual([])
    expect([r.loader.state('bed'), r.loader.state('engine')]).toEqual(['error', 'error'])
    expect(r.errors[0]).toBe('manifest: manifest grid differs')
  })

  it('validates decoded length within −5 / +80 ms of content + 0.4 s, at the context rate', () => {
    expect(validateDecodedBuffer('bed', new FakeBuffer(38.8, 48_000), 48_000)).toBeNull()
    expect(validateDecodedBuffer('bed', new FakeBuffer(38.796, 48_000), 48_000)).toBeNull()
    expect(validateDecodedBuffer('bed', new FakeBuffer(38.794, 48_000), 48_000)).toContain('expected 38.8 s')
    expect(validateDecodedBuffer('bed', new FakeBuffer(38.879, 48_000), 48_000)).toBeNull()
    expect(validateDecodedBuffer('bed', new FakeBuffer(38.882, 48_000), 48_000)).not.toBeNull()
    expect(validateDecodedBuffer('first-strike', new FakeBuffer(12.4, 48_000), 48_000)).toBeNull()
    expect(validateDecodedBuffer('first-strike', new FakeBuffer(12.4, 44_100), 48_000)).toContain('44100 Hz')
  })
})
