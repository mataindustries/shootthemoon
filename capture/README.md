# Reel capture harness

Reusable, deterministic capture tooling for portfolio-grade footage of the
finished (feature-frozen) Shoot the Moon game. Everything here lives outside
`src/`; it does not add gameplay, does not add a runtime dependency, and does
not change production DPR, camera, geometry, or HUD behavior. It only drives
the game through existing e2e test hooks (the `?e2e` + `VITE_E2E_HARNESS`
flag from `src/testing/e2eHarness.ts`) the same way `e2e/*.spec.ts` already
does, plus one Playwright-only browser-property override for DPR.

## Running it

```sh
# Chromium must be reachable at Playwright's expected revision. In some
# sandboxed dev containers the pre-installed Chromium doesn't match and the
# usual `npx playwright install chromium` CDN download is blocked — point at
# the pre-installed binary instead:
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium   # only if needed

# Integrity tests (fast, no captures written):
npx playwright test --config=capture/playwright.capture.config.ts capture/integrity.spec.ts

# The four Phase 1 proof shots:
npx playwright test --config=capture/playwright.capture.config.ts capture/capture.spec.ts

# Optional: static HTML contact sheet per shot (zero new dependencies)
node capture/contactSheet.mjs            # all shots
node capture/contactSheet.mjs <shot-id>  # one shot

# Reel-level contact sheets (per act, monument match-cut, First Strike /
# Counterstrike / DIVIDER candidates, mobile-proof, full storyboard) —
# grouped from the manifest's own editorial metadata, so a new shot's
# `editorial.act`/id prefix automatically slots it into the right sheet.
# Needs Node's native TS support to import manifest.ts directly (no
# ts-node/tsx dependency):
node --experimental-strip-types --experimental-transform-types \
  capture/reelContactSheets.mjs
```

The webServer step always runs `VITE_E2E_HARNESS=1 npm run build` first (a
fresh production build with the capture-only test hooks compiled in), then
serves it on port 4174 — a different port from the main e2e suite's 4173, so
the two never collide if run back to back.

Output never touches the tracked `artifacts/` tree. Each shot writes to a
gitignored `capture-output/<shot-id>/` (frames + `capture.json`); raw PNGs
are never committed.

## Architecture

```
capture/
  README.md                  — this file
  playwright.capture.config.ts — separate Playwright project (1 worker, swiftshader+mute-audio)
  profiles.ts                 — PLATE/HUD/PORT definitions + DPR-override math (pure, no browser)
  initCapture.ts               — page setup: overrides, fixture seeding, HUD opacity, error watchers
  fixtures.ts                  — FRESH/EXTRACTOR/READY/STRUCK/CLAIM/MON(kind) builders
  gameActions.ts               — shared page actions (claim a site, reach FIRE NOW, open a reveal, …)
  manifest.ts                  — typed Shot list; the four Phase 1 shots live here
  runner.ts                    — generic frame-stepping engine + metadata writer (the "one generic runner")
  capture.spec.ts              — iterates the manifest through the runner
  integrity.spec.ts            — the 7 capture-tooling integrity checks
  contactSheet.mjs             — zero-dependency HTML contact sheet generator (one shot)
  reelContactSheets.mjs        — grouped, editorial-metadata-driven contact sheets (per act, etc.)
  endCardFacts.ts               — verified END CARD source facts (not baked into footage)
  finalEdit.json               — the locked final cut (timeline, cues, AVOID windows, derivatives)
  finalEdit.ts                 — edit types, validateFinalEdit(), deriveRenderPlan() (no src/ imports)
  finalEdit.spec.ts            — validates finalEdit.json against the manifest and production timing
  tsconfig.json                — standalone `tsc --noEmit` check for this directory (not wired into the root build)
```

Everything is generic over the manifest: **adding a shot means adding one
entry to `SHOTS` in `manifest.ts`.** No new test files, no changes to
`capture.spec.ts` or `runner.ts`.

## Capture profiles

| Profile | CSS viewport | deviceScaleFactor | Backing buffer (asserted) | HUD |
|---|---|---|---|---|
| PLATE | 2560×1440 | 1.5 | 3840×2160 | hidden (`opacity: 0`) |
| HUD   | 1280×720  | 1.5 | 1920×1080 | visible / partial |
| PORT  | 390×844   | 3   | 585×1266 (see below) | n/a (real mobile) |

### The DPR-override trick (PLATE/HUD only)

The production renderer intentionally caps around one megapixel
(`calculateDpr` in `src/render/quality.ts`):

```
pixelCapDpr = sqrt(1_000_000 / (cssWidth * cssHeight))
dpr = max(0.75, min(devicePixelRatio, maxDpr, pixelCapDpr))
```

