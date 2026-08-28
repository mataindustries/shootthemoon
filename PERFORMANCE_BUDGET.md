# Moon Core Android performance budget

Status: Rival Signal measured in production, 2026-08-28. Physical Pixel 6a
frame-time, memory, touch, and thermal acceptance remains open.

## Target and measurement conditions

The physical reference device is a Google Pixel 6a: 6 GB RAM, 1080 × 2400
display, 60 Hz, using the current stable Chrome for Android and WebGL 2. This is
an intentionally older mid-range reference rather than a current flagship.

If a Pixel 6a is unavailable, the substitute must be documented, have no more
than 6 GB RAM, and have demonstrably comparable or lower sustained graphics
performance. An emulator, desktop device toolbar, or remote device farm alone
does not replace the physical run.

Record with every result:

- commit and production-build asset hashes;
- phone model, Android version, Chrome version, and WebGL renderer string;
- viewport CSS size, drawing-buffer size, DPR/quality tier, and orientation;
- battery-saver state, battery level, display refresh setting, and whether the
  phone is charging;
- test duration, ambient conditions if unusual, cold/warm cache, and any
  capability fallback.

Use an unplugged phone at 40–80% battery, battery saver off, display fixed at
60 Hz, approximately 50% brightness, and no screen recording. Allow the phone
to return near room temperature before a thermal run. Measure a production
preview, not the Vite development server. Disable DevTools screencasting while
profiling because it changes performance.

The renderer requires WebGL 2. The app must show its accessible fallback rather
than attempt a partial 2D implementation when WebGL 2 is unavailable.

## Current checkpoint measurements

These are automated production-build counters, not physical-device frame-time
evidence. They were captured at a 390 × 844 CSS-pixel viewport, DPR 1.0, a
390 × 844 drawing buffer, and the deterministic medium tier. The working tree
is intentionally uncommitted on top of clean First Outpost revision `a45d995`.

| Rival Signal frame | Draw calls | Triangles | Points | Geometries | Textures | Programs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal orbit | 3 | 31,520 | 640 | 3 | 3 | 3 |
| Orbital transition | 9 | 32,016 | 640 | 11 | 5 | 13 |
| Capsule approach (cinematic peak calls) | 23 | 32,360 | 640 | 22 | 5 | 20 |
| Impact | 19 | 32,000 | 724 | 25 | 5 | 23 |
| Both faction signatures | 21 | 32,300 | 640 | 25 | 5 | 24 |
| Rival focused | 14 | 31,816 | 640 | 19 | 5 | 24 |
| Rival scan | 18 | 32,040 | 640 | 23 | 5 | 24 |
| Player surface after integration | 50 | 58,160 | 694 | 35 | 6 | 24 |

The First Outpost optimization baseline is retained below for comparison.

| Representative frame | Calls before | Calls after | Triangles before | Triangles after | Geometries before | Geometries after | Textures before/after | Programs before/after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial orbit | 3 | 3 | 31,520 | 31,520 | 3 | 3 | 3 / 3 | 3 / 3 |
| Landed capsule, miner stored | 51 | 26 | 55,276 | 55,372 | 33 | 18 | 6 / 6 | 16 / 17 |
| Settled active First Outpost | 78 | 50 | 57,592 | 58,160 | 58 | 40 | 6 / 6 | 20 / 20 |

Points remain unchanged at 640 in orbit and 694 on the surface. The active
extractor focus frame is 32 calls, 56,504 triangles, 40 geometries, 6 textures,
and 20 programs, but the settled player view is used for the fair baseline
comparison. The active scene is 28 calls below the previous result and 10 calls
below the new 60-call target while adding 568 triangles.

The stored-miner scene returns fully to the demand-loop idle state. The final
suite measured 0 frames over 800 ms while stored, 7 scanner frames over 1,000 ms,
8 player-surface frames over 1,400 ms, and 14 contested-orbit frames over
1,400 ms. The last value is the single shared low-frequency heartbeat used to
sample both orbital beacons; completed cinematic, impact, and scan effects are
unmounted and `data-render-mode` returns to `demand`. A continuous shared
request loop exists only while robot, construction, or forced presentation
motion is transient. The automated suite recorded zero console/page errors, a
WebGL 2 context with no GL error or context loss, and a drawing-buffer area of
329,160 pixels.

