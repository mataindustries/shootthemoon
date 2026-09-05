# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: moon-core.spec.ts >> complete mobile First Outpost loop queues one Rival Signal after extractor activation
- Location: e2e/moon-core.spec.ts:448:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('main')
Expected: "mining"
Received: "idle"
Timeout:  6000ms

Call log:
  - Expect "toHaveAttribute" with timeout 6000ms
  - waiting for locator('main')
    4 × locator resolved to <main class="app-shell" data-lunar-ore="0" data-phase="landed" data-quality="medium" data-scene-ready="true" data-rival-stage="none" data-entry-open="false" data-operation-rate="0" data-rival-focus="false" data-scar-created="false" data-scar-latitude="none" data-rival-damaged="false" data-scar-longitude="none" data-robot-state="returning" data-extractor-status="none" data-launch-complete="false" data-impact-complete="false" data-ending-complete="false" data-repairs-required="false" data-operation-ef…>…</main>
      - unexpected value "returning"
    - locator resolved to <main class="app-shell" data-lunar-ore="0" data-phase="landed" data-quality="medium" data-scene-ready="true" data-rival-stage="none" data-entry-open="false" data-operation-rate="0" data-rival-focus="false" data-scar-created="false" data-scar-latitude="none" data-rival-damaged="false" data-scar-longitude="none" data-robot-state="unloading" data-extractor-status="none" data-launch-complete="false" data-impact-complete="false" data-ending-complete="false" data-repairs-required="false" data-operation-ef…>…</main>
    - unexpected value "unloading"
    4 × locator resolved to <main class="app-shell" data-phase="landed" data-lunar-ore="35" data-quality="medium" data-scene-ready="true" data-robot-state="idle" data-rival-stage="none" data-entry-open="false" data-operation-rate="0" data-rival-focus="false" data-scar-created="false" data-scar-latitude="none" data-render-mode="demand" data-rival-damaged="false" data-scar-longitude="none" data-extractor-status="none" data-launch-complete="false" data-impact-complete="false" data-ending-complete="false" data-repairs-required="fa…>…</main>
      - unexpected value "idle"

```

```yaml
- main "Shoot the Moon technical prototype":
  - text: SHOOT THE MOON
  - strong: FIRST OUTPOST
  - text: FIRST OUTPOST
  - button "SOUND ON"
  - button "RESET PROTOTYPE"
  - region "Outpost status"
  - region "Outpost commands"
