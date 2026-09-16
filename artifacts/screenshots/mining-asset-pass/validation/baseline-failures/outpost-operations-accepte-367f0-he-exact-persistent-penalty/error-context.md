# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-operations.spec.ts >> accepted Counterstrike damage produces the exact persistent penalty
- Location: e2e/outpost-operations.spec.ts:192:1

# Error details

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' })

```

# Page snapshot

```yaml
- main "Shoot the Moon technical prototype" [ref=e3]:
  - generic "Moon Core 3D viewport" [ref=e4]
  - region "Territory Monuments" [ref=e7]:
    - generic [ref=e8]:
      - generic [ref=e9]:
        - text: TERRITORY MONUMENTS
        - heading "LEAVE A PERMANENT MARK" [level=1] [ref=e10]
      - button "Close Territory Monuments" [ref=e11] [cursor=pointer]: ×
    - paragraph [ref=e12]: One monument. One territory. Three final defense waves.
    - paragraph [ref=e13]: 36 ORE STORED · 17.7 kW SOLAR · 3 ROBOTS
    - generic [ref=e14]:
      - button "HELIOS SPIRE +25% solar energy production. 80 ore · 72 kW·s · 36 robot-seconds" [disabled] [ref=e15]:
        - generic [ref=e18]:
          - strong [ref=e19]: HELIOS SPIRE
          - generic [ref=e20]: +25% solar energy production.
          - generic [ref=e21]: 80 ore · 72 kW·s · 36 robot-seconds
      - button "CRATER CROWN +20% extraction at this territory’s selected terrain. 90 ore · 84 kW·s · 42 robot-seconds" [disabled] [ref=e22]:
        - generic [ref=e25]:
          - strong [ref=e26]: CRATER CROWN
          - generic [ref=e27]: +20% extraction at this territory’s selected terrain.
          - generic [ref=e28]: 90 ore · 84 kW·s · 42 robot-seconds
      - button "BASTION OBELISK 25% less siege damage; +50% repair speed; halves production damage effects. 100 ore · 96 kW·s · 48 robot-seconds" [disabled] [ref=e29]:
        - generic [ref=e32]:
          - strong [ref=e33]: BASTION OBELISK
          - generic [ref=e34]: 25% less siege damage; +50% repair speed; halves production damage effects.
          - generic [ref=e35]: 100 ore · 96 kW·s · 48 robot-seconds
      - button "SIGNAL ARRAY Halves logistics losses; +50% rival scan speed and detection lead. 80 ore · 72 kW·s · 36 robot-seconds" [disabled] [ref=e36]:
        - generic [ref=e39]:
          - strong [ref=e40]: SIGNAL ARRAY
          - generic [ref=e41]: Halves logistics losses; +50% rival scan speed and detection lead.
          - generic [ref=e42]: 80 ore · 72 kW·s · 36 robot-seconds
    - paragraph [ref=e43]: Ore paid once. Labor shares your 3 robots at 2 kW each; defense reserves up to 6 kW more. Work needs an idle miner, completed module and siege work, and at least 6 kW solar. Construction and defense reduce mining.
    - generic [ref=e44]:
      - button "BACK TO OUTPOST" [ref=e45] [cursor=pointer]
      - button "RESET PROTOTYPE" [ref=e46] [cursor=pointer]
