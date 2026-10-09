import { expect, test, type Page } from '@playwright/test'
import { createAcceptedCounterstrikeSave, createStrikeReadySave } from './firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'

// Adaptive music in `dry` mode: the harness build runs the full director
// (state machine and scheduling) against a null sink, with no network and no
// sound, and reports it on <main data-music-*>. Build with VITE_E2E_HARNESS=1.

interface MusicState {
  readonly status: string
  readonly arc: string
  readonly cue: string
  readonly lastStinger: string
  readonly stingers: number
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function seed(page: Page, save: string | null): Promise<void> {
  if (save === null) return
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('music-seeded')) {
      localStorage.setItem(key, value)
      sessionStorage.setItem('music-seeded', 'true')
    }
  }, { key: OUTPOST_STORAGE_KEY, value: save })
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
}

async function enter(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
}

async function expectMusic(page: Page, expected: Partial<MusicState>): Promise<void> {
  const main = page.locator('main')
  if (expected.status !== undefined) await expect(main).toHaveAttribute('data-music-status', expected.status)
  if (expected.arc !== undefined) await expect(main).toHaveAttribute('data-music-arc', expected.arc)
  if (expected.cue !== undefined) await expect(main).toHaveAttribute('data-music-cue', expected.cue)
  if (expected.lastStinger !== undefined) await expect(main).toHaveAttribute('data-music-last-stinger', expected.lastStinger)
  if (expected.stingers !== undefined) await expect(main).toHaveAttribute('data-music-stingers', String(expected.stingers))
}

async function dispatch(page: Page, type: string, detail?: unknown): Promise<void> {
  await page.evaluate(({ type, detail }) => window.dispatchEvent(new CustomEvent(type, { detail })), { type, detail })
}

async function finishCameraJourney(page: Page): Promise<void> {
  await dispatch(page, 'moon-core:set-cinematic-progress', { progress: 1 })
}

async function advanceRival(page: Page, phase: string): Promise<void> {
  await dispatch(page, 'rival-signal:advance-presentation')
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', phase)
}

/** Records every change of the strike phase, music cue and stinger count, in the page. */
async function recordMusic(page: Page): Promise<void> {
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement
    const log: string[] = []
    ;(window as typeof window & { __musicLog?: string[] }).__musicLog = log
    const sample = () => {
      const entry = `${main.dataset.firstStrikePresentation}|${main.dataset.musicCue}|${main.dataset.musicStingers}|${main.dataset.musicLastStinger}`
      if (log.at(-1) !== entry) log.push(entry)
    }
    sample()
    new MutationObserver(sample).observe(main, { attributes: true })
  })
}

async function recordedMusic(page: Page): Promise<{ readonly phase: string; readonly cue: string; readonly stingers: number; readonly last: string }[]> {
  const log = await page.evaluate(() => (window as typeof window & { __musicLog?: string[] }).__musicLog ?? [])
  return log.map((entry) => {
    const [phase = '', cue = '', stingers = '0', last = ''] = entry.split('|')
    return { phase, cue, stingers: Number(stingers), last }
  })
}

function distinct(values: readonly string[]): string[] {
  return values.filter((value, index) => index === 0 || values[index - 1] !== value)
}

async function setRun(page: Page, detail: Record<string, unknown>): Promise<void> {
  await dispatch(page, 'counterstrike:set-run', detail)
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', String(detail.status))
}

async function advanceRun(page: Page, status: string): Promise<void> {
  await dispatch(page, 'counterstrike:advance')
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', status)
}

/** Holds a stinger count steady for a moment: a duplicate fire would show up here. */
async function expectStingersStay(page: Page, count: number): Promise<void> {
  await page.waitForTimeout(250)
  await expectMusic(page, { stingers: count })
}

