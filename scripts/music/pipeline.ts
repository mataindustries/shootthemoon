/**
 * Orchestration for scripts/music/build-web-music.mjs: discover the canonical
 * DaemonV12 package, verify every hard requirement of handoff section 9, run
 * the measured combination audit, then (build only) encode the guarded MP3
 * package and write the manifest. The output directory changes only after
 * every check has passed.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AuditionSpec,
  arithmeticLayerPeakDbfs,
  arithmeticStingerPeakDbfs,
  AUDITIONS,
  auditionGains,
  type LayerPeaks,
  type LayerSignals,
  layerMixVariants,
  mixLayers,
  pcm16ToFloat,
  peakSummary,
  renderStingerWindows,
  stingerAuditContexts,
  type StereoFloat,
} from './combinations.ts'
import { checkWriteTarget } from './cliArgs.ts'
import { decodeLevels, encodeMp3, measureFile, measureFloat32, measurePcm16, probeAudio, toolVersions, type Loudness } from './ffmpeg.ts'
import { SYNTHETIC_MARKER } from './fixtures.ts'
import {
  assertPortableManifest,
  type FoldDown,
  joinUrl,
  type LoopEntry,
  MANAGED_FILE_PATTERN,
  manifestHeader,
  type MusicManifest,
  serializeManifest,
  type ShippedFile,
  shippedFileName,
  type StingerEntry,
} from './manifest.ts'
import { inspectMp3 } from './mp3.ts'
import {
  bitrateFor,
  CANONICAL_CHANNELS,
  CANONICAL_SAMPLE_RATE,
  COMBINATION_TRUE_PEAK_CEILING_DBTP,
  describeCycleFrame,
  GUARD_FRAMES,
  GUARD_SECONDS,
  GUARDED_LOOP_FRAMES,
  LOOP_FRAMES,
  LOOP_SPECS,
  type LoopId,
  type LoopSpec,
  loopRegions,
  MONO_MAX_LOUDNESS_DELTA_LU,
  MONO_MIN_CORRELATION,
  MP3_DECODE_SLACK_FRAMES,
  PERIODICITY_TOLERANCE_LSB,
  positionToFrames,
  RENDER_BARS,
  RENDER_FRAMES,
  STINGER_SPECS,
  STINGER_TAIL_FRAMES,
  STINGER_TAIL_MAX_RMS_DBFS,
  stingerFrames,
  type StingerId,
  type StingerSpec,
} from './musicSpec.ts'
import {
  buildGuardedLoop,
  buildGuardedStinger,
  dualMono,
  extractProductionCycle,
  foldToMono,
  type PeriodicityReport,
  verifyGuardedLoop,
  provePeriodicity,
  round,
  type SampleLevels,
  sampleLevels,
  stereoCorrelation,
  tailRmsDbfs,
} from './pcm.ts'
import { checkRenderManifest, type RenderProvenance, summarizeEngines } from './provenance.ts'
import { encodeWav, parseWav, type Pcm16, WavFormatError } from './wav.ts'

export interface PipelineOptions {
  readonly mode: 'validate' | 'build' | 'auditions'
  /** Absolute paths. */
  readonly input: string
  readonly output: string | null
  readonly manifest: string | null
  readonly archive: string | null
  readonly report: string | null
  readonly urlBase: string
  readonly allowSynthetic: boolean
  readonly requireProvenance: boolean
  readonly concurrency: number
  /** Always true from the CLI; tests may skip the slow audit when re-proving determinism. */
  readonly combinationAudit: boolean
  readonly repoRoot: string
  readonly log: (line: string) => void
}

export interface PipelineResult {
  readonly ok: boolean
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
  readonly report: Record<string, unknown>
  readonly manifest: MusicManifest | null
}

