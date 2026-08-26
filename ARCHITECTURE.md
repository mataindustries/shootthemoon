# Moon Core architecture

Status: implemented First Outpost contract, 2026-08-26. Canonical coordinate,
simulation, persistence, render, input, and camera boundaries are active;
future asset-pipeline and multiplayer sections remain design boundaries rather
than implemented systems.

## Architectural goals

Moon Core must:

- remain genuinely three-dimensional from orbit to the lunar surface;
- preserve stable, serializable lunar locations independent of render scale;
- retain precision near the surface without placing kilometre-scale coordinates
  directly in GPU transforms;
- separate simulation facts from input, camera, React, and Three.js objects;
- load and release mobile-sized assets predictably;
- leave a narrow command/snapshot seam for possible server-authoritative
  multiplayer without implementing networking now.

The architecture favors one coordinate authority, one Canvas, one active
camera, pure coordinate math, and explicit render projections. A renderer
position is never the source of truth for a game position.

## Coordinate model

### Units and datum

Canonical domain quantities use SI units:

- angles are radians;
- positions, heights, distances, and radii are metres;
- durations are seconds in simulation code and milliseconds only at browser
  adapter boundaries.

The prototype datum is a spherical lunar reference surface with radius
1,737,400 m. This is a mean-radius planning datum, not a promise of terrain
accuracy. The value and any elevation zero must be carried by a LunarDatum
record rather than scattered constants. If a selected digital terrain model
uses a different radius, longitude convention, or elevation datum, ingestion
must convert it once into this canonical system.

A saved surface location has:

- latitudeRad: planetocentric latitude in the closed interval −π/2 to +π/2,
  positive north;
- longitudeRad: east-positive longitude normalized to the half-open interval
  [−π, +π);
- heightM: signed height relative to the selected datum.

Exact poles canonicalize longitude to zero for stable equality and
serialization. User-facing degrees are formatting only. Domain APIs reject
non-finite values and out-of-range latitude rather than silently clamping.

JavaScript numbers provide double-precision storage for canonical math. Domain
records use plain readonly data and must not contain THREE.Vector3, Matrix4,
Quaternion, Object3D, R3F events, typed GPU buffers, or normalized scene units.

### Moon-centred, Moon-fixed Cartesian frame

Canonical Cartesian positions use a right-handed Moon-centred, Moon-fixed
frame, abbreviated MCMF:

- the origin is the datum centre;
- +X passes through latitude 0, longitude 0;
- +Y passes through the north pole, matching Three.js default up;
- +Z passes through latitude 0, longitude 90° west.

The negative east-longitude Z mapping is intentional: it keeps east-positive
geographic longitude while making the X/Y/Z axes right-handed and Y-up.

For latitude φ, east-positive longitude λ, and radius
r = datumRadiusM + heightM:

    x = r cos(φ) cos(λ)
    y = r sin(φ)
    z = −r cos(φ) sin(λ)

The inverse is:

    r = hypot(x, y, z)
    latitude = asin(y / r)
    longitude = atan2(−z, x)
    height = r − datumRadiusM

The zero vector has no geographic inverse and is an error. Functions normalize
longitude and handle the pole convention explicitly.

This MCMF frame is suitable for stable locations and a future shared world, but
it is not an ephemeris. Real lunar rotation, orbital dynamics, Earth/Sun
coordinates, and time-varying astronomical reference frames are out of scope.

### Local tangent render frame

Once a surface anchor is known, nearby content is projected into a local
right-handed, Y-up tangent frame. At anchor latitude φ and longitude λ:

    up    U = ( cosφ cosλ,  sinφ, −cosφ sinλ )
    east  E = (−sinλ,       0,   −cosλ       )
    north N = (−sinφ cosλ,  cosφ,  sinφ sinλ )
    south S = −N

The local axes are:

- +X east;
- +Y up;
- +Z south, so looking north follows the conventional Three.js camera
  forward direction of −Z.

For a canonical MCMF point P, anchor origin O, and scale s measured in
metres-per-render-unit:

    local(P) = (
      dot(P − O, E),
      dot(P − O, U),
      dot(P − O, S)
    ) / s

The inverse applies the same basis and scale. Tests must prove the basis is
orthonormal and E × U = S.

Canonical operations remain double precision. Only nearby, scaled local values
enter Three.js object transforms and ultimately float GPU matrices/buffers. This
prevents surface jitter caused by combining metre-sized objects with positions
roughly 1.7 million metres from the Moon centre.

