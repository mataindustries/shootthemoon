/**
 * Generic frame-capture engine shared by every shot in the manifest.
 *
 * Two stepping strategies are supported, matching how the existing e2e
 * suite already drives time deterministically for this codebase:
 *
 *  - "progress-event": pins a presentation's normalized [0, 1] progress via
 *    an existing CustomEvent hook (moon-core:set-cinematic-progress,
 *    first-strike:set-presentation). No fake clock involved; each distinct
 *    progress value triggers exactly one new R3F frame via invalidate().
 *
 *  - "clock": drives Playwright's fake clock (page.clock), the same
 *    fastForward-then-runFor idiom e2e/helios-reactor.spec.ts already uses
 *    (there named `seek`), which is required here because the Helios
 *    reveal timeline is computed from real performance.now() deltas rather
 *    than an explicit progress override event.
 *
 * CSS-only transitions (title-gate fades, dialog fades) are NOT stepped by
 * either strategy — Playwright's fake clock does not drive the compositor
 * thread that runs CSS transitions, so shots that need one settled just use
 * a real `page.waitForTimeout` and a single still capture instead.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { filterKnownWarnings, readWebGlState, type BrowserErrors, type PreparedPage } from './initCapture.ts'
import type { CaptureProfileId } from './profiles.ts'
import type { FixtureId } from './fixtures.ts'
import type { HudVisibility } from './initCapture.ts'

export const CAPTURE_OUTPUT_ROOT = 'capture-output'

export interface FrameStepper {
  /** Moves this shot's timeline to `elapsedMs` since the shot's origin and
   * guarantees a render has actually committed at that position before
   * returning. Implementations must not return before the frame lands. */
  readonly advanceTo: (elapsedMs: number) => Promise<void>
}

/** page.clock-based stepper — the `seek()` idiom from
 * e2e/helios-reactor.spec.ts, generalized: fast-forward close to the
 * target, then run the remainder in real ticks so the last few frames
 * actually render before landing. */
export function createClockStepper(page: Page, originMs: number): FrameStepper {
  return {
    async advanceTo(elapsedMs: number): Promise<void> {
      const atMs = originMs + elapsedMs
      const now = await page.evaluate(() => performance.now())
      if (atMs - now > 96) {
        await page.clock.fastForward(Math.floor(atMs - now - 64))
      }
      const left = atMs - (await page.evaluate(() => performance.now()))
      if (left > 0) {
        await page.clock.runFor(Math.ceil(left))
      }
    },
  }
}

/** Progress-override stepper: `toProgress` maps a shot-relative elapsed ms
 * to the normalized [0, 1] value the dispatched event expects. The actual
 * "wait for the render" work happens centrally in captureFrames' polling
 * loop below, not here — a fixed wait can't be sized correctly across both
 * a cheap early-descent frame and a heavy full-scene 4K SwiftShader frame. */
export function createProgressEventStepper(
  page: Page,
  dispatch: (page: Page, progress: number) => Promise<void>,
  toProgress: (elapsedMs: number) => number,
): FrameStepper {
  return {
    async advanceTo(elapsedMs: number): Promise<void> {
      await dispatch(page, toProgress(elapsedMs))
    },
  }
}

async function readFrameCount(page: Page): Promise<number> {
  return page.locator('.scene-canvas canvas').evaluate((canvas: HTMLCanvasElement) => {
    const value = canvas.dataset.frameCount
    return value === undefined ? Number.NaN : Number(value)
  })
}

/** Polls the R3F frame counter until it advances past `previousCount` or
 * `timeoutMs` elapses. Software-rendering a 4K PLATE frame under SwiftShader
 * can take far longer than a small default viewport, so this deliberately
 * waits rather than assuming a fixed settle time — the "wait for the
 * framebuffer before capture" requirement, made real instead of guessed. */
