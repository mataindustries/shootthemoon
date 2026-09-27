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

/** Fine-grained fallback step for createClockStepper's post-runFor nudge
 * loop: comfortably smaller than one requestAnimationFrame tick (~16.7ms
 * under a real or faked 60fps clock) so it always lands inside whichever
 * tick is next due, rather than possibly jumping clean over it. */
const STEPPER_NUDGE_STEP_MS = 4
/** Ceiling on how long advanceTo will keep nudging before giving up and
 * returning control to the caller's own (slower, ~15s) stall detector —
 * comfortably shorter than that, so a genuine failure (WebGL context loss,
 * a truly wedged page) still surfaces via the existing clear error instead
 * of this loop masking it. */
const STEPPER_NUDGE_BUDGET_MS = 10_000

/** page.clock-based stepper — the `seek()` idiom from
 * e2e/helios-reactor.spec.ts, generalized: fast-forward close to the
 * target, then run the remainder in real ticks so the last few frames
 * actually render before landing.
 *
 * A single runFor(left) reliably lands the fake clock's *time* at the
 * target, but does not by itself guarantee a new frame actually rendered:
 * this codebase's demand-render loop (src/render/useDemandAnimation.ts)
 * only calls invalidate() from its own chained requestAnimationFrame
 * callback, which under a faked clock fires at that clock's own ~16.7ms
 * tick cadence — coarser than the sub-tick per-frame delta a deep-slow-
 * motion final-render sample asks for (e.g. divider-incoming-formation
 * samples every ~5.6ms of source time). A delta smaller than one tick can
 * land between two scheduled ticks and advance nothing — confirmed
 * empirically: capture/finalRender/engine.ts's frame-counter poll then
 * exhausts its full timeout and fails, because nothing further advances a
 * *paused* fake clock while that poll merely waits. Guarding against a
 * zero/negative delta (as the one call site advancing from a shared
 * stepper's last position already does, see manifest.ts's "+80ms" comment)
 * only ever fixes a single isolated step, not a whole sequence of them, so
 * the guarantee belongs here instead: nudge forward, in bounded small
 * steps, until a genuinely new frame has committed — verified against the
 * real R3F frame counter, never assumed from elapsed fake-clock time
 * alone. */
export function createClockStepper(page: Page, originMs: number): ClockStepper {
  return {
    sampleAt: (elapsedMs) => sampleClockAt(page, originMs, elapsedMs),
    async advanceTo(elapsedMs: number): Promise<void> {
      const atMs = originMs + elapsedMs
      const { now, framesHeld } = await page.evaluate(() => ({
        now: performance.now(),
        framesHeld: '__captureHeldFrames' in window,
      }))
      if (framesHeld) {
        // Once sampleAt has taken animation frames off the clock, nothing
        // below could ever render a frame — fail loudly, never nudge idly.
        throw new Error('advanceTo after sampleAt on the same page: animation frames are held; use sampleAt')
      }
      if (atMs - now > 96) {
        await page.clock.fastForward(Math.floor(atMs - now - 64))
      }
      const left = atMs - (await page.evaluate(() => performance.now()))
      if (left > 0) {
        await page.clock.runFor(Math.ceil(left))
      }

      const beforeCount = await readFrameCount(page)
      const deadline = Date.now() + STEPPER_NUDGE_BUDGET_MS
      while (Date.now() < deadline) {
        const current = await readFrameCount(page)
        if (!Number.isNaN(current) && current > beforeCount) return
        await page.clock.runFor(STEPPER_NUDGE_STEP_MS)
      }
    },
  }
}

/** A clock stepper that can also deliver one frame at an exact source time —
 * what capture/finalRender's elapsed-ms sampling uses. `advanceTo` (above)
 * stays the reach/review-capture primitive. */
export interface ClockStepper extends FrameStepper {
  /** Lands the page clock on exactly `originMs + elapsedMs` (rounded up to
   * the fake clock's 1ms tick resolution), then renders one frame AT that
   * time. See sampleClockAt. */
  readonly sampleAt: (elapsedMs: number) => Promise<ExactSample>
}

export interface ExactSample {
  /** The page clock (performance.now()) the frame rendered at. */
  readonly renderedAtMs: number
  /** renderedAtMs relative to the stepper origin — the source time the
   * frame actually shows (requested elapsedMs rounded up to a whole tick). */
  readonly renderedElapsedMs: number
  /** Held-frame flushes it took before the frame counter advanced (1 in
   * steady state; 2 when R3F's own loop was idle and only got requested by
   * the first flush's invalidate()). */
  readonly flushes: number
}

/** The page-side registry installHeldAnimationFrames() adds. */
export interface HeldAnimationFrames {
  readonly pending: () => number
  /** Runs every animation-frame callback pending at call time with the
   * current page clock as its timestamp (callbacks they request run on the
   * NEXT flush, as in a browser frame). Returns how many ran. */
  readonly flush: () => number
}

