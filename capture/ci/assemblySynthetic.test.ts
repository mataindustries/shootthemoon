/**
 * End-to-end check of capture/ci/assembleFinalReel.mjs on SYNTHETIC media:
 * ffmpeg test-pattern stand-ins for the 25 verified intermediates (never
 * game footage — nothing is rendered), with clip.json / reel-manifest.json
 * written the way renderGroup.mjs / verifyReel.mjs write them. Proves the
 * real CLI assembles and verifies all five deliverables, and that it stops
 * before assembling anything when a locked clip is missing.
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
import { DELIVERABLE_METADATA, DELIVERABLES, lockedShotClips } from './assembly.ts'
import { CLIP_METADATA_SCHEMA } from './reelCi.ts'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EDIT: FinalEdit = JSON.parse(readFileSync(path.join(REPO, 'capture/finalEdit.json'), 'utf8'))
const enabled = process.env.ASSEMBLY_E2E === '1'
const NODE_TS = ['--experimental-strip-types', '--experimental-transform-types', '--no-warnings']

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

function synthesizeRun(root: string, sha: string): void {
  const clips = lockedShotClips(EDIT)
  const manifestClips = []
  for (const [index, clip] of clips.entries()) {
    const frames = ((clip.destOutMs - clip.destInMs) / 1000) * EDIT.output.fps
    const dir = `render-${clip.id}/${clip.id}__${clip.shotId}`
    const file = `${clip.id}__${clip.shotId}.mp4`
    mkdirSync(path.join(root, dir), { recursive: true })
    const video = path.join(root, dir, file)
    // A moving test pattern, offset in brightness per clip so every cut is visible.
    const brightness = (((index % 9) - 4) * 0.04).toFixed(2)
    execFileSync('ffmpeg', [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc2=s=${EDIT.output.width}x${EDIT.output.height}:r=${EDIT.output.fps},eq=brightness=${brightness},format=yuv444p`,
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

function assemble(root: string, sha: string, out: string) {
  return spawnSync(
    process.execPath,
    [...NODE_TS, 'capture/ci/assembleFinalReel.mjs', `--dir=${root}/run`, `--sha=${sha}`, `--out=${out}`, `--work=${root}/work`],
    { cwd: REPO, encoding: 'utf8' },
  )
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
