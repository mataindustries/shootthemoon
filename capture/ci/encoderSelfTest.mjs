#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Encoder self-test: runs the exact intermediate ffmpeg path (reelCi.ts's
 * planIntermediate + intermediateFfmpegArgs) on small synthetic PNG inputs
 * shaped like the real clips, and checks what comes out — so a broken
 * ffmpeg build, colour-matrix mistake, crop-push error or frame-count drift
 * fails the Actions job in seconds, before hours of rendering.
 *
 * Cases (each against the real locked clip's crop/framing, with its
 * destination shortened to 12 frames):
 *   motion        c07  3840x2160 sequence            -> 1920x1080, exact count
 *   motion-crop   c01  3840x2160 -> 3200x1800 sizes   -> scaler re-inits, exact count
 *   still         c05  1920x1080 held                 -> N identical frames
 *   still-push    c21  2880x1620 still, crop push     -> first=whole crop, last=cropEnd
 *   portrait      c14  1170x2532 pillarboxed          -> ~499px image, black bars
 * Plus a BT.709 colour round-trip on a known sRGB value.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { buildFinalRenderJobs } from '../finalRender/plan.ts'
import { SHOTS } from '../manifest.ts'
import { expectedSourceFrameSize, intermediateFfmpegArgs, planIntermediate, timelineJobs } from './reelCi.ts'
import { probeVideo, runOrThrow } from './io.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FRAMES = 12

function png(width, height, pixel) {
  const row = Buffer.alloc(1 + width * 3)
  const raw = Buffer.alloc((1 + width * 3) * height)
  for (let y = 0; y < height; y += 1) {
    row[0] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      row[1 + x * 3] = r
      row[2 + x * 3] = g
      row[3 + x * 3] = b
    }
    row.copy(raw, y * row.length)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function frameRgb(video, index) {
  const { stdout } = await runOrThrow('sh', [
    '-c',
    `ffmpeg -hide_banner -nostdin -loglevel error -i "${video}" -vf "select=eq(n\\,${index}),scale=in_color_matrix=bt709:in_range=tv,format=rgb24" -frames:v 1 -f rawvideo - | base64 -w0`,
  ])
  return Buffer.from(stdout, 'base64')
}

function pixelAt(buffer, x, y, width = 1920) {
  const offset = (y * width + x) * 3
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]]
}

const near = (a, b, tolerance) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance)

const edit = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/finalEdit.json'), 'utf8'))
const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const realJobs = timelineJobs(edit, buildFinalRenderJobs(edit, shotIndex))

/** The locked edit with `clipId`'s destination shortened to FRAMES frames. */
function shortened(clipId) {
  const durationMs = (FRAMES / edit.output.fps) * 1000
  const timeline = edit.timeline.map((item) => (item.id === clipId ? { ...item, destOutMs: item.destInMs + durationMs } : item))
  const baseJob = realJobs.find((job) => job.jobId === clipId)
  const job = { ...baseJob, frames: baseJob.source.clock === 'still' ? 1 : FRAMES }
  return { edit: { ...edit, timeline }, job }
}

async function encodeCase(workDir, clipId, pixel) {
  const { edit: shortEdit, job } = shortened(clipId)
  const frameDir = path.join(workDir, clipId)
  await mkdir(frameDir, { recursive: true })
  for (let index = 0; index < job.frames; index += 1) {
    const size = expectedSourceFrameSize(job, index)
    await writeFile(path.join(frameDir, `${String(index).padStart(6, '0')}.png`), png(Math.round(size.width), Math.round(size.height), pixel))
  }
  const plan = planIntermediate(shortEdit, job)
  const out = path.join(workDir, `${clipId}.mp4`)
  await runOrThrow('ffmpeg', intermediateFfmpegArgs(plan, out, edit.output.fps), { cwd: frameDir })
  const probed = await probeVideo(out)
  const problems = []
  if (probed.frames !== FRAMES) problems.push(`${probed.frames} frames, expected ${FRAMES}`)
  if (probed.width !== 1920 || probed.height !== 1080) problems.push(`${probed.width}x${probed.height}`)
  if (probed.fps !== 60) problems.push(`${probed.fps} fps`)
  if (probed.pixFmt !== 'yuv444p' || probed.colorSpace !== 'bt709') problems.push(`${probed.pixFmt}/${probed.colorSpace}`)
  return { out, plan, problems }
}

