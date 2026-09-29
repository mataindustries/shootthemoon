/**
 * Pure logic for ASSEMBLING the locked reel's release media from the
 * verified 1080p60 intermediates a "Final reel render" run already produced
 * (.github/workflows/final-reel-assemble.yml). Assembly only: nothing here,
 * in capture/ci/assembleFinalReel.mjs or in capture/ci/sourceRun.mjs knows
 * how to render the game. The only local imports are the edit
 * (finalEdit.ts), the pure sampling helpers (finalRender/plan.ts) and the
 * reel verifier (reelCi.ts), all browser-free; capture/ci/assembly.test.ts
 * walks the import graph to keep it that way.
 *
 * Everything editorial comes from capture/finalEdit.json: clip order and
 * durations, transitions, the head fade, the end-card slot, the loop's clip
 * list and fps, the poster instant and crop, and the hero/web encode
 * settings. Nothing here restates a timeline. The one exception is
 * RELEASE_FRAME_OVERRIDES and RELEASE_INTERVAL_OVERRIDES: declared, audited
 * repairs of a verified render run's footage (one defective frame; two
 * portrait inserts), bound to that run and checked against the locked plan
 * (see "Release frame overrides" below).
 *
 * No browser, no filesystem, no child processes — unit-tested in
 * capture/ci/assembly.test.ts.
 */
import { isShotClip, type DeliveryFormat, type FinalEdit, type ShotClip } from '../finalEdit.ts'
import { frameProgressAt, sourceValueAt } from '../finalRender/plan.ts'
import { verifyReelRecords, type ClipRecord } from './reelCi.ts'

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

/** The five release files, named exactly as the portfolio/site expects. */
export const DELIVERABLES = {
  reel: 'reel-57s-1080.mp4',
  loop: 'loop-13s-1280.mp4',
  posterJpg: 'poster-1280.jpg',
  posterWebp: 'poster-1280.webp',
  og: 'og-home-1200x630.jpg',
} as const

/** Provenance/verification files uploaded next to the media. */
export const DELIVERABLE_METADATA = ['manifest.json', 'SHA256SUMS', 'source-reel-manifest.json'] as const

export const LOOP_SIZE = { width: 1280, height: 720 } as const
export const POSTER_SIZE = { width: 1280, height: 720 } as const
export const OG_SIZE = { width: 1200, height: 630 } as const

/** The deliverables directory must hold exactly the five media files plus
 * their metadata — never a raw frame sequence, never an intermediate. */
export function checkDeliverableNames(names: readonly string[]): string[] {
  const allowed = new Set<string>([...Object.values(DELIVERABLES), ...DELIVERABLE_METADATA])
  const problems: string[] = []
  for (const name of names) {
    if (/\.png$/i.test(name)) problems.push(`raw frame/PNG in deliverables: ${name}`)
    else if (!allowed.has(name)) problems.push(`unexpected file in deliverables: ${name}`)
  }
  for (const name of allowed) if (!names.includes(name)) problems.push(`missing deliverable: ${name}`)
  return problems
}

// ---------------------------------------------------------------------------
// Release source: the pinned render run (capture/ci/reelRelease.json)
// ---------------------------------------------------------------------------

export interface PinnedArtifact {
  readonly name: string
  readonly id: number
  /** "sha256:<hex>" — the digest GitHub records for the artifact zip. */
  readonly digest: string
}

export interface ReleasePin {
  readonly schema: string
  readonly repository: string
  readonly workflowName: string
  readonly workflowPath: string
  readonly runNumber: number
  readonly runId: number
  readonly event: string
  readonly headBranch: string
  readonly headSha: string
  readonly artifacts: readonly PinnedArtifact[]
}

export const RELEASE_PIN_SCHEMA = 'shootthemoon.reel-release-source/1'

/** The fields of GitHub's workflow-run REST object this module reads. */
export interface ApiWorkflowRun {
  readonly id: number
  readonly name: string
  readonly path: string
  readonly run_number: number
  readonly event: string
  readonly status: string
  readonly conclusion: string | null
  readonly head_branch: string
  readonly head_sha: string
}

/** The fields of GitHub's artifact REST object this module reads. */
export interface ApiArtifact {
  readonly id: number
  readonly name: string
  readonly expired: boolean
  readonly digest?: string | null
  readonly expires_at?: string | null
  readonly size_in_bytes?: number
  readonly workflow_run?: { readonly id: number; readonly head_sha: string } | null
}

/** Exactly one run of the render workflow with this run number — never
 * "the latest", never a fallback. */
export function selectSourceRun(runs: readonly ApiWorkflowRun[], runNumber: number): ApiWorkflowRun {
  const matches = runs.filter((run) => run.run_number === runNumber)
  if (matches.length !== 1) throw new Error(`expected exactly one run #${runNumber}, found ${matches.length}`)
  return matches[0]!
}

/** Every way the located run can differ from the pinned, verified release
 * source. Any problem means STOP: nothing is downloaded or assembled. */
