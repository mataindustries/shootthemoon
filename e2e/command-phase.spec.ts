import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
import { COUNTERSTRIKE_TIMING } from '../src/simulation/counterstrikeSimulation.ts'
import { createCompletedStrikeSave } from './firstStrikeFixtures.ts'

const SCREENSHOT_DIRECTORY = 'artifacts/screenshots/command-phase'

interface RunDetail {
  readonly status: string
  readonly progress?: number
  readonly attemptNumber?: 0 | 1 | 2
  readonly attemptsUsed?: 0 | 1 | 2
  readonly attemptElapsedMs?: number
  readonly judgement?: 'EARLY' | 'VALID' | 'LATE' | null
  readonly outcome?: 'SUCCESS' | 'FAILURE' | null
  readonly replay?: boolean
  readonly order?:
    | 'PRIORITIZE_INTERCEPTOR'
    | 'HARDEN_OUTPOST'
    | 'KEEP_EXTRACTING'
}

async function openCommand(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: OUTPOST_STORAGE_KEY, value: createCompletedStrikeSave() },
  )
  await page.goto('/?e2e')
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  const entry = page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ })
  if (await entry.isVisible()) await entry.click()
  await page.getByRole('button', { name: 'TRACK COUNTERSTRIKE' }).click()
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-state',
    'command',
  )
}

async function setRun(page: Page, detail: RunDetail): Promise<void> {
  await page.evaluate(
    (next) =>
      window.dispatchEvent(
        new CustomEvent('counterstrike:set-run', { detail: next }),
      ),
    detail,
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-state',
    detail.status,
  )
}

async function setFireElapsed(page: Page, attemptElapsedMs: number) {
  const acknowledged = await page.evaluate((value) => {
    const detail = { attemptElapsedMs: value, acknowledged: false }
    window.dispatchEvent(
      new CustomEvent('counterstrike:set-fire-elapsed', { detail }),
    )
    return detail.acknowledged
  }, attemptElapsedMs)
  expect(acknowledged).toBe(true)
}

async function advance(page: Page, status: string) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('counterstrike:advance')),
  )
  await expect(page.locator('main')).toHaveAttribute(
    'data-counterstrike-state',
    status,
  )
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true })
})

test('Prioritize Interceptor widens the window and resolves a successful intercept', async ({
  page,
}) => {
  await openCommand(page)
  const main = page.locator('main')
  const panel = page.getByRole('region', {
    name: 'Issue one Counterstrike order',
  })

  await expect(panel).toContainText('RIVAL LAUNCH DETECTED')
  await expect(panel).toContainText('ISSUE ONE ORDER')
  const commandButtons = panel.getByRole('button')
  await expect(commandButtons).toHaveCount(3)
  for (const button of await commandButtons.all()) {
    const bounds = await button.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.height).toBeGreaterThanOrEqual(96)
  }
  await expect(
    page.getByRole('button', { name: /KEEP EXTRACTING/ }),
  ).toContainText('3 ROBOTS')
  await expect(
    page.getByRole('button', { name: /KEEP EXTRACTING/ }),
  ).toContainText('25% BOOST')
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/portrait-command-panel.png`,
  })

  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).tap()
  await expect(main).toHaveAttribute(
    'data-counterstrike-state',
    'command-confirmed',
  )
  await expect(main).toHaveAttribute(
    'data-counterstrike-order',
    'PRIORITIZE_INTERCEPTOR',
  )
  await expect(main).toHaveAttribute('data-operation-active-robots', '1')
  await expect(main).toHaveAttribute('data-operation-defense-allocation', '6')

  await setRun(page, {
    status: 'intercept-ready',
    attemptNumber: 1,
    attemptsUsed: 0,
    attemptElapsedMs: 5_500,
    order: 'PRIORITIZE_INTERCEPTOR',
  })
  await setFireElapsed(page, 5_500)
  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).tap()
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'VALID')
  await advance(page, 'success')
  await advance(page, 'resolved')

  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'SUCCESS',
  )
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(page.locator('.counterstrike-ending__order-effect')).toContainText(
    'widened the fire window by 40%',
  )
  const persisted = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    OUTPOST_STORAGE_KEY,
  )
  expect(persisted.schemaVersion).toBe(6)
  expect(persisted.counterstrike).toMatchObject({
    selectedOrder: 'PRIORITIZE_INTERCEPTOR',
    acceptedOrder: 'PRIORITIZE_INTERCEPTOR',
    productionDamagePenalty: 0,
  })
})

test('Harden Outpost limits persistent damage after a failed intercept', async ({
  page,
}) => {
  await openCommand(page)
  const main = page.locator('main')
  await page.getByRole('button', { name: /HARDEN OUTPOST/ }).tap()
  await expect(main).toHaveAttribute('data-operation-active-robots', '2')
  await expect(main).toHaveAttribute('data-operation-defense-allocation', '3')

  const lateMs = COUNTERSTRIKE_TIMING.validWindowEndMs + 400
  await setRun(page, {
    status: 'intercept-ready',
    attemptNumber: 2,
    attemptsUsed: 1,
    attemptElapsedMs: lateMs,
    order: 'HARDEN_OUTPOST',
  })
  await setFireElapsed(page, lateMs)
  await page.getByRole('button', { name: /FIRE INTERCEPTOR/ }).tap()
  await expect(main).toHaveAttribute('data-counterstrike-judgement', 'LATE')
  await advance(page, 'missed')
  await advance(page, 'impact')
  await advance(page, 'resolved')

  await expect(main).toHaveAttribute(
    'data-counterstrike-accepted-outcome',
    'FAILURE',
  )
  await expect(main).toHaveAttribute('data-production-damage-penalty', '0.15')
  await expect(main).toHaveAttribute('data-operation-efficiency', /0\./)
  await expect(main).toHaveAttribute('data-render-mode', 'demand')
  await expect(page.locator('.counterstrike-ending__order-effect')).toContainText(
    'persistent production loss is only 15%',
  )
  await page.screenshot({
    path: `${SCREENSHOT_DIRECTORY}/hardened-failure-outcome.png`,
  })

  await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).tap()
  await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expect(page.locator('.operations-damage')).toContainText(
    '−15% PRODUCTION',
  )
})
