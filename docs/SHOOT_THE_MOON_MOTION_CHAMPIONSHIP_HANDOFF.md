# Shoot the Moon Reel — Motion Graphics Championship Handoff

**Purpose:** Give Codex Sol 6.1 Max one self-contained brief containing both creative-director treatments, the resolved direction, and the implementation constraints for the final motion-graphics pass.

## Project facts

- Reel: 57.6 seconds
- Resolution: 1920×1080
- Frame rate: 60 fps
- Total frames: 3,456
- Audio: none yet
- Edit grid: 100 BPM / 24 bars / 300 ms cut grid
- Implementation repo: `mataindustries/shootthemoon`
- Portfolio repo: `mataindustries/digital-ziggurat`

---

# TREATMENT A — OPUS 5.5

## Concept: ORBITAL RECORD

The reel is the Moon's record of the campaign: who arrived, who fired, where it landed, and what was built.

Two governing rules:

1. **Graphics announce. Footage delivers.** Text sets up a moment and clears before the impact, flash, dip, or destruction beat.
2. **Every number is true.** Coordinates, clocks, counts, faction names, and feature names come from the game itself. No decorative telemetry.

### Core diagnosis

- The reel is already cut to a clean 100 BPM grid and is music-ready.
- The biggest pacing problem is **six seconds of frozen imagery from 7.2–13.2 s**, exactly when Vesper enters.
- The premise is not clear early enough.
- Four monuments and the third faction pass by too quickly to register.
- The current illustrated end card is the only image not captured in-game and visually breaks the reel's promise.
- One footage defect exists at 27.0 s: the FIRST STRIKE COMPLETE card has the title screen ghosting through it.

## Opus's eight selected interventions

| # | Time | Moment | Treatment |
|---|---|---|---|
| 1 | 52.80–57.60 | End card | Text-only end card on black. The crescent “O” waxes during the final build. |
| 2 | 7.20–9.58 | Rival contact | Brackets acquire the Citadel command tower, `VESPER LANDED ANYWAY.` appears, and the held footage receives a smooth push. |
| 3 | 19.20–21.48 | Terminal approach | `TIME TO IMPACT` countdown reaches `00.00` six frames before the white flash. |
| 4 | 0.60–2.38 | Cold open | `YOU LANDED FIRST.` |
| 5 | 40.80–47.38 | Monument montage | Roll-call from 1/4 to 4/4, one monument name per cut. |
| 6 | 13.20–14.40 | Launch | `FIRST STRIKE` with a running T+ clock and real target coordinates. |
| 7 | 33.60–36.00 | Third faction reveal | `THE OCTOGONALS` / `DIVIDER RAID` using the faction's own radio language. |
| 8 | 30.00–31.08 | Counterstrike | Mirror of the launch layout, with faction colour and target reversed. |

### Opus copy deck

```text
YOU LANDED FIRST.

CONTACT · NULL MERIDIAN
VESPER LANDED ANYWAY.
40.608° S   94.607° E

LAUNCH   T+00.00
FIRST STRIKE
TARGET   40.608° S   94.607° E

TIME TO IMPACT
00.99 → 00.00

INCOMING · NULL MERIDIAN
COUNTERSTRIKE
TARGET   14.209° N   39.190° W

CONTACT · THE OCTOGONALS
DIVIDER RAID
WAVE 1/3 — “UNREGISTERED STRUCTURE DETECTED.”

TERRITORY MONUMENT · 1/4
HELIOS SPIRE
FUSION REACTOR + LUNAR MASS DRIVER

TERRITORY MONUMENT · 2/4
SIGNAL ARRAY
+50% RIVAL SCAN SPEED

TERRITORY MONUMENT · 3/4
CRATER CROWN
BUILT INTO THE FIRST STRIKE SCAR

TERRITORY MONUMENT · 4/4
BASTION ZIGGURAT
EVERY STEP A WALL
```

## Opus visual system

### Typography

Use **Saira** for readable cinematic titles and **IBM Plex Mono** for telemetry/data.

- Primary narrative/chapter line: Saira, technical but not generic sci-fi.
- Kicker/data: IBM Plex Mono.
- Warm lunar white rather than pure white.
- Accents use the game's own colours:
  - amber = player
  - cyan = Null Meridian
  - violet = Octogonals
- No persistent HUD.
- No boxes/panels behind text.
- No glitch, chromatic aberration, scanlines, radar sweeps, rotating rings, decorative crosshairs, typewriter effects, or fake numbers.
- One graphic block at a time.
- Gameplay remains dominant.

### Record-block language

```text
■ KICKER · SOURCE
PRIMARY LINE
────────
DATA LINE
```

Entries occupy a consistent lower-left record position. Missing rows leave their slot empty so the system does not jump around.

### Transition language