test('silent behind the gate; BEGIN starts RECON; the landing establishes the FOOTHOLD', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await open(page, '/?e2e')
  await expectMusic(page, { status: 'idle', cue: 'SILENT', arc: 'RECON', lastStinger: 'none', stingers: 0 })
  await enter(page)
  await expectMusic(page, { status: 'playing', arc: 'RECON', cue: 'RECON', stingers: 0 })

  const canvas = await page.locator('.scene-canvas canvas').boundingBox()
  if (canvas === null) throw new Error('canvas has no bounds')
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.getByRole('button', { name: 'CLAIM LANDING SITE' }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'approach')
  await expectMusic(page, { cue: 'RECON' })
  await finishCameraJourney(page)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'landed')
  await expectMusic(page, { arc: 'FOOTHOLD', cue: 'FOOTHOLD', stingers: 0 })
  expect(errors).toEqual([])
})

test('the extractor works, Vesper arrives once, the reveal plays its cues and leaves the Moon CONTESTED', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await seed(page, createLegacyActiveExtractorSave())
  await open(page, '/?e2e')
  await enter(page)
  await expectMusic(page, { status: 'playing', arc: 'FOOTHOLD', cue: 'FOOTHOLD_WORKS', stingers: 0 })

  // Back in orbit the held signal is released and the reveal begins.
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).tap()
  await finishCameraJourney(page)
  await expect(page.locator('main')).toHaveAttribute('data-rival-presentation', 'warning')
  await expectMusic(page, { cue: 'REVEAL_APPROACH', lastStinger: 'vesper-arrival', stingers: 1 })
  await advanceRival(page, 'orbital-transition')
  await advanceRival(page, 'capsule-approach')
  await expectMusic(page, { cue: 'REVEAL_APPROACH' })
  await advanceRival(page, 'impact')
  await expectMusic(page, { cue: 'REVEAL_IMPACT' })
  await advanceRival(page, 'intro-transmission')
  await expectMusic(page, { cue: 'REVEAL_TRANSMISSION' })
  await advanceRival(page, 'dual-sites')
  await expectMusic(page, { cue: 'REVEAL_SETTLE' })
  await advanceRival(page, 'idle')
  await expect(page.locator('main')).toHaveAttribute('data-rival-reveal-state', 'REVEALED')
  await expectMusic(page, { arc: 'CONTESTED', cue: 'CONTESTED' })
  await expectStingersStay(page, 1)
  expect(errors).toEqual([])
})

