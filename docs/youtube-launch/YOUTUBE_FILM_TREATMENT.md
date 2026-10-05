# SHOOT THE MOON — YOUTUBE LAUNCH FILM: TREATMENT

**Status:** first cut, edit decision locked for narration. **Not approved. Not committed.**
**Authority:** `capture/youtube/youtube-film.json` (edit decision) and `capture/youtube/youtubeTitles.cues.json` (graphics). This document is generated from them where it lists frames.
**Runtime:** **2:31.20**, exactly **9,072 frames** at 60 fps (1920×1080). That is **63 bars at 100 BPM**, the reel's own tempo.
**Validation:** `validateFilm()` returns no problems. It runs `mediaPriority.ts checkTimelineSources` over every reel frame the picture reads, so the timeline rejects titled sources. See `capture/youtube/youtubeFilm.test.ts`.

---

## 1. Thesis

> I wanted to build an original browser game about lunar territory, escalation and orbital warfare. The point is not that AI "made a game". I had the game I wanted to make, and directing frontier models as creative and engineering collaborators let one person carry out that idea, its visual direction and its systems far faster than they could alone.

The film earns that line in order:

1. **World.** You landed first. They landed anyway.
2. **Escalation.** First strike, counterstrike, a third power.
3. **Systems.** None of it was a cutscene: real coordinates, a real route.
4. **The build.** I directed, the models accelerated, and the evidence shows the iteration.
5. **Payoff.** The finished game.

AI is not mentioned until 1:27.3.

## 2. Shape

| Act | Time | Frames | What it does | Picture |
|---|---|---|---|---|
| WORLD | 0:00.00–0:18.60 | 0–1115 | Premise in 18 s: the Moon, your landing, their landing, Vesper's demand, the decision to fire. Works muted. | clean reel c01–c05 |
| ESCALATION | 0:18.60–0:43.80 | 1116–2627 | First Strike → Counterstrike → the Octogonals. Impacts play clean and silent. | clean reel c06–c20, the reel's own order |
| SYSTEMS | 0:43.80–1:27.00 | 2628–5219 | Reveal it is a live browser game, then three visible proofs: real coordinates, a computed route, code-authored 3D. | 3 new captures, phone recording, route diagram, one code excerpt |
| BUILD | 1:27.00–2:11.40 | 5220–7883 | Introduce the model workflow, grounded in evidence: before/after iteration, deterministic capture, a real QA catch. | workflow diagram, release-candidate frames, clean contact grid, QA before/after |
| PAYOFF | 2:11.40–2:31.20 | 7884–9071 | Back into the game: territory, monuments, the 7.2 s pull-back, the title. | clean reel c21–c25, end card |

Graphics announce and footage delivers, so the picture carries the film:

- Clean game footage, game captures and game evidence fill **119 s, about 79%** of the runtime.
- Text-and-diagram boards fill **32 s, about 21%**: two chapter cards, the route diagram, the code excerpt, the 7.2 s workflow diagram and the end card.

Nothing from the reel is reused out of its context. Act 2 is the reel's own escalation order, which is still the right order. Every other act uses material the reel never had.

**Why it is 2:31 and not longer.** The clean reel holds about 50 s of unique footage, and the brief bars stretching. The film runs as long as the narration and the breathing room need, and no longer.

## 3. Source policy (as executed)

- **Every reel frame is from `reel-clean`** (sha256 `f1150945…80d0`). The assembler checks this hash before it reads a frame.
- **The titled reel and titled loop are never sources.** They served only as the style reference for the ORBITAL RECORD record block, end card and timing grammar, which are re-rendered here at film frames.
- **The clean loop is not cut.** Every loop shot (c07, c09, c10, c15, c16, c19, c20) is taken from the clean reel at full rate.
- **Holds and pushes are new.** The titled reel's P1–P6 pushes are baked into titled frames, so they cannot be reused. c03, c04, c05 and the three captures get new perspective pushes (`platePushFilter`, never zoompan) on clean pictures.
- **No graphic sits on a baked ORBITAL RECORD graphic**, because none exists in the sources. Native game UI is footage and is never covered: c04, c05, c12, c13, c21 and the three HUD captures.

### New captures: 3 of 3 allowed

Each is an existing `capture/manifest.ts` shot, run unmodified through `capture/capture.spec.ts`. Nothing in `src/` changed. All three are pinned by hash in `capture/youtube/captures/captures.json`, and none had a page or console error.

| Capture | Narrative problem it solves |
|---|---|
| `title-screen` | Act 3 must show this is a live browser game, not an animation. The reel never shows the game's own entry screen. |
| `landing-site-panel` | The coordinate claim has to be visible. The game itself prints the selected site's latitude, longitude and altitude (5.490° N, 16.040° W, ALT 0 M). |
| `mining-laser-closeup` | Territory and construction: the reel has no mining or base economy at all. This frame shows the live outpost HUD with the robot's laser on a deposit, and it carries the zero-model-files claim. |

### Other repo evidence used as picture (all pre-existing, hash-pinned in the film JSON)