The initial surface scene uses one anchor at the selected landing location. A
future rebase may move the anchor when the camera travels several kilometres,
but the threshold must be derived from a measured screen-space precision error;
it is not needed for one stationary capsule and one nearby robot. A rebase
changes render projections only and never changes canonical entity locations.

### Orbital and approach render regimes

The render coordinator owns a RenderFrame descriptor containing an MCMF origin,
orthonormal basis, and metres-per-render-unit.

- Orbital: origin at the Moon centre, MCMF-aligned basis, and the reference
  lunar radius mapped to a small number of render units.
- Approach: origin at the selected anchor, tangent basis, and a scale chosen
  from camera altitude so the camera, target, and visible representation remain
  numerically compact.
- Surface: the same tangent anchor with 1 metre per render unit unless
  measurement justifies another fixed scale.

The camera journey is sampled in canonical MCMF coordinates. On a regime
change, both the camera pose and visible objects are reprojected from the same
canonical sample into the new RenderFrame. Nothing is integrated from the old
render position, which prevents accumulated drift.

The orbital sphere and local surface patch are separate level-of-detail
representations of the same datum. During the handoff they may overlap for a
short, measured interval, but only one owns selection at a time. The acceptance
test is screen-space continuity, not an assumed altitude threshold.

Each regime supplies appropriately tight PerspectiveCamera near and far planes.
A single near/far pair spanning orbit down to centimetres is forbidden because
depth-buffer precision is spread across that range. Logarithmic or reversed
depth buffers are possible later experiments, not the baseline.

## Precise surface selection

R3F pointer events and Three.js Raycaster can identify an interactive render
object, but the returned world point is only an ephemeral render-space result.
Selection follows this pipeline:

1. The input adapter classifies pointer activity as tap, drag, pinch, cancel, or
   miss. Only a tap may request selection.
2. The active camera produces a normalized render ray. Selection layers exclude
   the capsule, robot, marker, and decorative geometry.
3. The render coordinator converts the ray origin and direction to canonical
   MCMF coordinates.
4. The coordinate kernel solves a double-precision ray/reference-sphere
   intersection and chooses the nearest valid forward hit.
5. The hit converts to canonical latitude, longitude, and height.
6. The domain stores that location plus datum/version metadata. A 3D marker is a
   derived projection of the saved location.

This makes selection invariant under Moon mesh subdivision, texture UV layout,
DPR, and render-frame changes. It also avoids saving a triangle index that
would become invalid when LOD changes.

If terrain is introduced, step 4 becomes a two-stage query: mean-sphere
intersection for a bound, then refinement against the canonical height field or
terrain acceleration structure. The result must state whether it is
mean-sphere or terrain-refined and name the datum version. A visually displaced
shader surface cannot claim terrain-accurate selection unless the CPU query uses
the same height source and transform.

## Camera and controls

There is one PerspectiveCamera and one camera controller. Input never mutates
domain objects directly.

Controls emit intents such as orbitDelta, zoomDelta, selectAt, cancelJourney,
and returnToOrbit. A camera state machine consumes those intents:

    orbital → targeting → approach → surface
        ↑          |          |          |
        └──────────┴── return/cancel ────┘

The camera model owns canonical position, orientation quaternion, focus
location, phase, elapsed phase time, and transition policy. It avoids
latitude/longitude Euler interpolation, which is singular at poles and
discontinuous at the antimeridian. Tests inject a deterministic clock.

During direct manipulation, the render loop is invalidated for responsive
motion. Camera travel requests continuous frames only while active. Static orbit
and surface views return to R3F demand rendering. Reduced-motion support may
shorten or replace travel animation without changing the destination.

Bounded surface actions may temporarily derive a contextual focus pose from the
same local tangent terrain and robot/extractor snapshot. CameraRig saves the
player's surface pose, tracks deployment, travel, mining, cargo return, and
construction without changing domain state, then restores that pose with
elapsed-time damping before re-enabling controls. Focus state and camera pose
remain transient and are never serialized.

SceneRoot owns one shared demand-animation invalidation hook. It runs only for
transient robot states or extractor construction and cancels its animation frame
when that condition ends. Scanner and active-extractor motion are sampled by a
separate low-frequency invalidation timer, so an idle landed scene does not
retain a 60 fps request loop.

## Scene structure

One Canvas owns one renderer, one scene, one event system, and one active
camera. The implemented component topology is:

