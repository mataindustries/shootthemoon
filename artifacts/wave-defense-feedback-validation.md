Wave defense feedback — validated 2026-09-13 on `feature/wave-defense-feedback`.

The slice covers all three Territory Monuments allocation waves. Each choice opens a 3.6-second defense sequence with a tracking turret, a 64px FIRE DEFENSE button, a bright impact, gold/cyan fragments, debris smoke and bounded lateral camera shake. Reduced motion disables the shake. Tap within 2.6 seconds; early taps queue until the 0.5-second lock. Skipping or missing retains the original outcome. A hit prevents 4 hull damage.

The existing 6/7/8-second wave clocks, ore losses, robot allocations, energy, construction, four monument choices, repair rules, campaign unlocks and reveal replay remain intact. An optional validated shot-time record preserves attempts across reloads without changing the save schema; older saves retain baseline outcomes.

Validation passed:

- 101 focused unit/regression tests across defense resolution, camera/mesh clearance, monuments, Orbital Siege, base construction and save compatibility.
- 8 production Playwright tests: the new three-wave hit/miss/hit path, existing monument repair/reset workflow, Orbital Siege recovery/replay and five monument orbit/reveal variants.
- Lint, explicit typecheck, production build and `git diff --check`.
- Portrait checks at 390×844 and 320×568: 64px button, edge taps, unobscured targeting/impacts, stable camera, hull outcomes 99 → 92 → 87, reload protection and unchanged reveal replay.

Measured impact peak: 25 draw calls, 36,144 triangles, 21 geometries, 5 textures, 12 shader programs. Effects are precompiled before firing, stop drawing after 3.6 seconds, and release their owned resources after the final wave. JavaScript gzip level 9: 396,001 bytes (386.7 KiB), below the 400 KiB ceiling. Vite retains its nonblocking chunk-size warning. Measurements use headless Chromium at medium quality/DPR 1; physical Android frame pacing and thermal performance were not measured.

Screenshots and frame metrics: [wave-defense-feedback](screenshots/wave-defense-feedback/). Production JavaScript: `index-C3i-jLul.js`, SHA-256 `166888fd02d2c9b4f5953feeb03bd56611c66957f9b43de8f231d94640687049`.

No commit or push was made.