Production transfer/build observations:

- JavaScript: 1,216,044 bytes minified; Vite reports 332.68 kB gzip and
  `gzip -9` produces 327,671 bytes (319.99 KiB); SHA-256
  `b361d942f53b7107d505d88e501b6c2391ba0e29e7b50cd43882c2943a595618`;
- CSS: 15,605 bytes minified; Vite reports 4.06 kB gzip and `gzip -9`
  produces 4,079 bytes;
- HTML: 500 bytes; Vite reports 0.31 kB gzip and `gzip -9` produces 328 bytes;
- checked-in lunar JPEGs: 569,494 bytes total;
- conservative decoded lunar texture estimate with mipmaps: about 13.34 MiB;
- procedural surface detail texture: 128 × 128 R8, about 21 KiB with mipmaps;
- one medium/high close-view shadow target: approximately 4 MiB color plus
  driver-dependent depth storage at 1,024 × 1,024.

The app-owned texture estimate remains roughly 18–22 MiB during the shadowed
close view, below the 48 MiB target. Code-authored outpost objects add no bitmap
textures. Medium-tier instancing presents 52 rocks/ridge stones, 20 capsule
structural/light parts, 9 mineral crystals, 6 scanner elements, 14 robot
structure/locomotion parts, and 10 extractor support/pump parts—111 instances
across shared batches. Geometry is far below the 20 MiB target based on the
measured 58,160-triangle frame, but neither GPU allocation nor JavaScript heap
was directly measured in headless Chromium.

Current compromises and mobile risks:

- the NASA JPEGs are small on the wire but upload as uncompressed GPU textures;
  a measured KTX2 conversion is deferred while residency remains below budget;
- the 1K directional shadow is the largest optional close-view GPU cost and is
  disabled on the low tier;
- quality is selected once from memory/core hints and the pixel cap; sustained
  frame-time hysteresis is not implemented yet;
- the local terrain is a deterministic bounded visual overlay with a shared
  approximate grounding sampler, not a canonical global height query or a
  traversable terrain-tile system;
- the active scene now clears the 60-call target at 50 calls, but future hero
  structures should preserve that 10-call target headroom;
- scanner/extractor motion requests at most the low-frequency pulse cadence
  while landed; its physical-device frame pacing and thermal cost remain
  unmeasured;
- headless SwiftShader-style execution proves counters and behavior, not Pixel
  6a FPS, thermals, driver allocation, or touch latency;
- the single JavaScript chunk passes transfer budget but has limited headroom
  and retains Vite's raw-size warning.

## Frame and interaction budget

| Scenario | Target | Hard acceptance ceiling/floor |
| --- | --- | --- |
| Static orbit or stored-miner landed view | Demand loop is idle | No continuous requestAnimationFrame activity after settling |
| Deployed scanner/extractor idle | Low-frequency absolute-time animation | No unbounded 60 fps loop while no robot action is active |
| One-finger Moon rotation | 60 fps; p95 frame ≤ 20 ms | Median ≥ 55 fps and p99 frame ≤ 33.3 ms after warm-up |
| Pinch/orbit zoom | 60 fps; p95 frame ≤ 20 ms | Median ≥ 50 fps and no frame over 100 ms |
| Orbital-to-surface travel | 60 fps where possible | Median ≥ 30 fps, p95 ≤ 33.3 ms, and no two consecutive frames over 50 ms |
| Selection response | Marker visible next presented frame | Tap-to-marker ≤ 100 ms at p95 |
| Ten-minute interactive soak | Stable 30–60 fps | Final two-minute median no worse than 20% below first two-minute median |
| Warm interaction long tasks | None over 50 ms | At most one over 50 ms per two-minute scripted run; none over 100 ms |

The warmed frame-time budget is approximately 6 ms main-thread work and 10 ms
GPU work at the high quality tier. These are diagnostic allocations, not an
excuse to pass one side when the presented-frame criteria fail.

