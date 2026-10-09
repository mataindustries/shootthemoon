/**
 * End-to-end pipeline runs on synthetic canonical packages of the exact
 * contract lengths, generated into temporary directories (nothing is
 * committed, nothing touches public/). Needs FFmpeg with libmp3lame; skipped
 * when FFmpeg is missing. Takes a few minutes: the full build runs the
 * complete measured combination audit.
 *
 *   node --experimental-strip-types --test scripts/music/pipeline.test.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { probeAudio } from './ffmpeg.ts'
import { type FixtureMutation, writeSyntheticPackage } from './fixtures.ts'
import type { MusicManifest } from './manifest.ts'
import { FRAMES_PER_BAR, GUARDED_LOOP_FRAMES, LOOP_FRAMES, LOOP_SPECS, STINGER_SPECS, STINGER_TAIL_FRAMES } from './musicSpec.ts'
import { type PipelineOptions, runPipeline } from './pipeline.ts'
import type { Pcm16 } from './wav.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HAS_FFMPEG = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libmp3lame') ?? false
const SKIP = HAS_FFMPEG ? false : 'FFmpeg with libmp3lame is not installed'
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

let root = ''

function options(overrides: Partial<PipelineOptions> & Pick<PipelineOptions, 'mode' | 'input'>): PipelineOptions {
  return {
    output: null,
    manifest: null,
    archive: null,
    report: null,
    urlBase: '/music/',
    allowSynthetic: true,
    requireProvenance: false,
    concurrency: 4,
    combinationAudit: true,
    repoRoot: REPO_ROOT,
    log: () => {},
    ...overrides,
  }
}

/** Copy with the frames [from, to) of every cycle replaced by fn(frame-in-cycle, channel). */
function stamp(audio: Pcm16, from: number, to: number, fn: (position: number, channel: number) => number): Pcm16 {
  const samples = audio.samples.slice()
  for (let cycle = 0; cycle * LOOP_FRAMES < audio.frames; cycle++) {
    for (let position = from; position < to; position++) {
      const frame = cycle * LOOP_FRAMES + position
      for (let channel = 0; channel < 2; channel++) samples[2 * frame + channel] = fn(position, channel)
    }
  }
  return { ...audio, samples }
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'stm-music-pipeline-'))
})

