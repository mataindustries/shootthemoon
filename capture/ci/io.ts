/**
 * Small filesystem/process helpers shared by the capture/ci/*.mjs entry
 * points: PNG header reads, hashing, child processes, ffprobe. Everything
 * decision-making lives in reelCi.ts (pure, unit-tested); this file only
 * touches the outside world.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import type { FrameSize } from './reelCi.ts'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width/height straight from a PNG's IHDR chunk (first 24 bytes). */
export async function readPngSize(filePath: string): Promise<FrameSize> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(24)
    const { bytesRead } = await handle.read(header, 0, 24, 0)
    if (bytesRead < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error(`${filePath} is not a PNG`)
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  } finally {
    await handle.close()
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs a command; stdout/stderr are captured (and optionally echoed). */
export function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly echo?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (options.echo) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

export async function runOrThrow(command: string, args: readonly string[], options: Parameters<typeof run>[2] = {}): Promise<RunResult> {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    throw new Error(`${command} exited ${result.code}: ${result.stderr.trim().split('\n').slice(-5).join(' | ')}`)
  }
  return result
}

export interface ProbedVideo {
  readonly codec: string
  readonly profile: string
  readonly pixFmt: string
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: number
  readonly durationSec: number
  readonly colorSpace: string
}

/** Decodes every frame (-count_frames) so `frames` is a real count, not a
 * container header claim. */
export async function probeVideo(filePath: string): Promise<ProbedVideo> {
  const { stdout } = await runOrThrow('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,duration,color_space',
    '-of', 'json', filePath,
  ])
  const stream = (JSON.parse(stdout) as { streams: Record<string, string | number>[] }).streams[0]
  if (stream === undefined) throw new Error(`${filePath}: no video stream`)
  const [num, den] = String(stream.r_frame_rate).split('/').map(Number)
  return {
    codec: String(stream.codec_name),
    profile: String(stream.profile),
    pixFmt: String(stream.pix_fmt),
    width: Number(stream.width),
    height: Number(stream.height),
    fps: num! / (den || 1),
    frames: Number(stream.nb_read_frames),
    durationSec: Number(stream.duration),
    colorSpace: String(stream.color_space),
  }
}

/** Per-frame MD5 of the decoded video; returns how many frames are
 * byte-identical to their predecessor after decode (frozen frames). */
export async function decodedAdjacentDuplicates(filePath: string): Promise<{ frames: number; adjacentDuplicates: number }> {
  const { stdout } = await runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', filePath, '-map', '0:v:0', '-f', 'framemd5', '-'])
  const hashes = stdout
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(',').pop()!.trim())
  let adjacentDuplicates = 0
  for (let index = 1; index < hashes.length; index += 1) if (hashes[index] === hashes[index - 1]) adjacentDuplicates += 1
  return { frames: hashes.length, adjacentDuplicates }
}

export async function toolVersion(command: string, args: readonly string[]): Promise<string> {
  const result = await run(command, args).catch(() => null)
  return result === null ? 'unavailable' : (result.stdout || result.stderr).split('\n')[0]!.trim()
}
