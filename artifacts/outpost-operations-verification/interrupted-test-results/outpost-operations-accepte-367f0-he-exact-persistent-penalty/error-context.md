# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-operations.spec.ts >> accepted Counterstrike damage produces the exact persistent penalty
- Location: e2e/outpost-operations.spec.ts:186:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'REVISIT OUTPOST' })

```

# Page snapshot

```yaml
- main "Shoot the Moon technical prototype" [ref=e3]:
  - generic "Moon Core 3D viewport" [ref=e4]
  - generic:
    - generic:
      - generic:
        - generic: SHOOT THE MOON
        - strong: SCARRED MOON
      - generic:
        - generic: SCARRED MOON · ORBITAL RECORD
        - generic [ref=e7]:
          - button "SOUND ON" [ref=e8] [cursor=pointer]
          - button "RESET PROTOTYPE" [ref=e9] [cursor=pointer]
  - generic [ref=e10]:
    - generic [ref=e11]:
      - generic [ref=e12]: FIRST STRIKE COMPLETE
      - generic [ref=e13]: PERMANENT SCAR · NULL MERIDIAN
    - generic [ref=e14]:
      - button "EXPLORE SCAR" [ref=e15] [cursor=pointer]
      - button "REPLAY STRIKE" [ref=e16] [cursor=pointer]
```

# Test source

```ts
  102 |   await expect(panel).toBeVisible()
  103 |   const latitude = Number(await panel.getAttribute('data-latitude-rad'))
  104 |   const longitude = Number(await panel.getAttribute('data-longitude-rad'))
  105 |   const expected = analyzeLandingSite(
  106 |     createLandingSite(createLunarLocation(latitude, longitude, 0)),
  107 |   )
  108 |   const qualities = panel.locator('.site-qualities strong')
  109 | 
  110 |   await expect(qualities).toHaveText([
  111 |     expected.solarQuality.toUpperCase(),
  112 |     expected.extractionQuality.toUpperCase(),
  113 |     expected.logisticsQuality.toUpperCase(),
  114 |   ])
  115 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/01-site-comparison.png` })
  116 | 
  117 |   await page.setViewportSize({ width: 844, height: 390 })
  118 |   await expect(page.getByRole('button', { name: 'CLAIM LANDING SITE' })).toBeVisible()
  119 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  120 |   await page.setViewportSize({ width: 390, height: 844 })
  121 |   expect(errors).toEqual({ console: [], page: [] })
  122 | })
  123 | 
  124 | test('live HUD supports all modes, touch sizing, persistence, and demand rendering', async ({ page }) => {
  125 |   const errors = watchErrors(page)
  126 |   await openScene(page, createLegacyActiveExtractorSave())
  127 |   const main = page.locator('main')
  128 |   const panel = page.locator('.operations-panel')
  129 |   await expect(panel).toBeVisible()
  130 |   await expect(main).toHaveAttribute('data-operating-mode', 'BALANCED')
  131 |   await expectViewportSafe(page)
  132 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/02-live-operational-hud.png` })
  133 | 
  134 |   const rates: number[] = []
  135 |   for (const mode of ['CONSERVE', 'BALANCED', 'OVERDRIVE'] as const) {
  136 |     const button = page.getByRole('button', { name: mode, exact: true })
  137 |     const box = await button.boundingBox()
  138 |     expect(box?.height).toBeGreaterThanOrEqual(44)
  139 |     await button.tap()
  140 |     await expect(main).toHaveAttribute('data-operating-mode', mode)
  141 |     rates.push(Number(await main.getAttribute('data-operation-rate')))
  142 |   }
  143 |   expect(rates[0]!).toBeLessThan(rates[1]!)
  144 |   expect(rates[1]!).toBeLessThanOrEqual(rates[2]!)
  145 |   await expect(main).toHaveAttribute('data-render-mode', 'demand')
  146 | 
  147 |   await page.reload()
  148 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
  149 |   await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  150 |   await page.setViewportSize({ width: 844, height: 390 })
  151 |   await expectViewportSafe(page)
  152 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/03-live-hud-landscape.png` })
  153 |   expect(errors).toEqual({ console: [], page: [] })
  154 | })
  155 | 
  156 | test('low energy and storage saturation are explicit and visible', async ({ page }) => {
  157 |   const errors = watchErrors(page)
  158 |   const lowEnergySite = createLandingSite(
  159 |     createLunarLocation((40 * Math.PI) / 180, (50 * Math.PI) / 180, 0),
  160 |   )
  161 |   await openScene(page, createActiveExtractorSaveForSite(lowEnergySite))
  162 |   const main = page.locator('main')
  163 |   await expect(main).toHaveAttribute('data-operation-status', 'LOW ENERGY')
  164 |   expect(Number(await main.getAttribute('data-operation-energy-throttle'))).toBeLessThan(1)
  165 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeGreaterThan(0)
  166 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04-low-energy.png` })
  167 | 
  168 |   const fullRaw = JSON.parse(createLegacyActiveExtractorSave()) as {
  169 |     outpost: { lunarOre: number; operations?: { storageCapacity: number } }
  170 |   }
  171 |   fullRaw.outpost.lunarOre = 240
  172 |   if (fullRaw.outpost.operations !== undefined) {
  173 |     fullRaw.outpost.operations.storageCapacity = 240
  174 |   }
  175 |   await page.evaluate(
  176 |     ({ key, value }) => localStorage.setItem(key, value),
  177 |     { key: OUTPOST_STORAGE_KEY, value: JSON.stringify(fullRaw) },
  178 |   )
  179 |   await page.reload()
  180 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
  181 |   await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  182 |   await expect(main).toHaveAttribute('data-operation-active-robots', '0')
  183 |   await expect(main).toHaveAttribute('data-operation-rate', '0')
  184 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05-storage-full.png` })
  185 |   expect(errors).toEqual({ console: [], page: [] })
  186 | })
  187 | 
  188 | test('accepted Counterstrike damage produces the exact persistent penalty', async ({ page }) => {
  189 |   const errors = watchErrors(page)
  190 |   const save = createAcceptedCounterstrikeSave('FAILURE')
  191 |   const restored = deserializePrototypeSave(save, Date.now())!
  192 |   const expected = calculateOutpostOperations(restored.outpost, 'DAMAGED')
  193 |   const intact = calculateOutpostOperations(restored.outpost, 'INTACT')
  194 |   await openScene(page, save)
  195 |   const main = page.locator('main')
  196 | 
  197 |   await page.evaluate(() =>
  198 |     window.dispatchEvent(
  199 |       new CustomEvent('counterstrike:set-run', { detail: { status: 'dormant' } }),
  200 |     ),
  201 |   )
> 202 |   await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
      |                                                               ^ Error: locator.click: Test timeout of 60000ms exceeded.
  203 |   await tapOutpostSignal(page)
  204 |   await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  205 |   await finishCameraTransition(page)
  206 |   await expect(main).toHaveAttribute('data-phase', 'landed')
  207 |   await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  208 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(
  209 |     expected.productionPerMin,
  210 |     8,
  211 |   )
  212 |   expect(expected.productionPerMin).toBeCloseTo(
  213 |     intact.productionPerMin * 0.7,
  214 |     10,
  215 |   )
  216 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/06-damaged-production.png` })
  217 |   expect(errors).toEqual({ console: [], page: [] })
  218 | })
  219 | 
```