test('First Strike, Counterstrike and the accepted outcome: FS cues → CS cues → ASCENDANT', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = watchErrors(page)
  await seed(page, createStrikeReadySave())
  await open(page, '/?e2e')
  await enter(page)
  await expectMusic(page, { status: 'playing', arc: 'CONTESTED', cue: 'CONTESTED', stingers: 0 })
  await page.getByRole('button', { name: 'RETURN TO ORBIT' }).tap()
  await finishCameraJourney(page)
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'orbit')

  await page.getByRole('button', { name: /ARM LUNAR WARHEAD/ }).tap()
  await expectMusic(page, { cue: 'STRIKE_DECISION', stingers: 0 })
  // The 26.1 s cinematic runs on the game's own phase timers; every change is recorded in the page.
  await recordMusic(page)
  await page.getByRole('button', { name: 'FIRE' }).tap()
  await expect(page.locator('main')).toHaveAttribute('data-first-strike-presentation', 'ending', { timeout: 45_000 })
  await expectMusic(page, { arc: 'RETALIATION', cue: 'FS_BREATH', lastStinger: 'first-strike', stingers: 1 })
  const strike = await recordedMusic(page)
  expect(distinct(strike.map((entry) => entry.cue))).toEqual([
    'STRIKE_DECISION',
    'FS_FLIGHT',
    'FS_TRANSMISSION',
    'FS_FLIGHT',
    'FS_VACUUM',
    'FS_BREATH',
  ])
  const cueDuring = (phase: string) => new Set(strike.filter((entry) => entry.phase === phase).map((entry) => entry.cue))
  expect(cueDuring('vesper-transmission').has('FS_TRANSMISSION')).toBe(true)
  expect(cueDuring('ejecta')).toEqual(new Set(['FS_VACUUM']))
  expect(cueDuring('orbital-pullback')).toEqual(new Set(['FS_BREATH']))
  // The plan's stinger counts once, at the arming edge, however often its timing is refined.
  expect(distinct(strike.map((entry) => String(entry.stingers)))).toEqual(['0', '1'])

  // The Counterstrike begins on its own after the ending hold: Vesper answers once.
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-state', 'command', { timeout: 10_000 })
  await expectMusic(page, { cue: 'CS_ALERT', lastStinger: 'vesper-retaliation', stingers: 2 })
  await page.getByRole('button', { name: /PRIORITIZE INTERCEPTOR/ }).tap()
  await setRun(page, { status: 'warning', progress: 0.2, order: 'PRIORITIZE_INTERCEPTOR' })
  await expectMusic(page, { cue: 'CS_WARNING' })
  await setRun(page, { status: 'tracking', progress: 0.3, attemptNumber: 1, attemptsUsed: 0, attemptElapsedMs: 1_000 })
  await expectMusic(page, { cue: 'CS_COMBAT' })
  await setRun(page, { status: 'intercept-ready', progress: 0.3, attemptNumber: 1, attemptsUsed: 0 })
  await expectMusic(page, { cue: 'CS_COMBAT', stingers: 2 })
  await setRun(page, { status: 'success', progress: 0.1, attemptNumber: 1, attemptsUsed: 1, judgement: 'VALID', outcome: 'SUCCESS' })
  await expectMusic(page, { cue: 'CS_SUCCESS', lastStinger: 'outcome-hold', stingers: 3 })
  await advanceRun(page, 'resolved')
  await expect(page.locator('main')).toHaveAttribute('data-counterstrike-accepted-outcome', 'SUCCESS')
  await expectMusic(page, { arc: 'ASCENDANT', cue: 'ASCENDANT' })
  await expectStingersStay(page, 3)

  // A replayed Counterstrike ending in the impact lands the breach on its contact.
  await page.getByRole('button', { name: /REPLAY COUNTERSTRIKE/ }).tap()
  await expectMusic(page, { cue: 'CS_ALERT', lastStinger: 'vesper-retaliation', stingers: 4 })
  await setRun(page, { status: 'impact', progress: 0, attemptNumber: 2, attemptsUsed: 2, outcome: 'FAILURE', replay: true })
  await expectMusic(page, { cue: 'CS_IMPACT', lastStinger: 'outcome-breach', stingers: 5 })
  await expectStingersStay(page, 5)
  expect(errors).toEqual([])
})

test('Orbital Siege: build, alert, three defense windows, operational', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = watchErrors(page)
  const raw = JSON.parse(createLegacyActiveExtractorSave())
  raw.outpost.lunarOre = 230
  await seed(page, JSON.stringify(raw))
  await page.clock.install()
  await open(page, '/?e2e')
  await enter(page)
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-phase', 'landed')
  await expectMusic(page, { status: 'playing', arc: 'FOOTHOLD', cue: 'FOOTHOLD_WORKS', stingers: 0 })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 2_000))
  await page.getByRole('button', { name: /BUILD ORBITAL PLATFORM/ }).tap()
  await expect(main).toHaveAttribute('data-siege-status', 'constructing')
  await expectMusic(page, { cue: 'SIEGE_BUILD', stingers: 0 })
  await page.clock.fastForward(6_200)
  await expect(main).toHaveAttribute('data-siege-status', 'command')
  await expectMusic(page, { cue: 'SIEGE_ALERT', lastStinger: 'divider-contact', stingers: 1 })
  await page.getByRole('button', { name: /PRIORITIZE DEFENSE/ }).tap()
  await expect(main).toHaveAttribute('data-siege-status', 'waves')
  await expectMusic(page, { cue: 'SIEGE_COMBAT' })
  // Each wave's defense window opens 3.6 s before its hit (18 / 26 / 34 s): jump into each.
  for (let wave = 0; wave < 3; wave += 1) {
    await page.clock.fastForward(wave === 0 ? 8_400 : 8_000)
    await expect(main).toHaveAttribute('data-platform-defense', 'true')
    await expectMusic(page, { cue: 'SIEGE_COMBAT', lastStinger: 'divider-contact', stingers: 2 + wave })
  }
  await page.clock.fastForward(4_000)
  await expect(main).toHaveAttribute('data-siege-status', 'operational')
  await expectMusic(page, { lastStinger: 'outcome-hold', stingers: 5 })
  // An operational platform unlocks monuments; the selector opens with the claim previewing.
  await expect(main).toHaveAttribute('data-monument-view', 'true')
  await expectMusic(page, { cue: 'MONUMENT_CHOICES' })
  await expectStingersStay(page, 5)
  expect(errors).toEqual([])
})