~~~text
App
├─ Canvas
│  └─ SceneRoot
│     ├─ CinematicClockProvider
│     ├─ CameraRig
│     ├─ LightingRig
│     ├─ Starfield
│     ├─ Moon
│     ├─ LandingMarker
│     ├─ OutpostSignal
│     ├─ SurfacePatch
│     ├─ SurfaceDressing
│     ├─ InvasionCapsule
│     ├─ MineralDeposits
│     ├─ MinerRobot
│     ├─ Extractor
│     ├─ ImpactEffects
│     └─ SceneMetrics
└─ CinematicHud
~~~

Rules:

- SceneRoot composes 3D systems; it does not hold authoritative game state.
- Focused render-coordinate utilities project canonical snapshots.
- Moon and SurfacePatch are LOD views of one Moon, not two game worlds.
- CameraRig is the only writer of the Three.js camera transform.
- Moon's input adapter classifies its pointer gestures and performs the
  ephemeral ray query; LandingMarker derives only from the saved site.
- LightingRig owns the small fixed light budget.
- The capsule, miner, deposits, and extractor consume the same projected site
  transform and shared deterministic terrain-height profile.
- Outpost entities retain stable local tangent coordinates in metres; scene
  objects are derived views and never persistence records.
- Debug counters may exist in development, but no elaborate HUD is part of the
  first playable.
- No nested Canvas, 2D gameplay canvas, CSS3DRenderer, DOM sprite, or
  per-entity React root is permitted.

The HUD is presentation-only: it emits reducer actions and reads canonical
coordinates, but it is never used as a gameplay object or a source of spatial
truth.

## State separation

| State class | Examples | Owner and lifetime | Replicated later? |
| --- | --- | --- | --- |
| Domain configuration | Lunar datum/version, entity definitions | Pure immutable data | Shared |
| Simulation state | Canonical entity poses, landing target, phase facts | Pure reducer or simulation service | Yes, as snapshots |
| Input intents | Orbit delta, tap request, journey cancel | Browser adapter; transient | Commands only when semantically relevant |
| Camera/view state | Camera pose, active RenderFrame, hover, gesture state | Local client | No |
| Render resources | Scene objects, geometries, materials, textures, loaders | R3F/Three.js lifecycle | No |
| Asset state | Manifest, load status, cache references, errors | Asset service | Manifest/version only |
| Presentation state | Loading/fallback/accessibility text | React | No |

Additional constraints:

- Simulation code imports neither React nor Three.js.
- Render code receives readonly snapshots and may interpolate them, but cannot
  write results back as simulation truth.
- High-frequency frame values live in refs or purpose-built stores and do not
  trigger a React tree render every animation frame.
- React state is reserved for coarse transitions that affect composition.
- No external state library is needed; one pure reducer owns the five coarse
  experience phases and another pure reducer owns the bounded outpost snapshot.
- Resource setup must be idempotent and cleanup complete under React
  StrictMode's development setup/cleanup cycle.

## Asset loading

### Runtime formats and manifest

The current external runtime assets are two immutable NASA lunar JPEGs recorded
with source, license, dimensions, byte size, and hash in ASSETS.md. They load
once through R3F's shared TextureLoader cache inside Suspense. The color map is
sRGB; the height/bump map remains linear. A deterministic R8 DataTexture adds
local close-range detail and is disposed when its surface patch unmounts.

Future runtime mesh assets use GLB/glTF 2.0. Geometry compression should use
Meshopt by default, with Draco considered only after decode-time and size
measurement.
Color, normal, and material textures use KTX2/Basis universal compression when
supported, with a documented fallback only if required by the target browsers.

Every future imported asset is declared in a versioned manifest with:

- logical asset ID and semantic role;
- content URL and content hash/version;
- source, author, and license;
- authoring units, up axis, forward axis, pivot, and contact point;
- compressed transfer bytes;
- decoded triangle/vertex/material counts;
- texture dimensions, formats, mip status, and estimated GPU bytes;
- required loader extensions and declared LODs.

Future imported model authoring roots are normalized during the asset build, not
with unexplained runtime scale/rotation fixes. A model's local origin must be a
documented placement point.

### Loader boundary

When external models arrive, an AssetRepository wraps Three.js LoadingManager
and GLTFLoader configuration. It owns decoder setup, URL resolution, caching,
progress, errors, retry policy, and reference counts. Components request
logical IDs rather than constructing loaders or embedding URLs.

Loading is phase-based:

- boot loads only code and the smallest orbital Moon representation;
- intent to select may preload the approach/surface representation;
- confirmed descent creates the current code-authored capsule, miner, deposits,
  extractor, and procedural surface without a network request;
- higher detail never blocks basic interaction when a valid lower LOD exists.

