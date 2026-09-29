/**
 * End-to-end check of capture/ci/assembleFinalReel.mjs on SYNTHETIC media:
 * ffmpeg test-pattern stand-ins for the 25 verified intermediates (never
 * game footage — nothing is rendered), with clip.json / reel-manifest.json
 * written the way renderGroup.mjs / verifyReel.mjs write them. Proves the
 * real CLI assembles and verifies all five deliverables, and that it stops
 * before assembling anything when a locked clip is missing. A second run
 * stands in for the pinned render run #6 (its SHA, source-run record and
 * c03/c04/c13/c14/c17/c18 artifacts) with planted flicker in c03 and c04
 * (including the retired frame-468 defect at c03#36) and pillarboxed portrait
 * stand-ins for c14/c18: the declared release intervals must hold c03 and c04
 * each on one of their own frames for their whole 144 frames (the planted
 * flicker never shown, the retired frame-468 override audited but not
 * applied) and cover exactly the two portrait intervals with their adjacent
 * 16:9 frames (nothing else moves), the approved end card must fill its slot,
 * and run #6's SHA without --source must STOP.
 *
 * Slow (a full 57.6s 1080p60 encode) and needs ffmpeg, so opt-in:
 *   ASSEMBLY_E2E=1 node --experimental-strip-types --experimental-transform-types \
 *     --test capture/ci/assemblySynthetic.test.ts
 * (ASSEMBLY_E2E_KEEP=1 keeps the temporary run + deliverables for inspection.)
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { FinalEdit } from '../finalEdit.ts'
import { DELIVERABLE_METADATA, DELIVERABLES, lockedShotClips, RELEASE_FRAME_OVERRIDES, RELEASE_INTERVAL_OVERRIDES, SUPERSEDED_FRAME_OVERRIDES, type ReleasePin } from './assembly.ts'
import { CLIP_METADATA_SCHEMA } from './reelCi.ts'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EDIT: FinalEdit = JSON.parse(readFileSync(path.join(REPO, 'capture/finalEdit.json'), 'utf8'))
const PIN: ReleasePin = JSON.parse(readFileSync(path.join(REPO, 'capture/ci/reelRelease.json'), 'utf8'))
const END_CARD = 'capture/ci/end-card-1920x1080.png'
const enabled = process.env.ASSEMBLY_E2E === '1'
const NODE_TS = ['--experimental-strip-types', '--experimental-transform-types', '--no-warnings']

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

interface SynthesisOptions {
  /** Artifact directory per clip id (default render-<clipId>). */
  readonly artifactDirs?: ReadonlyMap<string, string>
  /** Plant a one-frame defect (a white wash) at these clip frames. */
  readonly defects?: readonly { readonly clipId: string; readonly frame: number }[]
}

