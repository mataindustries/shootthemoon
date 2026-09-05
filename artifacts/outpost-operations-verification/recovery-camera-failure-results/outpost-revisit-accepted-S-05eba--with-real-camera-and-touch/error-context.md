# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-revisit.spec.ts >> accepted SUCCESS ending returns to persistent operations with real camera and touch
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
    23 × locator resolved to <main class="app-shell" data-phase="orbit" data-quality="medium" data-scene-ready="true" data-robot-state="idle" data-entry-open="false" data-rival-focus="false" data-scar-created="true" data-rival-damaged="true" data-render-mode="demand" data-launch-complete="true" data-impact-complete="true" data-ending-complete="true" data-selected-deposit="none" data-lunar-control="scarred" data-repairs-required="false" data-extractor-status="active" data-rival-presentation="idle" data-rival-signal-held="false" …>…</main>
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
  127 |     await capture(page, `09-${outcome.toLowerCase()}-default-portrait`)
  128 |     const startFrame = Number(await canvas.getAttribute('data-frame-count'))
  129 |     await page.waitForTimeout(1_400)
  130 |     const idleFrames = Number(await canvas.getAttribute('data-frame-count')) - startFrame
  131 |     console.log(`OUTPOST_OPERATIONS_IDLE ${outcome} ${JSON.stringify({ frames: idleFrames, durationMs: 1400 })}`)
  132 |     expect(idleFrames).toBeLessThanOrEqual(16)
  133 |     const azimuth = await canvas.getAttribute('data-camera-azimuth')
  134 |     await cameraGesture(page, false)
  135 |     await page.waitForTimeout(1_200)
  136 |     await expect(canvas).not.toHaveAttribute('data-camera-azimuth', azimuth!)
  137 |     const distance = await canvas.getAttribute('data-camera-distance')
  138 |     await cameraGesture(page, true)
  139 |     await page.waitForTimeout(1_200)
  140 |     await expect(canvas).not.toHaveAttribute('data-camera-distance', distance!)
  141 |     await expect(main).toHaveAttribute('data-selected-deposit', 'none')
  142 |     await capture(page, `07-${outcome.toLowerCase()}-operations-portrait`)
  143 |     await page.setViewportSize({ width: 844, height: 390 })
  144 |     await capture(page, `08-${outcome.toLowerCase()}-operations-landscape`)
  145 |     await page.setViewportSize({ width: 390, height: 844 })
  146 |     expect(stableFacts(await saved(page))).toEqual(stableFacts(initial))
  147 |     expect((await saved(page)).outpost.lunarOre).toBeGreaterThan(initial.outpost.lunarOre)
  148 | 
  149 |     // Refresh while at the outpost: restore the accepted ending, never a cinematic.
  150 |     // Capture the final persisted surface state in the browser's exit task;
  151 |     // production may legitimately tick between a Node snapshot and navigation.
  152 |     await page.evaluate((key) => {
  153 |       window.addEventListener('pagehide', () => {
  154 |         sessionStorage.setItem('revisit-exit-save', localStorage.getItem(key)!)
  155 |       }, { once: true })
  156 |     }, OUTPOST_STORAGE_KEY)
  157 |     await page.reload()
  158 |     await page.getByRole('button', { name: 'CONTINUE' }).tap()
  159 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  160 |     await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  161 |     const refreshed = await saved(page)
  162 |     expect(stableFacts(refreshed)).toEqual(stableFacts(initial))
  163 |     const exitRaw = await page.evaluate(() => sessionStorage.getItem('revisit-exit-save'))
  164 |     const beforeRefresh = deserializePrototypeSave(exitRaw!, 1_000_000)!
  165 |     expect(stableFacts(beforeRefresh)).toEqual(stableFacts(initial))
  166 |     expect(refreshed.outpost.lunarOre).toBe(beforeRefresh.outpost.lunarOre)
  167 |     await page.waitForTimeout(1_200)
  168 |     expect((await saved(page)).outpost.lunarOre).toBe(refreshed.outpost.lunarOre)
  169 |     await enterOperations(page)
  170 |     expect(await page.locator('.operations-metrics > div').first().innerText()).toBe(energy)
  171 |     await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
  172 |     await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 15_000 })
  173 |     const inOrbit = await saved(page)
  174 |     await expect(canvas).toHaveAttribute('data-camera-mode', 'orbit')
  175 |     // Ordinary sessions deliberately omit harness-only signal coordinates.
  176 |     const pose = await canvas.evaluate((element) => ({ ...element.dataset }))
  177 |     const viewport = page.viewportSize()!
  178 |     const camera = new PerspectiveCamera(58, viewport.width / viewport.height, 0.01, 80)
  179 |     camera.position.set(Number(pose.cameraX), Number(pose.cameraY), Number(pose.cameraZ))
  180 |     camera.lookAt(Number(pose.cameraTargetX), Number(pose.cameraTargetY), Number(pose.cameraTargetZ))
  181 |     camera.updateMatrixWorld()
  182 |     const sitePosition = landingSiteToRenderTransform(initial.outpost.site).position.multiplyScalar(1.00038)
  183 |     // A projected point alone can be on the far side of the Moon.
> 184 |     expect(sitePosition.dot(camera.position)).toBeGreaterThan(sitePosition.lengthSq())
      |                        ^ Error: expect(locator).toHaveAttribute(expected) failed
  185 |     const signal = sitePosition.project(camera)
  186 |     const x = (signal.x + 1) * viewport.width / 2
  187 |     const y = (1 - signal.y) * viewport.height / 2
  188 |     expect(x).toBeGreaterThan(0)
  189 |     expect(x).toBeLessThan(viewport.width)
  190 |     expect(y).toBeGreaterThan(0)
  191 |     expect(y).toBeLessThan(viewport.height)
  192 |     await page.touchscreen.tap(x, y)
  193 |     await expect(main).toHaveAttribute('data-phase', 'selected')
  194 |     await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  195 |     await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  196 |     const revisited = await saved(page)
  197 |     expect(stableFacts(revisited)).toEqual(stableFacts(initial))
  198 |     expect(revisited.outpost.lunarOre - inOrbit.outpost.lunarOre).toBeLessThan(expected.productionPerMin / 60)
  199 |     await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  200 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  201 |     expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
  202 |     expect(errors).toEqual([])
  203 |   })
  204 | }
  205 | 
```