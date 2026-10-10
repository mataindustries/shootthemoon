/**
 * The shipped package against its manifest and the locked contract (handoff
 * section 11). Reads files, so it is type-checked by tsconfig.node.json.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BAR_SECONDS, LAYER_IDS, LAYER_SPECS, STINGER_IDS, STINGER_SPECS } from './musicConstants.ts'
import { MusicManifestError, parseMusicManifest } from './musicManifest.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`)
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

interface RawEntry {
  readonly id: string
  readonly url: string
  readonly file: string
  readonly sha256: string
  readonly bytes: number
  readonly channels: number
  readonly bitrateKbps: number
  readonly frames: number
  readonly decodedFrames: number
  readonly bars?: number
  readonly contentFrames?: number
  readonly syncSeconds?: number
  readonly syncFrames?: number
  readonly canonical: { readonly file: string; readonly frames: number; readonly renderWavSha256: string; readonly loopWavSha256?: string }
  readonly provenance: {
    readonly renderManifest: string
    readonly renderManifestSha256: string
    readonly engine: { readonly name: string; readonly version: string }
    readonly project: { readonly file: string; readonly sha256: string }
  }
  readonly periodicity?: { readonly maxAbsDeltaLsb: number; readonly preGuardMaxAbsDeltaLsb: number }
  readonly unity: { readonly integratedLufs: number; readonly truePeakDbtp: number; readonly truePeakCeilingDbtp: number; readonly tailRmsDbfs?: number | null }
}

const manifest = JSON.parse(read('src/audio/music/musicManifest.json').toString('utf8')) as {
  readonly schema: number
  readonly synthetic?: boolean
  readonly bpm: number
  readonly beatsPerBar: number
  readonly loopBars: number
  readonly loopFrames: number
  readonly canonicalSampleRate: number
  readonly guardFrames: number
  readonly daemonv12: { readonly engineVersion: string }
  readonly loops: readonly RawEntry[]
  readonly stingers: readonly RawEntry[]
}
const LOOP_FRAMES = 1_693_440
const GUARD_FRAMES = 8_820
const FRAMES_PER_BAR = 105_840

describe('music manifest', () => {
  it('is the real Package 1, accepted by the runtime contract', () => {
    expect(manifest.synthetic).toBeUndefined()
    expect([manifest.schema, manifest.bpm, manifest.beatsPerBar, manifest.loopBars]).toEqual([1, 100, 4, 16])
    expect([manifest.loopFrames, manifest.canonicalSampleRate, manifest.guardFrames]).toEqual([LOOP_FRAMES, 44_100, GUARD_FRAMES])
    expect(manifest.daemonv12.engineVersion).toMatch(/^0\.5\.\d+$/)
    const parsed = parseMusicManifest(manifest)
    expect(parsed.loops.map((loop) => loop.id)).toEqual([...LAYER_IDS])
    expect(parsed.stingers.map((stinger) => stinger.id)).toEqual([...STINGER_IDS])
  })

  it('every loop is one 1,693,440-frame canonical cycle, guarded and periodic', () => {
    expect(manifest.loops.map((loop) => loop.id).sort()).toEqual([...LAYER_IDS].sort())
    for (const loop of manifest.loops) {
      const spec = LAYER_SPECS[loop.id as keyof typeof LAYER_SPECS]
      expect(loop.canonical.frames, loop.id).toBe(LOOP_FRAMES)
      expect(loop.frames, loop.id).toBe(LOOP_FRAMES + 2 * GUARD_FRAMES)
      expect(loop.decodedFrames).toBeGreaterThanOrEqual(loop.frames)
      expect(loop.decodedFrames).toBeLessThanOrEqual(loop.frames + 3_000)
      expect([loop.channels, loop.bitrateKbps], loop.id).toEqual([spec.channels, spec.channels === 2 ? 160 : 96])
      expect(loop.periodicity?.maxAbsDeltaLsb, loop.id).toBeLessThanOrEqual(1)
      expect(loop.periodicity?.preGuardMaxAbsDeltaLsb, loop.id).toBeLessThanOrEqual(1)
      expect(Math.abs(loop.unity.integratedLufs - spec.unityLufs), loop.id).toBeLessThanOrEqual(1.05)
      expect(loop.unity.truePeakDbtp, loop.id).toBeLessThanOrEqual(spec.truePeakCeilingDbtp)
      expect(loop.canonical.loopWavSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('every stinger has its bars, sync point, channels and true-peak ceiling', () => {
    expect(manifest.stingers.map((stinger) => stinger.id).sort()).toEqual([...STINGER_IDS].sort())
    for (const stinger of manifest.stingers) {
      const spec = STINGER_SPECS[stinger.id as keyof typeof STINGER_SPECS]
      expect(stinger.bars, stinger.id).toBe(spec.bars)
      expect(stinger.contentFrames, stinger.id).toBe(spec.bars * FRAMES_PER_BAR)
      expect(stinger.canonical.frames, stinger.id).toBe(spec.bars * FRAMES_PER_BAR)
      expect(stinger.frames, stinger.id).toBe(spec.bars * FRAMES_PER_BAR + 2 * GUARD_FRAMES)
      expect(stinger.syncSeconds, stinger.id).toBeCloseTo(spec.syncSeconds, 9)
      expect(stinger.syncFrames, stinger.id).toBe(Math.round(spec.syncSeconds * 44_100))
      expect(spec.contentSeconds).toBeCloseTo(spec.bars * BAR_SECONDS, 9)
      expect([stinger.channels, stinger.bitrateKbps], stinger.id).toEqual([spec.channels, spec.channels === 2 ? 160 : 96])
      expect(stinger.unity.truePeakDbtp, stinger.id).toBeLessThanOrEqual(spec.truePeakCeilingDbtp)
      expect(stinger.unity.tailRmsDbfs ?? -Infinity, stinger.id).toBeLessThanOrEqual(-60)
    }
  })

  it('every URL exists under public/music/ with its SHA-256, and nothing else ships there', () => {
    const entries = [...manifest.loops, ...manifest.stingers]
    for (const entry of entries) {
      expect(entry.url).toBe(`/music/${entry.file}`)
      expect(entry.file).toBe(`${entry.id}.${entry.sha256.slice(0, 10)}.mp3`)
      const bytes = read(`public/music/${entry.file}`)
      expect(bytes.length, entry.file).toBe(entry.bytes)
      expect(sha256(bytes), entry.file).toBe(entry.sha256)
    }
    expect(readdirSync(`${ROOT}public/music`).sort()).toEqual(entries.map((entry) => entry.file).sort())
  })

  it('ties every shipped file back to tracked DaemonV12 provenance', () => {
    for (const entry of [...manifest.loops, ...manifest.stingers]) {
      const { provenance } = entry
      expect(provenance.engine.name).toBe('daemonv12')
      expect(provenance.engine.version).toMatch(/^0\.5\.\d+$/)
      const project = `music/source/daemonv12/${provenance.project.file}`
      const render = `music/source/renders/${provenance.renderManifest}`
      expect(existsSync(`${ROOT}${project}`), project).toBe(true)
      expect(sha256(read(project)), project).toBe(provenance.project.sha256)
      expect(sha256(read(render)), render).toBe(provenance.renderManifestSha256)
      const renderManifest = JSON.parse(read(render).toString('utf8')) as { wav: { sha256: string; frames: number } }
      expect(renderManifest.wav.sha256).toBe(entry.canonical.renderWavSha256)
      expect(existsSync(`${ROOT}music/source/renders/${provenance.renderManifest.replace('.render.json', '.analysis.json')}`)).toBe(true)
      expect(read('music/source/README.md').toString('utf8')).toContain(entry.canonical.renderWavSha256)
    }
  })

  it('refuses a manifest that disagrees with the locked contract', () => {
    const broken = (patch: (copy: { loops: RawEntry[]; stingers: RawEntry[] } & Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(manifest)) as { loops: RawEntry[]; stingers: RawEntry[] } & Record<string, unknown>
      patch(copy)
      return () => parseMusicManifest(copy)
    }
    expect(broken((copy) => { copy.bpm = 120 })).toThrow(MusicManifestError)
    expect(broken((copy) => { copy.synthetic = true })).toThrow(MusicManifestError)
    expect(broken((copy) => { copy.loops = copy.loops.filter((loop) => loop.id !== 'claim') })).toThrow(/claim/)
    expect(broken((copy) => { (copy.stingers[1] as unknown as Record<string, unknown>).syncSeconds = 4.5 })).toThrow(/sync/)
    expect(broken((copy) => { (copy.loops[1] as unknown as Record<string, unknown>).channels = 2 })).toThrow(/channels/)
    expect(broken((copy) => { (copy.loops[0] as unknown as Record<string, unknown>).url = 'https://example.com/x.mp3' })).toThrow(/url/)
  })
})
