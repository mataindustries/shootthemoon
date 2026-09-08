import { expect, test, type Page } from '@playwright/test'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { createCompletedStrikeSave } from './firstStrikeFixtures.ts'

async function setRun(page: Page, status: string, progress = 0) {
  await page.evaluate(({ status, progress }) => {
    window.dispatchEvent(new CustomEvent('counterstrike:set-run', {
      detail: { status, progress, order: 'HARDEN_OUTPOST', outcome: status === 'impact' ? 'FAILURE' : null },
    }))
  }, { status, progress })
  await page.clock.runFor(32)
  await expect(page.locator('canvas')).toHaveAttribute('data-camera-mode', `counterstrike-${status}`)
}

async function cameraPose(page: Page) {
  return page.locator('canvas').evaluate((canvas) => {
    const d = canvas.dataset
    return [d.cameraX, d.cameraY, d.cameraZ, d.cameraTargetX, d.cameraTargetY, d.cameraTargetZ, d.cameraFov, d.cameraUpX, d.cameraUpY, d.cameraUpZ]
  })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`launch resets orientation and impact holds one shot at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: OUTPOST_STORAGE_KEY, value: createCompletedStrikeSave(),
    })
    await page.goto('/?e2e')
    await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).click()
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('moon-core:set-orbit-view', {
      detail: { latitudeRad: 1.3, longitudeRad: -2.8, distance: 5.2 },
    })))
    await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
    await page.clock.runFor(32)
    const launch = await cameraPose(page)
    await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-threats', '1')
    await page.getByRole('button', { name: /HARDEN OUTPOST/ }).click()
    await setRun(page, 'warning', 0.2)
    expect(await cameraPose(page)).toEqual(launch)
    await page.screenshot({ path: `/tmp/camera-command-launch-${viewport.width}.png` })

    // Re-enter after a radically different surface shot to catch inherited up,
    // target, projection, or OrbitControls momentum on repeat launches.
    await setRun(page, 'impact', 0.8)
    await setRun(page, 'warning', 0.2)
    expect(await cameraPose(page)).toEqual(launch)

    await setRun(page, 'impact', 0)
    const terminal = await cameraPose(page)
    await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-threats', '1')
    await page.screenshot({ path: `/tmp/camera-command-terminal-${viewport.width}.png` })
    for (const progress of [0.18, 0.35, 0.41, 0.48]) {
      await setRun(page, 'impact', progress)
      expect(await cameraPose(page)).toEqual(terminal)
    }
    await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-threats', '0')
    await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-camera-beat', 'contact')
    await page.screenshot({ path: `/tmp/camera-command-contact-${viewport.width}.png` })
    await setRun(page, 'impact', 0.7)
    const pulledBack = await cameraPose(page)
    expect(pulledBack.slice(0, 3)).not.toEqual(terminal.slice(0, 3))
    expect(pulledBack.slice(3)).toEqual(terminal.slice(3))
  })
}
