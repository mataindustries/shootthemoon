# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-polish.spec.ts >> portrait deposit taps and mining survive Solar Wing construction and refresh
- Location: e2e/outpost-polish.spec.ts:8:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- main "Shoot the Moon technical prototype" [ref=f1e3]:
  - generic "Moon Core 3D viewport" [ref=f1e4]
  - generic:
    - generic:
      - generic:
        - generic: SHOOT THE MOON
        - strong: FIRST OUTPOST
      - generic:
        - generic: OUTPOST TIER 2
        - generic [ref=f1e7]:
          - button "SOUND ON" [ref=f1e8] [cursor=pointer]
          - button "RESET PROTOTYPE" [ref=f1e9] [cursor=pointer]
    - region "Outpost status":
      - generic:
        - generic: LUNAR ORE
        - strong: "29.1"
      - generic: LASER EXTRACTING ORE · GAMMA
    - region "Outpost operations" [ref=f1e10]:
      - generic [ref=f1e11]:
        - generic [ref=f1e12]:
          - generic [ref=f1e13]: OUTPOST OPERATIONS
          - strong [ref=f1e14]: NOMINAL
        - generic [ref=f1e15]: 84% EFF
      - status: SIGNAL HELD · RETURN TO ORBIT
      - paragraph [ref=f1e16]: EXTRACTOR · ALPHA · AUTOMATIC MINING
      - generic [ref=f1e17]:
        - generic [ref=f1e18]:
          - generic [ref=f1e19]: ENERGY
          - strong [ref=f1e20]: 22.1 KW
          - generic [ref=f1e21]: 12 USED
        - generic [ref=f1e22]:
          - generic [ref=f1e23]: ROBOTS
          - strong [ref=f1e24]: 2 / 3
          - generic [ref=f1e25]: ACTIVE
        - generic [ref=f1e26]:
          - generic [ref=f1e27]: ORE RATE
          - strong [ref=f1e28]: "6"
          - generic [ref=f1e29]: ORE / MIN
        - generic [ref=f1e30]:
          - generic [ref=f1e31]: STORAGE
          - strong [ref=f1e32]: 29.1 / 240
          - generic [ref=f1e33]: LUNAR ORE
      - group [ref=f1e34]:
        - generic "Operating mode" [ref=f1e35]:
          - button "CONSERVE" [ref=f1e36] [cursor=pointer]
          - button "BALANCED" [pressed] [ref=f1e37] [cursor=pointer]
          - button "OVERDRIVE" [ref=f1e38] [cursor=pointer]
        - generic [ref=f1e39]:
          - generic [ref=f1e40]: OUTPOST TIER 2
          - strong [ref=f1e41]: SOLAR WING
      - button "GAMMA · MINE DEPOSIT" [disabled] [ref=f1e42]
      - button "RETURN TO ORBIT" [ref=f1e43] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { mkdir } from 'node:fs/promises'
  3   | import { OUTPOST_STORAGE_KEY } from '../src/persistence/outpostSave.ts'
  4   | import { createLegacyActiveExtractorSave } from './rivalFixtures.ts'
  5   | 
  6   | test.use({ trace: 'off' })
  7   | 
  8   | test('portrait deposit taps and mining survive Solar Wing construction and refresh', async ({ page }) => {
  9   |   test.setTimeout(300_000)
  10  |   const errors: string[] = []
  11  |   page.on('pageerror', error => errors.push(error.message))
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  13  |   await page.addInitScript(({ key, save }) => {
  14  |     Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
  15  |     Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  16  |     if (!localStorage.getItem(key)) localStorage.setItem(key, save)
  17  |   }, { key: OUTPOST_STORAGE_KEY, save: createLegacyActiveExtractorSave() })
  18  |   await page.goto('/?e2e')
  19  |   const main = page.locator('main')
  20  |   const canvas = page.locator('canvas')
  21  |   await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  22  |   await expect(main).toHaveAttribute('data-phase', 'landed')
  23  | 
  24  |   async function selectAll() {
  25  |     for (const id of ['alpha', 'beta', 'gamma']) {
  26  |       await expect(canvas).toHaveAttribute(`data-deposit-${id}-x`, /\d/)
  27  |       const { x, y } = await canvas.evaluate((element, id) => ({
  28  |         x: Number(element.getAttribute(`data-deposit-${id}-x`)),
  29  |         y: Number(element.getAttribute(`data-deposit-${id}-y`)),
  30  |       }), id)
  31  |       expect(x).toBeGreaterThan(0)
  32  |       expect(x).toBeLessThan(390)
  33  |       expect(y).toBeGreaterThan(0)
  34  |       expect(y).toBeLessThan(844)
  35  |       // Real touch must reach the scene, not a covering HUD element.
  36  |       expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x, y })).toBe('CANVAS')
  37  |       await page.touchscreen.tap(x, y)
  38  |       await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
  39  |       const command = page.locator(`button[data-deposit-id="deposit-${id}"]`)
  40  |       if (id === 'alpha') await expect(command).toBeDisabled()
  41  |       else {
  42  |         await expect(command).toBeEnabled()
  43  |         expect((await command.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  44  |       }
  45  |     }
  46  |   }
  47  |   await selectAll()
  48  |   await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
  49  |   await page.getByRole('button', { name: /^SOLAR WING/ }).tap()
  50  |   await expect(main).toHaveAttribute('data-module-status', 'active')
  51  |   await selectAll()
  52  |   await page.reload()
  53  |   await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  54  |   await expect(main).toHaveAttribute('data-module-status', 'active')
  55  |   await selectAll()
  56  |   for (const id of ['gamma', 'beta']) {
  57  |     await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  58  |     // The camera eases back from the extraction close-up after idle starts.
  59  |     await page.waitForTimeout(1_200)
  60  |     const point = await canvas.evaluate((element, id) => ({
  61  |       x: Number(element.getAttribute(`data-deposit-${id}-x`)),
  62  |       y: Number(element.getAttribute(`data-deposit-${id}-y`)),
  63  |     }), id)
  64  |     await page.touchscreen.tap(point.x, point.y)
  65  |     await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
  66  |     // Hold the real mining transition so software rendering cannot advance
  67  |     // to return travel while the effect screenshot is being captured.
  68  |     await page.evaluate(() => {
  69  |       const main = document.querySelector('main')!
  70  |       const observer = new MutationObserver(() => {
  71  |         if (main.getAttribute('data-robot-state') !== 'mining') return
  72  |         window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: true } }))
  73  |         observer.disconnect()
  74  |       })
  75  |       observer.observe(main, { attributes: true, attributeFilter: ['data-robot-state'] })
  76  |     })
  77  |     await page.locator(`button[data-deposit-id="deposit-${id}"]`).tap()
  78  |     await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  79  |     await expect(main).toHaveAttribute('data-robot-state', 'mining')
  80  |     await expect(canvas).toHaveAttribute('data-mining-laser', 'contact')
  81  |     await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-focus-mining')
  82  |     // Wait for contact framing to settle; effect animation may still render.
  83  |     // Sample pixels only then, so screenshot coordinates cannot lag the camera.
  84  |     await expect.poll(async () => {
  85  |       const before = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[] | undefined
  86  |       await page.waitForTimeout(500)
  87  |       const after = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[] | undefined
  88  |       return !!before && !!after && Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!) < 0.001
> 89  |     }, { timeout: 20_000 }).toBe(true)
      |                             ^ Error: expect(received).toBe(expected) // Object.is equality
  90  |     const effects = JSON.parse((await canvas.getAttribute('data-hero-framing'))!) as Record<string, number[]>
  91  |     for (const name of ['mining-laser-beam', 'mining-contact-glow']) {
  92  |       expect(effects[name], name).toBeDefined()
  93  |       expect(Math.abs(effects[name]![0]!)).toBeLessThan(0.95)
  94  |       expect(Math.abs(effects[name]![1]!)).toBeLessThan(0.95)
  95  |       expect(effects[name]![2]!).toBeLessThan(1)
  96  |       const point = { x: (effects[name]![0]! + 1) * 195, y: (1 - effects[name]![1]!) * 422 }
  97  |       expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point), `${name} must clear the HUD`).toBe('CANVAS')
  98  |     }
  99  |     const shot = await page.screenshot()
  100 |     const contact = JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-contact-glow'] as number[]
  101 |     const visibleGlowPixels = await page.evaluate(async ({ png, x, y }) => {
  102 |       const image = new Image()
  103 |       image.src = `data:image/png;base64,${png}`
  104 |       await image.decode()
  105 |       const sample = document.createElement('canvas')
  106 |       sample.width = 18
  107 |       sample.height = 18
  108 |       const context = sample.getContext('2d')!
  109 |       context.drawImage(image, Math.round(x) - 9, Math.round(y) - 9, 18, 18, 0, 0, 18, 18)
  110 |       const pixels = context.getImageData(0, 0, 18, 18).data
  111 |       let count = 0
  112 |       for (let i = 0; i < pixels.length; i += 4) {
  113 |         if (pixels[i]! > 140 && pixels[i + 1]! > 110 && pixels[i + 2]! > 75 && pixels[i]! > pixels[i + 1]!) count++
  114 |       }
  115 |       return count
  116 |     }, { png: shot.toString('base64'), x: (contact[0]! + 1) * 195, y: (1 - contact[1]!) * 422 })
  117 |     expect(visibleGlowPixels, 'warm contact glow must remain visible over the translucent terrain').toBeGreaterThan(2)
  118 |     expect(Number(await canvas.getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80)
  119 |     expect(Number(await canvas.getAttribute('data-programs'))).toBeLessThanOrEqual(24)
  120 |     if (id === 'gamma') {
  121 |       await mkdir('artifacts/screenshots/outpost-polish', { recursive: true })
  122 |       await page.screenshot({ path: 'artifacts/screenshots/outpost-polish/laser-extraction.png' })
  123 |     }
  124 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent('first-outpost:set-simulation-paused', { detail: { paused: false } })))
  125 |     await expect(main).toHaveAttribute('data-robot-state', 'idle', { timeout: 20_000 })
  126 |     await expect(canvas).toHaveAttribute('data-mining-laser', 'off')
  127 |     await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-hero-framing'))!)['mining-laser-beam']).toBeUndefined()
  128 |   }
  129 |   await page.reload()
  130 |   await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  131 |   await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  132 |   // Widen the inspection view using the existing camera controls.
  133 |   await page.mouse.move(195, 350)
  134 |   await page.mouse.wheel(0, 1_000)
  135 |   await page.mouse.down()
  136 |   await page.mouse.move(345, 310, { steps: 12 })
  137 |   await page.mouse.up()
  138 |   await page.waitForTimeout(1_200)
  139 |   await page.screenshot({ path: 'artifacts/screenshots/outpost-polish/portrait.png' })
  140 |   expect(errors).toEqual([])
  141 | })
  142 | 
  143 | test('focused Storage Silo clearance and touch targets survive construction and refresh', async ({ page }) => {
  144 |   test.setTimeout(180_000)
  145 |   const errors: string[] = []
  146 |   page.on('pageerror', error => errors.push(error.message))
  147 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  148 |   const raw = JSON.parse(createLegacyActiveExtractorSave())
  149 |   raw.outpost.lunarOre = 80
  150 |   await page.addInitScript(({ key, save }) => {
  151 |     Object.defineProperty(navigator, 'deviceMemory', { get: () => 6 })
  152 |     Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  153 |     if (!localStorage.getItem(key)) localStorage.setItem(key, save)
  154 |   }, { key: OUTPOST_STORAGE_KEY, save: JSON.stringify(raw) })
  155 |   await page.goto('/?e2e')
  156 |   await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  157 |   const main = page.locator('main')
  158 |   const canvas = page.locator('canvas')
  159 |   await page.getByRole('button', { name: /BUILD MODULE/ }).tap()
  160 |   await page.getByRole('button', { name: /^STORAGE SILO/ }).tap()
  161 |   await expect(main).toHaveAttribute('data-module-status', 'active')
  162 |   let socket = ''
  163 |   for (const refresh of [false, true]) {
  164 |     if (refresh) {
  165 |       await page.reload()
  166 |       await page.getByRole('button', { name: 'CONTINUE', exact: true }).tap()
  167 |     }
  168 |     await expect(main).toHaveAttribute('data-operation-storage-capacity', '400')
  169 |     await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  170 |     await page.waitForTimeout(1_200)
  171 |     await expect(canvas).toHaveAttribute('data-module-socket', /\[/)
  172 |     if (refresh) expect(await canvas.getAttribute('data-module-socket')).toEqual(socket)
  173 |     else socket = (await canvas.getAttribute('data-module-socket'))!
  174 |     for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  175 |       await page.setViewportSize(size)
  176 |       await page.waitForTimeout(300)
  177 |       const bounds = JSON.parse((await canvas.getAttribute('data-module-bounds'))!) as number[]
  178 |       expect(bounds[0]).toBeGreaterThan(0)
  179 |       expect(bounds[1]).toBeGreaterThan(0)
  180 |       expect(bounds[2]).toBeLessThan(size.width)
  181 |       expect(bounds[3]).toBeLessThan(size.height)
  182 |       for (const id of ['alpha', 'beta', 'gamma']) {
  183 |         const point = await canvas.evaluate((element, id) => ({
  184 |           x: Number(element.getAttribute(`data-deposit-${id}-x`)),
  185 |           y: Number(element.getAttribute(`data-deposit-${id}-y`)),
  186 |         }), id)
  187 |         const dx = Math.max(bounds[0]! - point.x, 0, point.x - bounds[2]!)
  188 |         const dy = Math.max(bounds[1]! - point.y, 0, point.y - bounds[3]!)
  189 |         expect(Math.hypot(dx, dy), `${id} silo / touch clearance`).toBeGreaterThan(22)
```