```

# Test source

```ts
  511 |   await setCinematicProgress(page, 0.9)
  512 |   await page.waitForTimeout(250)
  513 |   await page.screenshot({
  514 |     path: SCREENSHOT_DIRECTORY + '/03-capsule-impact-mobile.png',
  515 |   })
  516 |   await setCinematicProgress(page, 1)
  517 |   await expect(main).toHaveAttribute('data-phase', 'landed', { timeout: 6_000 })
  518 |   await expect(main).toHaveAttribute('data-robot-state', 'stored')
  519 |   await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player', {
  520 |     timeout: 6_000,
  521 |   })
  522 |   await page.waitForTimeout(500)
  523 |   await page.screenshot({
  524 |     path: SCREENSHOT_DIRECTORY + '/04-landed-site-mobile.png',
  525 |   })
  526 |   await page.screenshot({
  527 |     path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/01-default-landed.png',
  528 |   })
  529 | 
  530 |   const storedMetrics = await readRenderMetrics(page)
  531 |   console.log('FIRST_OUTPOST_STORED_SURFACE_METRICS ' + JSON.stringify(storedMetrics))
  532 |   expect(storedMetrics.drawCalls).toBeLessThanOrEqual(80)
  533 |   expect(storedMetrics.triangles).toBeLessThanOrEqual(200_000)
  534 |   expect(storedMetrics.textures).toBeLessThanOrEqual(12)
  535 | 
  536 |   const deployBounds = await page
  537 |     .getByRole('button', { name: 'DEPLOY MINER' })
  538 |     .boundingBox()
  539 |   const orbitReturnBounds = await page
  540 |     .getByRole('button', { name: 'RETURN TO ORBIT' })
  541 |     .boundingBox()
  542 |   expect(deployBounds?.height ?? 0).toBeGreaterThanOrEqual(48)
  543 |   expect(orbitReturnBounds?.height ?? 0).toBeGreaterThanOrEqual(44)
  544 |   expect(orbitReturnBounds?.y ?? 900).toBeLessThan(824)
  545 | 
  546 |   const storedIdleFrame = await readFrameCount(page)
  547 |   await page.waitForTimeout(800)
  548 |   const storedIdleFrames = (await readFrameCount(page)) - storedIdleFrame
  549 |   console.log(
  550 |     'FIRST_OUTPOST_STORED_IDLE ' + JSON.stringify({ frames: storedIdleFrames, durationMs: 800 }),
  551 |   )
  552 |   expect(storedIdleFrames).toBeLessThanOrEqual(2)
  553 | 
  554 |   await page.setViewportSize({ width: 390, height: 780 })
  555 |   const compactReturnBounds = await page
  556 |     .getByRole('button', { name: 'RETURN TO ORBIT' })
  557 |     .boundingBox()
  558 |   expect(
  559 |     (compactReturnBounds?.y ?? 900) + (compactReturnBounds?.height ?? 0),
  560 |   ).toBeLessThanOrEqual(760)
  561 |   await page.setViewportSize({ width: 390, height: 844 })
  562 |   await page.waitForTimeout(250)
  563 | 
  564 |   await setSimulationPaused(page, true)
  565 |   await page.getByRole('button', { name: 'DEPLOY MINER' }).click()
  566 |   await expect(main).toHaveAttribute('data-robot-state', 'deploying')
  567 |   await setSimulationPaused(page, true, 850)
  568 |   await expect(canvas).toHaveAttribute(
  569 |     'data-camera-mode',
  570 |     'surface-focus-deployment',
  571 |   )
  572 |   await page.waitForTimeout(650)
  573 |   await expectProjectedRobotVisible(page)
  574 |   await page.screenshot({
  575 |     path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/02-robot-deployment.png',
  576 |   })
  577 |   await setSimulationPaused(page, false)
  578 |   await expect(main).toHaveAttribute('data-robot-state', 'idle', {
  579 |     timeout: 5_000,
  580 |   })
  581 |   await page.waitForTimeout(850)
  582 |   await setSimulationPaused(page, true)
  583 |   await page.screenshot({
  584 |     path: SCREENSHOT_DIRECTORY + '/06-capsule-opened-robot-deployed.png',
  585 |   })
  586 |   await setSimulationPaused(page, false)
  587 |   await expect(canvas).toHaveAttribute('data-camera-mode', 'surface-player')
  588 | 
  589 |   const scannerIdleFrame = await readFrameCount(page)
  590 |   await page.waitForTimeout(1_000)
  591 |   const scannerIdleFrames = (await readFrameCount(page)) - scannerIdleFrame
  592 |   console.log(
  593 |     'FIRST_OUTPOST_SCANNER_IDLE ' +
  594 |       JSON.stringify({ frames: scannerIdleFrames, durationMs: 1_000 }),
  595 |   )
  596 |   expect(scannerIdleFrames).toBeLessThanOrEqual(10)
  597 | 
  598 |   await tapProjectedPoint(
  599 |     page,
  600 |     'data-deposit-gamma-x',
  601 |     'data-deposit-gamma-y',
  602 |   )
  603 |   await expect(main).toHaveAttribute('data-selected-deposit', 'deposit-gamma')
  604 |   await expect(page.locator('.deposit-readout')).toContainText('LUNAR ORE')
  605 | 
  606 |   await pauseTransitionsWhenRobotState(page, 'traveling')
  607 |   await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  608 |   await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  609 |   await pauseTransitionsWhenRobotState(page, 'mining')
  610 |   await setTransitionsPaused(page, false)
