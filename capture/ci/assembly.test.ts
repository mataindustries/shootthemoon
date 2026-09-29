/**
 * Tests for the assembly-only release pipeline (capture/ci/assembly.ts,
 * assembleFinalReel.mjs, sourceRun.mjs and
 * .github/workflows/final-reel-assemble.yml). Node's built-in test runner:
 * no browser, no web server, no ffmpeg needed.
 *
 *   node --experimental-strip-types --experimental-transform-types --test capture/ci/assembly.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { FinalEdit } from '../finalEdit.ts'
import {
  applyFrameOverrides,
  changedFrames,
  checkDeliverableNames,
  checkFrameOverrides,
  checkImageOutput,
  checkTimelineFidelity,
  checkVideoOutput,
  DELIVERABLE_METADATA,
  DELIVERABLES,
  describeClipFrame,
  expandIntervalOverrides,
  expectedFrames,
  intervalsForSource,
  lockedShotClips,
  loopOutputArgs,
  overridesForSource,
  parseEncode,
  planLoop,
  planReel,
  planSequence,
  portraitReelFrames,
  reelFilterGraph,
  RELEASE_FRAME_OVERRIDES,
  RELEASE_INTERVAL_OVERRIDES,
  selectPosterFrame,
  selectSourceRun,
  socialCrop,
  validateFrameOverrides,
  validateIntervalOverrides,
  validateSourceRun,
  verifyAssemblyInputs,
  x264Args,
  type ApiArtifact,
  type ApiWorkflowRun,
  type AssemblyClipRecord,
  type ExpectedFrame,
  type LocatedRecord,
  type ReelManifest,
  type ReleaseFrameOverride,
  type ReleaseIntervalOverride,
  type ReleasePin,
  type SourceRunRecord,
} from './assembly.ts'
import { CLIP_METADATA_SCHEMA } from './reelCi.ts'

const CAPTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.join(CAPTURE, '..')
const EDIT: FinalEdit = JSON.parse(readFileSync(path.join(CAPTURE, 'finalEdit.json'), 'utf8'))
const PIN: ReleasePin = JSON.parse(readFileSync(path.join(CAPTURE, 'ci/reelRelease.json'), 'utf8'))
const SHA = 'a'.repeat(40)
/** A freely mutable deep copy (JSON-typed) for negative cases. */
const mutableCopy = (value: unknown): any => JSON.parse(JSON.stringify(value))

// ---------------------------------------------------------------------------
// Fixtures: a complete, valid set of render-run records for the locked edit
// ---------------------------------------------------------------------------

function goodInputs(edit: FinalEdit = EDIT): { manifest: ReelManifest; located: LocatedRecord[] } {
  const located = lockedShotClips(edit).map((clip, index): LocatedRecord => {
    const frames = ((clip.destOutMs - clip.destInMs) / 1000) * edit.output.fps
    const sha256 = index.toString(16).padStart(64, '0')
    const record: AssemblyClipRecord = {
      schema: CLIP_METADATA_SCHEMA,
      status: 'verified',
      gitSha: SHA,
      group: `render-${clip.id}`,
      act: clip.act,
      clipId: clip.id,
      shotId: clip.shotId,
      dest: { inMs: clip.destInMs, outMs: clip.destOutMs, durationMs: clip.destOutMs - clip.destInMs },
      source: { frames: clip.source.clock === 'still' ? 1 : frames, width: 3840, height: 2160 },
      output: {
        file: `${clip.id}__${clip.shotId}.mp4`,
        frames,
        width: edit.output.width,
        height: edit.output.height,
        fps: edit.output.fps,
        durationSec: frames / edit.output.fps,
        sha256,
        decodedAdjacentDuplicates: 0,
      },
    }
    return { record, dir: `render-${clip.id}/${clip.id}__${clip.shotId}`, actualSha256: sha256 }
  })
  const manifest: ReelManifest = {
    gitSha: SHA,
    verified: true,
    expectedClips: located.length,
    clipCount: located.length,
    timelineMs: edit.timeline[edit.timeline.length - 1]!.destOutMs,
    fps: edit.output.fps,
    gitShas: [SHA],
    problems: [],
    clips: located.map(({ record, dir }) => ({ clipId: record.clipId, dir, file: record.output.file, sha256: record.output.sha256, frames: record.output.frames })),
  }
  return { manifest, located }
}

// ---------------------------------------------------------------------------
// 1-3. Input verification: missing clip, hash mismatch, all-and-only locked clips
// ---------------------------------------------------------------------------

test('a complete, verified render run passes and maps every locked clip to its intermediate', () => {
  const { manifest, located } = goodInputs()
  const result = verifyAssemblyInputs(EDIT, SHA, manifest, located, [])
  assert.deepEqual(result.problems, [])
  assert.deepEqual([...result.clipFiles.keys()], lockedShotClips(EDIT).map((clip) => clip.id))
  assert.equal(result.clipFiles.size, 25)
  assert.equal(result.clipFiles.get('c07'), 'render-c07/c07__first-strike-orbital-flight/c07__first-strike-orbital-flight.mp4')
})

test('assembly rejects a missing clip instead of filling it', () => {
  const { manifest, located } = goodInputs()
  const withoutC13 = located.filter((entry) => entry.record.clipId !== 'c13')
  const problems = verifyAssemblyInputs(EDIT, SHA, manifest, withoutC13, []).problems
  assert.ok(problems.includes('c13: missing'), problems.join('\n'))
  // …and a missing intermediate file behind a present clip.json.
  const noFile = located.map((entry) => (entry.record.clipId === 'c20' ? { ...entry, actualSha256: null } : entry))
  assert.ok(verifyAssemblyInputs(EDIT, SHA, manifest, noFile, []).problems.some((problem) => problem.startsWith('c20: intermediate') && problem.includes('missing')))
  // …and a render job that reported a failure.
  assert.ok(verifyAssemblyInputs(EDIT, SHA, manifest, located, ['render-c19/FAILED.json: timeout']).problems.length > 0)
})

test('assembly rejects an intermediate whose hash does not match its clip.json or the reel manifest', () => {
  const { manifest, located } = goodInputs()
  const tampered = located.map((entry) => (entry.record.clipId === 'c10' ? { ...entry, actualSha256: 'f'.repeat(64) } : entry))
  assert.ok(verifyAssemblyInputs(EDIT, SHA, manifest, tampered, []).problems.some((problem) => problem.startsWith('c10: intermediate hashes to')))

  const drifted = mutableCopy(manifest)
  drifted.clips[3].sha256 = 'e'.repeat(64)
  assert.ok(verifyAssemblyInputs(EDIT, SHA, drifted, located, []).problems.some((problem) => problem.startsWith('c04: reel manifest sha256')))
})

test('assembly rejects footage rendered from another SHA or an unverified reel manifest', () => {
  const { manifest, located } = goodInputs()
  assert.ok(verifyAssemblyInputs(EDIT, 'b'.repeat(40), manifest, located, []).problems.some((problem) => problem.startsWith('reel manifest is for')))
  assert.ok(verifyAssemblyInputs(EDIT, SHA, { ...manifest, verified: false }, located, []).problems.includes('reel manifest says verified: false'))
  assert.ok(verifyAssemblyInputs(EDIT, SHA, null, located, []).problems.includes('reel-manifest.json is missing'))
})

