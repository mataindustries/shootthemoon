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
