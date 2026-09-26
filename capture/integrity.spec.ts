/**
 * Capture-tooling integrity tests. These validate the harness itself, not
 * the game, and deliberately live outside src/ and outside the product's
 * own vitest/e2e suites (vitest.config.ts only includes src/**\/*.test.ts).
 * Run via: npx playwright test --config=capture/playwright.capture.config.ts capture/integrity.spec.ts
 */
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { buildFixtureSave, MONUMENT_KINDS } from './fixtures.ts'
import { assertBufferMatches, preparePage } from './initCapture.ts'
import { SHOTS } from './manifest.ts'
import { expectedCanvasBufferSize, mirrorCalculateDpr, PROFILES } from './profiles.ts'
import {
  frameFilename,
  validateCaptureMetadataShape,
  writeCaptureMetadata,
  CAPTURE_OUTPUT_ROOT,
} from './runner.ts'

test.describe('1. profile calculations are deterministic', () => {
  test('same inputs produce identical results across repeated calls', () => {
    for (const profile of Object.values(PROFILES)) {
      const first = expectedCanvasBufferSize(profile)
      const second = expectedCanvasBufferSize(profile)
      expect(second).toEqual(first)
    }
  })

  test('PLATE and HUD overrides resolve to their full deviceScaleFactor', () => {
    expect(expectedCanvasBufferSize(PROFILES.PLATE)).toEqual({
      width: 3840,
      height: 2160,
      dpr: 1.5,
    })
    expect(expectedCanvasBufferSize(PROFILES.HUD)).toEqual({
      width: 1920,
      height: 1080,
      dpr: 1.5,
    })
  })

  test('PORT runs the real, uncapped megapixel formula (no override)', () => {
    // maxDpr (1.5, forced high tier) binds before the megapixel cap here —
    // 3x is requested but 1.5x is what production actually delivers.
    const port = expectedCanvasBufferSize(PROFILES.PORT)
    expect(port.dpr).toBeCloseTo(1.5, 5)
    expect(port).toEqual({ width: 585, height: 1266, dpr: 1.5 })
    expect(mirrorCalculateDpr(390, 844, 3)).toBeCloseTo(1.5, 5)
  })
})

test.describe('2. expected canvas size assertions work', () => {
  test('a genuine mismatch is distinguishable on paper', () => {
    const plate = expectedCanvasBufferSize(PROFILES.PLATE)
    const port = expectedCanvasBufferSize(PROFILES.PORT)
    expect(plate.width).not.toBe(port.width)
    expect(plate.height).not.toBe(port.height)
  })

  test('the mismatch guard throws on a genuine discrepancy', () => {
    expect(() =>
      assertBufferMatches({ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, 'PLATE'),
    ).toThrow(/Canvas backing buffer mismatch/)
    expect(() =>
      assertBufferMatches({ width: 3840, height: 2160 }, { width: 3840, height: 2160 }, 'PLATE'),
    ).not.toThrow()
  })

  test('a real PLATE page load matches the live production calculateDpr() exactly', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: PROFILES.PLATE.cssWidth, height: PROFILES.PLATE.cssHeight },
      deviceScaleFactor: PROFILES.PLATE.deviceScaleFactor,
    })
    try {
      const page = await context.newPage()
      const prepared = await preparePage(page, { profile: PROFILES.PLATE, fixture: 'FRESH' })
      // preparePage() calls assertBufferMatches() internally already; this
      // re-check proves the live result truly equals our prediction, not
      // just that nothing threw.
      expect(prepared.actualBuffer).toEqual({
        width: prepared.expectedBuffer.width,
        height: prepared.expectedBuffer.height,
      })
    } finally {
      await context.close()
    }
  })
})

