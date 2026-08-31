# Release-candidate verification record

Date: 2026-08-31  
Working state: intentionally uncommitted on the clean FIRST STRIKE MVP
checkpoint; no commit, push, tag, merge, or deployment was performed.

## Final automated gate

| Gate | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 18 files, 132 tests |
| `npm run build` | Passed |
| Focused rendered-terrain and route coverage | Passed: 89 tests during integration; final focused terrain/route selection 39/39 |
| `e2e/moon-core.spec.ts` | Passed: 10/10 |
| `e2e/first-strike.spec.ts` | Passed: 2 passed, recording-only case skipped by design |
| Recording-mode First Strike case | Passed: 1/1 |
| `e2e/rc-verification.spec.ts` | Passed: 5/5 |

The production browser path covers fresh entry, First Outpost, Rival Signal,
arm/cancel/confirm, the deterministic 26.1-second strike, impact, ending, scar
exploration, orbit, refresh/restore, replay, reset, save migrations, interrupted
state normalization, touch drag/pinch discrimination, portrait and landscape
layouts, orientation changes, route and camera clearance, console/page errors,
WebGL context recovery, effect cleanup, and demand-idle behavior.

The deliberate context-loss test observes one queued WebGL error (`1282`) from
the `WEBGL_lose_context` extension itself. It drains that induced queue and then
proves that the restored canvas renders with `NO_ERROR`, no lost context, and no
console or page error.

## Terrain-grounding proof

`src/render/renderedSurface.ts` is the single source of truth for visual
grounding. It reproduces the production `SurfacePatch` grid, the same diagonal
cell split, and barycentric triangle interpolation instead of sampling the
continuous terrain-height function. Unit tests cover exact grid vertices,
interior points on both cell triangles, shared-edge continuity, and clamping.

Player feet and wheels, extractor pads, rival foundations, launcher supports,
the damaged foothold, impact emitters, crater floor, rim, ejecta, wreckage,
surface-camera targets, reveal/scan effects, and moving shadow targets all use
that rendered-mesh sampler. Fresh, cinematic, completed, restored, replayed,
and migrated browser paths passed without the former approximately 3.35-metre
terrain-datum mismatch.

## Evidence acceptance

The preserved `baseline/` directory contains 14 MVP frames and its original
strike recording. The accepted `final/` directory contains all 15 required
release-candidate frames and one uninterrupted production recording from arming
through the ending. The final recording is 39.76 seconds long and retains the
26.1-second authored strike timing.

Every final frame and sampled launch/impact/ending recording frame was inspected
for grounding, clipping, exposure, silhouette, transparency sorting, shadow
continuity, camera obstruction, mobile legibility, impact visibility, crater
depth, and idle effect cleanup. The scar-exploration composition fits the full
approximately 866-metre damage field with untouched regolith around it. Its
depressed floor, broken raised rim and form shadows, radial ejecta, altered
regolith, and embedded wreckage read as displaced terrain rather than a disc,
decal, icon, plate, or spike wheel.

Recording SHA-256:
`fc974a7c794243bd930da7aee4c15021083272201aeca3f00ad0f1d4154dd1d1`.

## Final measured budgets

- Settled player surface: 59 calls, 59,264 triangles, 34 geometries, 6
  textures, 18 warmed programs.
- Strike peak: 33 calls, 35,180 triangles, 28 geometries, 6 textures, 18
  warmed programs.
- JavaScript: 1,294,178 raw bytes; 353.91 kB Vite gzip; 348,698 bytes
  (`340.53 KiB`) at `gzip -9`.
- JavaScript SHA-256:
  `d24170c4ac8462c68950b58e57f5bc7bb708efa889cb66ef7dd3e8c92b4b5ca9`.
- Entry, ending, and scar exploration rendered at most one frame during their
  900-ms idle samples; the stored surface rendered zero frames over 800 ms.

Physical Android GPU, browser-chrome viewport changes, touch latency, haptic
strength, audio routing, OLED shadow detail, sustained frame pacing, and thermal
behavior remain device-acceptance checks, not claims of this headless run.
