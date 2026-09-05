# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-revisit.spec.ts >> accepted FAILURE ending returns to persistent operations with real camera and touch
- Location: e2e/outpost-revisit.spec.ts:92:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('main')
Expected: "selected"
Received: "orbit"
Timeout:  10000ms

Call log:
  - Expect "toHaveAttribute" with timeout 10000ms
  - waiting for locator('main')
    24 × locator resolved to <main class="app-shell" data-phase="orbit" data-quality="medium" data-scene-ready="true" data-robot-state="idle" data-entry-open="false" data-rival-focus="false" data-scar-created="true" data-rival-damaged="true" data-render-mode="demand" data-launch-complete="true" data-impact-complete="true" data-ending-complete="true" data-selected-deposit="none" data-repairs-required="true" data-lunar-control="scarred" data-extractor-status="active" data-rival-presentation="idle" data-rival-signal-held="false" d…>…</main>
       - unexpected value "orbit"

```

```yaml
- main "Shoot the Moon technical prototype":
  - text: SHOOT THE MOON
  - strong: SCARRED MOON
  - text: SCARRED MOON · ORBITAL RECORD
  - button "SOUND ON"
  - button "RESET PROTOTYPE"
  - text: FIRST STRIKE COMPLETE PERMANENT SCAR · NULL MERIDIAN
  - button "EXPLORE SCAR"
  - button "REPLAY STRIKE"