async function main() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'reel-encoder-selftest-'))
  const failures = []
  const check = (name, problems) => {
    console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  ${name}${problems.length ? ` — ${problems.join('; ')}` : ''}`)
    if (problems.length) failures.push(name)
  }
  try {
    const SRGB = [200, 40, 40]
    const motion = await encodeCase(workDir, 'c07', () => SRGB)
    const colour = pixelAt(await frameRgb(motion.out, 5), 960, 540)
    check(`motion c07 (${motion.plan.kind})`, [...motion.problems, ...(near(colour, SRGB, 3) ? [] : [`BT.709 round-trip ${colour} != ${SRGB}`])])

    const moving = await encodeCase(workDir, 'c01', (x, y) => ((x >> 6) + (y >> 6)) % 2 ? [255, 255, 255] : [0, 0, 0])
    check(`motion-crop c01 (${moving.plan.kind}, variable PNG sizes)`, moving.problems)

    const still = await encodeCase(workDir, 'c05', () => [30, 120, 220])
    check(`still c05 (${still.plan.kind})`, [...still.problems, ...(still.plan.kind === 'still' ? [] : [`kind ${still.plan.kind}`])])

    // c21: captured at crop (480,540 2880x1620); cropEnd (960,1080 1920x1080)
    // sits at (480,540) inside it. Paint that region red, the rest blue.
    const push = await encodeCase(workDir, 'c21', (x, y) => (x >= 480 && x < 2400 && y >= 540 && y < 1620 ? [220, 20, 20] : [20, 20, 220]))
    const firstFrame = await frameRgb(push.out, 0)
    const lastFrame = await frameRgb(push.out, FRAMES - 1)
    const pushProblems = [...push.problems]
    if (push.plan.kind !== 'still-push') pushProblems.push(`kind ${push.plan.kind}`)
    // First frame shows the whole 2880 crop: red box at 320..1600 x 360..1080.
    if (!near(pixelAt(firstFrame, 100, 100), [20, 20, 220], 12)) pushProblems.push('first frame corner is not the blue surround')
    if (!near(pixelAt(firstFrame, 960, 700), [220, 20, 20], 12)) pushProblems.push('first frame centre is not red')
    // Last frame is exactly the cropEnd region: red edge to edge.
    for (const [x, y] of [[4, 4], [1915, 4], [4, 1075], [1915, 1075], [960, 540]]) {
      if (!near(pixelAt(lastFrame, x, y), [220, 20, 20], 12)) pushProblems.push(`last frame (${x},${y}) not red: ${pixelAt(lastFrame, x, y)}`)
    }
    check('still-push c21 (crop -> cropEnd)', pushProblems)

    const portrait = await encodeCase(workDir, 'c14', () => [255, 255, 255])
    const portraitFrame = await frameRgb(portrait.out, 0)
    const portraitProblems = [...portrait.problems]
    if (!near(pixelAt(portraitFrame, 960, 540), [255, 255, 255], 3)) portraitProblems.push('centre not image')
    if (!near(pixelAt(portraitFrame, 100, 540), [0, 0, 0], 3)) portraitProblems.push('left bar not black')
    if (!near(pixelAt(portraitFrame, 1820, 540), [0, 0, 0], 3)) portraitProblems.push('right bar not black')
    if (!near(pixelAt(portraitFrame, 960 - 245, 540), [255, 255, 255], 3) || !near(pixelAt(portraitFrame, 960 - 255, 540), [0, 0, 0], 3)) {
      portraitProblems.push('pillarbox image is not ~499px wide')
    }
    check(`portrait c14 (${portrait.plan.kind})`, portraitProblems)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
  if (failures.length > 0) {
    console.error(`encoder self-test FAILED: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('encoder self-test passed')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
