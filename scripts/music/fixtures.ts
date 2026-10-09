/**
 * Deterministic synthetic canonical packages for tests and dry runs. They
 * stand in for DaemonV12 renders before any music exists and are never
 * shipping music.
 *
 * Each loop is a different steady tone plus a short click on every bar
 * line, the placeholder the handoff describes in section 9.5. Every sample
 * is a function of (frame mod cycle), so the three cycles are bit-identical
 * and the periodicity proof passes exactly. Mono layers are rendered
 * dual-mono, as DaemonV12 renders centered tracks; stereo layers carry a
 * different right-channel tone so stereo preservation is observable. Each
 * stinger is silence plus one click at its sync point.
 *
 * Levels are calibrated so a fixture package passes every locked target.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CANONICAL_SAMPLE_RATE,
  LOOP_GEOMETRY,
  LOOP_SPECS,
  type LoopGeometry,
  type LoopId,
  positionToFrames,
  STINGER_SPECS,
  stingerFrames,
  type StingerId,
  type StingerSpec,
} from './musicSpec.ts'
import { encodeWav, type Pcm16 } from './wav.ts'

export const SYNTHETIC_MARKER = 'SYNTHETIC_FIXTURE.json'

interface ToneSpec {
  /** Whole tone periods per 16-bar cycle (frequency = periods / 38.4 s), so the tone is cycle-periodic. */
  readonly periods: number
  /** Right-channel periods for stereo layers. */
  readonly rightPeriods: number | null
  readonly amplitudeDbfs: number
}

/** Calibrated against FFmpeg ebur128 to land near each layer's unity target. */
export const FIXTURE_TONES: Readonly<Record<LoopId, ToneSpec>> = {
  bed: { periods: 4224, rightPeriods: 4248, amplitudeDbfs: -24.4 },
  engine: { periods: 5632, rightPeriods: null, amplitudeDbfs: -25.8 },
  pressure: { periods: 7526, rightPeriods: null, amplitudeDbfs: -24.0 },
  assault: { periods: 8448, rightPeriods: null, amplitudeDbfs: -19.1 },
  claim: { periods: 11264, rightPeriods: 11288, amplitudeDbfs: -22.2 },
}

const CLICK_FRAMES = 441 // 10 ms
const CLICK_HZ = 1_000
const LOOP_CLICK_DBFS = -32
const STINGER_CLICK_DBFS = -14

function toPcm16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value * 32768)))
}

function click(i: number, amplitude: number, sampleRate: number): number {
  const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (CLICK_FRAMES - 1))
  return amplitude * window * Math.sin((2 * Math.PI * CLICK_HZ * i) / sampleRate)
}

export function synthesizeLoopRender(id: LoopId, geometry: LoopGeometry = LOOP_GEOMETRY, sampleRate = CANONICAL_SAMPLE_RATE): Pcm16 {
  const tone = FIXTURE_TONES[id]
  const frames = geometry.cycleFrames * geometry.cycles
  const framesPerBar = geometry.framesPerBeat * geometry.beatsPerBar
  const amplitude = 10 ** (tone.amplitudeDbfs / 20)
  const clickAmplitude = 10 ** (LOOP_CLICK_DBFS / 20)
  const clickFrames = Math.min(CLICK_FRAMES, framesPerBar)
  // One cycle is synthesized, then copied: every cycle is the same integers.
  const cycle = new Int16Array(geometry.cycleFrames * 2)
  for (let p = 0; p < geometry.cycleFrames; p++) {
    const withinBar = p % framesPerBar
    const tick = withinBar < clickFrames ? click(withinBar, clickAmplitude, sampleRate) : 0
    const left = amplitude * Math.sin((2 * Math.PI * tone.periods * p) / geometry.cycleFrames) + tick
    const right = tone.rightPeriods === null ? left : amplitude * Math.sin((2 * Math.PI * tone.rightPeriods * p) / geometry.cycleFrames) + tick
    cycle[2 * p] = toPcm16(left)
    cycle[2 * p + 1] = toPcm16(right)
  }
  const samples = new Int16Array(frames * 2)
  for (let c = 0; c < geometry.cycles; c++) samples.set(cycle, c * cycle.length)
  return { sampleRate, channels: 2, frames, samples }
}

export function synthesizeStinger(spec: StingerSpec, sampleRate = CANONICAL_SAMPLE_RATE): Pcm16 {
  const frames = stingerFrames(spec)
  const samples = new Int16Array(frames * 2)
  const sync = positionToFrames(spec.syncPosition)
  const amplitude = 10 ** (STINGER_CLICK_DBFS / 20)
  for (let i = 0; i < CLICK_FRAMES; i++) {
    const value = click(i, amplitude, sampleRate)
    samples[2 * (sync + i)] = toPcm16(value)
    samples[2 * (sync + i) + 1] = toPcm16(spec.channels === 2 ? 0.8 * value : value)
  }
  return { sampleRate, channels: 2, frames, samples }
}

export type FixtureMutation = (id: LoopId | StingerId, audio: Pcm16) => Pcm16

/**
 * Writes `stm-loop-<id>.wav` / `stm-sting-<id>.wav` for all twelve assets
 * plus the synthetic marker. Refuses a non-empty directory. `mutate` lets
 * tests inject defects (wrong length, non-periodic cycle, loud tail, …).
 */
export async function writeSyntheticPackage(dir: string, mutate?: FixtureMutation): Promise<string[]> {
  await mkdir(dir, { recursive: true })
  if ((await readdir(dir)).length > 0) throw new Error(`${dir} is not empty; fixtures are only written into an empty directory`)
  const written: string[] = []
  for (const spec of LOOP_SPECS) {
    const audio = synthesizeLoopRender(spec.id)
    const file = path.join(dir, `${spec.sourceName}.wav`)
    await writeFile(file, encodeWav(mutate ? mutate(spec.id, audio) : audio))
    written.push(file)
  }
  for (const spec of STINGER_SPECS) {
    const audio = synthesizeStinger(spec)
    const file = path.join(dir, `${spec.sourceName}.wav`)
    await writeFile(file, encodeWav(mutate ? mutate(spec.id, audio) : audio))
    written.push(file)
  }
  const marker = {
    synthetic: true,
    purpose: 'Generated test fixtures for scripts/music/build-web-music.mjs. Not music; never ship.',
  }
  await writeFile(path.join(dir, SYNTHETIC_MARKER), `${JSON.stringify(marker, null, 2)}\n`)
  return written
}