Animation uses elapsed time or a deterministic journey sample, never frame
count. Page visibility pauses the journey wall clock so a backgrounded tab does
not jump to the endpoint on return. Per-frame loops do not call React setState,
allocate transient vectors in bulk, parse assets, compile new materials, or
rebuild geometry.

## Drawing-buffer budget

- Scaffold and high tier: DPR is clamped to 1.5.
- The implemented quality controller must additionally cap the drawing buffer
  at 1,000,000 pixels. DPR alone is not sufficient on large or unusual
  viewports.
- Medium tier: DPR 1.25.
- Low tier: DPR 1.0.
- Antialiasing is allowed only while the frame budget passes. It is tested
  explicitly rather than assumed free.
- No full-screen post-processing render targets exist in the first playable.

The cap is based on the Three.js guidance that smartphone HD-DPI displays can
multiply fragment work dramatically. A quality change may lower DPR or visual
LOD; it must never reduce canonical coordinate or picking precision.

## Geometry and polygon budget

All polygon counts below mean rendered triangles, observed through
renderer.info.render.triangles. Source-model polygon counts are also recorded,
but the presented-frame counter is the acceptance measure.

| Scene/content | Typical target | Hard ceiling |
| --- | ---: | ---: |
| Orbital Moon representation | 70,000 | 90,000 |
| Active local surface representation | 80,000 | 110,000 |
| Landing capsule | 12,000 | 18,000 |
| Robot | 22,000 | 30,000 |
| Marker and miscellaneous geometry | 3,000 | 5,000 |
| Complete orbital frame | 90,000 | 120,000 |
| Complete landed frame | 140,000 | 200,000 |
| Dual-representation transition frame | 180,000 | 220,000 |

Additional geometry limits:

- GPU-resident vertex/index buffers: 20 MiB target, 32 MiB hard ceiling.
- Prefer indexed BufferGeometry and shared geometry/material instances.
- LOD replacement must be selected before rendering; hidden duplicate LODs may
  not continue drawing.
- Frustum culling remains enabled unless a measured exception is documented.
- Repeated rocks, scanner elements, mineral crystals, robot locomotion parts,
  and extractor feet use instancing; unique hero machinery remains separate for
  readable animation and culling.
- Mesh subdivision is driven by projected error. A high-resolution Moon mesh is
  not retained merely because its texture is detailed.

## Draw-call and shader budget

| Counter | Typical target | Hard ceiling |
| --- | ---: | ---: |
| Draw calls, orbit or landed | 50 | 80 |
| Draw calls during LOD handoff | 70 | 100 |
| Simultaneously active materials | 16 | 24 |
| Compiled shader programs after warm-up | 16 | 24 |
| Transparent sorted draws | 4 | 8 |

Measure renderer.info.render.calls after the complete frame. Any shadow pass
counts against the same ceiling. Merge compatible static meshes, share
materials, and avoid material variants that create needless shader programs.
Do not merge across semantic or culling boundaries solely to improve a counter.

No new shader compilation is allowed during a warmed gesture or camera
journey. Precompile/reveal assets before the transition segment that needs them,
or accept a lower LOD that is already ready.

## Texture budget

| Resource | Typical target | Hard ceiling |
| --- | ---: | ---: |
| Largest texture dimension | 2,048 px | 2,048 px without a reviewed exception |
| Local terrain tile dimension | 1,024 px | 2,048 px |
| Resident texture objects | 24 | 32 |
| Estimated resident texture GPU bytes, including mipmaps | 48 MiB | 64 MiB |
| Anisotropy | 2× | 4× |

Rules:

- Ship color-space-correct KTX2/Basis textures with mipmaps wherever the target
  capability supports them.
- Budget decoded/GPU size, not PNG, JPEG, GLB, or network-compressed size.
- A 2,048 RGBA8 texture without GPU block compression is about 16 MiB before
  its mip chain; four such textures already violate the texture ceiling.
- Color textures use sRGB interpretation; data textures such as normals remain
  linear.
- Normal, roughness, metalness, and occlusion channels are packed or omitted
  where the measured visual difference is acceptable.
- Do not load an 8K global lunar map and rely on browser downscaling.
- Release obsolete texture LODs after a safe handoff. ImageBitmap CPU resources
  are closed when ownership ends.