At a 2560×1440 CSS viewport, `pixelCapDpr` alone resolves to ~0.52 — nowhere
near the 3840×2160 target. `calculateDpr`'s two call sites in `src/App.tsx`
read `window.innerWidth`/`window.innerHeight` directly (confirmed by a
repo-wide grep to have **no other call site in `src/`**), so a Playwright
`addInitScript` override of just those two globals — to a synthetic
640×360 pair, chosen so `pixelCapDpr` clears 1.5 with margin — makes
`calculateDpr` resolve to the full `deviceScaleFactor` (1.5), while the real
CSS layout (and therefore `src/camera/surfaceSafeArea.ts`'s
`getBoundingClientRect()` reads of `.hud-header`, `.command-deck`, etc.)
is completely unaffected. `initCapture.ts` then asserts the live
`data-buffer-width`/`data-buffer-height` canvas dataset (already-existing
instrumentation in `src/instrumentation/SceneMetrics.tsx`) against the
predicted size and throws loudly on any mismatch. `capture/integrity.spec.ts`
proves this against the real, unmodified production `calculateDpr()` in a
live browser, not just on paper.

The quality tier is also forced to "high" (`maxDpr = 1.5`) via
`navigator.deviceMemory`/`hardwareConcurrency` overrides — deliberately
different from the values e2e specs already use elsewhere (`memory=6,
cores=8`, which actually lands on **medium**, `maxDpr = 1.25`, given
`detectQualitySettings`'s thresholds). Capture uses `memory=8, cores=12` to
clear both thresholds.

### PORT is different on purpose

PORT exists to prove genuine mobile behavior, so it **never applies the
override**. At 390×844 with `deviceScaleFactor: 3`, production's own
`maxDpr` ceiling (1.5) binds before the megapixel cap does, so the real,
unmodified backing buffer is 585×1266 — not 1170×2532. That's the actual,
honest "practical" result of asking for 3x on this renderer, and capture
reports it as such rather than fighting it.

## HUD visibility

`initCapture.ts#applyHudVisibility` injects one `<style>` tag:

```css
.app-shell *:not(.scene-canvas):not(.scene-canvas *) { opacity: 0 !important; }
```

`opacity: 0` only — never `display:none`, `visibility:hidden`, or node
removal — so every HUD box keeps a real, non-zero `getBoundingClientRect()`,
which is what the camera's surface safe-area logic measures. A `'partial'`
mode adds `:not(selector):not(selector *)` exceptions for shots that need
specific HUD regions to stay visible.

## Frame stepping

Two deterministic strategies, both already established in the existing e2e
suite — this harness doesn't invent new mechanisms, it generalizes them:

- **progress-event** (`createProgressEventStepper`): pins a presentation's
  normalized `[0, 1]` progress via an existing test-hook CustomEvent
  (`moon-core:set-cinematic-progress` for the descent/return cinematic,
  `first-strike:set-presentation` for the First Strike presentation phases).
  No fake clock involved — each distinct progress value triggers exactly one
  new R3F frame via `invalidate()`. Real time only enters as a short
  post-dispatch settle wait.

- **clock** (`createClockStepper`): drives Playwright's fake clock
  (`page.clock`), using the exact `fastForward`-then-`runFor` idiom
  `e2e/helios-reactor.spec.ts` already calls `seek()` — fast-forward close to
  the target, then run the remaining milliseconds in real ticks so the last
  few frames actually commit before landing. Required for the Helios reveal,
  whose timeline is computed from real `performance.now()` deltas rather
  than an explicit progress-override event.

  For the **final render's** elapsed-ms clips the clock stepper's
  `sampleAt()` replaces that idiom. Playwright's fake clock only fires
  `requestAnimationFrame` on a fixed 16ms grid (`16 - ticks % 16`) and
  `fastForward` can only delay timers, never pull one earlier, so a
  slow-motion sample spacing of 5.6-13.2ms cannot be rendered on time by
  stepping the clock alone (run #4's c19 drifted to +5952ms for a +680ms
  request). `sampleAt` holds animation frames in a harness queue
  (`installHeldAnimationFrames`), runs the paused clock to the exact target
  tick with a plain `runFor` (the last 100ms one tick at a time, letting
  React commit behind every timer so the app's 80ms simulation interval
  re-arms on time), then flushes the held frame callbacks at that tick and
  requires the frame counter to advance. Every frame records the source time
  it rendered at (`renderedSourceMs` in `capture-health.json`). Review
  captures and every reach still use `advanceTo`. Real-browser regression:
  `capture/finalRenderSampling.spec.ts` (c19 at its full 108-frame density,
  ~7 min).

Both are wrapped by one generic `captureFrames()` in `runner.ts`, which:
reads the R3F frame counter (`data-frame-count`, from the existing
`SceneMetrics` instrumentation) before and after every step; nudges (re-steps,
bounded retries) and **throws rather than silently duplicating a frame** if
the counter fails to advance; writes sequentially numbered
`NNNNNN.png` files (lexicographic sort == numeric sort, checked in
integrity test #5); and returns frame/timing metadata for `capture.json`.

**CSS-only transitions are never frame-stepped.** Playwright's fake clock
does not drive the compositor thread that runs CSS transitions, so a shot
that needs one to settle (the entry-gate fade, in the Helios shot) uses one
real-time `page.waitForTimeout` and otherwise sticks to the clock/progress
stepper for the actual 3D animation. `captureStill()` is the third mode, for
shots that are a single real-time screenshot (Counterstrike FIRE NOW).

## Fixtures

All fixtures reuse the existing e2e fixture/reducer architecture in
`e2e/firstStrikeFixtures.ts` and `e2e/rivalFixtures.ts` (which themselves
call the real `src/simulation/*` reducers and
`src/persistence/outpostSave.ts` serializers) — nothing is hand-fabricated
except the monument-completion patch, which generalizes the exact pattern
`e2e/helios-reactor.spec.ts`'s own `heliosSave()` helper already uses across
all four monument kinds, then validates the result with the real
`parseTerritoryMonument` domain guard (`capture/fixtures.ts`).

| Fixture | Source |
|---|---|
| `FRESH` | no save |
| `EXTRACTOR` | `createLegacyActiveExtractorSave()` (~40 ore: 95 seeded − 60 `EXTRACTOR_COST`) |
| `READY` | `createStrikeReadySave()` |
| `STRUCK` | `createCompletedStrikeSave()` |
| `CLAIM` | `createAcceptedCounterstrikeSave('SUCCESS')` |
| `MON_<KIND>` | CLAIM + a completed `<KIND>` monument, `revealSeen: false` |

## Phase 2: the full reel candidate manifest

`capture/manifest.ts` now holds the complete ~46-shot candidate set for the
approved six-act ~58s master (see the module doc comment at the top of that
file), not just the four Phase 1 proof shots below. Every new shot follows
the same "one manifest entry, generic runner" rule Phase 1 established —
`runner.ts`, `capture.spec.ts`, and `playwright.capture.config.ts` are
unchanged. Each `Shot` now also carries a required `editorial` field (act,
proposed edit order, working timecode, intended edited duration, crop/reframe
guidance, audio note, edit note, and a REQUIRED/ALT/OPTIONAL priority) —
read only by `reelContactSheets.mjs` and by whoever cuts the final edit,
never by the runner. Frame counts are deliberately review-sized (1 hero
frame up to ~16 for a complicated reveal), never full-duration masters.

One new fixture was added: `CLAIM_RICH` (CLAIM with `lunarOre` patched to
230, the same direct-JSON-ore-patch precedent `e2e/wave-defense-feedback
.spec.ts`/`e2e/territory-monuments.spec.ts` already use) — needed only by
shots that actually walk the monument-construction/DIVIDER-wave-defense
flow, since plain `CLAIM` alone (unpatched) only has enough ore to render
the kind-choice panel, not to build one.

`capture/endCardFacts.ts` records verified END CARD source facts (tech
stack, test count, bundle size, "zero external model files") — data only,
not design; the end card itself is out of scope for this phase.

## Phase 3: the locked final cut

`capture/finalEdit.json` is the locked 57.6s edit (24 bars at 100 BPM): 25
clips from 24 manifest shots plus the end card, the audio-cue map, documented
AVOID windows, and the derivative-asset plan (hero reel, web reel, silent
loop, poster, stills, mobile screenshots). It is plain data for the later
ffmpeg/editor step and only references shot ids — no capture logic is
duplicated. `capture/finalEdit.ts` holds its types, `validateFinalEdit()` and
`deriveRenderPlan()`; it imports nothing from `src/`.

```sh
# Validates the cut (timeline continuity, 55-60s, shot references, crops,
# end-card ordering, production phase durations, AVOID windows):
npx playwright test --config=capture/playwright.capture.config.ts capture/finalEdit.spec.ts
```

Source windows are in each shot's native timeline (`progress` for the
set-presentation/set-run hooks, `elapsed-ms` from a named fake-clock anchor,
or `still`). Crops are in screenshot pixels — CSS viewport × deviceScaleFactor
— so PORT is 1170×2532 even though its WebGL buffer is 585×1266.

`deriveRenderPlan()` is the final-render shortlist: only referenced shots,
only the windows the cut uses, one real frame per 60fps output frame (slow
motion is never interpolated) and one frame per still — 2,749 frames across
25 shots, against the 46-shot candidate set.

Before the final render, still to build (after the cut is approved):

- A final-render mode for `capture.spec.ts` that drives each planned shot
  through its plan windows at 60fps; today every `run()` hardcodes its review
  window.
- Three windows go beyond what their manifest entry captures today:
  `counterstrike-terminal-dive` uses impact progress 0.16–0.33 (the `medium`
  push-in beat, not the static `wide` hold it samples now),
  `counterstrike-impact-contact` becomes a 0.3409–0.55 sweep instead of one
  still, and `bastion-held-hero` runs the whole +300→+6000ms reveal pull-back.
- `divider-weapon-volley`'s first 4K frame took 71.5s to screenshot (shader
  compile), over `SCREENSHOT_TIMEOUT_MS` (60s); later frames are far cheaper.
  The final render needs a longer first-frame timeout or a warm-up frame.
