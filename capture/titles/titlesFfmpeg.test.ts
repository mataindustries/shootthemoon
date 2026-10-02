/** Decoded endpoint regression: requires the same ffmpeg used by assembly. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { platePushFilter, type Cues } from './titles.ts'

const cues = JSON.parse(readFileSync(new URL('./reel-titles.cues.json', import.meta.url), 'utf8')) as Cues

test('all six decoded pushes start and stop at the specified scales', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reel-push-endpoints-'))
  try {
    const width = 384
    const height = 216
    // Static high-frequency plate makes a one-frame scale error observable.
    const pixels = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3
      pixels[offset] = (x * 17 + y * 7) % 256
      pixels[offset + 1] = (x * 3 + y * 19) % 256
      pixels[offset + 2] = (x * 11 + y * 13) % 256
    }
    const input = path.join(dir, 'plate.ppm')
    writeFileSync(input, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]))
    const decode = (filter: string, frames: number) => {
      const result = spawnSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1',
        '-loop', '1', '-framerate', '60', '-i', input, '-vf', filter,
        '-frames:v', String(frames), '-fps_mode', 'passthrough', '-pix_fmt', 'yuv444p', '-f', 'rawvideo', '-'],
      { maxBuffer: width * height * 3 * frames + 1024 * 1024 })
      assert.equal(result.status, 0, result.stderr.toString())
      assert.equal(result.stdout.length, width * height * 3 * frames)
      return result.stdout
    }
    for (const original of cues.plateMoves) {
      const move = { ...original, anchor: [original.anchor[0] * width / cues.source.width,
        original.anchor[1] * height / cues.source.height] as const }
      const frames = move.to - move.from + 1
      const actual = decode(platePushFilter(move, width, height), frames)
      for (const [frame, scale] of [[0, move.scale[0]], [frames - 1, move.scale[1]]] as const) {
        const expected = decode(platePushFilter({ ...move, scale: [scale, scale] }, width, height), 1)
        const size = width * height * 3
        assert.ok(actual.subarray(frame * size, (frame + 1) * size).equals(expected), `${move.id} endpoint ${frame}`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
