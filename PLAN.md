# Moon Core implementation plan

Status: planning baseline, 2026-08-25

Moon Core is a narrow technical prototype. This plan deliberately stops at a
verified 3D scaffold. The Moon and the playable milestone are future work and
must begin only after the architecture, budgets, and open risks have been
reviewed.

## Product boundary

This planning-and-scaffold phase contains:

- the architecture and performance contracts;
- a minimal Vite, React, strict TypeScript, Three.js, and React Three Fiber app;
- one empty WebGL 2 canvas with a non-gameplay fallback message;
- reproducible build, type-check, lint, and production-preview commands.

The eventual first playable contains only:

- one rotatable, true-3D Moon;
- pointer and touch controls;
- precise selection of a lunar surface location;
- one continuous orbital-to-surface camera journey;
- one landing capsule;
- one robot.

Explicitly excluded from the first playable are dashboards, resource economy,
combat, accounts, multiplayer, matchmaking, persistence services, elaborate
HUD, other celestial bodies, solar-system travel, DOM or canvas sprites, emoji
assets, fake perspective, and any 2D gameplay implementation. New scope requires
an explicit plan change.

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

Status: this is the only milestone implemented by the current pass.

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

### M5 — one capsule and one robot

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

### M6 — first-playable hardening

M6.1 captures deterministic visual baselines for orbit, selected location,
mid-descent, landed capsule, and landed robot.

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

## Verification commands

Current automated gates:

    npm ci
    npm run lint
    npm run typecheck
    npm run build
    npm run check

Current local review:

    npm run dev -- --host 0.0.0.0
    npm run preview -- --host 0.0.0.0

npm run check is the CI-sized gate: lint, strict type checking, and a production
Vite build. npm run preview serves built output for review; it is not a
production server. M1 adds npm test. Later milestones add deterministic browser
visual tests and budget assertions rather than weakening the existing gates.

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

## Gate before Moon implementation

Do not begin M1 or render the Moon until the unresolved risks in
ARCHITECTURE.md have owners or explicit prototype assumptions. In particular,
the team must confirm the lunar datum/terrain source and license, physical
Android device availability, desired visual accuracy of the initial Moon
texture, and whether mean-sphere picking is acceptable for the first playable.
