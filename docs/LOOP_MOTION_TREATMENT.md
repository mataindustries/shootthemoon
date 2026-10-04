# LOOP MOTION TREATMENT: ORBITAL RECORD, loop edition

**Deliverable:** the 13.8 s silent portfolio / Digital Ziggurat loop (`loop-13s-1280.mp4`).
**Status:** audit and plan only. Nothing here has been implemented.
**Implementer:** Sol 6.1 Max.
**System:** ORBITAL RECORD, unchanged. Same fonts, tokens, record block, conventions and perspective push as `capture/titles/reel-titles.cues.json`. Only the scale and the timing are the loop's own.

Units used throughout:
- **f** is a 0-based loop frame at 30 fps. Frame f is shown at f/30 s.
- Pixel values are **1280×720 delivered pixels**.
- Opacity, fade, track and draw semantics are exactly the reel cue sheet's `conventions`.

---

## 1. Diagnosis

The audited file: `7cb84b23-loop-13s-1280.mp4`, sha256 `9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864`.
- H.264 High, yuv420p, BT.709 limited range, 1280×720, 30/1 fps.
- **414 frames, 13.800 s.** Video only: no audio stream.
- It matches `finalEdit.json → derivatives.loop` (`c07 c09 c10 c15 c16 c19 c20`, decimated from 60 to 30 fps). Every cut lands on the edit's 300 ms grid (multiples of 9 frames).