export interface HeldFrameTarget {
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
  readonly performance: { now: () => number }
  readonly queueMicrotask: (callback: () => void) => void
  __captureHeldFrames?: HeldAnimationFrames
}

/**
 * Takes animation frames off Playwright's fake-clock grid for the rest of
 * the page's life: requestAnimationFrame callbacks are queued instead of
 * scheduled, and only run when the harness flushes them.
 *
 * Why: Playwright's fake clock schedules every requestAnimationFrame at the
 * next multiple of 16 ticks (`16 - ticks % 16`, playwright-core's
 * ClockController.getTimeToNextFrame) and `fastForward` can only delay a
 * timer, never pull one earlier — so from any clock position the earliest
 * possible render is the next 16ms grid point. The slow-motion elapsed-ms
 * clips sample source time every 5.6-13.2ms, finer than that grid, so no
 * sequence of runFor/fastForward calls can render them at their requested
 * times. createClockStepper's nudge loop (above) therefore rendered each
 * sample at the next grid point *after* the previous one — +16ms per frame
 * instead of +5.6ms, and +80ms per frame (the monument sim interval) once
 * the demand loop went idle: run #4's c19 ended at +5952ms instead of
 * +680ms and produced 68 byte-identical post-volley frames.
 *
 * Holding frames changes when frames happen, never what a frame draws for a
 * given time: every visual the elapsed-ms shots show is an absolute
 * function of performance.now()/Date.now() (CameraRig's monument pose,
 * WaveDefense's defenseElapsed), and timers (the 80ms simulation interval)
 * still fire at their natural times via runFor.
 *
 * Self-contained (no closure over module scope) because it runs inside the
 * page via page.evaluate; `target` defaults to the page's window there and
 * is a stub in capture/finalRenderPlan.spec.ts's pure tests.
 */
export function installHeldAnimationFrames(target?: HeldFrameTarget): void {
  const win = target ?? (window as unknown as HeldFrameTarget)
  if (win.__captureHeldFrames !== undefined) return
  const scheduledCancel = win.cancelAnimationFrame.bind(win)
  const queue = new Map<number, FrameRequestCallback>()
  // Callbacks of the flush in progress that have not run yet — cancelling
  // one of them skips it, like a browser frame's cancelled callback.
  let running = new Map<number, FrameRequestCallback>()
  // Disjoint from the fake clock's own timer ids (which start at 1e12), so
  // cancelAnimationFrame can tell a held id from a frame that was already
  // scheduled on the clock before this was installed.
  const heldIdBase = 1 << 30
  let nextId = heldIdBase
  win.requestAnimationFrame = (callback) => {
    nextId += 1
    queue.set(nextId, callback)
    return nextId
  }
  win.cancelAnimationFrame = (id) => {
    if (id > heldIdBase && id <= nextId) {
      queue.delete(id)
      running.delete(id)
      return
    }
    scheduledCancel(id)
  }
  win.__captureHeldFrames = {
    pending: () => queue.size,
    flush: () => {
      const timestamp = win.performance.now()
      running = new Map(queue)
      queue.clear()
      let ran = 0
      // Iterating the live map: an entry a callback cancels (deletes) before
      // it is reached is simply never visited.
      for (const [id, callback] of running) {
        running.delete(id)
        ran += 1
        try {
          callback(timestamp)
        } catch (error) {
          // A throwing callback must not skip the rest of the frame; report
          // it the way the browser would (surfaces as a pageerror).
          win.queueMicrotask(() => {
            throw error
          })
        }
      }
      return ran
    },
  }
}

/** MessageChannel round trips per settle. React (react-dom and R3F's own
 * reconciler) schedules render/commit/passive-effect work as MessageChannel
 * tasks that can chain (a commit's layout effect schedules the R3F root's
 * update; a commit schedules its passive effects); each hop lets one more
 * link of such a chain run. */
const SETTLE_HOPS = 4

/** Lets the page's already-posted React scheduler work run to completion at
 * the CURRENT fake time. The fake clock never advances while this waits
 * (it is paused), so whatever React does here — commits, and the app's own
 * passive effects re-arming its 80ms simulation setInterval — happens at the
 * tick it was triggered at, as it would in a real browser within a
 * millisecond. */
async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async (hops) => {
    for (let hop = 0; hop < hops; hop += 1) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      })
    }
  }, SETTLE_HOPS)
}

/** Settles the page (settlePage), then flushes its held animation frames, so
 * the frame sees every state update the preceding timers dispatched. */
async function flushHeldFrames(page: Page): Promise<number> {
  await settlePage(page)
  return page.evaluate(() => {
    const held = (window as unknown as { __captureHeldFrames?: HeldAnimationFrames }).__captureHeldFrames
    if (held === undefined) throw new Error('held animation frames are not installed')
    return held.flush()
  })
}

/** The fake clock only lands on whole ticks (ClockController._runTo does
 * `Math.ceil(to)`), so a fractional sample time resolves to the next whole
 * millisecond — at most 1ms of source time, deterministically. */