- A proof pass (first and last frame of every window) before committing to
  the full ~6h SwiftShader run.

## Phase 4: the final-render pipeline

```
capture/
  finalRender/
    plan.ts        — pure: turns finalEdit.json into an ordered job list
                      (frame counts come straight from finalEdit.ts's own
                      deriveRenderPlan(); crop/cropEnd/act/order are rejoined
                      from the original timeline/derivative items)
    reachKinds.ts   — pure: shotId -> declared clock kind ('progress' |
                      'elapsed-ms' | 'still'), a static cross-check table
    reach.ts        — per-shot setup ("reach") functions: everything each
                      shot's manifest.ts run() does BEFORE it starts
                      sampling, returning a generic advance(value) instead of
                      a hardcoded review window
    engine.ts       — the capture loop: drives reach.advance() across the
                      exact finalEdit.json window, screenshot timeout/retry
                      policy, atomic (.tmp + rename) frame writes
    resume.ts       — per-job output dirs, frame validation (missing /
                      corrupt / frozen-duplicate), atomic completion markers
    storage.ts      — expected-size estimate + free-disk-space preflight
    summary.ts      — complete/incomplete/failed/frames/disk/elapsed rollup
    cliArgs.ts       — --clip/--act/--profile/--all/--proof/--force parsing
  finalRender.mjs              — CLI entry point (spawns the real Playwright run)
  finalRender.spec.ts          — the full, resumable, storage-gated render
  finalRenderProof.spec.ts     — proof-frame mode (first/mid/last only)
  finalRenderContactSheet.mjs  — proof-pass HTML contact sheet, edit order
  finalRenderPlan.spec.ts      — source-frame/60fps/slow-motion/crop tests
  finalRenderResume.spec.ts    — resume/completion-marker/duplicate-frame tests
  finalRenderStorage.spec.ts   — storage-preflight tests
  finalRenderCli.spec.ts       — CLI-filter tests
```

