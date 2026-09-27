#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * One part of the `final-preflight` workflow mode (reelCi.ts PREFLIGHT_PARTS):
 * a cheap, real-runner check of each failure class run #4 hit, to pass
 * before another multi-hour full render is authorized.
 *
 *   c19-dense       renderGroup c19 (all 108 frames, verify, encode) + every
 *                   frame's render-time evidence at its exact source time
 *   crops-port      proof frames of c24/c25/c16 at their exact rasterized
 *                   sizes (+ exact sampling for c24/c25) + renderGroup c18
 *   progress-c07    12 proof frames of c07: exact 4K size, per-frame cost on
 *                   this runner, and whether c01 would still fit one job
 *   timeout-resume  renderGroup c22 with attempt 1 cut short by fault
 *                   injection: it must still verify, through decideRetry
 *
 * Renders only through the same entry points a full run uses
 * (capture/ci/renderGroup.mjs, capture/finalRender.mjs --proof). Writes
 * <out>/preflight-<part>.json and a markdown table on stdout; exits non-zero
 * if any check fails.
 *
 * Usage:
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/ci/preflight.mjs --part=c19-dense --out=ci-out [--sha=<HEAD>] [--require-clean]
 */
import { readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinalRenderJobs } from '../finalRender/plan.ts'
import { jobOutputDir } from '../finalRender/resume.ts'
import { SHOTS } from '../manifest.ts'
import {
  JOB_CEILING_MINUTES,
  MEASURED_COST_MODEL,
  PREFLIGHT_FORCED_TIMEOUT_MINUTES,
  PREFLIGHT_PARTS,
  PREFLIGHT_PROGRESS_SAMPLE_FRAMES,
  checkExactSampling,
  checkForcedTimeoutRecovery,
  checkProofFrameSizes,
  projectClipMinutes,
  timelineJobs,
} from './reelCi.ts'
import { readJson, readPngSize, run, runOrThrow } from './io.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
process.chdir(REPO_ROOT)

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.length === 0 ? true : rest.join('=')]
  }),
)
const part = PREFLIGHT_PARTS.find((candidate) => candidate.id === args.part)
if (part === undefined) throw new Error(`--part must be one of ${PREFLIGHT_PARTS.map((candidate) => candidate.id).join(', ')}`)
const out = typeof args.out === 'string' ? args.out : 'ci-out'
const passthrough = [...(typeof args.sha === 'string' ? [`--sha=${args.sha}`] : []), ...(args['require-clean'] ? ['--require-clean'] : [])]

const edit = JSON.parse(readFileSync('capture/finalEdit.json', 'utf8'))
const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const jobs = timelineJobs(edit, buildFinalRenderJobs(edit, shotIndex))
const jobById = (clipId) => {
  const job = jobs.find((candidate) => candidate.jobId === clipId)
  if (job === undefined) throw new Error(`no locked clip ${clipId}`)
  return job
}

const checks = []
const notes = []
function check(name, problems) {
  checks.push({ name, ok: problems.length === 0, problems })
  console.log(`[preflight] ${problems.length === 0 ? 'PASS' : 'FAIL'} ${name}${problems.length ? `\n  ${problems.slice(0, 10).join('\n  ')}` : ''}`)
}

const node = ['--experimental-strip-types', '--experimental-transform-types']

async function renderGroup(group, clipIds, extra = []) {
  const result = await run('node', [...node, 'capture/ci/renderGroup.mjs', `--group=${group}`, `--clips=${clipIds.join(',')}`, `--out=${out}`, ...passthrough, ...extra], { echo: true })
  const summary = await readJson(path.join(out, `group-${group}.json`))
  return { code: result.code, summary }
}

async function clipDirOf(clipId) {
  const entries = await readdir(out).catch(() => [])
  const name = entries.find((entry) => entry.startsWith(`${clipId}__`))
  return name === undefined ? null : path.join(out, name)
}

