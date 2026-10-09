/**
 * DaemonV12 render-manifest provenance (`<name>.render.json`, written by
 * `daemonv12_render`). Fields are copied only when present: nothing is
 * inferred or defaulted, so a missing value stays `null` in the manifest.
 *
 * Pure: parsed JSON in, summary + problems out.
 */

export interface RenderProvenance {
  readonly renderManifest: string
  readonly renderManifestSha256: string
  readonly engine: { readonly name: string | null; readonly version: string | null; readonly commit: string | null }
  readonly project: { readonly file: string | null; readonly sha256: string | null; readonly seed: number | null }
  readonly renderer: { readonly name: string | null; readonly version: string | null }
  readonly gmRenderer: { readonly name: string | null; readonly version: string | null }
  readonly soundfont: { readonly file: string | null; readonly sha256: string | null }
  readonly audioTool: { readonly name: string | null; readonly version: string | null }
  readonly wavSha256: string | null
}

export interface ProvenanceCheck {
  readonly provenance: RenderProvenance
  /** Hard contract violations: the build must stop. */
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
}

type Json = Record<string, unknown>

function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Render manifests may record host paths; only the file name is portable provenance. */
function fileName(value: unknown): string | null {
  const name = text(value)
  return name === null ? null : (name.split(/[\\/]/).pop() ?? name)
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Handoff section 1: DaemonV12 V0.5 (engine 0.5.0 or a later 0.5.x). */
const SUPPORTED_ENGINE = /^0\.5\.\d+$/

export function checkRenderManifest(
  manifest: unknown,
  context: {
    readonly fileName: string
    readonly manifestSha256: string
    readonly wavSha256: string
    readonly expectedFrames: number
    readonly expectedBars: number
    readonly sampleRate: number
    readonly channels: number
  },
): ProvenanceCheck {
  const root = object(manifest)
  const engine = object(root.engine)
  const project = object(root.project)
  const renderer = object(root.renderer)
  const gmRenderer = object(root.gmRenderer)
  const soundfont = object(root.soundfont)
  const audioTool = object(root.audioTool)
  const wav = object(root.wav)
  const timeline = object(root.timeline)
  const mix = object(root.mix)

  const provenance: RenderProvenance = {
    renderManifest: context.fileName,
    renderManifestSha256: context.manifestSha256,
    engine: { name: text(engine.name), version: text(engine.version), commit: text(engine.commit) },
    project: { file: fileName(project.file), sha256: text(project.sha256), seed: integer(project.seed) },
    renderer: { name: text(renderer.name), version: text(renderer.version) },
    gmRenderer: { name: text(gmRenderer.name), version: text(gmRenderer.version) },
    soundfont: { file: fileName(soundfont.file), sha256: text(soundfont.sha256) },
    audioTool: { name: text(audioTool.name), version: text(audioTool.version) },
    wavSha256: text(wav.sha256),
  }

  const failures: string[] = []
  const warnings: string[] = []
  const label = context.fileName
  if (provenance.wavSha256 === null) failures.push(`${label}: no wav.sha256 to verify the canonical WAV against`)
  else if (provenance.wavSha256 !== context.wavSha256) {
    failures.push(`${label}: wav.sha256 ${provenance.wavSha256} does not match the canonical WAV (${context.wavSha256})`)
  }
  if (provenance.engine.name !== null && provenance.engine.name !== 'daemonv12') failures.push(`${label}: engine is ${provenance.engine.name}, expected daemonv12`)
  if (provenance.engine.version === null) warnings.push(`${label}: engine version not recorded`)
  else if (!SUPPORTED_ENGINE.test(provenance.engine.version)) failures.push(`${label}: DaemonV12 ${provenance.engine.version} is not V0.5.x`)

  const checkNumber = (field: string, actual: unknown, expected: number) => {
    if (actual === undefined) warnings.push(`${label}: ${field} not recorded`)
    else if (actual !== expected) failures.push(`${label}: ${field} is ${String(actual)}, expected ${expected}`)
  }
  checkNumber('wav.frames', wav.frames, context.expectedFrames)
  checkNumber('wav.sampleRate', wav.sampleRate, context.sampleRate)
  checkNumber('wav.channels', wav.channels, context.channels)
  checkNumber('wav.bitsPerSample', wav.bitsPerSample, 16)
  checkNumber('timeline.duration.bars', object(timeline.duration).bars, context.expectedBars)
  if (timeline.tail === undefined) warnings.push(`${label}: timeline.tail not recorded`)
  else if (timeline.tail !== 'none') failures.push(`${label}: timeline.tail is ${JSON.stringify(timeline.tail)}, expected "none"`)
  const clipped = integer(mix.clippedSamples)
  if (clipped !== null && clipped > 0) warnings.push(`${label}: DaemonV12 reports ${clipped} clipped samples in the mix`)

  return { provenance, failures, warnings }
}

/** Package-level DaemonV12 identity: a value only when every render agrees on it. */
export function summarizeEngines(provenances: readonly (RenderProvenance | null)[]): { engineVersion: string | null; commit: string | null } {
  const present = provenances.filter((entry): entry is RenderProvenance => entry !== null)
  if (present.length === 0 || present.length !== provenances.length) return { engineVersion: null, commit: null }
  const unique = (values: (string | null)[]) => {
    const set = new Set(values)
    return set.size === 1 ? ([...set][0] ?? null) : null
  }
  return {
    engineVersion: unique(present.map((entry) => entry.engine.version)),
    commit: unique(present.map((entry) => entry.engine.commit)),
  }
}