> 611 |   await expect(main).toHaveAttribute('data-robot-state', 'mining', {
      |                      ^ Error: expect(locator).toHaveAttribute(expected) failed
  612 |     timeout: 6_000,
  613 |   })
  614 |   await expect(main).toHaveAttribute('data-render-mode', 'continuous')
  615 |   const miningFrame = await readFrameCount(page)
  616 |   const availableAnimationFrames = await measureBrowserAnimationFrames(page, 600)
  617 |   const renderedMiningFrames = (await readFrameCount(page)) - miningFrame
  618 |   console.log(
  619 |     'FIRST_OUTPOST_SUSTAINED_ANIMATION ' +
  620 |       JSON.stringify({ availableAnimationFrames, renderedMiningFrames }),
  621 |   )
  622 |   expect(availableAnimationFrames).toBeGreaterThanOrEqual(2)
  623 |   expect(renderedMiningFrames).toBeGreaterThan(3)
  624 |   expect(renderedMiningFrames).toBeGreaterThanOrEqual(
  625 |     Math.max(3, availableAnimationFrames - 2),
  626 |   )
  627 |   await setSimulationPaused(page, true, 850)
  628 |   await expect(canvas).toHaveAttribute(
  629 |     'data-camera-mode',
  630 |     'surface-focus-mining',
  631 |   )
  632 |   await page.waitForTimeout(650)
  633 |   await expectProjectedRobotVisible(page)
  634 |   await page.screenshot({
  635 |     path: SCREENSHOT_DIRECTORY + '/07-robot-mining.png',
  636 |   })
  637 |   await page.screenshot({
  638 |     path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/03-mining-close-view.png',
  639 |   })
  640 |   await setSimulationPaused(page, false)
  641 |   await setTransitionsPaused(page, false)
  642 |   await expect(main).toHaveAttribute('data-robot-state', 'idle', {
  643 |     timeout: 8_000,
  644 |   })
  645 |   await expect(main).toHaveAttribute('data-lunar-ore', '35')
  646 | 
  647 |   await page.getByRole('button', { name: 'MINE DEPOSIT' }).click()
  648 |   await expect(main).toHaveAttribute('data-robot-state', 'traveling')
  649 |   await expect(main).toHaveAttribute('data-robot-state', 'returning', {
  650 |     timeout: 9_000,
  651 |   })
  652 |   await setSimulationPaused(page, true, 720)
  653 |   await expect(canvas).toHaveAttribute(
  654 |     'data-camera-mode',
  655 |     'surface-focus-return',
  656 |   )
  657 |   await page.waitForTimeout(400)
  658 |   await expectProjectedRobotVisible(page)
  659 |   await page.screenshot({
  660 |     path: SCREENSHOT_DIRECTORY + '/08-robot-returning-cargo.png',
  661 |   })
  662 |   await page.screenshot({
  663 |     path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/04-cargo-return.png',
  664 |   })
  665 |   await setSimulationPaused(page, false)
  666 |   await expect(main).toHaveAttribute('data-robot-state', 'idle', {
  667 |     timeout: 8_000,
  668 |   })
  669 |   await expect(main).toHaveAttribute('data-lunar-ore', '70')
  670 |   await expect(
  671 |     page.getByRole('button', { name: /CONSTRUCT EXTRACTOR/ }),
  672 |   ).toBeVisible()
  673 | 
  674 |   await setSimulationPaused(page, true)
  675 |   await page.getByRole('button', { name: /CONSTRUCT EXTRACTOR/ }).click()
  676 |   await expect(main).toHaveAttribute('data-extractor-status', 'constructing')
  677 |   await expect(page.locator('.phase-label')).toHaveText('EXTRACTOR ASSEMBLY')
  678 |   await setSimulationPaused(page, true, 1_700)
  679 |   await expect(canvas).toHaveAttribute(
  680 |     'data-camera-mode',
  681 |     'surface-focus-construction',
  682 |   )
  683 |   await page.waitForTimeout(600)
  684 |   await page.screenshot({
  685 |     path: SCREENSHOT_DIRECTORY + '/09-extractor-construction.png',
  686 |   })
  687 |   await setSimulationPaused(page, false)
  688 |   await expect(main).toHaveAttribute('data-outpost-stage', 'extractor-active', {
  689 |     timeout: 5_000,
  690 |   })
  691 |   const activationTimestampMs = Number(
  692 |     await main.getAttribute('data-extractor-activation-at'),
  693 |   )
  694 |   expect(Number.isFinite(activationTimestampMs)).toBe(true)
  695 |   await setSimulationPausedAt(page, activationTimestampMs + 500)
  696 |   await expect(canvas).toHaveAttribute(
  697 |     'data-camera-mode',
  698 |     'surface-focus-activation',
  699 |   )
  700 |   await page.waitForTimeout(650)
  701 |   await page.screenshot({
  702 |     path: SCREENSHOT_DIRECTORY + '/10-extractor-active.png',
  703 |   })
  704 |   await page.screenshot({
  705 |     path: SURFACE_AFTER_SCREENSHOT_DIRECTORY + '/05-active-extractor.png',
  706 |   })
  707 | 
  708 |   const focusedExtractorMetrics = await readRenderMetrics(page)
  709 |   console.log(
  710 |     'FIRST_OUTPOST_FOCUSED_EXTRACTOR_METRICS ' +
  711 |       JSON.stringify(focusedExtractorMetrics),
```