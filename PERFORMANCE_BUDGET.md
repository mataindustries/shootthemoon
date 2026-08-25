# Moon Core Android performance budget

Status: initial enforceable budget, 2026-08-25. Limits apply to the eventual
first playable described in PLAN.md. The current empty scaffold is expected to
sit far below them.

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

## Frame and interaction budget

| Scenario | Target | Hard acceptance ceiling/floor |
| --- | --- | --- |
| Static orbit or landed view | Demand loop is idle | No continuous requestAnimationFrame activity after settling |
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
count. Delta time is clamped after tab suspension. Per-frame loops do not call
React setState, allocate transient vectors in bulk, parse assets, compile new
materials, or rebuild geometry.

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
- Repeated props, if later needed, use instancing; the first playable has only
  one capsule and one robot.
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
- no real-time shadow map is enabled by default;
- no SSAO, bloom, depth of field, motion blur, volumetrics, screen-space
  reflections, or extra post-processing pass is included.

Surface relief should come from geometry, normal maps, material response, and
careful sun direction. The capsule and robot may use baked ambient occlusion.

If contact clarity proves inadequate, one surface-only directional shadow
experiment may be proposed with:

- one 1,024 × 1,024 map;
- a tightly fitted shadow camera;
- capsule and robot as the only dynamic casters;
- all shadow-pass calls included in the draw-call budget;
- a measured Pixel 6a comparison and an immediate quality-tier disable path.

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

The M0 empty production scaffold measures 294.10 KiB gzip JavaScript with Vite
8.2.2. It passes the target but leaves only 30.90 KiB of target headroom and
currently triggers Vite's 500 kB raw-chunk warning. Track this baseline rather
than raising or hiding the warning; introduce measured code splitting before
feature code crosses the 325 KiB target.

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
5. landed view with one capsule and one robot.

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