test('assembly uses all and only the locked timeline clips: duplicates and extras are rejected', () => {
  const { manifest, located } = goodInputs()
  const duplicate = [...located, located[6]!]
  assert.ok(verifyAssemblyInputs(EDIT, SHA, manifest, duplicate, []).problems.includes('c07: 2 duplicate records'))
  const extra = located[0]!
  const poster = { ...extra, record: { ...extra.record, clipId: 'poster' } }
  assert.ok(verifyAssemblyInputs(EDIT, SHA, manifest, [...located, poster], []).problems.some((problem) => problem.startsWith('poster: not a shot clip')))

  const reel = planReel(EDIT)
  assert.deepEqual(
    reel.segments.map((segment) => segment.id),
    EDIT.timeline.map((item) => item.id),
  )
  assert.equal(reel.segments.filter((segment) => segment.kind === 'shot').length, 25)
  assert.equal(reel.segments.at(-1)!.kind, 'end-card')
})

// ---------------------------------------------------------------------------
// The locked timeline, exactly
// ---------------------------------------------------------------------------

test('the reel is the locked 57.6s timeline frame for frame, with the edit transitions', () => {
  const reel = planReel(EDIT)
  assert.equal(reel.fps, 60)
  assert.equal(reel.frames, 3456)
  for (const segment of reel.segments) {
    const item = EDIT.timeline.find((entry) => entry.id === segment.id)!
    assert.equal(segment.frames, ((item.destOutMs - item.destInMs) * 60) / 1000, segment.id)
  }
  const fades = Object.fromEntries(reel.segments.filter((s) => s.head || s.tail).map((s) => [s.id, [s.head, s.tail]]))
  assert.deepEqual(fades, {
    c01: [{ color: 'black', frames: 72 }, null], // headFadeFromBlackMs 1200
    c02: [null, { color: 'black', frames: 18 }], // dip-black 600 centered on the cut
    c03: [{ color: 'black', frames: 18 }, null],
    c09: [null, { color: 'white', frames: 6 }], // flash-white 200
    c10: [{ color: 'white', frames: 6 }, null],
    c12: [null, { color: 'black', frames: 36 }], // fade-black 600, outgoing only
    c15: [null, { color: 'white', frames: 6 }],
    c16: [{ color: 'white', frames: 6 }, null],
    c25: [null, { color: 'black', frames: 36 }], // dip-black 1200
    end: [{ color: 'black', frames: 36 }, null],
  })
  const frames = expectedFrames(reel)
  assert.equal(frames.length, 3456)
  assert.deepEqual(frames[0], { segment: 'c01', frame: 0, fade: { color: 'black', amount: 1 } })
  assert.deepEqual(frames[1296], { segment: 'c10', frame: 0, fade: { color: 'white', amount: 1 } }) // 21.6s
  assert.equal(frames[1295]!.segment, 'c09')
  assert.equal(frames[1295]!.fade!.amount, 5 / 6)
  assert.deepEqual(frames[3168], { segment: 'end', frame: 0, fade: { color: 'black', amount: 1 } }) // 52.8s
})

// ---------------------------------------------------------------------------
// 5 + 7. Derivatives come from the locked spec; the loop is silent
// ---------------------------------------------------------------------------

test('the loop is derivatives.loop: its clip list, its fps, silent', () => {
  const loop = planLoop(EDIT)
  assert.deepEqual(
    loop.sequence.segments.map((segment) => segment.id),
    EDIT.derivatives.loop.clipIds,
  )
  assert.equal(loop.fps, EDIT.derivatives.loop.fps)
  assert.equal(loop.step, 2)
  assert.equal(loop.frames, 414)
  assert.equal(loop.durationMs, 13_800)
  // Only the cuts the loop keeps adjacent carry the edit's transitions.
  const fades = Object.fromEntries(loop.sequence.segments.filter((s) => s.head || s.tail).map((s) => [s.id, [s.head?.color ?? null, s.tail?.color ?? null]]))
  assert.deepEqual(fades, { c09: [null, 'white'], c10: ['white', null], c15: [null, 'white'], c16: ['white', null] })

  const edited = mutableCopy(EDIT)
  edited.derivatives.loop.clipIds = ['c19', 'c20', 'c07']
  assert.deepEqual(planLoop(edited).sequence.segments.map((segment) => segment.id), ['c19', 'c20', 'c07'])
  edited.derivatives.loop.clipIds = ['c07', 'end']
  assert.throws(() => planLoop(edited), /not a locked shot clip/)
})

test('the loop is configured silent: no audio stream is ever mapped or encoded', () => {
  const args = loopOutputArgs(EDIT)
  assert.ok(args.includes('-an'))
  assert.ok(!args.some((arg) => arg.startsWith('-c:a') || arg === '-b:a' || arg === '-map'))
  const loud = mutableCopy(EDIT)
  loud.derivatives.loop.silent = false
  assert.throws(() => loopOutputArgs(loud), /must be silent/)
  assert.throws(() => planLoop(loud), /must be silent/)
  const probe = [{ type: 'video', codec: 'h264', profile: 'High', pixFmt: 'yuv420p', width: 1280, height: 720, fps: 30, frames: 414 }]
  const expect = { file: DELIVERABLES.loop, width: 1280, height: 720, fps: 30, frames: 414, audio: null }
  assert.deepEqual(checkVideoOutput(expect, probe, 13.8, 1000), [])
  const withAudio = [...probe, { type: 'audio', codec: 'aac', sampleRate: 48000, channels: 2 }]
  assert.ok(checkVideoOutput(expect, withAudio, 13.8, 1000).some((problem) => problem.includes('must be silent')))
})

test('the poster is derivatives.poster: its shot, instant and crop, from the verified clip that holds it', () => {
  const poster = selectPosterFrame(EDIT)
  assert.equal(poster.clipId, 'c07')
  assert.equal(poster.frame, 72)
  assert.equal(poster.requested, EDIT.derivatives.poster.source.clock === 'progress' ? EDIT.derivatives.poster.source.in : Number.NaN)
  assert.ok(Math.abs(poster.deltaSourceMs) <= poster.frameSpacingSourceMs / 2)
  assert.ok(Math.abs(poster.deltaSourceMs) < 1)

  const outside = mutableCopy(EDIT)
  outside.derivatives.poster.source.in = 0.3 // in the gap between c07 and c08
  outside.derivatives.poster.source.out = 0.3
  assert.throws(() => selectPosterFrame(outside), /STOP/)
  const recropped = mutableCopy(EDIT)
  recropped.derivatives.poster.crop = { x: 0, y: 0, w: 1920, h: 1080 }
  assert.throws(() => selectPosterFrame(recropped), /STOP/)
})

test('encode settings are parsed from the locked delivery formats, never restated', () => {
  const hero = parseEncode(EDIT.derivatives.heroReel)
  assert.deepEqual(hero, { level: '4.2', crf: 16, preset: 'slow', maxrateMbps: null, bufsizeMbps: null, closedGopSec: 1, faststart: true })
  const args = x264Args(hero, 60).join(' ')
  for (const part of ['-profile:v high', '-level:v 4.2', '-preset slow', '-crf 16', '-g 60', '-flags +cgop', '-pix_fmt yuv420p', '-colorspace bt709', '-movflags +faststart']) {
    assert.ok(args.includes(part), part)
  }
  assert.ok(loopOutputArgs(EDIT).join(' ').includes('-crf 22 -maxrate 6000k -bufsize 12000k'))
  assert.throws(() => parseEncode({ ...EDIT.derivatives.heroReel, encode: 'ProRes 422 HQ' }), /unsupported encode spec/)
  assert.deepEqual(socialCrop(1920, 1080), { x: 0, y: 36, w: 1920, h: 1008 })
})

// ---------------------------------------------------------------------------
// 6 + 8. Deliverables: exact names, never a raw frame
// ---------------------------------------------------------------------------

