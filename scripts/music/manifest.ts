/**
 * Browser-runtime manifest for the adaptive soundtrack package.
 *
 * Deterministic by construction: no timestamps, no host paths, fixed key
 * order (object construction order), fixed asset order (handoff order), and
 * measured values exactly as FFmpeg prints them. Rebuilding identical
 * canonical renders with the same toolchain yields byte-identical JSON.
 *
 * Pure: no I/O.
 */
import path from 'node:path'
import {
  ASSET_IDS,
  BEATS_PER_BAR,
  BPM,
  CANONICAL_SAMPLE_RATE,
  GUARD_FRAMES,
  GUARD_SECONDS,
  LOOP_BARS,
  LOOP_FRAMES,
  LOOP_SECONDS,
  METER,
  MP3_BITRATE_KBPS,
  type LoopId,
  type StingerDuck,
  type StingerId,
  type StingerTiming,
} from './musicSpec.ts'
import type { RenderProvenance } from './provenance.ts'

export const MANIFEST_SCHEMA = 1

export interface ShippedFile {
  /** Root-relative URL the runtime fetches. */
  readonly url: string
  /** File name relative to the manifest's directory. */
  readonly file: string
  readonly sha256: string
  readonly bytes: number
  readonly channels: 1 | 2
  readonly sampleRate: number
  readonly codec: 'mp3'
  readonly bitrateMode: 'cbr'
  readonly bitrateKbps: number
  /** Guarded frames before encoding (decoders may add up to MP3_DECODE_SLACK_FRAMES). */
  readonly frames: number
  readonly durationSeconds: number
  readonly guardFrames: number
  readonly contentStartSeconds: number
  readonly contentEndSeconds: number
  readonly guardedWavSha256: string
  readonly decodedFrames: number
  readonly integratedLufs: number | null
  readonly truePeakDbtp: number | null
  readonly samplePeakDbfs: number | null
}

export interface FoldDown {
  readonly rule: '(L+R)/2, round half to even, PCM16, no dither'
  readonly correlation: number
  readonly loudnessDeltaLu: number | null
}

export interface LoopEntry extends ShippedFile {
  readonly id: LoopId
  readonly kind: 'loop'
  readonly guard: 'neighbor-cycle'
  readonly loopStartSeconds: number
  readonly loopEndSeconds: number
  readonly canonical: {
    readonly file: string
    readonly renderWavSha256: string
    readonly loopWavSha256: string
    readonly sourceFrames: number
    readonly cycleStartFrame: number
    readonly frames: number
    readonly samplePeakDbfs: number | null
    readonly fullScaleSamples: number
  }
  readonly provenance: RenderProvenance | null
  readonly periodicity: { readonly maxAbsDeltaLsb: number; readonly preGuardMaxAbsDeltaLsb: number; readonly identical: boolean }
  readonly unity: {
    readonly integratedLufs: number | null
    readonly truePeakDbtp: number | null
    readonly targetLufs: number
    readonly toleranceLu: number
    readonly truePeakCeilingDbtp: number
  }
  readonly foldDown: FoldDown | null
}

export interface StingerEntry extends ShippedFile {
  readonly id: StingerId
  readonly kind: 'stinger'
  readonly guard: 'zero'
  readonly bars: number
  readonly contentFrames: number
  readonly contentSeconds: number
  readonly syncPosition: string
  /** Sync point relative to the content start (add contentStartSeconds for the file offset). */
  readonly syncSeconds: number
  readonly syncFrames: number
  readonly timing: readonly StingerTiming[]
  readonly priority: number
  readonly duck: StingerDuck
  readonly waveGainDb: readonly number[] | null
  readonly canonical: {
    readonly file: string
    readonly renderWavSha256: string
    readonly frames: number
    readonly samplePeakDbfs: number | null
    readonly fullScaleSamples: number
  }
  readonly provenance: RenderProvenance | null
  readonly unity: {
    readonly integratedLufs: number | null
    readonly truePeakDbtp: number | null
    readonly truePeakCeilingDbtp: number
    readonly tailRmsDbfs: number | null
  }
  readonly foldDown: FoldDown | null
}