Never modifies `src/`. Three small manifest.ts helpers
(`counterstrikeRunDispatcher`, `setupCounterstrikeTracking`,
`setupDividerFirstWave`) and two runner.ts internals (`readFrameCount`,
`waitForFrameCountAbove`) were exported (previously module-private, same
implementation) so this reuses the exact production-hook setup logic each
manifest shot already uses, instead of re-implementing it.

**Frame count.** `plan.ts` never invents its own number — it reads
`deriveRenderPlan()`'s already-tested "destination duration × output fps"
result per clip (independent of `speed`; slow motion is expressed by
sampling that same frame count across a narrower source `[in, out]` window,
never by rendering extra frames or interpolating). The locked cut recomputes
to exactly **2,749 source frames across 25 shots** — see
`finalRenderPlan.spec.ts`'s pinned assertion.

**Sampling.** Frame `i` of `frames` lands at `t = i / (frames - 1)`
(inclusive of both endpoints, not a video-frame-boundary offset) so the
first and last captured frame sit exactly on the approved `in`/`out`
boundary — the exact thing the proof pass exists to scrutinize.

**Crops.** finalEdit.json crops are in screenshot/device pixels (CSS
viewport × deviceScaleFactor). `toCssClip()` converts back to the CSS pixels
Playwright's `page.screenshot({ clip })` expects; a `crop`→`cropEnd` clip
interpolates linearly in device pixels first, then converts.

**Prerequisites fixed (all four, generically — no shot-specific
special-casing beyond what reach.ts's normal design already does):**
1. Counterstrike's extended windows (`counterstrike-terminal-dive` 0.16→0.33,
   `counterstrike-impact-contact` 0.3409→0.55 as a sweep) are just the
   `in`/`out` values in finalEdit.json — `reach.ts` drives the same
   `counterstrike:set-run` 'impact' dispatch across whatever window is asked
   for, not the narrower review-only ranges manifest.ts's own shots sample.
2. `bastion-held-hero`'s full +300ms→+6000ms pull-back is likewise just the
   elapsed-ms window in finalEdit.json — no Bastion/camera change.
3. Screenshot timeout/retry (`engine.ts`): a longer ceiling for a clip's
   first frame (120s vs 60s), one retry at an even more generous ceiling
   (150s) before giving up, and every screenshot is written to a `.tmp` path
   and only renamed onto its real filename after it fully lands — a timed-out
   attempt can never leave a corrupt/partial frame at its real path.
4. Proof-frame mode (`finalRenderProof.spec.ts`): first/mid/last frame only,
   the mandatory cheap gate before the expensive render.