test('output naming is exact', () => {
  assert.deepEqual(Object.values(DELIVERABLES), ['reel-57s-1080.mp4', 'loop-13s-1280.mp4', 'poster-1280.jpg', 'poster-1280.webp', 'og-home-1200x630.jpg'])
  assert.deepEqual([...DELIVERABLE_METADATA], ['manifest.json', 'SHA256SUMS', 'source-reel-manifest.json'])
})

test('deliverables contain exactly the release files — no PNG sequence, no intermediates', () => {
  const good = [...Object.values(DELIVERABLES), ...DELIVERABLE_METADATA]
  assert.deepEqual(checkDeliverableNames(good), [])
  assert.deepEqual(checkDeliverableNames([...good, '000000.png']), ['raw frame/PNG in deliverables: 000000.png'])
  assert.deepEqual(checkDeliverableNames([...good, 'c07__first-strike-orbital-flight.mp4']), ['unexpected file in deliverables: c07__first-strike-orbital-flight.mp4'])
  assert.deepEqual(checkDeliverableNames(good.filter((name) => name !== DELIVERABLES.og)), [`missing deliverable: ${DELIVERABLES.og}`])
})

test('stills are checked by magic bytes and decoder size', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBP')
  const stream = (codec: string, width: number, height: number) => [{ type: 'video', codec, width, height }]
  assert.deepEqual(checkImageOutput({ file: 'a.jpg', codec: 'mjpeg', width: 1200, height: 630 }, jpeg, stream('mjpeg', 1200, 630), 10), [])
  assert.deepEqual(checkImageOutput({ file: 'a.webp', codec: 'webp', width: 1280, height: 720 }, webp, stream('webp', 1280, 720), 10), [])
  assert.equal(checkImageOutput({ file: 'a.webp', codec: 'webp', width: 1280, height: 720 }, jpeg, stream('webp', 1280, 720), 10).length, 1)
  assert.equal(checkImageOutput({ file: 'a.jpg', codec: 'mjpeg', width: 1200, height: 630 }, jpeg, stream('mjpeg', 1200, 675), 10).length, 1)
})

test('timeline fidelity catches a frame that is off by one', () => {
  const plan = planSequence(EDIT, ['c13', 'c14'])
  const pixels = 4
  const source = (seed: number, frames: number) => Uint8Array.from({ length: frames * pixels }, (_, index) => 20 + ((seed * 37 + Math.floor(index / pixels) * 11) % 200))
  const sources = new Map([
    ['c13', source(1, 36)],
    ['c14', source(2, 36)],
  ])
  const output = new Uint8Array([...sources.get('c13')!, ...sources.get('c14')!])
  assert.deepEqual(checkTimelineFidelity(expectedFrames(plan), output, sources, pixels, 1).problems, [])
  const shifted = new Uint8Array([...sources.get('c13')!.subarray(0, 35 * pixels), ...sources.get('c14')!, ...sources.get('c14')!.subarray(35 * pixels)])
  assert.ok(checkTimelineFidelity(expectedFrames(plan), shifted, sources, pixels, 1).problems.length > 0)
})

// ---------------------------------------------------------------------------
// Release frame overrides: the one declared repair, and nothing else
// ---------------------------------------------------------------------------

const [C03_REPAIR] = RELEASE_FRAME_OVERRIDES as [ReleaseFrameOverride]
const RUN6_SOURCE: SourceRunRecord = {
  runId: PIN.runId,
  runNumber: PIN.runNumber,
  headSha: PIN.headSha,
  artifacts: PIN.artifacts.map(({ name, digest }) => ({ name, digest })),
}
const RUN6_CLIP_FILES = new Map(lockedShotClips(EDIT).map((clip) => [clip.id, `render-${clip.id}/${clip.id}__${clip.shotId}/${clip.id}__${clip.shotId}.mp4`]))
RUN6_CLIP_FILES.set('c03', 'render-act2-rival-c03/c03__vesper-citadel-reveal/c03__vesper-citadel-reveal.mp4')
const FIDELITY_TOLERANCE = 3 // assembleFinalReel.mjs FIDELITY_TOLERANCE.reel
const THUMB_PIXELS = 4
const FADE_LUMA = { black: 16, white: 235 } as const

/** Distinct synthetic luma thumbnails for every reel segment: adjacent
 * frames of a clip differ by 11 levels, well over the tolerance. */
function syntheticSources(plan = planReel(EDIT)): Map<string, Uint8Array> {
  return new Map(
    plan.segments.map((segment, seed) => [
      segment.id,
      Uint8Array.from({ length: segment.frames * THUMB_PIXELS }, (_, index) => 20 + ((seed * 37 + Math.floor(index / THUMB_PIXELS) * 11 + (index % THUMB_PIXELS) * 3) % 200)),
    ]),
  )
}

/** What an assembler that shows exactly `frames` would output. */
function renderThumbs(frames: readonly ExpectedFrame[], sources: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const output = new Uint8Array(frames.length * THUMB_PIXELS)
  frames.forEach((entry, outputFrame) => {
    const source = sources.get(entry.segment)!
    for (let pixel = 0; pixel < THUMB_PIXELS; pixel += 1) {
      let value = source[entry.frame * THUMB_PIXELS + pixel]!
      if (entry.fade !== null) value += (FADE_LUMA[entry.fade.color] - value) * entry.fade.amount
      output[outputFrame * THUMB_PIXELS + pixel] = Math.round(value)
    }
  })
  return output
}

test('exactly one release frame override is declared: reel frame 468 (7.800s), c03#36 -> c03#37, bound to pinned run #6', () => {
  assert.equal(RELEASE_FRAME_OVERRIDES.length, 1)
  assert.deepEqual(
    { reelFrame: C03_REPAIR.reelFrame, original: C03_REPAIR.original, replacement: C03_REPAIR.replacement, reason: C03_REPAIR.reason },
    { reelFrame: 468, original: { clipId: 'c03', frame: 36 }, replacement: { clipId: 'c03', frame: 37 }, reason: 'one-frame enemy-base scale/camera defect' },
  )
  assert.equal(C03_REPAIR.reelFrame / EDIT.output.fps, 7.8)
  // The binding is the pinned release source, verbatim.
  assert.equal(C03_REPAIR.source.runNumber, PIN.runNumber)
  assert.equal(C03_REPAIR.source.runId, PIN.runId)
  assert.equal(C03_REPAIR.source.headSha, PIN.headSha)
  assert.equal(C03_REPAIR.source.artifactDigest, PIN.artifacts.find((artifact) => artifact.name === C03_REPAIR.source.artifact)!.digest)
  // c03 is the enemy-base shot; frame 36 of its 144 samples 0.75 + 0.25 * 36/143 of rival-signal:impact.
  const original = describeClipFrame(EDIT, C03_REPAIR.original)
  assert.equal(original.shotId, 'vesper-citadel-reveal')
  assert.equal(original.clock, 'progress of rival-signal:impact')
  assert.ok(Math.abs(original.value! - (0.75 + (0.25 * 36) / 143)) < 1e-12)
  assert.ok(Math.abs(describeClipFrame(EDIT, C03_REPAIR.replacement).sourceMs! - original.sourceMs! - (0.25 * 2600) / 143) < 1e-9)
})

