# Shoot the Moon — First Strike

First Strike completes Shoot the Moon's public prototype loop. Claim a site,
land the capsule, deploy the miner, build the extractor, discover and scan
Commander Vesper's Null Meridian foothold, then deliberately arm and launch one
lunar warhead. The 26.1-second strike cinematic crosses a deterministic safe
orbital arc, destroys the rival installation with a surface-bound lunar impact,
and leaves a permanent canonical crater that survives refresh.

The scope remains deliberately narrow: this is one authored single-player
prototype ending, with no networking, accounts, multiplayer infrastructure,
additional weapons, territory system, or larger economy. Camera and missile
paths remain separate, both are sampled for radial lunar clearance, and static
completed scenes return to demand rendering.

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
