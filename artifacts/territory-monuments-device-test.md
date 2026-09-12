# Territory Monuments

**READY FOR DEVICE TEST — 2026-09-12**

Verification passed: 116 relevant unit tests across 10 files, one focused
production E2E workflow, lint, TypeScript checking and the production build.
Final portrait screenshots were inspected for choice visibility, Octogonal
approaches, the unclipped Spire reveal and the orbital claim. The recorded
claim frame uses 24 draw calls, 21,027 triangles, 12 geometries and 7 programs.
The production JavaScript is approximately 396.33 kB gzip, below the existing
400 KiB hard transfer ceiling. No broad cinematic suites were run. Nothing was
committed or pushed.

One focused endgame slice, unlocked by an operational Orbital Siege platform or
the existing First Strike `COMPLETE` endpoint. The selector lists all four
choices before payment. The existing storage, solar production, three robots,
operating modes, damage multipliers and Command Phase interactions remain the
economic authority.

| Monument | Stored ore, paid once | Construction energy | Robot labor | Permanent benefit |
| --- | ---: | ---: | ---: | --- |
| Helios Spire | 80 | 72 kW·s | 36 robot-seconds | +25% solar generation |
| Crater Crown | 90 | 84 kW·s | 42 robot-seconds | +20% extraction in the selected territory |
| Bastion Obelisk | 100 | 96 kW·s | 48 robot-seconds | 25% less siege damage, 50% faster repair, halves production damage effects |
| Signal Array | 80 | 72 kW·s | 36 robot-seconds | Halves logistics losses, 50% faster rival scans and earlier siege approach tracks |

Each builder consumes 2 kW while doing paid construction work. Labor and its
energy cost stop at the selected monument's work quota. The three wave choices
reserve those same robots: defend uses one builder and two defenders (up to
6 additional kW); preserve production uses one builder and two miners;
accelerate uses all three builders. Base and mining energy remain part of the
existing operations calculation. Low power throttles work and weakens defense.

The Octogonals are an original surveying cooperative with ochre octagonal
ships, violet signals, Surveyor Ochre of the Eighth Desk, and three authored
transmissions. Plumb Line approaches from the east ridge, Right of Way from
the north limb, and Final Notice from the west scarp. Each allocation is saved;
the next attack waits indefinitely for the player's choice. There are no
additional waves after the third resolution.

A surviving hull activates the completed monument. Failure adds a 30%
production penalty and 15% solar loss; storage damage consumes actual ore.
Repair costs 20 ore, 30 robot-seconds and 60 kW·s (15 seconds with two fully
powered builders). Weaker solar sites can still repair at reduced speed.
Repair clears only the monument's penalties. Earlier Counterstrike and Orbital
Siege outcomes, damage and ore losses remain saved.

Save schema 9 retains the existing storage key and migrates versions 1–8.
Construction, command, wave and repair progress resume without offline attacks
or duplicate payment. The claim uses the existing canonical outpost site;
Crater Crown records an anchor to the existing First Strike scar when present,
or the authored landing impact basin otherwise. Reveal replay changes no
accepted campaign outcome. The existing confirmed reset removes the entire save.

Monuments use four shared primitive geometries and five reused materials, with
no new texture downloads or postprocessing. Detailed player and rival bases
are hidden above 0.18 Moon radii of altitude. The six-second reveal pulls back
from the monument to its claim signal and lunar context; reduced motion holds
the final view. Completed signals use a low-frequency demand-render heartbeat.
The prior strike and counterstrike presentations retain their camera authority
when replayed.

Focused verification covers all choices, quotas and modifiers, allocation,
finite waves, success and failure, low-power repair, save migration and resume,
earlier damage preservation, reset and replay, approach framing and orbital
base simplification. The single browser workflow is
`e2e/territory-monuments.spec.ts`, against the ordinary production build at
390×844. Screenshots are in `artifacts/screenshots/territory-monuments/`;
renderer counters are in `artifacts/territory-monuments-metrics.json`.

Physical-device review remains: portrait safe areas and touch targets, all four
monument silhouettes, readability on the dark side of the Moon, the three
approach lanes, reveal pacing and reduced motion, orientation changes, and
thermal/frame-time behavior on the reference Android device. Browser-emulated
screenshots and renderer counts do not establish physical-device performance.

No broad cinematic suites, commit, push or deployment are part of this pass.
