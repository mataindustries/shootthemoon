# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outpost-polish.spec.ts >> focused Storage Silo clearance and touch targets survive construction and refresh
- Location: e2e/outpost-polish.spec.ts:143:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "CANVAS"
Received: "B"
```

# Page snapshot

```yaml
- main "Shoot the Moon technical prototype" [ref=e3]:
  - generic "Moon Core 3D viewport" [ref=e4]
  - generic:
    - generic:
      - generic:
        - generic: SHOOT THE MOON
        - strong: FIRST OUTPOST
      - generic:
        - generic: OUTPOST TIER 2
        - generic [ref=e7]:
          - button "SOUND ON" [ref=e8] [cursor=pointer]
          - button "RESET PROTOTYPE" [ref=e9] [cursor=pointer]
    - region "Outpost status":
      - generic:
        - generic: LUNAR ORE
        - strong: "63.1"
      - generic: MINER IDLE · EXTRACTOR RUNNING
    - region "Outpost operations" [ref=e10]:
      - generic [ref=e11]:
        - generic [ref=e12]:
          - generic [ref=e13]: OUTPOST OPERATIONS
          - strong [ref=e14]: NOMINAL
        - generic [ref=e15]: 84% EFF
      - status: SIGNAL HELD · RETURN TO ORBIT
      - paragraph [ref=e16]: EXTRACTOR · ALPHA · AUTOMATIC MINING
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: ENERGY
          - strong [ref=e20]: 17.7 KW
          - generic [ref=e21]: 12 USED
        - generic [ref=e22]:
          - generic [ref=e23]: ROBOTS
          - strong [ref=e24]: 2 / 3
          - generic [ref=e25]: ACTIVE
        - generic [ref=e26]:
          - generic [ref=e27]: ORE RATE
          - strong [ref=e28]: "6"
          - generic [ref=e29]: ORE / MIN
        - generic [ref=e30]:
          - generic [ref=e31]: STORAGE
          - strong [ref=e32]: 63.1 / 400
          - generic [ref=e33]: LUNAR ORE
      - region "Orbital Siege" [ref=e34]:
        - generic [ref=e35]:
          - generic [ref=e36]: ORBITAL SIEGE
          - strong [ref=e37]: ORBITAL PLATFORM OBJECTIVE
        - paragraph [ref=e38]: Build an orbital logistics relay. +20% ore delivery when operational.60 stored ore · 6 kW reserved · 2 of 3 robots. No defense reserve; 1 miner with −25% ore delivery during assembly.
        - button "BUILD ORBITAL PLATFORM · 60 ORE" [ref=e39] [cursor=pointer]
      - group [ref=e40]:
        - generic "Operating mode" [ref=e41]:
          - button "CONSERVE" [ref=e42] [cursor=pointer]
          - button "BALANCED" [pressed] [ref=e43] [cursor=pointer]
          - button "OVERDRIVE" [ref=e44] [cursor=pointer]
        - generic [ref=e45]:
          - generic [ref=e46]: OUTPOST TIER 2
          - strong [ref=e47]: STORAGE SILO
      - button "ALPHA · EXTRACTOR ACTIVE" [disabled] [ref=e48]
      - button "RETURN TO ORBIT" [ref=e49] [cursor=pointer]
```

# Test source

```ts
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
> 190 |         expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS')
      |                                                                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  191 |         await page.touchscreen.tap(point.x, point.y)
  192 |         await expect(main).toHaveAttribute('data-selected-deposit', `deposit-${id}`)
  193 |       }
  194 |     }
  195 |     await page.setViewportSize({ width: 390, height: 844 })
  196 |     await mkdir('artifacts/screenshots/hero-polish', { recursive: true })
  197 |     await page.screenshot({ path: `artifacts/screenshots/hero-polish/silo-${refresh ? 'refresh' : 'built'}.png` })
  198 |     expect(Number(await canvas.getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80)
  199 |     expect(Number(await canvas.getAttribute('data-textures'))).toBeLessThanOrEqual(6)
  200 |     expect(Number(await canvas.getAttribute('data-programs'))).toBeLessThanOrEqual(24)
  201 |     expect(Number(await canvas.getAttribute('data-triangles'))).toBeLessThanOrEqual(120_000)
  202 |   }
  203 |   expect(errors).toEqual([])
  204 | })
  205 | 
```