import { defineConfig } from '@playwright/test'

/**
 * Separate Playwright project for the reel-capture harness. Kept out of the
 * root playwright.config.ts (and out of src/) entirely: this never runs as
 * part of `npm run test:e2e`, and the release build is untouched.
 *
 * The webServer always rebuilds with VITE_E2E_HARNESS=1 so the capture-only
 * test hooks (moon-core:set-cinematic-progress, first-strike:set-presentation,
 * counterstrike:set-run, …) are compiled in — the same manual step the
 * project's own README already documents for camera-capture e2e specs
 * (see e2e/contrast-hotfix.spec.ts's header comment). A dedicated port keeps
 * this from colliding with a `npm run preview` already serving the
 * non-harness build for the main e2e suite.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['capture.spec.ts', 'integrity.spec.ts', 'finalEdit.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  outputDir: '../test-results/capture',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 30_000,
    launchOptions: {
      // Unset by default. Some sandboxed dev environments pre-install a
      // Chromium revision that doesn't match this pinned Playwright version
      // and block the CDN this package would otherwise fetch from — set
      // this env var to that browser's binary path in that case (see
      // capture/README.md). Real developer machines/CI just run
      // `npx playwright install chromium` and leave this unset.
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    },
  },
  webServer: {
    command:
      'VITE_E2E_HARNESS=1 npm run build && npm run preview -- --host 127.0.0.1 --port 4174',
    cwd: '..',
    reuseExistingServer: !process.env.CI,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
    url: 'http://127.0.0.1:4174',
  },
})
