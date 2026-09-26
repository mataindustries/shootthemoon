/**
 * Page initialization shared by every capture shot: browser-property
 * overrides, fixture seeding, navigation, HUD visibility, and error
 * surfacing. Nothing here touches src/ — it only exercises init scripts,
 * localStorage, and the existing `?e2e` test-hook query flag the same way
 * e2e/*.spec.ts already does.
 */
import { expect, type Page } from '@playwright/test'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { buildFixtureSave, type FixtureId } from './fixtures.ts'
import { expectedCanvasBufferSize, type CaptureProfile } from './profiles.ts'

export interface BrowserErrors {
  readonly console: string[]
  readonly page: string[]
}

export interface PreparedPage {
  readonly errors: BrowserErrors
  readonly expectedBuffer: { readonly width: number; readonly height: number; readonly dpr: number }
  readonly actualBuffer: { readonly width: number; readonly height: number }
  readonly fontReport: FontReport
  readonly saveSource: FixtureId
}

export interface FontReport {
  readonly robotoCondensedDetected: boolean
}

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text())
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
  return errors
}

/** Forces navigator.deviceMemory/hardwareConcurrency past BOTH thresholds in
 * detectQualitySettings (src/render/quality.ts), landing on 'high' — the
 * existing e2e convention of memory=6/cores=8 actually lands on 'medium'
 * (memory<=6 matches first), so capture deliberately uses higher values. */
async function forceHighestQualityTier(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      get: () => 8,
    })
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => 12,
    })
  })
}

/** The only production-DPR-affecting override: window.innerWidth/innerHeight
 * are read by calculateDpr's two call sites in src/App.tsx and nowhere else
 * in src/ (confirmed by repo-wide grep), so this cannot change layout. */
async function applyDprOverride(page: Page, profile: CaptureProfile): Promise<void> {
  if (profile.dprOverride === null) return
  const { fakeInnerWidth, fakeInnerHeight } = profile.dprOverride
  await page.addInitScript(
    ({ width, height }) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        get: () => width,
      })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        get: () => height,
      })
    },
    { width: fakeInnerWidth, height: fakeInnerHeight },
  )
}

async function seedFixture(page: Page, fixture: FixtureId, nowMs: number): Promise<void> {
  const save = buildFixtureSave(fixture, nowMs)
  if (save === null) return
  await page.addInitScript(
    ({ key, value }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value)
      }
    },
    { key: OUTPOST_STORAGE_KEY, value: save },
  )
}

export async function dismissLaunchGate(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ })
  if (await entry.isVisible()) {
    await entry.click()
  }
  await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
}

async function detectFontFallback(page: Page): Promise<FontReport> {
  const robotoCondensedDetected = await page.evaluate(() => {
    try {
      return document.fonts.check('16px "Roboto Condensed"')
    } catch {
      return false
    }
  })
  return { robotoCondensedDetected }
}

/** Fails loudly (throws) if the live WebGL backing buffer does not exactly
 * match the profile's predicted size. Extracted as a pure function so
 * capture/integrity.spec.ts can prove it actually catches a mismatch
 * without needing to fabricate a live browser discrepancy. */
