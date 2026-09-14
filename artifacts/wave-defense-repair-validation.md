Wave defense repair — 2026-09-14, `feature/wave-defense-feedback`.

The launch panel and confirmation now say “Launching the warhead begins the strike on Null Meridian.” Cancel and FIRE retain their existing behavior.

Orbital Platform construction reuses the monument defense card, tracking turret, laser, hit/miss timing and Octogonal destruction renderer for all three waves. Its 3.6-second windows precede the existing wave deadlines. Platform shots are transient presentation state: they do not dispatch a second resolver, change damage, spend resources or add save fields. The existing monument hit rule remains intact. Colored instanced debris keeps impacts within the draw budget. On short portrait screens, the resource readout hides during the window and returns between waves so it cannot cover incoming ships; sound/reset controls remain available.

Compared the bowed descent in `94a28a0` / `551daff` and the earlier `03-capsule-impact-mobile.png` / `04-landed-site-mobile.png` artifacts with the safer transition from `3cdf33a`. Restored the bowed path and earlier focus while retaining fixed endpoints, smooth projection and a safe orbital fallback. Touchdown effects align with capsule contact. The final 0.62 seconds hold the exact settled camera pose within the unchanged 6.2-second landing clock.

Validation:

- 98 focused unit tests passed across platform presentation, hit/miss resolution, camera transitions, both construction simulations, persistence and core state.
- Five focused production Playwright tests passed: both three-wave construction paths, platform at 320×568, final launch wording/cancel/fire, and descent → touchdown → hold → settled landing. Checks include edge taps, unobscured feedback, unchanged saves/outcomes, monument reveal replay and no browser errors.
- Two existing Playwright regressions passed: siege failure/reload/repair/replay and touchdown input lock/handoff/restored controls.
- Lint, typecheck, production build and `git diff --check` passed. Vite retains its nonblocking chunk-size warning.

Measured platform impact: 80 draw calls, 64,220 triangles, 20 programs and 6 textures. Monument impact: 22 draws, 35,664 triangles and 13 programs. JavaScript gzip level 9 is 396,808 bytes (387.5 KiB), below 400 KiB. Browser evidence uses production preview in headless Chromium; physical-device frame pacing was not measured.

[Screenshots and metrics](screenshots/wave-defense-feedback/) include platform targeting/impacts/debris, all three small-phone waves, launch confirmation, and landing descent/touchdown/hold/settled frames. Current JS: `index-DHTrgZ4x.js`, SHA-256 `034b99ea417d2a3b2376a13bc30eac8d8cdabe499dd706bc0a3937144e074bc0`.

No resource rules, allocations, campaign progression, persistence, saves, monument logic, moon ore or worker-bot assets were changed by this repair. No commit or push was made.