test('Territory Monument: build, three waves, damage and repair, the reveal, CLAIMED', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = watchErrors(page)
  const raw = JSON.parse(createAcceptedCounterstrikeSave('FAILURE'))
  raw.outpost.lunarOre = 230
  await seed(page, JSON.stringify(raw))
  await page.clock.install()
  await open(page, '/?e2e')
  await enter(page)
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-monument-view', 'true')
  await expectMusic(page, { status: 'playing', arc: 'ASCENDANT', cue: 'MONUMENT_CHOICES', stingers: 0 })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000))
  await page.getByRole('button', { name: /CRATER CROWN/ }).tap()
  await expect(main).toHaveAttribute('data-monument-status', 'constructing')
  await expectMusic(page, { cue: 'MONUMENT_BUILD' })
  await page.clock.fastForward(4_200)
  await expect(main).toHaveAttribute('data-monument-status', 'command')
  await expectMusic(page, { cue: 'MONUMENT_ALERT', lastStinger: 'divider-contact', stingers: 1 })
  // The command waits indefinitely; let the first contact (one bar) finish before the order.
  await page.clock.fastForward(3_000)
  for (let wave = 0; wave < 3; wave += 1) {
    await page.getByRole('button', { name: /PRESERVE PRODUCTION/ }).tap()
    await expect(main).toHaveAttribute('data-monument-status', 'wave')
    await expectMusic(page, { cue: 'MONUMENT_COMBAT', lastStinger: 'divider-contact', stingers: 2 + wave })
    await page.clock.fastForward(3_200)
    await page.clock.fastForward(5_000)
    await expect(main).toHaveAttribute('data-monument-waves', String(wave + 1))
    if (wave < 2) await expectMusic(page, { cue: 'MONUMENT_ALERT', stingers: 2 + wave })
  }
  await expect(main).toHaveAttribute('data-monument-status', 'damaged')
  await expectMusic(page, { cue: 'MONUMENT_DAMAGED', lastStinger: 'outcome-breach', stingers: 5 })
  await page.getByRole('button', { name: /REPAIR MONUMENT/ }).tap()
  await page.clock.fastForward(7_200)
  await expect(main).toHaveAttribute('data-monument-status', 'repairing')
  await expectMusic(page, { cue: 'MONUMENT_DAMAGED', stingers: 5 })
  await page.clock.fastForward(8_500)
  await expect(main).toHaveAttribute('data-monument-status', 'complete')
  await expect(main).toHaveAttribute('data-monument-reveal', 'true')
  await expectMusic(page, { arc: 'CLAIMED', cue: 'MONUMENT_REVEAL', lastStinger: 'territory-claimed', stingers: 6 })
  await page.clock.fastForward(6_500)
  await expect(main).toHaveAttribute('data-monument-reveal', 'false')
  await expectMusic(page, { arc: 'CLAIMED', cue: 'CLAIMED', stingers: 6 })
  // REPLAY ORBITAL REVEAL replays the payoff once its 9.6 s stinger has finished.
  await page.clock.fastForward(3_500)
  await page.getByRole('button', { name: 'REPLAY ORBITAL REVEAL' }).tap()
  await expectMusic(page, { cue: 'MONUMENT_REVEAL', stingers: 7 })
  await expectStingersStay(page, 7)

  // A refreshed CLAIMED session starts in its state and replays nothing.
  await page.clock.resume()
  await page.reload()
  await expect(main).toHaveAttribute('data-scene-ready', 'true')
  await enter(page)
  await expectMusic(page, { status: 'playing', arc: 'CLAIMED', stingers: 0, lastStinger: 'none' })
  await expectStingersStay(page, 0)
  expect(errors).toEqual([])
})