- Existing reel cuts/fades/flashes stay locked.
- Graphics add **no new edit transitions**.
- Entrances use restrained opacity/tracking settles, short line draws, and bracket contraction.
- Exits either cut with the shot or fade completely clear before an impact/flash/dip.
- No movement on exit.
- Monument swaps happen directly on picture cuts.

## Opus plate pushes

Every frozen interval receives a subtle, linear sub-pixel push:

| ID | Frames | Time | Scale |
|---|---|---|---|
| P1 | f432–575 | 7.20–9.58 | 1.000 → 1.040 |
| P2 | f576–719 | 9.60–11.98 | 1.000 → 1.020 |
| P3 | f720–791 | 12.00–13.18 | 1.000 → 1.012 |
| P4 | f1620–1727 | 27.00–28.78 | 1.000 → 1.015 |
| P5 | f1728–1799 | 28.80–29.98 | 1.000 → 1.015 |
| P6 | f2088–2159 | 34.80–35.98 | 1.000 → 1.020 |

**Important technical finding:** ffmpeg `zoompan` visibly stair-stepped every 3–4 frames. Opus tested a `perspective`-based transform instead, which produced smooth uniform per-frame motion. Use the perspective approach, not zoompan.

## Opus end-card direction

Replace the illustrated key art inside the reel with a black typographic card using the same restrained visual system:

```text
SHOOT
THE
MOON

1v1 LUNAR TERRITORY WARFARE

PLAY IN YOUR BROWSER
shootthemoon.pages.dev

ALL FOOTAGE CAPTURED IN-GAME
```

The second O in `MOON` becomes a waxing crescent. Final frame holds the fully formed lockup. No fade-out.

Keep the illustrated key art for poster/store/portfolio artwork rather than inside the in-game reel.

## Opus protected moments

Keep these clean:

- touchdown ring
- Vesper transmission UI
- launch authority dialog
- hero orbital flight
- both main impacts
- ejecta/destruction
- FIRE NOW UI
- surface-defense weapon exchange
- Signal Array status card
- most of the final pullback

### Opus footage fix

At 27.0–28.8 s, the FIRST STRIKE COMPLETE capture contains the title screen ghosting through the translucent card.

Fix the capture itself. Do not hide it with graphics.

Likely cause: capture occurs before the LaunchGate closing opacity transition has fully completed.

---

# TREATMENT B — ASTRA

Astra's treatment is deliberately more restrained: **seven interventions**, with approximately **70% of the reel before the title left free of added graphics**.

## Astra's seven selected moments

| Time | Moment | Exact added copy | Treatment |
|---|---|---|---|
| 00.60–03.30 | Moon approach | `01 / ARRIVAL` / `YOU LANDED FIRST.` | Compact upper-left lockup. Establish ownership while the Moon supplies scale. |
| 07.50–09.40 | Rival installation | `02 / CONTACT` / `VESPER LANDED ANYWAY.` | Same composition, with one muted cyan accent. Clear before Vesper's existing dialogue appears. |
| 14.70–16.70 | Orbital missile profile | `03 / OFFENSIVE` / `FIRST STRIKE` | Introduce after viewers have located the missile. Leave its trajectory unobstructed. |
| 34.00–36.20 | Surface defense | `04 / DEFENSE` / `HOLD YOUR GROUND` | Orient viewers before the busiest beam exchange, then disappear. |
| 41.10–45.40 | Monument montage | `05 / TERRITORY` / `MAKE YOUR CLAIM` | One continuous label across three structures. No repeated entrances at the cuts. |
| 49.00–51.60 | Orbital pullback | `NEITHER INTENDS TO SHARE.` | Main line only. Complete the opening premise, then leave space before the title. |
| 52.80–57.60 | Existing end card | Preserve existing title/subtitle/footer | Astra preferred retaining the artwork and wordmark, while improving footer legibility and the destination entrance. |

## Astra audit decisions across the reel

### 00.00–04.80 — Moon approach
- Strong atmosphere.
- Lacks a premise in silence.
- Add G01 opening statement.
- Final ~1.5 s stays clean.

### 04.80–07.20 — Amber outpost
- Machinery silhouette and expanding ground ring already provide interest.
- Keep clean.
- Let the industrial design register.

### 07.20–09.60 — Rival installation
- Clear visual contrast.
- Allegiance needs context.
- G02 identifies the narrative turn.

### 09.60–12.00 — Vesper transmission
- Character and player agency are already expressed through native UI.
- Keep clean.
- Let the existing dialogue own the reading budget.

### 12.00–13.20 — Launch confirmation
- FIRE supplies the anticipation.
- Shot is brief.
- Keep clean.
- No added countdown.

### 13.20–14.40 — Surface departure
- Rapid orientation change as projectile enters view.
- Keep clean.
- Let viewers locate it.

