# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-operations.spec.ts >> live HUD supports all modes, touch sizing, persistence, and demand rendering
- Location: e2e/outpost-operations.spec.ts:122:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('main')
Expected: "OVERDRIVE"
Received: "BALANCED"
Timeout:  10000ms

Call log:
  - Expect "toHaveAttribute" with timeout 10000ms
  - waiting for locator('main')
    15 × locator resolved to <main class="app-shell" data-phase="landed" data-quality="medium" data-scene-ready="true" data-robot-state="idle" data-rival-stage="none" data-entry-open="false" data-rival-focus="false" data-scar-created="false" data-scar-latitude="none" data-render-mode="demand" data-rival-damaged="false" data-scar-longitude="none" data-selected-deposit="none" data-launch-complete="false" data-impact-complete="false" data-ending-complete="false" data-rival-signal-held="true" data-repairs-required="false" data-extr…>…</main>
       - unexpected value "BALANCED"

```

```yaml
- main "Shoot the Moon technical prototype":
  - text: SHOOT THE MOON
  - strong: FIRST OUTPOST
  - text: EXTRACTION ONLINE
  - button "SOUND ON"
  - button "RESET PROTOTYPE"
  - region "Outpost status"
  - status: SIGNAL HELD · RETURN TO ORBIT
  - region "Outpost operations"
```

# Test source

```ts
  47  |   await page.getByRole('button', { name: /^(BEGIN INVASION|CONTINUE)$/ }).click()
  48  |   await expect(page.locator('main')).toHaveAttribute('data-entry-open', 'false')
  49  | }
  50  | 
  51  | async function tapOutpostSignal(page: Page) {
  52  |   const canvas = page.locator('.scene-canvas canvas')
  53  |   await expect(canvas).toHaveAttribute('data-outpost-signal-x', /\d/)
  54  |   const x = Number(await canvas.getAttribute('data-outpost-signal-x'))
  55  |   const y = Number(await canvas.getAttribute('data-outpost-signal-y'))
  56  |   const bounds = await canvas.boundingBox()
  57  |   if (bounds === null) throw new Error('Canvas has no bounds.')
  58  |   await page.mouse.click(bounds.x + x, bounds.y + y)
  59  | }
  60  | 
  61  | async function finishCameraTransition(page: Page) {
  62  |   await page.evaluate(() =>
  63  |     window.dispatchEvent(
  64  |       new CustomEvent('moon-core:set-cinematic-progress', {
  65  |         detail: { progress: 1 },
  66  |       }),
  67  |     ),
  68  |   )
  69  | }
  70  | 
  71  | async function expectViewportSafe(page: Page) {
  72  |   const safe = await page.evaluate(() => {
  73  |     const panel = document.querySelector('.operations-panel')
  74  |     if (!(panel instanceof HTMLElement)) return false
  75  |     const bounds = panel.getBoundingClientRect()
  76  |     return (
  77  |       document.documentElement.scrollWidth <= window.innerWidth &&
  78  |       bounds.left >= 0 &&
  79  |       bounds.top >= 0 &&
  80  |       bounds.right <= window.innerWidth &&
  81  |       bounds.bottom <= window.innerHeight
  82  |     )
  83  |   })
  84  |   expect(safe).toBe(true)
  85  | }
  86  | 
  87  | test.beforeAll(async () => {
  88  |   await mkdir(SCREENSHOT_DIRECTORY, { recursive: true })
  89  | })
  90  | 
  91  | test('landing preview reports deterministic real site qualities', async ({ page }) => {
  92  |   const errors = watchErrors(page)
  93  |   await openScene(page)
  94  |   const canvas = page.locator('.scene-canvas canvas')
  95  |   const bounds = await canvas.boundingBox()
  96  |   if (bounds === null) throw new Error('Canvas has no bounds.')
  97  | 
  98  |   await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  99  |   const panel = page.locator('.site-panel')
  100 |   await expect(panel).toBeVisible()
  101 |   const latitude = Number(await panel.getAttribute('data-latitude-rad'))
  102 |   const longitude = Number(await panel.getAttribute('data-longitude-rad'))
  103 |   const expected = analyzeLandingSite(
  104 |     createLandingSite(createLunarLocation(latitude, longitude, 0)),
  105 |   )
  106 |   const qualities = panel.locator('.site-qualities strong')
  107 | 
  108 |   await expect(qualities).toHaveText([
  109 |     expected.solarQuality.toUpperCase(),
  110 |     expected.extractionQuality.toUpperCase(),
  111 |     expected.logisticsQuality.toUpperCase(),
  112 |   ])
  113 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/01-site-comparison.png` })
  114 | 
  115 |   await page.setViewportSize({ width: 844, height: 390 })
  116 |   await expect(page.getByRole('button', { name: 'CLAIM LANDING SITE' })).toBeVisible()
  117 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  118 |   await page.setViewportSize({ width: 390, height: 844 })
  119 |   expect(errors).toEqual({ console: [], page: [] })
  120 | })
  121 | 
  122 | test('live HUD supports all modes, touch sizing, persistence, and demand rendering', async ({ page }) => {
  123 |   const errors = watchErrors(page)
  124 |   await openScene(page, createLegacyActiveExtractorSave())
  125 |   const main = page.locator('main')
  126 |   const panel = page.locator('.operations-panel')
  127 |   await expect(panel).toBeVisible()
  128 |   await expect(main).toHaveAttribute('data-operating-mode', 'BALANCED')
  129 |   await expectViewportSafe(page)
  130 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/02-live-operational-hud.png` })
  131 | 
  132 |   const rates: number[] = []
  133 |   for (const mode of ['CONSERVE', 'BALANCED', 'OVERDRIVE'] as const) {
  134 |     const button = page.getByRole('button', { name: mode, exact: true })
  135 |     const box = await button.boundingBox()
  136 |     expect(box?.height).toBeGreaterThanOrEqual(44)
  137 |     await button.tap()
  138 |     await expect(main).toHaveAttribute('data-operating-mode', mode)
  139 |     rates.push(Number(await main.getAttribute('data-operation-rate')))
  140 |   }
  141 |   expect(rates[0]!).toBeLessThan(rates[1]!)
  142 |   expect(rates[1]!).toBeLessThanOrEqual(rates[2]!)
  143 |   await expect(main).toHaveAttribute('data-render-mode', 'demand')
  144 | 
  145 |   await page.reload()
  146 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
