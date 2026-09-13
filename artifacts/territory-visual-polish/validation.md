The subsequent [focused orbital repair](orbital-repair.md) restores full monument
silhouettes in ordinary orbit and preserves the reveal framing. Its validation
and screenshot supersede the orbital visibility results recorded below.

Initial visual pass validated on `feature/territory-visual-polish`, 2026-09-13.

The menu reuses the existing lunar maps for dark basalt relief, a controlled
terminator and a thin warm rim. The platform, instanced Octogonal fleet and four
monuments use beveled obsidian forms, restrained brass/gold surfaces and small
amber/cyan systems. Each model uses at most four material batches. The smaller
basin Crown has a readable perimeter seated on the rendered terrain.

The original monument camera path is unchanged. Focused reveals retain the
full monument; ordinary orbit shows its claim signal with detailed bases and
monument meshes hidden. Domain, simulation, resources, saves, waves, replay,
camera controllers and faction dialogue have no changes.

Passed: 102 focused unit tests across 10 files; all five production browser
cases in `territory-monuments.spec.ts`, `orbital-siege.spec.ts` and
`siege-camera-collision.spec.ts`; lint; typecheck; production build; and
`git diff --check`. Older browser navigation now dismisses the existing
automatic monument offer and uses the orbital beacon to revisit the outpost.

Final [screenshots](../screenshots/territory-visual-polish/) include 35 visual
captures plus the five workflows' evidence. Portrait 390×844, landscape
844×390, all four monuments, both Crown anchors, three approach lanes, platform
damage, orbital claims and low-tier reduced motion were inspected. The capture
script checks demand-idle entry rendering, unchanged reveal replay facts,
hidden orbital base details, layout overflow and WebGL errors; all passed.

| Measured counter | Peak | Existing ceiling |
| --- | ---: | ---: |
| Draw calls | 71 | 80 |
| Landed triangles | 64,280 | 200,000 |
| Orbital/reveal triangles | 35,369 | 120,000 |
| Shader programs | 19 | 24 |
| JavaScript gzip (Node zlib) | 385.18 KiB | 400 KiB |

[Renderer metrics and asset hashes](metrics.json) record the exact final bundle.
Vite reports 397.64 kB gzip and retains its existing raw chunk-size advisory.
No new downloaded art, texture assets, postprocessing or animation loop was
added. These are browser measurements; physical Android FPS and thermals were
not measured. Nothing was committed, pushed or deployed.
