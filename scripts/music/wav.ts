/**
 * Minimal, strict RIFF/WAVE PCM16 codec for the music asset pipeline.
 *
 * Only little-endian signed 16-bit integer PCM is accepted (DaemonV12 V0.5
 * renders "44.1 kHz PCM16 stereo WAV", handoff section 1). Anything else
 * (float, 24-bit, compressed, RF64, truncated data) is rejected with a
 * message naming the file, never coerced.
 *
 * Pure: Buffer in, Buffer out.
 */
import { endianness } from 'node:os'

export interface Pcm16 {
  readonly sampleRate: number
  readonly channels: number
  readonly frames: number
  /** Interleaved samples, `frames × channels` long. */
  readonly samples: Int16Array
}

export class WavFormatError extends Error {
  override readonly name = 'WavFormatError'
}

const WAVE_FORMAT_PCM = 0x0001
const WAVE_FORMAT_EXTENSIBLE = 0xfffe
/** KSDATAFORMAT_SUBTYPE_PCM after its leading format tag. */
const PCM_SUBFORMAT_TAIL = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71])

if (endianness() !== 'LE') throw new Error('the music asset pipeline assumes a little-endian host')

export function parseWav(buffer: Buffer, label: string): Pcm16 {
  const fail = (reason: string): never => {
    throw new WavFormatError(`${label}: ${reason}`)
  }
  if (buffer.length < 12) fail('not a RIFF/WAVE file (too short)')
  if (buffer.toString('ascii', 0, 4) === 'RF64') fail('RF64 WAV is not supported')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') fail('not a RIFF/WAVE file')

  let format: { tag: number; channels: number; sampleRate: number; blockAlign: number; bits: number } | null = null
  let data: { offset: number; size: number } | null = null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (format) fail('duplicate fmt chunk')
      if (size < 16 || body + size > buffer.length) fail('truncated fmt chunk')
      let tag = buffer.readUInt16LE(body)
      if (tag === WAVE_FORMAT_EXTENSIBLE) {
        if (size < 40) fail('truncated WAVE_FORMAT_EXTENSIBLE fmt chunk')
        const subformat = buffer.subarray(body + 24, body + 40)
        if (subformat.readUInt16LE(0) !== WAVE_FORMAT_PCM || !subformat.subarray(2).equals(PCM_SUBFORMAT_TAIL)) {
          fail('WAVE_FORMAT_EXTENSIBLE with a non-PCM subformat is not supported')
        }
        tag = WAVE_FORMAT_PCM
      }
      format = {
        tag,
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bits: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      if (data) fail('multiple data chunks')
      if (body + size > buffer.length) fail(`truncated data chunk (declares ${size} bytes, ${buffer.length - body} present)`)
      data = { offset: body, size }
    }
    offset = body + size + (size % 2)
  }

  if (!format) return fail('missing fmt chunk')
  if (!data) return fail('missing data chunk')
  if (format.tag !== WAVE_FORMAT_PCM) fail(`unsupported WAV format tag 0x${format.tag.toString(16)} (only integer PCM)`)
  if (format.bits !== 16) fail(`unsupported ${format.bits}-bit PCM (only 16-bit PCM)`)
  if (format.channels < 1) fail('zero channels')
  if (format.blockAlign !== format.channels * 2) fail(`inconsistent block alignment ${format.blockAlign} for ${format.channels} × 16-bit`)
  if (data.size % format.blockAlign !== 0) fail(`data chunk (${data.size} bytes) is not a whole number of frames`)

  const sampleCount = data.size / 2
  const samples = new Int16Array(sampleCount)
  Buffer.from(samples.buffer).set(buffer.subarray(data.offset, data.offset + data.size))
  return { sampleRate: format.sampleRate, channels: format.channels, frames: sampleCount / format.channels, samples }
}

/** Canonical 44-byte-header PCM16 WAV. Deterministic: identical audio → identical bytes. */
export function encodeWav(audio: Pcm16): Buffer {
  if (audio.samples.length !== audio.frames * audio.channels) throw new Error('sample count does not match frames × channels')
  const dataBytes = audio.samples.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(WAVE_FORMAT_PCM, 20)
  header.writeUInt16LE(audio.channels, 22)
  header.writeUInt32LE(audio.sampleRate, 24)
  header.writeUInt32LE(audio.sampleRate * audio.channels * 2, 28)
  header.writeUInt16LE(audio.channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return Buffer.concat([header, Buffer.from(audio.samples.buffer, audio.samples.byteOffset, dataBytes)])
}
