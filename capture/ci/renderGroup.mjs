#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Renders one group of locked-reel clips end to end on a single machine (one
 * GitHub Actions matrix job, or a local shell), one clip at a time:
 *
 *   1. render     — the unchanged `capture/finalRender.mjs --clip=<id>`
 *                   (its own harness build, webServer, resume, storage gate)
 *   2. verify     — completion marker, frame count, no missing/corrupt/
 *                   frozen frames, expected PNG size per frame, expected 4K
 *                   (or HUD/PORT) canvas buffer, zero page/console errors,
 *                   healthy WebGL context
 *   3. encode     — the approved 1080p60 intermediate (reelCi.ts's
 *                   planIntermediate(): locked crop / crop push / pillarbox)
 *   4. re-verify  — decoded frame count, fps, size, profile, duration, no
 *                   frozen frames after decode
 *   5. metadata   — clip.json (git SHA, act, ids, frame counts, sizes,
 *                   duration, hashes, timings), frames.sha256, contact JPEGs
 *   6. clean up   — deletes the clip's raw PNG sequence
 *
 * Only the out dir (encoded clip + small JSON/JPEGs) is ever meant to leave
 * the machine; raw frames live in the gitignored capture-final/ and are
 * deleted as soon as their clip is verified and encoded.
 *
 * Resumable: a clip whose <out>/<clip>__<shot>/clip.json is already verified
 * for the same git SHA (and whose .mp4 still hashes to what it records) is
 * skipped — the workflow restores an earlier attempt's artifact into <out>
 * before calling this, so "Re-run failed jobs" only renders what is missing.
 * One failing clip never stops the others; the exit code is non-zero if any
 * clip in the group is not verified.
 *
 * Usage:
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/ci/renderGroup.mjs --group=smoke-c07 --clips=c07 --out=ci-out \
 *       [--sha=<expected HEAD>] [--require-clean] [--keep-frames] [--skip-render]
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinalRenderJobs } from '../finalRender/plan.ts'
import { isFullyValid, isJobComplete, jobFrameDir, jobOutputDir, readJobMetadata, validateJobFrames } from '../finalRender/resume.ts'
import { filterKnownWarnings } from '../initCapture.ts'
import { SHOTS } from '../manifest.ts'
import {
  CLIP_METADATA_SCHEMA,
  INTERMEDIATE,
  checkSourceFrameSizes,
  contactFrameIndices,
  expectedCanvasBuffer,
  intermediateFfmpegArgs,
  planIntermediate,
  shotClipById,
  timelineJobs,
} from './reelCi.ts'
import { decodedAdjacentDuplicates, probeVideo, readJson, readPngSize, run, runOrThrow, sha256File, sha256Text, toolVersion } from './io.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
process.chdir(REPO_ROOT)

const RENDER_ATTEMPTS = 3

function parseArgs(argv) {
  const options = { group: null, clips: [], out: 'ci-out', sha: null, requireClean: false, keepFrames: false, skipRender: false }
  for (const arg of argv) {
    if (arg.startsWith('--group=')) options.group = arg.slice(8)
    else if (arg.startsWith('--clips=')) options.clips = arg.slice(8).split(/[,\s]+/).filter(Boolean)
    else if (arg.startsWith('--out=')) options.out = arg.slice(6)
    else if (arg.startsWith('--sha=')) options.sha = arg.slice(6)
    else if (arg === '--require-clean') options.requireClean = true
    else if (arg === '--keep-frames') options.keepFrames = true
    else if (arg === '--skip-render') options.skipRender = true
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!options.group || options.clips.length === 0) throw new Error('--group=<id> and --clips=<c01,c02,...> are required')
  return options
}

const edit = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/finalEdit.json'), 'utf8'))
const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const jobs = timelineJobs(edit, buildFinalRenderJobs(edit, shotIndex))

async function atomicJson(filePath, value) {
  await writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2) + '\n')
  await rename(`${filePath}.tmp`, filePath)
}

async function gitState() {
  const head = (await runOrThrow('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const status = (await runOrThrow('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
  return { head, dirty: status.length > 0 }
}

/** sha256 over dist/ (relative path + content hash, sorted) — identifies the
 * exact harness bundle the clip was rendered from. */
async function distFingerprint() {
  const entries = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) entries.push(`${path.relative('dist', full)} ${await sha256File(full)}`)
    }
  }
  await walk('dist')
  return entries.length === 0 ? null : sha256Text(entries.sort().join('\n'))
}