async function waitForFrameCountAbove(
  page: Page,
  previousCount: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let current = await readFrameCount(page)
  while ((Number.isNaN(current) || current <= previousCount) && Date.now() < deadline) {
    await page.waitForTimeout(50)
    current = await readFrameCount(page)
  }
  return current
}

export interface CaptureFramesOptions {
  readonly page: Page
  readonly outDir: string
  readonly fps: number
  readonly startMs: number
  readonly endMs: number
  readonly stepper: FrameStepper
}

export interface CaptureFramesResult {
  readonly frameCount: number
  readonly frameFilenames: readonly string[]
  readonly nudgedFrames: readonly number[]
}

export function frameFilename(index: number): string {
  return `${String(index).padStart(6, '0')}.png`
}

/** A frame is flagged (not failed) when landing it took longer than this —
 * purely diagnostic visibility into which frames were expensive to render. */
const SLOW_FRAME_THRESHOLD_MS = 500

/** Ceiling for the screenshot readback itself (separate from
 * FRAME_ADVANCE_TIMEOUT_MS, which only covers waiting for the frame counter
 * to advance) — a 4K SwiftShader framebuffer readback for a visually busy
 * scene can exceed Playwright's 30s default. */
const SCREENSHOT_TIMEOUT_MS = 60_000

/** Steps a continuous 3D phase frame-by-frame and writes sequentially
 * numbered PNGs. Never silently reuses a frame: it polls the render's own
 * frame counter (generously, since 4K SwiftShader frames are slow) and
 * throws rather than duplicate a frozen frame if it never advances. */
export async function captureFrames(options: CaptureFramesOptions): Promise<CaptureFramesResult> {
  const { page, outDir, fps, startMs, endMs, stepper } = options
  const frameDir = path.join(outDir, 'frames')
  await mkdir(frameDir, { recursive: true })

  const stepMs = 1000 / fps
  const frameCount = Math.max(1, Math.round((endMs - startMs) / stepMs) + 1)
  const frameFilenames: string[] = []
  const nudgedFrames: number[] = []

  let previousFrameCount = await readFrameCount(page)
  // Generous: a heavy full-scene frame under 4K SwiftShader software
  // rendering can legitimately take well over a second. This is a ceiling,
  // not an expected duration — polling returns as soon as the counter moves.
  const FRAME_ADVANCE_TIMEOUT_MS = 8_000

  for (let index = 0; index < frameCount; index += 1) {
    const elapsedMs = startMs + index * stepMs
    const beforeStep = previousFrameCount
    const stepStartedAt = Date.now()
    await stepper.advanceTo(elapsedMs)

    const currentFrameCount = await waitForFrameCountAbove(
      page,
      beforeStep,
      FRAME_ADVANCE_TIMEOUT_MS,
    )
    if (Number.isNaN(currentFrameCount) || currentFrameCount <= beforeStep) {
      throw new Error(
        `Frame ${index} stalled: frame counter did not advance past ${beforeStep} ` +
          `within ${FRAME_ADVANCE_TIMEOUT_MS}ms (elapsedMs=${elapsedMs}).`,
      )
    }
    if (Date.now() - stepStartedAt > SLOW_FRAME_THRESHOLD_MS) nudgedFrames.push(index)
    previousFrameCount = currentFrameCount

    const filename = frameFilename(index)
    // Generous, like FRAME_ADVANCE_TIMEOUT_MS above: reading back a 4K
    // framebuffer under SwiftShader software rendering for a visually busy
    // scene (many on-screen actors/effects at once) can genuinely exceed
    // Playwright's 30s screenshot default — confirmed, not a guess, against
    // the DIVIDER wave-defense shots' formation/volley moments.
    await page.screenshot({ path: path.join(frameDir, filename), timeout: SCREENSHOT_TIMEOUT_MS })
    frameFilenames.push(filename)
  }

  return { frameCount, frameFilenames, nudgedFrames }
}

