# SHOOT THE MOON — YOUTUBE FILM: SCORE BIBLE

**Status:** scoring design only. No music has been composed or rendered, and no DaemonV12 project exists yet.
**Film:** the approved Option A VO / picture lock (2026-10-06): **2:55.20, 10,512 frames, 1920×1080 at 60 fps**. Picture and narration are untouched by this document.
**Roles:** Opus designs the score (this document). Astra composes and engineers it in DaemonV12 V0.5 through MCP.
**Implementation contract:** [YOUTUBE_SCORE_ASTRA_HANDOFF.md](YOUTUBE_SCORE_ASTRA_HANDOFF.md). It repeats only what Astra needs; where the two differ, the handoff wins.

Units used throughout:
- **Time** is film time `M:SS.ss` from the first frame. **Frames** are 0-based at 60 fps (frame f is shown at f/60 s).
- **Musical positions** use DaemonV12's grammar: `BAR:BEAT`, plus an optional whole-note fraction. `48:2+1/8` is an eighth note after beat 2 of bar 48. One beat is 0.6 s / 36 frames; one bar is 2.4 s / 144 frames.
- `+Nf` (for example `2:3+18f`) marks a time that is **not** a composing position (VO boundaries, word times). It is written as bar:beat plus frames.
- **VO line intervals** are sample-exact (the lock's placement record). **Word and pause times** come from the selects' forced alignment of the chosen takes and are good to about ±0.03–0.05 s.
- **E** is energy on the brief's 0–5 scale (0 silence … 5 major cinematic peak).

---

## 0. Source of truth and media status

**The locked media files were not present in the environment where this bible was written.** `capture-final/` is gitignored, and the lock was assembled outside this checkout on 2026-10-06. This bible therefore uses the lock's own records, which identify both files by SHA-256 and were validated against them by the lock QA (16/16 delivered-film checks, 36/36 narration checks):

| Record | Where | Used for |
|---|---|---|
| `capture/youtube/youtube-film.json` | branch `youtube-launch-vo-lock` @ `732aa45` | every segment, frame, source frame, protected interval, VO sample placement, old music markers |
| `capture/youtube/vo-selects.json` | same | selected takes, keep ranges, **forced-aligned word timings**, measured delivery (pitch range, final-word level, terminal slope) |
| `capture/youtube/youtubeTitles.cues.json` | same | every graphic's draw/exit frame |
| `capture/youtube/narration.ts`, `assembleNarration.mjs` | same | exact source → film placement (incl. the three 15 ms pause joins) and the room-tone span |
| `docs/youtube-launch/VO_PICTURE_LOCK.md`, `VO_SELECTS.md`, `YOUTUBE_FILM_TREATMENT.md` | same | output hashes and formats; delivery notes; the earlier music brief |
| `src/scene/heliosReactorModel.ts` + the fourth capture's provenance | `main` / lock record | exact mass-driver event times inside s25a |
| Hash-verified picture sources | repo | titled reel reference `7be8b4f8…` (same frames as the clean reel for event timing), both phone recordings, the three capture PNGs (`8cb68d8d…`, `99d16846…`, `b000043d…`) |
| DaemonV12 `main` @ `e84a62e` | `mataindustries/daemonv12` | V0.5 contract, Orbital Foundry catalog, and the portfolio score project + report |

The VO map was rebuilt from the selects with the lock's own placement logic, and all 21 line positions reproduce the lock's `startSample`/`endSample` exactly. Every timecode, frame and bar position in this document is generated from those records and re-checked (§19). **Before composing, Astra must run the Media Verification Gate on the real files** (handoff §1). If any value there disagrees with this bible, stop and report it.

### 0.1 Locked technical facts

| Item | Value |
|---|---|
| Picture master | `capture-final/youtube/shoot-the-moon-vo-picture-lock.mp4` — 51,342,891 bytes, SHA-256 `d9166c2906e5cccbaeb922914b361d08cbfd5ebe2365769ce26c56cf3797b1c3` |
| Review encode | `…/shoot-the-moon-vo-picture-lock-review.mp4` — 31,382,163 bytes, `c144f67401e724622a0fed4b9894a4c50f0546f692946c47333258f14ff8f249` (same frames, same AAC packets) |
| Picture format | 1920×1080, exactly 60/1 fps, **10,512 frames, 175.200000 s**, H.264 High, yuv420p, BT.709 limited; one AAC-LC 48 kHz mono narration stream; no music, no game audio |
| Locked VO (use this one) | `capture-final/youtube/audio/narration-mix.wav` — 25,228,902 bytes, SHA-256 `b3b34c019eb025160834297d7f7d2ef22a160ca463e13f8299b9962ffa4339f1` |
| VO format and level | 48 kHz mono 24-bit PCM, **8,409,600 samples = 175.2 s**, conformed to film time. Sample peak −3.13 dBFS (≈ −3.0 dBTP), **−25.0 LUFS integrated**, no dynamics, one 80 Hz 12 dB/oct high-pass; original room tone runs continuously **0:03.40–2:52.46**, digital silence outside it |
| Do not use | `audio/narration-selected.wav` (`ac1b4898…`: unprocessed, no room tone) |
| Narration | 21 lines, 317 words, 121.01 s of edited narration; **first line 0:03.90, last line ends 2:51.96** |
| Grid | **100 BPM, 4/4, 73 bars = 175.2 s exactly** (73 × 2.4 s). 10,512 / 144 = 73. 175.2 s = 7,726,320 frames at 44.1 kHz = 8,409,600 samples at 48 kHz |
| Cuts on the grid | all 41 picture segments start and end on a beat (multiples of 36 frames); both impacts are on bar lines (12:1 and 16:1) |

**Grid decision: locked.** The picture was cut to this grid and every act boundary sits on a beat. There is no editorial reason to change tempo, and V0.5 gives exact duration and tail control, so nothing about rendering argues for it either. Composition, automation and acceptance all use 100 BPM / 4/4 / 73 bars. The authored end is position `74:1`.

---

## 1. Executive scoring concept

The film is **two films joined at 0:43.80**. For 43.8 seconds it is the game's trailer, narrated in the second person ("Getting there first feels like it should count for something"). At the hard cut to the SYSTEMS card, the same voice says "I've wanted to make something like this since I was a kid…" From there to the end it is a person explaining how and why they built what we just watched.

The score follows that split with one idea: **one motif, two voices.** The portfolio score's Claim motif, D–A–E–F, belongs to the player in the game world: a filtered square lead over Orbital Foundry machinery. After 0:43.80 the same four notes belong to the maker, as a small celesta voice placed in the pauses of the author's sentences. The two voices meet only in the PAYOFF, in octaves. There the motif's minor third (the question it first asks at 0:15.00, right after "It doesn't.") rises to **F♯**, the "earned raised third" the portfolio reserved for its ending. It lands at **2:45.60 (70:1)**, the first downbeat after "…the kind of game I used to imagine making" with no voice over it.

Three rules carry the design:
1. **The music leads only where the voice rests.** Narration is near-continuous from 0:38.60 to 2:01.33 (82.7 s, longest gap 1.47 s) and from 2:03.30 to 2:33.39. The score leads in **eight VO-free windows** (§2.4) and accompanies everywhere else.
2. **The machine is earned twice.** Foundry machinery drives the game world, **stops dead at 0:43.80**, and is rebuilt from single ticks as the narration moves from childhood to coordinates, mathematics and the mass driver. It peaks in the 1.65 s VO-free window at 2:01.35 and **stops dead again at 2:03.00**. BUILD rebuilds it as a quiet process pulse, and the PAYOFF puts it under the theme.
3. **Nothing new after the setup.** Every musical identity in this film comes from the portfolio score or the first 43.8 s. The middle develops; it does not introduce.

---

## 2. Film and VO audit

### 2.1 Act structure as locked

| Act | Time | Frames | Bars | Length | Picture | Narration |
|---|---|---|---|---:|---|---|
| WORLD | 0:00.00–0:18.60 | 0–1115 | 1:1 → 8:4 | 18.6 s | Moon, touchdown, Vesper Citadel, transmission card, launch dialog | L01–L03, second person, wry |
| ESCALATION | 0:18.60–0:43.80 | 1116–2627 | 8:4 → 19:2 | 25.2 s | the portfolio reel's c06–c20 **frame for frame, 2 bars later** (+288 frames) | L04–L05 only; both impacts unnarrated |
| SYSTEMS | 0:43.80–2:03.00 | 2628–7379 | 19:2 → 52:2 | 79.2 s | chapter card, title screen, Moon/machinery holds, phone and flight recordings, route + code boards, mining still, the 13.2 s Helios capture | L06–L14, first person: childhood → game → maths → mass driver |
| BUILD | 2:03.00–2:35.40 | 7380–9323 | 52:2 → 65:4 | 32.4 s | chapter card, workflow, before/after pairs, capture grid, QA catch | L15–L18: authorship, collaborators, QA |
| PAYOFF | 2:35.40–2:55.20 | 9324–10511 | 65:4 → 74:1 | 19.8 s | TERRITORY CLAIMED, four monuments, 7.2 s pull-back, end card | L19–L21: pride, the dream, the release |

**The ESCALATION act is the portfolio reel's picture, unchanged, two bars later.** Reel frame 864 (c07, 14.4 s, reel 7:1) is film frame 1152 (19.2 s, film 9:1), and the offset holds through c20. Every sync the portfolio score made from reel 14.4 s to 39.0 s therefore falls at the same musical position two bars later in the film. Two things differ: the film enters c06 halfway (liftoff at 8:4, not 6:3), and two lines of narration now sit on top (L04, L05).

### 2.2 Picture audit — what the score must know

**Spectacle and in-shot events** (film time):

| Event | Time | Frame | Bar:beat | Note |
|---|---|---:|---|---|
| Liftoff cut / warhead in frame | 0:18.60 / ≈0:18.80 | 1116 | 8:4 | half of reel c06 |
| HERO limb crossing (protected) | 0:19.20–0:21.60 | 1152 | 9:1 | strongest image in the film |
| Terminal approach | 0:24.00 | 1440 | 11:1 | E1 graphic 0:24.30–0:25.65 |
| First Strike flash ramps / cut | 0:26.32 / 0:26.40 | 1579 / 1584 | 11:4+31f / 12:1 | baked white flash 1579–1589 |
| Ejecta and shock ring | 0:28.80–0:31.80 | 1728 | 13:1 | darkens to debris |
| THE MOON REMEMBERS card, fade to black | 0:31.80 → 0:33.58 | 1908 | 14:2 | native UI |
| FIRE NOW out of black | 0:33.60 | 2016 | 15:1 | native UI |
| Cyan dive / flash / contact | 0:34.80 / 0:35.92 / 0:36.00 | 2088 / 2155 / 2160 | 15:3 / — / 16:1 | baked flash 2155–2165 |
| Octogonal lead locked | 0:38.40 | 2304 | 17:1 | E3 graphic |
| Violet volley | 0:40.80 (beams ≈0:41.0–0:41.8) | 2448 | 18:1 | |
| Cyan defense beam lands | 0:42.60 | 2556 | 18:4 | lead breaks apart ≈0:43.0–0:43.8 |
| Hard cut to SYSTEMS card | 0:43.80 | 2628 | 19:2 | black |
| Phone: FIRE NOW / tap | ≈1:07.84 / ≈1:08.36 | — | — | recording s21 (25 fps), not hit |
| Phone: INTERCEPTED | ≈1:13.16 | — | — | only the last ~2 frames of s21: **not a usable event** |
| Route arc draws | 1:20.70–1:23.70 | 4842–5022 | 34:3+1/8 → 35:4+1/8 | values at 1:24.90, 1:26.40, 1:27.30, 1:28.50 |
| Code excerpt cut | 1:32.40 | 5544 | 39:3 | text 1:32.55 |
| Flight board: in-game camera cut | ≈1:38.30 | — | ≈42:1 | hazy ascent → space |
| Helios: charge begins | ≈1:50.80 | — | 47:1+24f | game code: loop 5000 ms |
| Helios: sled into position | ≈1:52.00–1:52.65 | — | — | loop 6200–6850 ms |
| **Helios: sled acceleration** | 1:52.80 | 6768 | **48:1** | loop 7000 ms |
| **Helios: slug launch** | 1:53.70 | 6822 | **48:2+1/8** | loop 7900 ms (HELIOS_LAUNCH_MS) |
| Helios: recoil / sled return | 1:53.70–1:54.40 / –1:56.60 | — | — | rings keep turning; camera pulls back |
| Helios: next charge starts | ≈2:02.80 | — | — | 0.2 s before the cut; no second fire |
| Hard cut to BUILD card | 2:03.00 | 7380 | 52:2 | black |
| Capture-grid verification ticks | 2:20.40–2:22.70 | 8424–8562 | 59:3 → 60:3 | 24 ticks, one every 6 frames |
| PAYOFF: TERRITORY CLAIMED card | 2:35.40 | 9324 | 65:4 | native UI |
| c22 mass driver muzzle flash | 2:38.10 | 9486 | 66:4+1/8 | reel frame 2502 |
| Pull-back from the Ziggurat | 2:42.00–2:49.20 | 9720 | 68:3 | dip to black from 2:48.60 (71:2) |
| End card | 2:49.20 | 10152 | 71:3 | SHOOT/MOON 2:49.50, THE 2:50.10, crescent waxes 2:50.70–2:51.30, tagline 2:51.30, CTA + URL 2:51.90, footer 2:52.20, held to the last frame |

The Helios events are not visible in any repository file: the fourth capture lives in `capture-final/`. They are computed from the game's own animation constants, which the capture reproduces exactly. The capture starts 300 ms after reveal-open, and loop time equals capture time plus 3700 ms (`HELIOS_REVEAL_LEAD_MS`). The lock record independently states "first fire +4,200 ms" from reveal-open, which is 1:53.70.

**Quiet / personal picture:** SYSTEMS card (0:43.80–0:46.20), the game's own title screen (0:46.20–0:53.40), the three clean holds with 2.5% pushes (Crater Crown, Helios Spire, the full Moon for 5.4 s; 0:53.40–1:05.40), landing-site panel (1:13.20–1:19.20), BUILD card and workflow board (2:03.00–2:12.60), end card.

**Long, visually stable sections:** launch dialog 5.4 s; title screen 7.2 s; full-Moon hold 5.4 s; route board 13.2 s (it builds progressively); mining still 9.0 s; QA board 10.8 s; end card 6.0 s. Each needs internal musical motion *or* deliberate stillness, never a loop.

**Fast montage:** escalation 0:33.60–0:43.80 (1.2–2.4 s shots) and the payoff monuments 2:37.20–2:42.00 (1.2–1.8 s). Score the phrase, not the cuts.

**Graphics with their own rhythm, deliberately not hit:** route values; workflow nodes every 1.2 s on off-beats (`53:2+1/8`, `53:4+1/8`…); iteration pair swaps every **1.8 s = 3 beats** (2:12.60, 2:14.40, 2:16.20, 2:18.00) — accenting them would put a 3-against-4 hemiola under continuous narration; P1 monument titles; the end-card builds. The only graphic rhythm the score mirrors is the capture-grid tick run (§10, sync 35), very softly, because that one *is* the film's thesis.

**Where silence is stronger than music:** the 600 ms vacuum before the First Strike flash (the reel's own silence); the SYSTEMS cut (0:43.80) under the first words of L06; the BUILD cut (2:03.00) under the first words of L15; the transmission card (near-silence, so the text reads); the author's own three pauses in L19, L20 and L21.

### 2.3 VO audit

| Line | Film interval | Frames | Bar:beat in → out | Dur. | Picture under it | Delivery (measured) |
|---|---|---|---|---:|---|---|
| L01 | 0:03.90–0:07.13 | 234–427 | 2:3+18f → 3:4+31f | 3.23 s | s01, s02, s03 | 7.0 st range; final word −9.6 dB; ending level (−1.2 st/s) |
| L02 | 0:13.70–0:14.65 | 822–878 | 6:3+30f → 7:1+15f | 0.95 s | s05 | 3.1 st range; final word +3.0 dB; ending falls (−6.3 st/s) |
| L03 | 0:15.35–0:18.35 | 921–1100 | 7:2+21f → 8:3+21f | 3.00 s | s05 | 8.4 st range; final word −8.4 dB; ending falls (−3.8 st/s) |
| L04 | 0:33.70–0:35.12 | 2022–2107 | 15:1+6f → 15:3+19f | 1.42 s | s13, s14 | 4.6 st range; final word −5.1 dB; ending level (−0.7 st/s) |
| L05 | 0:38.60–0:42.71 | 2316–2562 | 17:1+12f → 18:4+6f | 4.11 s | s16, s17, s18 | 8.1 st range; final word −11.9 dB; ending level (−1.2 st/s) |
| L06 | 0:44.10–0:53.17 | 2646–3190 | 19:2+18f → 23:1+22f | 9.07 s | s19, s20 | 6.6 st range; final word −2.3 dB; ending rises (+1.2 st/s) |
| L07 | 0:53.77–1:04.47 | 3226–3868 | 23:2+22f → 27:4+16f | 10.70 s | s20a, s20b, s20c | 6.6 st range; final word −6.5 dB; ending rises (+3.1 st/s) |
| L08 | 1:05.39–1:12.99 | 3923–4379 | 28:1+35f → 31:2+23f | 7.60 s | s20c, s21 | 9.4 st range; final word −5.8 dB; ending falls (−6.9 st/s) |
| L09 | 1:13.79–1:18.49 | 4427–4709 | 31:3+35f → 33:3+29f | 4.70 s | s22 | 6.8 st range; final word −6.1 dB; ending falls (−6.0 st/s) |
| L10 | 1:19.49–1:25.58 | 4769–5134 | 34:1+17f → 36:3+22f | 6.09 s | s23 | 7.1 st range; final word −6.6 dB; ending falls (−5.0 st/s) |
| L11 | 1:26.08–1:39.91 | 5164–5994 | 36:4+16f → 42:3+18f | 13.83 s | s23, s24, s24a | 6.1 st range; final word −2.1 dB; ending falls (−6.4 st/s) |
| L12 | 1:40.93–1:43.79 | 6055–6227 | 43:1+7f → 44:1+35f | 2.86 s | s25 | 11.9 st range; final word −4.5 dB; ending falls (−3.0 st/s) |
| L13 | 1:44.29–1:48.21 | 6257–6492 | 44:2+29f → 46:1+12f | 3.92 s | s25 | 7.4 st range; final word −0.4 dB; ending level (−1.6 st/s) |
| L14 | 1:49.11–2:01.33 | 6546–7279 | 46:2+30f → 51:3+7f | 12.22 s | s25, s25a | 6.5 st range; final word −4.4 dB; ending falls (−5.9 st/s) |
| L15 | 2:03.30–2:08.07 | 7398–7684 | 52:2+18f → 54:2+16f | 4.77 s | s26, s27 | 6.6 st range; final word −1.4 dB; ending falls (−4.1 st/s) |
| L16 | 2:08.99–2:13.82 | 7739–8029 | 54:3+35f → 56:4+1f | 4.83 s | s27, s28 | 6.7 st range; final word −2.2 dB; ending falls (−10.2 st/s) |
| L17 | 2:14.72–2:23.87 | 8083–8632 | 57:1+19f → 60:4+28f | 9.15 s | s28, s29 | 6.2 st range; final word −5.9 dB; ending level (−2.0 st/s) |
| L18 | 2:24.77–2:33.39 | 8686–9203 | 61:2+10f → 64:4+23f | 8.62 s | s30 | 8.3 st range; final word −3.3 dB; ending falls (−4.9 st/s) |
| L19 | 2:35.60–2:38.93 | 9336–9535 | 65:4+12f → 67:1+31f | 3.33 s | s31, s32 | 11.0 st range; final word −9.6 dB; ending level (−0.6 st/s) |
| L20 | 2:39.53–2:43.66 | 9571–9819 | 67:2+31f → 69:1+27f | 4.13 s | s33, s34, s35 | 9.1 st range; final word −7.7 dB; ending falls (−4.8 st/s) |
| L21 | 2:49.50–2:51.96 | 10170–10317 | 71:3+18f → 72:3+21f | 2.46 s | s36 | 5.2 st range; final word −13.7 dB; ending falls (−5.0 st/s) |

*"Final word" is the last word's level relative to the line. "Ending" is the terminal pitch slope. Both are measured by the selects.*

**Speech blocks** (lines joined across gaps shorter than 1.5 s):

| Block | Time | Length | Lines |
|---|---|---:|---|
| 1 | 0:03.90–0:07.13 | 3.23 s | L01 |
| 2 | 0:13.70–0:18.35 | 4.65 s | L02–L03 |
| 3 | 0:33.70–0:35.12 | 1.42 s | L04 |
| **4** | **0:38.60–2:01.33** | **82.73 s** | **L05–L14 (crosses the 0:43.80 cut)** |
| **5** | **2:03.30–2:33.39** | **30.09 s** | **L15–L18** |
| 6 | 2:35.60–2:43.66 | 8.06 s | L19–L20 |
| 7 | 2:49.50–2:51.96 | 2.46 s | L21 |

The VO is 69% of the runtime by line span (121.01 s) and about 102 s of actual word time. **The middle of the film is one uninterrupted narration.** No VO-free window between 0:44.10 and 2:01.33 is longer than 1.14 s.

**Delivery character** (from the selects' measurements; confirm by ear):
- **Wry premise, second person** — L01–L05. Understated. L02 "It doesn't." is a dry 0.95 s beat with a falling ending; the joke belongs to the voice. L04 was chosen *because* it avoids a trailer read.
- **Intimate** — L06 (childhood; ending slightly rising, unresolved), L15 (authorship; both sentences land), L19 (11.0 st; with L12 one of the two widest-range reads, and ranked first among the performance's strongest beats), L20 (9.1 st, with a natural 0.56 s beat before "I used to imagine making"), L21 (the final "it" is 13.7 dB under the line and must survive).
- **Energetic / technical** — L08 (9.4 st, by far the livelier of its two takes), L10–L11 (numbers: "a hundred-and-thirty-two-degree route at two thousand and forty-eight points", 1:30.19–1:34.96), L12 (11.9 st, the pivot "Then — I started pushing the visual side harder"), L14 (the mass driver).
- **Rhythmic** — L18: "Bad captures got recaptured. / Bugs got reproduced. / Ideas got rejected and rebuilt." The three-beat rhythm *is* the line.

**Where the music must be most restrained:**
- the whole of L06;
- the numbers in L11 (1:30.19–1:34.96);
- L15's first sentence;
- L19's lift on "proudest" (2:35.93);
- L20's "I used to imagine making" (2:42.22–2:43.44);
- L21's soft final "it" (2:51.55–2:51.92).

### 2.4 Where the music leads: the eight VO-free windows

| # | Window | Length | Picture | What the music does |
|---:|---|---:|---|---|
| 1 | 0:00.00–0:03.90 | 3.90 s | cold open | atmosphere + Claim seed |
| 2 | 0:07.13–0:13.70 | 6.57 s | Citadel, transmission, launch dialog | rival; pull back for reading; heartbeat |
| 3 | 0:18.35–0:33.70 | 15.35 s | launch → First Strike → the Moon remembers | the portfolio groove, the vacuum, the biggest hit, the breath |
| 4 | 0:35.12–0:38.60 | 3.48 s | dive → Counterstrike | reversed rival, the secondary hit |
| 5 | 2:01.33–2:03.00 | 1.67 s | mass-driver recovery | the machine at full, then the cut |
| 6 | 2:33.39–2:35.60 | 2.21 s | QA → PAYOFF | reverse swell → arrival |
| 7 | 2:43.66–2:49.50 | 5.84 s | pull-back → dip → end card | the raised third and the bloom |
| 8 | 2:51.96–2:55.20 | 3.24 s | held lockup | release to silence |

Three shorter rests also matter: 0:42.71–0:44.10 (contains the hard cut), 1:18.49–1:19.49 (into the route board) and 1:39.91–1:40.93 (flight → "Then").

### 2.5 Response windows inside the narration

Every pause of 0.35 s or more, and what the score does in it. **Not every pause is an opening:** thirteen are deliberately left to the voice or the bed.

| Window | Length | Bar:beat | After | Before | Use |
|---|---:|---|---|---|---|
| 0:00.00–0:03.94 | 3.94 s | 1:1 → 2:3+20f | FILM START | L01:getting | MUSIC LEADS — atmosphere from frame 0; claim seed D (1:3), A (2:2). |
| 0:07.09–0:13.75 | 6.66 s | 3:4+29f → 6:3+33f | L01:something | L02:it | MUSIC LEADS — Vesper motif 4:1; pull back for the transmission card 5:1; heartbeat from 6:3. |
| 0:14.61–0:15.39 | 0.78 s | 7:1+12f → 7:2+23f | L02:doesn't | L03:so | RESPONSE — claim E (7:1+1/8), F (7:2): the question. |
| 0:18.24–0:33.74 | 15.50 s | 8:3+14f → 15:1+8f | L03:go | L04:then | MUSIC LEADS — liftoff, orbit groove, riser, vacuum, FIRST STRIKE, ejecta, breath. |
| 0:35.08–0:38.64 | 3.56 s | 15:3+16f → 17:1+14f | L04:turn | L05:and | MUSIC LEADS — reversed rival from 15:3+3/16, swell, COUNTERSTRIKE, debris; thin by 17:1. |
| 0:40.48–0:41.04 | 0.56 s | 17:4+16f → 18:1+14f | L05:other | L05:someone | RESPONSE — the volley accent at 18:1 (alarm D/A♭ + steel + snare). |
| 0:42.67–0:44.14 | 1.47 s | 18:4+4f → 19:2+20f | L05:up | L06:i've | Beam steel 18:4+1/16, last burst, HARD CUT at 19:2; silence under the first words of L06. |
| 0:48.14–0:48.57 | 0.43 s | 21:1+8f → 21:1+34f | L06:starcraft | L06:reading | RESPONSE — claim-bell D (21:1+1/8). |
| 0:49.38–0:49.82 | 0.44 s | 21:3+10f → 21:4+1f | L06:dune | L06:and | RESPONSE — claim-bell A (21:3+1/8). |
| 0:53.07–0:53.81 | 0.74 s | 23:1+16f → 23:2+24f | L06:space | L07:shoot | RESPONSE — claim-bell E (23:1+1/8), F on the cut (23:2). |
| 0:56.47–0:57.01 | 0.54 s | 24:3+4f → 24:4 | L07:that | L07:territory | LEAVE EMPTY — the colon before the list. |
| 0:57.81–0:58.31 | 0.50 s | 25:1+12f → 25:2+6f | L07:territory | L07:machines | LEAVE EMPTY — list pause after "territory". |
| 0:59.22–0:59.80 | 0.58 s | 25:3+24f → 25:4+23f | L07:machines | L07:escalation | RESPONSE (small) — first machine ticks enter after "machines". |
| 1:00.76–1:01.55 | 0.79 s | 26:2+9f → 26:3+20f | L07:escalation | L07:and | ENTRY — B♭ (strings, low) at 26:3. |
| 1:02.23–1:02.77 | 0.55 s | 26:4+25f → 27:1+22f | L07:moon | L07:that | LEAVE EMPTY — inside "a Moon … that actually feels enormous". |
| 1:04.44–1:05.43 | 1.00 s | 27:4+14f → 28:2+1f | L07:enormous | L08:and | BLOOM PEAK at 28:1, then the machine pulse on the 28:2 cut. |
| 1:06.80–1:07.60 | 0.80 s | 28:4+12f → 29:1+24f | L08:cutscene | L08:it's | LEAVE TO THE PULSE — no event (FIRE NOW at 1:07.84 is not hit). |
| 1:09.70–1:10.35 | 0.65 s | 30:1+6f → 30:2+9f | L08:browser | L08:built | LEAVE TO THE PULSE. |
| 1:12.95–1:13.83 | 0.88 s | 31:2+21f → 31:4+1f | L08:desktop | L09:every | TRANSITION — thin to the precision bed on the 31:3 cut. |
| 1:18.45–1:19.53 | 1.08 s | 33:3+27f → 34:1+19f | L09:sphere | L10:one | TRANSITION — route board 34:1: orbit bass D begins. |
| 1:25.53–1:26.12 | 0.59 s | 36:3+19f → 36:4+19f | L10:math | L11:we | LEAVE EMPTY — "…at math. We used that…" is one thought. |
| 1:29.07–1:29.63 | 0.56 s | 38:1+16f → 38:2+13f | L11:moon | L11:validate | LEAVE EMPTY — the numbers follow; keep the bed still. |
| 1:32.21–1:32.59 | 0.38 s | 39:2+24f → 39:3+11f | L11:route | L11:at | RESOLVE on the code cut (39:3). |
| 1:34.96–1:35.44 | 0.48 s | 40:3+9f → 40:4+2f | L11:points | L11:and | LEAVE EMPTY. |
| 1:39.83–1:40.97 | 1.14 s | 42:3+14f → 43:1+10f | L11:tried | L12:then | RESPONSE — claim-lead orbit fragment (flight callback) across the 43:1 cut, ending by 1:40.90. |
| 1:41.35–1:41.91 | 0.56 s | 43:1+33f → 43:2+30f | L12:then | L12:i | RESPONSE — the lift after "Then". |
| 1:43.74–1:44.33 | 0.59 s | 44:1+32f → 44:2+31f | L12:harder | L13:the | LEAVE TO THE BED — steel is reserved for "mechanical thing". |
| 1:48.17–1:49.15 | 0.98 s | 46:1+10f → 46:2+33f | L13:code | L14:the | TRANSITION — prepare Helios: drone and sub in. |
| 1:51.96–1:52.64 | 0.68 s | 47:3+21f → 47:4+26f | L14:favorites | L14:it | CHARGE CONTINUES — tick accelerando; no melodic event. |
| 1:58.19–1:58.80 | 0.61 s | 50:1+35f → 50:3 | L14:thing | L14:that | RESPONSE — first metallic strike since 0:43.80, after "mechanical thing". |
| 2:01.27–2:03.32 | 2.05 s | 51:3+4f → 52:2+19f | L14:moon | L15:i | MUSIC LEADS — machine opens 51:3+1/16; HARD CUT at 52:2; silence under "I didn't…". |
| 2:05.42–2:06.00 | 0.58 s | 53:2+1f → 53:3 | L15:this | L15:i | ENTRY — warm low chord + process pulse at 53:2. |
| 2:08.04–2:09.03 | 0.99 s | 54:2+14f → 54:4+1f | L15:make | L16:claude | RESPONSE — claim-bell D (fragment 1). |
| 2:11.72–2:12.08 | 0.36 s | 55:4+19f → 56:1+4f | L16:could | L16:direct | LEAVE EMPTY — inside "direct, test, and challenge". |
| 2:13.78–2:14.76 | 0.98 s | 56:3+34f → 57:1+21f | L16:challenge | L17:my | RESPONSE — claim-bell D–A (fragment 2). |
| 2:17.66–2:18.37 | 0.71 s | 58:2+15f → 58:3+22f | L17:expected | L17:i | RESPONSE — claim-bell D–A–E (fragment 3). |
| 2:21.53–2:22.31 | 0.78 s | 59:4+31f → 60:2+6f | L17:testing | L17:not | RESPONSE — claim-bell D–A–E, tighter (fragment 4); verification ticks end 2:22.70. |
| 2:23.82–2:24.81 | 0.99 s | 60:4+25f → 61:2+12f | L17:once | L18:bad | TRANSITION — QA board 61:2: kick body + strings low. |
| 2:26.93–2:27.75 | 0.82 s | 62:1+31f → 62:3+9f | L18:recaptured | L18:bugs | RESPONSE — claim-bell D–A–E–F, complete. |
| 2:29.62–2:30.30 | 0.68 s | 63:2+13f → 63:3+18f | L18:reproduced | L18:ideas | RESPONSE — two machine ticks + soft steel. |
| 2:33.35–2:35.64 | 2.29 s | 64:4+21f → 65:4+14f | L18:rebuilt | L19:what | MUSIC LEADS — reverse swell 64:4+1/6 → arrival 65:4. |
| 2:36.74–2:37.21 | 0.47 s | 66:2+8f → 66:3 | L19:of | L19:isn't | LEAVE EMPTY — the author's beat; G sus lands on the 66:3 cut at its end. |
| 2:38.89–2:39.54 | 0.66 s | 67:1+29f → 67:2+32f | L19:code | L20:it's | HARMONY ONLY — A sus at 67:2; no melody. |
| 2:41.66–2:42.22 | 0.56 s | 68:2+15f → 68:3+13f | L20:game | L20:i | LEAVE EMPTY — the author's beat before "I used to imagine making"; no event on the 68:3 cut. |
| 2:43.44–2:49.50 | 6.06 s | 69:1+14f → 71:3+18f | L20:making | L21:and | MUSIC LEADS — D at 69:2, F♯ at 70:1, bloom, dip 71:2, end card 71:3 (no hit). |
| 2:49.98–2:50.72 | 0.74 s | 71:4+10f → 72:1+19f | L21:now | L21:everyone | LEAVE EMPTY — the beat after "And now" belongs to the author. |
| 2:51.92–2:55.20 | 3.28 s | 72:3+19f → 74:1 | L21:it | FILM END | MUSIC LEADS (quietly) — staged releases, one soft bell D at 73:1, silence by 2:55.10. |

---

## 3. Scoring structure by act

| Act | Score's job | E range | Decisive choices |
|---|---|---|---|
| **WORLD** | Make the Moon immense and the premise legible in 18.6 s without trailerising three wry lines. | 1–3 | Atmosphere from frame 0. Claim seed before the first word. The rival waits one beat after L01. Near-silence for the text card. A heartbeat, not a groove, for the decision. |
| **ESCALATION** | The game's spectacle, in the portfolio's language. | 3–5 | The portfolio's orbit groove, vacuum and First Strike, unchanged in function. Reversal and Octogonal tones moved out from under L04/L05. The trailer ends with a hard cut, not a sting. |
| **SYSTEMS** | A person's story that becomes an engineering story. | 0–4 | Starts from silence and a celesta. Pulse only from "It's the game running live". Each sub-section adds or removes something specific (§15). The machine peaks in the 1.65 s gap, then cuts. |
| **BUILD** | Authorship and rigour: warm, steady, honest. | 0–4 | Hard cut, then a warm low chord in L15's pause. A process pulse, never a groove. The motif is re-assembled one note at a time across the pauses. |
| **PAYOFF** | Pride, the dream realised, the release. | 1–5 | Harmony moves only in the author's pauses. The raised third is withheld until the voice stops. The end card gets no hit. Silence on the last frame. |

---

## 4. Motif system

Four identities, all inherited from the portfolio score "Shoot the Moon — The Claim" (DaemonV12 `examples/shoot-the-moon-locked-score.json`): D minor, suspended fifths and ninths, semitone tension, and an earned raised third at the very end. The brief's four names map onto them as follows. **HUMAN / BUILDER and CLAIM / RESOLUTION are the same motif**; that is the film's point.

### 4.1 CLAIM — the human/builder motif and the resolution theme

- **Pitch identity:** D–A–E–F (portfolio). Open fifth, questioning ninth, minor third.
- **Meaning here:** the dream of claiming the Moon. In the game it is the player's; in life it is the maker's.

**Forms:**

| Form | Shape | Where |
|---|---|---|
| Seed | open fifth D–A | 1:3 and 2:2 (cold open, portfolio "arrival" positions); held as harmony from 20:2 under the title screen |
| Question | D–A–E–F, ending on the unresolved minor third | 7:1+1/8 / 7:2 (after "It doesn't."); claim-bell across L06's pauses (21:1+1/8, 21:3+1/8, 23:1+1/8, 23:2); complete again at 2:26.93 |
| Orbit | the portfolio's propulsive phrase on the kick cell (1, 2+, 3+, 4+) | hero flight 9:1–10:4; recalled as a fragment in the 1:39.83–1:40.97 gap ("camera moves I probably would have never even tried") |
| Fragments | 1 → 2 → 3 → 4 notes across BUILD's pauses: the motif being rebuilt | 2:08.04, 2:13.78, 2:17.66, 2:21.53, complete at 2:26.93 |
| Realised | D–A–E rising to **F♯**, then the portfolio's descending E–D–A into the chord | 69:2 → **70:1** → 71:2 |

**Voices:** `claim-lead` (GM `lead_1_square`, portfolio filtering) is the game/player; `claim-bell` (GM `celesta`) is the maker/child. They play together only from 69:2.

**Rules:**
- **No F♯ in any track before 70:1 (2:45.60).** The raised third exists once.
- Under narration, claim notes sit only in pauses of 0.40 s or more and never sustain into the next word.

### 4.2 RIVAL — Vesper

- E♭–D–A–A♭, the descending semitone collapse. At the counterstrike it is reversed: A♭–A–D–E♭.
- Voice: GM `pad_6_metallic` (portfolio). One metallic strike marks its first entrance.
- **Lives only between 4:1 and 19:2.** Vesper is the game's antagonist and has no place in the maker's story.

### 4.3 THIRD PARTY — the Octogonals (the portfolio's "Divider")

- The D/A♭ tritone alarm (`12-alarm-energy-pulse.wav`) and the **3+3+2** accent cell, moving from eighths to sixteenths: perceived speed rises with no tempo change.
- **Lives only between 17:1 and 19:2.** Under L05 only the *rhythm* plays (kick, sub, ticks). The tones play only in the 0:40.48–0:41.04 breath and after "up" ends at 0:42.67.

### 4.4 MACHINE — the Orbital Foundry pulse

Unpitched; the identity is the Foundry rhythm section and the portfolio's asymmetric kick cell (1, 2+1/8, 3+1/8, 4+1/8). Its forms trace the story:

| Form | Where | Material |
|---|---|---|
| Heartbeat | 6:3–8:4 | sub-pulse quarters |
| Orbit groove | 9:1–11:4 | portfolio decision-orbit: kick cell, snare 2 & 4, ticks, moving bass |
| Raid | 17:1–19:2 | 3+3+2, eighths → sixteenths |
| *Stops dead* | 19:2 | hard cut |
| Workshop clock | from 25:4 (ticks) and 28:2 (pulse) | machine ticks, sub; no kick |
| Precision | 31:3–34:1 | soft sixteenth ticks |
| Flight cell | 41:1–43:1 | soft kick cell (kick body + sub) |
| Mass driver | 46:4–52:2 | accelerando, launch, recovery, full groove from 51:3+1/16 |
| *Stops dead* | 52:2 | hard cut |
| Process | 53:2–65:4 | sub on 1 and 3, ticks in eighths; kick body from 61:2 |
| Montage | 67:2–69:2 | soft orbit kick cell, no snare |
| Gravity | 70:1–71:2 | half-time kick + sub |
| *Rest* | from 71:2 | none |

### 4.5 Harmonic arc

| Region | Harmony |
|---|---|
| WORLD / ESCALATION | portfolio language: suspended D fields; E♭ against D (Vesper); D/A♭ (Octogonals); orbit bass D–C–B♭–A |
| L06 (childhood) | open fifth D–A only, no third in the harmony; the minor third exists only as a melodic question |
| L07 "a Moon that actually feels enormous" | first departure: **B♭ lydian** (B♭–D–E–F) from 26:3, peaking 28:1 |
| Route / maths | the orbit bass line D–C–B♭–A in **whole notes**: the trailer's flight, slowed to mathematics; resolves on the code cut (39:3) |
| L12 "Then…" | a step up (C colour) in the pause after "Then" |
| Mass driver | D minor with E♭ colour: the game world's semitone returns as machinery |
| BUILD | warmer: B♭ and G colours over a D pedal; nothing resolves |
| PAYOFF | **B♭(add9) at 65:4 → G sus/add9 at 66:3 → A sus at 67:2 (held 4.8 s) → D, third withheld, at 69:2 → D(add9) with F♯ at 70:1**, sustained to the end |

The payoff's chord changes all fall in the author's pauses or on cuts inside them: 66:3 ends the 2:36.74–2:37.21 pause, 67:2 is inside 2:38.89–2:39.54, and 69:2 / 70:1 come after the voice stops.

---

## 5. Energy curve

Peak value per bar (bars 11, 19, 52 and 71 drop sharply inside the bar; see the bar map):

```text
E5 |           █                                                        ███  
E4 |        ████   █ ██                           ██  ██            █ █████  
E3 |       ██████ █████       ████   ██████ ████████████      █████████████  
E2 |  ██ ████████ █████   ██████████████████████████████ ███████████████████ 
E1 |█████████████████████████████████████████████████████████████████████████
   +-------------------------------------------------------------------------
bar 1234567890123456789012345678901234567890123456789012345678901234567890123
             1         2         3         4         5         6         7   
act W      E          S                                B            P        
```

- **5 appears in exactly four bars:** 12 (First Strike) and 69–71 (the raised third and the bloom).
- **4 or above in 17 of 73 bars, 23%:** bars 9–12, 16, 18–19, 47–48, 51–52, 65, 67–71. The longest run at 4–5 is the payoff (bars 67–71, 12 s); the next is launch-to-impact (bars 9–12, 9.6 s).
- **The middle is a wave, not a plateau:** 0 → 1 (childhood) → 3 (enormous, live) → 2 (precision) → 3 (maths) → 2 (code) → 3 (flight, visual turn) → 4 (machine) → **0** → 1–2 (authorship) → 3 (QA) → 4 (arrival).
- **Each act ends lower or with a cut,** so the next can start from room. That is why the 0:43.80 and 2:03.00 cuts matter.

---

## 6. Sound palette

### 6.1 Orbital Foundry in this film

| Sound (catalog id) | Band | Role here | Never |
|---|---|---|---|
| `01-sub-pulse` (kit `sub-pulse`) | 49 Hz + 98/147 Hz | heartbeat, pulse | — |
| `02-mechanical-kick` (kit) | 68 Hz body, 150–900 Hz, 2–5 kHz click | grooves, kick cell, half-time gravity | at more than low velocity under words |
| `03-metallic-strike` (kit) | 1–6 kHz, 1.65 s ring | rival entrance, liftoff, ejecta, impacts, volley, beam, "mechanical thing", machine peak, one QA answer | under any word; anywhere in L06/L15–L16 |
| `04-machine-tick` (kit) | 2–9 kHz, 85 ms | clockwork, precision, accelerando, verification mirror | above low velocity under intimate lines |
| `05-industrial-snare` (kit) | 600 Hz–5 kHz | orbit groove, impacts, volley, machine peak | under any word |
| `06-low-boom` (kit) | 41–95 Hz + 170–600 Hz | touchdown, impacts, launch, payoff arrival | on every downbeat |
| `07-cinematic-impact` (kit) | broadband, 3.6 s | **12:1 (full) and 16:1 (reduced) only** | anywhere else |
| `08-tension-riser` | 220–1760 Hz sweep + air, fixed 4.0 s | **First Strike approach only:** onset 10:1+1/12, ends 11:4 | anywhere else |
| `09-reverse-swell` | mid/high suction, fixed 2.0 s | into 8:4, 16:1 and 65:4 | at full level under words |
| `10-dark-drone` | 110–900 Hz + 2 kHz friction, 8 s | game-world darkness (to 0:43.80); Helios machinery (1:49.80–2:03.00) | anywhere else |
| `11-air-texture` | 900 Hz–7 kHz, 8 s | stereo atmosphere and scale (filtered above the consonant band) | unfiltered under words |
| `12-alarm-energy-pulse` | D4/A♭4 + 1–3 kHz, 0.8 s | Octogonal identity, reversal colour | under any word; after 19:2 |

The drone and air are finite 8 s gestures; overlapping starts about 7 s apart make a continuous bed (Foundry README). The riser and reverse swell are placed by their **endpoints**: 4.0 s = 6400 ticks, 2.0 s = 3200 ticks at 100 BPM.

### 6.2 General MIDI voices

The Foundry samples are unpitched one-shots, so every pitched line comes from GM.

| Program | Track | Why |
|---|---|---|
| `lead_1_square` | claim-lead | the portfolio's Claim voice: continuity with the portfolio score |
| `celesta` | claim-bell | the maker's voice: small, bell-like and quickly decaying, so it leaves room for speech; childhood and the library without a toy box. Audition `vibraphone` only if the celesta renders badly |
| `pad_6_metallic` | rival | portfolio continuity |
| `pad_3_polysynth` | harmony | the portfolio's harmonic field |
| `string_ensemble_1` | strings | new: the warmth and breadth the portfolio critique said its resolution lacked ("more sustained midrange, not additional bass hits"), used for "enormous", BUILD and the payoff |
| `synth_bass_1` | bass-motion | portfolio continuity |

### 6.3 The voice-band rule

Speech energy sits in three zones: body (fundamental and first formants) roughly 100–900 Hz, intelligibility 1–4 kHz, sibilance 4–9 kHz. The narration is high-passed at 80 Hz, so almost nothing of the voice lives below it.

- **Under words:** sub-pulse; low boom (soft); kick body at low velocity; machine ticks at low velocity; bass-motion (low-passed at 800 Hz); harmony pad at bed level with no attacks on words; strings (soft, sustained, low register); air above 3.5 kHz.
- **Only in pauses or VO-free windows:** metallic strike, industrial snare, alarm, rival pad, claim-lead and claim-bell notes, cinematic impact, riser, and reverse swell above −10 dB.

---

## 7. Track / stem architecture

Fifteen tracks: the portfolio's fourteen roles, consolidated (both impact sounds on one kit track) and extended (celesta and strings). In DaemonV12 every track renders as one stem, so this is also the stem plan.

| # | Track | Instrument | Static processing (ordered) | Function |
|---:|---|---|---|---|
| 1 | `atmos-drone` | sampler `10-dark-drone.wav` | highpass 130 Hz, lowpass 1800 Hz | game-world darkness; Helios machinery |
| 2 | `atmos-air` | sampler `11-air-texture.wav` | highpass 3500 Hz | stereo atmosphere and scale throughout |
| 3 | `sub` | drumkit `orbital-foundry/kit.json` (`sub-pulse`) | highpass 32 Hz | heartbeat, pulse |
| 4 | `bass-motion` | GM `synth_bass_1` | highpass 85 Hz, lowpass 800 Hz, compressor | orbit line, machine bass, payoff roots |
| 5 | `drive` | drumkit (`mechanical-kick`, `industrial-snare`) | highpass 48 Hz, saturation, compressor | grooves, kick cell, raid |
| 6 | `detail` | drumkit (`machine-tick`, `metallic-strike`) | highpass 420 Hz | clockwork, precision, steel accents |
| 7 | `impacts` | drumkit (`low-boom`, `cinematic-impact`) | highpass 35 Hz | touchdown, impacts, launch, arrival |
| 8 | `riser` | sampler `08-tension-riser.wav` | highpass 260 Hz | First Strike approach only |
| 9 | `reverse` | sampler `09-reverse-swell.wav` | highpass 300 Hz | launch, counterstrike, payoff |
| 10 | `alarm` | sampler `12-alarm-energy-pulse.wav` | highpass 380 Hz; pan −0.16 | Octogonal identity, reversal |
| 11 | `claim-lead` | GM `lead_1_square` | highpass 260 Hz, lowpass 2700 Hz, delay 150 ms / wet 0.18 | CLAIM, game voice |
| 12 | `claim-bell` | GM `celesta` | highpass 400 Hz, delay 300 ms / wet 0.12, reverb | CLAIM, maker voice |
| 13 | `rival` | GM `pad_6_metallic` | highpass 520 Hz, lowpass 6200 Hz | Vesper |
| 14 | `harmony` | GM `pad_3_polysynth` | highpass 190 Hz, lowpass 2600 Hz | harmonic field |
| 15 | `strings` | GM `string_ensemble_1` | highpass 110 Hz, lowpass 6500 Hz, reverb | warmth, awe, payoff breadth |

**Master:** highpass 30 Hz (portfolio), master gain for calibration, VO ducking (§8). No master compressor or limiter.

**Post-production stem groups** (for anyone re-balancing in an editor): ATMOS = 1–2; LOW = 3–4; RHYTHM = 5–6; IMPACT/FX = 7–10; THEMES = 11–13; HARMONY = 14–15.

**Keep easy to rebalance under VO:** `claim-bell`, `strings`, `harmony`, `atmos-air`, `detail` and `bass-motion`. These carry almost everything that sounds under narration. Stems include track automation and effects but **exclude master ducking and master gain**, so they are clean production elements: a re-mix from stems must re-create the duck.

**Three engine facts shape this layout:**
1. **Filters are static per track.** V0.5 has no filter automation. A "filter opening" must be written as orchestration (register, instrument entrances) or as a crossfade between two differently filtered tracks with gain automation. This plan never needs the crossfade: the static filters above are chosen to be right under the voice, and the payoff opens by adding `strings` and `claim-lead`.
2. **Track gain automation runs before track effects** (render order: automation → effects → tail cap). Automation cannot cut a reverb or delay tail already in the effect. That is why there is **no reverb or delay on any track that plays into the two hard cuts or the final boundary**, why `claim-lead`'s 150 ms echo must not cross 19:2, and why reverb exists only on `claim-bell` and `strings`, neither of which sounds into a hard cut.
3. **Ducking is master-only, with a single amount.** Per-section depth comes from arrangement and track gain automation (§8).

---

## 8. Voiceover ducking strategy

### 8.1 Arrangement space (primary)

The arrangement does most of the work, before any sidechain:
- Follow the voice-band rule (§6.3).
- Melodic notes only in pauses of 0.40 s or more, from the response table (§2.5).
- Static filters chosen for life under narration (§7).
- Section levels set by **track gain automation** so that the *ducked* score meets these relationships with the VO at its locked level:

| Window | Interval | Music ≤ VO − | Character |
|---|---|---:|---|
| L01 | 0:03.90–0:07.13 | 12 dB | premise |
| L02–L03 | 0:13.70–0:18.35 | 12 dB | premise; "It doesn't." dry |
| L04 | 0:33.70–0:35.12 | 9 dB | action |
| L05 | 0:38.60–0:42.71 | 8 dB | action (most energetic narrated passage) |
| L06 | 0:44.10–0:53.17 | 18 dB | intimate (childhood) |
| L07 | 0:53.77–1:04.47 | 14 dB | personal → awe |
| L08–L09 | 1:05.39–1:18.49 | 12 dB | live / precision |
| L10–L11 | 1:19.49–1:39.91 | 12 dB | discovery / numbers |
| L12–L13 | 1:40.93–1:48.21 | 12 dB | visual turn |
| L14 | 1:49.11–2:01.33 | 9 dB | machine |
| L15–L16 | 2:03.30–2:13.82 | 16 dB | authorship |
| L17–L18 | 2:14.72–2:33.39 | 12 dB | rigour |
| L19–L20 | 2:35.60–2:43.66 | 14 dB | pride |
| L21 | 2:49.50–2:51.96 | 18 dB | last line |

*Measure each window as integrated LUFS of the score master versus the converted VO key over the same interval (handoff §11).*

### 8.2 Sidechain (V0.5 master ducking)

| Parameter | Start value | Why |
|---|---|---|
| `amountDb` | **6** | Half of the 12 dB standard separation. The other half is arrangement. Large enough to protect consonants against action beds (L05, L14); small enough that sustained beds do not visibly breathe. |
| `thresholdDb` | **−48** | The room tone peaks at about −59 dBFS (its 20 ms RMS is lower still), so the margin is ≥ 11 dB. Soft line endings are estimated at −35 to −45 dBFS from the selects' final-word levels: L21's "it" is 13.7 dB under its line and L05's "shows up" is 11.9 dB under. −48 keeps the duck held through them and through breaths. −35 would release on them. |
| `attackMs` | **30** | Line onsets usually follow a pause in which the music has recovered; a fast attack protects the first consonant. The detector's trailing 20 ms window adds its own latency. |
| `releaseMs` | **900** | The film-specific choice. See the model below. |

**Why 900 ms.** A model of V0.5's detector (trailing 20 ms window, exponential attack/release in dB), driven by the aligned word intervals, gives:

| Release | Median / max swell in sub-second pauses | Residual duck at 16:1 (Counterstrike, 0.88 s after L04) | at 18:1 (volley, inside L05) | at 69:2 (2:43.80) | at 70:1 (F♯) | Time ≥ 50% ducked |
|---|---|---|---|---|---|---|
| 500 ms | 4.2 / 5.2 dB | 1.0 dB | 3.3 dB | 3.0 dB | 0.1 dB | 68.5% |
| **900 ms** | **2.9 / 4.0 dB** | **2.2 dB** | **4.3 dB** | **4.1 dB** | **0.6 dB** | **74.8%** |
| 1300 ms | 2.2 / 3.2 dB | 3.0 dB | 4.8 dB | 4.6 dB | 1.2 dB | 78.1% |

*(6 dB amount, 30 ms attack.)*

- **500 ms** pumps in L06/L07/L17/L18's list pauses.
- **1300 ms** leaves the Counterstrike and the F♯ under the duck.
- **900 ms** keeps breathing under 3 dB in the typical pause and lets the post-line hits recover. Its slow release after L20 *is* the crescendo into the raised third: about 4 dB of duck remains at 69:2 and 0.6 dB at 70:1.

**The key file.** V0.5 reads only **44,100 Hz signed PCM16** references; the locked VO is 48 kHz / 24-bit. Astra makes a *converted copy* of `narration-mix.wav` with soxr resampling, exactly 7,726,320 frames, unity gain and no edits, and stores it as a regular file (V0.5 refuses symlinks and hard links) inside the DaemonV12 project's `assets/`. The key is analysed, never mixed. The locked VO itself is never modified.

### 8.3 Compensation automation (where the duck would blunt a sync)

| Where | Residual duck | Automation |
|---|---|---|
| 16:1 Counterstrike | ≈2.2 dB | `impacts` +2 dB from 0:36.00 to 0:37.20 |
| 18:1 volley (inside L05's breath) | ≈4.3 dB | the accent notes in 0:40.80–0:41.04 +3 dB (alarm, detail, drive) |
| 18:4+1/16 beam steel | ≈5.6 dB | `detail` +4 dB for that note; the last burst then rises with the release |
| 28:1 "enormous" bloom peak | ≈4 dB | `strings` +4 dB ramp 1:04.44 → 1:04.80, back to bed by 1:05.40 |
| 51:3+1/16 machine opens | ≈6 → 0.9 dB across the window | none: write the opening as a crescendo and let the release finish it |
| 69:2 → 70:1 | ≈4.1 → 0.6 dB | none: the release is the bloom |

### 8.4 What not to do

- No aggressive constant duck (≥ 10 dB).
- No release under 500 ms.
- No semantic edits to the key (muting lines, scaling regions). The engine's activity is binary, so editing the key cannot buy partial depth, and a faithful key is verifiable.

---

## 9. Effects strategy

Every effect below solves a specific problem in this film.

| Effect | Where | Problem it solves |
|---|---|---|
| **Highpass / lowpass** (static) | all tracks, as in §7 | They carve the voice corridor: air above 3.5 kHz, bass below 800 Hz, drone 130–1800 Hz, harmony below 2.6 kHz. Mostly the portfolio's values, tightened for narration. |
| **Compressor** | `bass-motion` (start: −24 dB, 3:1, 15 ms / 180 ms; aim for 2–4 dB reduction on the loudest notes) | GM bass velocity varies; under narration the low end must be even, with no surprise peaks. |
| **Compressor** | `drive` (start: −20 dB, 2.5:1, 10 ms / 120 ms, no makeup) | Portfolio first-pass lesson: "ordinary accents competed with First Strike". Keep groove accents at least 3 dB under the 12:1 peak. |
| **Saturation** | `drive` (start: drive 4 dB, mix 0.25), placed before its compressor | Mechanical grit, and small-speaker translation of the kick for a film that says "built for a phone as much as a desktop". Not on `sub`: its added harmonics would land in the voice's fundamental range. |
| **Reverb** | `claim-bell` (room 0.55, decay 1.2 s, wet 0.22) | Childhood and library: a small space around the maker's notes, short enough to clear before the next word. |
| **Reverb** | `strings` (room 0.7, decay 1.8 s, wet 0.25) | Scale for "enormous", BUILD's warmth and the payoff. The only large space in the score. |
| **Delay** | `claim-lead` (150 ms, wet 0.18) | Portfolio continuity: the game voice's echo. |
| **Delay** | `claim-bell` (300 ms = one eighth, wet 0.12) | A sparse motif treatment whose echo lands inside the pause it was placed in. |

**Not used:**
- No reverb on percussion, impacts, transitions, alarm, rival, harmony, bass or drone: the Foundry samples carry their own designed reflections, and the hard cuts must be dry.
- No master dynamics.
- No saturation beyond `drive`.

**Tails versus picture:** with `render.duration` 175.2 s and `render.tail` `none`, the engine cuts everything at 74:1. The plan makes sure nothing is still sounding there (§16).

---

## 10. Sync-point map

| # | Time | Frame | Bar:beat | Event | Treatment |
|---:|---|---:|---|---|---|
| 1 | 0:00.00 | 0 | 1:1 | **Frame 0.** Film opens mid-fade (reel head fade at 50%); W1 YOU LANDED FIRST. from 0:00.30 | Drone + air start on frame 0; their own short fade-ins ride the picture's head fade (full level by 0:00.60). No transient, no added fade. |
| 2 | 0:01.20 | 72 | 1:3 | **Claim seed.** Moon swells; VO-free cold open | Motif entry: claim-lead D. A follows at 2:2 (0:03.00). Identity established before the first word (0:03.94). |
| 3 | 0:04.20 | 252 | 2:4 | **Touchdown.** Amber ring blooms around the lander; L01 says "there" at 0:04.25 | Restrained impact: low boom at low velocity, sub weight only. No kick click, no steel. |
| 4 | 0:07.20 | 432 | 4:1 | **Rival.** 0.6 s after the hard cut to the Citadel (0:06.60); L01 ended 0:07.13; W2 at 0:08.10 | Motif entry: Vesper E♭–D–A–A♭ (rival) with one metallic strike. Moved one beat late on purpose: L01 owns the cut. |
| 5 | 0:09.60 | 576 | 5:1 | **Transmission.** Vesper text card (native UI) to be read; no VO | Automation drop: percussion absent, atmosphere −6 dB, one sparse D/E♭ dissonance. Not a sidechain event. |
| 6 | 0:13.20 | 792 | 6:3 | **Decision.** LAUNCH AT NULL MERIDIAN? dialog; L02 "It doesn't." at 0:13.75 | Percussion entrance: sub-pulse heartbeat (quarters). No sting after "It doesn't." |
| 7 | 0:14.70 | 882 | 7:1+1/8 | **The question.** Gap 0:14.61–0:15.39 between L02 and L03 | Motif entry: claim-lead E (7:1+1/8) then F (7:2): the unresolved minor third. |
| 8 | 0:18.60 | 1116 | 8:4 | **Liftoff.** Warhead punches up into frame; L03 ended 0:18.35 | Riser endpoint: reverse swell lands with kick + metallic strike + low boom; machine ticks accelerate into 9:1. |
| 9 | 0:19.20 | 1152 | 9:1 | **Hero flight.** Warhead crosses the lit limb (protected shot) | Percussion/rhythm entrance: portfolio orbit groove (kick 1, 2+, 3+, 4+; snare 2 & 4; bass D–C–B♭–A; claim orbit phrase). |
| 10 | 0:21.80 | 1308 | 10:1+1/12 | **Riser onset.** Second angle (nose-down) | Transition start: tension riser placed by its endpoint (fixed 4.0 s sample ends at 0:25.80). |
| 11 | 0:24.00 | 1440 | 11:1 | **Terminal approach.** Dark limb; E1 TERMINAL APPROACH / FIRST STRIKE 0:24.30–0:25.65 | Rhythmic subdivision change: machine ticks to sixteenths. |
| 12 | 0:25.80 | 1548 | 11:4 | **Vacuum.** Last 600 ms of the approach (reel "in silence") | Silence: everything stops; ≤ −80 dBFS RMS. The 0.6 s of nothing is the setup for 12:1. |
| 13 | 0:26.40 | 1584 | 12:1 | **FIRST STRIKE.** White flash cut; amber dome over the shattered crater | Impact: cinematic impact + low boom + mechanical kick + dissonant D field. The loudest moment of the film. |
| 14 | 0:31.80 | 1908 | 14:2 | **The Moon remembers.** FIRST STRIKE COMPLETE · THE MOON REMEMBERS card, fading to black by 0:33.58 | Silence/automation: breath (air + A/E suspension) fading with the picture to near-silence at 15:1. |
| 15 | 0:33.60 | 2016 | 15:1 | **Reversal.** Hard cut out of black to FIRE NOW (Vesper counterstrike); L04 "Then" at 0:33.74 | Restrained impact: low jolt only (kick + sub). Alarm and rival contour wait until L04 ends. |
| 16 | 0:35.25 | 2115 | 15:3+3/16 | **Their turn.** Cyan warhead dive; L04 line ends 0:35.12 (last word "turn" ends ≈0:35.08) | Motif entry: reversed rival A♭–A–D–E♭ in sixteenths from 15:3+3/16, over the reverse swell into 16:1. |
| 17 | 0:36.00 | 2160 | 16:1 | **COUNTERSTRIKE.** White flash cut; fireball, shock ring, debris rain | Impact (secondary): brighter steel/snare/alarm, reduced wide impact, boom offset to 0:36.15. Must stay below 12:1. |
| 18 | 0:38.40 | 2304 | 17:1 | **Third party.** Octogonal lead locked in the reticle; E3 THE OCTOGONALS; L05 from 0:38.60 | Rhythmic identity only: 3+3+2 accents in kick/sub/ticks. No alarm or rival tones under words. |
| 19 | 0:40.80 | 2448 | 18:1 | **Volley.** Violet volley cut — lands inside L05's 0.56 s breath (0:40.48–0:41.04) | Impact + subdivision change: D/A♭ alarm + steel + snare in the breath, then double-time 3+3+2 under "someone else shows up". |
| 20 | 0:42.60 | 2556 | 18:4 | **Defense beam.** Cyan beam lands on the cut; L05 "up" ends 0:42.67 | Impact: low hit at 18:4; bright steel delayed to 18:4+1/16 (0:42.75), after the word. |
| 21 | 0:43.80 | 2628 | 19:2 | **SYSTEMS cut.** Hard cut to black chapter card; L06 "I've wanted…" at 0:44.14 | Silence: HARD CUT of every track (15 ms ramps ending on 19:2). The film turns from trailer to person here. |
| 22 | 0:46.20 | 2772 | 20:2 | **The name.** Cut to the live launch gate (SHOOT THE MOON lockup) | Atmosphere precedes motif: open fifth D–A fades in (harmony, very low). |
| 23 | 0:48.30 | 2898 | 21:1+1/8 | **Childhood list.** L06 pauses after "StarCraft" (0:48.14–0:48.57) and "Dune" (0:49.38–0:49.82) | Motif entry: claim-bell D at 21:1+1/8, A at 21:3+1/8 (0:49.50) — the maker's voice of the same motif. |
| 24 | 0:53.10 | 3186 | 23:1+1/8 | **The question, again.** Gap after "space" (0:53.07–0:53.81); cut to Crater Crown at 0:53.40 | Motif entry: claim-bell E at 23:1+1/8, F on the cut at 23:2, leading into "Shoot the Moon became my version of all of that". |
| 25 | 1:01.20 | 3672 | 26:3 | **Enormous.** Gap after "escalation" (1:00.76–1:01.55), then "…a Moon that actually feels enormous" over the full-Moon hold | Harmonic shift + automation lift: B♭ lydian enters at 26:3 in the gap, swells under the line and peaks at 28:1 (1:04.80) in the 1:04.44–1:05.43 gap. |
| 26 | 1:05.40 | 3924 | 28:2 | **Live.** Cut to the real phone recording; L08 "And none of this is a cutscene" | Percussion entrance: the machine pulse returns (ticks + sub). FIRE NOW (1:07.84) and the tap (1:08.36) are not hit. |
| 27 | 1:20.70 | 4842 | 34:3+1/8 | **The route draws.** Route arc draws 1:20.70–1:23.70 under L10 ("…realizing how good the frontier models had become at math") | Automation lift: orbit bass D–C–B♭–A as whole notes, strings enter low. |
| 28 | 1:32.40 | 5544 | 39:3 | **The code lands.** Code excerpt cut inside L11's gap after "route" (1:32.21–1:32.59) | Harmonic resolve on the cut (39:3) in the gap, then thin for reading. |
| 29 | 1:40.80 | 6048 | 43:1 | **The visual side.** "Then [0.56 s] I started pushing the visual side harder" | Transition: lift placed in the 1:41.35–1:41.91 gap (harmony steps up, detail brightens). |
| 30 | 1:52.80 | 6768 | 48:1 | **Sled.** Mass-driver sled acceleration begins (game code: loop 7000 ms) | Rhythmic subdivision change: tick accelerando peaks; sub doubles. |
| 31 | 1:53.70 | 6822 | 48:2+1/8 | **Launch.** Mass-driver slug launches (game code: loop 7900 ms) during L14 "idea" | Restrained impact under VO: low boom, sub weight only; ticks stop for one beat. |
| 32 | 2:01.35 | 7281 | 51:3+1/16 | **The machine.** L14 ends 2:01.33; Helios recovery, camera pulled back; VO-free until the cut | The SYSTEMS peak: the groove already running under L14 opens to full at 51:3+1/16 (kick cell, snare, ticks, steel, sub, bass) for 1.65 s. |
| 33 | 2:03.00 | 7380 | 52:2 | **BUILD cut.** Hard cut to black chapter card; L15 "I didn't ask a model…" at 2:03.32 | Silence: HARD CUT of every track, rhyming with 0:43.80. |
| 34 | 2:05.40 | 7524 | 53:2 | **I already knew.** Workflow diagram cut as L15's pause begins (2:05.42–2:06.00) | Harmonic entry: warm low chord (strings, 0.4 s fade-in) and the BUILD process pulse. |
| 35 | 2:20.40 | 8424 | 59:3 | **Frame-checked.** 24 verification ticks draw across the capture grid every 0.1 s (2:20.40–2:22.70) | Rhythmic mirror, very soft: 24 machine-tick sextuplets 59:3 → 60:3 (velocity ≤ .35), then stop. |
| 36 | 2:33.40 | 9204 | 64:4+1/6 | **Rebuilt.** L18 ends on "rebuilt" (2:33.39); QA board | Riser: reverse swell 64:4+1/6 → 65:4, starting as the word ends. |
| 37 | 2:35.40 | 9324 | 65:4 | **PAYOFF.** Hard cut back into the game: TERRITORY CLAIMED · PERMANENT; L19 at 2:35.64 | Harmonic arrival: B♭(add9) + short claim chord D/A/E (the portfolio's claim-secured sting, withheld at 0:43.80) + soft low boom. |
| 38 | 2:38.10 | 9486 | 66:4+1/8 | **Mass driver, fulfilled.** c22 muzzle flash (reel frame 2502) under L19 "wrote code" | Restrained impact: soft low-boom callback of 48:2+1/8, sub weight only. |
| 39 | 2:43.80 | 9828 | 69:2 | **Answer.** L20 "…I used to imagine making" ends 2:43.66; pull-back continues unnarrated | Harmonic resolution to D with the third withheld (D–A–E); motif begins to rise. |
| 40 | 2:45.60 | 9936 | 70:1 | **The raised third.** Pull-back, the claimed Moon fills the frame; no VO | Motif + harmonic arrival: F♯ — the first major third in the film. The emotional payoff. |
| 41 | 2:48.60 | 10116 | 71:2 | **Dip.** Baked dip to black into the end card | Transition: machinery and melody release; only the sustained D(add9) continues. |
| 42 | 2:49.20 | 10152 | 71:3 | **End card.** SHOOT THE MOON lockup builds; L21 at 2:49.50 | No hit at all: re-voice the sustained chord without a transient. |
| 43 | 2:52.80 | 10368 | 73:1 | **Last bar.** Held lockup; L21 ended 2:51.96 | Final gesture: one soft claim-bell D; everything ≤ −60 dBFS by 2:55.10; nothing past 2:55.20. |

**Deliberately unhit** (no impact, no accent):
- W1/W2 entrances;
- the touchdown ring's bloom (only the contact is marked);
- the c02 dip to black;
- the FIRE NOW panel and the tap in the phone recording;
- INTERCEPTED (not really on screen);
- route values;
- workflow nodes;
- iteration swaps;
- P1 title changes;
- the c23 / c24 / c25 cuts;
- the end-card builds.

---

## 11. Cue sheet

One continuous DaemonV12 project. The twenty regions tile 0:00.00–2:55.20 with no gap. Intentional silence: all of 2M2 (the vacuum), and the first bar of 3M1 (19:2 → 20:2) and of 4M1 (52:2 → 53:2), each under the first words after a hard cut. Overview:

| Cue | Name | Start | End | Frames | Bars | VO | Energy |
|---|---|---|---|---|---|---|---|
| 1M1 | Landed First | 0:00.00 | 0:06.60 | 0–395 | 1:1 → 3:4 | L01 (40%) | 1→2 |
| 1M2 | They Landed Anyway | 0:06.60 | 0:13.20 | 396–791 | 3:4 → 6:3 | L01 (7%) | 2→1 |
| 1M3 | How Far | 0:13.20 | 0:18.60 | 792–1115 | 6:3 → 8:4 | L02/L03 (64%) | 2→3 |
| 2M1 | Launch / Orbit / Approach | 0:18.60 | 0:25.80 | 1116–1547 | 8:4 → 11:4 | none | 3→4 |
| 2M2 | Vacuum | 0:25.80 | 0:26.40 | 1548–1583 | 11:4 → 12:1 | none | 0 |
| 2M3 | First Strike / The Moon Remembers | 0:26.40 | 0:33.60 | 1584–2015 | 12:1 → 15:1 | none | 5→3→1 |
| 2M4 | Their Turn | 0:33.60 | 0:38.40 | 2016–2303 | 15:1 → 17:1 | L04 (28%) | 3→4 |
| 2M5 | Someone Else | 0:38.40 | 0:43.80 | 2304–2627 | 17:1 → 19:2 | L05 (64%) | 3→4→0 |
| 3M1 | Since I Was a Kid | 0:43.80 | 0:53.40 | 2628–3203 | 19:2 → 23:2 | L06 (84%) | 0→1 |
| 3M2 | My Version of All of That | 0:53.40 | 1:05.40 | 3204–3923 | 23:2 → 28:2 | L07/L08 (64%) | 1→3 |
| 3M3 | Live | 1:05.40 | 1:19.20 | 3924–4751 | 28:2 → 34:1 | L08/L09 (77%) | 3→2 |
| 3M4 | The Math | 1:19.20 | 1:40.80 | 4752–6047 | 34:1 → 43:1 | L10/L11 (83%) | 3→2→3 |
| 3M5 | Built in Code | 1:40.80 | 1:49.80 | 6048–6587 | 43:1 → 46:4 | L12/L13/L14 (73%) | 3 |
| 3M6 | The Mass Driver | 1:49.80 | 2:03.00 | 6588–7379 | 46:4 → 52:2 | L14 (75%) | 3→4→0 |
| 4M1 | I Already Knew | 2:03.00 | 2:12.60 | 7380–7955 | 52:2 → 56:2 | L15/L16 (74%) | 0→2 |
| 4M2 | Survive Testing | 2:12.60 | 2:24.60 | 7956–8675 | 56:2 → 61:2 | L16/L17 (73%) | 2→3 |
| 4M3 | Rejected and Rebuilt | 2:24.60 | 2:35.40 | 8676–9323 | 61:2 → 65:4 | L18 (59%) | 3→4 |
| 5M1 | Territory Claimed | 2:35.40 | 2:42.00 | 9324–9719 | 65:4 → 68:3 | L19/L20 (74%) | 4→3→4 |
| 5M2 | Imagine Making | 2:42.00 | 2:49.20 | 9720–10151 | 68:3 → 71:3 | L20 (17%) | 4→5→2 |
| 5M3 | Everyone Can Play It | 2:49.20 | 2:55.20 | 10152–10511 | 71:3 → 74:1 | L21 (28%) | 2→1→0 |

### 1M1 — Landed First

| Field | Instruction |
|---|---|
| Time | 0:00.00–0:06.60 · frames 0–395 · 1:1 → 3:4 |
| VO | VO-free cold open to 0:03.90. L01 0:03.90–0:07.13: "Getting there first feels like it should count for something." |
| Picture | s01: the Moon swells out of the half-faded head; W1 YOU LANDED FIRST. 0:00.30–0:03.60. s02: touchdown 0:04.20, amber ring blooms ≈0:04.4–0:06.3, dip to black 0:06.30–0:06.60 |
| Function | Make the Moon immense and the Shoot the Moon sound recognisable before the first word, then get out of L01's way |
| Energy | 1 → 2 |
| Tracks | atmos-drone, atmos-air, harmony, claim-lead, impacts |
| Foundry | dark drone and air from 1:1; low boom at 2:4 (velocity ≈0.5) |
| Motif | CLAIM seed: D at 1:3, A at 2:2 (portfolio "arrival" positions); harmony as the portfolio's arrival field (D–A–E), very low |
| Rhythm | none; the touchdown boom is one event, not a pulse |
| Automation | all beds start on frame 0 at bed level; the samples' own fade-ins (0.8–1.0 s) ride the picture's head fade, so add no automation fade. At 0:03.80–0:04.10 harmony and air drop 3–4 dB for L01 |
| Ducking | L01 engages the duck from 0:03.94; the touchdown boom is ducked ≈6 dB, as intended |
| Effects | claim-lead: the portfolio's 150 ms echo; no reverb |
| Into next | no transient at the Citadel cut (3:4): the drone takes on a colder shade (E♭ against D) under L01's last words |

### 1M2 — They Landed Anyway

| Field | Instruction |
|---|---|
| Time | 0:06.60–0:13.20 · frames 396–791 · 3:4 → 6:3 |
| VO | L01 ends 0:07.13; VO-free 0:07.13–0:13.70 |
| Picture | s03 Vesper Citadel hold with push; W2 THEY LANDED ANYWAY. 0:08.10–0:09.60. s04 Vesper's transmission card (native UI, to be read) 0:09.60–0:13.20 |
| Function | introduce the rival; then step back so the text card reads |
| Energy | 2 → 1 |
| Tracks | rival, detail, harmony, atmos-drone, atmos-air |
| Foundry | one metallic strike at 4:1 (the rival's sting); drone and air |
| Motif | RIVAL E♭–D–A–A♭ at 4:1, 4:2, 4:3, 4:3+3/16 (portfolio rhythm); W2 appears between D and A |
| Rhythm | none |
| Automation | at 5:1 (0:09.60): percussion absent; drone and air −6 dB over 0.3 s; harmony thins to one sustained D3 + E♭4 semitone, low |
| Ducking | inactive once L01's release finishes (≈0:09) |
| Effects | rival keeps the portfolio's 520 Hz / 6.2 kHz band |
| Into next | hold the near-silence to 6:3; the decision starts from it |

### 1M3 — How Far

| Field | Instruction |
|---|---|
| Time | 0:13.20–0:18.60 · frames 792–1115 · 6:3 → 8:4 |
| VO | L02 0:13.70–0:14.65 "It doesn't." (dry; falls). L03 0:15.35–0:18.35 "So you decide how far you're willing to go." (the most engaged read of the line, 8.4 st) |
| Picture | s05 LAUNCH AT NULL MERIDIAN? [CANCEL] [FIRE] (native UI), a 5.4 s hold |
| Function | the decision: tension without groove. The joke in "It doesn't." is the voice's, not the music's |
| Energy | 2 → 3 |
| Tracks | sub, claim-lead, harmony, reverse; drive, detail, impacts at 8:4 |
| Foundry | sub-pulse quarters from 6:3 (velocity .55 rising to .75 across bars 7–8); reverse swell 7:4+1/6 → 8:4; at 8:4 mechanical kick + metallic strike + low boom; machine ticks accelerate from 8:4 into 9:1 |
| Motif | CLAIM question: E at 7:1+1/8 (0:14.70), F at 7:2 (0:15.00), inside the 0:14.61–0:15.39 gap. Harmony: the portfolio's decision field (D3 A3 F4) |
| Rhythm | heartbeat only; no groove until 9:1 |
| Automation | `reverse` −10 dB from its start (0:16.60), ramp to 0 dB over 0:18.24 → 0:18.45 (after "go") |
| Ducking | L02/L03 duck the bed; the sub sits below the voice and is unaffected in practice |
| Effects | none new |
| Into next | the swell's end, the 8:4 hit and the tick accelerando are one gesture: liftoff |

### 2M1 — Launch / Orbit / Approach

| Field | Instruction |
|---|---|
| Time | 0:18.60–0:25.80 · frames 1116–1547 · 8:4 → 11:4 |
| VO | none (window 0:18.35–0:33.70) |
| Picture | s06 liftoff (warhead visible ≈0:18.80); s07 HERO limb crossing 0:19.20 (protected); s08 nose-down 0:21.60; s09 terminal approach 0:24.00 with E1 0:24.30–0:25.65 |
| Function | the game's propulsion: the one passage where the portfolio groove plays essentially as composed (portfolio bars 7–9, two bars later) |
| Energy | 3 → 4 |
| Tracks | drive, detail, sub, bass-motion, claim-lead, harmony, riser, atmos-drone, atmos-air, impacts |
| Foundry | kick cell 1, 2+1/8, 3+1/8, 4+1/8; industrial snare on 2 and 4; machine ticks in eighths, sixteenths from 11:1; sparse sub pulses; tension riser 10:1+1/12 → 11:4; low boom on phrase boundaries only |
| Motif | CLAIM orbit phrase (portfolio "decision-orbit"): D–A–E–F on the kick cell, then the upper-D variant |
| Rhythm | the portfolio groove; bass D–C–B♭–A in eighths with the revised .225 s articulation |
| Automation | at 11:4 every sounding track ramps to −60 dB over 0:25.785 → 0:25.800; the riser ends there by itself |
| Ducking | none |
| Effects | drive: saturation then compressor (§9) |
| Into next | the vacuum |

### 2M2 — Vacuum

| Field | Instruction |
|---|---|
| Time | 0:25.80–0:26.40 · frames 1548–1583 · 11:4 → 12:1 |
| VO | none |
| Picture | the last 600 ms of the approach; the flash ramps from 0:26.32 |
| Function | silence as the setup for the biggest hit |
| Energy | 0 |
| All tracks | silent: ≤ −80 dBFS RMS, digital silence from 0:25.90 (the portfolio reached −92 dBFS). Possible only because no track in 2M1 carries reverb or delay |
| Into next | FIRST STRIKE exactly on 12:1 |

### 2M3 — First Strike / The Moon Remembers

| Field | Instruction |
|---|---|
| Time | 0:26.40–0:33.60 · frames 1584–2015 · 12:1 → 15:1 |
| VO | none |
| Picture | amber dome 0:26.40; ejecta and shock ring 0:28.80; FIRST STRIKE COMPLETE · THE MOON REMEMBERS 0:31.80, fading to black by 0:33.58 |
| Function | the loudest moment of the film, then the first real breath |
| Energy | 5 → 3 → 1 |
| Tracks | impacts, drive, harmony, detail, claim-lead, atmos-air, atmos-drone |
| Foundry | **cinematic impact (first of its only two uses) + low boom + mechanical kick** on 12:1; ejecta: restrained boom at 13:1, spaced metallic strikes and ticks; breath: air only |
| Motif | dissonant D field (D3 A3 E♭4) on the hit; CLAIM descending fragment E→D (portfolio positions, now 13:2 and 13:3+1/8); breath on A/E |
| Rhythm | no groove after 12:1 |
| Automation | from 14:2 (0:31.80) everything except air and the A/E suspension reaches −60 dB by 14:4 (0:33.00); air and suspension follow the picture to −60 at 0:33.58. The breath must be a real drop (portfolio lesson: ≥ 7 dB below the reversal) |
| Ducking | none |
| Effects | none |
| Into next | near-silence into the reversal jolt at 15:1 |

### 2M4 — Their Turn

| Field | Instruction |
|---|---|
| Time | 0:33.60–0:38.40 · frames 2016–2303 · 15:1 → 17:1 |
| VO | L04 0:33.70–0:35.12 "Then it's their turn." (conversational; chosen because it avoids a trailer read). VO-free 0:35.12–0:38.60 |
| Picture | s13 FIRE NOW out of black 0:33.60; s14 cyan dive 0:34.80 (E2 to 0:35.82); flash 0:35.92; s15 COUNTERSTRIKE contact 0:36.00, debris rain to 0:38.40 |
| Function | the reversal reads dry, then the counter-hit |
| Energy | 3 → 4 |
| Tracks | drive, sub, rival, reverse, impacts, detail, alarm, harmony, bass-motion |
| Foundry | 15:1: kick + sub only. Reverse swell 15:1+1/6 → 16:1. 16:1: brighter metallic strike + industrial snare + alarm, **cinematic impact at reduced velocity** (second and last use; portfolio .49), low boom offset to 0:36.15. Debris: spaced ticks and steel |
| Motif | RIVAL reversed, A♭–A–D–E♭ in sixteenths from 15:3+3/16 (0:35.25); harmony B♭3 D4 A♭4 (portfolio reversal field) |
| Rhythm | nothing under L04; a one-beat kick/tick flurry into 16:1 (portfolio "incoming-roar") |
| Automation | `reverse` −10 dB until 0:35.08, ramp to 0 dB by 0:35.30; `impacts` +2 dB for 0:36.00–0:37.20 |
| Ducking | L04 ducks 0:33.74–≈0:35.30; ≈2.2 dB remains at 16:1, compensated above |
| Effects | none new |
| Into next | debris thins by 17:1; the Octogonal cell starts underneath L05 |

### 2M5 — Someone Else

| Field | Instruction |
|---|---|
| Time | 0:38.40–0:43.80 · frames 2304–2627 · 17:1 → 19:2 |
| VO | L05 0:38.60–0:42.71 "And while you're busy with each other, [0.56 s breath] someone else shows up." |
| Picture | s16 Octogonal lead locked (E3 THIRD-PARTY CONTACT / THE OCTOGONALS); s17 violet volley 0:40.80; s18 cyan defense beam 0:42.60; the lead breaks apart; HARD CUT to black at 0:43.80 |
| Function | the third power, and the end of the trailer |
| Energy | 3 → 4 → 0 |
| Tracks | drive, sub, detail, alarm, rival, bass-motion, impacts |
| Foundry | bar 17: 3+3+2 in kick and sub (eighths) + ticks. **18:1 (in the breath):** alarm D/A♭ + metallic strike + snare. After 0:41.04: 3+3+2 in sixteenths, kick and ticks only. 18:4: kick/boom on the beam cut. 18:4+1/16: bright steel + short alarm. Then the last burst to 19:2 |
| Motif | THIRD PARTY; RIVAL high tritone colour (D5 / A♭5 / E♭5) only after 0:42.67 |
| Rhythm | eighths → sixteenths at 18:1: faster with no tempo change |
| Automation | +3 dB on the volley accent notes in 0:40.80–0:41.04; +4 dB on the 18:4+1/16 steel. **HARD CUT:** every sounding track ramps to −60 dB over 0:43.785 → 0:43.800 and stays there until its next entrance. No claim-lead note after 0:43.50 (its 150 ms echo must not cross the cut). The portfolio's claim-secured sting, which falls exactly here (reel 17:2 = film 19:2), is **not** played: the cut replaces it, and it is spent at 65:4 |
| Ducking | engaged through L05; release begins 0:42.71; the last burst rises naturally with it |
| Effects | no reverb or delay on any track here |
| Into next | silence |

### 3M1 — Since I Was a Kid

| Field | Instruction |
|---|---|
| Time | 0:43.80–0:53.40 · frames 2628–3203 · 19:2 → 23:2 |
| VO | L06 0:44.10–0:53.17 "I've wanted to make something like this since I was a kid playing StarCraft, reading Dune, and searching the library for anything I could find about space." Pauses 0:48.14–0:48.57 and 0:49.38–0:49.82; the ending rises slightly (open) |
| Picture | s19 SYSTEMS chapter card on black (C1 0:44.10–0:46.05); s20 the game's own launch gate, SHOOT THE MOON lockup (S1 BROWSER-NATIVE 0:46.65–0:53.25) |
| Function | the person. The most intimate passage; the score is almost absent |
| Energy | 0 → 1 |
| Tracks | harmony, atmos-air, claim-bell |
| Foundry | air only (above 3.5 kHz). No drone, no percussion |
| Motif | **silence for one full bar (19:2 → 20:2)** under "I've wanted to make something like this since I was a kid". At 20:2, with the title screen, the CLAIM seed as harmony (open fifth D–A, low). CLAIM question in the maker's voice: claim-bell D 21:1+1/8, A 21:3+1/8, E 23:1+1/8, F on the Crater Crown cut 23:2 |
| Rhythm | none; no pulse under L06 |
| Automation | harmony from −60 dB at 20:2, linear to bed level over 1.2 s; air enters at 20:2, 10–12 dB under its cold-open level |
| Ducking | engaged; the bed must already be ≥ 12 dB under the voice before the duck (target 18 dB with it) |
| Effects | claim-bell reverb (room 0.55, 1.2 s, wet 0.22) + 300 ms echo (wet 0.12) |
| Into next | F on 23:2 leads into "Shoot the Moon became…" |

### 3M2 — My Version of All of That

| Field | Instruction |
|---|---|
| Time | 0:53.40–1:05.40 · frames 3204–3923 · 23:2 → 28:2 |
| VO | L07 0:53.77–1:04.47 "Shoot the Moon became my version of all of that: territory, machines, escalation, and a Moon that actually feels enormous." List pauses of 0.50–0.79 s give it weight; the ending rises on "enormous" |
| Picture | s20a Crater Crown 0:53.40; s20b Helios Spire 0:57.60; s20c the full Moon 1:00.00–1:05.40 |
| Function | the childhood idea becomes the game; the first awe |
| Energy | 1 → 3 |
| Tracks | harmony, strings, detail, sub, atmos-air |
| Foundry | machine ticks enter at 25:4, in the pause after "machines" (low velocity, eighths); sub joins softly from 26:3; air widens for the Moon |
| Motif | no melody (the list carries it). Harmony: open fifth → D minor colour under "became my version of all of that". **B♭ lydian** (B♭–D–E–F) enters at 26:3 in the gap after "escalation", swells under "a Moon that actually feels enormous", peaks at 28:1 (1:04.80) in the 1:04.44–1:05.43 gap |
| Rhythm | ticks only; sub quarters from 26:3 |
| Automation | `strings` +4 dB ramp 1:04.44 → 1:04.80, back to bed level by 1:05.40 |
| Ducking | engaged; the bloom peak sits in the release (≈4 dB residual, compensated) |
| Effects | strings reverb (room 0.7, 1.8 s, wet 0.25): the score's only large space |
| Into next | the bloom hands over to the pulse on the 28:2 cut |

### 3M3 — Live

| Field | Instruction |
|---|---|
| Time | 1:05.40–1:19.20 · frames 3924–4751 · 28:2 → 34:1 |
| VO | L08 1:05.39–1:12.99 "And none of this is a cutscene. It's the game running live in a browser, built for a phone as much as a desktop." (9.4 st, by far the livelier of its two takes). L09 1:13.79–1:18.49 "Every site exists at a real latitude and longitude on a lunar sphere." (steady; decisive fall) |
| Picture | s21 real phone recording: TRACKING, FIRE NOW ≈1:07.84, tap ≈1:08.36, camera chase (S2 graphic). s22 SELECTED LANDING SITE panel from 1:13.20 (31:3); S3 brackets 1:13.65 |
| Function | "live": the pulse returns; then precision |
| Energy | 3 → 2 |
| Tracks | detail, sub, bass-motion, harmony, atmos-air |
| Foundry | machine ticks in eighths from 28:2 (velocities alternating ≈.35 / .55); sub quarters; no kick. From 31:3: soft sixteenth ticks, bass out |
| Motif | none: the pulse is the statement. Harmony back to D |
| Rhythm | steady eighths → soft sixteenths ("precision bed") |
| Automation | at 31:3: `bass-motion` to −60 over 0.3 s, `detail` −3 dB |
| Ducking | engaged; the 0.65–0.88 s pauses lift the bed ≈2–3 dB, acceptable on a ticking texture |
| Effects | bass-motion compressor |
| Into next | the route board at 34:1 |

### 3M4 — The Math

| Field | Instruction |
|---|---|
| Time | 1:19.20–1:40.80 · frames 4752–6047 · 34:1 → 43:1 |
| VO | L10 1:19.49–1:25.58 "One of the key moments that changed the project was realizing how good the frontier models had become at math." L11 1:26.08–1:39.91 "We used that to work out flight paths around the Moon, validate a hundred-and-thirty-two-degree route at two thousand and forty-eight points, and design camera moves I probably would have never even tried." |
| Picture | s23 route diagram (globe 1:19.35, sites 1:20.10, arc draws 1:20.70–1:23.70, values from 1:24.90); s24 STRIKE_ROUTE_SAFETY excerpt, cut 1:32.40 (39:3); s24a flight recording 1:36.00 (in-game cut to space ≈1:38.30) |
| Function | discovery, then mathematics; the trailer's flight comes back as numbers, then as camera |
| Energy | 3 → 2 → 3 |
| Tracks | bass-motion, strings, harmony, detail, sub, drive (kick body), claim-lead |
| Foundry | ticks soft; sub; from 41:1 the orbit kick cell at low velocity (kick body + sub; no snare) |
| Motif | the orbit bass line D–C–B♭–A as **whole notes** from 34:1: the flight from 0:19.20, slowed to mathematics. Strings enter at 34:3 (1:20.40), rising through the arc draw. Resolve on the code cut at 39:3, inside the 1:32.21–1:32.59 pause. CLAIM orbit fragment (claim-lead) in the 1:39.83–1:40.97 gap, after "never even tried" |
| Rhythm | ticks + sub; under the spoken numbers (bars 38–40) only ticks and a sustained bass; soft kick cell from 41:1 |
| Automation | harmony and strings −3 dB across bars 38–40 (numbers and code text) |
| Ducking | engaged (83% speech); pauses ≤ 1.14 s |
| Effects | strings reverb |
| Into next | the claim-lead fragment ends by 1:40.90: just across the 43:1 cut, before "Then" (1:40.93) |

### 3M5 — Built in Code

| Field | Instruction |
|---|---|
| Time | 1:40.80–1:49.80 · frames 6048–6587 · 43:1 → 46:4 |
| VO | L12 1:40.93–1:43.79 "Then [0.56 s] I started pushing the visual side harder." (11.9 st, the pivot). L13 1:44.29–1:48.21 "The monuments, machines, and animations are all built in code." |
| Picture | s25 mining-laser close-up with the live HUD; S6 ZERO MODEL FILES / WRITTEN IN TYPESCRIPT 1:41.25–1:49.65 |
| Function | the visual and mechanical turn; prepare the mass driver |
| Energy | 3 |
| Tracks | harmony, detail, drive (kick body), sub, bass-motion; atmos-drone from 46:4 |
| Foundry | ticks to sixteenths; kick body on 1 and 3, low; sub; the dark drone enters at 46:4 with the Helios cut |
| Motif | the lift in the 1:41.35–1:41.91 pause after "Then": harmony steps up (a C colour over the D pedal) and the detail brightens |
| Rhythm | growing mechanical density under L13 |
| Automation | the drone enters from −60 dB at 46:4 over 0.6 s |
| Ducking | engaged |
| Effects | drone 130 Hz–1.8 kHz band |
| Into next | the Helios cut at 46:4 |

### 3M6 — The Mass Driver

| Field | Instruction |
|---|---|
| Time | 1:49.80–2:03.00 · frames 6588–7379 · 46:4 → 52:2 |
| VO | L14 1:49.11–2:01.33 "The mass driver is still one of my favorites. [0.68 s] It started as an idea in my head and gradually became this huge mechanical thing [0.61 s] that actually feels like it belongs on the Moon." (the author's favourite machine; firm falling ending) |
| Picture | s25a continuous Helios capture: rings turning; charge from ≈1:50.80; sled into position ≈1:52.00; **sled acceleration 1:52.80 (48:1); launch 1:53.70 (48:2+1/8)**; recoil to 1:54.40; sled return to ≈1:56.60; the camera pulls back; next charge only from ≈2:02.80; HARD CUT at 2:03.00 |
| Function | the mechanical peak of SYSTEMS, mostly under the voice, released in its last 1.65 s |
| Energy | 3 → 4 → 0 |
| Tracks | drive, detail, sub, bass-motion, impacts, atmos-drone, harmony |
| Foundry | charge: ticks accelerate (eighths → sixteenths → sextuplets by 48:1), sub doubles to eighths. Launch 48:2+1/8: low boom with sub weight, and the ticks rest for one beat. Recovery: machine bass in eighths, kick body. Metallic strike in the 1:58.19–1:58.80 pause after "mechanical thing". From 51:3+1/16: kick cell, snare, ticks, steel, sub, bass; low boom on 52:1 |
| Motif | MACHINE at full; harmony D minor with E♭ colour (the game world's semitone returns as machinery) |
| Rhythm | accelerando → release → groove |
| Automation | under L14, drive and detail at under-VO level; at 51:3+1/16 they open (+6 dB over 0.15 s) and the duck's release adds a natural crescendo (≈6 → 0.9 dB residual). **HARD CUT:** every sounding track ramps to −60 dB over 2:02.985 → 2:03.000 |
| Ducking | engaged until 2:01.33 |
| Effects | drive saturation + compressor; no reverb or delay on any track sounding after 2:01.00 |
| Into next | silence under "I didn't ask a model to invent this." |

### 4M1 — I Already Knew

| Field | Instruction |
|---|---|
| Time | 2:03.00–2:12.60 · frames 7380–7955 · 52:2 → 56:2 |
| VO | L15 2:03.30–2:08.07 "I didn't ask a model to invent this. [0.58 s] I already knew the game I wanted to make." (assertive; both sentences fall). L16 2:08.99–2:13.82 "Claude and Codex became collaborators I could direct, test, and challenge." (restrained) |
| Picture | s26 BUILD card (C2 HOW IT WAS MADE / THE BUILD 2:03.30–2:05.40); s27 workflow diagram 2:05.40 (DIRECTION 2:05.70, BUILD 2:06.90, ITERATE 2:08.10, CAPTURE 2:09.30, QA 2:10.50, loop 2:11.10) |
| Function | authorship: warm, firm, quiet |
| Energy | 0 → 2 |
| Tracks | strings, harmony, sub, detail, claim-bell, atmos-air |
| Foundry | process pulse: sub on beats 1 and 3, machine ticks in eighths at velocity ≤ .4. No kick, no steel |
| Motif | **silence for one full bar (52:2 → 53:2)**, rhyming with 0:43.80. At 53:2, as L15's pause begins (2:05.42–2:06.00), a warm low chord (strings; B♭ / D colour). CLAIM fragment 1: claim-bell D in the 2:08.04–2:09.03 pause |
| Rhythm | the process pulse starts at 53:2: steady, unhurried |
| Automation | strings fade in over 0.4 s at 53:2 |
| Ducking | engaged |
| Effects | strings reverb; claim-bell reverb + echo |
| Into next | bass half notes at 56:2 |

### 4M2 — Survive Testing

| Field | Instruction |
|---|---|
| Time | 2:12.60–2:24.60 · frames 7956–8675 · 56:2 → 61:2 |
| VO | end of L16; L17 2:14.72–2:23.87 "My background in QA helped more than I expected. [0.71 s] I treated every feature like something that had to survive testing, [0.78 s] not just look right once." |
| Picture | s28 four before/after pairs, swapping every 1.8 s (2:12.60, 2:14.40, 2:16.20, 2:18.00); s29 capture grid 2:19.80; verification ticks 2:20.40–2:22.70 |
| Function | rigour; the motif being re-assembled |
| Energy | 2 → 3 |
| Tracks | bass-motion, sub, detail, claim-bell, strings, harmony |
| Foundry | ticks; verification mirror: 24 machine-tick sextuplets 59:3 → 60:3 at velocity ≤ .35, then stop; no steel |
| Motif | CLAIM fragments: D–A (2:13.78 pause), D–A–E (2:17.66), D–A–E tighter (2:21.53) |
| Rhythm | process pulse + bass half notes from 56:2. No accents on the 3-beat pair swaps |
| Automation | strings rise slowly from 60:1 toward 61:2 |
| Ducking | engaged; this is the pumping test (pauses 0.71–0.99 s): the bed must not audibly swell |
| Effects | as 4M1 |
| Into next | the QA board at 61:2 |

### 4M3 — Rejected and Rebuilt

| Field | Instruction |
|---|---|
| Time | 2:24.60–2:35.40 · frames 8676–9323 · 61:2 → 65:4 |
| VO | L18 2:24.77–2:33.39 "Bad captures got recaptured. [0.82 s] Bugs got reproduced. [0.68 s] Ideas got rejected and rebuilt." (the three-part rhythm is the line). VO-free 2:33.39–2:35.60 |
| Picture | s30 QA board: BEFORE (title-screen ghosting) / AFTER (recaptured); brackets 2:25.50; AFTER kicker 2:26.25 |
| Function | the last climb before the payoff |
| Energy | 3 → 4 |
| Tracks | drive (kick body), sub, bass-motion, strings, harmony, claim-bell, detail, reverse |
| Foundry | kick body on beat 1 (low) from 61:2; sub quarters; answer 2: two machine ticks and one soft metallic strike in the 2:29.62–2:30.30 pause; reverse swell 64:4+1/6 → 65:4 |
| Motif | CLAIM complete, D–A–E–F, after "recaptured" (2:26.93 pause): the question fully re-assembled |
| Rhythm | steady quarter pulse. Three sentences, two answers, one swell |
| Automation | strings and harmony ramp up through bars 63–64; reverse swell at full level (VO-free) |
| Ducking | engaged until 2:33.39; ≈0.6 dB remains at 2:35.40 |
| Effects | as above |
| Into next | the arrival at 65:4 |

### 5M1 — Territory Claimed

| Field | Instruction |
|---|---|
| Time | 2:35.40–2:42.00 · frames 9324–9719 · 65:4 → 68:3 |
| VO | L19 2:35.60–2:38.93 "What I'm proudest of [0.47 s] isn't that models wrote code." (11 st; the lift on "proudest"). L20 from 2:39.53 "It's that this feels like the kind of game [0.56 s] I used to imagine making." |
| Picture | s31 TERRITORY CLAIMED · PERMANENT (native) 2:35.40; s32 Helios 2:37.20 (muzzle flash 2:38.10); s33 Signal Array 2:39.00; s34 Crater Crown 2:40.20; s35 pull-back from 2:42.00; P1 monument titles |
| Function | back in the game; the statement of pride. Harmony moves only in the author's pauses |
| Energy | 4 → 3 → 4 |
| Tracks | strings, harmony, bass-motion, claim-lead, impacts, drive, sub, atmos-air |
| Foundry | soft low boom at 65:4; soft boom at 66:4+1/8 (the c22 flash, a callback to 48:2+1/8, sub weight only); kick cell + sub from 67:2 at low velocity, no snare |
| Motif | at 65:4: B♭(add9) in strings and harmony, plus **the portfolio's claim-secured chord D/A/E** as a claim-lead staccato sixteenth (ends 2:35.55, before the first word at 2:35.64). **G sus/add9 at 66:3** (on the c22 cut, ending L19's pause). **A sus at 67:2** (inside the L19/L20 pause), held |
| Rhythm | none until 67:2, then the soft orbit kick cell |
| Automation | none special |
| Ducking | engaged from 2:35.64; the arrival is heard unducked for ≈0.25 s |
| Effects | strings reverb |
| Into next | the A sus is held into the pull-back |

### 5M2 — Imagine Making

| Field | Instruction |
|---|---|
| Time | 2:42.00–2:49.20 · frames 9720–10151 · 68:3 → 71:3 |
| VO | L20 to 2:43.66; then VO-free to 2:49.50 |
| Picture | s35 one continuous pull-back from the Bastion Ziggurat to the claimed Moon; baked dip to black 2:48.60–2:49.20 |
| Function | **the emotional payoff** |
| Energy | 4 → 5 → 2 |
| Tracks | strings, harmony, claim-bell + claim-lead (octaves), bass-motion, sub, drive, impacts, atmos-air |
| Foundry | half-time mechanical kick + sub on 70:1, 70:3, 71:1; one soft low boom at 70:1; air widened. No snare, no steel, no riser |
| Motif | **CLAIM realised.** 69:2 (2:43.80): bass resolves to D, third withheld (D–A–E); the motif rises D–A–E in both voices; **F♯ on 70:1 (2:45.60)**, the first major third in the film; then the portfolio's descending E–D–A, settling into D(add9) by 71:2 |
| Rhythm | half-time gravity only |
| Automation | no ramp at 69:2: the duck's release (≈4.1 dB at 2:43.80 → ≈0.6 dB at 2:45.60) is the crescendo. At the dip (71:2, 2:48.60) drive, sub, impacts, claim-lead and bass-motion release to −60 over 0.6 s; strings, harmony, air and claim-bell hold |
| Ducking | releasing; no VO 2:43.66–2:49.50 |
| Effects | strings and claim-bell reverbs |
| Into next | the sustained chord crosses into the end card |

### 5M3 — Everyone Can Play It

| Field | Instruction |
|---|---|
| Time | 2:49.20–2:55.20 · frames 10152–10511 · 71:3 → 74:1 (end) |
| VO | L21 2:49.50–2:51.96 "And now [0.74 s] everyone can play it." The final "it" (2:51.55–2:51.92) is ≈14 dB under the line and must survive |
| Picture | s36 end card on black: SHOOT/MOON 2:49.50, THE 2:50.10, crescent waxes 2:50.70–2:51.30, tagline 2:51.30, PLAY IT IN YOUR BROWSER + URL 2:51.90, footer 2:52.20; held to the last frame |
| Function | resolution: let the last sentence land; end in silence on the held card |
| Energy | 2 → 1 → 0 |
| Tracks | strings, harmony, atmos-air, claim-bell |
| Foundry | air only |
| Motif | sustained D(add9) re-voiced at 71:3 with no transient. **Nothing in the 2:49.98–2:50.72 pause.** One soft claim-bell D at 73:1 (2:52.80), the film's first motif note, now consonant |
| Rhythm | none |
| Automation | staged releases: bass already out; harmony and strings release across 73:1–73:3; air fades 2:53.40 → 2:54.60. Every dry signal at −60 dB by 2:54.60 |
| Ducking | L21 ducks the chord ≈6 dB; the release after 2:51.96 slightly lifts what remains, which is fine because the releases are already under way |
| Effects | reverb on anything sounding after 2:52.80 at ≤ 1.2 s decay, so the residue is ≤ −60 dBFS RMS in 2:55.10–2:55.20 |
| Boundary | 175.2 s = 7,726,320 frames = `74:1`; `render.tail` `none` |

---

## 12. 73-bar map

| Bar | Film time | Frames | Act | Picture | VO (speech %) | Cue | Musical role | E |
|---:|---|---|---|---|---|---|---|---|
| 1 | 0:00.00–0:02.40 | 0–143 | WORLD | s01 | none | 1M1 | Drone + air from frame 0; claim seed D at 1:3. | 1 |
| 2 | 0:02.40–0:04.80 | 144–287 | WORLD | s01, s02 | L01 (36%) | 1M1 | Claim A at 2:2 completes the open fifth; touchdown: soft low boom at 2:4 under L01. | 1 |
| 3 | 0:04.80–0:07.20 | 288–431 | WORLD | s02, s03 | L01 (95%) | 1M1/1M2 | Hold under L01; colder shade (E♭ against D) at the Citadel cut 3:4 — no transient. | 2 |
| 4 | 0:07.20–0:09.60 | 432–575 | WORLD | s03 | none | 1M2 | Vesper motif E♭–D–A–A♭ + one metallic strike at 4:1 (after L01). | 2 |
| 5 | 0:09.60–0:12.00 | 576–719 | WORLD | s04 | none | 1M2 | Transmission card: percussion absent, atmosphere −6 dB, sparse D/E♭. | 1 |
| 6 | 0:12.00–0:14.40 | 720–863 | WORLD | s04, s05 | L02 (27%) | 1M2/1M3 | Launch dialog at 6:3: sub heartbeat begins. No sting after "It doesn't." | 2 |
| 7 | 0:14.40–0:16.80 | 864–1007 | WORLD | s05 | L02/L03 (59%) | 1M3 | Claim E–F in the L02/L03 gap (7:1+1/8, 7:2); heartbeat continues. | 2 |
| 8 | 0:16.80–0:19.20 | 1008–1151 | WORLD→ESCALATION | s05, s06 | L03 (59%) | 1M3/2M1 | Reverse swell 7:4+1/6 → 8:4 (held low under L03); liftoff hit at 8:4; tick accelerando. | 3 |
| 9 | 0:19.20–0:21.60 | 1152–1295 | ESCALATION | s07 | none | 2M1 | Orbit groove opens at 9:1 (kick cell, snare 2 & 4, bass D–C–B♭–A, claim orbit phrase). | 4 |
| 10 | 0:21.60–0:24.00 | 1296–1439 | ESCALATION | s08 | none | 2M1 | Groove continues; riser onset 10:1+1/12. | 4 |
| 11 | 0:24.00–0:26.40 | 1440–1583 | ESCALATION | s09 | none | 2M1/2M2 | Sixteenth ticks from 11:1; riser ends 11:4; vacuum 11:4–12:1. | 4→0 |
| 12 | 0:26.40–0:28.80 | 1584–1727 | ESCALATION | s10 | none | 2M3 | FIRST STRIKE at 12:1 — the loudest moment. | 5 |
| 13 | 0:28.80–0:31.20 | 1728–1871 | ESCALATION | s11 | none | 2M3 | Ejecta: restrained boom, spaced steel/ticks, descending claim E→D. | 3 |
| 14 | 0:31.20–0:33.60 | 1872–2015 | ESCALATION | s11, s12 | none | 2M3 | Breath from 14:2 (air + A/E), fading with the picture to near-silence. | 1 |
| 15 | 0:33.60–0:36.00 | 2016–2159 | ESCALATION | s13, s14 | L04 (56%) | 2M4 | Low jolt at 15:1; L04; reversed rival after "turn"; reverse swell to 16:1. | 3 |
| 16 | 0:36.00–0:38.40 | 2160–2303 | ESCALATION | s15 | none | 2M4 | COUNTERSTRIKE at 16:1 (secondary, brighter); debris. | 4 |
| 17 | 0:38.40–0:40.80 | 2304–2447 | ESCALATION | s16 | L05 (77%) | 2M5 | Octogonal 3+3+2 in kick/sub/ticks under L05; no tones under words. | 3 |
| 18 | 0:40.80–0:43.20 | 2448–2591 | ESCALATION | s17, s18 | L05 (68%) | 2M5 | Volley in the L05 breath at 18:1; double-time; beam 18:4 / steel 18:4+1/16. | 4 |
| 19 | 0:43.20–0:45.60 | 2592–2735 | ESCALATION→SYSTEMS | s18, s19 | L06 (61%) | 2M5/3M1 | Last burst to 19:2, then HARD CUT to silence; L06 begins. | 4→0 |
| 20 | 0:45.60–0:48.00 | 2736–2879 | SYSTEMS | s19, s20 | L06 (100%) | 3M1 | Open fifth D–A fades in at 20:2 with the title screen; air sheen. | 1 |
| 21 | 0:48.00–0:50.40 | 2880–3023 | SYSTEMS | s20 | L06 (64%) | 3M1 | Claim-bell D (21:1+1/8) and A (21:3+1/8) in L06's two list pauses. | 1 |
| 22 | 0:50.40–0:52.80 | 3024–3167 | SYSTEMS | s20 | L06 (100%) | 3M1 | Hold the open fifth; nothing new under "searching the library". | 1 |
| 23 | 0:52.80–0:55.20 | 3168–3311 | SYSTEMS | s20, s20a | L06/L07 (69%) | 3M1/3M2 | Claim-bell E (23:1+1/8) after "space", F on the Crater Crown cut (23:2). | 1→2 |
| 24 | 0:55.20–0:57.60 | 3312–3455 | SYSTEMS | s20a | L07 (78%) | 3M2 | Harmony moves under "became my version of all of that". | 2 |
| 25 | 0:57.60–1:00.00 | 3456–3599 | SYSTEMS | s20b | L07 (55%) | 3M2 | First machine ticks enter in the pause after "machines". | 2 |
| 26 | 1:00.00–1:02.40 | 3600–3743 | SYSTEMS | s20c | L07 (60%) | 3M2 | Full-Moon hold at 26:1; B♭ (strings, low) enters at 26:3 in the gap after "escalation". | 2 |
| 27 | 1:02.40–1:04.80 | 3744–3887 | SYSTEMS | s20c | L07 (69%) | 3M2 | B♭ lydian bloom swells under "…a Moon that actually feels enormous". | 3 |
| 28 | 1:04.80–1:07.20 | 3888–4031 | SYSTEMS | s20c, s21 | L08 (57%) | 3M2/3M3 | Bloom peaks at 28:1 in the gap; machine pulse returns at 28:2 (phone board). | 3 |
| 29 | 1:07.20–1:09.60 | 4032–4175 | SYSTEMS | s21 | L08 (83%) | 3M3 | Live pulse steady; bass pedal D enters. FIRE NOW / tap not hit. | 3 |
| 30 | 1:09.60–1:12.00 | 4176–4319 | SYSTEMS | s21 | L08 (73%) | 3M3 | Pulse continues; small lift for "built for a phone as much as a desktop". | 3 |
| 31 | 1:12.00–1:14.40 | 4320–4463 | SYSTEMS | s21, s22 | L08/L09 (63%) | 3M3 | Landing-site panel at 31:3: thin to soft sixteenth ticks, bass out. | 2 |
| 32 | 1:14.40–1:16.80 | 4464–4607 | SYSTEMS | s22 | L09 (100%) | 3M3 | Precision bed under L09. | 2 |
| 33 | 1:16.80–1:19.20 | 4608–4751 | SYSTEMS | s22 | L09 (69%) | 3M3 | Precision bed; prepare the route (low D in strings). | 2 |
| 34 | 1:19.20–1:21.60 | 4752–4895 | SYSTEMS | s23 | L10 (86%) | 3M4 | Route board at 34:1: orbit bass as whole notes; strings enter low. | 3 |
| 35 | 1:21.60–1:24.00 | 4896–5039 | SYSTEMS | s23 | L10 (100%) | 3M4 | Lift continues through the draw-on (ends 1:23.70). | 3 |
| 36 | 1:24.00–1:26.40 | 5040–5183 | SYSTEMS | s23 | L10/L11 (75%) | 3M4 | Hold; values appear (132° at 1:24.90) — not hit. | 3 |
| 37 | 1:26.40–1:28.80 | 5184–5327 | SYSTEMS | s23 | L11 (100%) | 3M4 | Hold; 760 KM / 24 KM / 2,048 appear — not hit. | 3 |
| 38 | 1:28.80–1:31.20 | 5328–5471 | SYSTEMS | s23 | L11 (77%) | 3M4 | Thin under the spoken numbers (ticks + sustained bass only). | 3 |
| 39 | 1:31.20–1:33.60 | 5472–5615 | SYSTEMS | s23, s24 | L11 (84%) | 3M4 | Code cut at 39:3 inside the gap after "route": resolve there; hold for reading. | 3→2 |
| 40 | 1:33.60–1:36.00 | 5616–5759 | SYSTEMS | s24 | L11 (80%) | 3M4 | Minimal under "two thousand and forty-eight points". | 2 |
| 41 | 1:36.00–1:38.40 | 5760–5903 | SYSTEMS | s24a | L11 (86%) | 3M4 | Flight board at 41:1: soft orbit kick cell (kick body + sub). | 3 |
| 42 | 1:38.40–1:40.80 | 5904–6047 | SYSTEMS | s24a | L11 (60%) | 3M4 | Claim-lead orbit fragment in the 1:39.84–1:40.97 gap. | 3 |
| 43 | 1:40.80–1:43.20 | 6048–6191 | SYSTEMS | s25 | L12 (70%) | 3M5 | Mining capture at 43:1; lift in the gap after "Then". | 3 |
| 44 | 1:43.20–1:45.60 | 6192–6335 | SYSTEMS | s25 | L12/L13 (75%) | 3M5 | Mechanical detail grows under L13. | 3 |
| 45 | 1:45.60–1:48.00 | 6336–6479 | SYSTEMS | s25 | L13 (95%) | 3M5 | Hold under "…all built in code". | 3 |
| 46 | 1:48.00–1:50.40 | 6480–6623 | SYSTEMS | s25, s25a | L13/L14 (59%) | 3M5/3M6 | Helios at 46:4: dark drone (machinery) enters; sub quarters. | 3 |
| 47 | 1:50.40–1:52.80 | 6624–6767 | SYSTEMS | s25a | L14 (72%) | 3M6 | Charge: tick accelerando, sub doubling. | 4 |
| 48 | 1:52.80–1:55.20 | 6768–6911 | SYSTEMS | s25a | L14 (100%) | 3M6 | Sled at 48:1; LAUNCH at 48:2+1/8: low boom, ticks rest one beat. | 4 |
| 49 | 1:55.20–1:57.60 | 6912–7055 | SYSTEMS | s25a | L14 (89%) | 3M6 | Recovery: machine bass eighths (low), D minor + E♭ colour. | 3 |
| 50 | 1:57.60–2:00.00 | 7056–7199 | SYSTEMS | s25a | L14 (75%) | 3M6 | Metallic strike in the gap after "mechanical thing". | 3 |
| 51 | 2:00.00–2:02.40 | 7200–7343 | SYSTEMS | s25a | L14 (53%) | 3M6 | Machine opens to full at 51:3+1/16 (2:01.35), right after L14. | 4 |
| 52 | 2:02.40–2:04.80 | 7344–7487 | SYSTEMS→BUILD | s25a, s26 | L15 (62%) | 3M6/4M1 | Full to 52:2, then HARD CUT to silence; L15 begins. | 4→0 |
| 53 | 2:04.80–2:07.20 | 7488–7631 | BUILD | s26, s27 | L15 (76%) | 4M1 | Warm low chord + process pulse at 53:2, as L15's pause begins. | 1 |
| 54 | 2:07.20–2:09.60 | 7632–7775 | BUILD | s27 | L15/L16 (59%) | 4M1 | Claim-bell D (one note) after "…wanted to make". | 2 |
| 55 | 2:09.60–2:12.00 | 7776–7919 | BUILD | s27 | L16 (80%) | 4M1 | Process pulse; warm harmony (B♭, G) under L16. | 2 |
| 56 | 2:12.00–2:14.40 | 7920–8063 | BUILD | s27, s28 | L16 (71%) | 4M1/4M2 | Bass half notes at 56:2; claim-bell D–A after "challenge". | 2 |
| 57 | 2:14.40–2:16.80 | 8064–8207 | BUILD | s28 | L17 (85%) | 4M2 | Steady; iteration pair swaps (every 3 beats) not hit. | 2 |
| 58 | 2:16.80–2:19.20 | 8208–8351 | BUILD | s28 | L17 (70%) | 4M2 | Claim-bell D–A–E after "expected". | 2 |
| 59 | 2:19.20–2:21.60 | 8352–8495 | BUILD | s28, s29 | L17 (97%) | 4M2 | Capture grid; verification-tick mirror 59:3 → 60:3. | 3 |
| 60 | 2:21.60–2:24.00 | 8496–8639 | BUILD | s29 | L17 (63%) | 4M2 | Claim-bell D–A–E after "testing"; strings begin to rise. | 3 |
| 61 | 2:24.00–2:26.40 | 8640–8783 | BUILD | s29, s30 | L18 (60%) | 4M2/4M3 | QA board at 61:2: kick body on 1, sub quarters, strings low. | 3 |
| 62 | 2:26.40–2:28.80 | 8784–8927 | BUILD | s30 | L18 (56%) | 4M3 | Answer 1 after "recaptured": claim-bell D–A–E–F (complete). | 3 |
| 63 | 2:28.80–2:31.20 | 8928–9071 | BUILD | s30 | L18 (66%) | 4M3 | Answer 2 after "reproduced": two machine ticks + soft steel. | 3 |
| 64 | 2:31.20–2:33.60 | 9072–9215 | BUILD | s30 | L18 (82%) | 4M3 | Reverse swell from 64:4+1/6 as "rebuilt" ends. | 3 |
| 65 | 2:33.60–2:36.00 | 9216–9359 | BUILD→PAYOFF | s30, s31 | L19 (15%) | 4M3/5M1 | Arrival at 65:4: B♭(add9) + short claim chord + soft boom. | 4 |
| 66 | 2:36.00–2:38.40 | 9360–9503 | PAYOFF | s31, s32 | L19 (80%) | 5M1 | G sus at 66:3 (c22 cut); soft boom callback at 66:4+1/8. | 3 |
| 67 | 2:38.40–2:40.80 | 9504–9647 | PAYOFF | s32, s33, s34 | L19/L20 (73%) | 5M1 | A sus at 67:2 inside the L19/L20 gap; soft orbit kick cell. | 3→4 |
| 68 | 2:40.80–2:43.20 | 9648–9791 | PAYOFF | s34, s35 | L20 (77%) | 5M1/5M2 | Hold A sus under "…I used to imagine making"; pull-back from 68:3. | 4 |
| 69 | 2:43.20–2:45.60 | 9792–9935 | PAYOFF | s35 | L20 (10%) | 5M2 | Resolve to D at 69:2 (third withheld); motif rises. | 4→5 |
| 70 | 2:45.60–2:48.00 | 9936–10079 | PAYOFF | s35 | none | 5M2 | F♯ at 70:1 — the raised third; full bloom. | 5 |
| 71 | 2:48.00–2:50.40 | 10080–10223 | PAYOFF | s35, s36 | L21 (20%) | 5M2/5M3 | Release at the dip 71:2; end card 71:3 without a transient; L21. | 5→2 |
| 72 | 2:50.40–2:52.80 | 10224–10367 | PAYOFF | s36 | L21 (50%) | 5M3 | Sustain under L21; no note in its pause; staged releases after 2:51.96. | 2 |
| 73 | 2:52.80–2:55.20 | 10368–10511 | PAYOFF | s36 | none | 5M3 | One soft claim-bell D at 73:1; ring-out to ≤ −60 dBFS by 2:55.10. | 1→0 |

---

## 13. Loudness strategy

**Calibration:** compose against the VO at its locked level (−25.0 LUFS integrated, ≈ −3.0 dBTP). Do not normalise the score, and do not target the portfolio's music-only −16.95 LUFS.

| Target (score-only master, ducked) | Value |
|---|---|
| Integrated | **≈ −31 LUFS**; acceptable −33 to −28. A model of this energy curve lands about 6 dB under the VO, which is right for a narration-led film. This is a *consequence* of the windows below, not a goal. |
| Loudness range | **≥ 10 LU** (the model gives ≈15): the arc must survive |
| True peak | **≤ −6.0 dBTP**, set by the First Strike transient; sample peak ≤ −6.0 dBFS |
| Clipping | zero clipped samples in the master and all 15 stems |
| Narrated windows | the relationship table (§8.1): music 8–18 dB under the VO |
| First Strike, 0:26.40–0:28.80 | integrated −22 to −20 LUFS: the loudest window, about 3–5 dB over the VO's level |
| Counterstrike, 0:36.00–0:38.40 | 1–3 dB under the First Strike window |
| Bloom, 2:45.60–2:48.60 | −25 to −21 LUFS, louder than every narrated window |
| Silences | vacuum ≤ −80 dBFS RMS; the bar after each hard cut (0:43.80–0:46.15, 2:03.00–2:05.35) ≤ −60 dBFS RMS; the final 0.10 s ≤ −60 dBFS RMS |

**Final film mix** (a later pass, not Astra's unless asked): keep the score's relationship to the VO by giving both the same makeup gain. Target about −16 LUFS integrated and ≤ −1.0 dBTP for YouTube. The VO's own peaks (−3 dBTP at −25 LUFS) need gentle dialogue compression before makeup. The score's −6 dBTP ceiling then leaves the delivery limiter about 3 dB of work on the First Strike transient and nothing elsewhere. Never limit the score into a flat line: the vacuum, the breath, the two cuts and the bloom are the film.

---

## 14. Beginning (0:00.00–0:19.20)

- **Does music begin immediately?** Yes, on frame 0. The film enters the reel's 1.2 s head fade halfway, so the picture finishes fading in by 0:00.60. The drone and air start on frame 0, and their own built-in fade-ins (0.8 s and 1.0 s) ride that fade. Add no automation fade on top.
- **Does atmosphere precede motif?** By 1.2 s. The Claim seed's D lands on 1:3 (0:01.20) and its A on 2:2 (0:03.00), the portfolio's own arrival positions. Both sit inside the 3.94 s VO-free cold open.
- **When does rhythm first appear?** One event at the touchdown (2:4, a soft low boom with sub weight under the word "there"). A pulse at the decision (6:3, sub heartbeat). A groove only at the hero shot (9:1).
- **How quickly is the identity recognisable?** Within 3 seconds: the D–A fifth in the portfolio's square-lead voice over the Foundry drone. It is complete by 0:07.20, when Vesper's semitone collapse answers it. Someone who knows the portfolio piece hears the same world at once.
- **What keeps the personal story from feeling over-scored?** The first 43.8 s are the game's story, not the personal one. Even so, the score never comments on the voice: no sting after "It doesn't.", no hit under "how far you're willing to go", the rival held back one beat so L01 finishes, and percussion absent for the transmission card.

---

## 15. Middle (0:43.80–2:35.40): structural evolution, not "continue music"

The middle is 111.6 s of near-continuous narration. **Each sub-section is defined by what it adds and what it takes away:**

| From | Section | What changes | What leaves |
|---|---|---|---|
| 0:43.80 | 3M1 childhood | silence → open fifth → the celesta voice of the motif | everything from ESCALATION |
| 0:53.40 | 3M2 the game | harmony moves; the first ticks; **B♭ lydian**, the first harmonic departure; strings and the score's only large space | — |
| 1:05.40 | 3M3 live | **rhythm:** a steady pulse (ticks + sub) and a bass pedal | strings |
| 1:13.20 | 3M3 precision | **subdivision:** soft sixteenths | bass |
| 1:19.20 | 3M4 maths | **harmonic motion:** the orbit bass in whole notes; strings return | — |
| 1:32.40 | 3M4 code | **thinning** for reading and numbers | harmony / strings −3 dB |
| 1:36.00 | 3M4 flight | **kick cell** (soft) and the claim-lead's orbit fragment: the trailer remembered | — |
| 1:40.80 | 3M5 visual turn | **harmonic lift** in the pause after "Then"; mechanical density | claim-lead |
| 1:49.80 | 3M6 mass driver | **drone + accelerando + launch + full machine** | — |
| 2:03.00 | cut | **silence** | everything |
| 2:05.40 | 4M1 authorship | **warmth:** strings' low chord, the process pulse | drone, kick, steel |
| 2:12.60 | 4M2 iteration | bass half notes; the motif re-assembled note by note | — |
| 2:20.40 | 4M2 frame-checked | one bar of tick mirror | — |
| 2:24.60 | 4M3 QA | kick body; strings rising; the complete motif; the reverse swell | — |

No 8-bar loop survives this table: by design no two consecutive sub-sections share an arrangement.

---

## 16. Ending (2:24.60–2:55.20)

- **The final build begins at 2:24.60** (QA board, 61:2): kick body, strings rising. It continues through L18's two answers and the reverse swell 64:4+1/6 → 65:4.
- **The arrival (65:4, 2:35.40) is harmonic, not thematic.** L19 starts 0.20 s after the cut (first word 2:35.64), and the selects rank it as the strongest beat in the performance, so the cut gets:
  - a broad B♭(add9);
  - the portfolio's claim-secured chord D/A/E, held back at 0:43.80 and spent here on the TERRITORY CLAIMED card, as a staccato sixteenth that ends by 2:35.55;
  - a soft low boom.
- **The emotional payoff is 70:1 (2:45.60).** The chord changes happen only in the author's pauses (66:3, 67:2). The A sus holds 4.8 s under "…the kind of game I used to imagine making". At 69:2 (2:43.80), 0.14 s after the line ends, the bass resolves to D with the third still withheld, and the motif rises D–A–E in both voices. **F♯ arrives on 70:1** over the unnarrated pull-back, as the duck finishes releasing. The bloom adds strings, harmony, bell + lead in octaves, wide air, half-time kick + sub and one soft boom. No snare, no steel, no riser.
- **At the dip (71:2, 2:48.60)** the machinery and melody release; only the sustained D(add9) continues.
- **The title gets a resolved chord, sustained, and no hit.** At 71:3 (2:49.20) the chord is re-voiced softly. L21 speaks over it; nothing plays in its 0.74 s pause. The chord then releases in stages: bass first; harmony and strings across 73:1–73:3; air last, faded 2:53.40 → 2:54.60. One soft celesta D at 73:1 (2:52.80) bookends the film's first note, now consonant.
- **Exact final boundary:**
  - 175.2 s = 7,726,320 frames = position `74:1`;
  - `render.duration` 175.2 s, `render.tail` `none`;
  - every dry signal at −60 dB by 2:54.60;
  - reverb residue ≤ −60 dBFS RMS in 2:55.10–2:55.20;
  - nothing extends past the picture.

---

## 17. Pitfalls specific to this film

1. **Pasting the portfolio cue into 0:18.60–0:43.80 as is.** Its reversal alarm would land on L04's "Then", its Divider tones would sit under L05, and its claim-secured sting would fall on the 0:43.80 cut, 0.3 s before "I've wanted to make…".
2. **A sting after "It doesn't."** The joke is the voice's.
3. **Any pulse, drone or drum under L06.** The childhood line gets an open fifth and four bell notes, nothing else.
4. **Reverb or delay on tracks that play into 0:43.80, 2:03.00 or 2:55.20.** Automation cannot cut effect tails.
5. **Steel, snare, alarm, rival pad or a claim note under a word.** Their energy sits in the intelligibility band, and the steel rings for 1.65 s.
6. **Spending the reserved sounds.** The riser is the First Strike's whine and the cinematic impact belongs to two impacts only; using either elsewhere cheapens both.
7. **Making the Counterstrike bigger than the First Strike** (the old marker's "bigger low end than the first"). The portfolio's hierarchy holds, and the duck is still releasing at 16:1 anyway.
8. **Heroic major harmony before the payoff.** F♯ before 70:1 spends the film's one resolution.
9. **Hitting the graphics' rhythms:** route values, 1.2 s workflow nodes, 3-beat iteration swaps, monument titles, end-card builds.
10. **Filling the author's pauses** in L19 ("What I'm proudest of — isn't…"), L20 ("…the kind of game — I used to imagine making") and L21 ("And now — everyone…").
11. **Unfiltered air or drone under narration.** The air's 900 Hz–7 kHz band is the consonant band.
12. **Relying on sub-only sync where it has to read.** On phone speakers the soft sub hits at 2:4, 48:2+1/8 and 66:4+1/8 vanish. That is acceptable there because the voice carries those moments. Every sync in a VO-free window must have mid/high content.
13. **An 8-bar loop through the middle.** 82.7 s of narration over a repeating bed is the failure mode this film is most exposed to.
14. **Over-ducking or fast release.** At 10 dB or 400 ms the bed breathes in every list pause of L06, L07, L17 and L18.
15. **Normalising the score** to −14 or −16 LUFS like a trailer.
16. **Re-timing anything.** Every cut is on a beat; never stretch, nudge or change tempo.
17. **Touching the voice.** The key is a converted copy for analysis; the locked VO is never processed, replaced or re-timed.

---

## 18. Reconciling the existing music markers

`youtube-film.json` carries 24 "future" markers written during the lock, before the portfolio score existed in its final form. This bible supersedes them:

| Frame | Marker | Verdict |
|---:|---|---|
| 0 | drone-swell | **Keep.** Atmosphere from frame 0, no percussion. |
| 252 | touchdown-thump | **Keep, softened:** low boom only, sub weight, under "there". |
| 396 | rival-sting on the Citadel cut | **Move to 4:1 (frame 432).** L01 is still speaking at 0:06.60 ("…for something" ends 0:07.09). |
| 576 | transmission "duck" | **Keep as arrangement** (no VO to duck against): percussion absent, atmosphere −6 dB. |
| 792 | arm-tone | **Keep:** sub heartbeat + the Claim question in the L02/L03 gap. |
| 1116 | launch-roar, "kick on every beat from here" | **Keep the hit, change the groove:** the portfolio's asymmetric kick cell, not four-on-the-floor. |
| 1152 | groove-opens | **Keep.** |
| 1440 | descent-riser at 11:1 | **Re-place by endpoint:** the fixed 4.0 s riser starts at 10:1+1/12 and ends 11:4; 11:1 is the sixteenth-tick intensification (portfolio practice). |
| 1548 | silence-drop | **Keep** (vacuum ≤ −80 dBFS RMS). |
| 1584 | first-strike-impact | **Keep.** The film's loudest moment. |
| 1908 | breath | **Keep;** make it a real drop (the portfolio's first pass failed here). |
| 2016 | counterstrike-reversal "alarm stab on FIRE NOW" | **Change:** low jolt only at 15:1; alarm and the reversed rival after L04 (from 15:3+3/16). |
| 2160 | counterstrike-impact "bigger low end than the first" | **Reject the size note.** Secondary to 12:1, brighter (steel/snare/alarm), boom +0.15 s. |
| 2304 | third-party sting | **Keep the identity, move the tones:** rhythm only under L05; tones in its breath at 18:1. |
| 2448 | volley; "cut everything on the hard cut" | **Keep.** The hard cut at 19:2 is the most important edit in the score. |
| 2628 | systems: "then a sparse pulse … under the narration" | **Change:** no pulse under L06. The pulse returns at 28:2 with "It's the game running live". |
| 4752 | route lift, resolve on the code | **Keep;** the resolve is on the code cut at 39:3 (frame 5544). |
| 7380 | build: strip back, warmer | **Keep** (hard cut, warm low chord at 53:2). |
| 7956 | iteration: "one accent per pair swap (every 288 frames = 2 bars)" | **Stale.** Swaps are every 108 frames (3 beats) in Option A; no accents. |
| 9324 | payoff: "back to the full theme on the hard cut" | **Change:** harmonic arrival; the theme speaks in the pauses and in full only after L20. |
| 9720 | pull-back swell | **Refine:** resolution at 69:2, F♯ at 70:1. |
| 10116 | dip: "begin the resolve" | **Change:** the resolve has happened; the dip releases to the chord. |
| 10152 | final-chord as the wordmark builds | **Change:** no transient; re-voice the sustained chord under L21. |
| 10511 | last-frame "(9071)" | **Stale number** (first-cut frame). Music is silent by then. |

The treatment's mix note ("−14 LUFS integrated, −1 dBTP; duck about 8 dB during narration") is replaced by §8 and §13.

---

## 19. Verification record

- **Timeline arithmetic:** 175.2 s × 60 = 10,512 frames; 10,512 / 144 = 73 bars; 73 × 2.4 s = 175.2 s; 175.2 × 44,100 = 7,726,320; 175.2 × 48,000 = 8,409,600.
- **Picture boundaries:** all 41 segments in `youtube-film.json` start and end on multiples of 36 frames.
- **VO:**
  - The 21 line positions were recomputed from `vo-selects.json` with `narration.ts`'s logic (including the 662-sample joins in L07, L11 and L15). Each reproduces the lock's `startSample` and `endSample` exactly.
  - Word times were mapped through the same keep ranges.
- **Picture events:**
  - Reel-based events were read at full frame rate from the hash-verified titled reel at the film-mapped frames (film = reel − 36 for s01–s02, film = reel + 288 for s06–s18, film = reel + 6,984 for s31–s35).
  - Phone-board events were read at 25 fps from the pinned recordings.
  - Helios events were computed from `heliosReactorModel.ts` and agree with the lock record's "first fire +4,200 ms".
- **This document:** every table row carrying a time, a frame and a bar position was generated from one model and re-parsed after writing (1,137 automated checks, all passing; the scripts are kept with the audit artifacts in the gitignored `capture-final/youtube/audit/`). Each time ↔ frame ↔ bar:beat triple agrees; the cue sheet tiles 0–10,511 with no gap or overlap; the bar map has 73 rows covering 0–10,511.
- **Executability:** every instruction was checked against DaemonV12 V0.5 (`docs/V0_5_TIMELINE_DYNAMICS.md`, `docs/V0_3_AUDIO.md`, `src/render/production.ts`): exact `render.duration`, `render.tail` `none`, per-track gain/pan automation in musical or seconds positions, master-only ducking with a 44.1 kHz PCM16 reference, compressor / reverb / saturation / static filters / single-tap delay, kit and sampler one-shots without note-off, GM program names (`celesta`, `string_ensemble_1`, …), and the nine MCP tools.
- **Not done here** (needs the real files): listening; checking the picture visually against these events; measuring the VO key's activity. The Media Verification Gate in the handoff covers the measurable part.
