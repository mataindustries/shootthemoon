/** Sample-accurate recorded VO planning. Ranges are half-open source samples;
 * film/graphic ranges remain inclusive 60 fps frames. No duration is stretched. */
export const NARRATION_RATE = 48_000
export const SOURCE_RATE = 44_100
export const INTERNAL_FADE_SAMPLES = Math.round(0.015 * SOURCE_RATE)
export const RECORDED_MAX_SYLLABLE_RATE = 5.6

export interface KeepRange { readonly fromS: number; readonly toS: number; readonly fromSample: number; readonly toSample: number }
export interface VoSelect {
  readonly id: string
  readonly selectedText: string
  readonly words: number
  readonly clipGainDb: number
  readonly measured: { readonly syllablesPerSecond: number }
  readonly select: { readonly take: number; readonly keep: readonly KeepRange[]; readonly durationS: number }
}
export interface VoSelects {
  readonly schema: string
  readonly source: { readonly sampleRate: number; readonly bitDepth: number; readonly channels: number; readonly durationS: number }
  readonly roomTone: { readonly sourceIn: number; readonly sourceOut: number }
  readonly lines: readonly VoSelect[]
  readonly placements: { readonly A: { readonly frames: number; readonly runtimeS: number; readonly placement: Readonly<Record<string, { readonly startS: number }>> } }
}
export interface NarrationLinePlan {
  readonly id: string
  readonly take: number
  readonly startSample: number
  readonly endSample: number
  readonly sourceSamples: number
  readonly editedSourceSamples: number
  readonly outputSamples: number
  readonly from: number
  readonly to: number
}

export function narrationPlan(selects: VoSelects): NarrationLinePlan[] {
  return selects.lines.map((line) => {
    const sourceSamples = line.select.keep.reduce((n, r) => n + r.toSample - r.fromSample, 0)
    const editedSourceSamples = sourceSamples - (line.select.keep.length - 1) * INTERNAL_FADE_SAMPLES
    const outputSamples = Math.round(editedSourceSamples * NARRATION_RATE / SOURCE_RATE)
    // Seconds in Option A are authoritative. Its precomputed frame fields
    // contain floating-point off-by-one floors (e.g. L06 44.1s = f2646).
    const startSample = Math.round(selects.placements.A.placement[line.id]!.startS * NARRATION_RATE)
    const endSample = startSample + outputSamples
    return {
      id: line.id, take: line.select.take, startSample, endSample,
      sourceSamples, editedSourceSamples, outputSamples,
      from: Math.floor(startSample * 60 / NARRATION_RATE),
      to: Math.ceil(endSample * 60 / NARRATION_RATE) - 1,
    }
  })
}

export function validateSelects(selects: VoSelects, sourceFrames = Math.round(selects.source.durationS * SOURCE_RATE)): string[] {
  const problems: string[] = []
  if (selects.schema !== 'shootthemoon.vo-selects/1') problems.push('unknown VO selects schema')
  if (selects.source.sampleRate !== SOURCE_RATE || selects.source.bitDepth !== 16 || selects.source.channels !== 1) problems.push('selects must address 44.1 kHz, 16-bit mono source samples')
  if (selects.lines.length !== 21 || new Set(selects.lines.map((l) => l.id)).size !== 21) problems.push('Option A requires all 21 distinct selects')
  if (selects.placements.A.frames !== 10512 || selects.placements.A.runtimeS !== 175.2) problems.push('Option A duration must remain 73 whole bars at 100 BPM')
  for (const [index, line] of selects.lines.entries()) {
    if (line.id !== `L${String(index + 1).padStart(2, '0')}`) problems.push('selected lines must retain L01–L21 narrative order')
    const placement = selects.placements.A.placement[line.id]
    if (placement === undefined || !Number.isFinite(placement.startS) || placement.startS < 0) problems.push(`${line.id}: missing/invalid Option A placement`)
    if (!Number.isFinite(line.clipGainDb)) problems.push(`${line.id}: invalid gain`)
    if (line.select.keep.length === 0) problems.push(`${line.id}: no keep ranges`)
    let last = -1
    for (const r of line.select.keep) {
      if (!Number.isInteger(r.fromSample) || !Number.isInteger(r.toSample) || r.fromSample < 0 || r.toSample > sourceFrames || r.toSample <= r.fromSample || r.fromSample < last) problems.push(`${line.id}: invalid/overlapping source sample range`)
      if (Math.abs(r.fromSample / SOURCE_RATE - r.fromS) > 1 / SOURCE_RATE || Math.abs(r.toSample / SOURCE_RATE - r.toS) > 1 / SOURCE_RATE) problems.push(`${line.id}: source times disagree with samples`)
      last = r.toSample
    }
    if (line.select.keep.length > 1 && !['L07', 'L11', 'L15'].includes(line.id)) problems.push(`${line.id}: unauthorized tightened pause`)
    if (!(line.measured.syllablesPerSecond > 0 && line.measured.syllablesPerSecond <= RECORDED_MAX_SYLLABLE_RATE)) problems.push(`${line.id}: recorded delivery exceeds ${RECORDED_MAX_SYLLABLE_RATE} syllables/s`)
  }
  if (problems.length) return problems
  let lastEnd = 0
  for (const p of narrationPlan(selects)) {
    if (p.startSample < lastEnd) problems.push(`${p.id}: overlapping narration`)
    if (p.endSample > selects.placements.A.frames * NARRATION_RATE / 60) problems.push(`${p.id}: narration leaves the film`)
    lastEnd = p.endSample
  }
  return problems
}

/** Equal-power crossfade only at the three explicitly selected pause edits. */
export function joinKeepRanges(parts: readonly Float32Array[], fadeSamples = INTERNAL_FADE_SAMPLES): Float32Array {
  if (parts.length === 0) throw new Error('no parts to join')
  const size = parts.reduce((n, p) => n + p.length, 0) - (parts.length - 1) * fadeSamples
  if (size <= 0 || parts.some((p) => p.length < fadeSamples)) throw new Error('range too short for crossfade')
  const joined = new Float32Array(size)
  let end = parts[0]!.length
  joined.set(parts[0]!)
  for (const part of parts.slice(1)) {
    const start = end - fadeSamples
    for (let i = 0; i < fadeSamples; i++) {
      const angle = i * Math.PI / (2 * (fadeSamples - 1))
      joined[start + i] = joined[start + i]! * Math.cos(angle) + part[i]! * Math.sin(angle)
    }
    joined.set(part.subarray(fadeSamples), end)
    end = start + part.length
  }
  return joined
}