test.describe('3. shot manifest IDs are unique', () => {
  test('no duplicate shot ids', () => {
    const ids = SHOTS.map((shot) => shot.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

test.describe('4. fixture/profile references are valid', () => {
  test('every shot references a known profile', () => {
    for (const shot of SHOTS) {
      expect(PROFILES[shot.profile]).toBeDefined()
    }
  })

  test('every shot fixture builds without throwing', () => {
    for (const shot of SHOTS) {
      expect(() => buildFixtureSave(shot.fixture)).not.toThrow()
    }
  })

  test('every monument kind produces a validator-accepted fixture', () => {
    for (const kind of MONUMENT_KINDS) {
      expect(() => buildFixtureSave(`MON_${kind}`)).not.toThrow()
    }
  })
})

test.describe('5. frame filenames sort chronologically', () => {
  test('lexicographic sort matches numeric sort', () => {
    const indices = Array.from({ length: 30 }, (_, index) => index)
    const filenames = indices.map(frameFilename)
    const lexicographic = [...filenames].sort()
    expect(lexicographic).toEqual(filenames)
  })
})

test.describe('6. capture metadata validates', () => {
  const tmpDir = path.join(CAPTURE_OUTPUT_ROOT, '.integrity-tmp-metadata')

  test.afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('a real write produces a shape with no missing fields', async () => {
    await writeCaptureMetadata(tmpDir, {
      shotId: 'integrity-check',
      name: 'Integrity check',
      profile: 'PLATE',
      cssViewport: { width: 2560, height: 1440 },
      deviceScaleFactor: 1.5,
      actualBufferSize: { width: 3840, height: 2160 },
      expectedDpr: 1.5,
      requestedFps: 12,
      startMs: 0,
      endMs: 1000,
      frameCount: 2,
      frameFilenames: [frameFilename(0), frameFilename(1)],
      fixture: 'FRESH',
      hudMode: 'hidden',
      clockMode: 'progress-event',
      fontReport: { robotoCondensedDetected: true },
      pageErrors: [],
      consoleErrors: [],
      nudgedFrames: [],
      notes: 'integrity test fixture',
    })

    const written = JSON.parse(await readFile(path.join(tmpDir, 'capture.json'), 'utf8'))
    expect(validateCaptureMetadataShape(written)).toEqual([])
    expect(typeof written.gitCommitSha).toBe('string')
  })

  test('a mismatched frame count is caught', () => {
    const problems = validateCaptureMetadataShape({
      shotId: 'x',
      name: 'x',
      profile: 'PLATE',
      cssViewport: { width: 1, height: 1 },
      deviceScaleFactor: 1,
      actualBufferSize: { width: 1, height: 1 },
      expectedDpr: 1,
      requestedFps: 1,
      startMs: 0,
      endMs: 1,
      frameCount: 3,
      frameFilenames: ['000000.png'],
      fixture: 'FRESH',
      hudMode: 'hidden',
      clockMode: 'real-time-still',
      fontReport: {},
      pageErrors: [],
      consoleErrors: [],
      nudgedFrames: [],
      gitCommitSha: 'deadbeef',
      capturedAtIso: new Date().toISOString(),
      notes: '',
    })
    expect(problems).toContain('frameFilenames.length does not match frameCount')
  })
})

test.describe('7. capture tooling does not mutate production state unexpectedly', () => {
  test('the ?e2e flag is inert until a shot dispatches an event', async ({ browser }) => {
    const withHarness = await browser.newContext({
      viewport: { width: PROFILES.PORT.cssWidth, height: PROFILES.PORT.cssHeight },
      deviceScaleFactor: PROFILES.PORT.deviceScaleFactor,
      isMobile: PROFILES.PORT.isMobile,
      hasTouch: PROFILES.PORT.hasTouch,
    })
    const withoutHarness = await browser.newContext({
      viewport: { width: PROFILES.PORT.cssWidth, height: PROFILES.PORT.cssHeight },
      deviceScaleFactor: PROFILES.PORT.deviceScaleFactor,
      isMobile: PROFILES.PORT.isMobile,
      hasTouch: PROFILES.PORT.hasTouch,
    })
    try {
      const harnessPage = await withHarness.newPage()
      await harnessPage.goto('/?e2e')
      await harnessPage.waitForFunction(
        () => document.querySelector('main')?.getAttribute('data-scene-ready') === 'true',
      )

      const plainPage = await withoutHarness.newPage()
      await plainPage.goto('/')
      await plainPage.waitForFunction(
        () => document.querySelector('main')?.getAttribute('data-scene-ready') === 'true',
      )

      const readState = (page: typeof harnessPage) =>
        page.locator('main').evaluate((main) => ({
          phase: main.getAttribute('data-phase'),
          entryOpen: main.getAttribute('data-entry-open'),
        }))

      expect(await readState(harnessPage)).toEqual(await readState(plainPage))
    } finally {
      await withHarness.close()
      await withoutHarness.close()
    }
  })
})