| Asset | Used for |
|---|---|
| `artifacts/recordings/counterstrike/counterstrike-success.webm` | A real phone-viewport interception (TRACKING → FIRE NOW → tap → INTERCEPTED), shown at its own 25 fps cadence |
| `artifacts/release-candidate/{baseline,final}/05,08,09,10` | Before/after iteration evidence, four pairs. The baseline is commit `d377cb5`. |
| `artifacts/reel-motion-review/c12-before-after.jpg` | The QA catch |

## 4. Complete timeline

Frames are film frames; a segment's last frame is inclusive. "Clean source" gives reel-clean frame numbers. A held frame is the reel's own hold frame repeated.

#### WORLD — 0:00.00–0:18.60 (frames 0–1115)

| # | Film frames | Time | Shot | Clean source | Picture | Graphics | Transition out | VO | Music |
|---|---|---|---|---|---|---|---|---|---|
| s01 | 0–251 | 0:00.00–0:04.20 | c01 | reel-clean 36–287 | The Moon swells out of black (the reel's own head fade, entered halfway). | **W1** YOU LANDED FIRST. | cut (reel adjacency c01→c02) | VO-A | drone-swell |
| s02 | 252–395 | 0:04.20–0:06.60 | c02 | reel-clean 288–431 | Touchdown: the amber ring blooms around your lander, then dips toward black. | none | baked dip to black (reel 415–431), hard cut to full-level Citadel (reel adjacency c02→c03) | VO-A | touchdown-thump |
| s03 | 396–575 | 0:06.60–0:09.60 | c03 | reel-clean 575 held ×180 · push FP1 | The Vesper Citadel, held on c03#143 (the reel's own hold frame), new slow push. | **W2** THEY LANDED ANYWAY. | cut | VO-A | rival-sting |
| s04 | 576–791 | 0:09.60–0:13.20 | c04 | reel-clean 719 held ×216 · push FP2 | Vesper's transmission card over the Citadel (native UI): "First is not ownership. Remove your extractor from my Moon." | none (native UI) | cut |  | transmission |
| s05 | 792–1115 | 0:13.20–0:18.60 | c05 | reel-clean 791 held ×324 · push FP3 | Launch authority dialog (native UI): LAUNCH AT NULL MERIDIAN? [CANCEL] [FIRE]. | none (native UI) | cut | VO-B | arm-tone |

#### ESCALATION — 0:18.60–0:43.80 (frames 1116–2627)

| # | Film frames | Time | Shot | Clean source | Picture | Graphics | Transition out | VO | Music |
|---|---|---|---|---|---|---|---|---|---|
| s06 | 1116–1151 | 0:18.60–0:19.20 | c06 | reel-clean 828–863 | Liftoff: the warhead punches up into frame. | none | cut (reel adjacency c06→c07) |  | launch-roar |
| s07 | 1152–1295 | 0:19.20–0:21.60 | c07 | reel-clean 864–1007 | HERO: the warhead crosses the lit limb. | none (protected: hero orbital flight) | cut |  | groove-opens |
| s08 | 1296–1439 | 0:21.60–0:24.00 | c08 | reel-clean 1008–1151 | Second angle: nose-down along the limb. | none | cut |  |  |
| s09 | 1440–1583 | 0:24.00–0:26.40 | c09 | reel-clean 1152–1295 | Terminal approach over the dark limb; the last 600 ms in silence. | **E1** TERMINAL APPROACH · FIRST STRIKE | baked white flash (reel 1291–1295 → c10 1296–1301, reel adjacency c09→c10) |  | descent-riser, silence-drop |
| s10 | 1584–1727 | 0:26.40–0:28.80 | c10 | reel-clean 1296–1439 | FIRST STRIKE IMPACT: amber dome over the shattered crater. | none (protected: First Strike impact) | cut |  | first-strike-impact |
| s11 | 1728–1907 | 0:28.80–0:31.80 | c11 | reel-clean 1440–1619 | Ejecta and shock ring; the crater darkens to debris. | none (protected: First Strike destruction) | cut |  |  |
| s12 | 1908–2015 | 0:31.80–0:33.60 | c12 | reel-clean 1620–1727 | FIRST STRIKE COMPLETE · THE MOON REMEMBERS (native card), fading to black. | none (native UI) | baked fade to black (reel 1693–1727, reel adjacency c12→c13) |  | breath |
| s13 | 2016–2087 | 0:33.60–0:34.80 | c13 | reel-clean 1728–1799 | VESPER COUNTERSTRIKE · FIRE NOW (native UI; c13 plus its c14 cover, one 1.2 s still). | none (native UI) | cut | VO-C | counterstrike-reversal |
| s14 | 2088–2159 | 0:34.80–0:36.00 | c15 | reel-clean 1800–1871 | The cyan-exhaust warhead dives onto your lander. | **E2** INCOMING · NULL MERIDIAN · COUNTERSTRIKE | baked white flash (reel 1867–1871 → c16 1872–1877, reel adjacency c15→c16) | VO-C |  |
| s15 | 2160–2303 | 0:36.00–0:38.40 | c16 | reel-clean 1872–2015 | COUNTERSTRIKE CONTACT: fireball, shock ring, debris rain. | none (protected: Counterstrike impact and destruction) | cut |  | counterstrike-impact |
| s16 | 2304–2447 | 0:38.40–0:40.80 | c17 | reel-clean 2016–2159 | The Octogonal lead locked in the game's reticle (c17 plus its c18 cover). | **E3** THIRD-PARTY CONTACT · THE OCTOGONALS | cut | VO-D | third-party |
| s17 | 2448–2555 | 0:40.80–0:42.60 | c19 | reel-clean 2160–2267 | Violet volley onto the Signal Array. | none (protected: Octogonal weapon exchange) | cut | VO-D | volley |
| s18 | 2556–2627 | 0:42.60–0:43.80 | c20 | reel-clean 2268–2339 | Your cyan defense beam lands; the lead breaks apart. | none (protected: surface-defense hit) | hard cut to black card | VO-D |  |

#### SYSTEMS — 0:43.80–1:27.00 (frames 2628–5219)

| # | Film frames | Time | Shot | Clean source | Picture | Graphics | Transition out | VO | Music |
|---|---|---|---|---|---|---|---|---|---|
| s19 | 2628–2771 | 0:43.80–0:46.20 | — | black | Chapter card on black. | **C1** UNDER THE SURFACE · SYSTEMS | hard cut | VO-E | systems |
| s20 | 2772–3167 | 0:46.20–0:52.80 | — | captures/title-screen.png · push FP4 | NEW CAPTURE 1: the live launch gate (current build, 1920x1080 HUD profile): SHOOT THE MOON · BEGIN INVASION · CLICK · DRAG · SCROLL TO ZOOM. | **S1** BROWSER-NATIVE · LIVE IN THE BROWSER · REACT · TYPESCRIPT · THREE.JS · REACT THREE FIBER | cut | VO-E |  |
| s21 | 3168–3671 | 0:52.80–1:01.20 | — | board: phone | Real phone-viewport recording (repo verification artifact): TRACKING → FIRE NOW → tap → INTERCEPTED. | **S2** PHONE VIEWPORT · LIVE INPUT · SAME GAME, SAME RULES · “TAP ONCE WHILE THE AMBER RINGS ALIGN” | cut | VO-F |  |
| s22 | 3672–4031 | 1:01.20–1:07.20 | — | captures/landing-site-panel.png · push FP5 | NEW CAPTURE 2: orbit view, SELECTED LANDING SITE panel: LATITUDE 5.490° N · LONGITUDE 16.040° W · MEAN SPHERE · ALT 0 M. | **S3**  | cut | VO-G |  |
| s23 | 4032–4679 | 1:07.20–1:18.00 | — | board: route | Route diagram on black, computed from the game's own route code. | **S4** FIRST STRIKE ROUTE · COMPUTED BETWEEN THE TWO SITES · YOU · {playerCoords}<br>route diagram | cut | VO-H | route |
| s24 | 4680–4895 | 1:18.00–1:21.60 | — | board: code | One code excerpt: STRIKE_ROUTE_SAFETY. | **S5** src/camera/strikeRoute.ts · lines 12–19 · 12 · export const STRIKE_ROUTE_SAFETY = Object.freeze({ | cut | VO-H |  |
| s25 | 4896–5219 | 1:21.60–1:27.00 | — | captures/mining-laser-closeup.png · push FP6 | NEW CAPTURE 3: the mining robot's laser on deposit beta, with the live outpost HUD (ore, energy, robots). | **S6** ZERO MODEL FILES · WRITTEN IN TYPESCRIPT · NO .GLB · .GLTF · .OBJ · .FBX IN THE REPOSITORY | hard cut to black card | VO-J |  |

#### BUILD — 1:27.00–2:11.40 (frames 5220–7883)

| # | Film frames | Time | Shot | Clean source | Picture | Graphics | Transition out | VO | Music |
|---|---|---|---|---|---|---|---|---|---|
| s26 | 5220–5363 | 1:27.00–1:29.40 | — | black | Chapter card on black. | **C2** HOW IT WAS MADE · THE BUILD | hard cut | VO-K | build |
| s27 | 5364–5795 | 1:29.40–1:36.60 | — | board: workflow | Build-record diagram on black. | **B1** BUILD RECORD · DIRECTION · IDEA · RULES · TREATMENTS<br>workflow connectors | cut | VO-K, VO-L |  |
| s28 | 5796–6947 | 1:36.60–1:55.80 | — | board: iteration | Release-candidate evidence, baseline vs final, four pairs (rival close, missile follow, impact, ejecta). | **B2** RELEASE-CANDIDATE PASS · BASELINE · d377cb5 · RELEASE CANDIDATE | cut | VO-L, VO-M | iteration |
| s29 | 6948–7379 | 1:55.80–2:03.00 | — | board: capture | Contact grid of 24 clean reel shots. | **B3** DETERMINISTIC CAPTURE · FRAME-STEPPED, THEN CHECKED · 3,456 REEL FRAMES · EACH MATCHED TO ITS PLANNED SOURCE<br>verification ticks | cut | VO-O |  |
| s30 | 7380–7883 | 2:03.00–2:11.40 | — | board: qa | QA before/after of the c12 capture (title screen ghosting, then recaptured). | **B4** QA · FIRST STRIKE COMPLETE CARD · BEFORE · TITLE SCREEN CAUGHT MID-FADE · AFTER · RECAPTURED | hard cut back to the game | VO-P |  |

#### PAYOFF — 2:11.40–2:31.20 (frames 7884–9071)

| # | Film frames | Time | Shot | Clean source | Picture | Graphics | Transition out | VO | Music |
|---|---|---|---|---|---|---|---|---|---|
| s31 | 7884–7991 | 2:11.40–2:13.20 | c21 | reel-clean 2340–2447 | Push into the Signal Array status card: TERRITORY CLAIMED · PERMANENT (native UI). | none (native UI) | cut | VO-Q | payoff |
| s32 | 7992–8099 | 2:13.20–2:15.00 | c22 | reel-clean 2448–2555 | Helios Spire; the mass driver fires. | **P1** TERRITORY MONUMENT · 1/4 / TERRITORY MONUMENT · 2/4 / TERRITORY MONUMENT · 3/4 / TERRITORY MONUMENT · 4/4 · HELIOS SPIRE / SIGNAL ARRAY / CRATER CROWN / BASTION ZIGGURAT | cut | VO-Q |  |
| s33 | 8100–8171 | 2:15.00–2:16.20 | c23 | reel-clean 2556–2627 | Signal Array vanes at full deployment. | **P1** TERRITORY MONUMENT · 1/4 / TERRITORY MONUMENT · 2/4 / TERRITORY MONUMENT · 3/4 / TERRITORY MONUMENT · 4/4 · HELIOS SPIRE / SIGNAL ARRAY / CRATER CROWN / BASTION ZIGGURAT | cut | VO-Q |  |
| s34 | 8172–8279 | 2:16.20–2:18.00 | c24 | reel-clean 2628–2735 | Crater Crown seated in the First Strike scar. | **P1** TERRITORY MONUMENT · 1/4 / TERRITORY MONUMENT · 2/4 / TERRITORY MONUMENT · 3/4 / TERRITORY MONUMENT · 4/4 · HELIOS SPIRE / SIGNAL ARRAY / CRATER CROWN / BASTION ZIGGURAT | cut | VO-Q |  |
| s35 | 8280–8711 | 2:18.00–2:25.20 | c25 | reel-clean 2736–3167 | One continuous pull-back from the Bastion Ziggurat to the claimed Moon. | **P1** TERRITORY MONUMENT · 1/4 / TERRITORY MONUMENT · 2/4 / TERRITORY MONUMENT · 3/4 / TERRITORY MONUMENT · 4/4 · HELIOS SPIRE / SIGNAL ARRAY / CRATER CROWN / BASTION ZIGGURAT | baked dip to black (reel 3133–3167) into the end card |  | pull-back, into-end-card |
| s36 | 8712–9071 | 2:25.20–2:31.20 | — | black | End card on black: SHOOT THE MOON lockup. | **END** SHOOT · THE · MOON | film end on the held lockup (no fade-out) |  | final-chord, last-frame |

### Transitions

- **Hard cuts throughout.** No crossfades.
- **The reel's baked transitions** are kept only where the film keeps the same two shots adjacent, and `validateFilm` enforces this:
  - the head fade, entered halfway
  - the c02 dip to black, then a hard cut to the Citadel
  - both white flashes, c09→c10 and c15→c16
  - the c12 fade to black
  - the c25 dip into the end card
- **Chapter cards are hard cuts to black and out.** That is the film's only new transition device.

## 5. Voiceover

**260 words**, written to be read by the author, and timed against the picture. Pace is 2.2–2.7 words/s, with silence on every impact and on the first 3.9 s.

Placeholder captions are not burned into the master. A temporary reference copy is produced only under `capture-final/youtube/qa/`.

| Line | Film frames | Time | Words | Pace | Text |
|---|---|---|---|---|---|
| VO-A | 234–474 | 0:03.90–0:07.90 | 10 | 2.49 w/s | Getting there first feels like it should count for something. |
| VO-B | 822–1110 | 0:13.70–0:18.50 | 11 | 2.28 w/s | It doesn't. So you decide how far you're willing to go. |
| VO-C | 2022–2118 | 0:33.70–0:35.30 | 4 | 2.47 w/s | Then it's their turn. |
| VO-D | 2316–2622 | 0:38.60–0:43.70 | 11 | 2.15 w/s | And while you're busy with each other, someone else shows up. |
| VO-E | 2646–3161 | 0:44.10–0:52.68 | 22 | 2.56 w/s | I wanted to make an original game about territory and escalation on the Moon — one you could open in a browser tab. |
| VO-F | 3186–3659 | 0:53.10–1:00.98 | 20 | 2.53 w/s | None of that was a cutscene. It's the game, running live — built for a phone as much as a desktop. |
| VO-G | 3690–4025 | 1:01.50–1:07.08 | 14 | 2.50 w/s | Every site is a real latitude and longitude on a lunar sphere, in metres. |
| VO-H | 4050–4889 | 1:07.50–1:21.48 | 34 | 2.43 w/s | When you fire, the missile flies a route computed between the two sites — a hundred and thirty-two degrees around the Moon — tested at two thousand and forty-eight points so it never clips the surface. |
| VO-J | 4914–5195 | 1:21.90–1:26.58 | 12 | 2.55 w/s | There isn't one imported 3D model. Every machine is written in TypeScript. |
| VO-K | 5238–5598 | 1:27.30–1:33.30 | 16 | 2.66 w/s | I didn't ask an AI to invent this. I had the game I wanted to make. |
| VO-L | 5616–6072 | 1:33.60–1:41.20 | 19 | 2.49 w/s | Claude and OpenAI's Codex let me iterate on it at a speed that changed what I could realistically attempt. |
| VO-M | 6090–6929 | 1:41.50–1:55.48 | 34 | 2.43 w/s | The first First Strike was a red rocket and a white disc. I wrote down what it should be instead — hard sunlight, blackened armour, damage that looks physical — and we iterated until it matched. |
| VO-O | 6966–7349 | 1:56.10–2:02.48 | 17 | 2.66 w/s | Every gameplay frame here was captured from the game itself, deterministically, and then checked frame by frame. |
| VO-P | 7398–7877 | 2:03.30–2:11.28 | 20 | 2.50 w/s | When one capture came back with the title screen bleeding through it, we fixed the capture instead of hiding it. |
| VO-Q | 7896–8273 | 2:11.60–2:17.88 | 16 | 2.54 w/s | What I'm proudest of isn't that a model wrote code. It's that you can play it. |

### Full script (as it will be read)

> **[0:03.9]** Getting there first feels like it should count for something.
>
> **[0:13.7]** It doesn't. So you decide how far you're willing to go.
>
> **[0:33.7]** Then it's their turn.
>
> **[0:38.6]** And while you're busy with each other, someone else shows up.
>
> **[0:44.1]** I wanted to make an original game about territory and escalation on the Moon — one you could open in a browser tab.
>
> **[0:53.1]** None of that was a cutscene. It's the game, running live — built for a phone as much as a desktop.
>
> **[1:01.5]** Every site is a real latitude and longitude on a lunar sphere, in metres.
>
> **[1:07.5]** When you fire, the missile flies a route computed between the two sites — a hundred and thirty-two degrees around the Moon — tested at two thousand and forty-eight points so it never clips the surface.
>
> **[1:21.9]** There isn't one imported 3D model. Every machine is written in TypeScript.
>
> **[1:27.3]** I didn't ask an AI to invent this. I had the game I wanted to make.
>
> **[1:33.6]** Claude and OpenAI's Codex let me iterate on it at a speed that changed what I could realistically attempt.
>
> **[1:41.5]** The first First Strike was a red rocket and a white disc. I wrote down what it should be instead — hard sunlight, blackened armour, damage that looks physical — and we iterated until it matched.
>
> **[1:56.1]** Every gameplay frame here was captured from the game itself, deterministically, and then checked frame by frame.
>
> **[2:03.3]** When one capture came back with the title screen bleeding through it, we fixed the capture instead of hiding it.
>
> **[2:11.6]** What I'm proudest of isn't that a model wrote code. It's that you can play it.
>
> *(the 7.2 s pull-back and the end card play with no narration)*

**Recording notes:**

- Read it conversationally.
- Each line's window is a ceiling, not a target. If a line runs short, leave the silence.
- Lines VO-H and VO-M carry dashes. Treat them as breaths.
- If you rephrase, keep every number exactly as written. Each one is checked against the code.

## 6. Graphics (ORBITAL RECORD, film edition)

**One system, unchanged.** It is the reel's tokens and grammar:

- **Type:** Saira and IBM Plex Mono, warm lunar white `#EDE8DF`.
- **Faction colours:** amber `#EFAD58` for you, cyan `#55C5CC` for Null Meridian, violet `#AA7ED8` for the Octogonals.
- **Motion:** chip, kicker, primary and rule; `cubic-bezier(0.22,1,0.36,1)` entrances; opacity-only exits; hard outs on picture cuts.
- **Content:** no boxes, no glow, no glitch, no fake telemetry.

**Two scale changes for YouTube:**

- **Record text is ~1.22× the reel's.** Primary 44 px, kicker and data 18 px, so the primary reads at 480 px playback. This is the loop treatment's proportion.
- **Chapter cards are new.** They use the end card's Saira wordmark voice at 96 px.

**The records:**

| Id | Where | Copy | Accent |
|---|---|---|---|
| W1 | c01 | YOU LANDED FIRST. | amber |
| W2 | c03 | THEY LANDED ANYWAY. | cyan |
| E1 | c09, clear 40 frames before the flash | TERMINAL APPROACH / FIRST STRIKE | amber |
| E2 | c15, clear before the flash | INCOMING · NULL MERIDIAN / COUNTERSTRIKE | cyan |
| E3 | c17, hard out on the cut | THIRD-PARTY CONTACT / THE OCTOGONALS | violet |
| C1, C2 | chapter cards | UNDER THE SURFACE / **SYSTEMS** · HOW IT WAS MADE / **THE BUILD** | — |
| S1 | title-screen capture | BROWSER-NATIVE / LIVE IN THE BROWSER / REACT · TYPESCRIPT · THREE.JS · REACT THREE FIBER | amber |
| S2 | phone board | PHONE VIEWPORT · LIVE INPUT / SAME GAME, SAME RULES / "TAP ONCE WHILE THE AMBER RINGS ALIGN" (the game's own copy) | cyan |
| S3 | landing-site capture | acquisition brackets on the game's own coordinate readout. No added text. | amber |
| S4 | route board | Computed at render time from the game code: YOU 14.209° N 39.190° W · NULL MERIDIAN 40.608° S 94.607° E · 132° · 760 KM · 24 KM · 2,048 | amber, cyan |
| S5 | code board | `src/camera/strikeRoute.ts` lines 12–19, verbatim (test-checked) | — |
| S6 | mining capture, lower right (clear of the native HUD) | ZERO MODEL FILES / WRITTEN IN TYPESCRIPT / NO .GLB · .GLTF · .OBJ · .FBX IN THE REPOSITORY | amber |
| B1 | workflow board (7.2 s; all five nodes up within 5 s) | DIRECTION → BUILD (CLAUDE · CODEX · CODESPACES) → ITERATE (SYSTEMS · VISUALS · BUGS) → CAPTURE → QA → repeat | amber |
| B2 | iteration board, four pairs: 05 rival close, 08 missile follow, 09 impact, 10 ejecta | BASELINE · d377cb5 / RELEASE CANDIDATE, with a VISUAL_DIRECTION.md quote | — |
| B3 | capture board | DETERMINISTIC CAPTURE / FRAME-STEPPED, THEN CHECKED / 3,456 REEL FRAMES · EACH MATCHED TO ITS PLANNED SOURCE | amber |
| B4 | QA board | BEFORE · TITLE SCREEN CAUGHT MID-FADE / AFTER · RECAPTURED, brackets on the ghost | amber |
| P1 | c22–c25 | TERRITORY MONUMENT 1/4–4/4: HELIOS SPIRE, SIGNAL ARRAY, CRATER CROWN, BASTION ZIGGURAT (approved E7 language) | amber |
| END | end card | SHOOT THE MOON lockup with the waxing crescent O / 1v1 LUNAR TERRITORY WARFARE / PLAY IT IN YOUR BROWSER / shootthemoon.pages.dev / ALL GAMEPLAY CAPTURED IN-GAME | — |

The model names (Claude, Codex) and Codespaces appear **once**, in 16 px mono, inside the workflow diagram.

## 7. Engineering claims and their evidence

Every claim is shown on screen when it is made.

| Claim | Shown in | Evidence |
|---|---|---|
| Runs live in a browser; React, TypeScript, Three.js, React Three Fiber. | s20 | package.json (react ^19.2.8, typescript ~6.0.2, three ^0.185.1, @react-three/fiber ^9.7.0); README.md "Technology"; capture/endCardFacts.ts; capture/youtube/captures/title-screen.png (CLICK · DRAG · SCROLL TO ZOOM) |
| Built for a phone as much as a desktop; same game and rules on a phone viewport with touch input. *Caveat: README: physical Android device acceptance (frame pacing, thermals) is still open. The film claims phone-first design, not device performance.* | s21 | artifacts/recordings/counterstrike/counterstrike-success.webm; capture/endCardFacts.ts "Mobile-first"; src/app/CounterstrikeHud.tsx ("TAP ONCE WHILE THE AMBER RINGS ALIGN") |
| Every site is a real latitude and longitude on a lunar sphere, in metres. | s22, s23 | src/domain/lunarCoordinates.ts (MEAN_LUNAR_DATUM 1,737,400 m; latitudeRad/longitudeRad/heightM); ARCHITECTURE.md "Coordinate model"; capture/youtube/captures/landing-site-panel.png (LATITUDE 5.490° N · LONGITUDE 16.040° W · MEAN SPHERE · ALT 0 M) |
| The missile flies a route computed between the two sites, 132° apart, peaking at 760 km, never below 24 km, tested at 2,048 points. | s23, s24 | src/camera/strikeRoute.ts (createStrikeRoute, STRIKE_ROUTE_SAFETY); src/camera/strikeRoute.test.ts (sampleMinimumStrikeClearanceM ≥ minimumClearanceM); src/domain/rival.ts (RIVAL_SITE_ANGULAR_SEPARATION_RAD = 132°, deriveRivalSite); e2e/firstStrikeFixtures.ts (canonical site 0.248 rad, -0.684 rad, 18 m = 14.209° N 39.190° W) |
| No imported 3D model files; every machine is written in TypeScript. | s25 | capture/endCardFacts.ts "Code-authored 3D — zero external model files"; find . -iname "*.glb" -o -iname "*.gltf" -o -iname "*.obj" -o -iname "*.fbx" \| grep -v node_modules → 0 results (re-run 2026-10-04); src/scene/*Model.ts |
| Frontier models (Claude, OpenAI Codex) used as collaborators in a Codespaces-based workflow, directed by the author. | s27 | author statement (brief for this film); README.md (Codespaces preview instructions); docs/SHOOT_THE_MOON_MOTION_CHAMPIONSHIP_HANDOFF.md (two model treatments, resolved direction, implementation brief) |
| The First Strike went from a red rocket and a white disc to the physical, directed look by iterating against a written visual contract. | s28 | artifacts/release-candidate/README.md (baseline at d377cb5 vs release-candidate final); artifacts/release-candidate/{baseline,final}/05-rival-close.png, 08-missile-follow.png, 09-impact.png, 10-ejecta.png; VISUAL_DIRECTION.md |
| All gameplay was captured deterministically from the game and checked frame by frame. | s29 | capture/README.md "Frame stepping" and Phase 6 (each output frame matched to its planned source); capture/runner.ts (frame counter must advance; never silently duplicates); capture/ci/assembly.ts (frame-by-frame verification) |
| A capture with the title screen ghosting through the FIRST STRIKE COMPLETE card was caught and recaptured rather than hidden. | s30 | artifacts/reel-motion-review/c12-before-after.jpg; capture/ci/reelRelease.json c12Correction; capture/README.md (dismissLaunchGate waits for the gate fade; c12 recaptured) |

## 8. Protected visual moments

No graphics are drawn on these frames, and `validateFilm` checks every one. The impact segments also carry no narration.

| Film frames | Time | Why |
|---|---|---|
| 0–17 | 0:00.00–0:00.30 | film head: the reel's head fade is still near-black |
| 378–395 | 0:06.30–0:06.60 | c02 dip to black before the c03 hard cut |
| 1152–1295 | 0:19.20–0:21.60 | hero orbital flight (protected) |
| 1578–1907 | 0:26.30–0:31.80 | First Strike white flash, impact and destruction |
| 1908–2087 | 0:31.80–0:34.80 | native FIRST STRIKE COMPLETE card, its fade to black, and the native FIRE NOW UI |
| 2154–2303 | 0:35.90–0:38.40 | Counterstrike white flash, impact and destruction |
| 2448–2627 | 0:40.80–0:43.80 | Octogonal weapon exchange and the surface-defense hit (native reticle) |
| 7884–7991 | 2:11.40–2:13.20 | native Signal Array status card |
| 8676–8711 | 2:24.60–2:25.20 | c25 dip to black before the end card |

## 9. Music markers (for the final track)

There is no music and no audio in this pass, because no verified game audio exists. The film is cut on the 100 BPM grid. Every cut sits on a beat (36 frames), and both impacts land exactly on bar lines (bars 12 and 16). The music brief is in §10.

| Frame | Time | Bar.beat (+frames) | Kind | Label | Note |
|---|---|---|---|---|---|
| 0 | 0:00.00 | 1.1 | riser | drone-swell | Low drone and air under the cold open. No percussion. The first five seconds work in silence too. |
| 252 | 0:04.20 | 2.4 | impact | touchdown-thump | First percussion with the touchdown ring (bar 2, beat 4 grid). |
| 396 | 0:06.60 | 3.4 | sting | rival-sting | Rival motif enters on the hard cut to the Citadel: cold, minor, cyan. |
| 576 | 0:09.60 | 5.1 | duck | transmission | Music ducks under Vesper's card; let the line read. |
| 792 | 0:13.20 | 6.3 | downbeat | arm-tone | Decision: a single sustained tone under VO-B. Hold tension, no groove yet. |
| 1116 | 0:18.60 | 8.4 | impact | launch-roar | Launch. Kick on every beat from here. |
| 1152 | 0:19.20 | 9.1 | downbeat | groove-opens | Full groove under the hero shot. |
| 1440 | 0:24.00 | 11.1 | riser | descent-riser | Riser through the terminal approach. |
| 1548 | 0:25.80 | 11.4 | drop | silence-drop | Hard cut to silence for 600 ms before the flash (as the reel). |
| 1584 | 0:26.40 | 12.1 | impact | first-strike-impact | FIRST STRIKE: sub drop and boom exactly on the white-flash cut. |
| 1908 | 0:31.80 | 14.2 | drop | breath | Thin to a single pad under THE MOON REMEMBERS; fade with the picture. |
| 2016 | 0:33.60 | 15.1 | reversal | counterstrike-reversal | Alarm stab on FIRE NOW; rival motif returns, inverted. |
| 2160 | 0:36.00 | 16.1 | impact | counterstrike-impact | Second impact on the flash cut. Bigger low end than the first. |
| 2304 | 0:38.40 | 17.1 | sting | third-party | New colour for the Octogonals (violet): an outside interval. |
| 2448 | 0:40.80 | 18.1 | downbeat | volley | Escalation peak; cut everything on the hard cut to the SYSTEMS card. |
| 2628 | 0:43.80 | 19.2 | transition | systems | Near-silence for the card, then a sparse pulse at 100 BPM under the narration. Leave room for the voice. |
| 4032 | 1:07.20 | 29.1 | lift | route | A slow lift under the route diagram; resolve as the code excerpt lands. |
| 5220 | 1:27.00 | 37.2 | transition | build | Strip back again for the BUILD card. Warmer, more personal colour. |
| 5796 | 1:36.60 | 41.2 | bed | iteration | Gentle rhythmic bed under the before/after; one accent per pair swap (every 288 frames = 2 bars). |
| 7884 | 2:11.40 | 55.4 | return | payoff | Back to the full theme on the hard cut into the game. |
| 8280 | 2:18.00 | 58.3 | swell | pull-back | Sustain/peak through the pull-back. The whole pull-back is unnarrated: the music carries it. |
| 8676 | 2:24.60 | 61.2 | dip | into-end-card | Begin the resolve on the dip to black. |
| 8712 | 2:25.20 | 61.3 | resolve | final-chord | Final chord as SHOOT THE MOON builds; ring out on the held lockup. |
| 9071 | 2:31.18 | 63.4 (+35) | end | last-frame | Last frame (9071). No fade-out in picture. |

## 10. Music brief

- **Length and tempo:** 2:31.20 exactly (9,072 frames), 100 BPM, 63 bars, 4/4.
- **The two hard sync points:**
  - First Strike impact at **0:26.40** (frame 1584)
  - Counterstrike impact at **0:36.00** (frame 2160)
- **The three structural drops, where everything thins:**
  - SYSTEMS card at **0:43.80**
  - BUILD card at **1:27.00**
  - the return to the game at **2:11.40**
- **Character:**
  - **World:** cold, sparse and lunar, opening from a drone. A cyan rival motif lands on the Citadel cut (0:06.60).
  - **Escalation:**
    - The groove opens at the hero shot (0:19.20).
    - A riser runs into a 600 ms silence before the first impact (0:25.80).
    - Each impact gets a sub drop and boom on the white flash.
    - The rival motif returns inverted at the counterstrike (0:33.60).
    - The Octogonals get a violet colour, an outside interval (0:38.40).
  - **Systems and Build:** narration beds. A pulse at 100 BPM, low density, nothing in the voice's band. Small accents on board changes: the route lift at 1:07.20 and its draw-on at 1:08.70, and the before/after swaps every two bars from 1:36.60.
  - **Payoff:**
    - The full theme returns at 2:11.40.
    - It sustains through the pull-back, which is unnarrated (narration ends at 2:17.88).
    - It resolves on the dip to black (2:24.60).
    - A final chord as the wordmark builds (2:25.20), ringing out on the held last frame.
- **Mix:** -14 LUFS integrated, -1 dBTP (the reel's `heroReel.audio` target). Leave headroom under the voice: duck about 8 dB during narration.
- **Licensing:** original or properly licensed only. No copyrighted music.

## 11. Thumbnails

There are three 1280×720 candidates. Each is a single cinematic frame from the clean reel with the approved SHOOT / THE / MOON wordmark and crescent, and no other copy.

| # | Frame | Composition |
|---|---|---|
| 01 | reel-clean 936 (c07, the poster frame) | Warhead crossing the lit limb; wordmark on the black right third. |
| 02 | reel-clean 1145 (c08) | The warhead nose-down and vertical beside the limb; wordmark on the black right. |
| 03 | reel-clean 1840 (c15) | The cyan-exhaust counterstrike warhead diving on your lander; wordmark top-left over the navy sky. |

None has arrows, circles, faces, logos, "I MADE THIS" or clickbait type.

## 12. Review pass on the rendered first cut

The first render was watched in full: per-act contact strips at 1 and 2 frames per second, every graphic at 1080p and at 480×270, plus the QA decode. Six objective problems were fixed, with no structural redesign:

1. **The workflow board held for 12 s with a single word on screen for its first 4.5 s.** It now runs 7.2 s, with all five nodes up inside 5 s. The 4.8 s freed went to a fourth real before/after pair (05, rival close), which VO-L now plays over.
2. **The payoff had under 4 s of unnarrated gameplay.** VO-Q now ends with the monuments, so the whole 7.2 s pull-back and the end card breathe.
3. **Three graphics crossed the 40 px safe frame:** the coordinate brackets' entrance, the mining record's tracking settle and the iteration footnote. All three were moved.
4. **The code excerpt was too small at 480 px playback.** It went from 30 px to 36 px.
5. **The QA range check was wrong.** The approved clean reel itself carries super-black/white (3,344 of its 3,456 frames go below Y 16). Levels are now judged on the lossless pre-encode picture:
   - unpushed reel frames must carry their source's exact Y range, and all of them do;
   - pushed and generated frames must sit inside 16–235;
   - card black must be exactly 16.
6. **Pushed pictures rang outside legal range.** The perspective push resamples after the conversion to limited range, so lanczos/cubic ringing on thin UI text reached Y 0–255 on the three HUD captures and Y 247 on the c05 dialog hold. Every pushed picture (the three captures and the c03, c04 and c05 holds) is now clamped to BT.709 legal range after the push. Unpushed reel frames still carry their source levels exactly.

**Left as judged:** the 5.4 s launch-dialog hold (0:13.2–0:18.6). It carries VO-B and the decision beat, and it is a candidate to trim once real narration timing exists.

## 13. What this first cut deliberately does not do

- It does not synthesize a narrator, invent music, or fake sound effects. The master is silent.
- It does not show AI chat or plaster model names. One workflow diagram carries them.
- It does not claim device performance on phones. The README records that physical Android acceptance is still open, so the film claims phone-first design only.
- It does not include a case-study URL. None exists in the repository yet, so the end card holds the game URL only.
