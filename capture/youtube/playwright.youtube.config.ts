import { defineConfig } from '@playwright/test'
import base from '../playwright.capture.config.ts'

// The film's fourth capture uses the release harness without changing its
// manifest, finalEdit, profiles, reach functions, or gameplay.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['captureMassDriver.spec.ts'],
  timeout: 4_800_000,
  outputDir: '../../test-results/youtube',
  // Every frame/time/input is independently hashed below; tracing every
  // fake-clock API call adds readback overhead without strengthening proof.
  use: { ...base.use, trace: 'off' },
  webServer: {
    ...base.webServer,
    command: 'VITE_E2E_HARNESS=1 npm run build && npm run preview -- --host 127.0.0.1 --port 4174',
    cwd: '../..',
    url: 'http://127.0.0.1:4174',
  },
})