export function exactSampleTick(originMs: number, elapsedMs: number): number {
  return Math.ceil(originMs + elapsedMs)
}

/** The last stretch before each sample is walked 1ms at a time with the
 * page settled after every step (see planExactAdvance). Longer than the
 * widest sample spacing any locked elapsed-ms clip uses (13.2ms, c25), so
 * sequential sampling is always walked finely end to end, and longer than
 * the app's 80ms simulation interval, so the tick feeding the first sample
 * of a jump is re-armed at its natural time too. */
export const FINE_APPROACH_MS = 100

export interface ExactAdvancePlan {
  /** One plain runFor over the part of the gap no sample depends on
   * finely (every timer still fires at its own natural time); lands on the
   * whole tick `targetTick - fineSteps`. */
  readonly coarseMs: number
  /** Then this many runFor(1) steps, each followed by settlePage(). */
  readonly fineSteps: number
}

/** How to run the paused page clock from `nowTick` to land exactly on
 * `targetTick`. Never fastForward: that fires each due timer once, at the
 * destination, so the landing state would depend on where the jump started
 * (with frames held, runFor over even seconds of source time costs only the
 * timers). The final FINE_APPROACH_MS are walked 1ms at a time so React —
 * whose work the fake clock does not control — commits each simulation tick
 * and re-arms the app's interval at the tick's own time; a single runFor
 * can run several timers ahead of React, which delays the next tick and
 * lets WaveDefense's 80ms interpolation clamp freeze consecutive samples
 * (the residual c19 duplicates). Refuses to go backwards. */
export function planExactAdvance(nowTick: number, targetTick: number): ExactAdvancePlan {
  if (targetTick < nowTick) {
    throw new Error(
      `exact sample at tick ${targetTick} is behind the page clock (${nowTick}) — ` +
        'samples must be requested in increasing source time',
    )
  }
  // The page clock can sit on a fractional tick (it synced to real time
  // before pauseAt); the coarse runFor absorbs that fraction — the clock
  // ceils every runFor target — so each fine step lands on a whole tick.
  const gap = targetTick - nowTick
  const fineSteps = Math.min(Math.floor(gap), FINE_APPROACH_MS)
  return { coarseMs: gap - fineSteps, fineSteps }
}

/** At most this many held-frame flushes per sample before concluding the
 * page requested no frame at all. */
const MAX_SAMPLE_FLUSHES = 3

/**
 * Delivers one frame at exactly `originMs + elapsedMs` (whole-ms resolution,
 * see exactSampleTick): holds animation frames (installHeldAnimationFrames),
 * runs the paused fake clock to the target tick so every timer fires at its
 * natural time and React settles behind each one (planExactAdvance), then
 * flushes the pending frame callbacks at that tick and requires the R3F
 * frame counter to advance.
 *
 * Throws — instead of nudging the clock past the requested time, which is
 * what made run #4's elapsed-ms clips drift — if the page requested no
 * frame at that instant.
 */
export async function sampleClockAt(page: Page, originMs: number, elapsedMs: number): Promise<ExactSample> {
  // Passed by reference so its own source is what gets serialized into the
  // page (Playwright calls it with an undefined arg -> the page's window).
  await page.evaluate(installHeldAnimationFrames as (arg: void) => void)
  const targetTick = exactSampleTick(originMs, elapsedMs)
  const nowTick = await page.evaluate(() => performance.now())
  const { coarseMs, fineSteps } = planExactAdvance(nowTick, targetTick)
  if (coarseMs > 0) await page.clock.runFor(coarseMs)
  for (let step = 0; step < fineSteps; step += 1) {
    await page.clock.runFor(1)
    await settlePage(page)
  }
  const landedTick = await page.evaluate(() => performance.now())
  if (landedTick !== targetTick) {
    throw new Error(`page clock landed on ${landedTick}, expected exactly ${targetTick} (elapsed ${elapsedMs}ms)`)
  }

  const beforeCount = await readFrameCount(page)
  for (let flushes = 1; flushes <= MAX_SAMPLE_FLUSHES; flushes += 1) {
    const ran = await flushHeldFrames(page)
    const count = await readFrameCount(page)
    if (!Number.isNaN(count) && count > beforeCount) {
      const renderedAtMs = await page.evaluate(() => performance.now())
      if (renderedAtMs !== targetTick) {
        throw new Error(`frame rendered at ${renderedAtMs}, expected ${targetTick} (elapsed ${elapsedMs}ms)`)
      }
      return { renderedAtMs, renderedElapsedMs: renderedAtMs - originMs, flushes }
    }
    if (ran === 0) break
  }
  throw new Error(
    `no frame rendered at elapsed ${elapsedMs}ms (tick ${targetTick}): the page requested no animation frame ` +
      `there (frame counter still ${beforeCount})`,
  )
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

export async function readFrameCount(page: Page): Promise<number> {
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
export async function waitForFrameCountAbove(
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
