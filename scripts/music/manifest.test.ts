/**
 * Manifest determinism and portability, provenance carry-forward, MP3
 * delivery settings, and CLI/path safety. No FFmpeg needed.
 *
 *   node --experimental-strip-types --test scripts/music/manifest.test.ts
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CliError, checkWriteTarget, parseCliArgs } from './cliArgs.ts'
import { assertPortableManifest, joinUrl, MANAGED_FILE_PATTERN, manifestHeader, type MusicManifest, serializeManifest, shippedFileName } from './manifest.ts'
import { inspectMp3, mp3EncodeArgs } from './mp3.ts'
import { commitPackage } from './pipeline.ts'
import { checkRenderManifest, summarizeEngines } from './provenance.ts'

const SHA = 'a'.repeat(64)

function sampleManifest(): MusicManifest {
  return { ...manifestHeader({ synthetic: false, ffmpegVersion: '6.1.1', daemonv12: { engineVersion: '0.5.0', commit: null } }), loops: [], stingers: [] }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('manifest header carries the locked package metadata in a fixed key order', () => {
  const manifest = sampleManifest()
  assert.deepEqual(Object.keys(manifest), [
    'schema', 'bpm', 'meter', 'beatsPerBar', 'loopBars', 'loopFrames', 'loopSeconds', 'canonicalSampleRate',
    'guardSeconds', 'guardFrames', 'encoding', 'toolchain', 'daemonv12', 'loops', 'stingers',
  ])
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.bpm, 100)
  assert.equal(manifest.meter, '4/4')
  assert.equal(manifest.loopBars, 16)
  assert.equal(manifest.loopFrames, 1_693_440)
  assert.equal(manifest.loopSeconds, 38.4)
  assert.equal(manifest.guardSeconds, 0.2)
  assert.equal(manifest.canonicalSampleRate, 44_100)
  assert.deepEqual(manifest.encoding, { codec: 'mp3', encoder: 'libmp3lame', bitrateMode: 'cbr', sampleRate: 44_100, stereoBitrateKbps: 160, monoBitrateKbps: 96 })
  assert.equal('synthetic' in manifest, false)
  assert.equal(manifestHeader({ synthetic: true, ffmpegVersion: 'x', daemonv12: { engineVersion: null, commit: null } }).synthetic, true)
})

test('manifest serialization is deterministic: same input, same bytes, no timestamps', () => {
  const a = serializeManifest(sampleManifest())
  const b = serializeManifest(sampleManifest())
  assert.equal(a, b)
  assert.ok(a.endsWith('}\n'))
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}T/)
})

test('portable manifest: host paths are rejected, URLs must sit under the base', () => {
  assertPortableManifest(sampleManifest(), '/music/')
  const leak = (value: unknown) => ({ ...sampleManifest(), toolchain: { ffmpeg: value } }) as unknown as MusicManifest
  assert.throws(() => assertPortableManifest(leak('/workspaces/shootthemoon/capture-final/x.wav'), '/music/'), /host path leaked/)
  assert.throws(() => assertPortableManifest(leak('C:\\renders\\bed.wav'), '/music/'), /host path leaked/)
  const badUrl = { ...sampleManifest(), stingers: [{ url: '/elsewhere/a.mp3' }] } as unknown as MusicManifest
  assert.throws(() => assertPortableManifest(badUrl, '/music/'), /not under \/music\//)
  const traversal = { ...sampleManifest(), stingers: [{ url: '/music/../secret.mp3' }] } as unknown as MusicManifest
  assert.throws(() => assertPortableManifest(traversal, '/music/'), /not under/)
})

test('shipped names are <id>.<sha10>.mp3 and only those match the managed pattern', () => {
  assert.equal(shippedFileName('vesper-arrival', SHA), 'vesper-arrival.aaaaaaaaaa.mp3')
  assert.equal(joinUrl('/music/', 'bed.aaaaaaaaaa.mp3'), '/music/bed.aaaaaaaaaa.mp3')
  assert.equal(joinUrl('/music', 'bed.aaaaaaaaaa.mp3'), '/music/bed.aaaaaaaaaa.mp3')
  assert.throws(() => shippedFileName('bed', 'xyz'))
  assert.ok(MANAGED_FILE_PATTERN.test('bed.0123456789.mp3'))
  assert.ok(MANAGED_FILE_PATTERN.test('territory-claimed.abcdef0123.mp3'))
  for (const name of ['manifest.json', 'bed.mp3', 'bed.0123456789.wav', 'theme.0123456789.mp3', 'README.md', 'bed.0123456789.mp3.bak']) {
    assert.ok(!MANAGED_FILE_PATTERN.test(name), name)
  }
})

test('commitPackage replaces managed files, removes only stale managed files, keeps everything else', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stm-music-commit-'))
  try {
    const output = path.join(root, 'music')
    const staged = path.join(root, 'staged')
    await mkdir(output)
    await mkdir(staged)
    await writeFile(path.join(output, 'bed.0000000000.mp3'), 'stale')
    await writeFile(path.join(output, 'README.md'), 'keep me')
    await writeFile(path.join(output, 'notes.mp3'), 'keep me too')
    await writeFile(path.join(staged, 'bed.mp3'), 'new bed')
    const result = await commitPackage(output, [{ file: 'bed.1111111111.mp3', stagedPath: path.join(staged, 'bed.mp3') }], path.join(output, 'manifest.json'), '{}\n')
    assert.deepEqual(result.removed, ['bed.0000000000.mp3'])
    assert.deepEqual((await readdir(output)).sort(), ['README.md', 'bed.1111111111.mp3', 'manifest.json', 'notes.mp3'])
    assert.equal(await readFile(path.join(output, 'bed.1111111111.mp3'), 'utf8'), 'new bed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

const RENDER_MANIFEST = {
  engine: { name: 'daemonv12', version: '0.5.0' },
  project: { file: '/home/astra/work/stm-loop-bed.json', sha256: 'b'.repeat(64), seed: 42 },
  renderer: { name: 'daemonv12-production', version: '2' },
  gmRenderer: { name: 'fluidsynth', version: '2.3.7' },
  soundfont: { file: 'FluidR3_GM.sf2', sha256: 'c'.repeat(64) },
  audioTool: { name: 'ffmpeg', version: '6.1.1' },
  timeline: { duration: { bars: 48 }, tail: 'none' },
  mix: { clippedSamples: 0 },
  wav: { sha256: SHA, frames: 5_080_320, sampleRate: 44_100, channels: 2, bitsPerSample: 16 },
}
const CONTEXT = { fileName: 'stm-loop-bed.render.json', manifestSha256: 'd'.repeat(64), wavSha256: SHA, expectedFrames: 5_080_320, expectedBars: 48, sampleRate: 44_100, channels: 2 }

test('provenance carries forward recorded fields only, as portable file names', () => {
  const check = checkRenderManifest(RENDER_MANIFEST, CONTEXT)
  assert.deepEqual(check.failures, [])
  assert.equal(check.provenance.engine.version, '0.5.0')
  assert.equal(check.provenance.engine.commit, null) // not recorded → not invented
  assert.equal(check.provenance.project.file, 'stm-loop-bed.json')
  assert.equal(check.provenance.soundfont.sha256, 'c'.repeat(64))
  assert.equal(check.provenance.gmRenderer.version, '2.3.7')
  const sparse = checkRenderManifest({ wav: { sha256: SHA } }, CONTEXT)
  assert.equal(sparse.provenance.engine.version, null)
  assert.equal(sparse.provenance.soundfont.file, null)
  assert.ok(sparse.warnings.length > 0)
})

test('provenance rejects hash mismatches, wrong engines and wrong render settings', () => {
  const failuresOf = (patch: object) => checkRenderManifest({ ...RENDER_MANIFEST, ...patch }, CONTEXT).failures.join('\n')
  assert.match(failuresOf({ wav: { ...RENDER_MANIFEST.wav, sha256: 'e'.repeat(64) } }), /does not match the canonical WAV/)
  assert.match(failuresOf({ engine: { name: 'daemonv12', version: '0.4.2' } }), /not V0\.5/)
  assert.match(failuresOf({ timeline: { duration: { bars: 16 }, tail: 'none' } }), /timeline\.duration\.bars is 16/)
  assert.match(failuresOf({ timeline: { duration: { bars: 48 }, tail: 'reverb' } }), /timeline\.tail/)
  assert.match(failuresOf({ wav: { ...RENDER_MANIFEST.wav, sampleRate: 48_000 } }), /wav\.sampleRate is 48000/)
})

test('package DaemonV12 identity is recorded only when every render agrees', () => {
  const one = checkRenderManifest(RENDER_MANIFEST, CONTEXT).provenance
  const other = checkRenderManifest({ ...RENDER_MANIFEST, engine: { name: 'daemonv12', version: '0.5.1' } }, CONTEXT).provenance
  assert.deepEqual(summarizeEngines([one, one]), { engineVersion: '0.5.0', commit: null })
  assert.deepEqual(summarizeEngines([one, other]), { engineVersion: null, commit: null })
  assert.deepEqual(summarizeEngines([one, null]), { engineVersion: null, commit: null })
})

// ---------------------------------------------------------------------------
// MP3 delivery
// ---------------------------------------------------------------------------

test('MP3 encode command is the handoff command: libmp3lame CBR, 44.1 kHz, 160k stereo / 96k mono', () => {
  assert.deepEqual(mp3EncodeArgs('in.wav', 'out.mp3', { channels: 2, bitrateKbps: 160, sampleRate: 44_100 }), [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', 'in.wav', '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-ar', '44100', '-ac', '2', '-b:a', '160k', 'out.mp3',
  ])
  const mono = mp3EncodeArgs('in.wav', 'out.mp3', { channels: 1, bitrateKbps: 96, sampleRate: 44_100 })
  assert.deepEqual(mono.slice(mono.indexOf('-ac'), mono.indexOf('-ac') + 4), ['-ac', '1', '-b:a', '96k'])
  assert.ok(!mono.includes('-q:a') && !mono.includes('-abr'), 'no VBR/ABR switches')
})

/** Synthetic MPEG-1 Layer III stream: `count` frames at a bitrate index (no audio payload needed). */
function fakeMp3(bitrateIndexes: number[], mono = false, tag: string | null = 'Info'): Buffer {
  const frames = bitrateIndexes.map((index, i) => {
    const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][index] as number
    const length = Math.floor((144_000 * kbps) / 44_100)
    const frame = Buffer.alloc(length)
    frame.writeUInt32BE((0xfffb0000 | (index << 12) | (mono ? 0xc0 : 0)) >>> 0, 0)
    if (i === 0 && tag) frame.write(tag, 4 + (mono ? 17 : 32), 'latin1')
    return frame
  })
  const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0])
  return Buffer.concat([id3, ...frames])
}

