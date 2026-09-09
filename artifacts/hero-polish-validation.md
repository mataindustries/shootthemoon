# Focused hero-art / presentation pass

Scope: presentation and render geometry only. Counterstrike simulation timing,
damage, persisted outcomes, resource capacity, and production code are unchanged.

- Counterstrike uses a route-derived shot for the actual interception endpoint,
  keeps an inert outpost beacon visible, and holds direct contact for 1,000 ms
  before a straight pullback. Both real fire attempts and sampled flight/contact
  frames are covered by focused browser tests.
- Construction modules use deterministic site-local sockets with clearance radii.
  Storage Silo is at (-5 m, 13.5 m), with a -0.1 m foundation offset and a structural
  coupler. The silo view separates its roof from deposit targets. Short portrait
  screens retain access to all operations through a scrolling panel.
- Lander and silo share a filtered, procedural diamond-weave / ceramic shader.
  Silo bands and vents are instanced. No runtime texture assets were added.
- Mining has a terrain-attached beam, contact core, restrained heat halo, and
  twelve particles. The terrain/beam solution is cached per mining job; effects
  disappear outside mining and add no independent animation timer. The mining
  camera aims below the contact to keep the beam above the operations HUD.
- Scars have stronger broken rims and readable rubble, lit by directional fill
  rather than a circular point-light pool. Counterstrike bowl vertices follow
  the rendered terrain instead of disappearing under its surface.

Validation:

- Lint and TypeScript checks passed.
- 225 unit tests across 32 files passed, including route framing/occlusion,
  construction and miner-path clearance, portrait touch separation, laser terrain
  contact, crater surface attachment, and the existing simulation/save tests.
- Focused Storage Silo construction + refresh E2E passed at 390 × 844 and
  320 × 568. All three real deposit taps remain reachable; capacity remains 400.
  Scene counters satisfy ≤80 draws, ≤6 textures, ≤24 programs, and ≤120k triangles.
- Focused Counterstrike interception E2E passed with real fire taps on both
  attempts, actual vehicle projections, contact hold, and pullback checks.
- Focused scar presentation E2E passed with no console/page errors.
- Focused mining E2E passed through Solar Wing construction, refresh, and two
  deposits. It checks visible beam/contact projections, HUD clearance, warm
  contact pixels above the translucent terrain, and effect removal after mining.
- Final ordinary production build passed without the E2E harness flag. Vite
  reports the bundle-size advisory (1,389.08 kB JS; 378.54 kB gzip).

Browser tests use a production build with the explicit E2E harness flag. The
final device build is produced without that flag. No broad cinematic suites,
commits, or pushes were performed. Browser rendering counters do not replace
physical device acceptance.

Evidence: `screenshots/hero-polish/` and
`screenshots/outpost-polish/laser-extraction.png`.

Status: **READY FOR DEVICE TEST**.
