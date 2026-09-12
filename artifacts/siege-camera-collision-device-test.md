# Orbital Siege camera and collision fixes

READY FOR DEVICE RETEST.

## Changes

- Touchdown uses one snapshotted, Moon-safe camera path and one projection sampler on the existing cinematic clock. Input and pointer capture are cleared at handoff. Re-renders cannot rebuild the active path from the live camera or an old OrbitControls target. The transition ends at the existing normal outpost pose before input is restored.
- The rival warning starts at an authored orbit pose. The installation reveal and scan use a separate fixed, aspect-aware surface pose. The installation fills the reveal frame, and the return starts from that same pose. Old touchdown and robot-focus references are cleared when another cinematic owns the camera.
- A deterministic swept-sphere calculation over the two authored rocket paths finds conservative solid-body contact before mesh overlap. The flight keeps its original movement clock and stops at that contact. One guarded contact event owns the outcome and impact time; duplicate and stale events are ignored. Both rocket bodies hide at contact even if the state update arrives a frame later. The effect uses the contact point, and the camera holds the same truncated flight endpoint before pulling back.

Economy, Orbital Siege rules, drone wave timing and campaign progression were not changed by this fix pass. Existing early/late interception decisions and Counterstrike outcomes remain intact.

## Validation

- 68 relevant unit tests across touchdown, enemy reveal, rival/counterstrike camera plans, swept contact, counterstrike simulation/routes and interception effects passed.
- Three production-build Playwright checks in `e2e/siege-camera-collision.spec.ts` passed (42.0 seconds): touchdown drag lock and deterministic endpoint; fixed enemy reveal and return; swept contact, immediate rocket removal, effect position and camera hold.
- Lint, typecheck, production build and diff whitespace checks passed. The production build retains the bundle-size advisory.
- No broad cinematic suites, commits or pushes.

Captures: `artifacts/screenshots/siege-camera-collision/touchdown.png`, `enemy-reveal.png`, and `interceptor-contact.png`.

## Physical device retest

1. Drag before and during touchdown; confirm a single transition, no inherited rotation, and normal camera control afterward.
2. Trigger the enemy reveal from different orbit/surface orientations; confirm the installation is clearly framed and the return is smooth.
3. Intercept on either attempt, including after background/resume or a slow frame; confirm neither rocket overlaps the other, only one impact occurs, and the camera holds contact before pulling back.
