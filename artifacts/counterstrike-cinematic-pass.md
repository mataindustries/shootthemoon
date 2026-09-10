# Counterstrike cinematic presentation pass

READY FOR DEVICE TEST — 2026-09-10. No commit or push.

The interceptor now starts in a close chase shot with a small structural edge,
then follows a deterministic camera rail with parallax and restrained roll.
Both vehicles stay framed through direct contact. The camera holds the collision
for 1,000 ms before returning to a safe lunar/outpost orbit.

The impact uses a 180 ms white core, a faceted amber shell, a thin shock ring,
coasting instanced fragments, and a 420 ms lunar lighting pulse using the existing
light. Seven static fragments remain afterward. No smoke textures, postprocessing,
additional lights, or simulation changes were introduced.

Fin outlines are combined into two draws instead of six. Flight GPU resources
are released before the terminal damage shot to preserve the existing budget.

## Validation

- Both focused cinematic E2E attempts passed: vehicle visibility, exact one-second
  hold, actual direct-hit state transition, safe aftermath, and portrait budgets.
- Failure/replay/refresh E2E passed on the optimized build, including retaining
  the accepted outcome until explicit replacement and reset behavior.
- Existing success/refresh/idle, visibility pause, and restored-outcome checks passed.
- 82 relevant unit tests passed; lint and typecheck passed.
- Production build passed with `VITE_E2E_HARNESS=0`; the final production E2E
  confirmed browser simulation controls remain disabled.
- Simulation, domain, persistence, campaign, timing, and damage source files are unchanged.
- Two stale E2E assumptions were corrected: save schema now uses the existing
  exported version; the failure fixture fixes the economic clock so entry-time
  mining does not invalidate strict presentation/save comparisons.

| Captured portrait peak | Cinematic | Failure path | Existing ceiling |
| --- | ---: | ---: | ---: |
| Draw calls | 44 | 34 | 45 |
| Triangles | 33,167 | 58,994 | 120,000 |
| Textures | 5 | 6 | 6 |
| Programs | 20 | 24 | 24 |

Measured in Chromium/WebGL2 at 390 × 844, DPR 1, medium quality.
Physical-device frame times, thermals, and subjective pacing remain for device testing.

## Captures

| Attempt | Chase | Direct contact | Amber shell and debris |
| --- | --- | --- | --- |
| 1 | [Launch](screenshots/counterstrike/cinematic-1-0.png) | [Contact](screenshots/counterstrike/cinematic-1-0.99.png) | [Impact](screenshots/counterstrike/cinematic-impact-1-0.02.png) |
| 2 | [Launch](screenshots/counterstrike/cinematic-2-0.png) | [Contact](screenshots/counterstrike/cinematic-2-0.99.png) | [Impact](screenshots/counterstrike/cinematic-impact-2-0.02.png) |

## Production artifact

- JavaScript: `index-D6rdVaIs.js`
- SHA-256: `279d10768faf017254a6d00a50015f28b55190911dc5ed911cf40cb8397d9795`
- Gzip level 9: 376,364 bytes (below the 400 KiB ceiling).
- Vite retains its existing non-blocking large-chunk warning.