export function validateSourceRun(
  pin: ReleasePin,
  requestedRunNumber: number,
  run: ApiWorkflowRun,
  artifacts: readonly ApiArtifact[],
): string[] {
  const problems: string[] = []
  if (pin.schema !== RELEASE_PIN_SCHEMA) problems.push(`release pin schema ${pin.schema}, expected ${RELEASE_PIN_SCHEMA}`)
  if (requestedRunNumber !== pin.runNumber) {
    problems.push(
      `run #${requestedRunNumber} is not the pinned release source (run #${pin.runNumber}); ` +
        'releasing another run is a reviewed change to capture/ci/reelRelease.json',
    )
  }
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) problems.push(`${label}: ${String(actual)}, expected ${String(expected)}`)
  }
  expect('run id', run.id, pin.runId)
  expect('run number', run.run_number, pin.runNumber)
  expect('workflow name', run.name, pin.workflowName)
  expect('workflow path', run.path, pin.workflowPath)
  expect('event', run.event, pin.event)
  expect('status', run.status, 'completed')
  expect('conclusion', run.conclusion, 'success')
  expect('branch', run.head_branch, pin.headBranch)
  expect('head sha', run.head_sha, pin.headSha)
  if (!/^[0-9a-f]{40}$/.test(pin.headSha)) problems.push(`pinned head sha ${pin.headSha} is not a full commit sha`)

  if (!pin.artifacts.some((artifact) => artifact.name === 'reel-manifest')) problems.push('pin lists no reel-manifest artifact')
  const byName = new Map<string, ApiArtifact[]>()
  for (const artifact of artifacts) byName.set(artifact.name, [...(byName.get(artifact.name) ?? []), artifact])
  for (const [name, list] of byName) {
    if (list.length > 1) problems.push(`artifact ${name} appears ${list.length} times`)
    if (!pin.artifacts.some((artifact) => artifact.name === name)) problems.push(`unexpected artifact ${name} (not in the pin)`)
  }
  for (const pinned of pin.artifacts) {
    const actual = byName.get(pinned.name)?.[0]
    if (actual === undefined) {
      problems.push(`artifact ${pinned.name}: missing`)
      continue
    }
    if (actual.id !== pinned.id) problems.push(`artifact ${pinned.name}: id ${actual.id}, pinned ${pinned.id}`)
    if (actual.digest !== pinned.digest) problems.push(`artifact ${pinned.name}: digest ${actual.digest ?? 'none'}, pinned ${pinned.digest}`)
    if (actual.expired) problems.push(`artifact ${pinned.name}: expired`)
    if (actual.workflow_run != null && (actual.workflow_run.id !== run.id || actual.workflow_run.head_sha !== pin.headSha)) {
      problems.push(`artifact ${pinned.name}: belongs to run ${actual.workflow_run.id} @ ${actual.workflow_run.head_sha}`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Input verification: every locked clip, once, verified, hash-checked
// ---------------------------------------------------------------------------

/** clip.json as renderGroup.mjs writes it (the subset assembly reads). */
export type AssemblyClipRecord = ClipRecord & { readonly output: ClipRecord['output'] & { readonly file: string } }

/** reel-manifest.json as capture/ci/verifyReel.mjs writes it. */
export interface ReelManifest {
  readonly gitSha: string
  readonly verified: boolean
  readonly expectedClips: number
  readonly clipCount: number
  readonly timelineMs: number
  readonly fps: number
  readonly gitShas: readonly string[]
  readonly problems: readonly string[]
  readonly clips: readonly {
    readonly clipId: string
    readonly dir: string
    readonly file: string
    readonly sha256: string
    readonly frames: number
  }[]
}

export interface LocatedRecord {
  readonly record: AssemblyClipRecord
  /** The record's directory relative to the download root (the same
   * `dir` verifyReel.mjs wrote into reel-manifest.json). */
  readonly dir: string
  /** sha256 of the intermediate on disk now; null when it is missing. */
  readonly actualSha256: string | null
}

export interface VerifiedInputs {
  readonly problems: readonly string[]
  /** Locked shot clip id -> intermediate path relative to the download root. */
  readonly clipFiles: ReadonlyMap<string, string>
}

export function lockedShotClips(edit: FinalEdit): ShotClip[] {
  return edit.timeline.filter(isShotClip)
}

/**
 * The gate before any ffmpeg assembly: the render run's own reel manifest
 * must say verified at the expected SHA, every one of the locked timeline's
 * shot clips must be present exactly once (reelCi.ts verifyReelRecords —
 * the same check the render workflow's verify job ran), and every
 * intermediate must still hash to what both its clip.json and the reel
 * manifest recorded. A missing clip is never filled in: it is a problem.
 */
export function verifyAssemblyInputs(
  edit: FinalEdit,
  expectedSha: string,
  manifest: ReelManifest | null,
  located: readonly LocatedRecord[],
  failures: readonly string[],
): VerifiedInputs {
  const problems: string[] = failures.map((failure) => `render job reported a failure: ${failure}`)
  const clips = lockedShotClips(edit)
  const clipIds = clips.map((clip) => clip.id)
  const timelineMs = edit.timeline[edit.timeline.length - 1]!.destOutMs

  if (manifest === null) {
    problems.push('reel-manifest.json is missing')
  } else {
    if (manifest.gitSha !== expectedSha) problems.push(`reel manifest is for ${manifest.gitSha}, expected ${expectedSha}`)
    if (manifest.verified !== true) problems.push('reel manifest says verified: false')
    if (manifest.problems.length > 0) problems.push(`reel manifest lists problems: ${manifest.problems.join('; ')}`)
    if (manifest.expectedClips !== clips.length || manifest.clipCount !== clips.length) {
      problems.push(`reel manifest covers ${manifest.clipCount}/${manifest.expectedClips} clips, the locked timeline has ${clips.length}`)
    }
    if (manifest.timelineMs !== timelineMs) problems.push(`reel manifest timeline ${manifest.timelineMs}ms, locked edit ${timelineMs}ms`)
    if (manifest.fps !== edit.output.fps) problems.push(`reel manifest fps ${manifest.fps}, locked edit ${edit.output.fps}`)
    if (manifest.gitShas.length !== 1 || manifest.gitShas[0] !== expectedSha) problems.push(`reel manifest mixes SHAs: ${manifest.gitShas.join(', ')}`)
    const manifestIds = manifest.clips.map((clip) => clip.clipId)
    if (manifestIds.join(',') !== clipIds.join(',')) problems.push(`reel manifest clips [${manifestIds.join(',')}] != locked timeline [${clipIds.join(',')}]`)
  }

  const records = located.map((entry) => entry.record)
  problems.push(...verifyReelRecords(edit, records, clipIds, expectedSha).problems)

  const clipFiles = new Map<string, string>()
  for (const { record, dir, actualSha256 } of located) {
    if (!clipIds.includes(record.clipId)) continue // already reported by verifyReelRecords
    if (actualSha256 === null) problems.push(`${record.clipId}: intermediate ${dir}/${record.output.file} is missing`)
    else if (actualSha256 !== record.output.sha256) problems.push(`${record.clipId}: intermediate hashes to ${actualSha256}, clip.json recorded ${record.output.sha256}`)
    const entry = manifest?.clips.find((clip) => clip.clipId === record.clipId)
    if (manifest !== null && entry === undefined) problems.push(`${record.clipId}: not in the reel manifest`)
    if (entry !== undefined) {
      if (entry.sha256 !== record.output.sha256) problems.push(`${record.clipId}: reel manifest sha256 ${entry.sha256} != clip.json ${record.output.sha256}`)
      if (entry.dir !== dir || entry.file !== record.output.file) problems.push(`${record.clipId}: reel manifest points at ${entry.dir}/${entry.file}, found ${dir}/${record.output.file}`)
    }
    if (!clipFiles.has(record.clipId)) clipFiles.set(record.clipId, `${dir}/${record.output.file}`)
  }
  return { problems, clipFiles }
}

/** What an intermediate must look like on ffprobe before it is used. */
export interface ProbedStream {
  readonly type: string
  readonly codec: string
  readonly profile?: string
  readonly pixFmt?: string
  readonly width?: number
  readonly height?: number
  readonly fps?: number
  /** Decoded frame count (ffprobe -count_frames), video only. */
  readonly frames?: number
  readonly durationSec?: number
  readonly sampleRate?: number
  readonly channels?: number
}

export function checkIntermediate(edit: FinalEdit, clip: ShotClip, streams: readonly ProbedStream[]): string[] {
  const problems: string[] = []
  const video = streams.filter((stream) => stream.type === 'video')
  if (streams.length !== 1 || video.length !== 1) problems.push(`${clip.id}: expected one video stream, found ${streams.map((s) => s.type).join(', ') || 'none'}`)
  const stream = video[0]
  if (stream === undefined) return problems
  const frames = framesForMs(clip.destOutMs - clip.destInMs, edit.output.fps)
  if (stream.codec !== 'h264') problems.push(`${clip.id}: codec ${stream.codec}`)
  if (stream.pixFmt !== 'yuv444p') problems.push(`${clip.id}: pixel format ${String(stream.pixFmt)}, expected yuv444p`)
  if (stream.width !== edit.output.width || stream.height !== edit.output.height) problems.push(`${clip.id}: ${stream.width}x${stream.height}`)
  if (stream.fps !== edit.output.fps) problems.push(`${clip.id}: ${stream.fps} fps`)
  if (stream.frames !== frames) problems.push(`${clip.id}: ${stream.frames} decoded frames, locked edit needs ${frames}`)
  return problems
}

// ---------------------------------------------------------------------------
// Sequences: the locked timeline (reel) or a sub-sequence of it (loop)
// ---------------------------------------------------------------------------

export function framesForMs(ms: number, fps: number): number {
  const frames = (ms * fps) / 1000
  if (!Number.isInteger(frames)) throw new Error(`${ms}ms is not a whole number of ${fps}fps frames`)
  return frames
}

export type FadeColor = 'black' | 'white'

export interface Fade {
  readonly color: FadeColor
  readonly frames: number
}

export interface Segment {
  readonly id: string
  readonly kind: 'shot' | 'end-card'
  readonly frames: number
  /** Fade from a color at the segment's start (head fade, second half of a
   * flash/dip), or null. */
  readonly head: Fade | null
  /** Fade to a color at the segment's end (first half of a flash/dip, a
   * fade-black), or null. */
  readonly tail: Fade | null
}

export interface SequencePlan {
  /** Frame rate the segments are planned (and faded) at: the edit's output fps. */
  readonly fps: number
  readonly segments: readonly Segment[]
  readonly frames: number
}

/**
 * Lays out timeline items in the given order at the edit's output fps, with
 * the edit's own transitions (finalEdit.ts TransitionType):
 *   - the head fade from black belongs to the timeline's first item;
 *   - flash-white / dip-black are centered on the cut: half the duration
 *     fades the outgoing clip to the color, half fades the incoming clip
 *     back from it;
 *   - fade-black fades only the outgoing clip, ending exactly at the cut.
 * A transition belongs to the cut between a clip and its timeline
 * successor, so it is applied only where the sequence keeps that pair
 * adjacent; anywhere else (the loop's jumps) is a plain cut. Nothing is
 * crossfaded, so every clip keeps exactly its locked frame count.
 */
export function planSequence(edit: FinalEdit, ids: readonly string[]): SequencePlan {
  const fps = edit.output.fps
  const { timeline } = edit
  const indexById = new Map(timeline.map((item, index) => [item.id, index]))
  if (ids.length === 0) throw new Error('empty sequence')
  if (new Set(ids).size !== ids.length) throw new Error(`sequence repeats a clip: ${ids.join(',')}`)
  for (const id of ids) if (!indexById.has(id)) throw new Error(`sequence references ${id}, which is not in the locked timeline`)

  const heads: (Fade | null)[] = ids.map(() => null)
  const tails: (Fade | null)[] = ids.map(() => null)
  if (ids[0] === timeline[0]!.id && edit.headFadeFromBlackMs > 0) {
    heads[0] = { color: 'black', frames: framesForMs(edit.headFadeFromBlackMs, fps) }
  }
  for (let position = 0; position < ids.length - 1; position += 1) {
    const index = indexById.get(ids[position]!)!
    const item = timeline[index]!
    const successor = timeline[index + 1]
    if (!isShotClip(item) || successor === undefined || successor.id !== ids[position + 1]) continue
    const { type, durationMs } = item.transitionOut
    if (type === 'cut') continue
    if (type === 'fade-black') {
      tails[position] = { color: 'black', frames: framesForMs(durationMs, fps) }
    } else {
      const half: Fade = { color: type === 'flash-white' ? 'white' : 'black', frames: framesForMs(durationMs / 2, fps) }
      tails[position] = half
      heads[position + 1] = half
    }
  }

  const segments = ids.map((id, position): Segment => {
    const item = timeline[indexById.get(id)!]!
    const frames = framesForMs(item.destOutMs - item.destInMs, fps)
    const head = heads[position]!
    const tail = tails[position]!
    if ((head?.frames ?? 0) + (tail?.frames ?? 0) > frames) throw new Error(`${id}: transitions are longer than the clip`)
    return { id, kind: item.kind === 'shot' ? 'shot' : 'end-card', frames, head, tail }
  })
  return { fps, segments, frames: segments.reduce((sum, segment) => sum + segment.frames, 0) }
}

/** The whole locked timeline, in order: all 25 shot clips and the end card. */
export function planReel(edit: FinalEdit): SequencePlan {
  return planSequence(
    edit,
    edit.timeline.map((item) => item.id),
  )
}

export interface LoopPlan {
  readonly sequence: SequencePlan
  readonly fps: number
  /** Planned frames per loop frame (edit fps / loop fps). */
  readonly step: number
  readonly frames: number
  readonly durationMs: number
}

/** derivatives.loop: its clip list, silent, at its own fps — every output
 * frame is exactly every `step`-th real frame (no blending, no retiming). */
export function planLoop(edit: FinalEdit): LoopPlan {
  const { loop } = edit.derivatives
  if (!loop.silent) throw new Error('derivatives.loop must be silent')
  const shotIds = new Set(lockedShotClips(edit).map((clip) => clip.id))
  for (const id of loop.clipIds) if (!shotIds.has(id)) throw new Error(`loop clip ${id} is not a locked shot clip`)
  const sequence = planSequence(edit, loop.clipIds)
  const step = edit.output.fps / loop.fps
  if (!Number.isInteger(step)) throw new Error(`loop fps ${loop.fps} does not divide ${edit.output.fps}`)
  for (const segment of sequence.segments) {
    if (segment.frames % step !== 0) throw new Error(`${segment.id}: ${segment.frames} frames do not decimate evenly to ${loop.fps}fps`)
  }
  const frames = sequence.frames / step
  return { sequence, fps: loop.fps, step, frames, durationMs: (frames * 1000) / loop.fps }
}

export interface FadeAt {
  readonly color: FadeColor
  /** 0 = untouched picture, 1 = solid color. */
  readonly amount: number
}

/**
 * The fade envelope sampled at a frame's start time. For a head fade of n
 * frames, frame k is (1 - k/n) of the way to the color (frame 0 is solid);
 * for a tail fade of n frames, its j-th frame is j/n (the last frame is one
 * step from solid; the cut itself is the solid point). This is exactly
 * ffmpeg's own `fade` filter convention, and it is frame-rate independent:
 * decimating a 60fps envelope by 2 gives the 30fps envelope.
 */
export function fadeAt(segment: Segment, frame: number): FadeAt | null {
  const { head, tail, frames } = segment
  if (head !== null && frame < head.frames) return { color: head.color, amount: 1 - frame / head.frames }
  if (tail !== null && frame >= frames - tail.frames) {
    const amount = (frame - (frames - tail.frames)) / tail.frames
    return amount === 0 ? null : { color: tail.color, amount }
  }
  return null
}

export interface ExpectedFrame {
  readonly segment: string
  /** Frame index inside that segment's source (its intermediate). */
  readonly frame: number
  readonly fade: FadeAt | null
}

/** Output frame j -> the source frame and fade it must show. */
export function expectedFrames(plan: SequencePlan, step = 1): ExpectedFrame[] {
  const frames: ExpectedFrame[] = []
  let base = 0
  for (const segment of plan.segments) {
    for (let frame = 0; frame < segment.frames; frame += 1) {
      if ((base + frame) % step === 0) frames.push({ segment: segment.id, frame, fade: fadeAt(segment, frame) })
    }
    base += segment.frames
  }
  return frames
}

// ---------------------------------------------------------------------------
// Release frame overrides: declared one-frame repairs of verified footage
// ---------------------------------------------------------------------------

export interface FrameRef {
  readonly clipId: string
  /** Frame index inside that clip's intermediate. */
  readonly frame: number
}

/** The render-run footage an override was declared against. */
export interface OverrideSource {
  readonly runNumber: number
  readonly runId: number
  readonly headSha: string
  /** The run artifact holding the repaired clip, and its pinned zip digest. */
  readonly artifact: string
  readonly artifactDigest: string
}

export interface ReleaseFrameOverride {
  readonly source: OverrideSource
  /** 0-based frame of the reel (reel-57s-1080.mp4) at the edit's fps. */
  readonly reelFrame: number
  /** What the locked plan puts on that reel frame; must match it exactly. */
  readonly original: FrameRef
  /** The verified neighbouring frame of the same clip shown instead. */
  readonly replacement: FrameRef
  readonly reason: string
  /** Set on the per-frame records a ReleaseIntervalOverride expands to: the
   * replacement is a frame of another (16:9) shot clip, not a neighbour. */
  readonly cover?: true
}

/**
 * Every frame of the release reel that does NOT show what the locked plan
 * puts there. Each entry is a release-media repair of one defective source
 * frame, never an edit: the reel keeps its locked frame count and timing,
 * every other frame is untouched, nothing is rendered or interpolated, and
 * the replacement is the adjacent frame of the same verified clip. An entry
 * applies only to the footage it names (run, SHA and the pinned digest of
 * the artifact holding the clip); the verifier expects exactly these frames
 * to differ from the plan and still fails on any other difference.
 */
export const RELEASE_FRAME_OVERRIDES: readonly ReleaseFrameOverride[] = [
  {
    source: {
      runNumber: 6,
      runId: 36346715980,
      headSha: 'd3301b4f01c3a27a42525b0876f3039ea66c55d9',
      artifact: 'render-act2-rival-c03',
      artifactDigest: 'sha256:90d96a7aebbcd2e312897d22e3b0f9e4a306ef9b41ebeacb373cc1a8323c3a15',
    },
    // 7.800s, c03 vesper-citadel-reveal. Source frame 36 was captured with
    // the scene drawn at ~5/6 size into the top-left of the frame (the base
    // visibly shrinks for one frame); frames 35 and 37 are correct.
    reelFrame: 468,
    original: { clipId: 'c03', frame: 36 },
    replacement: { clipId: 'c03', frame: 37 },
    reason: 'one-frame enemy-base scale/camera defect',
  },
]

/**
 * A whole portrait insert replaced by a horizontal frame, frame for frame.
 * The locked cut holds two real 390x844 phone-viewport stills (c14, c18) as
 * pillarboxed portrait clips inside the 16:9 reel, which breaks the aspect
 * ratio on mobile. Each interval covers exactly one portrait clip's reel
 * frames and shows one frame of the immediately adjacent 16:9 shot clip on
 * every one of them: the reel keeps its frame count and every other frame
 * keeps its position. It expands to ordinary per-frame overrides
 * (expandIntervalOverrides), so the plan check, the declared-frames check
 * and the frame-by-frame verification treat it exactly like any other
 * release override. Nothing is rendered, cropped, blurred or interpolated.
 */
export interface ReleaseIntervalOverride {
  readonly source: OverrideSource
  /** First reel frame and the number of reel frames covered. */
  readonly reelFrame: number
  readonly frames: number
  /** The portrait clip frame the locked plan puts on `reelFrame` (its
   * first frame); the following reel frames show its following frames. */
  readonly original: FrameRef
  /** The verified frame of the neighbouring 16:9 clip held on every frame. */
  readonly hold: FrameRef
  readonly reason: string
}

const RUN6_FOOTAGE = { runNumber: 6, runId: 36346715980, headSha: 'd3301b4f01c3a27a42525b0876f3039ea66c55d9' } as const

export const RELEASE_INTERVAL_OVERRIDES: readonly ReleaseIntervalOverride[] = [
  {
    source: { ...RUN6_FOOTAGE, artifact: 'render-act4-counterstrike', artifactDigest: 'sha256:3fddf2205ef6928baee104ae3a056283cbf51e5236a77941e76430dd6c759f9b' },
    // 29.400-30.000s. c14 (the FIRE NOW thumb target on a phone viewport)
    // gives way to c13, the desktop still of the same moment that precedes
    // it: its last frame, held.
    reelFrame: 1764,
    frames: 36,
    original: { clipId: 'c14', frame: 0 },
    hold: { clipId: 'c13', frame: 35 },
    reason: 'portrait phone-viewport still breaks the 16:9 reel; the same FIRE NOW moment stays on the desktop frame',
  },
  {
    source: { ...RUN6_FOOTAGE, artifact: 'render-act5-divider', artifactDigest: 'sha256:56efc503b5f93fca76886a417ad20c83ae85ebbc22f117b61d380f03d4b5f378' },
    // 34.800-36.000s. c18 (TARGET LOCKED · FIRE DEFENSE on a phone viewport)
    // gives way to the last frame of c17, the lock-on shot before it, held.
    reelFrame: 2088,
    frames: 72,
    original: { clipId: 'c18', frame: 0 },
    hold: { clipId: 'c17', frame: 71 },
    reason: 'portrait phone-viewport still breaks the 16:9 reel; the locked-on formation frame of the adjacent shot is held instead',
  },
]

/** The per-frame overrides an interval stands for. */
export function expandIntervalOverrides(intervals: readonly ReleaseIntervalOverride[]): ReleaseFrameOverride[] {
  return intervals.flatMap(({ source, reelFrame, frames, original, hold, reason }) =>
    Array.from({ length: frames }, (_, offset): ReleaseFrameOverride => ({
      source,
      reelFrame: reelFrame + offset,
      original: { clipId: original.clipId, frame: original.frame + offset },
      replacement: hold,
      reason,
      cover: true,
    })),
  )
}

/** The validated render run the footage was downloaded from
 * (source-run.json as capture/ci/sourceRun.mjs writes it; the subset read). */
export interface SourceRunRecord {
  readonly runId: number
  readonly runNumber: number
  readonly headSha: string
  readonly artifacts: readonly { readonly name: string; readonly digest: string }[]
}

/**
 * The overrides that apply to footage rendered at `sha`. An override
 * declared for that SHA must be confirmed against the source run record
 * (run id and number, the artifact's verified digest) and the clip's
 * intermediate must come from that artifact; anything unconfirmed is a
 * problem — a declared repair is never silently skipped, and never applied
 * to other footage. Overrides for other SHAs do not apply.
 */
export function overridesForSource(
  overrides: readonly ReleaseFrameOverride[],
  sha: string,
  source: SourceRunRecord | null,
  clipFiles: ReadonlyMap<string, string>,
): { readonly overrides: ReleaseFrameOverride[]; readonly problems: string[] } {
  const applicable: ReleaseFrameOverride[] = []
  const problems: string[] = []
  for (const override of overrides) {
    if (override.source.headSha !== sha) continue
    const label = `frame override @ reel frame ${override.reelFrame}`
    const before = problems.length
    if (source === null) {
      problems.push(`${label} is declared for run #${override.source.runNumber} @ ${sha}; pass --source=<source-run.json> so its footage can be confirmed`)
    } else {
      if (source.headSha !== override.source.headSha) problems.push(`${label}: source run is @ ${source.headSha}, override is for ${override.source.headSha}`)
      if (source.runId !== override.source.runId || source.runNumber !== override.source.runNumber) {
        problems.push(`${label}: source run is #${source.runNumber} (${source.runId}), override is for #${override.source.runNumber} (${override.source.runId})`)
      }
      const artifact = source.artifacts.find((entry) => entry.name === override.source.artifact)
      if (artifact === undefined) problems.push(`${label}: source run has no artifact ${override.source.artifact}`)
      else if (artifact.digest !== override.source.artifactDigest) problems.push(`${label}: ${override.source.artifact} digest ${artifact.digest}, override is for ${override.source.artifactDigest}`)
    }
    for (const ref of [override.original, override.replacement]) {
      const file = clipFiles.get(ref.clipId)
      if (file === undefined || !file.startsWith(`${override.source.artifact}/`)) {
        problems.push(`${label}: ${ref.clipId} intermediate ${file ?? '(missing)'} is not from artifact ${override.source.artifact}`)
      }
    }
    if (problems.length === before) applicable.push(override)
  }
  return { overrides: applicable, problems }
}

/** overridesForSource for intervals: the same binding to the run, its
 * artifact digest and the clips' intermediates, checked once per interval on
 * a representative frame (both clips must come from the interval's artifact). */
export function intervalsForSource(
  intervals: readonly ReleaseIntervalOverride[],
  sha: string,
  source: SourceRunRecord | null,
  clipFiles: ReadonlyMap<string, string>,
): { readonly intervals: ReleaseIntervalOverride[]; readonly problems: string[] } {
  const applicable: ReleaseIntervalOverride[] = []
  const problems: string[] = []
  for (const interval of intervals) {
    const bound = overridesForSource([{ source: interval.source, reelFrame: interval.reelFrame, original: interval.original, replacement: interval.hold, reason: interval.reason }], sha, source, clipFiles)
    problems.push(...bound.problems)
    if (bound.overrides.length > 0) applicable.push(interval)
  }
  return { intervals: applicable, problems }
}

/**
 * An interval must replace exactly one whole pillarbox-portrait clip of the
 * locked plan (its first reel frame to its last, nothing before or after)
 * with one frame of the immediately adjacent full-16x9 shot clip.
 */
export function validateIntervalOverrides(edit: FinalEdit, plan: SequencePlan, intervals: readonly ReleaseIntervalOverride[]): string[] {
  const problems: string[] = []
  const shots = new Map(lockedShotClips(edit).map((clip) => [clip.id, clip]))
  const order = edit.timeline.map((item) => item.id)
  for (const interval of intervals) {
    const { reelFrame, frames, original, hold } = interval
    const label = `interval override @ reel frames ${reelFrame}-${reelFrame + frames - 1}`
    if (!Number.isInteger(reelFrame) || !Number.isInteger(frames) || frames < 1) {
      problems.push(`${label}: not a whole, non-empty frame range`)
      continue
    }
    if (interval.reason.trim() === '') problems.push(`${label}: no reason given`)
    const clip = shots.get(original.clipId)
    const cover = shots.get(hold.clipId)
    if (clip === undefined || clip.framing !== 'pillarbox-portrait') problems.push(`${label}: ${original.clipId} is not a pillarbox-portrait shot clip`)
    if (cover === undefined || cover.framing !== 'full-16x9') problems.push(`${label}: replacement ${hold.clipId} is not a full-16x9 shot clip`)
    if (clip === undefined || cover === undefined) continue
    if (Math.abs(order.indexOf(clip.id) - order.indexOf(cover.id)) !== 1) problems.push(`${label}: ${cover.id} is not the timeline neighbour of ${clip.id}`)
    let start = 0
    for (const segment of plan.segments) {
      if (segment.id === clip.id) break
      start += segment.frames
    }
    const clipFrames = plan.segments.find((segment) => segment.id === clip.id)!.frames
    if (reelFrame !== start || frames !== clipFrames || original.frame !== 0) {
      problems.push(`${label}: ${clip.id} occupies reel frames ${start}-${start + clipFrames - 1}, the interval must cover exactly that`)
    }
    const coverFrames = plan.segments.find((segment) => segment.id === cover.id)!.frames
    if (!Number.isInteger(hold.frame) || hold.frame < 0 || hold.frame >= coverFrames) problems.push(`${label}: ${cover.id}#${hold.frame} is outside its ${coverFrames} frames`)
  }
  return problems
}

/** Reel frames that still show a pillarbox-portrait clip. */
export function portraitReelFrames(edit: FinalEdit, frames: readonly ExpectedFrame[]): number[] {
  const portrait = new Set(lockedShotClips(edit).filter((clip) => clip.framing === 'pillarbox-portrait').map((clip) => clip.id))
  return frames.flatMap((frame, index) => (portrait.has(frame.segment) ? [index] : []))
}

/**
 * An override must be a one-frame repair inside the locked plan: its reel
 * frame shows exactly `original` in the plan, outside any transition; the
 * replacement is the adjacent frame of the same shot clip, itself shown
 * untouched on the neighbouring reel frame; one override per frame, no
 * chains; and the clip is in no other deliverable (the loop, the poster),
 * which would otherwise keep the defect.
 */
export function validateFrameOverrides(edit: FinalEdit, plan: SequencePlan, overrides: readonly ReleaseFrameOverride[]): string[] {
  const problems: string[] = []
  const locked = expectedFrames(plan)
  const targets = new Set<number>()
  for (const override of overrides) {
    const { reelFrame, original, replacement } = override
    const label = `frame override @ reel frame ${reelFrame}`
    if (!Number.isInteger(reelFrame) || reelFrame < 0 || reelFrame >= locked.length) {
      problems.push(`${label}: outside the ${locked.length}-frame reel`)
      continue
    }
    if (targets.has(reelFrame)) problems.push(`${label}: declared more than once`)
    targets.add(reelFrame)
    if (override.reason.trim() === '') problems.push(`${label}: no reason given`)
    const planned = locked[reelFrame]!
    if (planned.segment !== original.clipId || planned.frame !== original.frame) {
      problems.push(`${label}: the locked plan shows ${planned.segment}#${planned.frame} there, the override declares ${original.clipId}#${original.frame}`)
      continue
    }
    const segment = plan.segments.find((entry) => entry.id === original.clipId)!
    if (segment.kind !== 'shot') problems.push(`${label}: ${original.clipId} is not a shot clip`)
    if (planned.fade !== null) problems.push(`${label}: inside a ${planned.fade.color} transition`)
    if (override.cover === true) {
      // An interval frame: validateIntervalOverrides holds the interval rules.
      if (replacement.clipId === original.clipId) problems.push(`${label}: a cover replacement must come from another clip`)
    } else if (replacement.clipId !== original.clipId) problems.push(`${label}: replacement ${replacement.clipId}#${replacement.frame} is not from ${original.clipId}`)
    else if (Math.abs(replacement.frame - original.frame) !== 1) problems.push(`${label}: replacement ${replacement.clipId}#${replacement.frame} is not adjacent to ${original.clipId}#${original.frame}`)
    else {
      const neighbour = locked[reelFrame + replacement.frame - original.frame]
      if (neighbour === undefined || neighbour.segment !== replacement.clipId || neighbour.frame !== replacement.frame || neighbour.fade !== null) {
        problems.push(`${label}: replacement ${replacement.clipId}#${replacement.frame} is not shown untouched on the neighbouring reel frame`)
      }
    }
    if (edit.derivatives.loop.clipIds.includes(original.clipId)) problems.push(`${label}: ${original.clipId} is also in the loop, which would keep the defect`)
    const poster = selectPosterFrame(edit)
    if (poster.clipId === original.clipId && poster.frame === original.frame) problems.push(`${label}: ${original.clipId}#${original.frame} is also the poster frame`)
  }
  for (const override of overrides) {
    if (override.cover !== true && targets.has(override.reelFrame + override.replacement.frame - override.original.frame)) {
      problems.push(`frame override @ reel frame ${override.reelFrame}: its replacement's own reel frame is overridden too`)
    }
  }
  return problems
}

/** The locked plan with exactly the declared frames swapped for their
 * replacement (no fade: overrides never sit in a transition). Throws if an
 * override does not match the plan — validateFrameOverrides reports why. */
export function applyFrameOverrides(locked: readonly ExpectedFrame[], overrides: readonly ReleaseFrameOverride[]): ExpectedFrame[] {
  const frames = [...locked]
  for (const { reelFrame, original, replacement } of overrides) {
    const planned = frames[reelFrame]
    if (planned === undefined || planned.segment !== original.clipId || planned.frame !== original.frame || planned.fade !== null) {
      throw new Error(`frame override @ reel frame ${reelFrame} does not match the locked plan`)
    }
    frames[reelFrame] = { segment: replacement.clipId, frame: replacement.frame, fade: null }
  }
  return frames
}

/** Reel frames whose expected source differs between two plans. */
export function changedFrames(a: readonly ExpectedFrame[], b: readonly ExpectedFrame[]): number[] {
  if (a.length !== b.length) throw new Error(`plans have ${a.length} and ${b.length} frames`)
  const changed: number[] = []
  a.forEach((frame, index) => {
    const other = b[index]!
    if (frame.segment !== other.segment || frame.frame !== other.frame || frame.fade?.color !== other.fade?.color || frame.fade?.amount !== other.fade?.amount) changed.push(index)
  })
  return changed
}

/** Where a clip frame sits in its source clock (for the audit record). */
export function describeClipFrame(edit: FinalEdit, ref: FrameRef): { clipId: string; shotId: string; frame: number; clock: string; value: number | null; sourceMs: number | null } {
  const clip = lockedShotClips(edit).find((entry) => entry.id === ref.clipId)
  if (clip === undefined) throw new Error(`${ref.clipId} is not a locked shot clip`)
  const window = clip.source
  const frames = framesForMs(clip.destOutMs - clip.destInMs, edit.output.fps)
  if (window.clock === 'still') return { clipId: clip.id, shotId: clip.shotId, frame: ref.frame, clock: 'still', value: null, sourceMs: null }
  const value = sourceValueAt(window, frameProgressAt(ref.frame, frames))
  const sourceMs = window.clock === 'progress' ? value * window.phaseDurationMs : value
  const clock = window.clock === 'progress' ? `progress of ${window.phase}` : `elapsed-ms from ${window.origin}`
  return { clipId: clip.id, shotId: clip.shotId, frame: ref.frame, clock, value, sourceMs }
}

// ---------------------------------------------------------------------------
// ffmpeg filter graphs
// ---------------------------------------------------------------------------

/** BT.709 limited-range levels of the intermediates (and of ffmpeg's
 * `color` source in yuv444p): luma 16 black / 235 white, neutral chroma. */
const LUMA: Readonly<Record<FadeColor, number>> = { black: 16, white: 235 }
const NEUTRAL_CHROMA = 128
export const SCALE_FLAGS = 'lanczos+accurate_rnd+full_chroma_int'

/**
 * One fade, applied in YUV to exactly the frames of one trimmed part (N
 * restarts at 0 there). ffmpeg's `fade` filter can only fade to black in
 * YUV — any other color forces an RGB round trip over the whole clip — so
 * every fade uses this one explicit, exact expression instead.
 */
export function fadeFilter(fade: Fade, position: 'head' | 'tail'): string {
  const amount = position === 'head' ? `(1-N/${fade.frames})` : `(N/${fade.frames})`
  const towards = (level: number) => `'round(p(X,Y)+(${level}-p(X,Y))*${amount})'`
  return `geq=lum=${towards(LUMA[fade.color])}:cb=${towards(NEUTRAL_CHROMA)}:cr=${towards(NEUTRAL_CHROMA)}`
}

export interface GraphSources {
  /** ffmpeg input stream label per shot segment id, e.g. "3:v". */
  readonly shots: ReadonlyMap<string, string>
  /** Input label of a designed end-card still (looped), or null: the end
   * card is not designed yet (capture/endCardFacts.ts), so its locked slot
   * is black. */
  readonly endCard: string | null
  readonly width: number
  readonly height: number
  /** Input label per covered segment id: a second, independent input of the
   * clip whose frame covers it (a release interval override), so the
   * covering frame is read on its own and nothing is buffered across
   * segments. Only needed for segments with cover substitutions. */
  readonly covers?: ReadonlyMap<string, string>
}

function segmentSource(segment: Segment, sources: GraphSources, fps: number): string {
  const timing = `settb=1/${fps},setpts=N`
  if (segment.kind === 'shot') {
    const label = sources.shots.get(segment.id)
    if (label === undefined) throw new Error(`no input for ${segment.id}`)
    return `[${label}]${timing},format=yuv444p`
  }
  const size = `${sources.width}x${sources.height}`
  if (sources.endCard === null) return `color=c=black:s=${size}:r=${fps},format=yuv444p,trim=end_frame=${segment.frames},${timing}`
  return (
    `[${sources.endCard}]scale=${sources.width}:${sources.height}:flags=${SCALE_FLAGS}:out_color_matrix=bt709:out_range=tv,` +
    `format=yuv444p,setsar=1,trim=end_frame=${segment.frames},${timing}`
  )
}

/** One segment-local frame shown in place of another (a validated
 * release frame override). With `clipId`, the frame is `source` of that
 * other clip (a cover) instead of another frame of the segment's own. */
export interface FrameSubstitution {
  readonly frame: number
  readonly source: number
  readonly clipId?: string
}

/** Release frame overrides as per-segment substitutions for the graph. */
export function frameSubstitutions(plan: SequencePlan, overrides: readonly ReleaseFrameOverride[]): Map<string, FrameSubstitution[]> {
  const locked = expectedFrames(plan)
  const substitutions = new Map<string, FrameSubstitution[]>()
  applyFrameOverrides(locked, overrides) // throws unless every override matches the plan
  for (const { original, replacement, cover } of overrides) {
    const substitution: FrameSubstitution = cover === true ? { frame: original.frame, source: replacement.frame, clipId: replacement.clipId } : { frame: original.frame, source: replacement.frame }
    substitutions.set(original.clipId, [...(substitutions.get(original.clipId) ?? []), substitution])
  }
  return substitutions
}

interface SegmentPart {
  /** Source frame range [start, end) of the segment's input. */
  readonly start: number
  readonly end: number
  readonly fade: string | null
  /** A cover: frame `start` of another clip's input, held `repeat` times. */
  readonly cover?: { readonly clipId: string; readonly repeat: number }
}

/** The segment's frames as consecutive trimmed parts: head fade, plain
 * runs, tail fade — and, for a substituted frame, a one-frame part taken
 * from its replacement, so every other frame keeps its position. A run of
 * consecutive frames covered by one frame of another clip is a single held
 * part. */
function segmentParts(segment: Segment, substitutions: readonly FrameSubstitution[]): SegmentPart[] {
  const parts: SegmentPart[] = []
  const headFrames = segment.head?.frames ?? 0
  const tailFrames = segment.tail?.frames ?? 0
  const bodyEnd = segment.frames - tailFrames
  if (segment.head !== null) parts.push({ start: 0, end: headFrames, fade: fadeFilter(segment.head, 'head') })
  let cursor = headFrames
  const sorted = [...substitutions].sort((a, b) => a.frame - b.frame)
  for (let index = 0; index < sorted.length; ) {
    const { frame, source, clipId } = sorted[index]!
    if (clipId === undefined) {
      if (frame < cursor || frame >= bodyEnd || source < 0 || source >= segment.frames) {
        throw new Error(`${segment.id}#${frame} -> #${source}: a substitution must replace one untransitioned frame with another frame of the clip`)
      }
      if (frame > cursor) parts.push({ start: cursor, end: frame, fade: null })
      parts.push({ start: source, end: source + 1, fade: null })
      cursor = frame + 1
      index += 1
      continue
    }
    let run = 1
    while (sorted[index + run]?.clipId === clipId && sorted[index + run]!.source === source && sorted[index + run]!.frame === frame + run) run += 1
    if (frame < cursor || frame + run > bodyEnd || source < 0) {
      throw new Error(`${segment.id}#${frame}+${run} -> ${clipId}#${source}: a cover must replace untransitioned frames with one frame of another clip`)
    }
    if (frame > cursor) parts.push({ start: cursor, end: frame, fade: null })
    parts.push({ start: source, end: source + 1, fade: null, cover: { clipId, repeat: run } })
    cursor = frame + run
    index += run
  }
  if (bodyEnd > cursor) parts.push({ start: cursor, end: bodyEnd, fade: null })
  if (segment.tail !== null) parts.push({ start: bodyEnd, end: segment.frames, fade: fadeFilter(segment.tail, 'tail') })
  return parts
}

/** Filter chains for a whole sequence; the concatenated result is `[seq]`
 * at the edit's fps with pts = frame index (so nothing downstream can drop
 * or duplicate a frame to "fix" timestamps). */
export function sequenceChains(plan: SequencePlan, sources: GraphSources, substitutions: ReadonlyMap<string, readonly FrameSubstitution[]> = new Map()): string[] {
  const chains: string[] = []
  plan.segments.forEach((segment, index) => {
    const source = segmentSource(segment, sources, plan.fps)
    const out = `s${index}`
    const substituted = substitutions.get(segment.id) ?? []
    if (substituted.length > 0 && segment.kind !== 'shot') throw new Error(`${segment.id}: only shot clips take frame substitutions`)
    if (segment.head === null && segment.tail === null && substituted.length === 0) {
      chains.push(`${source}[${out}]`)
      return
    }
    const parts = segmentParts(segment, substituted)
    const own = parts.flatMap((part, partIndex) => (part.cover === undefined ? [partIndex] : []))
    // Parts are in output order and concat drains them in the same order;
    // a substituted frame is adjacent to the one it replaces, so split never
    // has to buffer more than a frame or two in flight. A cover part reads a
    // second input of its own, so it never touches the segment's split.
    if (own.length > 0) chains.push(`${source},split=${own.length}${own.map((part) => `[${out}p${part}]`).join('')}`)
    parts.forEach((part, partIndex) => {
      const fade = part.fade === null ? '' : `,${part.fade}`
      if (part.cover !== undefined) {
        const label = sources.covers?.get(segment.id)
        if (label === undefined) throw new Error(`no input for ${part.cover.clipId}, which covers ${segment.id}`)
        chains.push(
          `[${label}]settb=1/${plan.fps},setpts=N,format=yuv444p,trim=start_frame=${part.start}:end_frame=${part.end},setpts=PTS-STARTPTS,` +
            `loop=loop=${part.cover.repeat - 1}:size=1:start=0,setpts=N[${out}q${partIndex}]`,
        )
        return
      }
      chains.push(`[${out}p${partIndex}]trim=start_frame=${part.start}:end_frame=${part.end},setpts=PTS-STARTPTS${fade}[${out}q${partIndex}]`)
    })
    chains.push(`${parts.map((_, part) => `[${out}q${part}]`).join('')}concat=n=${parts.length}:v=1:a=0[${out}]`)
  })
  chains.push(`${plan.segments.map((_, index) => `[s${index}]`).join('')}concat=n=${plan.segments.length}:v=1:a=0,settb=1/${plan.fps},setpts=N[seq]`)
  return chains
}

/** 4:4:4 BT.709 limited -> delivered 4:2:0 BT.709 limited at a size. */
export function deliveryScale(width: number, height: number): string {
  return (
    `scale=${width}:${height}:flags=${SCALE_FLAGS}:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,` +
    'format=yuv420p,setsar=1'
  )
}

/** The reel: the locked plan, with exactly the given (validated) release
 * frame overrides substituted. */
export function reelFilterGraph(edit: FinalEdit, plan: SequencePlan, sources: GraphSources, overrides: readonly ReleaseFrameOverride[] = []): string {
  const substitutions = frameSubstitutions(plan, overrides)
  return [...sequenceChains(plan, sources, substitutions), `[seq]${deliveryScale(edit.output.width, edit.output.height)}[out]`].join(';')
}

export function loopFilterGraph(loop: LoopPlan, sources: GraphSources): string {
  const decimate = `select='not(mod(n,${loop.step}))',settb=1/${loop.fps},setpts=N`
  return [...sequenceChains(loop.sequence, sources), `[seq]${decimate},${deliveryScale(LOOP_SIZE.width, LOOP_SIZE.height)}[out]`].join(';')
}

// ---------------------------------------------------------------------------
// Encode settings, parsed from the locked edit's delivery formats
// ---------------------------------------------------------------------------

export interface X264Settings {
  readonly level: string | null
  readonly crf: number
  readonly preset: string | null
  readonly maxrateMbps: number | null
  readonly bufsizeMbps: number | null
  readonly closedGopSec: number | null
  readonly faststart: boolean
}

/** Parses a derivatives.*.encode string such as "H.264 High 4.2, CRF 16,
 * preset slow, yuv420p, BT.709, closed GOP 1s, +faststart". Anything it
 * cannot read is an error, never a silent default. */
export function parseEncode(format: DeliveryFormat): X264Settings {
  const { encode } = format
  const codec = /^H\.264 High(?: (\d(?:\.\d)?))?(?:,|$)/.exec(encode)
  const crf = /\bCRF (\d+)\b/.exec(encode)
  if (codec === null || crf === null) throw new Error(`unsupported encode spec for ${format.file}: "${encode}"`)
  if (!/\byuv420p\b/.test(encode)) throw new Error(`${format.file}: encode spec must be yuv420p`)
  const number = (pattern: RegExp) => {
    const match = pattern.exec(encode)
    return match === null ? null : Number(match[1])
  }
  return {
    level: codec[1] ?? null,
    crf: Number(crf[1]),
    preset: /\bpreset (\w+)/.exec(encode)?.[1] ?? null,
    maxrateMbps: number(/\bmaxrate (\d+(?:\.\d+)?) Mb\/s/),
    bufsizeMbps: number(/\bbufsize (\d+(?:\.\d+)?) Mb\/s/),
    closedGopSec: number(/\bclosed GOP (\d+(?:\.\d+)?)s\b/),
    faststart: /\+faststart\b/.test(encode),
  }
}

export interface AacSettings {
  readonly bitrateKbps: number
  readonly sampleRate: number
  readonly channels: number
}

export function parseAudio(format: DeliveryFormat): AacSettings {
  const match = /^AAC-LC (\d+) kb\/s stereo (\d+) kHz\b/.exec(format.audio)
  if (match === null) throw new Error(`unsupported audio spec for ${format.file}: "${format.audio}"`)
  return { bitrateKbps: Number(match[1]), sampleRate: Number(match[2]) * 1000, channels: 2 }
}

/** libx264 output options for a delivery. Pixels are BT.709 limited range
 * throughout, so the stream is always tagged as such. */
export function x264Args(settings: X264Settings, fps: number): string[] {
  const args = ['-c:v', 'libx264', '-profile:v', 'high']
  if (settings.level !== null) args.push('-level:v', settings.level)
  if (settings.preset !== null) args.push('-preset', settings.preset)
  args.push('-crf', String(settings.crf))
  if (settings.maxrateMbps !== null) args.push('-maxrate', `${settings.maxrateMbps * 1000}k`)
  if (settings.bufsizeMbps !== null) args.push('-bufsize', `${settings.bufsizeMbps * 1000}k`)
  if (settings.closedGopSec !== null) {
    const gop = String(Math.round(settings.closedGopSec * fps))
    args.push('-g', gop, '-keyint_min', gop, '-sc_threshold', '0', '-flags', '+cgop')
  }
  args.push('-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv')
  if (settings.faststart) args.push('-movflags', '+faststart')
  return args
}

export function aacArgs(settings: AacSettings): string[] {
  return ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', `${settings.bitrateKbps}k`, '-ar', String(settings.sampleRate), '-ac', String(settings.channels)]
}

/** Output options for the silent loop: the edit's web delivery encode
 * (derivatives.webReel) at the loop's fps, and no audio stream at all. */
export function loopOutputArgs(edit: FinalEdit): string[] {
  if (!edit.derivatives.loop.silent) throw new Error('derivatives.loop must be silent')
  return ['-an', '-sn', '-dn', ...x264Args(parseEncode(edit.derivatives.webReel), edit.derivatives.loop.fps)]
}

/** The loop's size budget, from its own spec note ("target <= 8 MB"). */
export function loopMaxBytes(edit: FinalEdit): number {
  const match = /target <= (\d+(?:\.\d+)?) MB/.exec(edit.derivatives.loop.note)
  if (match === null) throw new Error('derivatives.loop.note has no "target <= N MB" budget')
  return Number(match[1]) * 1_000_000
}

// ---------------------------------------------------------------------------
// Poster and social crop
// ---------------------------------------------------------------------------

export interface PosterSelection {
  readonly clipId: string
  /** Frame index inside that clip's intermediate. */
  readonly frame: number
  readonly clipFrames: number
  readonly clock: 'progress' | 'elapsed-ms'
  /** The instant derivatives.poster names, in the source clock's units. */
  readonly requested: number
  /** The instant the chosen frame was rendered at. */
  readonly sampled: number
  readonly deltaSourceMs: number
  /** Source time between two consecutive frames of that clip. */
  readonly frameSpacingSourceMs: number
}

const sameCrop = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/**
 * derivatives.poster names one instant of one shot at one crop. The render
 * run rendered timeline clips only (the poster's own single frame is not a
 * render job), so the poster is the frame of a verified timeline clip of
 * the same shot, same source clock/anchor and same static crop whose
 * sampled instant is nearest the named one. Clip frame i was rendered at
 * sourceValueAt(source, i / (frames - 1)) (finalRender/plan.ts). Throws if
 * no verified clip covers that instant at that crop — a new frame is never
 * chosen and never rendered.
 */
export function selectPosterFrame(edit: FinalEdit): PosterSelection {
  const { poster } = edit.derivatives
  const source = poster.source
  if (source.clock === 'still') throw new Error('poster source is a still; no timeline clip samples it')
  const requested = source.clock === 'progress' ? source.in : source.inMs
  if ((source.clock === 'progress' ? source.out : source.outMs) !== requested) throw new Error('poster must be a single instant')

  let best: PosterSelection | null = null
  for (const clip of lockedShotClips(edit)) {
    const window = clip.source
    if (clip.shotId !== poster.shotId || window.clock !== source.clock) continue
    if (window.clock === 'progress' && source.clock === 'progress' && window.phase !== source.phase) continue
    if (window.clock === 'elapsed-ms' && source.clock === 'elapsed-ms' && window.origin !== source.origin) continue
    const [lo, hi] = window.clock === 'progress' ? [window.in, window.out] : window.clock === 'elapsed-ms' ? [window.inMs, window.outMs] : [0, 0]
    if (requested < lo || requested > hi) continue
    if (!sameCrop(clip.crop, poster.crop) || (clip.cropEnd !== undefined && !sameCrop(clip.cropEnd, poster.crop))) continue
    const frames = framesForMs(clip.destOutMs - clip.destInMs, edit.output.fps)
    const msPerUnit = window.clock === 'progress' ? window.phaseDurationMs : 1
    let frame = 0
    for (let index = 1; index < frames; index += 1) {
      const distance = (i: number) => Math.abs(sourceValueAt(window, frameProgressAt(i, frames)) - requested)
      if (distance(index) < distance(frame)) frame = index
    }
    const sampled = sourceValueAt(window, frameProgressAt(frame, frames))
    const candidate: PosterSelection = {
      clipId: clip.id,
      frame,
      clipFrames: frames,
      clock: window.clock === 'progress' ? 'progress' : 'elapsed-ms',
      requested,
      sampled,
      deltaSourceMs: (sampled - requested) * msPerUnit,
      frameSpacingSourceMs: ((hi - lo) * msPerUnit) / (frames - 1),
    }
    if (best === null || Math.abs(candidate.deltaSourceMs) < Math.abs(best.deltaSourceMs)) best = candidate
  }
  if (best === null) {
    throw new Error(`no verified timeline clip covers the poster instant (${poster.shotId} @ ${requested}) at its crop — STOP; a poster frame is never rendered or invented here`)
  }
  if (Math.abs(best.deltaSourceMs) > best.frameSpacingSourceMs / 2 + 1e-9) throw new Error('nearest poster frame is more than half a frame away')
  return best
}

export interface CropBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The 1200x630 social crop of a 16:9 poster frame. derivatives.poster
 * specifies only the size ("1200x630 social crop") and that the right third
 * stays clean for the title, so the crop keeps the full width (the right
 * third included) and trims top and bottom equally — no reframing choice
 * is made. Title typography is not specified anywhere and is not added.
 */
export function socialCrop(sourceWidth: number, sourceHeight: number): CropBox {
  const h = (sourceWidth * OG_SIZE.height) / OG_SIZE.width
  const y = (sourceHeight - h) / 2
  if (!Number.isInteger(h) || !Number.isInteger(y) || h > sourceHeight) throw new Error(`no whole-pixel ${OG_SIZE.width}x${OG_SIZE.height} crop of ${sourceWidth}x${sourceHeight}`)
  return { x: 0, y, w: sourceWidth, h }
}

// ---------------------------------------------------------------------------
// Output verification
// ---------------------------------------------------------------------------

export interface VideoExpectation {
  readonly file: string
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: number
  readonly audio: AacSettings | null
}

/** Stream-level checks on a finished video: exactly one video stream (and
 * one audio stream iff audio is expected), browser-safe H.264 High 4:2:0,
 * size, fps, decoded frame count, duration. */
export function checkVideoOutput(expect: VideoExpectation, streams: readonly ProbedStream[], formatDurationSec: number, bytes: number): string[] {
  const problems: string[] = []
  const label = expect.file
  if (bytes <= 0) problems.push(`${label}: empty file`)
  const video = streams.filter((stream) => stream.type === 'video')
  const audio = streams.filter((stream) => stream.type === 'audio')
  const other = streams.filter((stream) => stream.type !== 'video' && stream.type !== 'audio')
  if (video.length !== 1) problems.push(`${label}: ${video.length} video streams`)
  if (other.length > 0) problems.push(`${label}: unexpected ${other.map((stream) => stream.type).join(', ')} stream(s)`)
  if (expect.audio === null && audio.length !== 0) problems.push(`${label}: has ${audio.length} audio stream(s), must be silent`)
  if (expect.audio !== null) {
    if (audio.length !== 1) problems.push(`${label}: ${audio.length} audio streams, expected 1`)
    const stream = audio[0]
    if (stream !== undefined) {
      if (stream.codec !== 'aac') problems.push(`${label}: audio codec ${stream.codec}`)
      if (stream.sampleRate !== expect.audio.sampleRate) problems.push(`${label}: audio ${stream.sampleRate} Hz`)
      if (stream.channels !== expect.audio.channels) problems.push(`${label}: audio ${stream.channels} channels`)
    }
  }
  const stream = video[0]
  if (stream !== undefined) {
    if (stream.codec !== 'h264' || stream.profile !== 'High') problems.push(`${label}: ${stream.codec} ${String(stream.profile)}, expected h264 High`)
    if (stream.pixFmt !== 'yuv420p') problems.push(`${label}: pixel format ${String(stream.pixFmt)}`)
    if (stream.width !== expect.width || stream.height !== expect.height) problems.push(`${label}: ${stream.width}x${stream.height}, expected ${expect.width}x${expect.height}`)
    if (stream.fps !== expect.fps) problems.push(`${label}: ${stream.fps} fps, expected ${expect.fps}`)
    if (stream.frames !== expect.frames) problems.push(`${label}: ${stream.frames} decoded frames, expected ${expect.frames}`)
  }
  const expectedSec = expect.frames / expect.fps
  // Mux tolerance: one video frame, plus two AAC frames of priming/padding
  // when there is audio.
  const toleranceSec = 1 / expect.fps + (expect.audio === null ? 0 : 2048 / expect.audio.sampleRate) + 1e-6
  if (Math.abs(formatDurationSec - expectedSec) > toleranceSec) {
    problems.push(`${label}: duration ${formatDurationSec}s, locked ${expectedSec}s`)
  }
  return problems
}

export interface ImageExpectation {
  readonly file: string
  readonly codec: 'mjpeg' | 'webp'
  readonly width: number
  readonly height: number
}

/** Magic bytes + decoder view of a finished still. */
export function checkImageOutput(expect: ImageExpectation, head: Uint8Array, streams: readonly ProbedStream[], bytes: number): string[] {
  const problems: string[] = []
  const label = expect.file
  if (bytes <= 0) problems.push(`${label}: empty file`)
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end))
  const magicOk =
    expect.codec === 'mjpeg' ? head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (!magicOk) problems.push(`${label}: not a ${expect.codec === 'mjpeg' ? 'JPEG' : 'WebP'} file`)
  if (streams.length !== 1) problems.push(`${label}: ${streams.length} streams`)
  const stream = streams[0]
  if (stream !== undefined) {
    if (stream.codec !== expect.codec) problems.push(`${label}: codec ${stream.codec}, expected ${expect.codec}`)
    if (stream.width !== expect.width || stream.height !== expect.height) problems.push(`${label}: ${stream.width}x${stream.height}, expected ${expect.width}x${expect.height}`)
  }
  return problems
}

export interface FidelityResult {
  readonly frames: number
  readonly meanAbsDiff: number
  readonly maxAbsDiff: number
  readonly worst: { readonly outputFrame: number; readonly segment: string; readonly frame: number } | null
  readonly problems: readonly string[]
}

/**
 * Frame-by-frame timeline check on luma thumbnails: output frame j must be
 * its planned source frame (expectedFrames) with its planned fade applied.
 * Any reordering, dropped/duplicated frame, shifted cut or misplaced
 * transition changes which picture lands on which frame and fails this;
 * encode noise averages out at thumbnail size. Thumbnails are raw 8-bit
 * limited-range luma, `pixels` bytes per frame.
 */
export function checkTimelineFidelity(
  expected: readonly ExpectedFrame[],
  output: Uint8Array,
  sources: ReadonlyMap<string, Uint8Array>,
  pixels: number,
  maxMeanAbsDiff: number,
): FidelityResult {
  const problems: string[] = []
  const outputFrames = output.length / pixels
  if (!Number.isInteger(outputFrames) || outputFrames !== expected.length) {
    problems.push(`output has ${outputFrames} thumbnail frames, the plan has ${expected.length}`)
    return { frames: outputFrames, meanAbsDiff: Number.NaN, maxAbsDiff: Number.NaN, worst: null, problems }
  }
  let total = 0
  let max = 0
  let worst: FidelityResult['worst'] = null
  expected.forEach((entry, outputFrame) => {
    const source = sources.get(entry.segment)
    if (source === undefined || source.length < (entry.frame + 1) * pixels) {
      problems.push(`no source thumbnail for ${entry.segment} frame ${entry.frame}`)
      return
    }
    let diff = 0
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      let value = source[entry.frame * pixels + pixel]!
      if (entry.fade !== null) value += (LUMA[entry.fade.color] - value) * entry.fade.amount
      diff += Math.abs(output[outputFrame * pixels + pixel]! - value)
    }
    const mean = diff / pixels
    total += mean
    if (mean > max) {
      max = mean
      worst = { outputFrame, segment: entry.segment, frame: entry.frame }
    }
    if (mean > maxMeanAbsDiff) problems.push(`frame ${outputFrame} (${entry.segment}#${entry.frame}) differs from its planned source by ${mean.toFixed(2)} levels`)
  })
  const shown = problems.length > 20 ? [...problems.slice(0, 20), `…and ${problems.length - 20} more frame(s)`] : problems
  return { frames: expected.length, meanAbsDiff: total / expected.length, maxAbsDiff: max, worst, problems: shown }
}