**Resume (`resume.ts`).** Each job gets its own
`capture-final/<clipId>__<shotId>/` directory. `validateJobFrames()` scans
for missing frames, zero-byte/corrupt frames, and frozen frames (a motion
clip's adjacent frame byte-identical to its predecessor); only those
indices are re-driven — both stepping mechanisms this codebase uses
(direct progress-event dispatch, and Playwright's fake clock advanced
forward via `advanceTo`) are safe to jump straight to an arbitrary needed
index without re-visiting every one before it. A `.complete` marker is
written (atomically: temp file + rename) only after a full validation pass
finds every frame present, non-corrupt, and free of adjacent duplicates.
One clip throwing never aborts the run — `finalRender.spec.ts`'s
`test.describe` is deliberately not `.serial`, the same choice
`capture.spec.ts` already made for the same reason.

**Storage preflight (`storage.ts`).** Estimates bytes from each job's crop
area × frame count × a bytes/pixel constant (documented as a starting
estimate, replaced by `recalibrateBytesPerPixel()` fed real proof-pass frame
sizes before trusting a full-render number), then refuses to start unless
free disk space clears the estimate by a 25% margin or a flat 2 GiB floor,
whichever is larger.

### Running it

```sh
# Cheap gate — first/mid/last frame of every selected clip (run this first):
node --experimental-strip-types --experimental-transform-types \
  capture/finalRender.mjs --proof --all
node --experimental-strip-types --experimental-transform-types \
  capture/finalRenderContactSheet.mjs   # capture-final/proof-contact-sheet.html

# Filtered proof passes:
capture/finalRender.mjs --proof --clip=c07
capture/finalRender.mjs --proof --act=FIRST_STRIKE
capture/finalRender.mjs --proof --profile=PLATE

# The full render (the ~6h run) — same filters, no --proof:
capture/finalRender.mjs --all
capture/finalRender.mjs --clip=c19
capture/finalRender.mjs --act=DIVIDER
capture/finalRender.mjs --profile=PLATE
capture/finalRender.mjs --all --force   # re-render even already-complete clips

# Direct Playwright invocation also works (finalRender.mjs just wraps this):
CAPTURE_FINAL_CONFIRM=RUN_FULL_RENDER \
  npx playwright test --config=capture/playwright.capture.config.ts capture/finalRender.spec.ts
```

`finalRender.spec.ts` refuses to do any work unless invoked with
`CAPTURE_FINAL_CONFIRM=RUN_FULL_RENDER` set (only `finalRender.mjs` sets it)
— a bare `npx playwright test` that happens to sweep this file up skips
every test instantly instead of starting a multi-hour render.

Every clip also writes `capture-health.json` (canvas buffer, page/console
errors, WebGL state, per-frame timings) and an append-only
`browser-errors.jsonl`; a clip with any unexpected page/console error or an
unhealthy WebGL context now fails (via `assertCleanWebGl()`, the same bar
`capture.spec.ts` holds) and is never marked complete.

## Phase 5: rendering on GitHub Actions

`.github/workflows/final-render.yml` runs the unchanged renderer on
standard `ubuntu-latest` runners (4 vCPU / 16 GB for public repos) — no
Codespaces, no larger runners. Manual trigger only:

- **final-preflight** (default): the gate to pass before another full run.
  Four parallel jobs, ~15-20 min wall (capture/ci/preflight.mjs):
  `c19-dense` (c19 at its real 108-frame density, full verify + encode, every
  frame at its exact source time), `crops-port` (c24/c25/c16 first/mid/last
  at their exact rasterized sizes + the c18 PORT still end to end),
  `progress-c07` (12 spread c07 frames: exact 4K size and this runner's
  per-frame cost, projected onto c01), `timeout-resume` (c22 with its first
  attempt cut short by fault injection must still verify).
- **smoke**: one clip, default `c07`.
- **repair**: the listed clips (default: run #4's failures c01 c02 c03 c10
  c16 c19 c24 c25), one runner job each, verified like a full run. Requires
  `confirm_full=RENDER_FULL_REEL`.
- **full**: all 25 locked shot clips — every progress-event clip in a runner
  job of its own, stills and the fast elapsed-ms clips grouped per act
  (`partitionForCi`) — then a verification job. Requires
  `confirm_full=RENDER_FULL_REEL`.

```
capture/ci/
  reelCi.ts            — pure: partitioning + run #4-measured cost model,
                          attempt budget + retry policy, expected source
                          sizes, 1080p60 intermediate plan (ffmpeg filter per
                          clip kind), whole-reel verifier, preflight checks
  io.ts                — PNG header / hash / ffprobe / child-process helpers
  plan.mjs             — prints + emits the Actions matrix
  renderGroup.mjs      — per clip: finalRender.mjs --clip → verify → encode →
                          re-verify → clip.json + contact JPEGs → delete PNGs
  preflight.mjs        — one final-preflight part (see above)
  encoderSelfTest.mjs  — synthetic-frame check of every encode path
  verifyReel.mjs       — cross-checks every clip.json; writes reel-manifest.json
capture/ciPipeline.spec.ts — pure tests for reelCi.ts
```

**Crops.** Motion clips' PNGs already carry their (interpolated) locked crop
— the engine screenshots with a `clip` — so ffmpeg only Lanczos-scales them
to 1920x1080. Held stills are captured at `crop` only, so a still's
`cropEnd` push (c21) is applied in ffmpeg (`zoompan` on a 2x-upsampled
still, the same linear path as `interpolateCrop()`), and PORT stills are
pillarboxed at 1080 high on black. Transitions, the head fade and the end
card are **not** baked in: they belong to assembly and are recorded in each
`clip.json` (`transitionOut`).

**Intermediate.** H.264 High 4:4:4 (libx264, yuv444p 8-bit), CRF 10,
preset slower, 0.5s closed GOPs, CFR 60, BT.709 limited range, no audio.
Motion clips are one real frame per output frame (never retimed or
interpolated); a held still is its one frame repeated for the clip's locked
duration. Measured on the real c07 frames vs. a lossless 1080p reference:
PSNR 58.3 dB avg / 57.1 min, SSIM 0.99904, 1.57 MB for 2.4s.

**What leaves the runner.** Per clip: the `.mp4`, `clip.json` (git SHA,
act, ids, source/output frame counts and sizes, duration, sha256 of the
video and of the source PNG sequence, harness-bundle hash, timings, tool
versions), `render.json`, `capture-health.json`, `frames.sha256`, and
first/middle/last JPEGs + a strip sheet. Raw PNGs stay on the runner's disk,
are deleted once their clip is encoded, and are excluded from the upload
(the job also fails if a PNG is ever found in the upload directory).

**Source sizes.** A screenshot clip's size is whole CSS pixels (Playwright
floors it; so does Chromium's own `Page.captureScreenshot`), so at DPR 1.5 a
2560px-wide crop — c16, and c24/c25's end of their crop push — rasterizes to
exactly 2559px (the requested crop minus its last column; the origin is
exact). `plan.ts rasterizedClipSize` models this and the size check expects
the modeled size with zero tolerance at endpoints and static crops; the
encode's fixed `scale=1920:1080` normalizes it like every other frame.

**Time and resume.** A clip's attempt timeout is derived from the frames it
still has to render and its source clock (`finalRender/timing.ts`: 90 s per
progress-event frame, 20 s per elapsed-ms frame — twice run #4's worst
averages — plus 10 min), capped by what is left of the job's
`--budget-minutes=325` (step timeout 335, job 355, GitHub cap 360). A truly
stuck render still fails within minutes on the per-frame watchdogs. A failed
attempt is retried only per `decideRetry`: a progress-event clip resumes only
missing/corrupt/frozen frames and stops after two attempts in a row without a
new valid frame; an elapsed-ms clip is always re-rendered whole in one page
session (its reach anchor varies by up to 16ms of source between sessions).
Every attempt is recorded in `clip.json` / `FAILED.json`. Across workflow
attempts, "Re-run failed jobs" restores that job's earlier artifact and skips
every clip already verified for the same SHA (hash-checked).

```sh
# Everything the workflow runs, locally:
node --experimental-strip-types --experimental-transform-types capture/ci/plan.mjs --mode=full
node --experimental-strip-types --experimental-transform-types capture/ci/preflight.mjs --part=c19-dense --out=ci-out
node --experimental-strip-types --experimental-transform-types capture/ci/encoderSelfTest.mjs
node --experimental-strip-types --experimental-transform-types \
  capture/ci/renderGroup.mjs --group=smoke-c07 --clips=c07 --out=ci-out
node --experimental-strip-types --experimental-transform-types \
  capture/ci/verifyReel.mjs --dir=ci-out --expected=c07 --sha=$(git rev-parse HEAD)
```

## Phase 6: assembling the release media (no rendering)

`.github/workflows/final-reel-assemble.yml` ("Final reel assembly") turns the
verified intermediates of a finished render run into the release media in
minutes. It never renders: no browser, no harness build, no render matrix.
Its code has no import or child-process path to the renderer (only ffmpeg,
ffprobe, git and unzip; `capture/ci/assembly.test.ts` walks the import graph
and scans the workflow to keep it that way). `final-render.yml` is unchanged.

```
capture/ci/
  reelRelease.json          — the pinned release source: Final reel render run #6
                              (run id, SHA, the 18 artifacts with ids + zip digests)
  end-card-1920x1080.png    — the approved end-card still (--end-card in the workflow)
  sourceRun.mjs             — finds that run by number through the API, validates it
                              against the pin, downloads its artifacts (digest-checked)
  assembly.ts               — pure: input verification, sequence/transition plan,
                              ffmpeg graphs, encode settings parsed from finalEdit.json,
                              poster frame pick, output checks, and
                              RELEASE_FRAME_OVERRIDES (declared one-frame repairs) and
                              RELEASE_INTERVAL_OVERRIDES (the two portrait inserts, covered)
  assembleFinalReel.mjs     — verify -> reel -> loop -> stills -> check;
                              manifest.json + SHA256SUMS
  assembly.test.ts          — pure tests + static no-renderer guards (node --test)
  assemblySynthetic.test.ts — opt-in end-to-end run on synthetic test-pattern media
```

**Inputs are verified before anything is assembled.** The run's own
`reel-manifest.json` must say verified at the rendered SHA; every locked
shot clip must be present exactly once (the render workflow's own
`verifyReelRecords`); every intermediate must re-hash to its `clip.json` and
reel-manifest sha256 and ffprobe to 1920x1080 yuv444p at its exact frame
count; and `capture/finalEdit.json` must be byte-identical to the copy at
the rendered SHA. Any failure stops the job. A missing clip is never
filled in.

| file | from finalEdit.json |
|---|---|
| `reel-57s-1080.mp4` | the whole timeline in order at exact frame counts (3,456 @ 60fps = 57.6s): `headFadeFromBlackMs`, each clip's `transitionOut` (flash-white/dip-black centered on the cut, fade-black outgoing only; applied in YUV, sampled at frame start like ffmpeg's `fade`), the end-card slot (the approved still, `capture/ci/end-card-1920x1080.png`), `derivatives.heroReel.encode`, and the declared release frame + interval overrides (below) |
| `loop-13s-1280.mp4` | `derivatives.loop`: its clip list and fps (every 2nd real frame, 414 @ 30fps = 13.8s), silent. A transition is kept only where the loop keeps its two clips adjacent (c09->c10, c15->c16 flash-white). 1280x720, `derivatives.webReel` encode |
| `poster-1280.jpg` / `.webp` | `derivatives.poster`: the verified frame of the clip holding that shot/instant/crop (c07 frame 72, 0.89 ms of source time from the named instant; the render run renders timeline clips only) |
| `og-home-1200x630.jpg` | the same frame, full width, trimmed equally top and bottom (the spec gives only the size and a clean right third) |