test('MP3 inspection proves CBR, sample rate and channel mode from every frame header', () => {
  const stereo = inspectMp3(fakeMp3([10, 10, 10, 10]))
  assert.deepEqual(stereo, { frames: 4, sampleRate: 44_100, channels: 2, bitrates: [160], constantBitrate: true, infoTag: 'Info' })
  const mono = inspectMp3(fakeMp3([7, 7, 7], true))
  assert.equal(mono.channels, 1)
  assert.deepEqual(mono.bitrates, [96])
  const vbr = inspectMp3(fakeMp3([10, 9, 11], false, 'Xing'))
  assert.equal(vbr.constantBitrate, false)
  assert.equal(vbr.infoTag, 'Xing')
  assert.throws(() => inspectMp3(Buffer.concat([fakeMp3([10]), Buffer.from([1, 2, 3, 4, 5])])), /lost MPEG frame sync/)
})

// ---------------------------------------------------------------------------
// CLI and output-path safety
// ---------------------------------------------------------------------------

test('CLI parses explicit input/output and rejects ambiguity', () => {
  const options = parseCliArgs(['build', '--input', 'capture-final/game-audio/canonical', '--output=public/music'])
  assert.equal(options.command, 'build')
  assert.equal(options.input, 'capture-final/game-audio/canonical')
  assert.equal(options.output, 'public/music')
  assert.equal(options.urlBase, '/music/')
  assert.equal(options.manifest, null)
  assert.throws(() => parseCliArgs(['build', '--input', 'a']), /needs --output/)
  assert.throws(() => parseCliArgs(['validate']), /needs --input/)
  assert.throws(() => parseCliArgs(['build', '--input', 'a', '--input', 'b', '--output', 'c']), /more than once/)
  assert.throws(() => parseCliArgs(['validate', '--input', 'a', '--output', 'b']), /not valid for validate/)
  assert.throws(() => parseCliArgs(['build', '--input', 'a', '--output', 'b', '--normalize']), /unknown option/)
  assert.throws(() => parseCliArgs(['publish']), /unknown command/)
  assert.throws(() => parseCliArgs(['build', '--input', 'a', '--output', 'b', '--url-base', 'https://cdn/x/']), /root-relative/)
  assert.throws(() => parseCliArgs(['build', '--input', 'a', '--output', 'b', '--manifest', 'm.txt']), /\.json/)
  assert.throws(() => parseCliArgs([]), CliError)
})

test('write targets: never root, home, repo root, the input tree, or public/ for synthetic packages', () => {
  const context = { repoRoot: '/repo', homeDir: '/home/dev', input: '/repo/capture-final/game-audio/canonical', synthetic: false }
  checkWriteTarget('/repo/public/music', 'output', context)
  checkWriteTarget('/tmp/out', 'output', context)
  assert.throws(() => checkWriteTarget('/', 'output', context), /filesystem root/)
  assert.throws(() => checkWriteTarget('/home/dev', 'output', context), /home directory/)
  assert.throws(() => checkWriteTarget('/repo', 'output', context), /repository root/)
  assert.throws(() => checkWriteTarget('/repo/capture-final/game-audio/canonical/out', 'output', context), /inside the canonical input/)
  assert.throws(() => checkWriteTarget('/repo/capture-final', 'output', context), /contains the canonical input/)
  assert.throws(() => checkWriteTarget('/repo/public/music', 'output', { ...context, synthetic: true }), /into public\/: only real, verified shipped music/)
  checkWriteTarget('/repo/capture-final/game-audio/synthetic-build', 'output', { ...context, synthetic: true })
})