/** Thrown for problems that stop the pipeline before any asset is analyzed. */
export class PipelineError extends Error {
  override readonly name = 'PipelineError'
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const display = (file: string) => path.relative(process.cwd(), file) || '.'

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface SourceFiles {
  readonly wav: string
  readonly renderManifest: string | null
  readonly stemsDir: string | null
}

/** `<input>/<name>.wav` or `<input>/<id>/<name>.wav`, with DaemonV12 companions beside it. */
function locateSource(input: string, id: string, sourceName: string): SourceFiles | string {
  const candidates = [path.join(input, `${sourceName}.wav`), path.join(input, id, `${sourceName}.wav`)].filter((file) => existsSync(file))
  if (candidates.length === 0) return `${id}: missing canonical render ${sourceName}.wav in ${display(input)} (or ${display(path.join(input, id))})`
  if (candidates.length > 1) return `${id}: ambiguous canonical render, found ${candidates.map(display).join(' and ')}`
  const wav = candidates[0] as string
  const base = wav.slice(0, -'.wav'.length)
  return {
    wav,
    renderManifest: existsSync(`${base}.render.json`) ? `${base}.render.json` : null,
    stemsDir: existsSync(`${base}.stems`) ? `${base}.stems` : null,
  }
}

// ---------------------------------------------------------------------------
// Per-asset analysis
// ---------------------------------------------------------------------------

interface Findings {
  /** Contract violations that make the file unusable (wrong format or length). */
  readonly structural: string[]
  /** Hard quality requirements (periodicity, levels, fold, tail, provenance). */
  readonly quality: string[]
  readonly warnings: string[]
}

interface CanonicalRead {
  readonly audio: Pcm16
  readonly sha256: string
  readonly levels: SampleLevels
  readonly provenance: RenderProvenance | null
}

async function readCanonical(
  id: string,
  files: SourceFiles,
  expected: { frames: number; bars: number },
  options: PipelineOptions,
  findings: Findings,
): Promise<CanonicalRead | null> {
  const bytes = await readFile(files.wav)
  let audio: Pcm16
  try {
    audio = parseWav(bytes, `${id} (${display(files.wav)})`)
  } catch (error) {
    if (error instanceof WavFormatError) {
      findings.structural.push(error.message)
      return null
    }
    throw error
  }
  const label = `${id} (${path.basename(files.wav)})`
  if (audio.sampleRate !== CANONICAL_SAMPLE_RATE) findings.structural.push(`${label}: ${audio.sampleRate} Hz, expected ${CANONICAL_SAMPLE_RATE} Hz (never resampled by this pipeline)`)
  if (audio.channels !== CANONICAL_CHANNELS) findings.structural.push(`${label}: ${audio.channels} channel(s), expected the stereo DaemonV12 render`)
  if (audio.frames !== expected.frames) {
    findings.structural.push(
      `${label}: ${audio.frames.toLocaleString('en-US')} frames (${(audio.frames / audio.sampleRate).toFixed(6)} s), expected exactly ${expected.frames.toLocaleString('en-US')} (${(expected.frames / CANONICAL_SAMPLE_RATE).toFixed(6)} s); renders are never padded or truncated`,
    )
  }
  if (findings.structural.length > 0) return null

  const fileSha = sha256(bytes)
  let provenance: RenderProvenance | null = null
  if (files.renderManifest) {
    const manifestBytes = await readFile(files.renderManifest)
    let parsed: unknown
    try {
      parsed = JSON.parse(manifestBytes.toString('utf8'))
    } catch {
      findings.quality.push(`${label}: ${path.basename(files.renderManifest)} is not valid JSON`)
    }
    if (parsed !== undefined) {
      const check = checkRenderManifest(parsed, {
        fileName: path.basename(files.renderManifest),
        manifestSha256: sha256(manifestBytes),
        wavSha256: fileSha,
        expectedFrames: expected.frames,
        expectedBars: expected.bars,
        sampleRate: CANONICAL_SAMPLE_RATE,
        channels: CANONICAL_CHANNELS,
      })
      provenance = check.provenance
      findings.quality.push(...check.failures.map((failure) => `${id}: ${failure}`))
      findings.warnings.push(...check.warnings.map((warning) => `${id}: ${warning}`))
    }
  } else if (options.requireProvenance) {
    findings.quality.push(`${label}: no DaemonV12 render manifest (${path.basename(files.wav, '.wav')}.render.json) beside the WAV`)
  } else {
    findings.warnings.push(`${label}: no DaemonV12 render manifest; provenance recorded as null`)
  }
  return { audio, sha256: fileSha, levels: sampleLevels(audio), provenance }
}

function loudnessFindings(label: string, loudness: Loudness, spec: { truePeakCeilingDbtp: number; unityLufs?: number; lufsTolerance?: number }, findings: Findings) {
  if (loudness.truePeakDbtp !== null && loudness.truePeakDbtp > spec.truePeakCeilingDbtp) {
    findings.quality.push(`${label}: true peak ${loudness.truePeakDbtp} dBTP exceeds the ${spec.truePeakCeilingDbtp} dBTP ceiling (not normalized; fix the source)`)
  }
  if (spec.unityLufs !== undefined && spec.lufsTolerance !== undefined) {
    if (loudness.integratedLufs === null) findings.quality.push(`${label}: integrated loudness is unmeasurable (silent?), target ${spec.unityLufs} LUFS`)
    else if (Math.abs(loudness.integratedLufs - spec.unityLufs) > spec.lufsTolerance) {
      findings.quality.push(`${label}: integrated loudness ${loudness.integratedLufs} LUFS is outside ${spec.unityLufs} ± ${spec.lufsTolerance} LUFS (not normalized; fix the source)`)
    }
  }
}

interface FoldResult {
  readonly fold: FoldDown
  readonly mono: Pcm16
}

/** Correlation and loudness gates, then the fold itself (handoff 9.1 step 5). */
async function checkFold(label: string, stereo: Pcm16, stereoLoudness: Loudness, findings: Findings): Promise<FoldResult> {
  const correlation = round(stereoCorrelation(stereo), 6)
  const mono = foldToMono(stereo)
  const folded = await measurePcm16(dualMono(mono))
  const delta = folded.integratedLufs === null || stereoLoudness.integratedLufs === null ? null : round(folded.integratedLufs - stereoLoudness.integratedLufs, 2)
  if (correlation < MONO_MIN_CORRELATION) findings.quality.push(`${label}: L/R correlation ${correlation} is below ${MONO_MIN_CORRELATION}; the mono fold-down would change the layer (center the tracks, or ship stereo after a memory re-check)`)
  if (delta !== null && Math.abs(delta) > MONO_MAX_LOUDNESS_DELTA_LU) findings.quality.push(`${label}: mono fold-down changes loudness by ${delta} LU (limit ±${MONO_MAX_LOUDNESS_DELTA_LU} LU)`)
  return { fold: { rule: '(L+R)/2, round half to even, PCM16, no dither', correlation, loudnessDeltaLu: delta }, mono }
}

interface LoopAnalysis {
  readonly spec: LoopSpec
  readonly files: SourceFiles
  readonly findings: Findings
  readonly canonical: CanonicalRead | null
  readonly periodicity: PeriodicityReport | null
  readonly stemPeriodicity: readonly { trackId: string; maxAbsDeltaLsb: number; preGuardMaxAbsDeltaLsb: number }[] | null
  readonly crop: Pcm16 | null
  readonly cropLoudness: Loudness | null
  readonly fold: FoldResult | null
  /** Guarded shipping PCM (mono-folded for mono layers). */
  readonly shipping: Pcm16 | null
}

async function stemPeriodicity(stemsDir: string) {
  const entries = (await readdir(stemsDir)).filter((name) => name.endsWith('.wav')).sort()
  const results: { trackId: string; maxAbsDeltaLsb: number; preGuardMaxAbsDeltaLsb: number }[] = []
  for (const name of entries) {
    try {
      const stem = parseWav(await readFile(path.join(stemsDir, name)), name)
      if (stem.frames !== RENDER_FRAMES) continue
      const proof = provePeriodicity(stem)
      results.push({ trackId: name.slice(0, -4), maxAbsDeltaLsb: proof.cycle.maxAbsDeltaLsb, preGuardMaxAbsDeltaLsb: proof.preGuard.maxAbsDeltaLsb })
    } catch {
      // An unreadable stem only loses diagnostic detail; the master verdict stands.
    }
  }
  return results.sort((a, b) => b.maxAbsDeltaLsb - a.maxAbsDeltaLsb || a.trackId.localeCompare(b.trackId))
}

async function analyzeLoop(spec: LoopSpec, files: SourceFiles, options: PipelineOptions): Promise<LoopAnalysis> {
  const findings: Findings = { structural: [], quality: [], warnings: [] }
  const empty = { spec, files, findings, periodicity: null, stemPeriodicity: null, crop: null, cropLoudness: null, fold: null, shipping: null }
  const canonical = await readCanonical(spec.id, files, { frames: RENDER_FRAMES, bars: RENDER_BARS }, options, findings)
  if (!canonical) return { ...empty, canonical: null }
  const label = spec.id

  const periodicity = provePeriodicity(canonical.audio)
  let stems: LoopAnalysis['stemPeriodicity'] = null
  if (!periodicity.pass) {
    const cycle = periodicity.cycle
    const worstBars = periodicity.perBarMaxAbsDeltaLsb
      .map((delta, index) => ({ bar: index + 1, delta }))
      .filter((entry) => entry.delta > PERIODICITY_TOLERANCE_LSB)
      .map((entry) => `${entry.bar}:${entry.delta}`)
      .join(' ')
    let message =
      `${label}: NOT PERIODIC — cycle 2 vs cycle 3 max |Δ| ${cycle.maxAbsDeltaLsb} LSB (tolerance ${PERIODICITY_TOLERANCE_LSB})` +
      (cycle.maxDelta ? ` at ${cycle.maxDeltaPosition} (source frame ${cycle.maxDeltaSourceFrame}, channel ${cycle.maxDelta.channel === 0 ? 'L' : 'R'})` : '') +
      `; ${cycle.differingSamples} samples differ, RMS Δ ${cycle.rmsDeltaDbfs ?? '-inf'} dBFS; pre-guard max |Δ| ${periodicity.preGuard.maxAbsDeltaLsb} LSB` +
      (worstBars ? `; bars over tolerance (bar:Δ) ${worstBars}` : '')
    if (files.stemsDir) {
      stems = await stemPeriodicity(files.stemsDir)
      const offenders = stems.filter((stem) => stem.maxAbsDeltaLsb > PERIODICITY_TOLERANCE_LSB || stem.preGuardMaxAbsDeltaLsb > PERIODICITY_TOLERANCE_LSB)
      if (offenders.length > 0) message += `; responsible stems: ${offenders.map((stem) => `${stem.trackId} (${stem.maxAbsDeltaLsb} LSB, pre-guard ${stem.preGuardMaxAbsDeltaLsb})`).join(', ')}`
    }
    message += '. A sound, tail or effect state outlasts one cycle; revise the composition (no crossfade is applied).'
    findings.quality.push(message)
  }

  const crop = extractProductionCycle(canonical.audio)
  const cropLoudness = await measurePcm16(crop)
  loudnessFindings(label, cropLoudness, spec, findings)

  const guarded = buildGuardedLoop(canonical.audio)
  for (const problem of verifyGuardedLoop(guarded, crop)) findings.quality.push(`${label}: ${problem}`)

  let fold: FoldResult | null = null
  let shipping = guarded
  if (spec.channels === 1) {
    fold = await checkFold(label, crop, cropLoudness, findings)
    shipping = foldToMono(guarded)
  }
  if (shipping.frames !== GUARDED_LOOP_FRAMES || shipping.channels !== spec.channels) {
    findings.quality.push(`${label}: shipping master is ${shipping.frames} frames × ${shipping.channels} ch, expected ${GUARDED_LOOP_FRAMES} × ${spec.channels}`)
  }
  return { spec, files, findings, canonical, periodicity, stemPeriodicity: stems, crop, cropLoudness, fold, shipping }
}

interface StingerAnalysis {
  readonly spec: StingerSpec
  readonly files: SourceFiles
  readonly findings: Findings
  readonly canonical: CanonicalRead | null
  readonly loudness: Loudness | null
  readonly tailRmsDbfs: number | null
  readonly fold: FoldResult | null
  readonly shipping: Pcm16 | null
}

async function analyzeStinger(spec: StingerSpec, files: SourceFiles, options: PipelineOptions): Promise<StingerAnalysis> {
  const findings: Findings = { structural: [], quality: [], warnings: [] }
  const frames = stingerFrames(spec)
  const canonical = await readCanonical(spec.id, files, { frames, bars: spec.bars }, options, findings)
  if (!canonical) return { spec, files, findings, canonical: null, loudness: null, tailRmsDbfs: null, fold: null, shipping: null }
  const label = spec.id
  const tail = tailRmsDbfs(canonical.audio, STINGER_TAIL_FRAMES)
  if (tail !== null && tail > STINGER_TAIL_MAX_RMS_DBFS) {
    findings.quality.push(`${label}: last 100 ms RMS is ${tail.toFixed(2)} dBFS, above ${STINGER_TAIL_MAX_RMS_DBFS} dBFS; the render must decay to silence before its end (not faded here)`)
  }
  const loudness = await measurePcm16(canonical.audio)
  loudnessFindings(label, loudness, spec, findings)
  let fold: FoldResult | null = null
  let content = canonical.audio
  if (spec.channels === 1) {
    fold = await checkFold(label, canonical.audio, loudness, findings)
    content = fold.mono
  }
  const shipping = buildGuardedStinger(content, GUARD_FRAMES)
  return { spec, files, findings, canonical, loudness, tailRmsDbfs: tail === null ? null : round(tail, 2), fold, shipping }
}

// ---------------------------------------------------------------------------
// Combination audit (handoff 9.3) — measured sums, not arithmetic
// ---------------------------------------------------------------------------

interface AuditOutcome {
  readonly failures: string[]
  readonly report: Record<string, unknown>
}

async function combinationAudit(
  loops: readonly LoopAnalysis[],
  stingers: readonly StingerAnalysis[],
  options: PipelineOptions,
): Promise<AuditOutcome> {
  const layers: Partial<Record<LoopId, StereoFloat>> = {}
  const measuredPeaks = {} as Record<LoopId, number>
  const ceilingPeaks = {} as Record<LoopId, number>
  for (const loop of loops) {
    if (!loop.crop || !loop.cropLoudness) throw new Error(`combination audit needs ${loop.spec.id}`)
    layers[loop.spec.id] = pcm16ToFloat(loop.crop.samples)
    measuredPeaks[loop.spec.id] = loop.cropLoudness.truePeakDbtp ?? -200
    ceilingPeaks[loop.spec.id] = loop.spec.truePeakCeilingDbtp
  }
  const signals: LayerSignals = layers
  const failures: string[] = []
  const ceiling = COMBINATION_TRUE_PEAK_CEILING_DBTP
  const variants = layerMixVariants()

  options.log(`  combination audit: ${variants.length} layer mixes`)
  const layerResults = await mapPool(variants, options.concurrency, async (variant) => {
    const mix = mixLayers(variant.gains, signals, LOOP_FRAMES)
    const peaks = peakSummary(mix)
    const loudness = await measureFloat32(mix, 2, CANONICAL_SAMPLE_RATE)
    const pass = loudness.truePeakDbtp === null || loudness.truePeakDbtp <= ceiling
    if (!pass) failures.push(`combination ${variant.id}: measured true peak ${loudness.truePeakDbtp} dBTP exceeds ${ceiling} dBTP (gains ${JSON.stringify(variant.gains)})`)
    return {
      id: variant.id,
      cue: variant.cue,
      gains: variant.gains,
      integratedLufs: loudness.integratedLufs,
      truePeakDbtp: loudness.truePeakDbtp,
      samplePeakDbfs: peaks.samplePeak > 0 ? round(20 * Math.log10(peaks.samplePeak), 2) : null,
      overs: peaks.overs,
      arithmeticCeilingBoundDbfs: round(arithmeticLayerPeakDbfs(variant.gains, ceilingPeaks as LayerPeaks), 2),
      arithmeticMeasuredBoundDbfs: round(arithmeticLayerPeakDbfs(variant.gains, measuredPeaks as LayerPeaks), 2),
      pass,
    }
  })

  const stingerSignals = new Map<StingerId, { float: StereoFloat; peak: number }>()
  for (const stinger of stingers) {
    if (!stinger.canonical || !stinger.loudness) throw new Error(`combination audit needs ${stinger.spec.id}`)
    stingerSignals.set(stinger.spec.id, { float: pcm16ToFloat(stinger.canonical.audio.samples), peak: stinger.loudness.truePeakDbtp ?? -200 })
  }
  const contexts = stingerAuditContexts(variants, STINGER_SPECS)
  options.log(`  combination audit: ${contexts.length} (mix, stinger) pairs × 16 loop offsets`)
  // Window files are large (first-strike: ~16 × 12.4 s of float stereo), so cap the parallelism.
  const stingerResults = await mapPool(contexts, Math.min(options.concurrency, 4), async (context) => {
    const spec = STINGER_SPECS.find((candidate) => candidate.id === context.stinger) as StingerSpec
    const signal = stingerSignals.get(context.stinger) as { float: StereoFloat; peak: number }
    const windows = renderStingerWindows({
      context,
      spec,
      layers: signals,
      stinger: signal.float,
      cycleFrames: LOOP_FRAMES,
      sampleRate: CANONICAL_SAMPLE_RATE,
      marginFrames: Math.round(0.1 * CANONICAL_SAMPLE_RATE),
      gapFrames: Math.round(0.05 * CANONICAL_SAMPLE_RATE),
    })
    const loudness = await measureFloat32(windows.samples, 2, CANONICAL_SAMPLE_RATE)
    const worst = windows.windowPeaks.reduce((best, peak, index) => (peak > (windows.windowPeaks[best] as number) ? index : best), 0)
    const pass = loudness.truePeakDbtp === null || loudness.truePeakDbtp <= ceiling
    if (!pass) {
      failures.push(
        `combination ${context.id}: measured true peak ${loudness.truePeakDbtp} dBTP exceeds ${ceiling} dBTP (loudest window starts at loop ${describeCycleFrame(windows.offsetsFrames[worst] as number)})`,
      )
    }
    return {
      id: context.id,
      stinger: context.stinger,
      mix: context.variant.id,
      stingerGainDb: context.stingerGainDb,
      duck: spec.duck.kind,
      truePeakDbtp: loudness.truePeakDbtp,
      samplePeakDbfs: round(20 * Math.log10(Math.max(...windows.windowPeaks, 1e-10)), 2),
      loudestOffsetFrame: windows.offsetsFrames[worst],
      arithmeticCeilingBoundDbfs: round(arithmeticStingerPeakDbfs(context, spec, ceilingPeaks as LayerPeaks, spec.truePeakCeilingDbtp), 2),
      arithmeticMeasuredBoundDbfs: round(arithmeticStingerPeakDbfs(context, spec, measuredPeaks as LayerPeaks, signal.peak), 2),
      pass,
    }
  })

  const worstOf = (results: readonly { id: string; truePeakDbtp: number | null }[]) =>
    results.reduce<{ id: string; truePeakDbtp: number | null } | null>((worst, entry) => (worst === null || (entry.truePeakDbtp ?? -999) > (worst.truePeakDbtp ?? -999) ? entry : worst), null)
  return {
    failures,
    report: {
      ceilingDbtp: ceiling,
      method:
        'Canonical stereo crops (mono layers as their dual-mono render) summed in float at handoff 3.4 gains with the gain-raising 3.5 modifiers at maximum; stingers summed at 16 evenly spaced loop offsets with their duck applied from the stinger start (0.4 s dB-linear fade); FFmpeg ebur128 true peak.',
      worstLayerMix: worstOf(layerResults),
      worstStingerPair: worstOf(stingerResults),
      layerMixes: layerResults,
      stingerPairs: stingerResults,
    },
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface EncodedAsset {
  readonly file: string
  readonly stagedPath: string
  readonly shipped: ShippedFile
  readonly problems: string[]
}

async function encodeAsset(id: string, shipping: Pcm16, contentFrames: number, staging: string, options: PipelineOptions): Promise<EncodedAsset> {
  const channels = shipping.channels as 1 | 2
  const bitrateKbps = bitrateFor(channels)
  const wavBytes = encodeWav(shipping)
  const wavPath = path.join(staging, `${id}.guarded.wav`)
  const mp3Path = path.join(staging, `${id}.mp3`)
  await writeFile(wavPath, wavBytes)
  await encodeMp3(wavPath, mp3Path, { channels, bitrateKbps, sampleRate: CANONICAL_SAMPLE_RATE })
  await rm(wavPath)

  const problems: string[] = []
  const bytes = await readFile(mp3Path)
  const stream = inspectMp3(bytes)
  if (!stream.constantBitrate || stream.bitrates[0] !== bitrateKbps) problems.push(`${id}: MP3 is not CBR ${bitrateKbps} kbps (frame bitrates ${stream.bitrates.join(', ')})`)
  if (stream.sampleRate !== CANONICAL_SAMPLE_RATE) problems.push(`${id}: MP3 sample rate ${stream.sampleRate}`)
  if (stream.channels !== channels) problems.push(`${id}: MP3 has ${stream.channels} channel(s), expected ${channels}`)
  const probe = await probeAudio(mp3Path)
  if (probe.codec !== 'mp3' || probe.sampleRate !== CANONICAL_SAMPLE_RATE || probe.channels !== channels || probe.bitRate !== bitrateKbps * 1000) {
    problems.push(`${id}: ffprobe reports ${probe.codec} ${probe.sampleRate} Hz ${probe.channels} ch ${probe.bitRate} bps`)
  }
  const decoded = await decodeLevels(mp3Path, channels)
  if (decoded.frames < shipping.frames || decoded.frames > shipping.frames + MP3_DECODE_SLACK_FRAMES) {
    problems.push(`${id}: decodes to ${decoded.frames} frames, outside [${shipping.frames}, ${shipping.frames + MP3_DECODE_SLACK_FRAMES}]`)
  }
  const loudness = await measureFile(mp3Path, channels)
  const digest = sha256(bytes)
  const file = shippedFileName(id, digest)
  const guardSeconds = GUARD_FRAMES / CANONICAL_SAMPLE_RATE
  return {
    file,
    stagedPath: mp3Path,
    problems,
    shipped: {
      url: joinUrl(options.urlBase, file),
      file,
      sha256: digest,
      bytes: bytes.length,
      channels,
      sampleRate: CANONICAL_SAMPLE_RATE,
      codec: 'mp3',
      bitrateMode: 'cbr',
      bitrateKbps,
      frames: shipping.frames,
      durationSeconds: round(shipping.frames / CANONICAL_SAMPLE_RATE, 6),
      guardFrames: GUARD_FRAMES,
      contentStartSeconds: guardSeconds,
      contentEndSeconds: round((GUARD_FRAMES + contentFrames) / CANONICAL_SAMPLE_RATE, 6),
      guardedWavSha256: sha256(wavBytes),
      decodedFrames: decoded.frames,
      integratedLufs: loudness.integratedLufs,
      truePeakDbtp: loudness.truePeakDbtp,
      samplePeakDbfs: decoded.samplePeakDbfs,
    },
  }
}

function loopEntry(analysis: LoopAnalysis, encoded: EncodedAsset): LoopEntry {
  const canonical = analysis.canonical as CanonicalRead
  const periodicity = analysis.periodicity as PeriodicityReport
  const loudness = analysis.cropLoudness as Loudness
  const regions = loopRegions()
  return {
    id: analysis.spec.id,
    kind: 'loop',
    ...encoded.shipped,
    guard: 'neighbor-cycle',
    loopStartSeconds: GUARD_SECONDS,
    loopEndSeconds: round((GUARD_FRAMES + LOOP_FRAMES) / CANONICAL_SAMPLE_RATE, 6),
    canonical: {
      file: path.basename(analysis.files.wav),
      renderWavSha256: canonical.sha256,
      loopWavSha256: sha256(encodeWav(analysis.crop as Pcm16)),
      sourceFrames: canonical.audio.frames,
      cycleStartFrame: regions.production.start,
      frames: LOOP_FRAMES,
      samplePeakDbfs: canonical.levels.samplePeakDbfs,
      fullScaleSamples: canonical.levels.fullScaleSamples,
    },
    provenance: canonical.provenance,
    periodicity: { maxAbsDeltaLsb: periodicity.cycle.maxAbsDeltaLsb, preGuardMaxAbsDeltaLsb: periodicity.preGuard.maxAbsDeltaLsb, identical: periodicity.identical },
    unity: {
      integratedLufs: loudness.integratedLufs,
      truePeakDbtp: loudness.truePeakDbtp,
      targetLufs: analysis.spec.unityLufs,
      toleranceLu: analysis.spec.lufsTolerance,
      truePeakCeilingDbtp: analysis.spec.truePeakCeilingDbtp,
    },
    foldDown: analysis.fold?.fold ?? null,
  }
}

function stingerEntry(analysis: StingerAnalysis, encoded: EncodedAsset): StingerEntry {
  const canonical = analysis.canonical as CanonicalRead
  const spec = analysis.spec
  const contentFrames = stingerFrames(spec)
  const syncFrames = positionToFrames(spec.syncPosition)
  return {
    id: spec.id,
    kind: 'stinger',
    ...encoded.shipped,
    guard: 'zero',
    bars: spec.bars,
    contentFrames,
    contentSeconds: round(contentFrames / CANONICAL_SAMPLE_RATE, 6),
    syncPosition: spec.syncPosition,
    syncSeconds: round(syncFrames / CANONICAL_SAMPLE_RATE, 6),
    syncFrames,
    timing: spec.timing,
    priority: spec.priority,
    duck: spec.duck,
    waveGainDb: spec.waveGainDb,
    canonical: {
      file: path.basename(analysis.files.wav),
      renderWavSha256: canonical.sha256,
      frames: canonical.audio.frames,
      samplePeakDbfs: canonical.levels.samplePeakDbfs,
      fullScaleSamples: canonical.levels.fullScaleSamples,
    },
    provenance: canonical.provenance,
    unity: {
      integratedLufs: analysis.loudness?.integratedLufs ?? null,
      truePeakDbtp: analysis.loudness?.truePeakDbtp ?? null,
      truePeakCeilingDbtp: spec.truePeakCeilingDbtp,
      tailRmsDbfs: analysis.tailRmsDbfs,
    },
    foldDown: analysis.fold?.fold ?? null,
  }
}

/** Atomically replaces `target` with `content`. */
async function writeFileAtomic(target: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, content)
  await rename(temporary, target)
}

/**
 * Publishes staged MP3s and the manifest into the output directory, then
 * removes only stale files the build owns (MANAGED_FILE_PATTERN) that the new
 * manifest no longer references. Unrelated files are never touched.
 */
export async function commitPackage(output: string, staged: readonly { file: string; stagedPath: string }[], manifestPath: string, manifestJson: string): Promise<{ written: string[]; removed: string[] }> {
  await mkdir(output, { recursive: true })
  const outputStat = await stat(output)
  if (!outputStat.isDirectory()) throw new PipelineError(`${display(output)} is not a directory`)
  const written: string[] = []
  for (const asset of staged) {
    const target = path.join(output, asset.file)
    await copyFile(asset.stagedPath, `${target}.tmp-${process.pid}`)
    await rename(`${target}.tmp-${process.pid}`, target)
    written.push(asset.file)
  }
  await writeFileAtomic(manifestPath, manifestJson)
  const keep = new Set(written)
  const removed: string[] = []
  for (const name of (await readdir(output)).sort()) {
    if (MANAGED_FILE_PATTERN.test(name) && !keep.has(name)) {
      await rm(path.join(output, name))
      removed.push(name)
    }
  }
  return { written, removed }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function loopReport(analysis: LoopAnalysis) {
  return {
    file: display(analysis.files.wav),
    renderManifest: analysis.files.renderManifest ? display(analysis.files.renderManifest) : null,
    channels: { canonical: analysis.canonical?.audio.channels ?? null, shipping: analysis.spec.channels },
    sampleRate: analysis.canonical?.audio.sampleRate ?? null,
    frames: analysis.canonical?.audio.frames ?? null,
    seconds: analysis.canonical ? analysis.canonical.audio.frames / analysis.canonical.audio.sampleRate : null,
    sha256: analysis.canonical?.sha256 ?? null,
    canonicalLevels: analysis.canonical?.levels ?? null,
    provenance: analysis.canonical?.provenance ?? null,
    periodicity: analysis.periodicity,
    stemPeriodicity: analysis.stemPeriodicity,
    crop: analysis.crop
      ? { startFrame: loopRegions().production.start, frames: analysis.crop.frames, loopWavSha256: sha256(encodeWav(analysis.crop)), levels: sampleLevels(analysis.crop), loudness: analysis.cropLoudness }
      : null,
    targets: { unityLufs: analysis.spec.unityLufs, toleranceLu: analysis.spec.lufsTolerance, truePeakCeilingDbtp: analysis.spec.truePeakCeilingDbtp },
    foldDown: analysis.fold?.fold ?? null,
    failures: [...analysis.findings.structural, ...analysis.findings.quality],
    warnings: analysis.findings.warnings,
  }
}

function stingerReport(analysis: StingerAnalysis) {
  return {
    file: display(analysis.files.wav),
    renderManifest: analysis.files.renderManifest ? display(analysis.files.renderManifest) : null,
    channels: { canonical: analysis.canonical?.audio.channels ?? null, shipping: analysis.spec.channels },
    sampleRate: analysis.canonical?.audio.sampleRate ?? null,
    frames: analysis.canonical?.audio.frames ?? null,
    expectedFrames: stingerFrames(analysis.spec),
    seconds: analysis.canonical ? analysis.canonical.audio.frames / analysis.canonical.audio.sampleRate : null,
    sha256: analysis.canonical?.sha256 ?? null,
    canonicalLevels: analysis.canonical?.levels ?? null,
    provenance: analysis.canonical?.provenance ?? null,
    loudness: analysis.loudness,
    truePeakCeilingDbtp: analysis.spec.truePeakCeilingDbtp,
    tailRmsDbfs: analysis.tailRmsDbfs,
    tailLimitDbfs: STINGER_TAIL_MAX_RMS_DBFS,
    foldDown: analysis.fold?.fold ?? null,
    failures: [...analysis.findings.structural, ...analysis.findings.quality],
    warnings: analysis.findings.warnings,
  }
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const inputStat = await stat(options.input).catch(() => null)
  if (!inputStat?.isDirectory()) throw new PipelineError(`canonical input ${display(options.input)} is not a directory`)
  const synthetic = existsSync(path.join(options.input, SYNTHETIC_MARKER))
  if (synthetic && !options.allowSynthetic) {
    throw new PipelineError(`${display(options.input)} is a synthetic fixture package (${SYNTHETIC_MARKER}); pass --allow-synthetic to process it, never into public/`)
  }
  const pathContext = { repoRoot: options.repoRoot, homeDir: homedir(), input: options.input }
  for (const [role, target] of [['output', options.output], ['manifest', options.manifest], ['archive', options.archive], ['report', options.report]] as const) {
    if (target === null) continue
    // Review artifacts and archived WAVs are never shipped either.
    const neverPublic = options.mode === 'auditions' || role === 'archive' || role === 'report'
    checkWriteTarget(target, role, { ...pathContext, synthetic: synthetic || neverPublic })
  }

  const tools = await toolVersions()
  options.log(`music ${options.mode}: ${display(options.input)}${synthetic ? ' (SYNTHETIC fixtures)' : ''} · ffmpeg ${tools.ffmpeg}`)

  const failures: string[] = []
  const warnings: string[] = []
  const located = new Map<string, SourceFiles>()
  const loopSpecs = LOOP_SPECS
  const stingerSpecs = options.mode === 'auditions' ? [] : STINGER_SPECS
  for (const spec of [...loopSpecs, ...stingerSpecs]) {
    const found = locateSource(options.input, spec.id, spec.sourceName)
    if (typeof found === 'string') failures.push(found)
    else located.set(spec.id, found)
  }

  const loops = await mapPool(
    loopSpecs.filter((spec) => located.has(spec.id)),
    Math.min(options.concurrency, 3),
    async (spec) => {
      const analysis = await analyzeLoop(spec, located.get(spec.id) as SourceFiles, options)
      options.log(`  loop ${spec.id}: ${analysis.findings.structural.length + analysis.findings.quality.length === 0 ? 'ok' : 'FAILED'}`)
      return analysis
    },
  )
  const stingers = await mapPool(
    stingerSpecs.filter((spec) => located.has(spec.id)),
    options.concurrency,
    async (spec) => {
      const analysis = await analyzeStinger(spec, located.get(spec.id) as SourceFiles, options)
      options.log(`  stinger ${spec.id}: ${analysis.findings.structural.length + analysis.findings.quality.length === 0 ? 'ok' : 'FAILED'}`)
      return analysis
    },
  )
  for (const analysis of [...loops, ...stingers]) {
    failures.push(...analysis.findings.structural)
    // Auditions are review tools: quality problems are reported, not fatal.
    if (options.mode === 'auditions') warnings.push(...analysis.findings.quality)
    else failures.push(...analysis.findings.quality)
    warnings.push(...analysis.findings.warnings)
  }

  const report: Record<string, unknown> = {
    schema: 1,
    command: options.mode,
    synthetic,
    input: display(options.input),
    toolchain: tools,
    loops: Object.fromEntries(loops.map((analysis) => [analysis.spec.id, loopReport(analysis)])),
    stingers: Object.fromEntries(stingers.map((analysis) => [analysis.spec.id, stingerReport(analysis)])),
  }
  const finish = async (manifest: MusicManifest | null): Promise<PipelineResult> => {
    const ok = failures.length === 0
    report.ok = ok
    report.failures = failures
    report.warnings = warnings
    if (options.report) await writeFileAtomic(options.report, `${JSON.stringify(report, null, 2)}\n`)
    return { ok, failures, warnings, report, manifest }
  }

  if (failures.length > 0) {
    report.combinationAudit = 'skipped: source verification failed'
    return finish(null)
  }

  if (options.mode === 'auditions') {
    report.auditions = await writeAuditions(loops, options)
    return finish(null)
  }

  if (options.combinationAudit) {
    const audit = await combinationAudit(loops, stingers, options)
    report.combinationAudit = audit.report
    failures.push(...audit.failures)
  } else {
    report.combinationAudit = 'skipped (internal test option)'
  }
  if (failures.length > 0 || options.mode === 'validate') return finish(null)

  // ---- build ----
  const output = options.output as string
  const manifestPath = options.manifest ?? path.join(output, 'manifest.json')
  const staging = await mkdtemp(path.join(tmpdir(), 'stm-music-build-'))
  try {
    options.log('  encoding guarded MP3 package')
    const encodedLoops = await mapPool(loops, options.concurrency, (analysis) => encodeAsset(analysis.spec.id, analysis.shipping as Pcm16, LOOP_FRAMES, staging, options))
    const encodedStingers = await mapPool(stingers, options.concurrency, (analysis) => encodeAsset(analysis.spec.id, analysis.shipping as Pcm16, stingerFrames(analysis.spec), staging, options))
    for (const encoded of [...encodedLoops, ...encodedStingers]) failures.push(...encoded.problems)
    const engines = summarizeEngines([...loops, ...stingers].map((analysis) => analysis.canonical?.provenance ?? null))
    const manifest: MusicManifest = {
      ...manifestHeader({ synthetic, ffmpegVersion: tools.ffmpeg, daemonv12: engines }),
      loops: loops.map((analysis, index) => loopEntry(analysis, encodedLoops[index] as EncodedAsset)),
      stingers: stingers.map((analysis, index) => stingerEntry(analysis, encodedStingers[index] as EncodedAsset)),
    }
    assertPortableManifest(manifest, options.urlBase)
    report.build = {
      output: display(output),
      manifest: display(manifestPath),
      shipped: [...manifest.loops, ...manifest.stingers].map((entry) => ({ id: entry.id, file: entry.file, bytes: entry.bytes, decodedFrames: entry.decodedFrames, integratedLufs: entry.integratedLufs, truePeakDbtp: entry.truePeakDbtp })),
    }
    if (failures.length > 0) return finish(null)

    if (options.archive) {
      await mkdir(options.archive, { recursive: true })
      for (const analysis of loops) await writeFileAtomic(path.join(options.archive, `${analysis.spec.id}.loop.wav`), encodeWav(analysis.crop as Pcm16))
    }
    const committed = await commitPackage(output, [...encodedLoops, ...encodedStingers], manifestPath, serializeManifest(manifest))
    report.build = { ...(report.build as object), removedStale: committed.removed }
    options.log(`  wrote ${committed.written.length} MP3s + ${display(manifestPath)}${committed.removed.length ? `; removed stale ${committed.removed.join(', ')}` : ''}`)
    return finish(manifest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Auditions
// ---------------------------------------------------------------------------

async function writeAuditions(loops: readonly LoopAnalysis[], options: PipelineOptions) {
  const output = options.output as string
  await mkdir(output, { recursive: true })
  const layers: Partial<Record<LoopId, StereoFloat>> = {}
  for (const loop of loops) if (loop.crop) layers[loop.spec.id] = pcm16ToFloat(loop.crop.samples)
  const results = await mapPool(AUDITIONS, Math.min(options.concurrency, 3), async (audition: AuditionSpec) => {
    const gains = auditionGains(audition)
    // Two consecutive cycles, so the loop seam is audible in review.
    const mix = mixLayers(gains, layers, LOOP_FRAMES, 2)
    const peaks = peakSummary(mix)
    const loudness = await measureFloat32(mix, 2, CANONICAL_SAMPLE_RATE)
    const pcm = new Int16Array(mix.length)
    let clamped = 0
    for (let i = 0; i < mix.length; i++) {
      const scaled = Math.round((mix[i] as number) * 32768)
      if (scaled > 32767 || scaled < -32768) clamped++
      pcm[i] = Math.max(-32768, Math.min(32767, scaled))
    }
    const file = path.join(output, `${audition.id}-${audition.name}.wav`)
    await writeFileAtomic(file, encodeWav({ sampleRate: CANONICAL_SAMPLE_RATE, channels: 2, frames: mix.length / 2, samples: pcm }))
    options.log(`  audition ${audition.id} (${audition.name}): ${loudness.integratedLufs} LUFS, ${loudness.truePeakDbtp} dBTP`)
    return {
      id: audition.id,
      name: audition.name,
      cue: audition.cue,
      gains,
      file: display(file),
      seconds: (2 * LOOP_FRAMES) / CANONICAL_SAMPLE_RATE,
      integratedLufs: loudness.integratedLufs,
      truePeakDbtp: loudness.truePeakDbtp,
      samplePeakDbfs: peaks.samplePeak > 0 ? round(20 * Math.log10(peaks.samplePeak), 2) : null,
      oversBeforeQuantization: peaks.overs,
      clippedSamplesInWav: clamped,
      clipping: clamped > 0,
    }
  })
  const summary = {
    note: 'Local review mixes only. Never shipped; sources are never modified from these measurements.',
    sourceGains: 'handoff section 3.4, unmodified',
    auditions: results,
  }
  await writeFileAtomic(path.join(output, 'auditions.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}
