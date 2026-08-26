# Shoot the Moon — First Outpost

First Outpost is the next vertical slice built on Shoot the Moon's true-3D Moon
Core. The playable loop covers lunar-site selection, capsule landing, deployment
of one mining robot, three Lunar Ore deposits, deterministic mining and cargo
return, construction of one extractor, and an orbital revisit signal. A
versioned local save preserves the claimed canonical coordinate and outpost
domain state across refreshes. The scope remains deliberately narrow: there is
no networking, combat, account system, multiplayer, management dashboard, or
economy beyond this one prototype resource loop.

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

To review the exact production build used by the browser suite:

    npm run build
    npm run preview -- --host 0.0.0.0

Node.js 20.19 or newer supported release lines are required; see package.json
for the exact engine range.
