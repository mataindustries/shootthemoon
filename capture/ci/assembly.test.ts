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
  checkDeliverableNames,
  checkImageOutput,
  checkTimelineFidelity,
  checkVideoOutput,
  DELIVERABLE_METADATA,
  DELIVERABLES,
  expectedFrames,
  lockedShotClips,
  loopOutputArgs,
  parseEncode,
  planLoop,
  planReel,
  planSequence,
  selectPosterFrame,
  selectSourceRun,
  socialCrop,
  validateSourceRun,
  verifyAssemblyInputs,
  x264Args,
  type ApiArtifact,
  type ApiWorkflowRun,
  type AssemblyClipRecord,
  type LocatedRecord,
  type ReelManifest,
  type ReleasePin,
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