export function assertBufferMatches(
  actual: { readonly width: number; readonly height: number },
  expected: { readonly width: number; readonly height: number },
  profileId: string,
): void {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Canvas backing buffer mismatch for profile ${profileId}: ` +
        `expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}.`,
    )
  }
}

async function readCanvasBuffer(page: Page): Promise<{ width: number; height: number }> {
  const canvas = page.locator('.scene-canvas canvas')
  await canvas.waitFor({ state: 'attached' })
  return await canvas.evaluate((element: HTMLCanvasElement) => {
    const wait = () =>
      new Promise<void>((resolve) => {
        if (element.dataset.bufferWidth) {
          resolve()
          return
        }
        const observer = new MutationObserver(() => {
          if (element.dataset.bufferWidth) {
            observer.disconnect()
            resolve()
          }
        })
        observer.observe(element, { attributes: true })
      })
    return wait().then(() => ({
      width: Number(element.dataset.bufferWidth),
      height: Number(element.dataset.bufferHeight),
    }))
  })
}

const HUD_HIDE_STYLE_ID = 'capture-hud-hide'

export type HudVisibility =
  | { readonly mode: 'hidden' }
  | { readonly mode: 'visible' }
  | { readonly mode: 'partial'; readonly visibleSelectors: readonly string[] }

/**
 * Hides HUD via opacity only (never display:none / visibility:hidden /
 * node removal) so `src/camera/surfaceSafeArea.ts`'s getBoundingClientRect
 * reads of `.hud-header`, `.surface-status`, `.command-deck`, and
 * `.operations-panel` keep returning real, non-zero boxes.
 */
export async function applyHudVisibility(page: Page, hud: HudVisibility): Promise<void> {
  if (hud.mode === 'visible') return

  const exceptions =
    hud.mode === 'partial'
      ? hud.visibleSelectors.flatMap((selector) => [`:not(${selector})`, `:not(${selector} *)`]).join('')
      : ''

  const css = `
    .app-shell *:not(.scene-canvas):not(.scene-canvas *)${exceptions} {
      opacity: 0 !important;
    }
  `
  await page.addStyleTag({ content: css })
  // Style tags are inert until attached; tag it so tests can find/remove it.
  await page.evaluate((id) => {
    const tags = document.head.querySelectorAll('style')
    const last = tags[tags.length - 1]
    if (last) last.id = id
  }, HUD_HIDE_STYLE_ID)
}

export interface PreparePageOptions {
  readonly profile: CaptureProfile
  readonly fixture: FixtureId
  readonly nowMs?: number
  /** Runs after error watchers/init scripts are attached but before goto —
   * used only by clock-driven shots to `page.clock.install()` first. */
  readonly beforeGoto?: (page: Page) => Promise<void>
}

export async function preparePage(page: Page, options: PreparePageOptions): Promise<PreparedPage> {
  const nowMs = options.nowMs ?? Date.now()
  const errors = watchBrowserErrors(page)

  await forceHighestQualityTier(page)
  await applyDprOverride(page, options.profile)
  await seedFixture(page, options.fixture, nowMs)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  if (options.beforeGoto) await options.beforeGoto(page)

  await page.goto('/?e2e')
  await page.locator('main').waitFor({ state: 'attached' })
  await page.waitForFunction(
    () => document.querySelector('main')?.getAttribute('data-scene-ready') === 'true',
  )
  await page.waitForFunction(
    () => (document.querySelector('.scene-canvas canvas') as HTMLCanvasElement | null)?.dataset
      .drawCalls !== undefined,
  )

  const actualBuffer = await readCanvasBuffer(page)
  const expectedBuffer = expectedCanvasBufferSize(options.profile)
  assertBufferMatches(actualBuffer, expectedBuffer, options.profile.id)

  const fontReport = await detectFontFallback(page)

  return {
    errors,
    expectedBuffer,
    actualBuffer,
    fontReport,
    saveSource: options.fixture,
  }
}

export async function readWebGlState(
  page: Page,
): Promise<{ readonly contextLost: boolean | null; readonly error: number | null }> {
  return page.locator('.scene-canvas canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('webgl2')
    return {
      contextLost: context?.isContextLost() ?? null,
      error: context?.getError() ?? null,
    }
  })
}

/** Console/page-error text that is a known, already-documented environment
 * artifact rather than a real regression. Empty by default: nothing in this
 * codebase's existing e2e suite tolerates any console/page error today, so
 * capture holds the same bar until a specific, documented warning demands
 * an entry here. */
export const KNOWN_ENVIRONMENT_WARNINGS: readonly RegExp[] = []

export function filterKnownWarnings(messages: readonly string[]): string[] {
  return messages.filter(
    (message) => !KNOWN_ENVIRONMENT_WARNINGS.some((pattern) => pattern.test(message)),
  )
}