> 147 |   await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
      |                      ^ Error: expect(locator).toHaveAttribute(expected) failed
  148 |   await page.setViewportSize({ width: 844, height: 390 })
  149 |   await expectViewportSafe(page)
  150 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/03-live-hud-landscape.png` })
  151 |   expect(errors).toEqual({ console: [], page: [] })
  152 | })
  153 | 
  154 | test('low energy and storage saturation are explicit and visible', async ({ page }) => {
  155 |   const errors = watchErrors(page)
  156 |   const lowEnergySite = createLandingSite(
  157 |     createLunarLocation((40 * Math.PI) / 180, (50 * Math.PI) / 180, 0),
  158 |   )
  159 |   await openScene(page, createActiveExtractorSaveForSite(lowEnergySite))
  160 |   const main = page.locator('main')
  161 |   await expect(main).toHaveAttribute('data-operation-status', 'LOW ENERGY')
  162 |   expect(Number(await main.getAttribute('data-operation-energy-throttle'))).toBeLessThan(1)
  163 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeGreaterThan(0)
  164 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04-low-energy.png` })
  165 | 
  166 |   const fullRaw = JSON.parse(createLegacyActiveExtractorSave()) as {
  167 |     outpost: { lunarOre: number; operations?: { storageCapacity: number } }
  168 |   }
  169 |   fullRaw.outpost.lunarOre = 240
  170 |   if (fullRaw.outpost.operations !== undefined) {
  171 |     fullRaw.outpost.operations.storageCapacity = 240
  172 |   }
  173 |   await page.evaluate(
  174 |     ({ key, value }) => localStorage.setItem(key, value),
  175 |     { key: OUTPOST_STORAGE_KEY, value: JSON.stringify(fullRaw) },
  176 |   )
  177 |   await page.reload()
  178 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
  179 |   await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  180 |   await expect(main).toHaveAttribute('data-operation-active-robots', '0')
  181 |   await expect(main).toHaveAttribute('data-operation-rate', '0')
  182 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05-storage-full.png` })
  183 |   expect(errors).toEqual({ console: [], page: [] })
  184 | })
  185 | 
  186 | test('accepted Counterstrike damage produces the exact persistent penalty', async ({ page }) => {
  187 |   const errors = watchErrors(page)
  188 |   const save = createAcceptedCounterstrikeSave('FAILURE')
  189 |   const restored = deserializePrototypeSave(save, Date.now())!
  190 |   const expected = calculateOutpostOperations(restored.outpost, 'DAMAGED')
  191 |   const intact = calculateOutpostOperations(restored.outpost, 'INTACT')
  192 |   await openScene(page, save)
  193 |   const main = page.locator('main')
  194 | 
  195 |   await page.evaluate(() =>
  196 |     window.dispatchEvent(
  197 |       new CustomEvent('counterstrike:set-run', { detail: { status: 'dormant' } }),
  198 |     ),
  199 |   )
  200 |   await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  201 |   await tapOutpostSignal(page)
  202 |   await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  203 |   await finishCameraTransition(page)
  204 |   await expect(main).toHaveAttribute('data-phase', 'landed')
  205 |   await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  206 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(
  207 |     expected.productionPerMin,
  208 |     8,
  209 |   )
  210 |   expect(expected.productionPerMin).toBeCloseTo(
  211 |     intact.productionPerMin * 0.7,
  212 |     10,
  213 |   )
  214 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/06-damaged-production.png` })
  215 |   expect(errors).toEqual({ console: [], page: [] })
  216 | })
  217 | 
```