async function resumable(clipDir, sha) {
  const record = await readJson(path.join(clipDir, 'clip.json'))
  if (record === null || record.schema !== CLIP_METADATA_SCHEMA || record.status !== 'verified' || record.gitSha !== sha) return null
  try {
    if ((await sha256File(path.join(clipDir, record.output.file))) !== record.output.sha256) return null
  } catch {
    return null
  }
  return record
}

async function renderClip(clipId) {
  const result = await run(
    'node',
    ['--experimental-strip-types', '--experimental-transform-types', 'capture/finalRender.mjs', `--clip=${clipId}`],
    { echo: true },
  )
  return result.code
}

async function finishClip(job, clipDir, context) {
  const clip = shotClipById(edit, job.jobId)
  const problems = []

  // --- render bookkeeping ------------------------------------------------
  const renderMeta = await readJobMetadata(job)
  if (!(await isJobComplete(job))) problems.push('no .complete marker (renderer did not finish this clip)')
  if (renderMeta?.status !== 'complete') problems.push(`render.json status ${renderMeta?.status ?? 'missing'}`)
  if (renderMeta && renderMeta.expectedFrames !== job.frames) problems.push(`render.json expects ${renderMeta.expectedFrames} frames, plan says ${job.frames}`)

  const validation = await validateJobFrames(job)
  if (!isFullyValid(job, validation)) {
    problems.push(
      `frames invalid: missing=${validation.missingIndices.length} corrupt=${validation.corruptIndices.length} ` +
        `frozen=${validation.duplicateIndices.length} valid=${validation.validIndices.size}/${job.frames}`,
    )
  }

  // --- browser health -----------------------------------------------------
  const health = await readJson(path.join(jobOutputDir(job), 'capture-health.json'))
  const expectedBuffer = expectedCanvasBuffer(job.profile)
  if (health === null) problems.push('capture-health.json missing')
  else {
    if (health.pageErrors.length > 0) problems.push(`page errors: ${JSON.stringify(health.pageErrors)}`)
    if (health.consoleErrors.length > 0) problems.push(`console errors: ${JSON.stringify(health.consoleErrors)}`)
    if (health.webgl.contextLost !== false || health.webgl.error !== 0) problems.push(`WebGL unhealthy: ${JSON.stringify(health.webgl)}`)
    if (health.canvasBuffer.width !== expectedBuffer.width || health.canvasBuffer.height !== expectedBuffer.height) {
      problems.push(`canvas buffer ${health.canvasBuffer.width}x${health.canvasBuffer.height}, expected ${expectedBuffer.width}x${expectedBuffer.height}`)
    }
  }
  // Every attempt's errors, including attempts that timed out before
  // capture-health.json was written (see finalRender.spec.ts).
  const loggedErrors = (await readFile(path.join(jobOutputDir(job), 'browser-errors.jsonl'), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).text)
  const unexpectedLogged = filterKnownWarnings(loggedErrors)
  if (unexpectedLogged.length > 0) problems.push(`browser errors logged across attempts: ${JSON.stringify(unexpectedLogged.slice(0, 5))}`)
  if (problems.length > 0) throw new Error(problems.join('; '))

  // --- source frame sizes + hashes ---------------------------------------
  const frameDir = jobFrameDir(job)
  const frameNames = Array.from({ length: job.frames }, (_, index) => `${String(index).padStart(6, '0')}.png`)
  const sizes = []
  const hashLines = []
  let sourceBytes = 0
  for (const name of frameNames) {
    const file = path.join(frameDir, name)
    sizes.push(await readPngSize(file))
    sourceBytes += (await stat(file)).size
    hashLines.push(`${await sha256File(file)}  ${name}`)
  }
  const sizeProblems = checkSourceFrameSizes(job, sizes)
  if (sizeProblems.length > 0) throw new Error(sizeProblems.slice(0, 5).join('; '))
  const framesSha256Text = hashLines.join('\n') + '\n'
  await writeFile(path.join(clipDir, 'frames.sha256'), framesSha256Text)

  // --- encode ------------------------------------------------------------
  const plan = planIntermediate(edit, job)
  const outputName = `${job.jobId}__${job.shotId}.mp4`
  const outputPath = path.resolve(clipDir, outputName)
  const encodeStartedAt = Date.now()
  await runOrThrow('ffmpeg', intermediateFfmpegArgs(plan, outputPath, edit.output.fps), { cwd: frameDir })
  const encodeSec = (Date.now() - encodeStartedAt) / 1000

  // --- verify the encode -------------------------------------------------
  const probed = await probeVideo(outputPath)
  const decoded = await decodedAdjacentDuplicates(outputPath)
  const outProblems = []
  if (probed.codec !== 'h264' || probed.pixFmt !== INTERMEDIATE.pixFmt) outProblems.push(`codec ${probed.codec}/${probed.pixFmt}`)
  if (probed.width !== edit.output.width || probed.height !== edit.output.height) outProblems.push(`size ${probed.width}x${probed.height}`)
  if (probed.fps !== edit.output.fps) outProblems.push(`fps ${probed.fps}`)
  if (probed.frames !== plan.outputFrames || decoded.frames !== plan.outputFrames) {
    outProblems.push(`decoded ${probed.frames}/${decoded.frames} frames, expected ${plan.outputFrames}`)
  }
  if (plan.kind === 'motion' && decoded.adjacentDuplicates !== 0) outProblems.push(`${decoded.adjacentDuplicates} frozen frame(s) after decode`)
  if (outProblems.length > 0) throw new Error(`intermediate rejected: ${outProblems.join('; ')}`)

  // --- contact JPEGs (from the encoded intermediate: what the edit gets) --
  const contactDir = path.join(clipDir, 'contact')
  await mkdir(contactDir, { recursive: true })
  const contactFiles = []
  const labels = ['first', 'middle', 'last']
  const indices = contactFrameIndices(plan.outputFrames)
  for (const [position, index] of indices.entries()) {
    const label = indices.length === 1 ? 'only' : indices.length === 2 && position === 1 ? 'last' : labels[position]
    const file = `${label}-f${String(index).padStart(4, '0')}.jpg`
    await runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-q:v', '2', path.join(contactDir, file)])
    contactFiles.push(file)
  }
  if (contactFiles.length > 1) {
    const inputs = contactFiles.flatMap((file) => ['-i', path.join(contactDir, file)])
    await runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...inputs, '-filter_complex', `hstack=inputs=${contactFiles.length},scale=1920:-2`, '-q:v', '3', path.join(contactDir, 'sheet.jpg')])
  }

  // --- metadata ------------------------------------------------------------
  await copyFile(path.join(jobOutputDir(job), 'render.json'), path.join(clipDir, 'render.json'))
  await copyFile(path.join(jobOutputDir(job), 'capture-health.json'), path.join(clipDir, 'capture-health.json'))
  const timings = health.frameTimings.map((outcome) => outcome.tookMs / 1000)
  const steady = timings.slice(1)
  const record = {
    schema: CLIP_METADATA_SCHEMA,
    status: 'verified',
    gitSha: context.sha,
    worktreeDirty: context.dirty,
    harnessBuildSha256: await distFingerprint(),
    group: context.group,
    workflowRun: process.env.GITHUB_RUN_ID
      ? { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB }
      : null,
    act: clip.act,
    order: job.order,
    clipId: job.jobId,
    shotId: job.shotId,
    profile: job.profile,
    hud: clip.hud,
    framing: clip.framing,
    source: {
      clock: job.source.clock,
      window: job.source,
      speed: clip.speed,
      frames: job.frames,
      width: sizes[0].width,
      height: sizes[0].height,
      lastWidth: sizes[sizes.length - 1].width,
      lastHeight: sizes[sizes.length - 1].height,
      canvasBuffer: health.canvasBuffer,
      crop: clip.crop,
      cropEnd: clip.cropEnd ?? null,
      bytes: sourceBytes,
      sequenceSha256: sha256Text(framesSha256Text),
    },
    dest: { inMs: clip.destInMs, outMs: clip.destOutMs, durationMs: clip.destOutMs - clip.destInMs },
    transitionOut: clip.transitionOut,
    output: {
      file: outputName,
      kind: plan.kind,
      frames: probed.frames,
      width: probed.width,
      height: probed.height,
      fps: probed.fps,
      durationSec: Number((probed.frames / probed.fps).toFixed(6)),
      containerDurationSec: probed.durationSec,
      codec: `${probed.codec} ${probed.profile}`,
      pixFmt: probed.pixFmt,
      colorSpace: probed.colorSpace,
      crf: INTERMEDIATE.crf,
      preset: INTERMEDIATE.preset,
      gop: INTERMEDIATE.gop,
      filter: plan.filter,
      bytes: (await stat(outputPath)).size,
      sha256: await sha256File(outputPath),
      decodedAdjacentDuplicates: decoded.adjacentDuplicates,
    },
    contact: contactFiles.length > 1 ? [...contactFiles, 'sheet.jpg'] : contactFiles,
    browser: { pageErrors: health.pageErrors.length, consoleErrors: health.consoleErrors.length, webgl: health.webgl },
    timing: {
      renderSec: context.renderSec,
      firstFrameSec: timings[0] ?? null,
      steadySecPerFrameAvg: steady.length ? Number((steady.reduce((a, b) => a + b, 0) / steady.length).toFixed(3)) : null,
      steadySecPerFrameMax: steady.length ? Math.max(...steady) : null,
      retriedFrames: health.frameTimings.filter((outcome) => outcome.retried).length,
      encodeSec,
    },
    tools: context.tools,
    verifiedAtIso: new Date().toISOString(),
  }
  await atomicJson(path.join(clipDir, 'clip.json'), record)
  return record
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const git = await gitState()
  if (options.sha !== null && options.sha !== git.head) throw new Error(`HEAD is ${git.head}, expected --sha=${options.sha}`)
  if (options.requireClean && git.dirty) throw new Error('tracked files are modified; refusing to render from a dirty checkout')
  const sha = git.head
  const playwrightVersion = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version
  const tools = { node: process.version, ffmpeg: await toolVersion('ffmpeg', ['-version']), playwright: playwrightVersion }

  const selected = options.clips.map((clipId) => {
    const job = jobs.find((candidate) => candidate.jobId === clipId)
    if (job === undefined) throw new Error(`"${clipId}" is not one of the ${jobs.length} locked timeline shot clips`)
    return job
  })

  await mkdir(options.out, { recursive: true })
  const results = []
  for (const job of selected) {
    const clipDir = path.join(options.out, `${job.jobId}__${job.shotId}`)
    const previous = await resumable(clipDir, sha)
    if (previous !== null) {
      console.log(`[renderGroup] ${job.jobId}: already verified for ${sha.slice(0, 12)} — skipping (resume)`)
      results.push({ clipId: job.jobId, status: 'resumed', outputSha256: previous.output.sha256 })
      continue
    }
    await rm(clipDir, { recursive: true, force: true })
    await mkdir(clipDir, { recursive: true })
    const startedAt = Date.now()
    try {
      if (!options.skipRender) {
        // finalRender.spec.ts caps each clip at a 30-minute test timeout; a
        // long clip (c25: 432 4K frames) on a slow runner can hit it. The
        // renderer is resumable by design — a re-invocation validates what
        // is on disk and renders only missing/corrupt/frozen indices — so a
        // failed attempt is simply continued, up to RENDER_ATTEMPTS times.
        await rm(path.join(jobOutputDir(job), 'browser-errors.jsonl'), { force: true })
        let code = 1
        for (let attempt = 1; attempt <= RENDER_ATTEMPTS && code !== 0; attempt += 1) {
          console.log(`[renderGroup] ${job.jobId} (${job.shotId}): rendering ${job.frames} frame(s), attempt ${attempt}/${RENDER_ATTEMPTS}`)
          code = await renderClip(job.jobId)
        }
        if (code !== 0) throw new Error(`finalRender.mjs exited ${code} after ${RENDER_ATTEMPTS} resumed attempt(s)`)
      }
      const renderSec = (Date.now() - startedAt) / 1000
      const record = await finishClip(job, clipDir, { sha, dirty: git.dirty, group: options.group, renderSec, tools })
      console.log(
        `[renderGroup] ${job.jobId}: verified — ${record.source.frames} src ${record.source.width}x${record.source.height} -> ` +
          `${record.output.frames} @ ${record.output.width}x${record.output.height}/${record.output.fps}fps, ` +
          `${(record.output.bytes / 1e6).toFixed(1)} MB, render ${renderSec.toFixed(0)}s`,
      )
      results.push({ clipId: job.jobId, status: 'verified', outputSha256: record.output.sha256 })
      if (!options.keepFrames) await rm(jobOutputDir(job), { recursive: true, force: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[renderGroup] ${job.jobId}: FAILED — ${message}`)
      for (const name of ['render.json', 'capture-health.json', 'browser-errors.jsonl']) {
        await copyFile(path.join(jobOutputDir(job), name), path.join(clipDir, name)).catch(() => {})
      }
      await atomicJson(path.join(clipDir, 'FAILED.json'), { clipId: job.jobId, gitSha: sha, error: message, atIso: new Date().toISOString() })
      await rm(path.join(clipDir, 'clip.json'), { force: true })
      results.push({ clipId: job.jobId, status: 'failed', error: message })
    }
  }

  const summary = { group: options.group, gitSha: sha, clips: results, tools, finishedAtIso: new Date().toISOString() }
  await atomicJson(path.join(options.out, `group-${options.group}.json`), summary)
  const failed = results.filter((result) => result.status === 'failed')
  console.log(`[renderGroup] ${options.group}: ${results.length - failed.length}/${results.length} clip(s) verified`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
