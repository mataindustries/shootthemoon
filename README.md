# Shoot the Moon

**Play it live: <https://shootthemoon.pages.dev/>**

Shoot the Moon is a browser-based lunar strategy game, built for mobile and
desktop. You claim a landing site, mine lunar ore, and build out a base while a
rival AI commander, Null Meridian, escalates against you. You answer with
Counterstrike missile launches and defend against attack waves. The
conflict then moves into orbit with Orbital Siege, and the campaign ends with a
permanent territory monument that is visible from orbit.

- **Mining and base building:** land a capsule, deploy mining robots, build
  extractors and outpost modules, and spend ore and generated power.
- **Combat:** Counterstrike launches, wave defense, and Orbital Siege, with
  operations allocated in a Command Phase.
- **Rival AI:** Null Meridian is driven by the deterministic simulation.
- **Endgame:** after a successful Orbital Siege (or the earlier First Strike
  ending) you can claim one of four territory monuments: Helios Spire, Crater
  Crown, Bastion Ziggurat, or Signal Array. Earlier campaign outcomes remain
  available.

## Technology

React, TypeScript, Three.js / React Three Fiber, and Vite. The game is a
single-player client with no backend, accounts, or networking.

- **Deterministic simulation:** game rules live in pure simulation modules under
  `src/simulation` and `src/domain`, separate from rendering. See
  [ARCHITECTURE.md](./ARCHITECTURE.md).
- **Saves:** progress is stored locally in versioned saves (current schema
  version 9) with migrations from earlier versions
  (`src/persistence/outpostSave.ts`).
- **Testing:** Vitest unit tests for simulation, persistence, camera, and
  presentation logic, plus Playwright browser tests against the production
  build (`npm run check`, `npm run test:e2e`).
- **Generated content:** structures are authored procedurally in TypeScript with
  no external model files, and sound effects are synthesized with Web Audio after
  a user gesture. The only third-party art is two NASA lunar textures, recorded
  in [ASSETS.md](./ASSETS.md).
- **Reel pipeline:** a deterministic capture and render pipeline under
  [capture/](./capture/README.md), driven by GitHub Actions, produces the
  portfolio reel and stills. The final render and assembly pipeline and its
  deliverables now exist.

## Status

Automated production and release verification is complete. Physical Android
device acceptance (frame pacing, thermals, real touch behavior) is still open:
the repository contains no dated record of a completed device pass, and the
device checklist is in [PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md).

Performance: the project was built against a written performance budget
([PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md)) that set a 400 KiB gzip
ceiling for initial JavaScript. That target held through First Strike, but
a later measured production build was about 433 kB gzip of JavaScript
(recorded in `capture/endCardFacts.ts`), which exceeds the original target.

## Documentation

- [PLAN.md](./PLAN.md) and [ARCHITECTURE.md](./ARCHITECTURE.md): design and
  milestone history. Older sections describe the First Strike-era prototype.
- [PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md): budgets and measurements.
- [ASSETS.md](./ASSETS.md): external asset provenance.
- [artifacts/release-candidate/README.md](./artifacts/release-candidate/README.md):
  First Strike release-candidate capture evidence (baseline and final sets).
- [capture/README.md](./capture/README.md): reel capture and assembly pipeline.

## Local commands

    npm ci
    npm run dev
    npm run check
    npm run build
    npm run test:e2e
    npm run preview

Install Playwright's Chromium once before the browser suite if needed:

    npx playwright install --with-deps chromium

To preview in Codespaces and expose Vite's port:

    npm run dev -- --host 0.0.0.0

To review the exact production build used by the browser suite, run:

    npm run build
    npm run preview -- --host 0.0.0.0

Node.js 20.19 or newer supported release lines are required; see package.json
for the exact engine range.
