/**
 * MP3 delivery helpers: the exact FFmpeg/LAME command from handoff 9.1 step 7,
 * and a frame-header walker that proves an encoded file is constant-bitrate
 * MPEG-1 Layer III at the expected rate and channel mode.
 *
 * Pure: arguments in, arguments out; Buffer in, report out.
 */

export interface Mp3EncodeSettings {
  readonly channels: 1 | 2
  readonly bitrateKbps: number
  readonly sampleRate: number
}

/**
 * `ffmpeg -hide_banner -i in.wav -map_metadata -1 -c:a libmp3lame -ar 44100 -ac 2 -b:a 160k out.mp3`
 * (mono: `-ac 1 -b:a 96k`). The only additions are non-interactive flags.
 * libmp3lame with a fixed `-b:a` and no `-q:a`/`-abr` is CBR.
 */
export function mp3EncodeArgs(input: string, output: string, settings: Mp3EncodeSettings): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-i', input,
    '-map_metadata', '-1',
    '-c:a', 'libmp3lame',
    '-ar', String(settings.sampleRate),
    '-ac', String(settings.channels),
    '-b:a', `${settings.bitrateKbps}k`,
    output,
  ]
}

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1]
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000, -1]

export interface Mp3StreamReport {
  readonly frames: number
  readonly sampleRate: number
  readonly channels: 1 | 2
  /** Every audio frame's bitrate, deduplicated (one value ⇒ CBR). */
  readonly bitrates: readonly number[]
  readonly constantBitrate: boolean
  /** LAME/Xing header tag in the first frame: `Info` marks a CBR stream, `Xing` a VBR one. */
  readonly infoTag: 'Info' | 'Xing' | null
}

function id3v2Length(buffer: Buffer): number {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return 0
  const size = ((buffer[6] as number) << 21) | ((buffer[7] as number) << 14) | ((buffer[8] as number) << 7) | (buffer[9] as number)
  const hasFooter = ((buffer[5] as number) & 0x10) !== 0
  return 10 + size + (hasFooter ? 10 : 0)
}

/**
 * Walks every MPEG audio frame header. Only MPEG-1 Layer III is accepted,
 * which is all LAME produces at 44.1 kHz. The leading Info/Xing frame (a
 * silent metadata frame) is counted like any other frame.
 */
export function inspectMp3(buffer: Buffer): Mp3StreamReport {
  let offset = id3v2Length(buffer)
  let frames = 0
  let sampleRate = 0
  let channels: 1 | 2 = 2
  let infoTag: Mp3StreamReport['infoTag'] = null
  const bitrates = new Set<number>()
  while (offset + 4 <= buffer.length) {
    if (buffer.toString('latin1', offset, offset + 3) === 'TAG') break // ID3v1 trailer
    const header = buffer.readUInt32BE(offset)
    if ((header & 0xffe00000) >>> 0 !== 0xffe00000) throw new Error(`lost MPEG frame sync at byte ${offset}`)
    const version = (header >>> 19) & 0x3
    const layer = (header >>> 17) & 0x3
    if (version !== 0x3 || layer !== 0x1) throw new Error(`frame at byte ${offset} is not MPEG-1 Layer III`)
    const bitrate = MPEG1_LAYER3_BITRATES[(header >>> 12) & 0xf] as number
    const rate = MPEG1_SAMPLE_RATES[(header >>> 10) & 0x3] as number
    if (bitrate <= 0 || rate <= 0) throw new Error(`invalid bitrate/sample-rate index at byte ${offset}`)
    const padding = (header >>> 9) & 0x1
    const mode = (header >>> 6) & 0x3
    const frameChannels: 1 | 2 = mode === 0x3 ? 1 : 2
    if (frames === 0) {
      sampleRate = rate
      channels = frameChannels
      const sideInfo = frameChannels === 1 ? 17 : 32
      const tag = buffer.toString('latin1', offset + 4 + sideInfo, offset + 8 + sideInfo)
      if (tag === 'Info' || tag === 'Xing') infoTag = tag
    } else if (rate !== sampleRate || frameChannels !== channels) {
      throw new Error(`stream changes sample rate or channel mode at byte ${offset}`)
    }
    bitrates.add(bitrate)
    frames++
    offset += Math.floor((144_000 * bitrate) / rate) + padding
  }
  const sorted = [...bitrates].sort((a, b) => a - b)
  return { frames, sampleRate, channels, bitrates: sorted, constantBitrate: sorted.length === 1, infoTag }
}
