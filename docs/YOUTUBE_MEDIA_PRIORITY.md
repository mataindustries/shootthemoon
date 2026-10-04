# YOUTUBE FILM: MEDIA PRIORITY

**Applies to:** every shot evaluation, timeline decision and footage pick for the YouTube film.
**Machine-readable register:** `capture/youtube/media-sources.json`.
**Enforcement:** `capture/youtube/mediaPriority.ts`, tested by `mediaPriority.test.ts`.
**Status:** the source policy and footage evaluation are locked. The YouTube timeline itself still needs the film's brief (§9).

---

## 1. The rule

| Media | Role | Used for |
|---|---|---|
| 57.6 s clean reel | **PRIMARY CLEAN SOURCE** | evaluating shots, building the YouTube timeline, picking reusable footage |
| 13.8 s clean loop | **PRIMARY CLEAN SOURCE** | the same. Its frames are all clean-reel frames, so cut the reel (§2.3) |
| 57.6 s titled reel | **CREATIVE REFERENCE** | the approved ORBITAL RECORD motion language only |
| 13.8 s titled loop | **CREATIVE REFERENCE** | the approved ORBITAL RECORD motion language only |

1. Footage comes from the clean versions. A titled file is never a timeline source.
2. No existing title has to stay baked into the YouTube edit.
3. A shot picked while watching a titled version is cut from the matching clean frames (§3). Only graphics written for the new film are then applied.
4. New graphics are never stacked over existing ORBITAL RECORD graphics. Cutting clean frames makes this impossible.

---

## 2. Media register

> **Both loops were supplied under the same name, `loop-13s-1280.mp4`.** Identify every file by sha256, never by its name.

| ID | Role | Canonical name | Uploaded as | sha256 | Format |
|---|---|---|---|---|---|
| `reel-clean` | primary clean | `reel-57s-1080-clean.mp4` | `dcc898d9-reel-57s-1080-clean.mp4` | `f1150945eb5356f4260351622201edc14d982ac1baaab804091ab1d8c74680d0` | 1920×1080, 60 fps, 3,456 f, 57.600 s |
| `loop-clean` | primary clean | `loop-13s-1280.mp4` | `dfb27dd1-loop-13s-1280.mp4` | `9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864` | 1280×720, 30 fps, 414 f, 13.800 s |
| `reel-titled` | creative reference | `reel-57s-1080.mp4` | `f9f601ad-reel-57s-1080.mp4` | `a523e35c53b76043bbad9bfd277f666a99c0ecbab4c79c4acdbe98500ee7b188` | 1920×1080, 60 fps, 3,456 f, 57.600 s |
| `loop-titled` | creative reference | `loop-13s-1280-titled.mp4` | `5b9b4d15-loop-13s-1280.mp4` | `f83d2b82c5ef3f41de226da0f30f1588b46a439443c073d8410ff73e01c3a1a4` | 1280×720, 30 fps, 414 f, 13.800 s |

All four files are H.264 High, yuv420p, BT.709 limited range, with no audio stream.

### 2.1 How the roles were verified

- **The clean loop** has the sha256 that `docs/LOOP_MOTION_TREATMENT.md` audited and that `capture/titles/assembleTitledLoop.mjs` pins.
- **The titled reel differs from the clean reel only inside the reel cue sheet's events and pushes.** Every decoded frame was compared at 480×270 (pixels differing by more than 24 levels). Measured differing spans:
  - 36–137, 432–575, 579–719, 731–863, 1152–1289, 1623–1724, 1730–1859, 2016–2159, 2448–2837, 2952–3089, 3168–3455
  - Every one falls inside an E or P window of `reel-titled.cues.json`. Elsewhere the median difference is 0.28 levels, which is encode noise.
- **The titled loop differs from the clean loop only inside L1–L3 and LP1.** Measured at full resolution:
  - title envelope: 81–123, 216–239, 333–377
  - LP1 push, outside the envelope: 339–413
  - Every span falls inside a window of `loop-titled.cues.json`.
- The test pins these measured spans and fails if a cue sheet ever stops covering them.

### 2.2 Spans where titled and clean frames match

Outside every cue window, the titled and clean frames are identical apart from encode noise:

- reel: 0–35, 143–431, 864–1151, 1290–1619, 1865–2015, 2160–2447, 2843–2951, 3095–3167
- loop: 0–80, 126–215, 243–323

The policy still applies here: **cut the clean file**. Matching pixels today are not a reason to put a titled file on the timeline.