test('the override changes exactly one reel frame: still 3,456 frames / 57.6s, nothing after it shifts', () => {
  const plan = planReel(EDIT)
  assert.deepEqual(validateFrameOverrides(EDIT, plan, RELEASE_FRAME_OVERRIDES), [])
  const locked = expectedFrames(plan)
  const repaired = applyFrameOverrides(locked, RELEASE_FRAME_OVERRIDES)
  assert.equal(plan.frames, 3456)
  assert.equal(repaired.length, 3456)
  assert.equal(repaired.length / EDIT.output.fps, 57.6)
  assert.deepEqual(changedFrames(locked, repaired), [468])
  assert.deepEqual(locked[468], { segment: 'c03', frame: 36, fade: null })
  assert.deepEqual(repaired[468], { segment: 'c03', frame: 37, fade: null })
  assert.deepEqual(repaired[469], { segment: 'c03', frame: 37, fade: null }) // the neighbour stays where it was
  assert.deepEqual(repaired.slice(0, 468), locked.slice(0, 468))
  assert.deepEqual(repaired.slice(469), locked.slice(469))
  // The plan itself — segments, frame counts, transitions — is untouched.
  assert.deepEqual(planReel(EDIT), plan)
})

test('the repaired reel graph only re-trims c03: every segment keeps its locked frame count, no new input, no interpolation', () => {
  const plan = planReel(EDIT)
  const sources = { shots: new Map(lockedShotClips(EDIT).map((clip, index) => [clip.id, `${index}:v`])), endCard: '25:v', width: 1920, height: 1080 }
  const plain = reelFilterGraph(EDIT, plan, sources).split(';')
  const repaired = reelFilterGraph(EDIT, plan, sources, RELEASE_FRAME_OVERRIDES).split(';')
  const c03 = plan.segments.findIndex((segment) => segment.id === 'c03')
  const touchesC03 = (chain: string) => new RegExp(`\\[s${c03}[pq]\\d+\\]`).test(chain)
  assert.deepEqual(repaired.filter((chain) => !touchesC03(chain)), plain.filter((chain) => !touchesC03(chain)))

  const trims = (chains: string[], index: number) =>
    chains.flatMap((chain) => [...chain.matchAll(new RegExp(`^\\[s${index}p\\d+\\]trim=start_frame=(\\d+):end_frame=(\\d+)`, 'g'))].map((match) => [Number(match[1]), Number(match[2])]))
  assert.deepEqual(trims(plain, c03), [[0, 18], [18, 144]])
  assert.deepEqual(trims(repaired, c03), [[0, 18], [18, 36], [37, 38], [37, 144]])
  plan.segments.forEach((segment, index) => {
    const parts = trims(repaired, index)
    const frames = parts.length === 0 ? segment.frames : parts.reduce((sum, [start, end]) => sum + end! - start!, 0)
    assert.equal(frames, segment.frames, segment.id)
  })

  const inputs = (chains: string[]) => new Set(chains.flatMap((chain) => [...chain.matchAll(/\[(\d+:v)\]/g)].map((match) => match[1])))
  assert.deepEqual(inputs(repaired), inputs(plain))
  const count = (chains: string[], pattern: RegExp) => chains.join(';').match(pattern)?.length ?? 0
  assert.equal(count(repaired, /trim=/g), count(plain, /trim=/g) + 2)
  assert.equal(count(repaired, /geq=/g), count(plain, /geq=/g))
  assert.equal(count(repaired, /color=/g), count(plain, /color=/g))
  assert.ok(!/minterpolate|framerate=|tblend|blend=|mix=|tmix/.test(repaired.join(';')))
})