```

# Test source

```ts
  84  | }
  85  | 
  86  | test.beforeAll(async ({ request }) => {
  87  |   await mkdir(EVIDENCE, { recursive: true })
  88  |   expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
  89  | })
  90  | 
  91  | for (const outcome of ['FAILURE', 'SUCCESS'] as const) {
  92  |   test(`accepted ${outcome} ending returns to persistent operations with real camera and touch`, async ({ page }) => {
  93  |     test.setTimeout(180_000)
  94  |     const errors: string[] = []
  95  |     page.on('pageerror', (error) => errors.push(error.message))
  96  |     page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  97  |     const raw = JSON.parse(createAcceptedCounterstrikeSave(outcome))
  98  |     raw.outpost.lunarOre = 100.25
  99  |     raw.outpost.operations.mode = 'OVERDRIVE'
  100 |     raw.outpost.operations.storageCapacity = 320
  101 |     await page.addInitScript(({ key, value }) => {
  102 |       Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
  103 |       Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  104 |       if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
  105 |     }, { key: OUTPOST_STORAGE_KEY, value: JSON.stringify(raw) })
  106 |     await page.goto('/')
  107 |     await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  108 |     await page.getByRole('button', { name: 'CONTINUE' }).tap()
  109 |     const initial = await saved(page)
  110 |     const expected = calculateOutpostOperations(initial.outpost, initial.counterstrike.outpostDamageState)
  111 |     await enterOperations(page)
  112 |     const main = page.locator('main')
  113 |     await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', outcome)
  114 |     await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  115 |     await expect(main).toHaveAttribute('data-outpost-damage-state', outcome === 'FAILURE' ? 'DAMAGED' : 'INTACT')
  116 |     expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
  117 |     if (outcome === 'FAILURE') {
  118 |       await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-damage-field', 'persistent')
  119 |       await expect(page.getByText('OUTPOST DAMAGED · −30% PRODUCTION', { exact: true })).toBeVisible()
  120 |       expect(expected.productionPerMin).toBeCloseTo(calculateOutpostOperations(initial.outpost, 'INTACT').productionPerMin * 0.7, 10)
  121 |     } else {
  122 |       await expect(page.locator('.operations-damage')).toHaveCount(0)
  123 |       expect(expected.damageMultiplier).toBe(1)
  124 |     }
  125 |     const energy = await page.locator('.operations-metrics > div').first().innerText()
  126 |     const canvas = page.locator('canvas')
  127 |     const azimuth = await canvas.getAttribute('data-camera-azimuth')
  128 |     await cameraGesture(page, false)
  129 |     await page.waitForTimeout(1_200)
  130 |     await expect(canvas).not.toHaveAttribute('data-camera-azimuth', azimuth!)
  131 |     const distance = await canvas.getAttribute('data-camera-distance')
  132 |     await cameraGesture(page, true)
  133 |     await page.waitForTimeout(1_200)
  134 |     await expect(canvas).not.toHaveAttribute('data-camera-distance', distance!)
  135 |     await expect(main).toHaveAttribute('data-selected-deposit', 'none')
  136 |     await capture(page, `07-${outcome.toLowerCase()}-operations-portrait`)
  137 |     await page.setViewportSize({ width: 844, height: 390 })
  138 |     await capture(page, `08-${outcome.toLowerCase()}-operations-landscape`)
  139 |     await page.setViewportSize({ width: 390, height: 844 })
  140 |     expect(stableFacts(await saved(page))).toEqual(stableFacts(initial))
  141 |     expect((await saved(page)).outpost.lunarOre).toBeGreaterThan(initial.outpost.lunarOre)
  142 | 
  143 |     // Refresh while at the outpost: restore the accepted ending, never a cinematic.
  144 |     // Capture the final persisted surface state in the browser's exit task;
  145 |     // production may legitimately tick between a Node snapshot and navigation.
  146 |     await page.evaluate((key) => {
  147 |       window.addEventListener('pagehide', () => {
  148 |         sessionStorage.setItem('revisit-exit-save', localStorage.getItem(key)!)
  149 |       }, { once: true })
  150 |     }, OUTPOST_STORAGE_KEY)
  151 |     await page.reload()
  152 |     await page.getByRole('button', { name: 'CONTINUE' }).tap()
  153 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  154 |     await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  155 |     const refreshed = await saved(page)
  156 |     expect(stableFacts(refreshed)).toEqual(stableFacts(initial))
  157 |     const exitRaw = await page.evaluate(() => sessionStorage.getItem('revisit-exit-save'))
  158 |     const beforeRefresh = deserializePrototypeSave(exitRaw!, 1_000_000)!
  159 |     expect(stableFacts(beforeRefresh)).toEqual(stableFacts(initial))
  160 |     expect(refreshed.outpost.lunarOre).toBe(beforeRefresh.outpost.lunarOre)
  161 |     await page.waitForTimeout(1_200)
  162 |     expect((await saved(page)).outpost.lunarOre).toBe(refreshed.outpost.lunarOre)
  163 |     await enterOperations(page)
  164 |     expect(await page.locator('.operations-metrics > div').first().innerText()).toBe(energy)
  165 |     await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
  166 |     await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 15_000 })
  167 |     const inOrbit = await saved(page)
  168 |     await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  169 |     // Ordinary sessions deliberately omit harness-only signal coordinates.
  170 |     const pose = await canvas.evaluate((element) => ({ ...element.dataset }))
  171 |     const viewport = page.viewportSize()!
  172 |     const camera = new PerspectiveCamera(58, viewport.width / viewport.height, 0.01, 80)
  173 |     camera.position.set(Number(pose.cameraX), Number(pose.cameraY), Number(pose.cameraZ))
  174 |     camera.lookAt(Number(pose.cameraTargetX), Number(pose.cameraTargetY), Number(pose.cameraTargetZ))
  175 |     camera.updateMatrixWorld()
  176 |     const signal = landingSiteToRenderTransform(initial.outpost.site).position.multiplyScalar(1.00038).project(camera)
  177 |     const x = (signal.x + 1) * viewport.width / 2
  178 |     const y = (1 - signal.y) * viewport.height / 2
  179 |     expect(x).toBeGreaterThan(0)
  180 |     expect(x).toBeLessThan(viewport.width)
  181 |     expect(y).toBeGreaterThan(0)
  182 |     expect(y).toBeLessThan(viewport.height)
  183 |     await page.touchscreen.tap(x, y)
> 184 |     await expect(main).toHaveAttribute('data-phase', 'selected')
      |                        ^ Error: expect(locator).toHaveAttribute(expected) failed
  185 |     await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  186 |     await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  187 |     const revisited = await saved(page)
  188 |     expect(stableFacts(revisited)).toEqual(stableFacts(initial))
  189 |     expect(revisited.outpost.lunarOre - inOrbit.outpost.lunarOre).toBeLessThan(expected.productionPerMin / 60)
  190 |     await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  191 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  192 |     expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
  193 |     expect(errors).toEqual([])
  194 |   })
  195 | }
  196 | 
```