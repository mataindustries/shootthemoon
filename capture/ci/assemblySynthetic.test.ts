/**
 * End-to-end check of capture/ci/assembleFinalReel.mjs on SYNTHETIC media:
 * ffmpeg test-pattern stand-ins for the 25 verified intermediates (never
 * game footage — nothing is rendered), with clip.json / reel-manifest.json
 * written the way renderGroup.mjs / verifyReel.mjs write them. Proves the
 * real CLI assembles and verifies all five deliverables, and that it stops
 * before assembling anything when a locked clip is missing. A second run
 * stands in for the pinned render run #6 (its SHA, source-run record and
 * c03 artifact) with a planted one-frame defect at c03#36: the declared
 * release frame override must repair exactly that reel frame, the approved
 * end card must fill its slot, and run #6's SHA without --source must STOP.
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
import { DELIVERABLE_METADATA, DELIVERABLES, lockedShotClips, RELEASE_FRAME_OVERRIDES, type ReleasePin } from './assembly.ts'
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
    const planted = defects.map((defect) => `,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.6:t=fill:enable='eq(n,${defect.frame})'`).join('')
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

test('synthetic stand-in for run #6: the declared override repairs exactly reel frame 468, the end card fills its slot', { skip: !enabled && 'set ASSEMBLY_E2E=1 (needs ffmpeg; several minutes)', timeout: 30 * 60_000 }, () => {
  const [override] = RELEASE_FRAME_OVERRIDES
  assert.ok(override !== undefined)
  const root = mkdtempSync(path.join(os.tmpdir(), 'reel-assembly-run6-'))
  try {
    // Run #6's SHA: its capture/finalEdit.json is the locked edit, so the
    // CLI's edit check passes (needs that commit in the local history).
    const sha = PIN.headSha
    const artifactDirs = new Map([[override.original.clipId, override.source.artifact]])
    synthesizeRun(path.join(root, 'run'), sha, { artifactDirs, defects: [override.original] })
    // The record capture/ci/sourceRun.mjs writes after validating the run
    // against the pin and digest-checking every artifact zip.
    const sourceRun = path.join(root, 'source-run.json')
    writeFileSync(sourceRun, JSON.stringify({ schema: 'shootthemoon.reel-source-run/1', runId: PIN.runId, runNumber: PIN.runNumber, headSha: sha, artifacts: PIN.artifacts.map(({ name, digest }) => ({ name, digest })) }))

    // Run #6's SHA without its source record: the declared repair cannot
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
    assert.match(result.stdout, /frame override: reel frame 468 \(7\.800s\) c03#36 -> c03#37 — one-frame enemy-base scale\/camera defect/)
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    assert.equal(manifest.verified, true)
    assert.equal(manifest.renderedFramesThisRun, 0)
    assert.deepEqual(manifest.reel.framesDifferingFromLockedPlan, [468])
    assert.equal(manifest.reel.frameOverrides.length, 1)
    assert.equal(manifest.reel.frameOverrides[0].reelFrame, 468)
    assert.equal(manifest.reel.endCard.file, path.basename(END_CARD))
    assert.equal(manifest.reel.endCard.slot.frames, 288)
    const reel = manifest.outputs.find((output: { file: string }) => output.file === DELIVERABLES.reel)
    assert.equal(reel.frames, 3456)
    assert.equal(reel.durationSec, 57.6)
    assert.deepEqual(reel.frameOverrideChecks[0].problems, [])

    // Independently of the CLI: reel frame 468 is c03#37, not the planted
    // defect c03#36; its neighbours are untouched and nothing shifted.
    const c03 = path.join(root, 'run', override.source.artifact, 'c03__vesper-citadel-reveal', 'c03__vesper-citadel-reveal.mp4')
    const reelFile = path.join(out, DELIVERABLES.reel)
    assert.ok(frameDiff(reelFile, 468, c03, 37) < 3)
    assert.ok(frameDiff(reelFile, 468, c03, 36) > 10)
    assert.ok(frameDiff(reelFile, 467, c03, 35) < 3)
    assert.ok(frameDiff(reelFile, 469, c03, 37) < 3)
    assert.ok(frameDiff(reelFile, 500, c03, 68) < 3)
    // The end card holds its locked slot (after the dip from black).
    assert.ok(frameDiff(reelFile, 3455, END_CARD, 0) < 3)
  } finally {
    if (process.env.ASSEMBLY_E2E_KEEP === '1') console.log(`kept synthetic run in ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }
})