### 2.3 The clean loop is a subset of the clean reel

Every clean-loop frame is a clean-reel frame: every second frame, scaled from 1920 to 1280. Mean differences against the clean reel are 0.08–0.53 levels per shot, including both flashes.

| Loop frames | Clip | Clean-reel frames |
|---|---|---|
| 0–71 | c07 orbital flight | 864–1007 |
| 72–143 | c09 target approach | 1152–1295 |
| 144–215 | c10 impact flash | 1296–1439 |
| 216–251 | c15 terminal dive | 1800–1871 |
| 252–323 | c16 impact contact | 1872–2015 |
| 324–377 | c19 weapon volley | 2160–2267 |
| 378–413 | c20 defense hit | 2268–2339 |

Loop frame *k* in a shot is reel frame `reelStart + 2·(k − loopStart)`. The loop holds no picture the reel lacks, and the reel has twice the frame rate and 1.5× the resolution. **Cut every loop shot from the clean reel.** `resolveCleanSource` does the mapping.

The clean loop's own value is editorial: it is the proven 13.8 s compression of the premise (strike → counterstrike → third power).

---

## 3. What the titled versions bake in, and where the clean frames are

"Graphics" means ORBITAL RECORD records. "Push" means a perspective plate push. Several titled spans carry **only a push, with no text**: P2–P5 and LP1 after 377. They look clean but are not.

### 3.1 Titled reel → clean reel (same frame numbers)

| Titled | Frames | Baked into the titled frames | Clean frames to cut |
|---|---|---|---|
| E1 | 36–142 | `YOU LANDED FIRST.` | 36–142 (c01) |
| E2 + P1 | 432–575 | acquisition brackets on the Citadel; `CONTACT · NULL MERIDIAN` / `VESPER LANDED ANYWAY.` / `40.608° S 94.607° E`; push 1.000 → 1.040 | 432–575 (c03 hold, no push) |
| P2 | 576–719 | push 1.000 → 1.020; no text | 576–719 (c04 hold) |
| P3 | 720–791 | push 1.000 → 1.012; no text | 720–791 (c05) |
| E3 | 792–863 | `LAUNCH T+` clock / `FIRST STRIKE` / `TARGET 40.608° S 94.607° E` | 792–863 (c06) |
| E4 | 1152–1289 | `TIME TO IMPACT` countdown | 1152–1289 (c09) |
| P4 | 1620–1727 | push 1.000 → 1.015 over FIRST STRIKE COMPLETE and its fade; no text | 1620–1727 (c12) |
| P5 | 1728–1799 | push 1.000 → 1.015; no text | 1728–1799 (c13 and the c14 cover) |
| E5 | 1800–1864 | `INCOMING · NULL MERIDIAN` / `COUNTERSTRIKE` / `TARGET 14.209° N 39.190° W` | 1800–1864 (c15) |
| E6 + P6 | 2016–2159 | `CONTACT · THE OCTOGONALS` / `DIVIDER RAID` / `WAVE 1/3 — "UNREGISTERED STRUCTURE DETECTED."`; push 1.000 → 1.020 on 2088–2159 | 2016–2087 (c17), 2088–2159 (c18 cover) |
| E7 | 2448–2842 | `TERRITORY MONUMENT · 1/4 … 4/4` roll-call with names and feature lines | 2448–2555 (c22), 2556–2627 (c23), 2628–2735 (c24), 2736–2842 (c25) |
| E9 | 2952–3094 | `NEITHER INTENDS TO SHARE.` | 2952–3094 (c25) |
| E8 | 3168–3455 | typographic end card on a **replaced black plate** | no gameplay here: the clean slot is the illustrated key-art card (§5) |

### 3.2 Titled loop → clean reel

| Titled | Loop frames | Baked into the titled frames | Clean-reel frames to cut |
|---|---|---|---|
| L1 | 81–125 | `TERMINAL APPROACH` / `FIRST STRIKE` | 1170–1259 (c09) |
| L2 | 216–242 | `HOSTILE TERMINAL APPROACH` / `COUNTERSTRIKE` | 1800–1853 (c15) |
| L3 | 333–377 | `CONTACT` / `THE OCTOGONALS` | 2178–2267 (c19) |
| LP1 | 324–413 | push 1.000 → 1.025; no text after 377 | 2160–2267 (c19), 2268–2339 (c20) |

---

## 4. Native game UI is footage, not ORBITAL RECORD

The clean versions contain the game's own interface. It belongs to the picture, it is not a graphic to strip, and new graphics must not cover it:

- **Screen-space UI:**
  - c04: the Vesper transmission card
  - c05: `LAUNCH AT NULL MERIDIAN?`
  - c12: FIRST STRIKE COMPLETE
  - c13 and the c14 cover: FIRE NOW
  - c21: the Signal Array status card
- **c12's HUD reads `SCARRED MOON · ORBITAL RECORD`.** That is the game's own string (`src/app/CinematicHud.tsx`), not the motion-graphics layer. It does not break the no-stacking rule, and it is not a reason to avoid c12.
- **World-space graphics:**
  - gold warhead trims
  - the cyan target reticle (c17, c18 cover, c20)
  - the cyan defense beam (c20)
  - the violet weapon fire (c19)

---

## 5. Clean footage evaluation

All 26 slots of the clean reel, from `media-sources.json → footage`. Grades are for reuse in a 16:9 film:

- **hero:** anchor shots
- **strong:** reuse freely
- **usable:** reuse with care
- **limited:** a short beat at most
- **none:** no unique footage

| Clip | Frames | Time (s) | Picture | Grade | Native UI | What it is / caveats |
|---|---|---|---|---|---|---|
| c01 | 0–287 | 0.00–4.80 | live | strong | | The Moon swells out of black. 0–71 is the baked head fade |
| c02 | 288–431 | 4.80–7.20 | live | strong | | Touchdown ring. 415–431 is the baked dip to black |
| c03 | 432–575 | 7.20–9.60 | held | limited | | Vesper Citadel, one held frame (c03#143). Motion would need a new push |
| c04 | 576–719 | 9.60–12.00 | held | usable | ✓ | Held c04#143. The Vesper transmission card is readable |
| c05 | 720–791 | 12.00–13.20 | still | usable | ✓ | Launch authority dialog. Very dark (mean luma ≈ 6) |
| c06 | 792–863 | 13.20–14.40 | live | limited | | Liftoff. The warhead is a speck until about 849 |
| **c07** | 864–1007 | 14.40–16.80 | live | **hero** | | The warhead crosses the lit limb. Poster source |
| c08 | 1008–1151 | 16.80–19.20 | live | strong | | Second angle along the limb |
| c09 | 1152–1295 | 19.20–21.60 | live | usable | | Terminal approach. Near-black, with a small warhead. 1291–1295 is the baked flash |
| **c10** | 1296–1439 | 21.60–24.00 | live | **hero** | | First Strike impact dome. 1296–1301 is the baked flash |
| c11 | 1440–1619 | 24.00–27.00 | live | strong | | Ejecta. The crater is bright for about the first second, then darkens |
| c12 | 1620–1727 | 27.00–28.80 | still | usable | ✓ | FIRST STRIKE COMPLETE (corrected, no ghosting). 1693–1727 is the baked fade |
| c13 | 1728–1763 | 28.80–29.40 | still | usable | ✓ | FIRE NOW |
| c14 | 1764–1799 | 29.40–30.00 | duplicate | none | ✓ | Cover: c13#35 held |
| c15 | 1800–1871 | 30.00–31.20 | live | strong | | Cyan-exhaust warhead dives onto the lander. 1867–1871 is the baked flash |
| **c16** | 1872–2015 | 31.20–33.60 | live | **hero** | | Counterstrike contact and debris. 1872–1877 is the baked flash |
| c17 | 2016–2087 | 33.60–34.80 | live | usable | | The Octogonal lead in the native reticle. Almost static |
| c18 | 2088–2159 | 34.80–36.00 | duplicate | none | | Cover: c17#71 held |
| c19 | 2160–2267 | 36.00–37.80 | live | strong | | Violet volley onto the Signal Array |
| c20 | 2268–2339 | 37.80–39.00 | live | strong | | Cyan defense beam. The lead breaks up |
| c21 | 2340–2447 | 39.00–40.80 | still | usable | ✓ | The edit's own push into the status card. The card is dense |
| c22 | 2448–2555 | 40.80–42.60 | live | strong | | Helios Spire. The mass driver fires near the end |
| c23 | 2556–2627 | 42.60–43.80 | live | usable | | Signal Array vane fan. Short |
| c24 | 2628–2735 | 43.80–45.60 | live | strong | | Crater Crown seated in the First Strike scar |
| **c25** | 2736–3167 | 45.60–52.80 | live | **hero** | | 7.2 s pull-back to the claimed Moon. 3133–3167 is the baked dip |
| end | 3168–3455 | 52.80–57.60 | card | none | | Illustrated key art with the wordmark, tagline and URL baked in. 3168–3203 is the baked dip. Never overlay it |

### 5.1 Baked transitions in the clean reel

| Frames | Colour | Cut |
|---|---|---|
| 0–71 | black | head fade into c01 |
| 415–431 | black | c02 dips out. c03's half is replaced by its hold, so 432 is a hard cut at full level |
| 1291–1301 | white | c09 → c10 flash |
| 1693–1727 | black | c12 fades out |
| 1867–1877 | white | c15 → c16 flash |
| 3133–3203 | black | c25 dips out, then the end card dips in |

Keep these frames only where the YouTube cut keeps the same two shots adjacent. Otherwise trim them off. A tail fade's first frame is untouched (414, 1290, 1692, 1866 and 3132 are clean). The titled cue sheet's protected windows start on those frames, one frame earlier than the fades, which is the more conservative bound.

### 5.2 Held and duplicate picture

- c03, c04, c05, c12 and c13 are single images in the clean reel, unpushed. If the film holds one longer than a beat, give it a **new** push with the existing perspective method (`platePushFilter` in `capture/titles/titles.ts`; never `zoompan`).
- c14 and c18 duplicate their neighbours. Never count them as extra coverage.

---

## 6. Footage worth reusing

1. **Anchor shots:** c07 (orbital hero), c10 (First Strike impact), c16 (counterstrike contact), c25 (claimed-Moon pull-back).
2. **Strong coverage:**
   - c01 and c02 (arrival)
   - c08 (second flight angle)
   - c11 (ejecta, first second)
   - c15 (dive)
   - c19 and c20 (Octogonal volley and defense)
   - c22 and c24 (Helios Spire and Crater Crown)
3. **Story beats carried by native UI:** c04, c05, c12, c13 and c21. Use them for meaning, short, unobstructed, and pushed only if held.
4. **Use with care:** c09 (dark, weak at phone size), c17 (near-static), c23 (short), c03 (one held frame).
5. **Do not count as footage:**
   - c06 before about 849
   - the c14 and c18 covers
   - the end-card slot

---

## 7. Graphics in the YouTube film

- **Reuse the language, not the frames.** Use the ORBITAL RECORD system from `capture/titles/reel-titles.cues.json` and `docs/LOOP_MOTION_TREATMENT.md`: record block, Saira + IBM Plex Mono, faction-coloured chip, `cubic-bezier(0.22,1,0.36,1)` entrances, opacity-only exits, and real in-game numbers only. Author the film's graphics as a new cue sheet in the same schema and render them with the same pipeline (`sceneAt` → `overlay.html` → `renderTitles.mjs`) over clean frames.
- **The reel's copy is reference, not a template.** Lines such as `YOU LANDED FIRST.` or `COUNTERSTRIKE` may return only if they suit the new film. They are re-timed to its cut and re-checked against its protected moments: impacts, flashes, destruction, native UI.
- **No stacking.** Never composite onto a titled frame, re-title a titled shot, or add a push over a titled push. Taking clean frames rules all three out.
- **End card.** The YouTube film's end card is rendered fresh, for example as the E8 lockup re-timed. It is never lifted from the titled reel, and nothing is laid over the illustrated card.

---

## 8. Using the register

```ts
import { checkTimelineSources, resolveCleanSource } from './capture/youtube/mediaPriority.ts'

// A shot chosen while watching the titled loop (L3, THE OCTOGONALS):
resolveCleanSource(sources, edit, cuesFor, { media: 'loop-titled', from: 333, to: 377 })
// → { media: 'reel-clean', ranges: [{ from: 2178, to: 2267, clip: 'c19' }],
//     replaces: [LP1 plate push, L3 graphics] }   // reapply only what the film needs

// Gate for the YouTube timeline: empty means every entry cuts clean footage.
checkTimelineSources(sources, timeline.map(({ media, from, to }) => ({ media, from, to })))
```

To identify a supplied file, run `sha256sum <file>` and look the hash up in `media-sources.json` (`identifyMedia`).

```sh
node --experimental-strip-types --experimental-transform-types --test capture/youtube/mediaPriority.test.ts
```

---

## 9. Not decided here

This document fixes **which media** the YouTube film is built from. It does not set the film's running time, structure, audio, copy deck, aspect or thumbnail. Those come from the YouTube brief. When the brief arrives, the timeline is built from §5 and §6 and gated by `checkTimelineSources`.
