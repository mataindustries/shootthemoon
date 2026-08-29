# Shoot the Moon implementation plan

Status: Rival Signal vertical slice implemented, 2026-08-28

Moon Core remains the technical foundation. The current product slice extends
it through one complete First Outpost loop: orbit, select, land, deploy one
miner, mine Lunar Ore, construct one extractor, return to orbit, and revisit a
persistent claimed site. The architecture and budgets remain gates for every
extension.

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
- a versioned local domain save, safe transient-state restoration, reset, and
  orbit-to-outpost revisit flow;
- a surface-attached orbital signature that evolves with the outpost;
- reproducible unit, build, production-preview, and browser-interaction gates.

Explicitly excluded are additional buildings, currencies, workers, power
networks, upgrade trees, crafting, combat, accounts, multiplayer, matchmaking,
network persistence, elaborate dashboards, other celestial bodies,
solar-system travel, DOM or canvas gameplay sprites, emoji assets, fake
perspective, and any 2D gameplay implementation. New scope requires an explicit
plan change.

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