export interface OverrideCheck {
  readonly reelFrame: number
  /** Mean |luma difference| of the output frame to its replacement and to
   * the original (defective) source frame, in thumbnail levels. */
  readonly toReplacement: number
  readonly toOriginal: number
  readonly problems: readonly string[]
}

/**
 * Each declared override, on the finished output's luma thumbnails: the
 * reel frame must be its replacement (within the fidelity tolerance) and
 * must NOT be the original — and the original must differ from the
 * replacement by more than the tolerance, so the global timeline check
 * provably fails the frame whenever the override is not declared.
 */
export function checkFrameOverrides(
  overrides: readonly ReleaseFrameOverride[],
  output: Uint8Array,
  sources: ReadonlyMap<string, Uint8Array>,
  pixels: number,
  maxMeanAbsDiff: number,
): OverrideCheck[] {
  const meanDiff = (frame: number, ref: FrameRef): number | null => {
    const source = sources.get(ref.clipId)
    if (source === undefined || source.length < (ref.frame + 1) * pixels || output.length < (frame + 1) * pixels) return null
    let diff = 0
    for (let pixel = 0; pixel < pixels; pixel += 1) diff += Math.abs(output[frame * pixels + pixel]! - source[ref.frame * pixels + pixel]!)
    return diff / pixels
  }
  return overrides.map(({ reelFrame, original, replacement }) => {
    const label = `frame override @ reel frame ${reelFrame}`
    const toReplacement = meanDiff(reelFrame, replacement)
    const toOriginal = meanDiff(reelFrame, original)
    const problems: string[] = []
    if (toReplacement === null || toOriginal === null) {
      problems.push(`${label}: no thumbnail for the output frame or its source frames`)
      return { reelFrame, toReplacement: Number.NaN, toOriginal: Number.NaN, problems }
    }
    if (toReplacement > maxMeanAbsDiff) problems.push(`${label}: output differs from replacement ${replacement.clipId}#${replacement.frame} by ${toReplacement.toFixed(2)} levels`)
    if (toOriginal <= toReplacement) problems.push(`${label}: output is still the original ${original.clipId}#${original.frame}`)
    if (toOriginal <= maxMeanAbsDiff) {
      problems.push(`${label}: original ${original.clipId}#${original.frame} is within ${toOriginal.toFixed(2)} levels of the output — an undeclared substitution here would not be caught`)
    }
    return { reelFrame, toReplacement, toOriginal, problems }
  })
}