test('verification expects exactly the declared override; undeclared substitutions still fail', () => {
  const plan = planReel(EDIT)
  const sources = syntheticSources(plan)
  const locked = expectedFrames(plan)
  const repaired = applyFrameOverrides(locked, RELEASE_FRAME_OVERRIDES)
  const output = renderThumbs(repaired, sources)

  // The declared repair passes both the global check and the override check.
  assert.deepEqual(checkTimelineFidelity(repaired, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems, [])
  const [check] = checkFrameOverrides(RELEASE_FRAME_OVERRIDES, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE)
  assert.deepEqual(check!.problems, [])
  assert.equal(check!.toReplacement, 0)
  assert.ok(check!.toOriginal > FIDELITY_TOLERANCE)

  // The same output against the locked plan — the override undeclared —
  // fails at exactly reel frame 468.
  const undeclared = checkTimelineFidelity(locked, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems
  assert.equal(undeclared.length, 1)
  assert.match(undeclared[0]!, /^frame 468 \(c03#36\) differs from its planned source/)

  // Any other substitution fails even with the declared one in place.
  const extra = [...repaired]
  extra[1000] = { segment: 'c07', frame: 137, fade: null } // c07#136 -> its neighbour
  const failed = checkTimelineFidelity(repaired, renderThumbs(extra, sources), sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems
  assert.equal(failed.length, 1)
  assert.match(failed[0]!, /^frame 1000 \(c07#136\)/)

  // Dropping the defective frame and shifting the rest up (same length)
  // fails from the repair onwards.
  const shifted = [...repaired.slice(0, 468), ...repaired.slice(469), repaired.at(-1)!]
  assert.equal(shifted.length, 3456)
  assert.ok(checkTimelineFidelity(repaired, renderThumbs(shifted, sources), sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems.length > 10)

  // A declared override that was not actually applied fails.
  const unrepaired = renderThumbs(locked, sources)
  assert.ok(checkFrameOverrides(RELEASE_FRAME_OVERRIDES, unrepaired, sources, THUMB_PIXELS, FIDELITY_TOLERANCE)[0]!.problems.some((problem) => problem.includes('still the original')))
  assert.equal(checkTimelineFidelity(repaired, unrepaired, sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems.length, 1)

  // An override the thumbnails cannot tell apart from its original is
  // refused: the verifier must be able to catch it undeclared.
  const flat = new Map(sources)
  const c03 = Uint8Array.from(sources.get('c03')!)
  c03.copyWithin(36 * THUMB_PIXELS, 37 * THUMB_PIXELS, 38 * THUMB_PIXELS)
  flat.set('c03', c03)
  const invisible = checkFrameOverrides(RELEASE_FRAME_OVERRIDES, renderThumbs(repaired, flat), flat, THUMB_PIXELS, FIDELITY_TOLERANCE)[0]!.problems
  assert.ok(invisible.some((problem) => problem.includes('would not be caught')))
})

test('a mis-declared frame override is refused before anything is assembled', () => {
  const plan = planReel(EDIT)
  const refused = (overrides: ReleaseFrameOverride[], pattern: RegExp) => {
    const problems = validateFrameOverrides(EDIT, plan, overrides)
    assert.ok(problems.some((problem) => pattern.test(problem)), `${pattern}: ${problems.join(' | ') || 'no problems'}`)
  }
  const with_ = (patch: Partial<ReleaseFrameOverride>): ReleaseFrameOverride => ({ ...C03_REPAIR, ...patch })
  refused([with_({ original: { clipId: 'c03', frame: 35 } })], /locked plan shows c03#36 there/)
  refused([with_({ replacement: { clipId: 'c03', frame: 40 } })], /not adjacent/)
  refused([with_({ replacement: { clipId: 'c04', frame: 0 } })], /not from c03/)
  refused([with_({ reelFrame: 440, original: { clipId: 'c03', frame: 8 }, replacement: { clipId: 'c03', frame: 9 } })], /inside a black transition/)
  refused([with_({ reelFrame: 450, original: { clipId: 'c03', frame: 18 }, replacement: { clipId: 'c03', frame: 17 } })], /not shown untouched/)
  refused([with_({ reelFrame: 3456 })], /outside the 3456-frame reel/)
  refused([C03_REPAIR, C03_REPAIR], /declared more than once/)
  refused([with_({ reason: ' ' })], /no reason/)
  refused([with_({ reelFrame: 874, original: { clipId: 'c07', frame: 10 }, replacement: { clipId: 'c07', frame: 11 } })], /also in the loop/)
  refused([with_({ reelFrame: 3200, original: { clipId: 'end', frame: 32 }, replacement: { clipId: 'end', frame: 33 } })], /not a shot clip/)
  refused([C03_REPAIR, with_({ reelFrame: 469, original: { clipId: 'c03', frame: 37 }, replacement: { clipId: 'c03', frame: 38 } })], /replacement's own reel frame is overridden/)
  assert.throws(() => applyFrameOverrides(expectedFrames(plan), [with_({ reelFrame: 469 })]), /does not match the locked plan/)
  assert.throws(() => reelFilterGraph(EDIT, plan, { shots: new Map(), endCard: null, width: 1920, height: 1080 }, [with_({ reelFrame: 469 })]), /does not match the locked plan/)
})

test('an override applies only to the footage it names, and is never silently skipped for it', () => {
  const applied = overridesForSource(RELEASE_FRAME_OVERRIDES, PIN.headSha, RUN6_SOURCE, RUN6_CLIP_FILES)
  assert.deepEqual(applied, { overrides: [C03_REPAIR], problems: [] })
  // Footage rendered at any other SHA: nothing applies.
  assert.deepEqual(overridesForSource(RELEASE_FRAME_OVERRIDES, 'b'.repeat(40), null, RUN6_CLIP_FILES), { overrides: [], problems: [] })
  // Run #6's SHA without its source run record, or with a different run,
  // artifact digest or clip location: STOP.
  const stops = (sha: string, source: SourceRunRecord | null, files = RUN6_CLIP_FILES) => overridesForSource(RELEASE_FRAME_OVERRIDES, sha, source, files)
  assert.match(stops(PIN.headSha, null).problems.join('\n'), /pass --source=/)
  assert.match(stops(PIN.headSha, { ...RUN6_SOURCE, runId: 1 }).problems.join('\n'), /source run is #6 \(1\)/)
  const redigested = { ...RUN6_SOURCE, artifacts: RUN6_SOURCE.artifacts.map((a) => (a.name === 'render-act2-rival-c03' ? { ...a, digest: `sha256:${'0'.repeat(64)}` } : a)) }
  assert.match(stops(PIN.headSha, redigested).problems.join('\n'), /render-act2-rival-c03 digest/)
  const moved = new Map(RUN6_CLIP_FILES).set('c03', 'render-elsewhere/c03__vesper-citadel-reveal/c03__vesper-citadel-reveal.mp4')
  assert.match(stops(PIN.headSha, RUN6_SOURCE, moved).problems.join('\n'), /is not from artifact render-act2-rival-c03/)
  for (const result of [stops(PIN.headSha, null), stops(PIN.headSha, redigested), stops(PIN.headSha, RUN6_SOURCE, moved)]) assert.deepEqual(result.overrides, [])
})

// ---------------------------------------------------------------------------
// Source run: the pinned run #6 only
// ---------------------------------------------------------------------------

function pinnedRun(): { run: ApiWorkflowRun; artifacts: ApiArtifact[] } {
  return {
    run: {
      id: PIN.runId,
      name: PIN.workflowName,
      path: PIN.workflowPath,
      run_number: PIN.runNumber,
      event: PIN.event,
      status: 'completed',
      conclusion: 'success',
      head_branch: PIN.headBranch,
      head_sha: PIN.headSha,
    },
    artifacts: PIN.artifacts.map((artifact) => ({ ...artifact, expired: false, workflow_run: { id: PIN.runId, head_sha: PIN.headSha } })),
  }
}

test('the release pin is run #6 of Final reel render on main, with its 18 artifacts', () => {
  assert.equal(PIN.runNumber, 6)
  assert.equal(PIN.workflowName, 'Final reel render')
  assert.equal(PIN.headBranch, 'main')
  assert.equal(PIN.artifacts.length, 18)
  const names = PIN.artifacts.map((artifact) => artifact.name)
  assert.ok(names.includes('reel-manifest'))
  assert.equal(names.filter((name) => name.startsWith('render-')).length, 17)
  for (const artifact of PIN.artifacts) assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/)
  const { run, artifacts } = pinnedRun()
  assert.deepEqual(validateSourceRun(PIN, 6, run, artifacts), [])
})

test('the source run is never "latest" or a fallback: any mismatch stops', () => {
  const { run, artifacts } = pinnedRun()
  const problems = (mutate: (r: ApiWorkflowRun) => ApiWorkflowRun, list: ApiArtifact[] = artifacts, requested = 6) =>
    validateSourceRun(PIN, requested, mutate(run), list)
  assert.ok(problems((r) => r, artifacts, 7).some((p) => p.includes('not the pinned release source')))
  assert.ok(problems((r) => ({ ...r, conclusion: 'failure' })).some((p) => p.startsWith('conclusion')))
  assert.ok(problems((r) => ({ ...r, head_branch: 'feature/x' })).some((p) => p.startsWith('branch')))
  assert.ok(problems((r) => ({ ...r, head_sha: 'c'.repeat(40) })).some((p) => p.startsWith('head sha')))
  assert.ok(problems((r) => ({ ...r, name: 'Other workflow' })).some((p) => p.startsWith('workflow name')))
  assert.ok(problems((r) => r, artifacts.slice(1)).some((p) => p.endsWith(': missing')))
  assert.ok(problems((r) => r, artifacts.map((a, i) => (i === 0 ? { ...a, expired: true } : a))).some((p) => p.endsWith(': expired')))
  assert.ok(problems((r) => r, artifacts.map((a, i) => (i === 0 ? { ...a, digest: `sha256:${'0'.repeat(64)}` } : a))).some((p) => p.includes('digest')))
  assert.ok(problems((r) => r, [...artifacts, { id: 1, name: 'render-extra', expired: false }]).some((p) => p.startsWith('unexpected artifact')))

  const runs = [run, { ...run, id: 1, run_number: 5 }]
  assert.equal(selectSourceRun(runs, 6).id, PIN.runId)
  assert.throws(() => selectSourceRun(runs, 4), /exactly one run #4/)
  assert.throws(() => selectSourceRun([run, run], 6), /found 2/)
})

// ---------------------------------------------------------------------------
// 4. Assembly cannot reach the renderer
// ---------------------------------------------------------------------------

const ENTRY_POINTS = ['ci/assembleFinalReel.mjs', 'ci/sourceRun.mjs']
/** Every local module assembly may load: pure edit/plan/verify code and io. */
const ALLOWED_MODULES = new Set([
  'ci/assembleFinalReel.mjs',
  'ci/sourceRun.mjs',
  'ci/assembly.ts',
  'ci/io.ts',
  'ci/reelCi.ts',
  'finalEdit.ts',
  'endCardFacts.ts',
  'profiles.ts',
  'finalRender/plan.ts',
  'finalRender/timing.ts',
])
const RENDERER_TOKENS = /playwright|chromium|puppeteer|finalRender\.mjs|finalRender\.spec|renderGroup|preflight|engine\.ts|reach\.ts|runner\.ts|manifest\.ts|initCapture|gameActions|fixtures\.ts|vite|npx|npm /i

/** Source with comments removed, so docs may explain what the code never does. */
function code(file: string): string {
  return readFileSync(path.join(CAPTURE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const queue = [...ENTRY_POINTS]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (graph.has(file)) continue
    const specifiers = [...code(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]!)
    graph.set(file, specifiers)
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
    }
  }
  return graph
}

test('assembly has no import path to the browser renderer', () => {
  const graph = importGraph()
  for (const [file, specifiers] of graph) {
    assert.ok(ALLOWED_MODULES.has(file), `assembly loads ${file}, which is not on the renderer-free allowlist`)
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) assert.match(specifier, /^node:/, `${file} imports package ${specifier}`)
    }
  }
  // The entry points and the assembly planner are the code that decides what
  // runs; none of their string literals may name the renderer or a browser.
  for (const file of [...ENTRY_POINTS, 'ci/assembly.ts']) {
    const strings = [...code(file).matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)].map((match) => match[0])
    const hits = strings.filter((literal) => RENDERER_TOKENS.test(literal))
    assert.deepEqual(hits, [], `${file} mentions the renderer in code`)
  }
})

test('assembly has no child-process path to the renderer: only ffmpeg, ffprobe, git, unzip', () => {
  for (const file of ENTRY_POINTS) {
    const source = code(file)
    assert.ok(!/child_process|worker_threads|\bspawn\(/.test(source), `${file} spawns processes directly`)
    const programs = new Set([...source.matchAll(/\brun(?:OrThrow)?\(\s*'([^']+)'/g)].map((match) => match[1]!))
    const wrapped = /const ffmpeg = \(argv\) => runOrThrow\('ffmpeg'/.test(source)
    for (const program of programs) assert.ok(['ffmpeg', 'ffprobe', 'git', 'unzip'].includes(program), `${file} runs ${program}`)
    assert.ok(programs.size > 0 || wrapped, `${file}: no process calls found — the guard regex is stale`)
  }
  // io.ts is the only module that touches child_process, and only via its
  // run() helper with the program name the caller passes.
  assert.equal([...code('ci/io.ts').matchAll(/spawn\(/g)].length, 1)
})

test('the assembly workflow renders nothing and uploads one artifact', () => {
  const raw = readFileSync(path.join(REPO, '.github/workflows/final-reel-assemble.yml'), 'utf8')
  const workflow = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
  assert.match(workflow, /^name: Final reel assembly$/m)
  assert.ok(!RENDERER_TOKENS.test(workflow.replace(/npm ci/g, '').replace(/cache: npm/g, '')), 'workflow mentions the renderer or a browser')
  assert.ok(!/matrix|strategy:|final-render\.yml|finalRender|renderGroup|playwright|confirm_full|RENDER_FULL_REEL/.test(workflow))
  // The only programs it runs from the repo: the two assembly entry points
  // and the assembly tests.
  const scripts = new Set([...workflow.matchAll(/capture\/[\w/.-]+\.mjs/g)].map((match) => match[0]))
  assert.deepEqual([...scripts].sort(), ['capture/ci/assembleFinalReel.mjs', 'capture/ci/sourceRun.mjs'])
  assert.deepEqual([...workflow.matchAll(/--test (\S+)/g)].map((match) => match[1]), ['capture/ci/assembly.test.ts'])
  const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@v4[\s\S]*?name: ([\w-]+)/g)].map((match) => match[1])
  assert.deepEqual(uploads, ['final-reel-deliverables'])
  assert.equal([...workflow.matchAll(/^\s{2}[\w-]+:\n\s{4}(?:name|runs-on):/gm)].length, 1, 'exactly one job')
})

test('the workflow fills the end-card slot with the approved 1920x1080 still', () => {
  const workflow = readFileSync(path.join(REPO, '.github/workflows/final-reel-assemble.yml'), 'utf8')
  assert.match(workflow, /assembleFinalReel\.mjs[\s\S]*?--end-card=capture\/ci\/end-card-1920x1080\.png/)
  assert.match(workflow, /^\s+- capture\/ci\/end-card-1920x1080\.png$/m) // a new still re-runs assembly on its PR
  const png = readFileSync(path.join(CAPTURE, 'ci/end-card-1920x1080.png'))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [EDIT.output.width, EDIT.output.height])
  // The slot it fills is the locked one: 4.8s from 52.8s, entered on the dip from black.
  const end = planReel(EDIT).segments.at(-1)!
  assert.deepEqual({ kind: end.kind, frames: end.frames, head: end.head, tail: end.tail }, { kind: 'end-card', frames: 288, head: { color: 'black', frames: 36 }, tail: null })
  assert.equal(expectedFrames(planReel(EDIT)).findIndex((frame) => frame.segment === 'end'), 3168)
})

test('the frame override is applied by assembly alone: no renderer, Playwright or game path, zero frames rendered', () => {
  // The override and everything that applies it live in the renderer-free
  // modules the guards above already walk (assembly.ts, assembleFinalReel.mjs).
  const cli = code('ci/assembleFinalReel.mjs')
  assert.match(cli, /\bRELEASE_FRAME_OVERRIDES,[\s\S]*?\} from '\.\/assembly\.ts'/)
  assert.match(cli, /reelFilterGraph\(edit, reelPlan, \{[^}]*\}, frameOverrides\)/)
  assert.match(cli, /renderedFramesThisRun: 0,/)
  for (const file of importGraph().keys()) assert.ok(ALLOWED_MODULES.has(file), file)
  // Its data names nothing but footage already on disk: a run, an artifact
  // digest, clip ids and frame indices.
  const text = JSON.stringify(RELEASE_FRAME_OVERRIDES)
  assert.ok(!RENDERER_TOKENS.test(text), text)
  // The repair's ffmpeg graph only re-trims existing decoded input: no
  // generated picture, no retiming.
  const graph = reelFilterGraph(EDIT, planReel(EDIT), { shots: new Map(lockedShotClips(EDIT).map((clip, index) => [clip.id, `${index}:v`])), endCard: null, width: 1920, height: 1080 }, RELEASE_FRAME_OVERRIDES)
  const c03Chain = graph.split(';').filter((chain) => /\[s2[pq]\d+\]/.test(chain)).join(';')
  const filters = new Set([...c03Chain.matchAll(/(?:^|[,\]])([a-z_]+)=/g)].map((match) => match[1]))
  assert.deepEqual([...filters].sort(), ['concat', 'format', 'geq', 'setpts', 'settb', 'split', 'trim'])
  assert.ok(!/select=|minterpolate|framerate|tblend|freezeframes|loop=/.test(c03Chain), c03Chain)
})

// ---------------------------------------------------------------------------
// Release interval overrides: the two portrait inserts covered frame for frame
// ---------------------------------------------------------------------------

const [C14_COVER, C18_COVER] = RELEASE_INTERVAL_OVERRIDES as [ReleaseIntervalOverride, ReleaseIntervalOverride]
/** The intermediates' artifact folders in run #6 (render matrix: cheap clips share their act's job). */
const RUN6_INTERVAL_FILES = new Map(RUN6_CLIP_FILES)
for (const id of ['c13', 'c14']) RUN6_INTERVAL_FILES.set(id, RUN6_CLIP_FILES.get(id)!.replace(/^render-c1\d/, 'render-act4-counterstrike'))
for (const id of ['c17', 'c18']) RUN6_INTERVAL_FILES.set(id, RUN6_CLIP_FILES.get(id)!.replace(/^render-c1\d/, 'render-act5-divider'))
const ALL_OVERRIDES = [...RELEASE_FRAME_OVERRIDES, ...expandIntervalOverrides(RELEASE_INTERVAL_OVERRIDES)].sort((a, b) => a.reelFrame - b.reelFrame)

test('the two portrait inserts are declared: c14 at 29.400-30.000s and c18 at 34.800-36.000s, each held on its horizontal neighbour', () => {
  assert.equal(RELEASE_INTERVAL_OVERRIDES.length, 2)
  const seconds = (interval: ReleaseIntervalOverride) => [interval.reelFrame / EDIT.output.fps, (interval.reelFrame + interval.frames) / EDIT.output.fps]
  assert.deepEqual({ reelFrame: C14_COVER.reelFrame, frames: C14_COVER.frames, original: C14_COVER.original, hold: C14_COVER.hold, seconds: seconds(C14_COVER) }, {
    reelFrame: 1764, frames: 36, original: { clipId: 'c14', frame: 0 }, hold: { clipId: 'c13', frame: 35 }, seconds: [29.4, 30],
  })
  assert.deepEqual({ reelFrame: C18_COVER.reelFrame, frames: C18_COVER.frames, original: C18_COVER.original, hold: C18_COVER.hold, seconds: seconds(C18_COVER) }, {
    reelFrame: 2088, frames: 72, original: { clipId: 'c18', frame: 0 }, hold: { clipId: 'c17', frame: 71 }, seconds: [34.8, 36],
  })
  // The portrait clips are the edit's PORT stills; the covers are its 16:9 shots.
  const shots = new Map(lockedShotClips(EDIT).map((clip) => [clip.id, clip]))
  for (const interval of RELEASE_INTERVAL_OVERRIDES) {
    assert.equal(shots.get(interval.original.clipId)!.framing, 'pillarbox-portrait')
    assert.equal(shots.get(interval.hold.clipId)!.framing, 'full-16x9')
    assert.equal(interval.source.runNumber, PIN.runNumber)
    assert.equal(interval.source.runId, PIN.runId)
    assert.equal(interval.source.headSha, PIN.headSha)
    assert.equal(interval.source.artifactDigest, PIN.artifacts.find((artifact) => artifact.name === interval.source.artifact)!.digest)
  }
  assert.deepEqual(RELEASE_INTERVAL_OVERRIDES.map((interval) => interval.source.artifact), ['render-act4-counterstrike', 'render-act5-divider'])
  assert.deepEqual(validateIntervalOverrides(EDIT, planReel(EDIT), RELEASE_INTERVAL_OVERRIDES), [])
})

test('the covers change exactly the 108 portrait frames (plus frame 468): 3,456 frames / 57.6s, nothing after either interval shifts, no portrait frame left', () => {
  const plan = planReel(EDIT)
  const locked = expectedFrames(plan)
  assert.deepEqual(validateFrameOverrides(EDIT, plan, ALL_OVERRIDES), [])
  assert.deepEqual(portraitReelFrames(EDIT, locked), [...Array.from({ length: 36 }, (_, index) => 1764 + index), ...Array.from({ length: 72 }, (_, index) => 2088 + index)])
  const repaired = applyFrameOverrides(locked, ALL_OVERRIDES)
  assert.equal(repaired.length, 3456)
  assert.equal(repaired.length / EDIT.output.fps, 57.6)
  assert.deepEqual(portraitReelFrames(EDIT, repaired), [])
  const changed = changedFrames(locked, repaired)
  assert.equal(changed.length, 1 + 36 + 72)
  assert.deepEqual(changed, [468, ...Array.from({ length: 36 }, (_, index) => 1764 + index), ...Array.from({ length: 72 }, (_, index) => 2088 + index)])
  for (let frame = 1764; frame < 1800; frame += 1) assert.deepEqual(repaired[frame], { segment: 'c13', frame: 35, fade: null })
  for (let frame = 2088; frame < 2160; frame += 1) assert.deepEqual(repaired[frame], { segment: 'c17', frame: 71, fade: null })
  // Everything on either side is exactly the locked plan: the neighbours, the
  // end card in its 52.8-57.6s slot, and the head/dip/flash fades.
  for (const [from, to] of [[0, 468], [469, 1764], [1800, 2088], [2160, 3456]] as const) assert.deepEqual(repaired.slice(from, to), locked.slice(from, to))
  assert.equal(repaired.findIndex((frame) => frame.segment === 'end'), 3168)
  assert.deepEqual(repaired.slice(3168), locked.slice(3168))
  assert.deepEqual(repaired[468], { segment: 'c03', frame: 37, fade: null })
  assert.deepEqual(planReel(EDIT), plan)
})

test('the covered reel graph keeps every segment at its locked frame count and holds an existing horizontal frame, nothing generated', () => {
  const plan = planReel(EDIT)
  const shots = new Map(lockedShotClips(EDIT).map((clip, index) => [clip.id, `${index}:v`]))
  const covers = new Map([['c14', '26:v'], ['c18', '27:v']])
  const sources = { shots, endCard: '25:v', width: 1920, height: 1080, covers }
  const uncovered = { shots, endCard: '25:v', width: 1920, height: 1080 }
  const plain = reelFilterGraph(EDIT, plan, uncovered, RELEASE_FRAME_OVERRIDES).split(';')
  const covered = reelFilterGraph(EDIT, plan, sources, ALL_OVERRIDES).split(';')
  const index = (id: string) => plan.segments.findIndex((segment) => segment.id === id)
  const touched = new Set([index('c14'), index('c18')])
  const chainsOf = (chains: string[], n: number) => chains.filter((chain) => new RegExp(`\\[s${n}(?:[pq]\\d+)?\\]`).test(chain) && !chain.endsWith('[seq]'))
  // Every other segment's chains, and the final concat, are byte-identical to the one-frame-repair graph.
  plan.segments.forEach((_, n) => {
    if (!touched.has(n)) assert.deepEqual(chainsOf(covered, n), chainsOf(plain, n), `s${n}`)
  })
  assert.equal(covered.at(-1), plain.at(-1))
  assert.equal(covered.length, plain.length + 2) // each portrait segment's 1 chain becomes a cover chain + its concat
  const chain = (id: string) => covered.find((entry) => entry.startsWith(`[${covers.get(id)}]`))!
  assert.equal(chain('c14'), '[26:v]settb=1/60,setpts=N,format=yuv444p,trim=start_frame=35:end_frame=36,setpts=PTS-STARTPTS,loop=loop=35:size=1:start=0,setpts=N[s13q0]')
  assert.equal(chain('c18'), '[27:v]settb=1/60,setpts=N,format=yuv444p,trim=start_frame=71:end_frame=72,setpts=PTS-STARTPTS,loop=loop=71:size=1:start=0,setpts=N[s17q0]')
  for (const id of ['c14', 'c18']) {
    assert.deepEqual(chainsOf(covered, index(id)), [chain(id), `[s${index(id)}q0]concat=n=1:v=1:a=0[s${index(id)}]`], id)
    assert.ok(!covered.join(';').includes(`[${shots.get(id)}]`), `the portrait ${id} input is never read`)
  }
  // The covering clips' own segments still read their own inputs (c13 = 12:v, c17 = 16:v).
  assert.equal(shots.get('c13'), '12:v')
  assert.equal(shots.get('c17'), '16:v')
  const all = covered.join(';')
  assert.ok(covered.some((entry) => entry.startsWith('[12:v]')) && covered.some((entry) => entry.startsWith('[16:v]')))
  assert.ok(!/minterpolate|framerate=|tblend|blend=|mix=|tmix|crop=|boxblur|gblur|pad=|overlay|zoompan/.test(all), all)
  assert.equal(all.match(/loop=loop=/g)!.length, 2)
  assert.equal(all.match(/geq=/g)!.length, plain.join(';').match(/geq=/g)!.length)
  const frames = (id: string) => [...chain(id).matchAll(/loop=loop=(\d+)/g)].map((match) => Number(match[1]) + 1)
  assert.deepEqual([frames('c14'), frames('c18')], [[plan.segments[index('c14')]!.frames], [plan.segments[index('c18')]!.frames]])
  // A cover with no input for its segment is refused rather than guessed.
  assert.throws(() => reelFilterGraph(EDIT, plan, { ...sources, covers: new Map() }, ALL_OVERRIDES), /no input for c13, which covers c14/)
})

test('a mis-declared interval override is refused before anything is assembled', () => {
  const plan = planReel(EDIT)
  const refused = (interval: ReleaseIntervalOverride, pattern: RegExp) => {
    const problems = [...validateIntervalOverrides(EDIT, plan, [interval]), ...validateFrameOverrides(EDIT, plan, expandIntervalOverrides([interval]))]
    assert.ok(problems.some((problem) => pattern.test(problem)), `${pattern}: ${problems.join(' | ')}`)
  }
  refused({ ...C14_COVER, frames: 35 }, /must cover exactly that/) // leaves a portrait frame
  refused({ ...C14_COVER, reelFrame: 1765 }, /must cover exactly that|locked plan shows/)
  refused({ ...C14_COVER, original: { clipId: 'c14', frame: 1 } }, /must cover exactly that/)
  refused({ ...C14_COVER, original: { clipId: 'c13', frame: 0 }, hold: { clipId: 'c12', frame: 0 } }, /not a pillarbox-portrait shot clip/)
  refused({ ...C14_COVER, hold: { clipId: 'c18', frame: 0 } }, /not a full-16x9 shot clip/) // portrait replacement
  refused({ ...C14_COVER, hold: { clipId: 'c12', frame: 0 } }, /not the timeline neighbour/)
  refused({ ...C14_COVER, hold: { clipId: 'c13', frame: 36 } }, /outside its 36 frames/)
  refused({ ...C14_COVER, hold: { clipId: 'c13', frame: -1 } }, /outside its 36 frames/)
  refused({ ...C14_COVER, hold: { clipId: 'c14', frame: 35 } }, /not a full-16x9 shot clip/)
  refused({ ...C18_COVER, hold: { clipId: 'c19', frame: 0 }, reason: ' ' }, /no reason given/)
  refused({ ...C18_COVER, frames: 0 }, /non-empty frame range/)
  // A whole-clip interval that also sits on a transition is refused per frame.
  const overlap = [...expandIntervalOverrides([C14_COVER]), ...expandIntervalOverrides([C14_COVER])]
  assert.ok(validateFrameOverrides(EDIT, plan, overlap).some((problem) => /declared more than once/.test(problem)))
  // An override that no longer matches the plan cannot be applied at all.
  assert.throws(() => applyFrameOverrides(expectedFrames(plan), expandIntervalOverrides([{ ...C14_COVER, reelFrame: 1765 }])), /does not match the locked plan/)
})

test('intervals apply only to the footage they name, and are never silently skipped for it', () => {
  assert.deepEqual(intervalsForSource(RELEASE_INTERVAL_OVERRIDES, PIN.headSha, RUN6_SOURCE, RUN6_INTERVAL_FILES), { intervals: [...RELEASE_INTERVAL_OVERRIDES], problems: [] })
  // Other footage: not applied, no complaint.
  assert.deepEqual(intervalsForSource(RELEASE_INTERVAL_OVERRIDES, 'b'.repeat(40), null, RUN6_INTERVAL_FILES), { intervals: [], problems: [] })
  const stops = (source: SourceRunRecord | null, files = RUN6_INTERVAL_FILES) => intervalsForSource(RELEASE_INTERVAL_OVERRIDES, PIN.headSha, source, files)
  const redigested = { ...RUN6_SOURCE, artifacts: RUN6_SOURCE.artifacts.map((artifact) => (artifact.name === 'render-act5-divider' ? { ...artifact, digest: 'sha256:' + '0'.repeat(64) } : artifact)) }
  const moved = new Map(RUN6_INTERVAL_FILES).set('c17', 'render-act3-first-strike/c17/c17.mp4')
  assert.deepEqual(stops(null).intervals, []) // no --source: neither can be confirmed
  assert.ok(stops(null).problems.length >= 2)
  assert.match(stops(redigested).problems.join('\n'), /render-act5-divider digest sha256:0+, override is for/)
  assert.match(stops(RUN6_SOURCE, moved).problems.join('\n'), /c17 intermediate render-act3-first-strike\/c17\/c17\.mp4 is not from artifact render-act5-divider/)
  // Only the mismatched interval is withheld, and the problem stops the assembly.
  assert.deepEqual(stops(redigested).intervals, [C14_COVER])
  assert.deepEqual(stops(RUN6_SOURCE, moved).intervals, [C14_COVER])
})

test('verification expects exactly the declared frames: undeclared covers, a shifted frame or a leftover portrait fail', () => {
  const plan = planReel(EDIT)
  const sources = syntheticSources(plan)
  // The portrait stills are pillarboxed: black bars either side of a bright picture.
  for (const id of ['c14', 'c18']) sources.set(id, Uint8Array.from({ length: plan.segments.find((segment) => segment.id === id)!.frames * THUMB_PIXELS }, (_, index) => ([16, 235, 235, 16][index % THUMB_PIXELS]!)))
  const locked = expectedFrames(plan)
  const declared = applyFrameOverrides(locked, ALL_OVERRIDES)
  const output = renderThumbs(declared, sources)
  // The declared reel passes the global check and every per-frame override check.
  assert.deepEqual(checkTimelineFidelity(declared, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems, [])
  const checks = checkFrameOverrides(ALL_OVERRIDES, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE)
  assert.equal(checks.length, 109)
  assert.deepEqual(checks.flatMap((check) => check.problems), [])
  // The same output against the locked plan (covers undeclared) fails on every covered frame.
  const undeclared = checkTimelineFidelity(locked, output, sources, THUMB_PIXELS, FIDELITY_TOLERANCE)
  assert.ok(undeclared.problems.length > 0)
  // The locked reel (portraits still in) fails the declared plan on exactly the covered frames.
  const leftover = checkTimelineFidelity(declared, renderThumbs(locked, sources), sources, THUMB_PIXELS, FIDELITY_TOLERANCE)
  assert.ok(leftover.problems.some((problem) => problem.includes('c13#35')))
  assert.ok(checkFrameOverrides(ALL_OVERRIDES, renderThumbs(locked, sources), sources, THUMB_PIXELS, FIDELITY_TOLERANCE).some((check) => check.problems.some((problem) => problem.includes('still the original'))))
  // A cover that is shifted by one frame (the timeline moved after it) fails.
  const shifted = Uint8Array.from(output)
  shifted.copyWithin(1800 * THUMB_PIXELS, 1801 * THUMB_PIXELS, 3456 * THUMB_PIXELS)
  assert.ok(checkTimelineFidelity(declared, shifted, sources, THUMB_PIXELS, FIDELITY_TOLERANCE).problems.length > 0)
})

test('the interval overrides are assembly-only: renderer-free modules, no game footage rendered', () => {
  const cli = code('ci/assembleFinalReel.mjs')
  assert.match(cli, /\bRELEASE_INTERVAL_OVERRIDES,[\s\S]*?\} from '\.\/assembly\.ts'/)
  assert.match(cli, /reelFilterGraph\(edit, reelPlan, \{[^}]*covers[^}]*\}, frameOverrides\)/)
  assert.match(cli, /renderedFramesThisRun: 0,/)
  for (const file of importGraph().keys()) assert.ok(ALLOWED_MODULES.has(file), file)
  assert.ok(!RENDERER_TOKENS.test(JSON.stringify(RELEASE_INTERVAL_OVERRIDES)))
  // The edit itself is untouched: the covers live in the release override definition.
  assert.equal(EDIT.timeline.find((item) => item.id === 'c14')!.destInMs, 29400)
  assert.equal(EDIT.timeline.find((item) => item.id === 'c18')!.destInMs, 34800)
})