```

# Test source

```ts
  101 |     expected.extractionQuality.toUpperCase(),
  102 |     expected.logisticsQuality.toUpperCase(),
  103 |   ])
  104 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/01-site-comparison.png` })
  105 | 
  106 |   await page.setViewportSize({ width: 844, height: 390 })
  107 |   await expect(page.getByRole('button', { name: 'CLAIM LANDING SITE' })).toBeVisible()
  108 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  109 |   await page.setViewportSize({ width: 390, height: 844 })
  110 |   expect(errors).toEqual({ console: [], page: [] })
  111 | })
  112 | 
  113 | test('live HUD supports all modes, touch sizing, persistence, and demand rendering', async ({ page }) => {
  114 |   const errors = watchErrors(page)
  115 |   await openScene(page, createLegacyActiveExtractorSave())
  116 |   const main = page.locator('main')
  117 |   const panel = page.locator('.operations-panel')
  118 |   await expect(panel).toBeVisible()
  119 |   await expect(main).toHaveAttribute('data-operating-mode', 'BALANCED')
  120 |   await expectViewportSafe(page)
  121 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/02-live-operational-hud.png` })
  122 | 
  123 |   const rates: number[] = []
  124 |   for (const mode of ['CONSERVE', 'BALANCED', 'OVERDRIVE'] as const) {
  125 |     const button = page.getByRole('button', { name: mode, exact: true })
  126 |     const box = await button.boundingBox()
  127 |     expect(box?.height).toBeGreaterThanOrEqual(44)
  128 |     await button.tap()
  129 |     await expect(main).toHaveAttribute('data-operating-mode', mode)
  130 |     rates.push(Number(await main.getAttribute('data-operation-rate')))
  131 |   }
  132 |   expect(rates[0]!).toBeLessThan(rates[1]!)
  133 |   expect(rates[1]!).toBeLessThanOrEqual(rates[2]!)
  134 |   await expect(main).toHaveAttribute('data-render-mode', 'demand')
  135 | 
  136 |   await page.reload()
  137 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
  138 |   await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  139 |   await page.setViewportSize({ width: 844, height: 390 })
  140 |   await expectViewportSafe(page)
  141 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/03-live-hud-landscape.png` })
  142 |   expect(errors).toEqual({ console: [], page: [] })
  143 | })
  144 | 
  145 | test('low energy throttling is explicit in both orientations', async ({ page }) => {
  146 |   const errors = watchErrors(page)
  147 |   const lowEnergySite = createLandingSite(
  148 |     createLunarLocation((40 * Math.PI) / 180, (50 * Math.PI) / 180, 0),
  149 |   )
  150 |   await openScene(page, createActiveExtractorSaveForSite(lowEnergySite))
  151 |   const main = page.locator('main')
  152 |   await expect(main).toHaveAttribute('data-operation-status', 'LOW ENERGY')
  153 |   expect(Number(await main.getAttribute('data-operation-energy-throttle'))).toBeLessThan(1)
  154 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeGreaterThan(0)
  155 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04-low-energy.png` })
  156 | 
  157 |   await page.setViewportSize({ width: 844, height: 390 })
  158 |   await expectViewportSafe(page)
  159 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/04b-low-energy-landscape.png` })
  160 |   expect(errors).toEqual({ console: [], page: [] })
  161 | })
  162 | 
  163 | test('full storage stays stopped across ticks and refresh in both orientations', async ({ page }) => {
  164 |   const errors = watchErrors(page)
  165 |   const main = page.locator('main')
  166 |   const fullRaw = JSON.parse(createLegacyActiveExtractorSave()) as {
  167 |     outpost: { lunarOre: number; operations?: { storageCapacity: number } }
  168 |   }
  169 |   fullRaw.outpost.lunarOre = 240
  170 |   if (fullRaw.outpost.operations !== undefined) {
  171 |     fullRaw.outpost.operations.storageCapacity = 240
  172 |   }
  173 |   await openScene(page, JSON.stringify(fullRaw))
  174 |   await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  175 |   await expect(main).toHaveAttribute('data-operation-active-robots', '0')
  176 |   await expect(main).toHaveAttribute('data-operation-rate', '0')
  177 |   await expectViewportSafe(page)
  178 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05-storage-full.png` })
  179 |   await page.setViewportSize({ width: 844, height: 390 })
  180 |   await expectViewportSafe(page)
  181 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/05b-storage-full-landscape.png` })
  182 |   await page.waitForTimeout(1_200)
  183 |   await expect(main).toHaveAttribute('data-lunar-ore', '240')
  184 |   await page.reload()
  185 |   await page.getByRole('button', { name: 'CONTINUE' }).click()
  186 |   await expect(main).toHaveAttribute('data-operation-status', 'STORAGE FULL')
  187 |   await expect(main).toHaveAttribute('data-lunar-ore', '240')
  188 |   await expect(main).toHaveAttribute('data-operation-rate', '0')
  189 |   expect(errors).toEqual({ console: [], page: [] })
  190 | })
  191 | 
  192 | test('accepted Counterstrike damage produces the exact persistent penalty', async ({ page }) => {
  193 |   const errors = watchErrors(page)
  194 |   const save = createAcceptedCounterstrikeSave('FAILURE')
  195 |   const restored = deserializePrototypeSave(save, Date.now())!
  196 |   const expected = calculateOutpostOperations(restored.outpost, 'DAMAGED')
  197 |   const intact = calculateOutpostOperations(restored.outpost, 'INTACT')
  198 |   await openScene(page, save)
  199 |   const main = page.locator('main')
  200 | 
> 201 |   await page.getByRole('button', { name: 'VIEW OUTPOST OPERATIONS' }).click()
      |                                                                       ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  202 |   await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  203 |   await expect(main).toHaveAttribute('data-phase', 'selected')
  204 |   await page.getByRole('button', { name: 'REVISIT OUTPOST' }).click()
  205 |   await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  206 |   await expect(main).toHaveAttribute('data-outpost-damage-state', 'DAMAGED')
  207 |   expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(
  208 |     expected.productionPerMin,
  209 |     8,
  210 |   )
  211 |   expect(expected.productionPerMin).toBeCloseTo(
  212 |     intact.productionPerMin * 0.7,
  213 |     10,
  214 |   )
  215 |   await page.screenshot({ path: `${SCREENSHOT_DIRECTORY}/06-damaged-production.png` })
  216 |   expect(errors).toEqual({ console: [], page: [] })
  217 | })
  218 | 
```