/**
 * FFmpeg/ffprobe side of the music asset pipeline. FFmpeg's `ebur128` filter
 * (handoff 9.1 step 4) is the single loudness and true-peak authority, and
 * libmp3lame (handoff 9.1 step 7) the single encoder. PCM is piped in
 * raw, so no temporary WAV is needed to measure anything.
 */
import { spawn } from 'node:child_process'
import { mp3EncodeArgs, type Mp3EncodeSettings } from './mp3.ts'
import type { Pcm16 } from './wav.ts'

interface RunResult {
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: string
}

function run(command: string, args: readonly string[], stdin?: Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr }))
    // FFmpeg may exit before reading everything when it fails; surface its stderr, not EPIPE.
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}

async function runOrThrow(command: string, args: readonly string[], stdin?: Buffer): Promise<RunResult> {
  const result = await run(command, args, stdin)
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.code}):\n${result.stderr.trim()}`)
  return result
}

export async function toolVersions(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const parse = (text: string, tool: string) => new RegExp(`${tool} version (\\S+)`).exec(text)?.[1] ?? 'unknown'
  const ffmpeg = await runOrThrow('ffmpeg', ['-hide_banner', '-version'])
  const ffprobe = await runOrThrow('ffprobe', ['-hide_banner', '-version'])
  const encoders = await runOrThrow('ffmpeg', ['-hide_banner', '-encoders'])
  if (!/\blibmp3lame\b/.test(encoders.stdout.toString())) throw new Error('this FFmpeg build has no libmp3lame encoder')
  return { ffmpeg: parse(ffmpeg.stdout.toString(), 'ffmpeg'), ffprobe: parse(ffprobe.stdout.toString(), 'ffprobe') }
}

export interface Loudness {
  readonly integratedLufs: number | null
  readonly truePeakDbtp: number | null
  readonly loudnessRangeLu: number | null
}

function parseNumber(text: string | undefined): number | null {
  if (text === undefined || /inf|nan/i.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** Parses the `Summary:` block printed by `ebur128=peak=true`. */
export function parseEbur128Summary(stderr: string): Loudness {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
  if (!summary.startsWith('Summary:')) throw new Error('ebur128 printed no summary')
  const integrated = /Integrated loudness:\s+I:\s+(\S+) LUFS/.exec(summary)?.[1]
  const range = /Loudness range:\s+LRA:\s+(\S+) LU/.exec(summary)?.[1]
  const peak = /True peak:\s+Peak:\s+(\S+) dBFS/.exec(summary)?.[1]
  const integratedLufs = parseNumber(integrated)
  return {
    // ebur128 reports −70.0 LUFS (the absolute gate) for silence.
    integratedLufs: integratedLufs !== null && integratedLufs <= -70 ? null : integratedLufs,
    truePeakDbtp: parseNumber(peak),
    loudnessRangeLu: parseNumber(range),
  }
}

const EBUR128 = ['-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']

/** BS.1770 integrated loudness and true peak of interleaved PCM16. */
export async function measurePcm16(audio: Pcm16): Promise<Loudness> {
  const input = Buffer.from(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength)
  const args = ['-hide_banner', '-nostats', '-f', 's16le', '-ar', String(audio.sampleRate), '-ac', String(audio.channels), '-i', 'pipe:0', ...EBUR128]
  return parseEbur128Summary((await runOrThrow('ffmpeg', args, input)).stderr)
}

/** Same measurement for unclamped float mixes (combination audit and auditions). */
export async function measureFloat32(samples: Float32Array, channels: number, sampleRate: number): Promise<Loudness> {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const args = ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(sampleRate), '-ac', String(channels), '-i', 'pipe:0', ...EBUR128]
  return parseEbur128Summary((await runOrThrow('ffmpeg', args, input)).stderr)
}

/**
 * Measures an encoded file. Mono files are measured as heard, up-mixed to
 * [M, M] (Web Audio's speaker up-mix), so their loudness compares directly
 * with the dual-mono canonical render; ebur128 alone would read mono 3 LU low.
 */
export async function measureFile(file: string, channels: 1 | 2): Promise<Loudness> {
  const filter = channels === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0,ebur128=peak=true:framelog=quiet'] : EBUR128.slice(0, 2)
  return parseEbur128Summary((await runOrThrow('ffmpeg', ['-hide_banner', '-nostats', '-i', file, ...filter, '-f', 'null', '-'])).stderr)
}

export async function encodeMp3(input: string, output: string, settings: Mp3EncodeSettings): Promise<void> {
  await runOrThrow('ffmpeg', mp3EncodeArgs(input, output, settings))
}

export interface ProbedStream {
  readonly codec: string
  readonly sampleRate: number
  readonly channels: number
  readonly bitRate: number
}

export async function probeAudio(file: string): Promise<ProbedStream> {
  const args = ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', file]
  const parsed = JSON.parse((await runOrThrow('ffprobe', args)).stdout.toString()) as {
    streams?: { codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }[]
  }
  const stream = parsed.streams?.[0]
  if (!stream) throw new Error(`${file}: no audio stream`)
  return {
    codec: stream.codec_name ?? 'unknown',
    sampleRate: Number(stream.sample_rate),
    channels: stream.channels ?? 0,
    bitRate: Number(stream.bit_rate),
  }
}

export interface DecodedLevels {
  readonly frames: number
  readonly samplePeakDbfs: number | null
  /** Decoded samples at or beyond ±1.0 full scale. */
  readonly overs: number
}

/** Decodes with FFmpeg (as a browser would, minus resampling) and measures the result. */
export async function decodeLevels(file: string, channels: number): Promise<DecodedLevels> {
  const result = await runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), 'pipe:1'])
  const bytes = result.stdout
  const samples = new Float32Array(Math.floor(bytes.byteLength / 4))
  Buffer.from(samples.buffer).set(bytes.subarray(0, samples.byteLength))
  let peak = 0
  let overs = 0
  for (const value of samples) {
    const abs = Math.abs(value)
    if (abs > peak) peak = abs
    if (abs >= 1) overs++
  }
  return {
    frames: samples.length / channels,
    samplePeakDbfs: peak > 0 ? Math.round(2000 * Math.log10(peak)) / 100 : null,
    overs,
  }
}