### 14.40–16.80 — Orbital missile profile
- Strong hero view with room for a short label.
- G03 names the action once established.

### 16.80–19.20 — Alternate missile tracking
- Camera changes already create momentum.
- Keep clean.
- Preserve continuous flight.

### 19.20–~21.52 — Terminal approach
- Small projectile and negative space create tension.
- Keep clean.
- Keep attention on the moving object.

### ~21.52–24.00 — First impact
- Native white flash and crater reveal are already forceful.
- Keep clean.
- No extra flash, shake, or impact headline.

### 24.00–27.00 — Destruction aftermath
- Debris and irregular damage demonstrate consequences.
- Keep clean.
- Allow the fragments to remain the detail viewers inspect.

### 27.00–28.80 — Strike result
- FIRST STRIKE COMPLETE already supplies punctuation.
- Keep clean.
- Avoid repeating the result.

### 28.80–30.00 — Intercept prompt
- FIRE NOW and timing marks communicate urgency.
- Keep clean.
- Preserve the real interaction.

### 30.00–33.60 — Counterstrike
- Incoming warhead and nearby destruction reverse the threat.
- Keep clean through impact and debris.

### 33.60–39.00 — Surface defense
- More mechanics appear.
- Opening benefits from orientation.
- Use G04, removed before the later weapon exchange.

### 39.00–40.80 — Territory confirmation
- Actual UI establishes permanent ownership.
- Fine print is dense.
- Keep clean.
- Treat it as evidence, followed by a concise chapter label.

### 40.80–42.60 — Linear monument
- Distinct silhouette starts the showcase.
- Introduce G05.

### 42.60–43.80 — Dish monument
- Quick visual variation.
- Carry G05 unchanged across the cut.

### 43.80–45.60 — Circular monument
- Broadens the sense of strategic choice.
- Continue G05; clear by 45.40.

### 45.60–52.20 — Tower and pullback
- Natural deceleration and return to lunar scale.
- Begin clean.
- G06 supplies the closing thought.

### 52.20–52.80 — Fade through black
- Useful breath before branding.
- Preserve existing fade.

### 52.80–57.60 — Title card
- Strong composition.
- Small, widely tracked URL loses readability.
- Astra's G07 improves the footer while preserving the identity.

No cut warrants removal according to Astra's review.

## Astra design system

### 1. Opening
- Preserve existing fade.
- Begin G01 at 00.60.
- Reveal over ~0.30 s.
- Hold for ~2.20 s.
- Fade over ~0.20 s.
- Leave roughly 03.30–04.80 completely clean.
- The Moon's movement provides the spectacle.

### 2. Typography
- Main lines: **Inter Medium 500**
- Main size: **48 px**
- Line height: **58 px**
- Tracking: **1.2 px**
- Colour: off-white `#EEF0EB`
- Chapter indices: **IBM Plex Mono Regular 400**
- Chapter index size: **24 px**
- Chapter index line height: **30 px**
- Tracking: **1.5 px**
- At 1080p, main text begins around x96 / y142.
- Index sits around x96 / y102.
- Preserve the existing title wordmark.

### 3. Telemetry language
One 48×3 px horizontal rule, monospaced chapter indexing, and disciplined alignment supply the aerospace character.

Accent colours:
- amber `#C48A6A`
- cyan `#4898BC`

Astra explicitly rejects:
- HUD boxes
- scanning
- fabricated coordinates
- additional targeting graphics

### 4. Chapter labels
Fixed sequence:

```text
ARRIVAL
CONTACT
OFFENSIVE
DEFENSE
TERRITORY
```

Each appears once.

Labels remain fixed to the screen.

The territory label alone bridges cuts.

Do not add mining or construction chapters. The reel does not show those processes clearly enough.

### 5. Transitions
- Retain source cuts and fades.
- Chapter entrances combine a small 8 px upward settle, opacity fade, and short rule reveal.
- Holds are motionless.
- Exits are opacity-only.
- No additional transitions between gameplay shots.

### 6. Impact treatments
- Launch receives a delayed label.
- Discovery receives one cyan accent.
- Defense receives a brief objective statement.
- Destruction receives **no added effects**.
- Existing flashes, crater growth, shields, and debris already provide the strongest punctuation.

### 7. End card
Astra preferred retaining:
- existing lunar artwork
- diagonal warhead
- crescent wordmark
- subtitle

Then improving the footer:
- cover the old footer using a black gradient confined to the bottom of the card
- render one replacement URL at 44 px, centered beneath the wordmark
- fade it in near the end and hold through the final frame
- no additional logo animation
- no final fade-out

### 8. Rhythm for later music
Gameplay events remain fixed.

Future music should follow:
- launch
- impacts
- retaliation
- defense
- territory reveal