The end card is the approved 1920x1080 still `capture/ci/end-card-1920x1080.png`,
passed by the workflow as `--end-card` and held for the locked 52.8-57.6s
slot (288 frames, entering on the edit's dip from black); without
`--end-card` the slot stays black. Not in the repo, so not invented: the
reel has no audio stream (finalEdit.json holds a cue map, not a mix;
`--audio=<final mix>` muxes one per `heroReel.audio`), and the social image
has no title typography.

**Release frame overrides.** A defect baked into one frame of verified
footage is repaired in assembly, never by re-rendering: `assembly.ts`
`RELEASE_FRAME_OVERRIDES` declares each repaired reel frame with the source
clip/frame the locked plan puts there, the replacement (the adjacent frame
of the same clip) and the reason. Today there is exactly one:

| reel frame | time | original | replacement | reason |
|---|---|---|---|---|
| 468 | 7.800s | c03#36 (vesper-citadel-reveal, rival-signal:impact progress 0.81294) | c03#37 (the frame shown at reel frame 469) | one-frame enemy-base scale/camera defect |

An override is bound to the footage it was declared for (run #6's id and
SHA, and the pinned digest of the `render-act2-rival-c03` artifact holding
c03); for that SHA it must be confirmed from `--source` or assembly stops,
and it never applies to other footage. It must match the locked plan,
sit outside any transition, replace with the untouched neighbouring frame of
the same shot clip, and name a clip in no other deliverable. In the ffmpeg
graph the clip is only re-trimmed ([18,36) + [37,38) + [37,144) instead of
[18,144)), so the reel keeps its 3,456 frames and every other frame its
position; nothing is interpolated.

**Portrait interval overrides.** The locked cut holds two real 390x844 phone
viewport stills as pillarboxed portrait clips (c14, c18), which flash a
narrow portrait picture inside the 16:9 reel and break the aspect ratio on
mobile. `RELEASE_INTERVAL_OVERRIDES` declares each as a compact interval of
the same override mechanism (it expands to one ordinary per-frame override
per reel frame, so the plan check and frame-by-frame verification below
apply unchanged): the whole portrait clip's reel frames show one frame of
the immediately adjacent full-16x9 shot clip, held. Frame for frame: the
reel keeps its 3,456 frames and nothing after either interval moves.

| reel frames | time | original | replacement |
|---|---|---|---|
| 1764-1799 (36) | 29.400-30.000s | c14 (counterstrike-fire-now-port, still, pillarboxed) | c13#35 held — the desktop FIRE NOW still of the same moment |
| 2088-2159 (72) | 34.800-36.000s | c18 (divider-fire-defense-port, still, pillarboxed) | c17#71 held — the last, locked-on frame of the shot before it |

An interval must cover exactly one whole `pillarbox-portrait` clip, be
replaced by a frame of a `full-16x9` clip that is its immediate timeline
neighbour (frame inside that clip), sit outside any transition, and name
clips in no other deliverable; it is bound to run #6's id, SHA and the pinned
digest of the artifact holding both clips (`render-act4-counterstrike`,
`render-act5-divider`) exactly like the frame override. Assembly stops if a
declared interval cannot be confirmed, or if any frame of a portrait clip
would remain in the reel. In the graph the covered segment reads a second
input of the covering clip (`trim` + `loop` of one existing frame): nothing
is cropped, blurred, pillarboxed or rendered, and the loop, poster and stills
do not use c14/c18, so they are unchanged.

Every output is ffprobe'd and fully decoded, and the reel and loop are
checked frame by frame: each output frame's luma thumbnail must match its
planned source frame with its planned fade (any reordering, dropped frame
or shifted cut fails). The reel's plan is the locked plan with exactly the
declared override frames swapped, so any undeclared substitution still
fails; each override frame must also match its replacement, differ from the
original, and the original must differ from the replacement by more than
the tolerance (the check could not otherwise catch it undeclared).
`manifest.json` records the source run, artifact digests, edit hash, tools,
plan, the end card's sha256, every override with its check, and every
output's size, codec, duration, audio and sha256.

```sh
# Pure tests + guards (no ffmpeg needed):
node --experimental-strip-types --experimental-transform-types --test capture/ci/assembly.test.ts
# Full CLI on synthetic media, incl. a run #6 stand-in with a planted
# c03#36 defect (ffmpeg, run #6's commit in history; ~10 min):
ASSEMBLY_E2E=1 node --experimental-strip-types --experimental-transform-types --test capture/ci/assemblySynthetic.test.ts
# The real thing, locally (GITHUB_TOKEN with actions:read):
node --experimental-strip-types --experimental-transform-types capture/ci/sourceRun.mjs --run-number=6 --out=capture-final/run-6
node --experimental-strip-types --experimental-transform-types capture/ci/assembleFinalReel.mjs \
  --dir=capture-final/run-6 --source=capture-final/run-6/source-run.json \
  --end-card=capture/ci/end-card-1920x1080.png --out=capture-final/deliverables
```

## The four Phase 1 proof shots

| id | profile | fixture | mechanism | frames |
|---|---|---|---|---|
| `descent-touchdown` | PLATE | FRESH | progress-event (`moon-core:set-cinematic-progress`) | 23 |
| `first-strike-orbital-flight` | PLATE | STRUCK | progress-event (`first-strike:set-presentation`) | 20 |
| `counterstrike-fire-now` | HUD | STRUCK | real-time still | 1 |
| `helios-reveal` | PLATE | `MON_HELIOS_SPIRE` | fake clock (`page.clock`) | 16 |

The descent window (progress 0.12–0.42) is deliberately clear of the
audited 55–85% descent texture (Moon/SurfacePatch LOD) handoff band. The
orbital-flight shot sweeps the phase's full 0–1 progress
(`FIRST_STRIKE_PRESENTATION_DURATIONS_MS['orbital-flight']`, an already
publicly exported constant), making it a reasonable source for a future
poster-frame pick.

## Known limitations / honest caveats

- `APPROACH_DURATION_SECONDS` (6.2s), the descent cinematic's real duration,
  is a private constant in `src/camera/CinematicClock.tsx` and isn't
  exported. It's mirrored here as a documented literal
  (`DESCENT_APPROACH_DURATION_MS` in `manifest.ts`) purely to convert
  progress↔ms for fps-accurate frame spacing; if that constant ever changes
  in production, this shot's frames stay valid (progress is always clamped
  to `[0, 1]`) but its real-time spacing drifts slightly. Exporting the
  constant would be a one-line, additive change to production source — we
  did not make it without asking, per the "ask before changing production
  source" rule.