export interface MusicManifest {
  readonly schema: typeof MANIFEST_SCHEMA
  /** Present (and true) only for packages built from generated test fixtures. */
  readonly synthetic?: true
  readonly bpm: number
  readonly meter: string
  readonly beatsPerBar: number
  readonly loopBars: number
  readonly loopFrames: number
  readonly loopSeconds: number
  readonly canonicalSampleRate: number
  readonly guardSeconds: number
  readonly guardFrames: number
  readonly encoding: {
    readonly codec: 'mp3'
    readonly encoder: 'libmp3lame'
    readonly bitrateMode: 'cbr'
    readonly sampleRate: number
    readonly stereoBitrateKbps: number
    readonly monoBitrateKbps: number
  }
  readonly toolchain: { readonly ffmpeg: string }
  readonly daemonv12: { readonly engineVersion: string | null; readonly commit: string | null }
  readonly loops: readonly LoopEntry[]
  readonly stingers: readonly StingerEntry[]
}

export function manifestHeader(options: {
  readonly synthetic: boolean
  readonly ffmpegVersion: string
  readonly daemonv12: MusicManifest['daemonv12']
}): Omit<MusicManifest, 'loops' | 'stingers'> {
  return {
    schema: MANIFEST_SCHEMA,
    ...(options.synthetic ? { synthetic: true as const } : {}),
    bpm: BPM,
    meter: METER,
    beatsPerBar: BEATS_PER_BAR,
    loopBars: LOOP_BARS,
    loopFrames: LOOP_FRAMES,
    loopSeconds: LOOP_SECONDS,
    canonicalSampleRate: CANONICAL_SAMPLE_RATE,
    guardSeconds: GUARD_SECONDS,
    guardFrames: GUARD_FRAMES,
    encoding: {
      codec: 'mp3',
      encoder: 'libmp3lame',
      bitrateMode: 'cbr',
      sampleRate: CANONICAL_SAMPLE_RATE,
      stereoBitrateKbps: MP3_BITRATE_KBPS[2],
      monoBitrateKbps: MP3_BITRATE_KBPS[1],
    },
    toolchain: { ffmpeg: options.ffmpegVersion },
    daemonv12: options.daemonv12,
  }
}

/** `<id>.<first 10 hex of sha256>.mp3` (handoff 9.1 step 9). */
export function shippedFileName(id: string, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a SHA-256: ${sha256}`)
  return `${id}.${sha256.slice(0, 10)}.mp3`
}

/** Files the build owns inside its output directory; nothing else is ever touched. */
export const MANAGED_FILE_PATTERN = new RegExp(`^(${ASSET_IDS.map((id) => id.replace(/-/g, '\\-')).join('|')})\\.[0-9a-f]{10}\\.mp3$`)

export function joinUrl(base: string, file: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${file}`
}

/**
 * Rejects anything that would leak the build host into a shipped file:
 * absolute paths (POSIX or Windows) in any string except `url`, and URLs
 * that are not root-relative under the configured base.
 */
export function assertPortableManifest(manifest: MusicManifest, urlBase: string): void {
  const visit = (value: unknown, key: string, trail: string): void => {
    if (typeof value === 'string') {
      if (key === 'url') {
        if (!value.startsWith(urlBase) || value.includes('..')) throw new Error(`${trail}: url ${value} is not under ${urlBase}`)
      } else if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\')) {
        throw new Error(`${trail}: host path leaked into the manifest: ${value}`)
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, key, `${trail}[${index}]`))
    } else if (value !== null && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey, `${trail}.${childKey}`)
    }
  }
  visit(manifest, '', 'manifest')
}

export function serializeManifest(manifest: MusicManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
