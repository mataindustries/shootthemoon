# Shoot the Moon — First Strike

Release-candidate visual implementation is integrated; final production
verification and physical Android acceptance are still pending.

First Strike completes Shoot the Moon's public prototype loop. Claim a site,
land the capsule, deploy the miner, build the extractor, discover and scan
Commander Vesper's Null Meridian foothold, then deliberately arm and launch one
lunar warhead. The 26.1-second strike cinematic crosses a deterministic safe
orbital arc, destroys the rival installation with a surface-bound lunar impact,
and leaves a permanent canonical crater that survives refresh.

The release-candidate presentation gives the two factions separate visual
languages: the player's capsule, miner, extractor, and launcher share
blackened industrial armor with restrained amber/red light, while Null
Meridian uses a dark asymmetric skeleton and controlled cyan-white surgical
machinery. The strike ends in a vacuum-appropriate ejecta event and a
depth-producing scar with an irregular rim, altered regolith, and embedded
wreckage, visible both close to the surface and from orbit.

The opening gate presents `SHOOT THE MOON / FIRST STRIKE` with `BEGIN INVASION`
or `CONTINUE`. Strike authority remains an explicit arm, cancel, and confirm
flow. After `FIRST STRIKE COMPLETE / THE MOON REMEMBERS`, the player can explore
the scar, return to orbit, or replay only the presentation without mutating the
completed save. Original synthesized Web Audio cues unlock only after a user
gesture and can be disabled; optional feature-detected vibration is limited to
ignition and impact.

The scope remains deliberately narrow: this is one authored single-player
prototype ending, with no networking, accounts, multiplayer infrastructure,
additional weapons, territory system, or larger economy. Camera and missile
paths remain separate, both are sampled for radial lunar clearance, and static
completed scenes return to demand rendering.

The before/after evidence protocol is documented in
[artifacts/release-candidate/README.md](./artifacts/release-candidate/README.md).
The untouched `d377cb5` MVP captures remain under `baseline/`; the 14 final
captures and uninterrupted arming-to-ending recording are reserved for
`final/` after the production verification pass.

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

To review the exact production build used by the browser suite, run:

    npm run build
    npm run preview -- --host 0.0.0.0

Node.js 20.19 or newer supported release lines are required; see package.json
for the exact engine range.
