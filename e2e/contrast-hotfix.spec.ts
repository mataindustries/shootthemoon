import { expect, test } from '@playwright/test'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createCompletedStrikeSave, createStrikeReadySave } from './firstStrikeFixtures.ts'

// Build with VITE_E2E_HARNESS=1 before running these camera capture checks.
for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`contrast review at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize(viewport)
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: OUTPOST_STORAGE_KEY, value: createStrikeReadySave(),
    })
    await page.goto('/?e2e')
    await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).click()
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('rival-signal:set-presentation', {
      detail: { phase: 'rival-focused', progress: 1 },
    })))
    await page.clock.runFor(64)
    await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'rival-focused')
    await page.screenshot({ path: `artifacts/screenshots/contrast-hotfix/rival-${viewport.width}.png` })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('rival-signal:set-presentation', {
      detail: { phase: 'idle', progress: null },
    })))
    for (const phase of ['launch', 'orbital-flight', 'target-approach']) {
      await page.evaluate(phase => window.dispatchEvent(new CustomEvent('first-strike:set-presentation', {
        detail: { phase, progress: 0.4 },
      })), phase)
      await page.clock.runFor(64)
      await expect(page.locator('main')).toHaveAttribute('data-first-strike-presentation', phase)
      await page.screenshot({ path: `artifacts/screenshots/contrast-hotfix/${phase}-${viewport.width}.png` })
    }
    expect(errors).toEqual([])
  })

  test(`missile contrast at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: OUTPOST_STORAGE_KEY, value: createCompletedStrikeSave(),
    })
    await page.goto('/?e2e')
    await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).click()
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
    await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
    await page.getByRole('button', { name: /HARDEN OUTPOST/ }).click()
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('counterstrike:set-run', {
        detail: { status: 'interceptor-launched', progress: 0.5, order: 'HARDEN_OUTPOST',
          judgement: 'VALID', attemptNumber: 1, attemptsUsed: 1,
          threatProgressStart: 0.495, threatProgressEnd: 0.54, interceptRouteProgress: 0.54 },
      }))
    })
    await page.clock.runFor(64)
    await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-interceptors', '1')
    await page.screenshot({ path: `artifacts/screenshots/contrast-hotfix/interception-${viewport.width}.png` })
  })
}