after(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('synthetic package build', { skip: SKIP }, () => {
  let input = ''
  let output = ''
  let first: Awaited<ReturnType<typeof runPipeline>> | null = null

  before(async () => {
    input = path.join(root, 'good', 'canonical')
    output = path.join(root, 'good', 'public-music')
    await writeSyntheticPackage(input)
    // One genuine-looking render manifest: provenance must be carried forward for bed only.
    const bed = await readFile(path.join(input, 'stm-loop-bed.wav'))
    await writeFile(
      path.join(input, 'stm-loop-bed.render.json'),
      JSON.stringify({
        engine: { name: 'daemonv12', version: '0.5.0' },
        project: { file: 'stm-loop-bed.json', sha256: 'b'.repeat(64), seed: 7 },
        soundfont: { file: 'FluidR3_GM.sf2', sha256: 'c'.repeat(64) },
        timeline: { duration: { bars: 48 }, tail: 'none' },
        wav: { sha256: sha256(bed), frames: 5_080_320, sampleRate: 44_100, channels: 2, bitsPerSample: 16 },
      }),
    )
    first = await runPipeline(options({ mode: 'build', input, output, archive: path.join(root, 'good', 'archive'), report: path.join(root, 'good', 'report.json') }))
  })

  test('build passes every gate and writes exactly twelve MP3s plus the manifest', async () => {
    assert.deepEqual(first?.failures, [])
    assert.equal(first?.ok, true)
    const files = (await readdir(output)).sort()
    assert.equal(files.length, 13)
    assert.ok(files.includes('manifest.json'))
    for (const spec of [...LOOP_SPECS, ...STINGER_SPECS]) assert.ok(files.some((name) => new RegExp(`^${spec.id}\\.[0-9a-f]{10}\\.mp3$`).test(name)), spec.id)
  })

  test('manifest: guarded loops of 1,711,080 frames looping [0.2 s, 38.6 s), stingers with sync metadata', async () => {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as MusicManifest
    assert.equal(manifest.synthetic, true)
    assert.deepEqual(manifest.loops.map((loop) => loop.id), ['bed', 'engine', 'pressure', 'assault', 'claim'])
    assert.deepEqual(manifest.stingers.map((stinger) => stinger.id), STINGER_SPECS.map((spec) => spec.id))
    for (const loop of manifest.loops) {
      const spec = LOOP_SPECS.find((candidate) => candidate.id === loop.id)!
      assert.equal(loop.frames, GUARDED_LOOP_FRAMES)
      assert.equal(loop.durationSeconds, 38.8)
      assert.equal(loop.loopStartSeconds, 0.2)
      assert.equal(loop.loopEndSeconds, 38.6)
      assert.equal(loop.contentStartSeconds, 0.2)
      assert.equal(loop.contentEndSeconds, 38.6)
      assert.equal(loop.guard, 'neighbor-cycle')
      assert.equal(loop.channels, spec.channels)
      assert.equal(loop.bitrateKbps, spec.channels === 2 ? 160 : 96)
      assert.equal(loop.canonical.frames, LOOP_FRAMES)
      assert.equal(loop.canonical.cycleStartFrame, 1_693_440)
      assert.equal(loop.canonical.sourceFrames, 5_080_320)
      assert.deepEqual(loop.periodicity, { maxAbsDeltaLsb: 0, preGuardMaxAbsDeltaLsb: 0, identical: true })
      assert.ok(Math.abs((loop.unity.integratedLufs as number) - spec.unityLufs) <= 1, loop.id)
      assert.ok((loop.unity.truePeakDbtp as number) <= spec.truePeakCeilingDbtp, loop.id)
      assert.ok(loop.decodedFrames >= GUARDED_LOOP_FRAMES && loop.decodedFrames <= GUARDED_LOOP_FRAMES + 3_000, loop.id)
      // Mono files are measured as heard (dual-mono), so they match the canonical crop.
      assert.ok(Math.abs((loop.integratedLufs as number) - (loop.unity.integratedLufs as number)) <= 0.5, `${loop.id} shipped loudness`)
      assert.equal(loop.foldDown === null, spec.channels === 2)
      assert.equal(loop.url, `/music/${loop.file}`)
    }
    const firstStrike = manifest.stingers.find((stinger) => stinger.id === 'first-strike')!
    assert.equal(firstStrike.syncSeconds, 4.6)
    assert.equal(firstStrike.syncFrames, 202_860)
    assert.equal(firstStrike.contentFrames, 529_200)
    assert.equal(firstStrike.frames, 529_200 + 2 * 8_820)
    assert.equal(firstStrike.guard, 'zero')
    assert.deepEqual(firstStrike.duck, { kind: 'vacuum', leadSeconds: 0.6, rampSeconds: 0.04 })
    const divider = manifest.stingers.find((stinger) => stinger.id === 'divider-contact')!
    assert.deepEqual(divider.waveGainDb, [0, 1, 2])
    assert.deepEqual(divider.duck, { kind: 'duck', gainDb: -4, bars: 1, fadeSeconds: 0.4 })
    assert.equal(divider.priority, 50)
    // Provenance: carried for bed only; package identity stays null because the others have none.
    assert.equal(manifest.loops[0]?.provenance?.engine.version, '0.5.0')
    assert.equal(manifest.loops[0]?.provenance?.project.file, 'stm-loop-bed.json')
    assert.equal(manifest.loops[1]?.provenance, null)
    assert.deepEqual(manifest.daemonv12, { engineVersion: null, commit: null })
  })

  test('manifest contains no host paths', async () => {
    const text = await readFile(path.join(output, 'manifest.json'), 'utf8')
    assert.ok(!text.includes(root), 'temporary directory leaked')
    assert.ok(!text.includes(REPO_ROOT), 'repository path leaked')
  })

  test('shipped MP3s are CBR 44.1 kHz at 160 kbps stereo / 96 kbps mono, and hashes match the manifest', async () => {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as MusicManifest
    for (const entry of [...manifest.loops, ...manifest.stingers]) {
      const bytes = await readFile(path.join(output, entry.file))
      assert.equal(sha256(bytes), entry.sha256, entry.id)
      assert.equal(entry.file, `${entry.id}.${entry.sha256.slice(0, 10)}.mp3`)
      const probe = await probeAudio(path.join(output, entry.file))
      assert.deepEqual([probe.codec, probe.sampleRate, probe.channels, probe.bitRate], ['mp3', 44_100, entry.channels, entry.channels === 2 ? 160_000 : 96_000], entry.id)
    }
  })

  test('archived crops are the canonical cycle-2 loops named by the manifest hash', async () => {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as MusicManifest
    for (const loop of manifest.loops) {
      const archived = await readFile(path.join(root, 'good', 'archive', `${loop.id}.loop.wav`))
      assert.equal(sha256(archived), loop.canonical.loopWavSha256, loop.id)
      assert.equal(archived.length, 44 + LOOP_FRAMES * 2 * 2)
    }
  })

  test('report records periodicity, combination audit and arithmetic bounds separately', async () => {
    const report = JSON.parse(await readFile(path.join(root, 'good', 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.loops.bed.periodicity.identical, true)
    const audit = report.combinationAudit
    assert.equal(audit.ceilingDbtp, -2)
    assert.equal(audit.worstLayerMix.id, 'CS_COMBAT')
    assert.equal(audit.layerMixes.length, 48)
    assert.ok(audit.stingerPairs.length > 50)
    const combat = audit.layerMixes.find((entry: { id: string }) => entry.id === 'CS_COMBAT')
    assert.equal(combat.arithmeticCeilingBoundDbfs, -1.4)
    assert.ok(combat.truePeakDbtp < combat.arithmeticMeasuredBoundDbfs + 0.5)
  })

  test('rerun is deterministic: identical manifest bytes and MP3s; stale managed files go, others stay', async () => {
    const before = await readFile(path.join(output, 'manifest.json'))
    await writeFile(path.join(output, 'bed.0000000000.mp3'), 'stale')
    await writeFile(path.join(output, 'README.md'), 'unrelated')
    const rerun = await runPipeline(options({ mode: 'build', input, output, combinationAudit: false }))
    assert.equal(rerun.ok, true)
    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), before)
    const files = await readdir(output)
    assert.ok(!files.includes('bed.0000000000.mp3'))
    assert.ok(files.includes('README.md'))
    assert.equal(files.filter((name) => name.endsWith('.mp3')).length, 12)
  })

  test('auditions A–E are written as local review WAVs with measurements', async () => {
    const auditions = path.join(root, 'good', 'auditions')
    const result = await runPipeline(options({ mode: 'auditions', input, output: auditions }))
    assert.equal(result.ok, true)
    const summary = JSON.parse(await readFile(path.join(auditions, 'auditions.json'), 'utf8'))
    assert.deepEqual(summary.auditions.map((entry: { id: string }) => entry.id), ['A', 'B', 'C', 'D', 'E'])
    for (const entry of summary.auditions) {
      assert.equal(entry.clipping, false)
      assert.equal(entry.seconds, 76.8)
      assert.ok(existsSync(path.join(auditions, `${entry.id}-${entry.name}.wav`)))
    }
    // Uncorrelated fixture tones at unity reproduce the bible's ≈ LUFS column.
    assert.equal(summary.auditions[0].integratedLufs, -29)
    assert.equal(summary.auditions[3].integratedLufs, -18.8)
  })
})

describe('safety', { skip: SKIP }, () => {
  test('a synthetic package is refused without allowSynthetic, and never written into public/', async () => {
    const input = path.join(root, 'safety', 'canonical')
    await writeSyntheticPackage(input)
    await assert.rejects(runPipeline(options({ mode: 'validate', input, allowSynthetic: false })), /synthetic fixture package/)
    const target = path.join(REPO_ROOT, 'public', 'music-synthetic-test')
    await assert.rejects(runPipeline(options({ mode: 'build', input, output: target })), /into public\/: only real, verified shipped music/)
    assert.equal(existsSync(target), false)
    await assert.rejects(runPipeline(options({ mode: 'auditions', input, output: path.join(REPO_ROOT, 'public', 'auditions-test') })), /public\//)
    await assert.rejects(runPipeline(options({ mode: 'build', input, output: path.join(input, 'out') })), /inside the canonical input/)
  })

  test('a missing input directory and missing renders fail loudly', async () => {
    await assert.rejects(runPipeline(options({ mode: 'validate', input: path.join(root, 'nope') })), /not a directory/)
    const input = path.join(root, 'partial')
    await mkdir(input, { recursive: true })
    const result = await runPipeline(options({ mode: 'validate', input }))
    assert.equal(result.ok, false)
    assert.equal(result.failures.filter((failure) => /missing canonical render/.test(failure)).length, 12)
  })
})

describe('invalid canonical renders', { skip: SKIP }, () => {
  let result: Awaited<ReturnType<typeof runPipeline>> | null = null
  let output = ''
  const failure = (pattern: RegExp) => result?.failures.find((entry) => pattern.test(entry))

  before(async () => {
    const input = path.join(root, 'bad', 'canonical')
    output = path.join(root, 'bad', 'out')
    await mkdir(output, { recursive: true })
    await writeFile(path.join(output, 'sentinel.txt'), 'untouched')
    const mutate: FixtureMutation = (id, audio) => {
      switch (id) {
        case 'bed': // one frame short
          return { ...audio, frames: audio.frames - 1, samples: audio.samples.slice(0, -2) }
        case 'engine': // inverted right channel: L/R correlation −1
          return stamp(audio, 0, LOOP_FRAMES, (position, channel) => {
            const value = audio.samples[2 * position] as number
            return channel === 0 ? value : -value
          })
        case 'pressure': {
          // Cycle 3 differs by 50 LSB in bar 7: state that never settles.
          const samples = audio.samples.slice()
          const frame = 2 * LOOP_FRAMES + 6 * FRAMES_PER_BAR + 1_000
          samples[2 * frame] = (samples[2 * frame] as number) + 50
          return { ...audio, samples }
        }
        case 'assault': // header claims 48 kHz
          return { ...audio, sampleRate: 48_000 }
        case 'claim': // 6 dB too quiet: −29 LUFS against −23 ± 1
          return { ...audio, samples: audio.samples.map((value) => Math.round(value / 2)) }
        case 'first-strike': {
          // One bar too long.
          const samples = new Int16Array(audio.samples.length + FRAMES_PER_BAR * 2)
          samples.set(audio.samples)
          return { ...audio, frames: audio.frames + FRAMES_PER_BAR, samples }
        }
        case 'outcome-hold': {
          // Ringing tail: −40 dBFS in the last 100 ms.
          const samples = audio.samples.slice()
          for (let i = samples.length - STINGER_TAIL_FRAMES * 2; i < samples.length; i++) samples[i] = i % 4 < 2 ? 328 : -328
          return { ...audio, samples }
        }
        case 'divider-contact': {
          // Peak at −6 dBFS against a −11 dBTP ceiling.
          const samples = audio.samples.slice()
          samples[2000] = 16_422
          samples[2001] = 16_422
          return { ...audio, samples }
        }
        default:
          return audio
      }
    }
    await writeSyntheticPackage(input, mutate)
    await writeFile(path.join(input, 'stm-sting-vesper-arrival.render.json'), JSON.stringify({ engine: { name: 'daemonv12', version: '0.5.0' }, wav: { sha256: 'f'.repeat(64) } }))
    result = await runPipeline(options({ mode: 'build', input, output, report: path.join(root, 'bad', 'report.json') }))
  })

  test('the build fails and leaves the output directory untouched', async () => {
    assert.equal(result?.ok, false)
    assert.deepEqual(await readdir(output), ['sentinel.txt'])
    const report = JSON.parse(await readFile(path.join(root, 'bad', 'report.json'), 'utf8'))
    assert.equal(report.combinationAudit, 'skipped: source verification failed')
  })

  test('wrong duration is rejected, never padded or truncated', () => {
    assert.match(failure(/^bed/) ?? '', /5,080,319 frames .* expected exactly 5,080,320 .*never padded or truncated/)
  })

  test('wrong sample rate is rejected', () => {
    assert.match(failure(/^assault/) ?? '', /48000 Hz, expected 44100 Hz/)
  })

  test('known periodicity failure names the bar, frame and magnitude', () => {
    const message = failure(/^pressure: NOT PERIODIC/) ?? ''
    assert.match(message, /max \|Δ\| 50 LSB/)
    assert.match(message, /bar 7 beat 1 \+1000 frames/)
    assert.match(message, /source frame 2,?\d*/)
    assert.match(message, /bars over tolerance \(bar:Δ\) 7:50/)
    assert.match(message, /no crossfade is applied/)
  })

  test('mono fold-down refuses decorrelated layers', () => {
    assert.match(failure(/^engine: L\/R correlation/) ?? '', /correlation -1 is below 0\.9/)
  })

  test('loudness outside the locked target fails without normalizing', () => {
    assert.match(failure(/^claim: integrated loudness/) ?? '', /-29 LUFS is outside -23 ± 1 LUFS \(not normalized/)
  })

  test('stinger length, tail and true-peak contracts are enforced', () => {
    assert.match(failure(/^first-strike/) ?? '', /635,040 frames .* expected exactly 529,200/)
    assert.match(failure(/^outcome-hold: last 100 ms RMS/) ?? '', /-39\.99 dBFS, above -60 dBFS/)
    assert.match(failure(/^divider-contact: true peak/) ?? '', /exceeds the -11 dBTP ceiling/)
  })

  test('a render manifest whose hash does not match the WAV is rejected', () => {
    assert.match(failure(/^vesper-arrival: .*render\.json/) ?? '', /does not match the canonical WAV/)
  })

  test('valid assets in the same package still pass', () => {
    for (const id of ['vesper-retaliation', 'outcome-breach', 'territory-claimed']) assert.equal(failure(new RegExp(`^${id}`)), undefined, id)
  })
})

describe('measured combination audit', { skip: SKIP }, () => {
  test('coincident peaks that each pass their own ceiling fail the summed −2 dBTP gate', async () => {
    const input = path.join(root, 'audit', 'canonical')
    // A 10 ms 1 kHz burst at bar 5, in phase in every layer, 0.3 dB under each layer's ceiling:
    // CS_COMBAT sums them to ≈ −1.7 dBTP although every layer passes alone.
    const mutate: FixtureMutation = (id, audio) => {
      const spec = LOOP_SPECS.find((candidate) => candidate.id === id)
      if (!spec) return audio
      const amplitude = 10 ** ((spec.truePeakCeilingDbtp - 0.3) / 20)
      const start = 4 * FRAMES_PER_BAR
      return stamp(audio, start, start + 441, (position) => {
        const i = position - start
        return Math.round(32768 * amplitude * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 440)) * Math.sin((2 * Math.PI * 1_000 * i) / 44_100 + Math.PI / 2))
      })
    }
    await writeSyntheticPackage(input, mutate)
    const result = await runPipeline(options({ mode: 'validate', input }))
    assert.equal(result.ok, false)
    for (const spec of LOOP_SPECS) assert.ok(!result.failures.some((entry) => entry.startsWith(`${spec.id}:`)), `${spec.id} passes on its own`)
    assert.ok(result.failures.some((entry) => /^combination CS_COMBAT: measured true peak -1\.\d dBTP exceeds -2 dBTP/.test(entry)), result.failures.join('\n'))
  })
})