## Lighting and effects budget

The Moon is lit primarily by one sun:

- one DirectionalLight is the direct light;
- at most one low-cost ambient or hemisphere contribution may aid readability;
- no point or spot lights affect the first-playable scene;
- no real-time shadow map is active in orbit;
- no SSAO, bloom, depth of field, motion blur, volumetrics, screen-space
  reflections, or extra post-processing pass is included.

Surface relief should come from geometry, normal maps, material response, and
careful sun direction. The capsule and robot may use baked ambient occlusion.

The implemented close view uses the approved surface-only directional shadow
experiment with:

- one 1,024 × 1,024 map;
- a tightly fitted shadow camera;
- capsule and robot as the only dynamic casters;
- all shadow-pass calls included in the draw-call budget;
- a measured Pixel 6a comparison and an immediate quality-tier disable path.

The 1,024 × 1,024 map is enabled only on medium/high tiers during approach,
landed, and return phases. The low tier disables it. Physical Pixel 6a evidence
is still required to retain the medium-tier shadow; automated counters alone do
not settle GPU frame time.

Point-light shadows are forbidden: a point light requires six shadow views, and
each shadow-casting light redraws scene geometry. Any shadow experiment is a
reviewed budget change, not an assumption in asset authoring.

## Memory budget

| Memory class | Typical steady state | Hard ceiling |
| --- | ---: | ---: |
| JavaScript live heap | 64 MiB | 96 MiB |
| GPU textures | 48 MiB | 64 MiB |
| GPU geometry | 20 MiB | 32 MiB |
| Render targets/depth/MSAA estimate | 16 MiB | 32 MiB |
| Estimated total GPU resources | 96 MiB | 128 MiB |
| Chrome tab memory footprint | 180 MiB | 240 MiB peak during a handoff |

The categories overlap differently across browser/GPU implementations, so each
must be measured or estimated separately; they are not summed into a fictitious
exact total.

Memory acceptance:

- after five orbit-to-surface-to-orbit cycles and a forced idle period, live JS
  heap must settle within 5 MiB of the post-first-cycle baseline;
- renderer.info memory counts may retain documented Three.js internal caches,
  but app-owned geometry and texture counts must return to their baseline;
- only one active high-detail surface region is resident;
- obsolete ArrayBuffers, decoded images, ImageBitmaps, geometries, materials,
  textures, render targets, and event listeners are explicitly released;
- loading a higher LOD cannot exceed the 240 MiB tab peak. Release or stream the
  old representation if a double-resident handoff would exceed it.

Removing a mesh from the scene does not dispose of its GPU resources. Disposal
is an asset-repository responsibility and is tested as behavior, not left to
garbage collection.

## Transfer and startup budget

These limits prevent a technically smooth scene from becoming unusable on a
mobile connection:

| Payload | Typical target | Hard ceiling |
| --- | ---: | ---: |
| Initial JavaScript, Brotli/gzip measured | 325 KiB | 400 KiB |
| Initial HTML and CSS combined | 20 KiB | 35 KiB |
| Bytes required for rotatable orbital Moon | 3 MiB | 5 MiB |
| All first-playable assets transferred | 8 MiB | 12 MiB |