1. **The cut is already good.** It has seven shots, two native white-flash impacts, and it ends on a payoff. It needs naming, not editing.
2. **The premise is invisible in silence.** The loop tells the game's whole pitch: *you strike → they strike back → a third power arrives.* None of that is legible without words.
   - The counterstrike warhead has the same silhouette as yours (only the exhaust colour differs), so it reads as "another missile".
   - The Octogonals arrive with no establishing shot (the reel's c17/c18 are not in the loop), so they read as "some ships".
3. **There is a dead zone at 2.4–4.7 s (S2).** It is 70 frames of near-black (mean luma 1.6–2.3 / 255) with a ~150 px warhead in the middle.
   - At a 480 px embed this reads as a black gap straight after the hero shot.
   - It is also the cleanest text plate in the loop: luma 1–10 under the record block.
4. **The final 3.0 s is a locked-off game camera.** S6 and S7 share one static camera: the background differs by ≤ 0.14 luma across all 90 frames.
   - This follows the most kinetic shot in the loop, so the ending reads as raw capture.
   - It also makes the loop seam a cut from a dead-still camera into a moving one.
5. **The seam is a clean hard cut** (f413 → f0, mean abs luma change 40.9). It has no fade and works as an edit. Protect it.
6. **There is no screen-space HUD anywhere.** Every loop clip is `hud:false`. The only native graphics are world-space (listed in §2).

**Treatment in one line:** three record entries, one per faction colour (amber, cyan, violet), each living inside the one shot it names, plus one plate push on the locked-off ending. About 72% of the loop stays untouched.

Corrections to the brief's approximate structure:
- Impact is 4.73–7.20 s (not 5–7.5).
- The counterstrike runs 7.20–10.80 s (not 7.5–11.5).
- Defense / Octogonal contact runs 10.80–13.80 s (not 11.5).

---

## 2. Exact shot map

| Shot | Frames | Time (s) | Clip / shot | What is on screen | Camera | Character |
|---|---|---|---|---|---|---|
| **S1** | 0–71 | 0.000–2.367 | c07 `first-strike-orbital-flight` | Hero shot: your warhead (amber trail) crosses the lit limb. The right half is black space. At the record-block rows the limb edge sweeps from x 750 to x 365. | moving | strongest image; loop restart |
| **S2** | 72–141 | 2.400–4.700 | c09 `first-strike-target-approach` | Near-black. The warhead sits centre (x 468–717, y 198–420). A dark limb with a thin blue rim rises from the bottom. A 1.2× creeping push is baked into the source. The edit plays the last 600 ms (f126–143) "in silence". | slow push (baked in) | **weakest image; best text plate** |
| FLASH-1 | 142–146 | 4.733–4.867 | white flash c09→c10 | Luma 86 → 171 → **255 (f144 = cut)** → 199 → 143 | — | protected |
| **S3** | 147–215 | 4.900–7.167 | c10 `first-strike-impact-flash` | Amber impact dome over the shattered crater. The dome fades (mean luma 88 → 37). f147–150 are four near-identical frames (the flash landing). | locked, content animates | **impact** |
| **S4** | 216–249 | 7.200–8.300 | c15 `counterstrike-terminal-dive` | The Null Meridian warhead (cyan exhaust) dives on your lander. The lander and turret sit at x 420–800 (its left edge creeps from 441 to 420). The ground is flat for x < 420. | tilting (horizon y 463 → 425) | short (34 f) |
| FLASH-2 | 250–254 | 8.333–8.467 | white flash c15→c16 | Luma 105 → 179 → **255 (f252 = cut)** → 185 → 119 | — | protected |
| **S5** | 255–323 | 8.500–10.767 | c16 `counterstrike-impact-contact` | Fireball beside the lander, then debris spray, shock ring, and debris rain filling the sky. | drifting (horizon y 240 → 226) | **destruction** |
| **S6** | 324–377 | 10.800–12.567 | c19 `divider-weapon-volley` | Octogonal craft (top centre) fire violet beams onto the Signal Array (x 510–705, y 322–611). Volley pulses at f324, 328–333, 339–345, 351–354. The craft exit at the top over f357–371. f372–377 is an empty, near-frozen tail. | **locked** | third-party contact |
| **S7** | 378–413 | 12.600–13.800 | c20 `divider-defense-interaction` | Your cyan defense beam and hit bubble (f378–386), then the cyan octagonal reticle around the breaking lead (f387–413, top centre, inside x 660–910, y 20–280). | **locked (same as S6)** | **impact / destruction; loop tail** |

- **Editorial cuts:** 72, 144 (under flash), 216, 252 (under flash), 324, 378, and 414 ≡ 0 (the seam). I-frames sit at 0, 72, 145, 216, 253 and 324.
- **Held / static segments:**
  - S2 is a near-black hold, though the speck moves.
  - f147–150 is a micro-hold after FLASH-1.
  - f372–377 is a micro-hold (empty tail).
  - **S6 + S7 (f324–413) is a fully locked camera.**
- **Native (world-space) graphics:**
  - gold trim outlines on both warheads (S1–S4)
  - violet weapon beams (S6)
  - cyan defense beam and hit bubble (S7, f378–386)
  - cyan octagonal target reticle (S7, f387–413)
  - None of these may be covered.
- **Empty areas in the record zone** (lower left, x 64–462, y 545–636):
  - S2: pure black, luma 1–10. **Best.**
  - S4: flat ground, luma mean 50–54, p95 63. Clear of the lander by ≥ 25 px.
  - S6: flat regolith, luma mean 78, p95 89, σ 7. Clear of the array and beams by ≥ 58 px.
  - S1: unusable (the limb edge sweeps through the zone).
  - S3, S5, S7: protected.

```
f      0         72         144        216  252        324        378   413|0
shot   |---S1 hero---|---S2 approach---|F|---S3 impact---|S4|F|--S5 contact--|---S6 volley---|-S7 hit-|
gfx    ............[ L1 81-125 ]......................[L2]........................[ L3 333-377 ]........
push                                                                          [ LP1 324 ------------ 413 ]
```

---

## 3. Recommended final cue list

There are three record entries and one plate push. **That is the whole intervention.**

| ID | Frames (alpha > 0) | Time | Kicker | Primary | Accent |
|---|---|---|---|---|---|
| **L1** | 81–125 | 2.700–4.167 s | `TERMINAL APPROACH` | `FIRST STRIKE` | amber |
| **L2** | 216–242 | 7.200–8.067 s | `HOSTILE TERMINAL APPROACH` | `COUNTERSTRIKE` | cyan |
| **L3** | 333–377 | 11.100–12.567 s | `CONTACT` | `THE OCTOGONALS` | violet |
| **LP1** | 324–413 | 10.800–13.800 s | plate push 1.000 → 1.025 | — | — |

- **Graphics on screen:** 117 of 414 frames (28%).
- **Clean stretches:** 90 f (126–215), 90 f (243–332), and **117 f across the seam** (378–413 plus 0–80).

### Considered and rejected

- **FIRST STRIKE on S1.** The limb edge sweeps through the record zone, S1 is the hero image, and it is the loop restart.
- **A TIME TO IMPACT countdown on S2** (the reel's E4). A running number gets re-read on every pass, and it belongs to the timecode family the brief bans.
- **DEFENSE / INTERCEPT ACTIVE on S7.**
  - S7 is an impact, a destruction beat, and the loop tail.
  - A cyan-accented label there would read as Null Meridian.
  - `INTERCEPT ACTIVE` is the game's copy for an intercept the loop never shows: the counterstrike lands.
- **HOLD YOUR GROUND.** ORBITAL RECORD speaks in records and names, not commands. An imperative every 13.8 s nags. The final reel did not adopt it either.
- **`DIVIDER RAID` as the L3 primary.** It is accurate game jargon, but it means nothing to a portfolio viewer. `THE OCTOGONALS` is the name worth learning.

### Per-intervention detail

#### L1: FIRST STRIKE (amber)

- **Timestamp:** 2.700–4.167 s
- **Frame range:** 81–125. It clears at 126, exactly where the edit's own 600 ms silence before the drop begins.
- **What the viewer sees:** black space. A small warhead with an amber trail descends at centre while a dark limb rises from below.
- **Why it needs help:**
  - This is the weakest 2.3 s of the loop: a black gap after the hero shot, with no hint of what is coming.
  - It is the one moment where words cost the footage nothing.
- **Copy:**
  - kicker `TERMINAL APPROACH`. This is the game's own phase label, from `FirstStrikeHud`'s `TARGET FOOTHOLD · TERMINAL APPROACH`, for exactly this phase.
  - primary `FIRST STRIKE`.
- **Accent:** amber `#EFAD58`. It is yours, and it matches the warhead trail on screen.
- **Placement:** record block, lower left (§6). Ink box x 64–339, y 555–626. The warhead stays ≥ 120 px above and right of it.
- **Entrance:**
  - f81: chip and kicker fade in over 5 f, and the rule draws left to right over 5 f.
  - f86: the primary fades in over 5 f while its tracking settles 0.24 → 0.16 em over 9 f.
- **Hold:** f94–121. Nothing moves.
- **Exit:** all elements fade out together, opacity only, over 5 f from f122. Alpha is 0 from f126.
- **Why it survives 10 repeats:**
  - It is two words in a corner, on black, and it never moves once settled.
  - It leaves 16 clean frames before FLASH-1, so the flash always lands on a clean frame.
  - It names the action; it does not explain it.

#### L2: COUNTERSTRIKE (cyan)

- **Timestamp:** 7.200–8.067 s
- **Frame range:** 216–242. It enters on the S4 cut and is clear at 243, leaving 7 clean frames before FLASH-2 begins at 250 and 9 before the cut at 252.
- **What the viewer sees:** a black/gold warhead with cyan exhaust dives out of a navy sky onto your lander.
- **Why it needs help:**
  - The reversal is the game's 1v1 premise, and without a word it reads as a repeat of the first missile.
  - S4 lasts only 34 frames, so the record has to arrive with the picture.
- **Copy:**
  - kicker `HOSTILE TERMINAL APPROACH`. This is the game's own string (`CounterstrikeHud`) for this exact phase. It mirrors L1: one added word turns the record around.
  - primary `COUNTERSTRIKE`.
- **Accent:** cyan `#55C5CC`. It is Null Meridian's, and it matches the warhead's exhaust on screen.
- **Placement:** record block. Ink box x 64–395 (max 424 during the tracking settle).
  - The lander's left edge is at x 441 → 423 over these frames, so clearance is ≥ 25 px on every frame.
  - **This is the constraint that caps the primary size at 30 px** (§6).
- **Entrance:**
  - f216: chip, kicker and rule (fade 5 / draw 5).
  - f221: the primary fades in over 5 f, with a 9 f tracking settle.
- **Hold:** f229–238.
- **Exit:** all elements fade out together over 5 f from f239. Alpha is 0 from f243.
- **Why it survives 10 repeats:**
  - It is the shortest cue (0.9 s).
  - It rhymes with L1: the same kicker grammar plus `HOSTILE`, and STRIKE → COUNTERSTRIKE. On repeat it reads as a known beat, not new information.
  - The impact after it is always clean.

#### L3: THE OCTOGONALS (violet)

- **Timestamp:** 11.100–12.567 s
- **Frame range:** 333–377. It enters 9 f after the S6 cut (the first volley pulse plays clean) and hard-cuts out with the picture at 378.
- **What the viewer sees:** eight-sided craft over the lunar horizon firing violet beams onto your Signal Array, then leaving frame.
- **Why it needs help:**
  - A third faction appears with no establishing shot and no name.
  - The escalation from 1v1 to three-way is the hook, and it is lost without the name.
- **Copy:**
  - kicker `CONTACT`. This is the reel's word for a faction's first sighting (E2, E6).
  - primary `THE OCTOGONALS`. This is the game's faction name (`src/content/octogonals.ts`).
- **Accent:** violet `#AA7ED8`. It is the Octogonals', and it matches the weapon fire on screen.
- **Placement:** record block. Ink box x 64–421 (max 452 during the settle). The array, beams and craft never come left of x 508, so clearance is ≥ 58 px.
- **Entrance:**
  - f333: chip, kicker and rule.
  - f338: the primary, with fade and tracking settle as L1.
- **Hold:** f346–377. It covers the craft's exit and the empty tail.
- **Exit:** **hard out at f378**, on the picture cut. This follows the reel convention: `out {f}` with no fade when the exit coincides with a cut. The cut to the bright defense hit masks the disappearance.
- **Why it survives 10 repeats:**
  - It completes a fixed amber → cyan → violet triptych, so the repetition becomes rhythm.
  - The cut takes it away and the loop ends on 36 clean frames. The seam always arrives on pure footage.

#### LP1: plate push on the locked-off ending

See §10.

---

## 4. Exact frame ranges

| | First frame with alpha > 0 | Primary first frame | Primary fully opaque | Out begins | Last frame with alpha > 0 | Alpha = 0 from |
|---|---|---|---|---|---|---|
| L1 | 81 | 86 | 90 | 122 (fade 5) | 125 | 126 |
| L2 | 216 | 221 | 225 | 239 (fade 5) | 242 | 243 |
| L3 | 333 | 338 | 342 | 378 (hard) | 377 | 378 |
| LP1 | plate frames 324–413, linear scale | | | | | |

- **Entrances on the 9-frame (300 ms) grid:** 81, 216, 333.
- **Clears on the grid:** 126, 243, 378.

---

## 5. Exact copy

Copy is uppercase, with no terminal punctuation and no middle-dot compounds (not `CONTACT · THE OCTOGONALS`).

| ID | Kicker (IBM Plex Mono) | Primary (Saira) |
|---|---|---|
| L1 | `TERMINAL APPROACH` | `FIRST STRIKE` |
| L2 | `HOSTILE TERMINAL APPROACH` | `COUNTERSTRIKE` |
| L3 | `CONTACT` | `THE OCTOGONALS` |

The loop has no data row, coordinates, clock, counter, closing line or end card.

---

## 6. Typography / placement

**The loop's record block is the reel's record block at 5/6 scale in 1280×720 pixels.** That is 1.25× its proportional size: the reel's proportional size at 720p is 2/3, and the loop uses 5/6.
- The left margin and the primary baseline keep the reel's proportions: 6.25% of width and 84.3% of height.
- Why 5/6: at the reel's proportional size (24 px) the primary is borderline at a 400 px embed. At 32 px, `COUNTERSTRIKE` touches the S4 lander. **30 px is the largest size that clears it.**

| Element | Spec (1280×720) |
|---|---|
| Anchor | x = **80** (glyph start) |
| Chip | 7×7 px square, x **64–70**, y **556–562**, faction fill, opacity 1, no shadow |
| Kicker | IBM Plex Mono **Medium 500**, **13 px**, tracking 0.16 em, ink `#EDE8DF` @ **0.76**, uppercase, lift shadow, **baseline y = 564** |
| Primary | **Saira VF wdth 110 wght 500**, **30 px**, tracking 0.16 em (entry 0.24 em), ink `#EDE8DF` @ **0.96**, uppercase, lift shadow, **baseline y = 607** |
| Rule | 60×2 px, x **80–139**, y **624–625**, ink @ **0.50**, no shadow |
| Data row | none. The slot stays empty and nothing shifts. |
| Lift shadow | text only: drop shadow (0,0) σ 0.5 rgba(0,0,0,.55) + (0,1) σ 5 rgba(0,0,0,.45). Same recipe as the reel, at 5/6. Never a glow. |
| Title envelope | No title alpha, including shadow, outside **x 64–462, y 545–636** on any frame |

Measured ink widths at 30 px, final / entry tracking:
- `FIRST STRIKE` 259 / 285
- `COUNTERSTRIKE` 315 / 344
- `THE OCTOGONALS` 341 / 372

Kicker widths at 13 px:
- `TERMINAL APPROACH` 166
- `HOSTILE TERMINAL APPROACH` 245
- `CONTACT` 67

If Sol authors on the reel's 1920×1080 stage, multiply every position and size above by **1.5** (fractional px are fine in SVG). Then Lanczos-downscale the alpha track to 1280×720. The delivered geometry must match this table within ±0.5 px.

---

## 7. Accent-color choices

Each accent appears **only in the 7 px chip**, once per entry. Text is always ink.

| Entry | Accent | Why it is semantically true |
|---|---|---|
| L1 | amber `#EFAD58` | the player; matches your warhead's amber trail in S1/S2 |
| L2 | cyan `#55C5CC` | Null Meridian; matches the counterstrike warhead's cyan exhaust in S4 |
| L3 | violet `#AA7ED8` | the Octogonals; matches their violet weapon fire in S6 |

Note: your own defense beam and target reticle in S7 are cyan (the game's defense UI colour). No graphic touches S7, so there is no semantic clash. Do not add a cyan cue there.

---

## 8. Entrance / exit timing

All three entries use one grammar, the reel's, at 30 fps:

| Step | Frames | Rule |
|---|---|---|
| Chip + kicker | t0, fade **5** | opacity = ease((k+1)/5), ease = out `cubic-bezier(0.22,1,0.36,1)` |
| Rule | t0, draw **5** | scaleX 0 → 1 from the left end, ease out; opacity constant 0.50 |
| Primary | t0 + **5**, fade **5** | same fade |
| Primary tracking | t0 + 5, **9** f | letter-spacing 0.24 → 0.16 em, ease out |
| Hold | — | **no motion of any kind** |
| Exit (L1, L2) | fade **5**, all elements together | opacity only: 1 − ease((k+1)/5) |
| Exit (L3) | **hard**, at the picture cut f378 | not drawn from f378 |

- **Fade timing:** 5 f ≈ 167 ms, the 30 fps equivalent of the reel's 9 f @ 60.
- **Tracking settle:** 9 f = 300 ms, equal to the reel's 18 f @ 60.
- **Not used in the loop:** brackets, line swaps, counters, the segmented rule.

---

## 9. Protected no-graphics ranges

Title alpha must be **exactly 0** on all of these frames:

| Range | Moment | Reason |
|---|---|---|
| **0–80** | S1 hero orbital flight; loop restart | Strongest image. The limb edge sweeps the record zone. The seam must land on pure footage. |
| **126–141** | S2 last 600 ms | The edit's own silence before the drop. The warhead alone. |
| **142–146** | FLASH-1 | White flash (First Strike) |
| **147–215** | S3 First Strike impact / crater | Major impact; the footage delivers |
| **243–249** | S4 terminal frames | The warhead's last frames before contact |
| **250–254** | FLASH-2 | White flash (Counterstrike) |
| **255–323** | S5 counterstrike contact | Explosion, debris, destruction |
| **324–332** | S6 first violet pulse | The faction is seen before it is named |
| **378–413** | S7 defense hit (378–386), reticle and breakup (387–413), loop tail | Impact, destruction, and native HUD reticle. The last 36 frames of the loop. |

The **only** frames that may carry graphics are **81–125, 216–242 and 333–377**.

---

## 10. Plate-push recommendation

#### LP1: locked-off ending

- **Timestamp:** 10.800–13.800 s
- **Frame range:** 324–413 (90 f, across the S6 → S7 cut)
- **What the viewer sees:** a static game camera over the Signal Array while the volley and then the defense hit play out. The background is identical across all 90 frames (≤ 0.14 luma mean diff).
- **Why it needs help:** this is the only truly locked camera in the loop. A push fixes three things at once:
  1. The last 3 s stop reading as raw capture.
  2. The S6/S7 jump cut (same camera, time skip) is bound into one continuous move.
  3. The seam becomes a **cut on motion** into S1, which itself moves at ~2.4 luma/frame. Today it is a cut from a dead-still frame into motion.
- **Transform:**
  - Scale **1.000 at f324 → 1.025 at f413**, linear: s(f) = 1 + 0.025·(f − 324)/89.
  - Anchor **(640, 360)**, the frame centre, as in the reel's P1–P6.
- **Method:** the reel's perspective push.
  - Use `platePushFilter()` with width/height 1280×720: 2× upsample, then `perspective` with cubic interpolation, `eval=frame`, `sense=source`, and the `(on-1)` one-based counter.
  - **Never `zoompan`.**
- **Rate:** 0.83%/s. This is identical to the reel's calm pushes P2 and P4, so the loop's only camera move matches the reel's.
- **Compositing:** titles are composited **after** the push and stay screen-fixed. L3 rides over the pushed plate.
- **Headroom:** the top of the reticle sits at y ≈ 24 at f413 and maps to y ≈ 16 at 1.025, so nothing native leaves frame. Edge displacement is ≤ 16 px at 1280 (≤ 6 px at a 480 px embed). It is felt, not seen.
- **Why it survives 10 repeats:** it is a slow, constant drift with no ease and no return. It never resolves into a "move", so there is nothing to notice on repeat. It only removes the static camera.

**No other push:**
- S2 already contains a 1.2× creeping push.
- S3 is not held: the dome animates on every frame. Its 4-frame micro-hold (147–150) is the flash landing.
- S4 and S5 already move (horizon drift).
- S1 moves.

---

## 11. Loop-boundary rules

1. The last **36 frames (378–413)** and the first **81 frames (0–80)** carry zero title alpha. That is 3.9 s of clean footage around the seam, well beyond the 10–15 frame minimum.
2. **No fade at the seam.** The source has a hard cut (f413 → f0). Keep it.
3. LP1 ends at 1.025 on f413 and **does not ease out or return to 1.0**. A return would read as a rewind. The cut to S1, a different shot, resets the scale naturally.
4. Output is exactly 414 frames, pts 0 … 413/30. There must be no duplicated or dropped frame at either end. The first frame stays an IDR (closed GOP).
5. Future music note: the loop is **23 beats at 100 BPM (5¾ bars)**. Any music bed must loop at exactly 13.800 s. Cue entrances already sit on the 300 ms grid.

---

## 12. Mobile readability notes

The block was tested by rendering it onto real frames f110, f236 and f355 and downscaling (scratch proof, not delivered).

| Element | At 1280 | Cap / stroke @ 600 px wide | @ 480 | @ 400 | Verdict |
|---|---|---|---|---|---|
| Primary (Saira 30) | cap 20.6 px | 9.7 px | 7.7 px | 6.4 px | **Reads at all three.** 400 px is the floor. |
| Kicker (Plex 13) | cap 9.1 px | 4.3 | 3.4 | 2.8 | Becomes texture at ≤ 480. Intended. |
| Chip (7 px) | 7 px | 3.3 | 2.6 | 2.2 | Stays a colour tick and carries the faction at any size |
| Rule (2 px) | 2 px | 0.9 | 0.75 | 0.6 | May vanish at ≤ 480. Acceptable. |

- **Contrast under the primary**, before the shadow:
  - L1 on black: luma 1–10.
  - L2 on ground: mean 50–54, p95 63.
  - L3 on regolith: mean 78, p95 89.
  - Ink is ≈ luma 232, so contrast is ≥ 5.7 : 1 even on the brightest regolith.
- At the reel's proportional size (24 px) the primary's cap is 6.2 px at 480 and 5.2 px at 400, which is borderline. Hence the 5/6 scale.
- Do not raise the weight or size further. Below ~400 px wide, treat the loop as picture-only; do not enlarge the type for that case.

---

## 13. Implementation spec for Sol 6.1 Max

1. **Source.**
   - **Preferred:** insert the push and titles into the loop's own assembly path (`planLoop` / `loopFilterGraph`: after decimate and `deliveryScale`, push, titles, then `loopOutputArgs`). This avoids re-encoding the delivered H.264.
   - **Fallback:** finish over the delivered clean loop (sha256 above). Decode it to a lossless 4:4:4 working file first, as `finishTitledReel.mjs` does.
2. **Outputs.**
   - New file: `loop-13s-1280-titled.mp4`.
   - **The clean loop stays unchanged** and remains a deliverable.
   - Do not edit `derivatives.loop.note` ("No HUD, no text"); it still describes the clean loop. Record the titled loop in its own manifest.
3. **Cue authority.** Create a new `capture/titles/loop-titles.cues.json` in the same schema and conventions as `reel-titles.cues.json`:
   - source: 1280×720, 30 fps, 414 frames
   - `tempo.framesPerGrid` 9
   - colour tokens identical
   - styles and layout per §6
   - `forbidden` per §9
   - `plateMoves` [LP1]
   - events L1–L3 per §4 and §8
   - chapters as metadata only: L1 and L2 OFFENSIVE, L3 DEFENSE
   - Leave the reel cue file untouched.
4. **Renderer.**
   - Reuse `sceneAt()`, `overlay.html` and `renderTitles.mjs`.
   - Make the stage size and grid come from `cues.source` and `cues.tempo` rather than hard-coded 1920×1080 at 60 fps. Alternatively, author at ×1.5 and downscale the track (§6).
   - Determinism is unchanged: frame-sampled, no clocks, no randomness, bundled fonts.
5. **Push.** `platePushFilter(LP1, 1280, 720)` as is. Titles go on after the push.
6. **Encode.**
   - Use `loopOutputArgs(edit)`: the web-reel x264 settings at 30 fps, `-an`.
   - Output: 414 frames, BT.709 limited-range tags, `+faststart`, ≤ 8 MB (`loopMaxBytes`).
7. **QA (report every item).**
   - ffprobe: 1280×720, 30/1, 414 frames, 13.800 s, no audio, yuv420p BT.709 tv.
   - Decoded title alpha = 0 on every frame in §9. Report the max alpha per range.
   - Title alpha only inside the envelope x 64–462, y 545–636.
   - Frames outside 81–125, 216–242 and 324–413 match the clean loop within the loop fidelity tolerance (4 levels, 64×36 luma). Report flash frames 142–146 and 250–254 separately.
   - LP1:
     - Measured scale is 1.000 at f324 and 1.025 at f413 (±0.001).
     - Smoothness: render LP1 over a frozen lossless f324 and require consecutive-frame motion to be uniform (max/min step ratio ≤ 2.0, no stair-step). The reel's P1, P3 and P6 failed this measure; do not repeat that.
   - Clearance: glyph ink never within 24 px of lander pixels (f216–242; measured minimum 25.7 px at f221) or array, beam or craft pixels (f333–377). The shadow never touches them.
   - Readability: export f110, f236 and f355 at 600, 480 and 400 px wide. The primary must read in all nine.
   - Seam: a contact strip of f404–413 + f0–9 shows zero title alpha and no fade.
   - Watch it loop ≥ 10 times in `<video muted loop playsinline autoplay>` at 480 px wide. Report anything that draws attention on repeat.

---

## 14. DO NOT ADD

- Data rows, coordinates, `TARGET` lines, T+ clocks, countdowns, timecode, frame counters
- Any graphic on S1, S3, S5 or S7, on the flash frames, or in the last 36 frames
- A DEFENSE, INTERCEPT, HOLD YOUR GROUND or any other fourth cue
- Brackets, reticles, crosshairs or target boxes (S7 already has the game's own)
- Accent colour on text, rules or anything except the 7 px chip
- Persistent chip, rule, border, vignette, letterbox or watermark
- Logo, wordmark, URL, title card, end card, closing line
- A second plate push, `zoompan`, shake, added flashes, speed ramps, fades at the seam
- Glow, glitch, scanlines, chromatic aberration, typewriter, scramble, per-letter animation
- Movement during holds or exits
- Size or weight bumps beyond §6
- Any change to the clean loop, the locked edit, or the reel's cue file

---

## FINAL IMPLEMENTATION CUE SHEET

```
LOOP      1280x720  30fps  414f (f0..f413)  silent  hard-cut seam f413->f0
SRC       loop-13s-1280.mp4  sha256 9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864
OUT       loop-13s-1280-titled.mp4 (clean loop untouched)
GRID      9f = 300ms; entrances on 9f lines
EASE      out = cubic-bezier(0.22,1,0.36,1); fades per reel conventions

ALPHA>0   ONLY f81-125, f216-242, f333-377      (alpha==0 everywhere else)
ENVELOPE  title alpha (incl. shadow) only in x64-462 y545-636

BLOCK     chip 7x7 x64 y556 | kicker PlexMono500 13px trk.16em ink@.76 x80 base564
          primary Saira wdth110 wght500 30px trk.16em ink@.96 x80 base607
          rule 60x2 x80 y624 ink@.50 | shadow (text only): 0,0 s0.5 .55 + 0,1 s5 .45
INK       #EDE8DF   AMBER #EFAD58   CYAN #55C5CC   VIOLET #AA7ED8

L1 amber  "TERMINAL APPROACH" / "FIRST STRIKE"
          chip+kicker in f81 fade5 | rule draw f81 n5 L->R | primary in f86 fade5, track .24->.16 f86 n9
          out f122 fade5 (alpha 0 from f126)
L2 cyan   "HOSTILE TERMINAL APPROACH" / "COUNTERSTRIKE"
          chip+kicker in f216 fade5 | rule draw f216 n5 | primary in f221 fade5, track f221 n9
          out f239 fade5 (alpha 0 from f243)
L3 violet "CONTACT" / "THE OCTOGONALS"
          chip+kicker in f333 fade5 | rule draw f333 n5 | primary in f338 fade5, track f338 n9
          out HARD f378 (picture cut)

LP1       plate f324-413 scale 1.000->1.025 linear anchor (640,360)
          perspective on 2x upsample, cubic, eval=frame, (on-1); never zoompan; titles composited after

FLASH     f142-146, f250-254  untouched
ENCODE    loopOutputArgs (x264 web settings @30fps, -an), BT.709 tv, +faststart, <=8MB, 414f exact
```
