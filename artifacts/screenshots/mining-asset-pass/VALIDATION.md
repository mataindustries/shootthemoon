# Mining asset pass

Uncommitted changes on `f372838`; no commit or push. Repository/style/architecture/performance guidance, previous assets and screenshots were inspected first.

Faceted ore, distinct wheeled miners, articulated tools, cargo motion and an engineered repair cradle share opaque ceramic/carbon/brass materials with restrained amber/cyan accents. Assemblies are merged/instanced; weave is procedural. The gantry's render-only socket moved into the rear service area, with terrain grounding and route-clearance coverage. No gameplay, camera, save-schema, resource, allocation, upgrade or wave implementation changed. The existing laser/contact implementation is byte-for-byte unchanged.

## Validation

- `npm run lint`, `npm run typecheck`, `npm test`: **pass; 44 files / 313 unit tests**.
- Ordinary production build: **pass**, matching the browser-tested build byte-for-byte. JavaScript gzip-9: **398,593 bytes / 389.25 KiB**, below 400 KiB; +3,070 bytes versus baseline. No new textures or post-processing. [Build hashes](after/production-build.json).
- **23 selected browser cases passed** across the runs: mining/repair/orbit (3), migrated Rival restore/reset/budget (1), operations/state (4), and ordinary-production construction, test-hook exclusion, counterstrike, landing, monument handoffs and defense waves (15). The interrupted production run finished with [4 resumed passes](validation/protected-production-resumed-e2e.log).
- The initial Solar/silo test initialization timeout was resolved by closing its finished Solar WebGL page before opening the independent silo page; the case then passed in production. [Logs](validation/).

| Captured scene | Calls | Triangles | Textures | Programs |
| --- | ---: | ---: | ---: | ---: |
| Normal outpost / migrated Rival return | 57 | 59,792 | 6 | 21 |
| Working laser, portrait | 32 | 56,956 | 6 | 21 |
| Repair cradle, portrait | 69 | 61,914 | 6 | 23 |
| Orbit | 9 | 32,016 | 5 | 11 |
| Low-tier outpost | 42 | 40,628 | 6 | 15 |

The stricter 60-call / 60,000-triangle migrated-scene gate passed; idle rendered 4 frames in 1,400 ms. General 80-call / 200,000-triangle / 24-program limits pass, including the desktop/small-phone repair peak of 71 calls and 62,022 triangles.

## Screenshots and remaining limits

[Before](before/) and [after](after/) include outpost, mining/contact, cargo return, repair, refresh and orbit at 390 × 844, 320 × 568 and 1440 × 900. `-assets.png` supplements temporarily hide HUD elements using test CSS and retain the game camera; ordinary PNGs retain controls. Compare [mining before](before/04-mining-desktop-assets.png) / [after](after/04-mining-desktop-assets.png), and [gantry before](before/06-gantry-portrait-assets.png) / [after](after/06-gantry-portrait-assets.png).

The legacy suite is **not fully green**. Untouched HEAD reproduces the obsolete `VIEW OUTPOST OPERATIONS` navigation and existing HUD overlap failures; [baseline evidence](validation/baseline-polish-e2e.log). The current long Solar/mining workflow also times out in its contact-framing poll, including an [isolated retry](validation/polish-isolated-e2e.log); that timeout is not classified as the baseline HUD failure. A [direct Solar/Gamma probe](validation/gamma-framing.json) recorded five identical consecutive camera/contact samples and twelve active-laser samples; [full-HUD capture](after/11-gamma-full-hud.png). The longer test remains unresolved.

Existing HUD coverage limits complete portrait visibility acceptance. Evidence uses headless Chromium 151 / SwiftShader with touch emulation; physical Android FPS, thermals and drivers were not validated.