export async function captureStill(page: Page, outDir: string): Promise<string> {
  const frameDir = path.join(outDir, 'frames')
  await mkdir(frameDir, { recursive: true })
  const filename = frameFilename(0)
  await page.waitForTimeout(160)
  await page.screenshot({ path: path.join(frameDir, filename), timeout: SCREENSHOT_TIMEOUT_MS })
  return filename
}

function gitCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export interface CaptureMetadata {
  readonly shotId: string
  readonly name: string
  readonly profile: CaptureProfileId
  readonly cssViewport: { readonly width: number; readonly height: number }
  readonly deviceScaleFactor: number
  readonly actualBufferSize: { readonly width: number; readonly height: number }
  readonly expectedDpr: number
  readonly requestedFps: number | null
  readonly startMs: number | null
  readonly endMs: number | null
  readonly frameCount: number
  readonly frameFilenames: readonly string[]
  readonly fixture: FixtureId
  readonly hudMode: HudVisibility['mode']
  readonly clockMode: 'fake-clock' | 'progress-event' | 'real-time-still'
  readonly fontReport: PreparedPage['fontReport']
  readonly pageErrors: readonly string[]
  readonly consoleErrors: readonly string[]
  /** Indices of frames that took longer than SLOW_FRAME_THRESHOLD_MS to
   * land — diagnostic only, not a failure (4K SwiftShader frames are slow
   * by nature). */
  readonly nudgedFrames: readonly number[]
  readonly gitCommitSha: string
  readonly capturedAtIso: string
  readonly notes: string
}

export async function writeCaptureMetadata(
  outDir: string,
  fields: Omit<CaptureMetadata, 'gitCommitSha' | 'capturedAtIso'>,
): Promise<CaptureMetadata> {
  const metadata: CaptureMetadata = {
    ...fields,
    gitCommitSha: gitCommitSha(),
    capturedAtIso: new Date().toISOString(),
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n')
  return metadata
}

export async function assertCleanWebGl(page: Page, errors: BrowserErrors): Promise<void> {
  const state = await readWebGlState(page)
  if (state.contextLost) {
    throw new Error('WebGL context was lost during capture.')
  }
  if (state.error !== null && state.error !== 0) {
    throw new Error(`WebGL reported a live error code: ${state.error}.`)
  }
  const pageErrors = filterKnownWarnings(errors.page)
  const consoleErrors = filterKnownWarnings(errors.console)
  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    throw new Error(
      `Unexpected browser errors during capture.\npage: ${JSON.stringify(pageErrors)}\n` +
        `console: ${JSON.stringify(consoleErrors)}`,
    )
  }
}

const REQUIRED_METADATA_KEYS: readonly (keyof CaptureMetadata)[] = [
  'shotId',
  'name',
  'profile',
  'cssViewport',
  'deviceScaleFactor',
  'actualBufferSize',
  'expectedDpr',
  'requestedFps',
  'startMs',
  'endMs',
  'frameCount',
  'frameFilenames',
  'fixture',
  'hudMode',
  'clockMode',
  'fontReport',
  'pageErrors',
  'consoleErrors',
  'nudgedFrames',
  'gitCommitSha',
  'capturedAtIso',
  'notes',
]

/** Structural check used by capture/integrity.spec.ts: every required
 * capture.json field is present (nullable fields for still shots are
 * allowed to be null, but never absent). */
export function validateCaptureMetadataShape(value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) {
    return ['capture.json did not parse to an object.']
  }
  const record = value as Record<string, unknown>
  for (const key of REQUIRED_METADATA_KEYS) {
    if (!(key in record)) problems.push(`missing key: ${key}`)
  }
  if (typeof record.frameCount === 'number' && Array.isArray(record.frameFilenames)) {
    if (record.frameFilenames.length !== record.frameCount) {
      problems.push('frameFilenames.length does not match frameCount')
    }
  }
  return problems
}
