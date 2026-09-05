# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-revisit.spec.ts >> accepted FAILURE ending returns to persistent operations with real camera and touch
- Location: e2e/outpost-revisit.spec.ts:90:3

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 0.1053167656156216
Received:   0.17735343329670172
```

# Page snapshot

```yaml
- main "Shoot the Moon technical prototype" [ref=f1e3]:
  - generic "Moon Core 3D viewport" [ref=f1e4]
  - generic:
    - generic:
      - generic:
        - generic: SHOOT THE MOON
        - strong: ORBITAL INTERCEPT
      - generic:
        - generic: OUTPOST DAMAGED · REPAIRS REQUIRED
        - generic [ref=f1e7]:
          - button "SOUND ON" [ref=f1e8] [cursor=pointer]
          - button "RESET PROTOTYPE" [ref=f1e9] [cursor=pointer]
  - region "Counterstrike outcome" [ref=f1e10]:
    - generic [ref=f1e11]: STRUCTURAL DAMAGE CONFIRMED
    - heading "COUNTERSTRIKE SURVIVED" [level=1] [ref=f1e12]
    - heading "OUTPOST DAMAGED" [level=2] [ref=f1e13]
    - generic [ref=f1e14]: REPAIRS REQUIRED
    - blockquote [ref=f1e15]:
      - text: “Still standing. Good. Count what survived before you count what is yours.”
      - generic [ref=f1e16]: COMMANDER VESPER
    - generic [ref=f1e17]:
      - button "VIEW OUTPOST OPERATIONS" [ref=f1e18] [cursor=pointer]
      - button "REPLAY COUNTERSTRIKE" [ref=f1e19] [cursor=pointer]