/** clip.json + capture-health.json of a clip renderGroup verified. */
async function verifiedClip(clipId) {
  const dir = await clipDirOf(clipId)
  if (dir === null) return { problems: [`${clipId}: no output directory`] }
  const record = await readJson(path.join(dir, 'clip.json'))
  const failure = await readJson(path.join(dir, 'FAILED.json'))
  const health = await readJson(path.join(dir, 'capture-health.json'))
  const problems = []
  if (failure !== null) problems.push(`${clipId}: FAILED — ${failure.error}`)
  if (record?.status !== 'verified') problems.push(`${clipId}: not verified`)
  return { dir, record, health, problems }
}

/** Proof frames through the unchanged CLI; returns sizes + proof.json. */
async function proof(clipId, frames) {
  const job = jobById(clipId)
  await rm(path.join(jobOutputDir(job), 'proof'), { recursive: true, force: true })
  const env = { ...process.env, ...(frames ? { CAPTURE_FINAL_PROOF_FRAMES: String(frames) } : {}) }
  const result = await run('node', [...node, 'capture/finalRender.mjs', '--proof', `--clip=${clipId}`], { echo: true, env })
  const evidence = await readJson(path.join(jobOutputDir(job), 'proof', 'proof.json'))
  const sizes = new Map()
  for (const index of evidence?.indices ?? []) {
    sizes.set(index, await readPngSize(path.join(jobOutputDir(job), 'proof', 'frames', `${String(index).padStart(6, '0')}.png`)))
  }
  return { job, code: result.code, evidence, sizes }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? NaN : sorted[Math.floor((sorted.length - 1) / 2)]
}

/** The same exact-SHA / clean-checkout gate renderGroup.mjs applies, for
 * this part as a whole — its proof-frame renders never go through
 * renderGroup, so they are covered here. */