function synthesizeRun(root: string, sha: string, options: SynthesisOptions = {}): void {
  const clips = lockedShotClips(EDIT)
  const manifestClips = []
  for (const [index, clip] of clips.entries()) {
    const frames = ((clip.destOutMs - clip.destInMs) / 1000) * EDIT.output.fps
    const dir = `${options.artifactDirs?.get(clip.id) ?? `render-${clip.id}`}/${clip.id}__${clip.shotId}`
    const file = `${clip.id}__${clip.shotId}.mp4`
    mkdirSync(path.join(root, dir), { recursive: true })
    const video = path.join(root, dir, file)
    // A moving test pattern, offset in brightness per clip so every cut is visible.
    const brightness = (((index % 9) - 4) * 0.04).toFixed(2)
    const defects = (options.defects ?? []).filter((defect) => defect.clipId === clip.id)
    // The portrait stand-ins are pillarboxed like the real c14/c18: black bars either side of a ~500px picture.
    const pillarbox = clip.framing === 'pillarbox-portrait' ? ',drawbox=x=0:y=0:w=710:h=ih:color=black:t=fill,drawbox=x=1210:y=0:w=iw-1210:h=ih:color=black:t=fill' : ''
    const planted = pillarbox + defects.map((defect) => `,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.6:t=fill:enable='eq(n,${defect.frame})'`).join('')
    execFileSync('ffmpeg', [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc2=s=${EDIT.output.width}x${EDIT.output.height}:r=${EDIT.output.fps},eq=brightness=${brightness}${planted},format=yuv444p`,
      '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-profile:v', 'high444', '-pix_fmt', 'yuv444p', '-preset', 'ultrafast', '-crf', '14',
      '-g', '30', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', video,
    ])
    const hash = sha256(video)
    writeFileSync(
      path.join(root, dir, 'clip.json'),
      JSON.stringify({
        schema: CLIP_METADATA_SCHEMA, status: 'verified', gitSha: sha, group: `synthetic-${clip.id}`, act: clip.act,
        clipId: clip.id, shotId: clip.shotId,
        dest: { inMs: clip.destInMs, outMs: clip.destOutMs, durationMs: clip.destOutMs - clip.destInMs },
        source: { frames: clip.source.clock === 'still' ? 1 : frames, width: 3840, height: 2160 },
        output: { file, frames, width: EDIT.output.width, height: EDIT.output.height, fps: EDIT.output.fps, durationSec: frames / EDIT.output.fps, sha256: hash, decodedAdjacentDuplicates: 0 },
        transitionOut: clip.transitionOut,
      }),
    )
    manifestClips.push({ clipId: clip.id, dir, file, sha256: hash, frames })
  }
  mkdirSync(path.join(root, 'reel-manifest'))
  writeFileSync(
    path.join(root, 'reel-manifest', 'reel-manifest.json'),
    JSON.stringify({
      gitSha: sha, verified: true, expectedClips: clips.length, clipCount: clips.length, shotFootageMs: 52_800,
      timelineMs: EDIT.timeline[EDIT.timeline.length - 1]!.destOutMs, fps: EDIT.output.fps, gitShas: [sha], harnessBuilds: ['synthetic'],
      problems: [], clips: manifestClips,
    }),
  )
}

function assemble(root: string, sha: string, out: string, extra: readonly string[] = []) {
  return spawnSync(
    process.execPath,
    [...NODE_TS, 'capture/ci/assembleFinalReel.mjs', `--dir=${root}/run`, `--sha=${sha}`, `--out=${out}`, `--work=${root}/work`, ...extra],
    { cwd: REPO, encoding: 'utf8' },
  )
}

/** Mean |luma difference| between one frame of two videos, on 64x36
 * limited-range luma thumbnails — independent of the CLI's own check. */
function frameDiff(a: string, aFrame: number, b: string, bFrame: number): number {
  // An RGB still is converted the way assembly converts the end card.
  const toYuv = (file: string) => (/\.png$/i.test(file) ? 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p,' : '')
  const thumb = (file: string, frame: number) =>
    execFileSync('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-map', '0:v:0',
      '-vf', `select='eq(n,${frame})',${toYuv(file)}extractplanes=y,scale=64:36:flags=area:in_range=tv:out_range=tv`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ])
  const [x, y] = [thumb(a, aFrame), thumb(b, bFrame)]
  assert.equal(x.length, 64 * 36)
  let diff = 0
  for (let pixel = 0; pixel < x.length; pixel += 1) diff += Math.abs(x[pixel]! - y[pixel]!)
  return diff / x.length
}

test('synthetic intermediates assemble into the five verified deliverables', { skip: !enabled && 'set ASSEMBLY_E2E=1 (needs ffmpeg; several minutes)', timeout: 30 * 60_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reel-assembly-'))
  try {
    // The edit check compares finalEdit.json with the copy at the rendered SHA.
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
    synthesizeRun(path.join(root, 'run'), sha)

    const result = assemble(root, sha, path.join(root, 'deliverables'))
    process.stdout.write(result.stdout)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readdirSync(path.join(root, 'deliverables')).sort(), [...Object.values(DELIVERABLES), ...DELIVERABLE_METADATA].sort())
    const manifest = JSON.parse(readFileSync(path.join(root, 'deliverables', 'manifest.json'), 'utf8'))
    assert.equal(manifest.verified, true)
    assert.equal(manifest.renderedFramesThisRun, 0)
    const byFile = Object.fromEntries(manifest.outputs.map((output: { file: string }) => [output.file, output]))
    assert.equal(byFile[DELIVERABLES.reel].frames, 3456)
    assert.equal(byFile[DELIVERABLES.reel].audioStreams, 0)
    assert.equal(byFile[DELIVERABLES.loop].frames, 414)
    assert.equal(byFile[DELIVERABLES.loop].width, 1280)
    assert.equal(byFile[DELIVERABLES.loop].audioStreams, 0)
    assert.equal(byFile[DELIVERABLES.og].width, 1200)
    assert.equal(byFile[DELIVERABLES.og].height, 630)

    // Remove one locked clip: assembly must stop before producing anything.
    rmSync(path.join(root, 'run', 'render-c13'), { recursive: true })
    const missing = assemble(root, sha, path.join(root, 'deliverables-missing'))
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /STOP — render intermediates failed verification/)
    assert.match(missing.stderr, /c13: missing/)
    assert.deepEqual(readdirSync(root).filter((name) => name === 'deliverables-missing'), [])
  } finally {
    if (process.env.ASSEMBLY_E2E_KEEP === '1') console.log(`kept synthetic run in ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }
})

test('synthetic stand-in for run #6: c03 and c04 are held, the portrait inserts covered, the retired frame-468 override audited, the end card fills its slot', { skip: !enabled && 'set ASSEMBLY_E2E=1 (needs ffmpeg; several minutes)', timeout: 30 * 60_000 }, () => {
  const [retired] = SUPERSEDED_FRAME_OVERRIDES
  assert.ok(retired !== undefined)
  assert.deepEqual(RELEASE_FRAME_OVERRIDES, []) // no single-frame override is in force
  const hold = (id: string) => RELEASE_INTERVAL_OVERRIDES.find((interval) => interval.original.clipId === id)!
  const [c03Hold, c04Hold] = [hold('c03'), hold('c04')]
  const root = mkdtempSync(path.join(os.tmpdir(), 'reel-assembly-run6-'))
  try {
    // Run #6's SHA: its capture/finalEdit.json is the locked edit, so the
    // CLI's edit check passes (needs that commit in the local history).
    const sha = PIN.headSha
    const artifactDirs = new Map<string, string>()
    for (const interval of RELEASE_INTERVAL_OVERRIDES) for (const id of [interval.original.clipId, interval.hold.clipId]) artifactDirs.set(id, interval.source.artifact)
    // Planted flicker: the retired frame-468 defect and more, all in frames the holds do not hold.
    const flicker = [retired.override.original, { clipId: 'c03', frame: 100 }, { clipId: 'c04', frame: 20 }, { clipId: 'c04', frame: 130 }].filter((defect) => !(defect.clipId === 'c03' && defect.frame === c03Hold.hold.frame) && !(defect.clipId === 'c04' && defect.frame === c04Hold.hold.frame))
    synthesizeRun(path.join(root, 'run'), sha, { artifactDirs, defects: flicker })
    // The record capture/ci/sourceRun.mjs writes after validating the run
    // against the pin and digest-checking every artifact zip.
    const sourceRun = path.join(root, 'source-run.json')
    writeFileSync(sourceRun, JSON.stringify({ schema: 'shootthemoon.reel-source-run/1', runId: PIN.runId, runNumber: PIN.runNumber, headSha: sha, artifacts: PIN.artifacts.map(({ name, digest }) => ({ name, digest })) }))

    // Run #6's SHA without its source record: the declared overrides cannot
    // be confirmed, so assembly stops (it never ships the defect silently).
    const unbound = assemble(root, sha, path.join(root, 'deliverables-unbound'))
    assert.equal(unbound.status, 1)
    assert.match(unbound.stderr, /STOP — release frame overrides/)
    assert.match(unbound.stderr, /pass --source=/)

    const out = path.join(root, 'deliverables')
    const result = spawnSync(
      process.execPath,
      [...NODE_TS, 'capture/ci/assembleFinalReel.mjs', `--dir=${root}/run`, `--source=${sourceRun}`, `--end-card=${END_CARD}`, `--out=${out}`, `--work=${root}/work`],
      { cwd: REPO, encoding: 'utf8' },
    )
    process.stdout.write(result.stdout)
    assert.equal(result.status, 0, result.stderr)
    const [x, y] = [c03Hold.hold.frame, c04Hold.hold.frame]
    assert.match(result.stdout, new RegExp(`interval override: reel frames 432-575 \\(7\\.200-9\\.600s, 144 frames\\) c03#0-143 -> c03#${x} held`))
    assert.match(result.stdout, new RegExp(`interval override: reel frames 576-719 \\(9\\.600-12\\.000s, 144 frames\\) c04#0-143 -> c04#${y} held`))
    assert.match(result.stdout, /interval override: reel frames 1764-1799 \(29\.400-30\.000s, 36 frames\) c14#0-35 -> c13#35 held/)
    assert.match(result.stdout, /interval override: reel frames 2088-2159 \(34\.800-36\.000s, 72 frames\) c18#0-71 -> c17#71 held/)
    assert.match(result.stdout, /replaces 18 frame\(s\) of the locked black transition into c03/)
    assert.match(result.stdout, /frame override superseded: reel frame 468 \(7\.800s\) c03#36 -> c03#37 is retired, not applied; interval override reel frames 432-575 replaces it/)
    assert.match(result.stdout, /held interval @ 432-575: 144 frames/)
    assert.match(result.stdout, /held interval @ 576-719: 144 frames/)
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    assert.equal(manifest.verified, true)
    assert.equal(manifest.renderedFramesThisRun, 0)
    const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index)
    // Everything declared changes, except the frame where the locked plan already shows the held frame.
    const declared = [...range(432, 144), ...range(576, 144), ...range(1764, 36), ...range(2088, 72)].filter((frame) => frame !== 432 + x && frame !== 576 + y)
    assert.deepEqual(manifest.reel.framesDifferingFromLockedPlan, declared)
    assert.equal(manifest.reel.portraitFramesRemaining, 0)
    assert.equal(manifest.reel.intervalOverrides.length, 4)
    assert.deepEqual(manifest.reel.intervalOverrides.map((interval: { kind: string; reelFrames: unknown }) => [interval.kind, interval.reelFrames]), [
      ['hold', { first: 432, last: 575, count: 144 }],
      ['hold', { first: 576, last: 719, count: 144 }],
      ['cover', { first: 1764, last: 1799, count: 36 }],
      ['cover', { first: 2088, last: 2159, count: 72 }],
    ])
    assert.deepEqual(manifest.reel.intervalOverrides.map((interval: { lockedTransitionFramesReplaced: unknown }) => interval.lockedTransitionFramesReplaced), [{ count: 18, color: 'black' }, { count: 0, color: null }, { count: 0, color: null }, { count: 0, color: null }])
    for (const interval of manifest.reel.intervalOverrides.slice(0, 2)) {
      assert.equal(interval.held.maxLevelsFromFirstFrame < 0.5, true, JSON.stringify(interval.held))
      assert.equal(interval.held.firstFrameLevelsFromHeldSource < 2, true, JSON.stringify(interval.held))
      assert.ok(interval.held.replacedSourceLevelsFromHeld.max > 2) // the unheld footage did move
    }
    assert.equal(manifest.reel.frameOverrides.length, 0)
    assert.equal(manifest.reel.supersededFrameOverrides.length, 1)
    assert.deepEqual(
      { applied: manifest.reel.supersededFrameOverrides[0].applied, reelFrame: manifest.reel.supersededFrameOverrides[0].reelFrame, reelFrames: manifest.reel.supersededFrameOverrides[0].supersededBy.reelFrames },
      { applied: false, reelFrame: 468, reelFrames: { first: 432, last: 575 } },
    )
    assert.equal(manifest.reel.endCard.file, path.basename(END_CARD))
    assert.equal(manifest.reel.endCard.slot.frames, 288)
    const reel = manifest.outputs.find((output: { file: string }) => output.file === DELIVERABLES.reel)
    assert.equal(reel.frames, 3456)
    assert.equal(reel.durationSec, 57.6)
    assert.equal(reel.audioStreams, 0)
    assert.equal(reel.width, 1920)
    assert.equal(reel.height, 1080)
    assert.equal(reel.fps, 60)
    assert.equal(reel.frameOverrideChecks.length, 144 + 144 + 36 + 72)
    assert.deepEqual(reel.frameOverrideChecks.flatMap((check: { problems: string[] }) => check.problems), [])

    // Independently of the CLI: c03 and c04 are each one held frame, the planted
    // flicker (incl. the retired c03#36 defect) is never shown, and nothing shifted.
    const clipFile = (artifact: string, id: string) => {
      const clip = lockedShotClips(EDIT).find((entry) => entry.id === id)!
      return path.join(root, 'run', artifact, `${id}__${clip.shotId}`, `${id}__${clip.shotId}.mp4`)
    }
    const reelFile = path.join(out, DELIVERABLES.reel)
    const [c03, c04] = [clipFile(c03Hold.source.artifact, 'c03'), clipFile(c04Hold.source.artifact, 'c04')]
    for (const frame of [432, 440, 449, 468, 500, 575]) assert.ok(frameDiff(reelFile, frame, c03, x) < 3, `reel ${frame} is c03#${x}`)
    for (const frame of [576, 600, 650, 719]) assert.ok(frameDiff(reelFile, frame, c04, y) < 3, `reel ${frame} is c04#${y}`)
    assert.ok(frameDiff(reelFile, 468, c03, 36) > 10) // the defective source frame is never shown
    assert.ok(frameDiff(reelFile, 468, reelFile, 467) < 0.5 && frameDiff(reelFile, 500, reelFile, 431 + 30) < 0.5) // one stable picture
    assert.ok(frameDiff(reelFile, 432, reelFile, 575) < 0.5 && frameDiff(reelFile, 576, reelFile, 719) < 0.5)
    // The portrait intervals show the adjacent 16:9 clip's frame, never the
    // pillarboxed clip; the frames either side and after are the locked ones.
    const [c13, c14, c15, c17, c18, c19] = [
      clipFile('render-act4-counterstrike', 'c13'), clipFile('render-act4-counterstrike', 'c14'), clipFile('render-c15', 'c15'),
      clipFile('render-act5-divider', 'c17'), clipFile('render-act5-divider', 'c18'), clipFile('render-c19', 'c19'),
    ] as const
    for (const frame of [1764, 1780, 1799]) {
      assert.ok(frameDiff(reelFile, frame, c13, 35) < 3, `reel ${frame} is c13#35`)
      assert.ok(frameDiff(reelFile, frame, c14, frame - 1764) > 10, `reel ${frame} is not the portrait c14`)
    }
    for (const frame of [2088, 2120, 2159]) {
      assert.ok(frameDiff(reelFile, frame, c17, 71) < 3, `reel ${frame} is c17#71`)
      assert.ok(frameDiff(reelFile, frame, c18, frame - 2088) > 10, `reel ${frame} is not the portrait c18`)
    }
    assert.ok(frameDiff(reelFile, 720, clipFile('render-c05', 'c05'), 0) < 3) // c05 starts exactly where it did
    assert.ok(frameDiff(reelFile, 1763, c13, 35) < 3)
    assert.ok(frameDiff(reelFile, 1800, c15, 0) < 3) // c15 starts exactly where it did
    assert.ok(frameDiff(reelFile, 2087, c17, 71) < 3) // c17 still ends on its last frame
    assert.ok(frameDiff(reelFile, 2160, c19, 0) < 3) // c19 starts exactly where it did
    // The end card holds its locked slot (after the dip from black).
    assert.ok(frameDiff(reelFile, 3455, END_CARD, 0) < 3)
  } finally {
    if (process.env.ASSEMBLY_E2E_KEEP === '1') console.log(`kept synthetic run in ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }
})