- `capture/`'s own type-correctness is checked with a standalone
  `capture/tsconfig.json` (`npx tsc --noEmit -p capture/tsconfig.json`), run
  by hand — it is **not** wired into the root `tsconfig.json` references or
  `npm run typecheck`, matching `e2e/*.ts`'s own existing status (also not
  covered by any tsconfig today). Playwright itself only strips types at
  runtime, so this standalone check is the only thing catching a real type
  error in this code; re-run it after any change here.
- The "known environment warnings" allowlist (`KNOWN_ENVIRONMENT_WARNINGS` in
  `initCapture.ts`) is intentionally empty: nothing in the existing e2e suite
  tolerates any console/page error today, so capture holds the same bar
  until a specific, reproduced, documented warning demands an entry.
- Font fallback is reported best-effort via
  `document.fonts.check('16px "Roboto Condensed"')`, not a pixel-level
  metrics comparison. Treat a `false` result as "investigate," not
  necessarily "broken."
- PORT's profile is fully defined in `profiles.ts` but not exercised by any
  Phase 1 shot (all four are PLATE/HUD). Its DPR-untouched behavior is
  proven on paper in `integrity.spec.ts` (test group 1) but not yet against
  a live capture.

## Expanding from four shots to the full reel

1. Add a `Shot` entry to `SHOTS` in `manifest.ts` (id, name, profile,
   fixture, hud mode, notes, and a `run()` that reaches the target state and
   calls `captureFrames`/`captureStill`).
2. If the shot needs a new page action (a new UI flow to reach), add it to
   `gameActions.ts` following the existing pattern — copy the dispatch/click
   sequence from the matching `e2e/*.spec.ts` test, don't invent a new hook.
3. If the shot needs a new fixture starting state, add it to `fixtures.ts`
   the same way — prefer an existing reducer/save-builder path; only patch
   JSON directly when `e2e/helios-reactor.spec.ts`'s own precedent already
   does the same (i.e., monument completion), and always validate the patch
   with the real domain parser.
4. Nothing in `runner.ts`, `capture.spec.ts`, or `playwright.capture.config.ts`
   needs to change to add a shot.
5. Run `node capture/contactSheet.mjs` to spot-check the new shot's frames
   before trusting it for the final reel.

Keep batches small during development (per-shot frame counts in the 8–24
range) and run one worker at a time — the config already enforces this
(`workers: 1`), so don't override it when scaling up shot count.