async function checkoutState() {
  const head = (await runOrThrow('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const dirty = (await runOrThrow('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim().length > 0
  if (typeof args.sha === 'string' && head !== args.sha) throw new Error(`HEAD is ${head}, expected --sha=${args.sha}`)
  if (args['require-clean'] && dirty) throw new Error('tracked files are modified; refusing to run the preflight from a dirty checkout')
  return { head, dirty }
}

async function main() {
  const startedAt = Date.now()
  const git = await checkoutState()
  console.log(`[preflight] ${part.id} @ ${git.head.slice(0, 12)}${git.dirty ? ' (dirty)' : ''}: ${part.label}`)

  if (part.id === 'c19-dense') {
    const { code } = await renderGroup(`preflight-${part.id}`, ['c19'])
    const clip = await verifiedClip('c19')
    check('c19 renders, validates (0 missing/corrupt/frozen) and encodes', [...(code === 0 ? [] : [`renderGroup exited ${code}`]), ...clip.problems])
    if (clip.record) {
      check('c19 is the full 108-frame final-render density', clip.record.source.frames === 108 ? [] : [`${clip.record.source.frames} source frames`])
      check('c19 decoded intermediate has no frozen frame', clip.record.output.decodedAdjacentDuplicates === 0 ? [] : [`${clip.record.output.decodedAdjacentDuplicates} frozen`])
    }
    check('every c19 frame rendered at its exact requested source time', clip.health ? checkExactSampling(jobById('c19'), clip.health.frameTimings) : ['no capture-health.json'])
  }

  if (part.id === 'crops-port') {
    for (const clipId of ['c24', 'c25', 'c16']) {
      const { job, code, evidence, sizes } = await proof(clipId)
      check(`${clipId} proof frames render`, code === 0 && evidence ? [] : [`finalRender --proof exited ${code}`])
      check(`${clipId} first/mid/last are exactly the rasterized crop size`, sizes.size === 3 ? checkProofFrameSizes(job, sizes) : [`${sizes.size} proof frame(s)`])
      notes.push(`${clipId} proof sizes: ${[...sizes].map(([index, size]) => `#${index} ${size.width}x${size.height}`).join(', ')}`)
      if (job.source.clock === 'elapsed-ms') {
        check(`${clipId} proof frames rendered at their exact source times`, evidence ? checkExactSampling(job, evidence.frameOutcomes, evidence.indices) : ['no proof.json'])
      }
    }
    const { code } = await renderGroup(`preflight-${part.id}-c18`, ['c18'])
    const clip = await verifiedClip('c18')
    check('c18 PORT still renders, verifies (1170x2532, PORT canvas buffer) and encodes', [...(code === 0 ? [] : [`renderGroup exited ${code}`]), ...clip.problems])
    if (clip.record) {
      const { width, height } = clip.record.source
      check('c18 source is exactly 1170x2532', width === 1170 && height === 2532 ? [] : [`${width}x${height}`])
    }
  }

  if (part.id === 'progress-c07') {
    const { job, code, evidence, sizes } = await proof('c07', PREFLIGHT_PROGRESS_SAMPLE_FRAMES)
    check('c07 progress-event sample renders', code === 0 && evidence ? [] : [`finalRender --proof exited ${code}`])
    check(`c07 ${PREFLIGHT_PROGRESS_SAMPLE_FRAMES} spread frames are exactly 3840x2160`, sizes.size === PREFLIGHT_PROGRESS_SAMPLE_FRAMES ? checkProofFrameSizes(job, sizes) : [`${sizes.size} frame(s)`])
    if (evidence) {
      // Frame 0 carries the shader compile; the rest are what a full render pays per frame.
      const steady = evidence.frameOutcomes.slice(1).map((frame) => frame.tookMs / 1000)
      const perFrame = median(steady)
      const worst = Math.max(...steady)
      const c01 = projectClipMinutes(jobById('c01'), perFrame)
      notes.push(
        `c07 per-frame on this runner: median ${perFrame.toFixed(1)}s, worst ${worst.toFixed(1)}s (first ${(evidence.frameOutcomes[0].tookMs / 1000).toFixed(1)}s; ` +
          `cost model ${MEASURED_COST_MODEL.secPerFrame.progress}s); projected at the median: c07 ${projectClipMinutes(job, perFrame).toFixed(0)} min, ` +
          `c01 ${c01.toFixed(0)} min (job ceiling ${JOB_CEILING_MINUTES}); at the worst: c01 ${projectClipMinutes(jobById('c01'), worst).toFixed(0)} min`,
      )
      check('c01 (288 frames) projected to fit one runner job at the sampled median rate', c01 <= JOB_CEILING_MINUTES ? [] : [`c01 projects to ${c01.toFixed(0)} min`])
    }
  }

  if (part.id === 'timeout-resume') {
    const forced = PREFLIGHT_FORCED_TIMEOUT_MINUTES
    const { code, summary } = await renderGroup(`preflight-${part.id}`, ['c22'], [`--first-attempt-timeout-minutes=${forced}`])
    const clip = await verifiedClip('c22')
    check('c22 verifies despite its first attempt being cut short', [...(code === 0 ? [] : [`renderGroup exited ${code}`]), ...clip.problems])
    const attempts = summary?.clips?.find((entry) => entry.clipId === 'c22')?.attempts ?? []
    notes.push(`c22 attempts: ${attempts.map((a) => `#${a.attempt} exit ${a.exitCode} in ${(a.elapsedMs / 60_000).toFixed(1)} min, valid ${a.validBefore}->${a.validAfter}, timeout ${(a.timeoutMs / 60_000).toFixed(1)} min`).join('; ')}`)
    check('attempt 1 was cut by the injected cap mid-render and attempt 2 completed the clip', checkForcedTimeoutRecovery(attempts, forced))
    check('every c22 frame rendered at its exact requested source time', clip.health ? checkExactSampling(jobById('c22'), clip.health.frameTimings) : ['no capture-health.json'])
  }

  const report = {
    part: part.id,
    label: part.label,
    gitSha: git.head,
    worktreeDirty: git.dirty,
    ok: checks.every((entry) => entry.ok),
    minutes: (Date.now() - startedAt) / 60_000,
    checks,
    notes,
  }
  await writeFile(path.join(out, `preflight-${part.id}.json`), JSON.stringify(report, null, 2) + '\n')
  console.log(`\n### Preflight — ${part.id}: ${report.ok ? 'PASSED' : 'FAILED'} (${report.minutes.toFixed(1)} min)\n\n| check | result |\n|---|---|`)
  for (const entry of checks) console.log(`| ${entry.name} | ${entry.ok ? 'pass' : `**FAIL** — ${entry.problems.slice(0, 3).join('; ').replace(/\|/g, '/')}`} |`)
  for (const note of notes) console.log(`\n- ${note}`)
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
