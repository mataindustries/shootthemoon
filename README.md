# Shoot the Moon — Moon Core

Moon Core is the true-3D technical prototype for Shoot the Moon. This repository
contains the first playable implementation: a rotatable lunar globe, precise
mean-sphere selection, a canonical coordinate readout, a surface-attached 3D
marker, and a cinematic capsule landing and return-to-orbit flow. It remains a
narrow prototype with no economy, combat, accounts, multiplayer, or dashboard.

Start with [PLAN.md](./PLAN.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and
[PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md). External art provenance is in
[ASSETS.md](./ASSETS.md).

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

Node.js 20.19 or newer supported release lines are required; see package.json
for the exact engine range.
