import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 30_000,
    url: 'http://127.0.0.1:4173',
  },
})
