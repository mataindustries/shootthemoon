# Shoot the Moon implementation plan

Status: Outpost Operations V1 automated release verification complete,
2026-09-05, on `feature/outpost-operations`. READY FOR DEVICE TEST.
See the final recovery checkpoints below. Physical Android acceptance remains open.
The milestone narrative below retains the historical First Strike checkpoints.

Moon Core remains the technical foundation. The current product slice extends
it through one authored First Strike loop: orbit, claim, land, deploy one
miner, mine Lunar Ore, construct one extractor, discover and scan Commander
Vesper's Null Meridian foothold, deliberately arm and launch one lunar warhead,
and revisit the resulting permanent scar. The architecture and budgets remain
gates for every extension.

## Product boundary

The implemented checkpoint contains:

- the architecture and performance contracts;
- a Vite, React, strict TypeScript, Three.js, and React Three Fiber app;
- one rotatable, true-3D Moon;
- pointer and touch orbit/zoom controls;
- precise mean-sphere selection stored as canonical latitude, longitude,
  altitude, and orientation;
- one continuous orbital-to-surface camera journey and return;
- one code-authored landing capsule, local curved terrain overlay, and bounded
  impact effect;
- one code-authored miner with deterministic deployment, travel, mining,
  return, cargo, and unload states;
- exactly three stable Lunar Ore deposits and one constructible extractor;
- one deterministic rival foothold, authored reveal, transmission, and scan;
- one arm, cancel, confirm, and launch flow with a deterministic 26.1-second
  First Strike cinematic;
- one persistent lunar scar at the exact canonical rival coordinate, plus
  safe transient replay and close scar inspection;
- a versioned local domain save, safe transient-state restoration, reset, and
  orbit-to-outpost revisit flow;
- a surface-attached orbital signature that evolves with the outpost;
- reproducible unit, build, production-preview, and browser-interaction gates.

Explicitly excluded are additional buildings, currencies, workers, power
networks, upgrade trees, crafting, combat, accounts, multiplayer, matchmaking,
network persistence, territory systems, additional weapons, elaborate
dashboards, other celestial bodies, solar-system travel, DOM or canvas gameplay
sprites, emoji assets, fake perspective, and any 2D gameplay implementation.
New scope requires an explicit plan change.

## Researched stack baseline

The dependency baseline was checked against current official documentation and
package registries on 2026-08-25.

| Layer | Selected baseline | Reason |
| --- | --- | --- |
| Build | Vite 8.2 | Current official React TypeScript template and fast ESM development |
| UI/runtime | React 19.2 | Current stable React line |
| 3D renderer | React Three Fiber 9.7 | R3F 9 is the documented pairing for React 19 |
| 3D engine | Three.js r185 | Current stable Three.js line; WebGLRenderer uses WebGL 2 |
| Type system | TypeScript 6.0.3 locked | Matches the current official Vite React TypeScript template range; strictness is strengthened locally |
| Lint | Oxlint 1.80 locked | Resolves from the current official Vite React TypeScript template range |
| Browser target | Current Chrome for Android with WebGL 2 | Concrete mobile-first rendering target |

Important implications:

- Vite transpiles TypeScript but does not type-check it, so type checking remains
  an explicit build gate.
- The application uses React StrictMode to expose unsafe render and cleanup
  behavior during development.
- R3F Canvas supports a bounded DPR and demand rendering; both are established
  in the scaffold.
- Three.js renderer.info supplies draw-call, triangle, geometry, and texture
  counters used by the performance gates.
- glTF/GLB is the runtime model format. Compressed geometry and KTX2 textures
  are introduced with the assets, not as unused scaffold dependencies.

Primary references:

- [Vite getting started](https://vite.dev/guide/)
- [Vite TypeScript behavior](https://vite.dev/guide/features#typescript)
- [Current Vite React TypeScript template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts)
- [TypeScript strict checking](https://www.typescriptlang.org/tsconfig/strict.html)
- [React StrictMode](https://react.dev/reference/react/StrictMode)
- [React Three Fiber introduction](https://r3f.docs.pmnd.rs/)
- [React Three Fiber Canvas](https://r3f.docs.pmnd.rs/api/canvas)
- [React Three Fiber performance scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)

## Milestones

Each milestone is independently reviewable. A milestone is complete only when
all of its checks pass and its scope exclusions remain absent.

### M0 — planning and empty 3D scaffold

Deliverables:

- PLAN.md, ARCHITECTURE.md, and PERFORMANCE_BUDGET.md;
- the minimal full-screen R3F Canvas scaffold;
- strict compiler settings, a lockfile, and verification scripts.

Acceptance:

- npm ci succeeds from a clean checkout;
- npm run check and npm run build succeed;
- the production build opens with an empty near-black WebGL canvas and no
  console errors;
- portrait and landscape layouts fill the viewport on an Android device;
- the source contains no Moon, controls, game entities, asset loaders, network
  code, state library, physics library, or gameplay UI.

Status: complete at the planning/scaffold checkpoint; retained as historical
acceptance context.

### M1 — pure lunar coordinate kernel

M1.1 defines branded or otherwise guarded radians/meters types, longitude
normalization, latitude validation, and the mean-sphere datum.

M1.2 implements lunar-location to Moon-fixed Cartesian conversion and its
inverse without importing React, R3F, or Three.js.

M1.3 implements the east/up/south tangent basis and bidirectional
global-to-local transforms.

Acceptance:

- add a unit-test runner and npm test;
- cover the prime meridian, quadrants, antimeridian, both poles, negative and
  positive height, and invalid input;
- randomized location round trips are within 1 millimetre at lunar scale;
- tangent bases are orthonormal and right-handed within 1e-12;
- a local-to-global-to-local round trip is within 1 millimetre for points up to
  20 kilometres from the anchor;
- the domain package has no dependency on Three.js.

Status: complete. Sixteen unit tests cover the coordinate kernel and orbital
ray selection, including randomized millimetre-scale round trips.

### M2 — orbital Moon and touch rotation

M2.1 renders one geometric Moon with a low-cost material and an explicit lunar
asset provenance record.

M2.2 adds a control adapter based on Pointer Events: one-finger drag rotates,
pinch adjusts orbit distance, and mouse input offers equivalent behavior.

M2.3 adds demand-render invalidation while interacting and returns to an idle
demand loop afterward.

Acceptance:

- the Moon is a real mesh seen through a PerspectiveCamera;
- a single drag produces rotation with no page scroll or accidental selection;
- two-finger gestures do not become false taps;
- controls behave in portrait and landscape and survive pointer cancellation;
- no DOM sprites, Canvas 2D rendering, fake perspective, or gameplay overlay is
  introduced;
- orbital counters stay inside the typical limits in PERFORMANCE_BUDGET.md.

Status: complete for the current scope. NASA's 2K lunar imagery, provenance,
Pointer Events/OrbitControls behavior, demand rendering, DPR limits, and three
quality tiers are implemented.

### M3 — precise surface selection

M3.1 distinguishes a tap from a drag using movement and duration thresholds.

M3.2 transforms the camera ray into the canonical frame and solves an analytic
ray/mean-sphere intersection in double precision.

M3.3 stores the result as canonical latitude, longitude, and height and renders
only a small 3D marker for development verification.

Acceptance:

- tests cover center, limb, miss, tangent, antimeridian, and polar rays;
- a selected location is stable when orbital render scale or DPR changes;
- reprojecting the saved location lands within 2 screen pixels of the original
  tap at the same camera pose;
- drag and pinch gestures never commit a landing location;
- selection state stores no mesh triangle index, UV, R3F event, or Three.js
  vector.

Terrain-accurate selection is deferred until a terrain datum exists. The first
playable must label mean-sphere selection honestly if it ships without terrain.

Status: complete as mean-sphere selection. Automated browser cases cover a
near-side hit, a limb hit, both polar regions, and both sides of the longitude
seam; raw mesh intersections never enter simulation state.

### M4 — orbital-to-surface camera journey

M4.1 adds a cancellable camera state machine: orbital, targeting, approach,
surface, and return.

M4.2 samples the journey in canonical coordinates and introduces the tangent
render frame at the selected anchor.

M4.3 hands off from the orbital representation to the local surface
representation without changing the canonical camera pose.

Acceptance:

- transition tests use a deterministic clock rather than wall time;
- endpoints, cancellation, resize, tab suspension, and reduced-motion behavior
  are covered;
- no frame switch creates a visible position or orientation jump greater than
  2 screen pixels in the reference captures;
- the camera near/far ratio remains bounded per phase and there is no visible
  z-fighting;
- a full descent and return remain within the transition limits in
  PERFORMANCE_BUDGET.md.

Status: implemented for the capsule journey. The browser suite fixes cinematic
progress for deterministic impact/landed captures and verifies the complete
return-to-orbit state transition. Physical-device comfort and frame pacing
remain M6 work.

### M5 — landing entities

M5.1 defines an asset manifest and validates one optimized capsule GLB.

M5.2 loads and places exactly one capsule at the selected tangent-frame origin.

M5.3 validates, loads, and places exactly one robot using the same asset
pipeline. Locomotion, inventory, building, combat, and AI are not added.

Acceptance:

- both assets have documented licenses, units, pivot conventions, triangle
  counts, texture memory, and compressed transfer sizes;
- both remain correctly aligned at equatorial, polar, and antimeridian test
  locations;
- loading, failure, retry, unmount, and GPU-resource disposal paths are tested;
- only one capsule and one robot exist;
- the complete scene remains within every hard performance ceiling.

Historical status at M5: the capsule-only slice used code-authored true-3D
geometry and therefore needed no external model loader. M7 supersedes the robot
deferral with one code-authored miner; a general GLB asset repository remains
deferred.

### M6 — first-playable hardening

M6.1 captures deterministic visual baselines for orbit, selected location,
impact, and landed capsule. M7 extends those baselines through the robot and
outpost loop.

M6.2 completes the physical-Android performance and thermal soak protocol.

M6.3 verifies WebGL context loss/recovery, cold-cache loading, offline failure,
orientation changes, and touch interruption.

Acceptance:

- every current verification command passes from a clean checkout;
- the Pixel 6a reference run passes frame, memory, rendering, and load budgets;
- desktop screenshot tests pass, while physical-device review confirms touch,
  GPU behavior, text legibility, safe areas, and both orientations;
- the experience contains only the six first-playable capabilities listed
  above.

This milestone ends Moon Core. A later product phase needs a new plan.

Status: automated portrait and desktop coverage is implemented. Physical Pixel
6a performance, thermals, actual Android touch, orientation, context recovery,
and a long soak remain open and cannot be replaced by headless Chromium.

### M7 — First Outpost

M7.1 extends the tangent site with deterministic terrain relief, instanced
rocks, distant ridges, three stable deposit placements, and shared CPU height
sampling for visible entity grounding.

M7.2 adds the capsule hatch, one miner, explicit robot state machine, Lunar Ore
reward loop, and a short two-return construction threshold.

M7.3 adds one staged extractor with controlled open-scene production timestamps,
a compact touch-first HUD, a versioned local save, safe restore, reset, orbital
signature, and revisit path.

M7.4 is the Surface Presence + Performance Headroom pass. It tightens the
surface composition and contextual action framing, strengthens bounded terrain
relief and grounding, improves mobile HUD readability, and batches capsule,
robot, extractor, and surface details. Transient action animation uses one
shared demand-invalidation loop; static and low-frequency idle behavior remain
demand rendered.

Acceptance:

- the explicit robot sequence is `stored → deploying → idle → traveling →
  mining → returning → unloading → idle`;
- exactly three touch-selectable Lunar Ore deposits exist and movement follows
  deterministic curved local routes plus the shared terrain-height sampler;
- two cargo returns unlock exactly one extractor at a valid selected deposit;
- local persistence contains canonical landing data and plain domain snapshots,
  normalizes every transient robot state, and never stores Three.js objects;
- return to orbit preserves the outpost, exposes its surface-attached signal,
  and allows a revisit without creating another base;
- the automated 390 × 844 production run captures deployment, mining, cargo
  return, construction/active extraction, orbital signature, and refresh
  restoration with no console or WebGL errors;
- orbital and active-surface frames remain within the established hard mobile
  render ceilings.

Status: implemented and automated. The settled active scene measures 50 draw
calls against the previous 78, with 58,160 triangles and a 321.27 kB gzip
JavaScript bundle. Physical Android touch, frame pacing, memory, and thermal
acceptance remain required before claiming device-level performance completion.

### M8 — Rival Signal

M8.1 derives one deterministic rival site from the player's canonical landing
site and persists Commander Vesper, reveal state, timestamps, exactly three
representable foothold stages, authored transmission completion, scan state,
and replay/skip eligibility in schema 2.

M8.2 interrupts the first active extractor with a bounded 3D reveal: warning,
orbital lift, hostile insertion, impact, Vesper transmission, and a dual-site
Moon composition. Restored active-extractor saves wait for an explicit orbit
return; transient cinematics normalize to a safe queued state. The authored
first-reveal phases total 26.3 seconds (28.5 seconds including the extractor
lead-in), and every orbital leg uses the sampled radial-clearance contract.

M8.3 adds one reduced-detail Null Meridian foothold, forgiving surface-attached
orbital selection, a focused scan sweep, one deterministic `LANDED` to
`ESTABLISHING` transition, a response transmission, and the locked First Strike
teaser. `FORTIFIED` remains testable but does not occur in the reveal.

Acceptance:

- exactly two factions and one deterministic AI rival exist; there is no
  networking, combat, territory control, additional building, or hidden
  multiplayer infrastructure;
- both signatures and footholds derive from canonical domain coordinates and
  restore across refresh without serializing Three.js values;
- reveal, scan, response, replay/skip, migration, interruption normalization,
  reset, mobile touch, landscape, desktop, console, WebGL, and demand-idle
  browser gates pass in the production preview;
- cinematic and strategic frames remain within the established hard mobile
  budgets without lowering Moon quality.

Status: implemented and automated. The cinematic peaks at 19 draw calls and
32,000 triangles; both signatures use 21 calls and 32,300 triangles; the player
surface remains at 50 calls and 58,160 triangles. Physical Android acceptance
remains required.

### M9 — First Strike MVP

M9.1 advances the local save to schema 3 and adds one serializable First Strike
snapshot. Strike readiness follows the completed Vesper scan; arming requires a
separate confirmation; interrupted destructive phases normalize to safe domain
states instead of restoring midway through presentation.

M9.2 adds one code-authored lunar warhead and launcher, a deterministic
spherical missile route, and a separate camera route. The nine automatic
presentation phases total exactly 26.1 seconds. Both routes retain sampled
radial clearance from the Moon, and the missile-follow phase remains the
signature continuous 3D sequence.

M9.3 commits impact facts at Commander Vesper's canonical foothold coordinate,
damages Null Meridian, creates one permanent scar, and presents the authored
ending. Refresh, return to orbit, close scar inspection, replay, and reset do
not duplicate resources, rival structures, effects, or scars. Replay authority
is transient presentation state and does not rewrite the completed save.

Acceptance:

- the locked loop remains `claim → land → deploy → mine → construct → reveal →
  scan → arm → cancel/confirm → launch → impact → ending`;
- the missile visibly clears the launcher, follows its deterministic safe arc,
  separates from the camera, and impacts the exact rival coordinate;
- schema 1 and 2 saves migrate to schema 3, while interrupted launch, impact,
  ending, and exploration restores normalize safely;
- complete, replay, refresh, and reset paths preserve domain authority without
  serializing Three.js objects or presentation animation state;
- production browser gates cover the strike route, camera clearance, page and
  WebGL errors, persistence, replay, and demand-idle completed states.

Status: complete at committed checkpoint `d377cb5` ("Complete First Strike
lunar warhead MVP"). Its preserved baseline measured 33 draw calls, 32,766
triangles, 24 warmed shader programs, and a JavaScript bundle below the 400 KiB
gzip ceiling. Physical Android acceptance remained open.

### M10 — release-candidate visual transformation

M10.1 establishes one production renderer and faction material system in
`src/render/visualSystem.ts`: ACES filmic tone mapping, explicit sRGB output,
controlled exposure, fixed global sunlight, dark lunar shadow detail, restrained
emissive values, and shared player, rival, damage, and neutral machinery
responses. The concise governing rules live in `VISUAL_DIRECTION.md`.

M10.2 rebuilds the capsule, miner, extractor, launcher, warhead, and Null
Meridian foothold as coherent code-authored hard-surface assemblies. Player
technology shares blackened industrial armor and amber/red internal light;
Vesper's site uses a dark asymmetric skeleton with controlled cyan-white
surgical elements. All structures attach to the final sampled terrain surface,
not the prior flat tangent plane.

M10.3 replaces symbolic strike presentation with controlled ignition and
exhaust, vacuum-appropriate radial regolith and ballistic debris, rival-base
destruction, and a depth-producing permanent crater. The scar combines a
depressed floor, irregular raised rim, radial ejecta, altered regolith,
embedded wreckage, cooling thermal points, and close/orbital presentations at
the same canonical coordinate.

M10.4 adds the `SHOOT THE MOON / FIRST STRIKE` opening gate, `BEGIN INVASION`
and `CONTINUE` entry, compact contextual strike captions, the
`FIRST STRIKE COMPLETE / THE MOON REMEMBERS` ending, scar exploration, orbit
return, and safe strike replay. A discreet toggle gates original Web Audio
sonification behind user interaction; optional feature-detected vibration is
reserved for ignition and impact.

Acceptance:

- the existing gameplay states, canonical coordinates, 26.1-second missile and
  camera timing, save schema, migrations, interruption normalization, and reset
  behavior remain unchanged;
- launch, impact, rival reveal, and scar exploration use one fixed world-sun
  direction while a bounded shadow camera follows only the active close view;
- no clipped white structures, broad cyan transparency, floating or buried
  feet, decal-like crater, atmospheric mushroom cloud, or inactive effect loop
  remains in final evidence;
- portrait and landscape production evidence includes all 15 required frames
  and one uninterrupted arming-to-ending recording, separated from the
  untouched MVP baseline;
- final automated verification and measured performance remain within the
  release-candidate gates, followed by physical Android review.

Status: visual implementation, production verification, evidence review, and
automated performance measurement are complete. Physical Android touch,
audio/haptics, sustained frame pacing, OLED shadow-detail, and thermal
acceptance remain open before deployment approval.

## Verification commands

Current automated gates:

    npm ci
    npm run lint
    npm run typecheck
    npm test
    npm run build
    npm run check
    npm run test:e2e

Current local review:

    npm run dev -- --host 0.0.0.0
    npm run preview -- --host 0.0.0.0

npm run check is the CI-sized gate: lint, strict type checking, unit tests, and
a production Vite build. npm run test:e2e starts that production preview and
runs the deterministic 390 × 844 touch flow, coordinate edge cases, render
budget assertions, console checks, and a desktop sanity case. npm run preview
serves built output for review; it is not a production server.

## Mobile visual-testing gate

Desktop mobile emulation is useful for viewport sizing and automated pointer
sequences, but it is not evidence of mobile GPU performance. Each visual
milestone must also be reviewed on a physical Pixel 6a, or a documented device
with no more than 6 GB RAM and comparable or lower graphics performance, using
the current stable Chrome for Android.

At minimum, review:

- 360–430 CSS-pixel portrait widths and the corresponding landscape layout;
- browser chrome expanded and collapsed;
- orientation change during an interaction and during camera travel;
- one-finger drag, slow and fast taps, pinch, pointer cancellation, and edge
  touches;
- every required reference scene at DPR 1.0 and at the active quality tier;
- visual seams, shimmering, texture blur, clipping, z-fighting, selection-marker
  alignment, black frames, and context-loss symptoms;
- cold-cache load and a 10-minute interactive thermal soak.

The complete measurement protocol and numeric limits are in
PERFORMANCE_BUDGET.md.

## Assumptions accepted for this checkpoint

- Selection uses the declared 1,737,400-m mean sphere; visual height/bump data
  is not claimed as terrain-accurate picking.
- NASA SVS imagery is used under its public-domain terms; hashes and links are
  recorded in ASSETS.md.
- A deterministic procedural tangent patch supplies close-range visual relief
  while canonical location remains independent of that render representation.
- Outpost objects use stable local tangent coordinates in metres. The terrain
  remains a bounded presentation and approximate grounding query, not an
  unrestricted traversal engine or terrain-accurate global datum.
- Extractor production advances only while the surface simulation is open;
  restore and revisit reset its production baseline, so offline economy is not
  implemented accidentally.
- Headless Chromium validates browser behavior and framing, but a physical
  Android device is still required before claiming the Pixel 6a performance
  gate or real-touch/thermal acceptance.

## Continuation checkpoint — Outpost Operations V1 (2026-09-04)

Current branch: `feature/outpost-operations`, base commit `4ffea3b`; working tree
contains the interrupted implementation and its existing evidence. No branch
switch, reset, commit, push, merge, or deployment is authorized in this pass.
No AGENTS.md files were found in the repository or its ancestor instruction paths.

V1 extends the existing outpost with schema 5 (including schema 4 migration),
Conserve/Balanced/Overdrive, finite ore storage, site-derived solar energy,
terrain/deposit/logistics-derived output, and the accepted Counterstrike damage
multiplier of 0.70 (30% lower production). Energy is generated/consumed power,
not a stored currency. Surface production resumes from a fresh time baseline;
ore, operating settings, buildings, progression, and accepted outcome persist.
There is no offline production or repair action in V1. The existing three small
operational hauler instances are part of this interrupted V1 implementation.
No Command Phase, further buildings, currencies, or graphics overhaul is in scope.

Continuation fixes and verification in progress:

- Confirmed the ending action and initialize-only-if-empty fixtures were already
  present. Added accepted-ending guards to the operations action. It dismisses
  only transient Counterstrike presentation and selects the existing saved site;
  `REVISIT OUTPOST` uses the existing real camera journey and resume handler.
- Added an explicit damaged-production HUD label and rounded displayed ore to
  one decimal without changing saved precision.
- Personal screenshot inspection found an orbital First Strike completion panel
  overlapping the surface HUD and the existing damaged extractor/crater missing
  from revisits. Restricted that panel to orbital readiness and retained the
  existing permanent damage visuals at the operational surface.
- Focused units: `npm test -- src/simulation/outpostOperations.test.ts
  src/simulation/outpostSimulation.test.ts src/persistence/outpostSave.test.ts
  src/simulation/counterstrikeSimulation.test.ts`: 4 files / 51 tests passed.
- Initial fresh harness build passed. Initial operations browser pass: 3 passed,
  1 failed. Full-storage fixture replacement raced the active simulation's save;
  split it into an isolated initial-save case with tick/refresh assertions.
- Added ordinary-session end-to-end coverage for BOTH accepted endings, real
  camera travel, touch drag/pinch, active production, economic/progression facts,
  refresh from surface, and another orbital-signal revisit. Assertions compare
  served index.html with current dist/index.html to detect stale previews.
- Sandbox loopback binding initially failed with EPERM; the task-owned preview
  was then started through approved escalation at 127.0.0.1:4173, strict port.
  Preview session 46535. Reuse this process, do not start a second server.

Evidence directory: `artifacts/outpost-operations-verification/` (logs plus a
preserved copy of interrupted test-results); screenshots:
`artifacts/screenshots/outpost-operations/`. Verification below will be updated
with final commands and results before handoff.

Next action at this checkpoint: finish the rebuilt focused browser tests,
inspect all final portrait/landscape states, run lint/typecheck/all units,
affected harness regressions, then build and smoke-test an ordinary production
bundle with test overrides absent. Physical Android acceptance remains open.

Additional findings from the strengthened focused pass:

- Five operations/browser cases passed, but BOTH real touch/revisit cases failed:
  production ticks recreated `secondaryImpactSite`, causing CameraRig to reset
  the surface view. Memoization now follows only canonical site and extractor
  position; the regression holds drag/zoom assertions across later ticks.
- Moved the held-signal prompt into normal operations-panel layout after visual
  inspection found it overlaid the energy row. The operations tests now use
  ordinary sessions and real camera travel with no simulation controls.
- `npm run lint`, `npm run typecheck`, `npm test`: passed; 24 unit files / 176
  tests. These will be checked again after the final presentation/camera edits.
- Initial intact/accepted-failure operating surface sample after permanent damage
  restoration: 65 draw calls / 59,974 triangles / 21 programs (damaged). This is
  below the unchanged complete-landed 80-call / 200,000-triangle hard ceilings.
  The stricter intact migrated-active 60-call / 60,000-triangle gate remains.

## Recovery and final verification — 2026-09-05

Recovered the existing `feature/outpost-operations` working tree without branch
changes or discarded files. Inspected tracked diffs, new implementation/tests,
repository contracts, verification logs, and screenshots. The prior
`source-files.sha256` matched every source/test file at recovery. No previous
preview or test remained active (also checked the host process list); the
old preview session 46535 was gone. A new task-owned strict-port preview serves
127.0.0.1:4173, session 52052, with output in `preview-recovery.log`.
Loopback binding required sandbox escalation after the normal attempt returned
EPERM. No commit, push, merge, reset, or deployment was performed.

The interrupted session's final run actually FINISHED WITH TWO FAILURES:
`revisit-final.log` records both, while `unit-final.log` records 24 files / 176
passing units. Its original failure traces are preserved in
`recovered-final-test-results/`. Other regression results were not recorded
against that final source, so those affected checks still required verification.

Additional recovery changes:

- Refresh fixture captures the last persisted save in the browser's `pagehide`
  task and requires EXACT ore equality after reload and while at the ending.
  This removes a Node-to-browser timing race without allowing lost or offline ore.
- The ordinary-session revisit fixture now projects the canonical site from the
  reported real camera pose; harness-only signal coordinates were absent and
  previously converted to a `(0, 0)` tap. It explicitly asserts near-side
  visibility and viewport bounds before touching the projected signal.
- This exposed a product bug: after accepted Counterstrike, returning from the
  surface passed the rival scar as BOTH anchors of the dual-site orbit camera.
  SceneRoot now retains the player anchor after either accepted ending.
  `revisit-recovery.log` and `recovery-camera-failure-results/` preserve the
  reproduction before the camera fix.
- Added default-view captures and a <=16 frames / 1,400 ms operations-idle gate,
  matching the existing active-surface regression limit. No rendering budget or
  continuous-render condition changed.
- Removed an unnecessary regex escape in the ordinary-build verification script
  and extended it to exercise the real damaged-outpost return and idle counters.

Final verification results are recorded below after all checks complete.
All log names below are relative to `artifacts/outpost-operations-verification/`.

Completed commands so far:

- `npm run lint` → PASS, no warnings (`lint-complete.log`).
- `npm run typecheck` → PASS (`typecheck-complete.log`).
- `npm test` → PASS, 24 files / 176 tests (`unit-complete.log`).
- `VITE_E2E_HARNESS=1 npm run build` → PASS (`harness-build-complete.log`);
  Vite retains its unchanged >500 kB raw-chunk advisory. Harness asset hashes:
  `harness-assets-complete.json`; final source hashes:
  `source-files-complete.sha256`.
- `npm run test:e2e -- e2e/outpost-revisit.spec.ts` → PASS, 2 / 2 in 3.8 min
  (`revisit-complete.log`), including fresh served-index equality.
  Accepted FAILURE and SUCCESS preserve authored gameplay/progression,
  Overdrive, 320 storage capacity, energy and ore across real camera return,
  refresh, and a second signal revisit. Failure keeps the exact 0.70 damage
  multiplier; success keeps 1.00. Both retain drag/pinch across production ticks.
  Default surface counters: damaged 65 calls / 59,974 triangles / 21 programs;
  intact 60 / 59,300 / 20. Gesture/orientation samples peak at 67 calls / 60,082
  triangles (damaged landscape). Idle: failure 7 and success 4 frames / 1,400 ms.

### Second recovery checkpoint

The next interruption ended preview session 52052 and regression session 13605.
Host process inspection found neither active. `regressions-complete.log` ends
at case 9/14 without a final summary: cases 1–7 passed (five Counterstrike,
two First Strike); case 8 First Outpost failed waiting for `mining`; case 9
Rival Signal orientation was INTERRUPTED; cases 10–14 never started. The
checkpoint description conflated the First Outpost failure with the following
Rival Signal test. The orientation test has no mining-state expectation; its
exact position/target/radius assertions remain unchanged. First Outpost mining
and construction had not completed in this regression run.

The First Outpost fixture previously held `traveling` while Node performed
separate browser round trips, then resumed an independently advancing Date.now
clock. `advanceRobot` correctly caught up into returning/unloading/idle. The
fixture now arms one browser MutationObserver BEFORE the mine action, records
and asserts the exact `traveling,mining` transition sequence, and pauses only
at mining. The observed sequence is stable evidence even if a later clock tick
advances the robot. The synchronization assertion accepts either the still-visible
`mining` state or the valid subsequent `returning` state; the exact observed
sequence remains the proof that mining began. No production clock, timeout,
camera assertion, or gameplay behavior changed.

All application source hashes still match `source-files-complete.sha256`;
only the First Outpost fixture in `e2e/moon-core.spec.ts` differs. Reuse the
seven completed regressions and the two complete revisit passes. Original
regression failure artifacts: `interrupted-regression-results/`.
New preview: session 17395, strict 127.0.0.1:4173 (`preview-final.log`).
Artifact verification now recursively walks files only and checks every served
file (including lunar JPEGs), SHA-256, and gzip size. The earlier directory-read
Python exception was a script issue, corrected in `harness-assets-complete.json`.

- `npm run test:e2e -- e2e/moon-core.spec.ts --grep 'Rival Signal camera is invariant'`
  → PASS, 1 / 1 in 2.7 min (`rival-orientation-final.log`). No orientation
  assertion change was necessary: the prior run was interrupted, not failed.
- Final lint/typecheck after the First Outpost fixture and file-only verifier
  edits: PASS (`lint-final-recovery.log`, `typecheck-final-recovery.log`).
  The 176-unit pass remains valid: unit/application source is unchanged.
- `npm run test:e2e -- e2e/moon-core.spec.ts --grep 'Rival Signal|interrupted cinematic|pending rival response'`
  → PASS, 7 / 7 in 11.4 min (`rival-group-final.log`). This reran the repaired
  First Outpost handoff, the requested orientation case within its group, and
  all five previously unstarted cases. First Outpost correctly observed
  traveling/mining, tested sustained mining animation, completed cargo return
  and extractor construction, and queued one reveal. No timeout was changed.
  Stored surface: 0 frames / 800 ms; scanner: 7 / 1,000 ms; focused extractor:
  43 calls / 57,692 triangles. Migrated intact surface: 60 calls / 59,300
  triangles / 18 programs and 4 frames / 1,400 ms; contested orbit: 6 / 1,400 ms.
- The 14 affected regression cases are now all complete: reuse 7 original
  passing Counterstrike/First Strike cases plus the final 7-case group. First
  Strike's main reported peak was 33 calls / 35,060 triangles; its replay frame
  list includes 35,180 triangles, which is the conservative overall maximum.
  Optional recordings and unrelated Moon Core/RC tests were excluded. No
  already-passing multi-minute Counterstrike, First Strike, or revisit loop
  was replayed after this second recovery.


### Final automated handoff — READY FOR DEVICE TEST

Original affected-regression command (interrupted after seven passes and one
fixture failure; its unfinished work is accounted for above):

```sh
npm run test:e2e -- e2e/moon-core.spec.ts e2e/first-strike.spec.ts e2e/counterstrike.spec.ts --grep 'First Outpost|Rival Signal|interrupted cinematic|pending rival response|First Strike production|completed fixture|Counterstrike|ordinary production' --grep-invert 'records a paced|records the complete'
```

Final ordinary-build commands and results:

- `env -u VITE_E2E_HARNESS npm run build` → PASS
  (`ordinary-build-final.log`). The final `dist/` is an ordinary production
  build, not a harness build.
- `npm run test:e2e -- e2e/outpost-operations.spec.ts` → PASS, 5 / 5 in 2.3 min
  (`operations-ordinary-final.log`): real site qualities, all three modes,
  persistence, low-energy throttling, storage-full stop across ticks/refresh,
  touch target size, both orientations, and exact persistent damage penalty.
  These regenerate earlier screenshots that predated the final CSS fixes.
- `node artifacts/outpost-operations-verification/verify-production.mjs` → PASS
  (`ordinary-integrity-final.log`, `ordinary-build-check.json`). All five dist
  files, including both lunar JPEGs, match the served bytes and SHA-256 hashes.
  Harness events remain inactive even with `?e2e`; accepted damage still reaches
  the real operations camera. No console/page errors. The unforced browser-tier
  surface sample is 42 calls / 40,018 triangles / 13 programs, with 5 frames /
  1,400 ms. Medium-tier acceptance measurements are retained separately above.
- `git diff --check` → PASS. Source hashes in `source-files-final.sha256`;
  screenshot hashes in `screenshots-final.sha256`. No application source
  changed after the final 176-unit pass. Final lint and typecheck pass without
  warnings. No assertions, timeouts, performance ceilings, or production
  simulation timing were weakened.

Final ordinary JavaScript: 1,358,843 bytes raw; 366,512 bytes gzip level 9
(357.92 KiB), below the unchanged 400 KiB hard ceiling and above the historical
325 KiB target. Vite reports 370.69 kB gzip and retains the >500 kB raw-chunk
advisory. CSS: 41,918 raw / 8,913 gzip bytes; HTML: 500 raw / 316 gzip bytes.
All hashes and exact sizes are in `ordinary-build-check.json`.

Personal visual inspection completed for all final operations portrait and
landscape captures: metrics, storage values, mode controls, damage label,
held-signal prompt, and header controls fit without clipping or overlap.
Portrait is capsule-centered; the wider landscape composition shows the
extractor/damage field, with real drag/pinch available for closer inspection.
Small secondary labels and dark shadow detail still require physical-device
legibility acceptance. Evidence directory:
`artifacts/screenshots/outpost-operations/`:

- `02-live-operational-hud.png`, `03-live-hud-landscape.png`;
- `04-low-energy.png`, `04b-low-energy-landscape.png`;
- `05-storage-full.png`, `05b-storage-full-landscape.png`;
- `06-damaged-production.png`;
- `07-failure-operations-portrait.png`, `08-failure-operations-landscape.png`;
- `07-success-operations-portrait.png`, `08-success-operations-landscape.png`;
- `09-failure-default-portrait.png`, `09-success-default-portrait.png`;
- `10-ordinary-production-portrait.png`, `10-ordinary-production-landscape.png`.

Final automated status: no unresolved failures or interrupted required checks.
Earlier failed/interrupted logs are retained as recovery evidence. The original
seven Counterstrike/First Strike passes and two revisit passes were reused;
one isolated orientation pass, seven focused group passes, and five ordinary
operations passes completed the remaining browser verification. Optional paced
recordings and unrelated broader regressions were intentionally excluded.
Physical Android tests were not run. The preview was stopped after validation;
host process inspection found no Playwright worker or Vite preview remaining.
`process-final.log` records this check. Nothing was committed, pushed, merged,
deployed, reset, or discarded; branch and base commit remain
`feature/outpost-operations` / `4ffea3b`.

Physical Android checklist (ordinary production build only):

- On Pixel 6a or documented comparable device, accept both Counterstrike
  outcomes; open operations, return to orbit, revisit, and refresh. Confirm ore,
  storage, energy, mode, progression, and the failure-only 30% penalty persist.
- Try Conserve, Balanced, and Overdrive, a low-energy site, and full storage.
  Check production/readouts and that success remains undamaged.
- Test portrait/landscape, browser bars expanded/collapsed, safe-area edges,
  small labels, OLED shadow detail, drag/pinch, pointer cancellation, and
  rotation during camera travel. Confirm camera control stays stable across ticks.
- Cold-load, background/restore, exercise context recovery and five round trips,
  then run the documented 10-minute unplugged thermal/frame-time/memory soak.
  Record device/OS/Chrome, quality tier, battery conditions, and build hashes;
  headless counters do not establish physical FPS, thermals, or touch latency.

### Active-writer recovery closeout — 2026-09-05

Recovered from the working tree, diffs, this plan, and
`artifacts/outpost-operations-verification/` only. Process inspection after the
Codespaces restart found no surviving Playwright worker or Vite preview. The
Rival Signal fixture retains its exact `traveling,mining` observation while
accepting `mining` or the semantically valid subsequent `returning` state. All
Rival orientation camera assertions remain exact and unchanged; no timeout or
production gameplay code changed.

- `VITE_E2E_HARNESS=1 npx playwright test e2e/moon-core.spec.ts --grep
  "Rival Signal camera is invariant across controlled starting orientations"`
  → PASS, 1 / 1 in 1.9 min. A revision-matched harness bundle was restored first
  because the recovered `dist/` contained the later ordinary bundle; the final
  build below replaced it again with ordinary production output.
- `npm run lint` → PASS, no warnings.
- `npm run typecheck` → PASS.
- `npm test` → PASS, 24 files / 176 tests.
- `npm run build` → PASS. Final `dist/` is the ordinary production bundle;
  Vite retains the existing >500 kB raw-chunk advisory.
- Existing revision-matched logs remain authoritative for the previously
  passing Counterstrike, First Strike, First Outpost, operations, revisit,
  persistence, touch, orientation, damage, storage, accepted-success, and
  demand-idle scenarios. No broad E2E suite, recording, or screenshot run was
  repeated in this closeout.

Automated status remains **READY FOR DEVICE TEST**. The physical Android
checklist above remains outstanding in full.