React Suspense may coordinate scene readiness, but a rejected load must reach an
error boundary and a retry path rather than leave a permanent blank canvas.
Preloading must not mount invisible duplicate scenes.

### Lifetime and disposal

Removing an Object3D does not free its GPU data. The repository tracks ownership
and explicitly disposes unreferenced geometries, materials, textures, render
targets, ImageBitmaps, controls, and loaders with disposal hooks. Shared
resources are reference-counted so one component cannot dispose another's
texture. Development tests compare renderer.info memory counts across repeated
load/unload cycles, allowing for documented renderer-internal caches.

The two persistent global textures intentionally remain cached for the life of
the one-Moon scene. Phase-scoped geometry, procedural textures, shader
materials, controls, and listeners provide explicit cleanup hooks.

## First Outpost simulation and persistence

The First Outpost domain snapshot is plain serializable data. It contains one
canonical landing site, one outpost ID, one robot ID and explicit robot state,
three deposit IDs and local positions, Lunar Ore, and at most one extractor.
The renderer never stores an Object3D, material, geometry, raycast result, or
camera pose in that snapshot.

Robot transitions are deterministic and timestamp-based:

~~~text
stored → deploying → idle → traveling → mining → returning → unloading → idle
~~~

Travel uses a fixed quadratic route per deposit rather than physics or general
pathfinding. The current pose and heading are sampled from the route and state
timestamp. Rendering then applies the site's shared procedural height sampler
to keep the wheels approximately grounded. Deposit yield changes at the mining
boundary; Lunar Ore changes only at unloading, so cargo remains visually and
semantically legible.

The extractor is allowed only when the miner is idle, the selected stable
deposit remains valid, no extractor exists, and the ore threshold is met. Its
construction and production timestamps are deterministic. Production is ticked
at a controlled interval only while the surface scene is open. Restore and
revisit reset the production baseline, deliberately leaving offline progress
for a future economy design.

The browser persistence adapter owns one schema-versioned localStorage record.
It serializes canonical latitude, longitude, altitude, and orientation plus the
plain outpost snapshot. Serialization and restoration normalize cinematics and
transient robot states to `stored` or `idle`; returning cargo is safely credited
before an idle restore. A constructing extractor restores active. Saves happen
on coarse state changes and controlled extractor production intervals, never
per frame. Reset is a separate confirmed operation; return to orbit never
deletes the record.

## Future multiplayer boundary

Multiplayer is intentionally not started. The present design reserves only this
seam:

~~~text
Browser input
    │
    ▼
semantic Command ──► SimulationPort ──► canonical Snapshot
                          ▲                    │
                          │                    ▼
                  future NetworkPort      View projection
                                               │
                                               ▼
                                      React Three Fiber scene
~~~

For the prototype, a local simulation implements SimulationPort. A future
server-authoritative implementation may consume the same semantic commands and
produce versioned snapshots. This boundary has these rules:

- commands express intent, never pixels or Three.js vectors;
- snapshots contain stable IDs, canonical coordinates, orientation, tick/time,
  and schema version;
- the network adapter alone quantizes, serializes, authenticates, retries, and
  orders messages;
- camera pose, gesture state, hover, render LOD, DPR, and interpolation buffers
  are local-only;
- a tentative local surface hover is local; a committed landing request could
  become a command;
- render interpolation never overwrites the latest authoritative snapshot;
- fixed simulation ticks may be introduced when simulation exists, but exact
  cross-device floating-point determinism is not assumed;
- no socket library, lobby, account, remote persistence, prediction, rollback,
  or multiplayer UI is added during Moon Core.

This seam is deliberately small. It prevents renderer coupling without forcing
the single-player prototype to implement a speculative distributed system.

## Failure boundaries

- WebGL 2 unavailable: render the accessible non-gameplay fallback.
- WebGL context lost: pause input and travel; rebuild disposable render
  resources on restoration or offer a reload if restoration fails.
- Asset failure: preserve the last valid scene, report the logical asset ID,
  and allow bounded retry.
- Invalid coordinate: reject at the domain boundary; never emit NaN into the
  scene graph.
- Resize/orientation change: recompute camera aspect and pointer mapping without
  changing canonical camera state.
- Background tab or long frame: clamp animation delta or sample by absolute
  journey time; never integrate an unbounded delta.
- Quality regression: reduce render scale/LOD, not coordinate precision or
  selection correctness.

## Implemented source boundaries

Current directories follow these dependency boundaries:

~~~text
src/
  app/             React composition and error boundaries
  domain/          coordinates, datum, entities, commands, snapshots
  simulation/      local SimulationPort implementation
  persistence/     versioned browser save adapter and safe normalization
  camera/          camera state machine and canonical journey
  render/          coordinate projection and quality adaptation
  scene/           R3F representations, light, effects, and input adapter
  instrumentation/ renderer counters and performance measurements
~~~

Imports point inward toward domain contracts. Domain has no browser, React, R3F,
or Three.js dependencies. Assets and rendering may depend on Three.js. App wires
adapters together.

## Decisions recorded

1. Use WebGL 2 through R3F Canvas for the prototype. WebGPU is not a dual
   implementation target.
2. Use a right-handed, Y-up MCMF domain frame with east-positive longitude.
3. Store canonical locations in radians/metres and derive all render positions.
4. Use normalized centre-origin rendering in orbit and tangent/floating-origin
   rendering near the surface.
5. Use analytic canonical picking for the reference sphere rather than treating
   a render-mesh hit as authoritative.
6. Use one Canvas and one camera across all phases.
7. Keep domain, camera/view, render resources, and assets as separate state
   classes.
8. Record every external asset in ASSETS.md now; require GLB plus mobile
   texture/geometry compression and a manifest-owned loader when imported
   models enter scope.
9. Reserve command/snapshot ports for future multiplayer but implement only a
   local simulation during Moon Core.
10. Prefer demand rendering while static. A shared requestAnimationFrame
    invalidation loop exists only for transient robot motion and extractor
    construction; deployed scanner/extractor motion uses a low-frequency
    invalidation cadence rather than a permanent 60 fps loop.
11. Keep the First Outpost economy to one prototype resource, three deposits,
    one miner, and one extractor.
12. Persist canonical and local domain values only; normalize every transient
    state before it can become a restored session.

## Remaining risks after this implementation

| Risk | Current decision | Remaining work |
| --- | --- | --- |
| Selection versus visual relief | Canonical selection is explicitly the 1,737,400-m mean sphere; NASA bump and the procedural patch are render-only | Add a versioned CPU height query before making terrain-accurate claims |
| Frame handoff and camera comfort | A deterministic curved journey, local tangent overlay, cancel path, return path, and reduced-motion duration exist | Validate comfort, seams, orientation changes, and frame pacing on a physical phone |
| Touch gesture variation | Automated CDP touch covers drag, pinch, tap, cooldown, limb, poles, and seam cases | Verify real Android pointer cancellation, browser bars, edge gestures, and palm behavior |
| Physical Android performance | Drawing-buffer, draw-call, triangle, texture, and shader counters pass in headless Chromium | Run the full Pixel 6a frame-time, memory, thermal, and ten-minute soak protocol |
| Surface detail fidelity | A deterministic curved procedural overlay and shared approximate height sampler support the bounded outpost routes | Wider traversal requires tiled, canonical terrain data and rebasing; neither is implemented |
| JavaScript bundle headroom | The Surface Presence production JavaScript is 321.27 kB gzip against the 325 KiB target | Introduce deliberate scene/code splitting before another substantial feature |
| Active-surface draw calls | Shared/instanced geometry and selective shadows reduce the settled active extractor scene from 78 to 50 calls | Preserve the remaining 10-call target headroom before adding another hero structure |
| Sustained landed animation | Scanner/extractor idle is low-frequency; a shared demand-animation loop is active only for transient robot/construction states | Confirm frame pacing and thermal behavior on the physical reference Android device |
| Runtime asset pipeline | NASA textures are fully recorded; the capsule is code-authored | Build the manifest/GLB/KTX2 repository only when an imported model is approved |
| Context restoration | The WebGL 2 fallback exists, but loss/restoration is not exercised | Add a controlled context-loss browser test and verify resource reconstruction |
| Future multiplayer semantics | Domain data remains plain canonical snapshots and no network code exists | Define authority, protocol, tick, and reconciliation only in a future phase |

## Documentation basis

- [R3F Canvas defaults and configuration](https://r3f.docs.pmnd.rs/api/canvas)
- [R3F pointer events](https://r3f.docs.pmnd.rs/api/events)
- [R3F performance scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Three.js Object3D Y-up convention](https://threejs.org/docs/pages/Object3D.html)
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Three.js PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)
- [Three.js camera depth precision guidance](https://threejs.org/manual/en/cameras.html)
- [Three.js recommended glTF workflow](https://threejs.org/manual/en/loading-3d-models.html)
- [Three.js GLTFLoader and compression hooks](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js resource disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/)
