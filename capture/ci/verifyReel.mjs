#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Final verification for a render run: reads every clip.json (at any depth under --dir) the
 * matrix jobs uploaded, cross-checks them against the locked edit with
 * reelCi.ts's verifyReelRecords(), re-hashes each intermediate against its
 * recorded sha256, and writes reel-manifest.json (the ordered list of
 * verified clips a later assembly step consumes).
 *
 *   --dir=reel-artifacts --expected=c01,...,c25 --sha=<resolved sha>
 */
import { readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, sha256File } from './io.ts'
import { verifyReelRecords } from './reelCi.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const dir = args.dir ?? 'reel-artifacts'
const expected = (args.expected ?? '').split(',').filter(Boolean)
if (expected.length === 0 || !args.sha) throw new Error('--expected=<clip ids> and --sha=<git sha> are required')

async function findFiles(root, name) {
  const found = []
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (entry.isFile() && entry.name === name) found.push(path.join(entry.parentPath, entry.name))
  }
  return found.sort()
}

const edit = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/finalEdit.json'), 'utf8'))
const records = []
const problems = []
for (const file of await findFiles(dir, 'clip.json')) {
  const record = await readJson(file)
  if (record === null) {
    problems.push(`${file}: unreadable`)
    continue
  }
  const video = path.join(path.dirname(file), record.output.file)
  const actual = await sha256File(video).catch(() => null)
  if (actual !== record.output.sha256) problems.push(`${record.clipId}: ${record.output.file} hash ${actual ?? 'missing'} != recorded ${record.output.sha256}`)
  records.push({ ...record, _dir: path.relative(dir, path.dirname(file)) })
}
for (const file of await findFiles(dir, 'FAILED.json')) {
  const failure = await readJson(file)
  problems.push(`${failure?.clipId ?? file}: job reported failure — ${failure?.error ?? 'unknown'}`)
}

const result = verifyReelRecords(edit, records, expected, args.sha)
problems.push(...result.problems)

const ordered = [...records].sort((a, b) => a.dest.inMs - b.dest.inMs)
const manifest = {
  gitSha: args.sha,
  verified: problems.length === 0,
  expectedClips: expected.length,
  clipCount: result.clipCount,
  shotFootageMs: result.shotFootageMs,
  timelineMs: result.timelineMs,
  fps: edit.output.fps,
  gitShas: result.gitShas,
  harnessBuilds: [...new Set(records.map((record) => record.harnessBuildSha256))],
  problems,
  clips: ordered.map((record) => ({
    clipId: record.clipId, act: record.act, shotId: record.shotId, dir: record._dir, file: record.output.file,
    destInMs: record.dest.inMs, destOutMs: record.dest.outMs, frames: record.output.frames,
    sourceFrames: record.source.frames, sourceSize: `${record.source.width}x${record.source.height}`,
    transitionOut: record.transitionOut, sha256: record.output.sha256, bytes: record.output.bytes,
  })),
}
await writeFile(path.join(dir, 'reel-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(`clips: ${result.clipCount}/${expected.length}  shot footage: ${(result.shotFootageMs / 1000).toFixed(1)}s  timeline: ${(result.timelineMs / 1000).toFixed(1)}s  fps: ${edit.output.fps}`)
console.log(`git SHAs: ${result.gitShas.join(', ') || 'none'}  harness builds: ${manifest.harnessBuilds.length}`)
console.log(`total intermediate size: ${(ordered.reduce((sum, r) => sum + r.output.bytes, 0) / 1e6).toFixed(1)} MB`)
if (problems.length > 0) {
  console.error(`REEL VERIFICATION FAILED (${problems.length}):\n  ${problems.join('\n  ')}`)
  process.exitCode = 1
} else {
  console.log('REEL VERIFICATION PASSED')
}