```

# Test source

```ts
  50  |   await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  51  |   await session.detach()
  52  | }
  53  | 
  54  | async function capture(page: Page, name: string) {
  55  |   const panel = page.getByRole('region', { name: 'Outpost operations', exact: true })
  56  |   const box = await panel.boundingBox()
  57  |   const viewport = page.viewportSize()!
  58  |   expect(box).not.toBeNull()
  59  |   expect(box!.x).toBeGreaterThanOrEqual(0)
  60  |   expect(box!.y).toBeGreaterThanOrEqual(0)
  61  |   expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  62  |   expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  63  |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  64  |   expect(await panel.evaluate((panel) => Array.from(panel.querySelectorAll('.operations-metrics > div')).every((cell) => {
  65  |     const box = cell.getBoundingClientRect()
  66  |     return Array.from(cell.children).every((child) => {
  67  |       const text = child.getBoundingClientRect()
  68  |       return text.left >= box.left && text.right <= box.right && child.scrollWidth <= child.clientWidth
  69  |     })
  70  |   }))).toBe(true)
  71  |   await page.screenshot({ path: `${EVIDENCE}/${name}.png` })
  72  |   const metrics = await page.locator('canvas').evaluate((canvas) => ({
  73  |     drawCalls: Number(canvas.dataset.drawCalls), triangles: Number(canvas.dataset.triangles),
  74  |     geometries: Number(canvas.dataset.geometries), textures: Number(canvas.dataset.textures),
  75  |     programs: Number(canvas.dataset.programs), cameraMode: canvas.dataset.cameraMode,
  76  |   }))
  77  |   console.log(`OUTPOST_REVISIT ${name} ${JSON.stringify(metrics)}`)
  78  |   expect(metrics.drawCalls).toBeGreaterThan(0)
  79  |   expect(metrics.drawCalls).toBeLessThanOrEqual(80)
  80  |   expect(metrics.triangles).toBeLessThanOrEqual(200_000)
  81  |   expect(metrics.programs).toBeLessThanOrEqual(24)
  82  | }
  83  | 
  84  | test.beforeAll(async ({ request }) => {
  85  |   await mkdir(EVIDENCE, { recursive: true })
  86  |   expect(await (await request.get('/')).text()).toBe(await readFile('dist/index.html', 'utf8'))
  87  | })
  88  | 
  89  | for (const outcome of ['FAILURE', 'SUCCESS'] as const) {
  90  |   test(`accepted ${outcome} ending returns to persistent operations with real camera and touch`, async ({ page }) => {
  91  |     test.setTimeout(180_000)
  92  |     const errors: string[] = []
  93  |     page.on('pageerror', (error) => errors.push(error.message))
  94  |     page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  95  |     const raw = JSON.parse(createAcceptedCounterstrikeSave(outcome))
  96  |     raw.outpost.lunarOre = 100.25
  97  |     raw.outpost.operations.mode = 'OVERDRIVE'
  98  |     raw.outpost.operations.storageCapacity = 320
  99  |     await page.addInitScript(({ key, value }) => {
  100 |       Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
  101 |       Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  102 |       if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
  103 |     }, { key: OUTPOST_STORAGE_KEY, value: JSON.stringify(raw) })
  104 |     await page.goto('/')
  105 |     await expect(page.locator('main')).toHaveAttribute('data-scene-ready', 'true')
  106 |     await page.getByRole('button', { name: 'CONTINUE' }).tap()
  107 |     const initial = await saved(page)
  108 |     const expected = calculateOutpostOperations(initial.outpost, initial.counterstrike.outpostDamageState)
  109 |     await enterOperations(page)
  110 |     const main = page.locator('main')
  111 |     await expect(main).toHaveAttribute('data-counterstrike-accepted-outcome', outcome)
  112 |     await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  113 |     await expect(main).toHaveAttribute('data-outpost-damage-state', outcome === 'FAILURE' ? 'DAMAGED' : 'INTACT')
  114 |     expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
  115 |     if (outcome === 'FAILURE') {
  116 |       await expect(page.locator('canvas')).toHaveAttribute('data-counterstrike-damage-field', 'persistent')
  117 |       await expect(page.getByText('OUTPOST DAMAGED · −30% PRODUCTION', { exact: true })).toBeVisible()
  118 |       expect(expected.productionPerMin).toBeCloseTo(calculateOutpostOperations(initial.outpost, 'INTACT').productionPerMin * 0.7, 10)
  119 |     } else {
  120 |       await expect(page.locator('.operations-damage')).toHaveCount(0)
  121 |       expect(expected.damageMultiplier).toBe(1)
  122 |     }
  123 |     const energy = await page.locator('.operations-metrics > div').first().innerText()
  124 |     const canvas = page.locator('canvas')
  125 |     const azimuth = await canvas.getAttribute('data-camera-azimuth')
  126 |     await cameraGesture(page, false)
  127 |     await page.waitForTimeout(1_200)
  128 |     await expect(canvas).not.toHaveAttribute('data-camera-azimuth', azimuth!)
  129 |     const distance = await canvas.getAttribute('data-camera-distance')
  130 |     await cameraGesture(page, true)
  131 |     await page.waitForTimeout(1_200)
  132 |     await expect(canvas).not.toHaveAttribute('data-camera-distance', distance!)
  133 |     await expect(main).toHaveAttribute('data-selected-deposit', 'none')
  134 |     await capture(page, `07-${outcome.toLowerCase()}-operations-portrait`)
  135 |     await page.setViewportSize({ width: 844, height: 390 })
  136 |     await capture(page, `08-${outcome.toLowerCase()}-operations-landscape`)
  137 |     await page.setViewportSize({ width: 390, height: 844 })
  138 |     expect(stableFacts(await saved(page))).toEqual(stableFacts(initial))
  139 |     expect((await saved(page)).outpost.lunarOre).toBeGreaterThan(initial.outpost.lunarOre)
  140 | 
  141 |     // Refresh while at the outpost: restore the accepted ending, never a cinematic.
  142 |     const beforeRefresh = await saved(page)
  143 |     await page.reload()
  144 |     await page.getByRole('button', { name: 'CONTINUE' }).tap()
  145 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'resolved')
  146 |     await expect(main).toHaveAttribute('data-first-strike-presentation', 'idle')
  147 |     const refreshed = await saved(page)
  148 |     expect(stableFacts(refreshed)).toEqual(stableFacts(initial))
  149 |     expect(refreshed.outpost.lunarOre).toBeGreaterThanOrEqual(beforeRefresh.outpost.lunarOre)
> 150 |     expect(refreshed.outpost.lunarOre - beforeRefresh.outpost.lunarOre).toBeLessThan(expected.productionPerMin / 60)
      |                                                                         ^ Error: expect(received).toBeLessThan(expected)
  151 |     await enterOperations(page)
  152 |     expect(await page.locator('.operations-metrics > div').first().innerText()).toBe(energy)
  153 |     await page.getByRole('button', { name: 'RETURN TO ORBIT', exact: true }).tap()
  154 |     await expect(main).toHaveAttribute('data-phase', 'orbit', { timeout: 15_000 })
  155 |     const inOrbit = await saved(page)
  156 |     const x = Number(await canvas.getAttribute('data-outpost-signal-x'))
  157 |     const y = Number(await canvas.getAttribute('data-outpost-signal-y'))
  158 |     await page.touchscreen.tap(x, y)
  159 |     await expect(main).toHaveAttribute('data-phase', 'selected')
  160 |     await page.getByRole('button', { name: 'REVISIT OUTPOST' }).tap()
  161 |     await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 15_000 })
  162 |     const revisited = await saved(page)
  163 |     expect(stableFacts(revisited)).toEqual(stableFacts(initial))
  164 |     expect(revisited.outpost.lunarOre - inOrbit.outpost.lunarOre).toBeLessThan(expected.productionPerMin / 60)
  165 |     await expect(main).toHaveAttribute('data-operating-mode', 'OVERDRIVE')
  166 |     await expect(main).toHaveAttribute('data-counterstrike-state', 'dormant')
  167 |     expect(Number(await main.getAttribute('data-operation-rate'))).toBeCloseTo(expected.productionPerMin, 8)
  168 |     expect(errors).toEqual([])
  169 |   })
  170 | }
  171 | 
```