The silent version should use short entrances, stable reading holds, and long clean passages.

Caption starts may later shift by at most six frames where their readable holds and protected shot boundaries remain intact.

## Astra implementation spec

- Composite over the existing MP4 at **1920×1080, constant 60 fps, exactly 3,456 frames**.
- Output frame f uses source frame f.
- Implement three components:
  - `ChapterLockup`
  - `ClosingStatement`
  - `EndCardFooter`
- Use the supplied cue JSON as timing authority.
- Sample animation directly from frame number.
- Use cubic ease-out for chapter entrances.
- Linear opacity exits.
- No wall-clock animation.
- No randomness.
- Bundle the specified fonts locally.
- Preserve exact copy, capitalization, punctuation, and positions.
- No wrapping or automatic font substitution.
- Keep added graphics absent during dialogue, confirmation, result, intercept, and territory panels, and throughout both destruction sequences.
- Preserve the baked title.
- Astra's footer matte begins at frame 3168.
- Its replacement URL begins at frame 3210 and holds through frame 3455.
- Export H.264 MP4, Rec.709 consistent with source, yuv420p, CRF 17–18, fast-start metadata, 57.600 seconds, silent.
- Deliver titled composition and manifest alongside the original.
- Verify:
  - cue boundaries
  - montage continuity
  - single-URL replacement
  - readability at 1080p, 540p, and 480×270
- Original reel and site reference remain untouched.

---

# RESOLVED CHAMPIONSHIP DIRECTION

## Primary treatment

**Opus 5.5 is the primary creative and technical treatment.**

Use:
- `ORBITAL RECORD`
- real in-world telemetry
- rival acquisition brackets
- FIRST STRIKE launch record
- TIME TO IMPACT countdown
- smooth perspective-based plate pushes
- monument identification
- Octogonals introduction
- counterstrike mirror
- text-only/game-native final title card
- protected flash/dip/fade intervals
- tested sub-pixel motion approach

## Steal these ideas from Astra

### 1. Narrative hierarchy

Use Astra's chapter progression as the organizational grammar:

```text
ARRIVAL
CONTACT
OFFENSIVE
DEFENSE
TERRITORY
```

This does **not** require displaying every chapter label. Use it to keep the graphic system coherent.

### 2. Closing line

Use, if the timing works cleanly before the title:

```text
NEITHER INTENDS TO SHARE.
```

It should complete the opening premise and clear before the final branding build.

### 3. Restraint rule

Adopt Astra's strictest rule:

> Do not decorate the reel simply because a graphic could fit.

Keep extra graphics absent from:
- major impacts
- destruction
- dialogue-heavy UI
- confirmation/result panels
- intercept prompts
- dense game UI
- the strongest hero imagery

Gameplay is the star.

---

# SOL 6.1 MAX IMPLEMENTATION DIRECTIVE

You are implementing the final Shoot the Moon motion-graphics reel.

Do not mechanically merge both treatments.

**Opus is primary. Astra supplies narrative hierarchy, the closing line, and stricter restraint.**

Before changing code:

1. Inspect the existing reel generation pipeline.
2. Verify 57.6 s / 1920×1080 / 60 fps / 3,456 frames.
3. Verify every flash, fade, dip, cut, and protected interval.
4. Inspect the existing title/end-card pipeline.
5. Print a concise FINAL CUE PLAN.
6. Identify any conflict between this handoff and the current repo.
7. Stop and report only if a conflict makes the treatment unsafe to implement.

Then implement.

## Non-negotiable requirements

- Work on a fresh implementation branch.
- Preserve the existing text-free/clean reel.
- Produce a separate titled/motion-graphics reel.
- Do not change gameplay.
- Do not change the locked edit.
- Do not change source clip timing.
- Use deterministic frame-based animation.
- No wall-clock animation.
- No random animation.
- Bundle exact fonts locally.
- Centralize animation timing so music can be synchronized later.
- Use the tested **perspective** method for held-frame pushes.
- Do **not** use zoompan for the slow pushes.
- No added music yet.
- Do not commit or push until the complete reel has been rendered and reviewed.

## QA

Check the entire render for:

- exact frame count
- cue boundaries
- protected intervals
- flash/dip/fade integrity
- text legibility
- clipping
- typography consistency
- smoothness of all plate pushes
- stair-stepping
- animation frame pacing
- title-safe margins
- end-card timing
- stale key-art/title elements under the new end card
- obstruction of native game UI
- readability at 1080p, 540p, and approximately 480×270

Compare the final render frame-by-frame against the clean reel and report every intentional class of changed frames.

## Completion report

Return:

- final rendered preview path
- clean reel path
- exact files changed
- final cue summary
- QA results
- deviations from this treatment, if any, and why
- `git diff`
- `git status`

**STOP BEFORE COMMITTING.**
