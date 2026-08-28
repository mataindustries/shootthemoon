# Shoot the Moon — Rival Signal

Rival Signal extends Shoot the Moon's true-3D First Outpost loop into a strict
1v1 contest. Activating the first extractor reveals Commander Vesper of Null
Meridian at a deterministic distant lunar site, then lets the player focus and
scan her lightweight strategic foothold. Both canonical sites, the authored
transmissions, rival stage, and one-time reveal state persist locally across
refreshes. The scope remains deliberately narrow: there is no networking,
combat, account system, multiplayer infrastructure, territory system, or
economy beyond the existing prototype resource loop.

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