test('lifecycle: hidden suspends, visible resumes, SOUND toggles, NEW GAME stops and the next BEGIN restarts', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await seed(page, createStrikeReadySave())
  await open(page, '/?e2e')
  await enter(page)
  const main = page.locator('main')
  await expectMusic(page, { status: 'playing', arc: 'CONTESTED', cue: 'CONTESTED' })

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expectMusic(page, { status: 'suspended' })
  await page.evaluate(() => {
    delete (document as Document & { visibilityState?: string }).visibilityState
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expectMusic(page, { status: 'playing', cue: 'CONTESTED', stingers: 0 })

  await page.getByRole('button', { name: 'SOUND ON' }).tap()
  await expectMusic(page, { status: 'suspended' })
  await page.getByRole('button', { name: 'SOUND OFF' }).tap()
  await expectMusic(page, { status: 'playing', cue: 'CONTESTED', stingers: 0 })

  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'NEW GAME' }).tap()
  await expect(main).toHaveAttribute('data-entry-open', 'true')
  await expectMusic(page, { status: 'stopped', cue: 'SILENT', stingers: 0 })
  await expect(page.getByRole('button', { name: 'BEGIN INVASION' })).toBeVisible()
  await enter(page)
  await expectMusic(page, { status: 'playing', arc: 'RECON', cue: 'RECON', stingers: 0 })
  expect(errors).toEqual([])
})

test('production smoke: no music before BEGIN; BEGIN with SOUND ON loads BED and ENGINE first', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  const music: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/music/') || url.pathname.includes('musicManifest')) music.push(url.pathname)
  })
  await open(page, '/')
  await page.waitForTimeout(1_000)
  expect(music).toEqual([])
  await expectMusic(page, { status: 'idle', cue: 'SILENT' })
  await enter(page)
  await expect.poll(() => music.filter((path) => path.startsWith('/music/')).slice(0, 2), { timeout: 15_000 }).toEqual([
    expect.stringMatching(/^\/music\/bed\.[0-9a-f]{10}\.mp3$/),
    expect.stringMatching(/^\/music\/engine\.[0-9a-f]{10}\.mp3$/),
  ])
  await expectMusic(page, { status: 'playing', arc: 'RECON', cue: 'RECON' })
  expect(errors).toEqual([])
})

test('SOUND OFF at BEGIN and ?music=0 never fetch music', async ({ page }) => {
  test.setTimeout(90_000)
  const music: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/music/')) music.push(request.url())
  })
  await open(page, '/')
  await page.locator('.launch-gate__sound').tap()
  await expect(page.locator('.launch-gate__sound')).toHaveText('SOUND OFF')
  await enter(page)
  await page.waitForTimeout(1_000)
  await expectMusic(page, { status: 'disabled', cue: 'SILENT' })
  expect(music).toEqual([])

  const capture = await page.context().newPage()
  capture.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/music/')) music.push(request.url())
  })
  await open(capture, '/?music=0')
  await enter(capture)
  await capture.waitForTimeout(1_000)
  await expectMusic(capture, { status: 'disabled', cue: 'SILENT', stingers: 0 })
  expect(music).toEqual([])
})