The Surface Presence production bundle is 308.92 KiB with `gzip -9` (321.27 kB
by Vite's gzip report) on Vite 8.2.2. It still passes the 325 KiB target but has
little headroom and triggers Vite's 500 kB raw-chunk warning. Track the warning
rather than hiding it; introduce measured code splitting before the next
substantial feature.

The background canvas should present within 1 second on a warm load. On a cold
Fast-4G profile, the orbital Moon target is interactive within 5 seconds and
surface/capsule/robot data loads progressively after intent. These timing
targets are collected separately from physical-device GPU runs.

No asset is base64-inlined into JavaScript. Stable hashed URLs and a manifest
permit long-lived caching and future CDN hosting.

## Adaptive quality policy

Quality starts from measured capability, not user-agent branding:

| Tier | DPR | Geometry/texture policy | Lighting |
| --- | ---: | --- | --- |
| High | up to 1.5 and 1M pixels | target LODs, 2K maximum textures | sun plus optional fill; no shadows by default |
| Medium | 1.25 | one step lower Moon/surface LOD; prefer 1K prop maps | sun plus cheap fill |
| Low | 1.0 | lowest accepted geometric LOD; normal-map reduction allowed | sun only |

A sustained frame regression steps down one tier with hysteresis; stable spare
time may recover one tier after a cooldown. Changing tier must not:

- alter canonical simulation or selection results;
- switch to 2D or fake-perspective rendering;
- remove the capsule or robot;
- happen repeatedly enough to flicker;
- allocate both complete tiers longer than the measured handoff window.

Static views return to demand rendering regardless of tier.

## Instrumentation and enforcement

Development-only instrumentation samples:

- renderer.info.render.calls and triangles;
- renderer.info.memory.geometries and textures;
- renderer.info.programs length;
- drawing-buffer width, height, pixel count, and effective DPR;
- requestAnimationFrame frame times, p50/p95/p99, and dropped-frame runs;
- PerformanceObserver long tasks where supported;
- asset transfer bytes, decoded estimates, manifest counts, and phase timing;
- JS heap and tab footprint through Chrome tooling during manual runs.

Counters are captured after representative frames, including the frame with the
largest transition overlap. Debug instrumentation is tree-shaken or disabled in
the production measurement build except for the low-overhead sampler required
by the test.

Budget changes require:

1. the before/after Pixel 6a trace;
2. the visual reason for the change;
3. the affected typical and hard limits;
4. a lower-tier behavior;
5. an update to this file in the same change.

## Visual test requirements

### Deterministic automated captures

Once the corresponding milestone exists, capture these fixed scenes:

1. orbital front/prime-meridian view;
2. orbital limb selection at a known canonical coordinate;
3. exactly 50% through descent;
4. landed view with one capsule;
5. landed view with the capsule opened and one deployed robot;
6. mining and cargo-return states;
7. extractor construction/active state;
8. orbital outpost signal and restored outpost after refresh.

Use fixed viewport, DPR, camera state, clock, sun direction, quality tier, asset
versions, and color settings. Maintain portrait and landscape baselines.
Desktop browser screenshots catch regressions but are not performance evidence.

### Physical Android review

For every 3D milestone, review a production build on the reference phone:

- portrait with browser bars expanded and collapsed;
- landscape and an orientation change while idle and interacting;
- DPR 1.0 plus the device's selected default tier;
- slow drag, fast drag, tap, near-limb tap, pinch, two-finger release,
  interrupted pointer, and touch at all four safe-area edges;
- orbit, target marker, descent midpoint, surface, capsule, and robot when those
  scenes exist;
- texture seam and pole behavior, silhouette faceting, aliasing/shimmering,
  lighting banding, clipping, z-fighting, LOD pop, black frames, marker drift,
  and accidental browser scrolling;
- reduced-motion behavior and WebGL fallback legibility;
- cold-cache load, offline/error state, context loss/restoration, five repeated
  journeys, and the 10-minute thermal soak.

Record screenshots or short external-camera video for visual evidence. Do not
record the phone screen during the timed performance run.

### Pass/fail policy

A milestone fails if any hard numeric ceiling is exceeded, required content
disappears at a lower tier, selection changes with render quality, visual
artifacts obscure the target or entities, touch behavior is unreliable, memory
grows across cycles, or only desktop-emulated evidence exists.

## Documentation basis

- [Official Pixel phone hardware specifications](https://support.google.com/pixelphone/answer/7158570)
- [R3F Canvas DPR, frameloop, and renderer options](https://r3f.docs.pmnd.rs/api/canvas)
- [R3F demand rendering and performance scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Three.js responsive and HD-DPI guidance](https://threejs.org/manual/en/responsive.html)
- [Three.js WebGLRenderer counters and capabilities](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js shadow rendering cost](https://threejs.org/manual/en/shadows.html)
- [Three.js cleanup and decoded texture memory](https://threejs.org/manual/en/cleanup.html)
- [Three.js disposal responsibilities](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [Chrome Android remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging)
- [Chrome memory diagnostics](https://developer.chrome.com/docs/devtools/memory-problems)
