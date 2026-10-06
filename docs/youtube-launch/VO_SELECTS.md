# Shoot the Moon: narration selects (VO session 01)

**Status:** selects pass only. Nothing has been assembled, rendered or re-timed, and the picture is unchanged. **Not approved. Not committed.**
**Machine-readable ranges:** [`capture/youtube/vo-selects.json`](../../capture/youtube/vo-selects.json)
**Picture reference:** [`YOUTUBE_FILM_TREATMENT.md`](YOUTUBE_FILM_TREATMENT.md) and `capture/youtube/youtube-film.json`, as currently locked (2:31.20, 9,072 frames)

---

## 1. How this was judged (read first)

I can't hear the recording the way you do. What I did instead:

- **Transcription and alignment.** I transcribed every reading three independent ways with an offline recognizer (PocketSphinx): against the script, against general English, and against per-line grammars offering competing wordings. That found every take, every stumble and every place where you changed the words. Forced alignment then gave word-level timings for the in and out points.
- **Measurement.** For each take I measured level, clipping, low-frequency pops, mouth clicks in pauses, pace (words and syllables per second), where the pauses fall, how much the pitch moves, whether the last word falls (lands) or rises, and whether the end of the line trails off. I also checked the close calls on spectrograms.

Those measurements reliably catch stumbles, clipping, noise, rushing, trailing off and flatness. Words like "believable" or "genuinely interested" below are inferences from pitch movement, energy and phrasing, not from listening. Please audition these four close calls before Codex assembles anything:

1. **L01, take 1 vs take 2.** Take 1 is phrased slightly better, but both recognizers hear "feels like *you* should count".
2. **L11, take 3 vs take 2.** I picked take 3 for clarity and its natural rewording; take 2 is 2.4 s shorter and uses the script wording.
3. **L21, take 3.** The final "it" is soft (14 dB under the rest of the line); make sure it survives under music.
4. **L04, take 2 vs take 1.** Take 1 has a 0.56 s dramatic beat after "Then" that I judged to lean towards a trailer read.

## 2. The session

- **File:** `shoot-the-moon-vo-session-01.flac` (uploaded as FLAC; the brief calls it `.wav`. FLAC is lossless, so the samples are identical), sha256 `670b7a1f7602907d…`, 44.1 kHz, 16-bit, mono, 7:13.75.
- **Levels:** peak −4.2 dBFS and **no clipped samples anywhere**; −25.0 LUFS integrated. The room noise sits at −60 to −64 dBFS, mostly below 300 Hz, so an 80 Hz high-pass removes most of it.
- **Readings:** 47 readings of the 21 script lines (one of them a false start), recorded in script order, two or three per line. There are no verbal slates, so **take N means the Nth reading of that line**.
- **Problems found:** 1 stumble (L11 take 1), 1 false start (L19 take 1), and 7 spontaneous rewordings (section 8). A handful of mouth clicks and pops were found; none falls inside a selected range except one small pop that the high-pass treats.
- **Clean room tone:** 2:46.000–2:49.850 (3.85 s), the quietest stretch in the session.

## 3. Selects at a glance

**Total selected narration: 121.05 s** across 21 lines, 317 words. That is the time after the three pause tightenings; the selected source ranges total 122.65 s.

| Line | Take | Source in–out | Duration | Pauses | Wording change | Existing window (treatment) | Picture moves? (option A) |
|---|---|---|---|---|---|---|---|
| L01 | 2 | 0:12.110–0:15.340 | 3.23 s | natural | no | VO-A 0:03.90–0:07.90 | No |
| L02 | 1 | 0:08.570–0:09.520 | 0.95 s | natural | no | VO-B 0:13.70–0:18.50 | No |
| L03 | 1 | 0:19.240–0:22.240 | 3.00 s | natural | no | VO-B 0:13.70–0:18.50 | No (see L02) |
| L04 | 2 | 0:31.580–0:33.000 | 1.42 s | natural | no | VO-C 0:33.70–0:35.30 | No |
| L05 | 2 | 0:43.410–0:47.520 | 4.11 s | natural | no | VO-D 0:38.60–0:43.70 | No |
| L06 | 1 | 0:54.000–1:03.070 | 9.07 s | natural | no | VO-E 0:44.10–0:52.68 | Slightly |
| L07 | 2 | 1:33.260–1:44.480 | 10.72 s | tighten | no | none (new) | Yes |
| L08 | 1 | 1:47.650–1:55.250 | 7.60 s | natural | no | VO-F 0:53.10–1:00.98 | Yes, in time only |
| L09 | 1 | 2:14.370–2:19.070 | 4.70 s | natural | no | VO-G 1:01.50–1:07.08 | Yes, in time only |
| L10 | 2 | 2:39.830–2:45.920 | 6.09 s | natural | yes | VO-H 1:07.50–1:21.48 | Yes |
| L11 | 3 | 3:27.190–3:41.660 | 13.85 s | tighten | yes | VO-H 1:07.50–1:21.48 | Yes (see L10) |
| L12 | 2 | 3:48.580–3:51.440 | 2.86 s | natural | no | VO-J 1:21.90–1:26.58 | Yes |
| L13 | 2 | 4:00.210–4:04.130 | 3.92 s | natural | yes | VO-J 1:21.90–1:26.58 | Yes (see L12) |
| L14 | 1 | 4:22.970–4:35.190 | 12.22 s | natural | no | none (new) | Yes |
| L15 | 1 | 4:57.090–5:02.360 | 4.79 s | tighten | no | VO-K 1:27.30–1:33.30 | In time only |
| L16 | 1 | 5:13.510–5:18.340 | 4.83 s | natural | no | VO-L 1:33.60–1:41.20 | In time only |
| L17 | 2 | 5:44.050–5:53.200 | 9.15 s | natural | no | VO-M+VO-O 1:41.50–2:02.48 | Yes |
| L18 | 2 | 6:11.380–6:20.000 | 8.62 s | natural | no | VO-P 2:03.30–2:11.28 | Slightly |
| L19 | 2 | 6:24.270–6:27.600 | 3.33 s | natural | no | VO-Q 2:11.60–2:17.88 | In time only |
| L20 | 3 | 7:02.675–7:06.810 | 4.13 s | natural | no | VO-Q 2:11.60–2:17.88 | Slightly |
| L21 | 3 | 7:07.600–7:10.060 | 2.46 s | natural | yes | none (new) | Yes |

## 4. Line by line

Source times are from the first sample of the session file. Durations are as assembled, after any tightening.

### L01: "Getting there first feels like it should count for something."

- **Source:** 0:12.110 → 0:15.340 (12.110–15.340 s) · **take 2** · **3.23 s**
- **Why it won:** Clean, verified wording, steady energy; tighter than take 1 and comfortably inside the opening window.
- **Pauses:** Natural.
- **Existing picture window:** VO-A, frames 234–474 (0:03.90–0:07.90), s01-s03 (Moon swell, touchdown, Citadel).
- **Picture moves?** No. It fits VO-A with 0.8 s to spare.
- **Wording change?** No. The selected take matches the script. If you prefer take 1, check it says "it should", not "you should".
- *Alternate, take 1* (0:04.150–0:07.630, 3.48 s): Slightly better phrasing (a 0.21 s lift after "first", firmer final fall), but both recognizers hear "feels like YOU should count" at 5.4-5.9 s. Audition it: if it says "it", take 1 is the better read and fits the same window.
- *Measured:* -23.3 LUFS, true peak -6.0 dBTP, 3.1 words/s, 3.81 syll/s, pitch range 7.0 st, final pitch slope -1.2 st/s, clip gain -1.7 dB.

### L02: "It doesn't."

- **Source:** 0:08.570 → 0:09.520 (8.570–9.520 s) · **take 1** · **0.95 s**
- **Why it won:** The firmest of the two: a clear falling "doesn't" (-6.3 st/s) with 3 dB more presence; take 2 almost disappears.
- **Pauses:** Natural.
- **Existing picture window:** VO-B, frames 822–1110 (0:13.70–0:18.50), s05 launch authority dialog (first half of VO-B).
- **Picture moves?** No. With L03 it fits VO-B (4.65 of 4.80 s).
- **Wording change?** No.
- *Alternate, take 2* (0:15.850–0:16.800, 0.95 s): Usable; 3-4 dB quieter and flatter. Pick it if you want a drier, more resigned beat.
- *Measured:* -29.3 LUFS, true peak -14.1 dBTP, 2.11 words/s, 3.49 syll/s, pitch range 3.1 st, final pitch slope -6.3 st/s, clip gain +3.0 dB.

### L03: "So you decide how far you're willing to go."

- **Source:** 0:19.240 → 0:22.240 (19.240–22.240 s) · **take 1** · **3.00 s**
- **Why it won:** The most engaged read: wider pitch movement (8.4 vs 6.6 st) and a natural 0.23 s lift after "decide". Take 2 is faster and flatter.
- **Pauses:** Natural.
- **Existing picture window:** VO-B, frames 822–1110 (0:13.70–0:18.50), s05 launch authority dialog (second half of VO-B).
- **Picture moves?** No (see L02).
- **Wording change?** No.
- *Alternate, take 2* (0:28.000–0:30.540, 2.54 s): Clean, 0.46 s shorter, but faster (4.55 syll/s) and flatter.
- *Measured:* -22.5 LUFS, true peak -6.9 dBTP, 3.0 words/s, 3.97 syll/s, pitch range 8.4 st, final pitch slope -3.8 st/s, clip gain -2.5 dB.

### L04: "Then it's their turn."

- **Source:** 0:31.580 → 0:33.000 (31.580–33.000 s) · **take 2** · **1.42 s**
- **Why it won:** Conversational and restrained, no stagey pause; 1.42 s fits the existing 1.6 s window before the Counterstrike impact.
- **Pauses:** Natural.
- **Existing picture window:** VO-C, frames 2022–2118 (0:33.70–0:35.30), s13-s14 Vesper counterstrike card into the cyan dive.
- **Picture moves?** No. 1.42 s fits VO-C and ends 0.9 s before the s15 Counterstrike impact.
- **Wording change?** No.
- *Alternate, take 1* (0:23.550–0:25.640, 2.09 s): Clean, with a 0.56 s beat after "Then". More dramatic, but quieter and leaning towards a trailer read; 2.09 s still fits before the Counterstrike impact if you prefer it.
- *Measured:* -26.8 LUFS, true peak -7.4 dBTP, 2.82 words/s, 2.99 syll/s, pitch range 4.6 st, final pitch slope -0.7 st/s, clip gain +1.8 dB.

### L05: "And while you're busy with each other, someone else shows up."

- **Source:** 0:43.410 → 0:47.520 (43.410–47.520 s) · **take 2** · **4.11 s**
- **Why it won:** Balanced all the way through: "shows up" lands (take 1 trails off 17 dB) and the beat before "someone else" is natural (0.56 s, not 0.93 s).
- **Pauses:** Natural: keep the 0.56 s beat before "someone else shows up".
- **Existing picture window:** VO-D, frames 2316–2622 (0:38.60–0:43.70), s16-s18 Octogonal lock, volley, defense beam.
- **Picture moves?** No. It fits VO-D with 1.0 s to spare.
- **Wording change?** No.
- *Alternate, take 1* (0:36.070–0:39.990, 3.92 s): Clean, but "shows up" drops 17 dB below the line (it trails off) and the pause before "someone" is 0.93 s.
- *Measured:* -21.0 LUFS, true peak -6.8 dBTP, 2.68 words/s, 3.87 syll/s, pitch range 8.1 st, final pitch slope -1.2 st/s, clip gain -3.0 dB.

### L06: "I've wanted to make something like this since I was a kid playing StarCraft, reading Dune, and searching the library for anything I could find about space."

- **Source:** 0:54.000 → 1:03.070 (54.000–63.070 s) · **take 1** · **9.07 s**
- **Why it won:** More animated than take 2 at the same pace (6.6 vs 4.5 semitones of pitch movement), no mouth clicks in the pauses, and every word of "StarCraft, reading Dune" recognized cleanly.
- **Pauses:** Natural.
- **Existing picture window:** VO-E, frames 2646–3161 (0:44.10–0:52.68), s19-s20 SYSTEMS card and title-screen capture.
- **Picture moves?** Slightly. It runs 0.5 s past VO-E; hold the s20 title screen about half a second longer.
- **Wording change?** No. Both takes compress "I've wanted to" towards "I've wanna", which is ordinary speech; it reads clearly in context.
- *Alternate, take 2* (1:07.830–1:16.860, 9.03 s): Clean, same length, noticeably flatter (4.5 vs 6.6 semitone range).
- *Measured:* -23.9 LUFS, true peak -6.1 dBTP, 2.98 words/s, 4.55 syll/s, pitch range 6.6 st, final pitch slope 1.2 st/s, clip gain +0.0 dB.

### L07: "Shoot the Moon became my version of all of that: territory, machines, escalation, and a Moon that actually feels enormous."

- **Source:** 1:33.260 → 1:44.480 (93.260–104.480 s) · **take 2** · **10.72 s** (source span 11.22 s, 0.50 s of pause removed)
- **Why it won:** The only take where "became" is clear, and the list is given room (territory / machines / escalation). It has more pitch movement than take 1 (6.6 vs 5.0 st).
- **Pauses:** Tighten one: the 1.05 s pause after "all of that" to 0.55 s; keep the list pauses (0.50-0.79 s), they give the list its weight.
- **Existing picture window:** None. New line; it lands where VO-F and the s21 phone board are now.
- **Picture moves?** Yes. It is a new line and needs about 11.6 s of new picture between s20 and s21, the biggest single addition.
- **Wording change?** No. "all of that" is spoken with a light "of", which is natural.
- *Alternate, take 1* (1:20.050–1:29.760, 9.71 s): One breath, 1.5 s shorter, but flatter, and two recognizers hear "Shoot the Moon becomes/because" where take 2 is clearly "became". Use it only if the act cannot give the extra 1.5 s.
- *Measured:* -26.0 LUFS, true peak -7.7 dBTP, 1.87 words/s, 4.04 syll/s, pitch range 6.6 st, final pitch slope 3.1 st/s, clip gain +0.0 dB.

### L08: "And none of this is a cutscene. It's the game running live in a browser, built for a phone as much as a desktop."

- **Source:** 1:47.650 → 1:55.250 (107.650–115.250 s) · **take 1** · **7.60 s**
- **Why it won:** Easily the liveliest read of the line (9.4 vs 4.5 semitones), verified wording, firm falling ending.
- **Pauses:** Natural: keep the 0.80 s sentence pause after "cutscene".
- **Existing picture window:** VO-F, frames 3186–3659 (0:53.10–1:00.98), s21 phone board.
- **Picture moves?** Yes, in time only. The phone board (s21) moves 12.3 s later and keeps its length; the line fits its 7.9 s window.
- **Wording change?** No.
- *Alternate, take 2* (2:01.830–2:09.480, 7.65 s): Clean but flat (4.5 vs 9.4 semitone range); may read "a game ... the browser".
- *Measured:* -25.4 LUFS, true peak -7.8 dBTP, 3.16 words/s, 4.4 syll/s, pitch range 9.4 st, final pitch slope -6.9 st/s, clip gain +0.0 dB.

### L09: "Every site exists at a real latitude and longitude on a lunar sphere."

- **Source:** 2:14.370 → 2:19.070 (134.370–139.070 s) · **take 1** · **4.70 s**
- **Why it won:** Shorter, steady, with a decisive falling ending (-6.0 vs -1.7 st/s); fits the landing-site window.
- **Pauses:** Natural.
- **Existing picture window:** VO-G, frames 3690–4025 (1:01.50–1:07.08), s22 landing-site capture.
- **Picture moves?** Yes, in time only. The landing-site capture (s22) moves 12.3 s later; the line fits.
- **Wording change?** No.
- *Alternate, take 2* (2:21.840–2:27.210, 5.37 s): Clean, 0.67 s longer, flatter ending.
- *Measured:* -25.7 LUFS, true peak -6.5 dBTP, 2.77 words/s, 4.55 syll/s, pitch range 6.8 st, final pitch slope -6.0 st/s, clip gain +0.0 dB.

### L10: "One of the moments that changed the project was realizing how good the frontier models had become at math."

- **Selected wording:** "One of the key moments that changed the project was realizing how good the frontier models had become at math." (adds "key" (spoken in take 2))
- **Source:** 2:39.830 → 2:45.920 (159.830–165.920 s) · **take 2** · **6.09 s**
- **Why it won:** Better shape: the ending falls and lands (-5.0 st/s, take 1 stays level) and it has more movement (7.1 vs 4.9 st). The spontaneous "key" is a natural addition.
- **Pauses:** Natural.
- **Existing picture window:** VO-H, frames 4050–4889 (1:07.50–1:21.48), s23 route board (first part of VO-H).
- **Picture moves?** Yes. L10 and L11 together need 20.4 s where VO-H had 14.0 s, so the route board (s23) and code excerpt (s24) need about 6.4 s more.
- **Wording change?** Yes: adds "key" (spoken in take 2). Update the script and `youtube-film.json` to match the take.
- *Alternate, take 1* (2:30.990–2:36.630, 5.64 s): Script wording, 0.45 s shorter, but the ending stays level instead of falling (so "at math" does not land).
- *Measured:* -25.8 LUFS, true peak -8.3 dBTP, 3.28 words/s, 4.67 syll/s, pitch range 7.1 st, final pitch slope -5.0 st/s, clip gain +0.0 dB.

### L11: "We used that to work out flight paths around the Moon, validate a hundred-and-thirty-two-degree route at two thousand and forty-eight points, and design camera moves I probably wouldn't have attempted before."

- **Selected wording:** "We used that to work out flight paths around the Moon, validate a hundred-and-thirty-two-degree route at two thousand and forty-eight points, and design camera moves I probably would have never even tried." (ending "wouldn't have attempted before" becomes "would have never even tried" (spoken in take 3; take 1 stumbled on "wouldn't"))
- **Source:** 3:27.190 → 3:41.660 (207.190–221.660 s) · **take 3** · **13.85 s** (source span 14.47 s, 0.62 s of pause removed)
- **Why it won:** Both numbers come through clearly at a measured pace, and the rephrased ending ("would have never even tried") is the most natural moment in the line. Take 1 stumbles; take 2 is rushed.
- **Pauses:** Tighten one: the 1.12 s pickup gap after "forty-eight points" to 0.50 s (take 3 was read in two halves); keep the rest.
- **Existing picture window:** VO-H, frames 4050–4889 (1:07.50–1:21.48), s23 route board and s24 code excerpt.
- **Picture moves?** Yes (see L10). Land "two thousand and forty-eight points" on the route board's sample ticks, and "camera moves" on footage that moves.
- **Wording change?** Yes: ending "wouldn't have attempted before" becomes "would have never even tried" (spoken in take 3; take 1 stumbled on "wouldn't"). Update the script and `youtube-film.json` to match the take.
- *Alternate, take 2* (3:08.550–3:20.580, 12.03 s): Complete in one breath with the script wording ("wouldn't have attempted before"), 2.4 s shorter than take 3 as tightened. It is the fastest read in the session (4.9 syll/s), which crowds the numbers. Use it if the Systems act cannot give the extra time.
- *Rejected, take 1* (2:50.220–3:05.290): Stumble: "I probably would- wouldn't have attempted" (repeated word at 182.5 s), and "forty-eight" is heard as "forty" by two recognizers.
- *Measured:* -25.5 LUFS, true peak -6.8 dBTP, 2.31 words/s, 4.14 syll/s, pitch range 6.1 st, final pitch slope -6.4 st/s, clip gain +0.0 dB.

### L12: "Then I started pushing the visual side harder."

- **Source:** 3:48.580 → 3:51.440 (228.580–231.440 s) · **take 2** · **2.86 s**
- **Why it won:** 3.6 dB more presence and far more pitch movement than take 1; the beat after "Then" marks the turn. Take 1 is quiet and flat.
- **Pauses:** Natural: keep the 0.56 s beat after "Then" (it is the pivot into the visual section); tighten to 0.35 s only if picture is tight.
- **Existing picture window:** VO-J, frames 4914–5195 (1:21.90–1:26.58), s25 mining capture (first part of VO-J).
- **Picture moves?** Yes. L12 and L13 need 7.3 s where VO-J had 4.7 s, so the mining capture (s25) needs about 2.6 s more.
- **Wording change?** No.
- *Alternate, take 1* (3:44.560–3:46.990, 2.43 s): Clean, 0.43 s shorter, but quiet (-27 dB) and flat (3.8 semitone range).
- *Measured:* -24.7 LUFS, true peak -8.5 dBTP, 2.8 words/s, 5.51 syll/s, pitch range 11.9 st, final pitch slope -3.0 st/s, clip gain +0.0 dB.

### L13: "The monuments, machines, and animations are built in code."

- **Selected wording:** "The monuments, machines, and animations are all built in code." (adds "all" (spoken in takes 2 and 3))
- **Source:** 4:00.210 → 4:04.130 (240.210–244.130 s) · **take 2** · **3.92 s**
- **Why it won:** The most fluent take (no pauses, 4.2 syll/s) with the natural "all"; takes 1 and 3 drag.
- **Pauses:** Natural.
- **Existing picture window:** VO-J, frames 4914–5195 (1:21.90–1:26.58), s25 mining capture, S6 ZERO MODEL FILES.
- **Picture moves?** Yes (see L12). Keep "all built in code" on the S6 ZERO MODEL FILES graphic.
- **Wording change?** Yes: adds "all" (spoken in takes 2 and 3). Update the script and `youtube-film.json` to match the take.
- *Alternate, take 1* (3:54.050–3:58.800, 4.75 s): Script wording ("are built in code"), slower with two small pauses.
- *Alternate, take 3* (4:05.880–4:11.400, 5.52 s): Same wording as take 2, slower and quieter.
- *Measured:* -24.8 LUFS, true peak -7.7 dBTP, 2.55 words/s, 4.17 syll/s, pitch range 7.4 st, final pitch slope -1.6 st/s, clip gain +0.0 dB.

### L14: "The mass driver is still one of my favorites. It started as an idea in my head and gradually became this huge mechanical thing that actually feels like it belongs on the Moon."

- **Source:** 4:22.970 → 4:35.190 (262.970–275.190 s) · **take 1** · **12.22 s**
- **Why it won:** Verified script wording, clean pauses, a firm falling ending, no gap clicks; slightly more pitch movement than take 2.
- **Pauses:** Natural: keep the 0.68 s sentence pause.
- **Existing picture window:** None. New line; the only mass-driver picture is c22 (s32, 2:13.20-2:15.00, 1.8 s), in the payoff.
- **Picture moves?** Yes. It is a new line and needs about 13 s of mass-driver picture, which the Systems act does not have (see *Fitting the picture*).
- **Wording change?** No for the select. Take 2's "a crazy idea" is a good instinct; if you want it, check by ear that "in my head" is intact, or pick it up in one line.
- *Alternate, take 2* (4:39.660–4:51.980, 12.32 s): Adds "a crazy idea" (nice), but "in" before "my head" may be swallowed, and there is a mouth click in the pause at 289.13 s.
- *Measured:* -24.0 LUFS, true peak -4.4 dBTP, 2.7 words/s, 4.54 syll/s, pitch range 6.5 st, final pitch slope -5.9 st/s, clip gain +0.0 dB.

### L15: "I didn't ask a model to invent this. I already knew the game I wanted to make."

- **Source:** 4:57.090 → 5:02.360 (297.090–302.360 s) · **take 1** · **4.79 s** (source span 5.27 s, 0.48 s of pause removed)
- **Why it won:** Both sentences land with a falling ending; script wording; the click before "I" is excluded by the in-point.
- **Pauses:** Tighten one: the 1.08 s gap between the two sentences to 0.60 s; keep the rest.
- **Existing picture window:** VO-K, frames 5238–5598 (1:27.30–1:33.30), s26 BUILD card and s27 workflow board.
- **Picture moves?** In time only. The BUILD card moves 36 s later; the line fits.
- **Wording change?** No for the select. Take 2's "I already knew *exactly* the game" is stronger wording, but its ending rises.
- *Alternate, take 2* (5:05.210–5:10.740, 5.53 s): Adds "exactly" (stronger), but the last word rises instead of landing.
- *Measured:* -25.0 LUFS, true peak -7.6 dBTP, 3.55 words/s, 5.36 syll/s, pitch range 6.6 st, final pitch slope -4.1 st/s, clip gain +0.0 dB.

### L16: "Claude and Codex became collaborators I could direct, test, and challenge."

- **Source:** 5:13.510 → 5:18.340 (313.510–318.340 s) · **take 1** · **4.83 s**
- **Why it won:** Flows as one thought and keeps the brand names low-key (restraint), with a clear falling end.
- **Pauses:** Natural.
- **Existing picture window:** VO-L, frames 5616–6072 (1:33.60–1:41.20), s27 workflow board into s28 iteration board.
- **Picture moves?** In time only. It fits on the workflow board.
- **Wording change?** No.
- *Alternate, take 2* (5:21.840–5:26.890, 5.05 s): Clean; puts a 0.42 s beat after "Codex", which spotlights the brand names. Take 1 is more restrained.
- *Measured:* -27.6 LUFS, true peak -7.9 dBTP, 2.28 words/s, 4.23 syll/s, pitch range 6.7 st, final pitch slope -10.2 st/s, clip gain +2.6 dB.

### L17: "My background in QA helped more than I expected. I treated every feature like something that had to survive testing, not just look right once."

- **Source:** 5:44.050 → 5:53.200 (344.050–353.200 s) · **take 2** · **9.15 s**
- **Why it won:** Stronger ending ("once" lands), more pitch movement, fewer mouth transients.
- **Pauses:** Natural: keep both sentence pauses (0.71 s, 0.78 s).
- **Existing picture window:** VO-M+VO-O, frames 6090–7349 (1:41.50–2:02.48), s28 iteration board and s29 capture grid.
- **Picture moves?** Yes. The line fits, but BUILD shrinks by 12 s, taken from the 19.2 s iteration board.
- **Wording change?** No.
- *Alternate, take 1* (5:30.760–5:39.740, 8.98 s): Clean, but "once" trails off (-8.9 dB) and it carries more mouth transients.
- *Measured:* -25.0 LUFS, true peak -5.8 dBTP, 2.73 words/s, 4.57 syll/s, pitch range 6.2 st, final pitch slope -2.0 st/s, clip gain +0.0 dB.

### L18: "Bad captures got recaptured. Bugs got reproduced. Ideas got rejected and rebuilt."

- **Source:** 6:11.380 → 6:20.000 (371.380–380.000 s) · **take 2** · **8.62 s**
- **Why it won:** The rhythm is the same as take 1, but "rebuilt" lands 4 dB stronger. The small low-frequency pop on "Bugs" is the kind the 80 Hz high-pass takes care of.
- **Pauses:** Natural: the three-part rhythm (0.82 / 0.68 s between sentences) is the line.
- **Existing picture window:** VO-P, frames 7398–7877 (2:03.30–2:11.28), s30 QA before/after.
- **Picture moves?** Slightly. It runs 0.6 s longer than VO-P, so give the QA board (s30) about 1 s more.
- **Wording change?** No.
- *Alternate, take 1* (6:00.710–6:09.060, 8.35 s): Clean and pop-free, but "rebuilt" lands softer (-7.5 vs -3.3 dB).
- *Measured:* -26.7 LUFS, true peak -5.5 dBTP, 1.39 words/s, 3.11 syll/s, pitch range 8.3 st, final pitch slope -4.9 st/s, clip gain +1.7 dB.

### L19: "What I'm proudest of isn't that models wrote code."

- **Source:** 6:24.270 → 6:27.600 (384.270–387.600 s) · **take 2** · **3.33 s**
- **Why it won:** One of the two most expressive reads in the session (11 semitones of pitch movement, with the lift on "proudest"), clean, no pop.
- **Pauses:** Natural.
- **Existing picture window:** VO-Q, frames 7896–8273 (2:11.60–2:17.88), s31-s32 Signal Array card, Helios Spire.
- **Picture moves?** In time only. It keeps its place at the head of the payoff.
- **Wording change?** No.
- *Alternate, take 3* (6:29.980–6:33.340, 3.36 s): Clean, a little less lift; a small plosive pop on "proudest".
- *Rejected, take 1* (6:22.410–6:23.180): False start: "What I'm proud-" (382.5-383.1 s), stopped.
- *Measured:* -23.4 LUFS, true peak -6.4 dBTP, 2.7 words/s, 4.1 syll/s, pitch range 11.0 st, final pitch slope -0.6 st/s, clip gain -1.6 dB.

### L20: "It's that this feels like the kind of game I used to imagine making."

- **Source:** 7:02.675 → 7:06.810 (422.675–426.810 s) · **take 3** · **4.13 s**
- **Why it won:** Script wording, the most expressive version (9.1 st), and a natural 0.56 s beat before "I used to imagine making".
- **Pauses:** Natural: keep the 0.56 s beat before "I used to imagine making".
- **Existing picture window:** VO-Q, frames 7896–8273 (2:11.60–2:17.88), s33-s34 monuments (second half of VO-Q).
- **Picture moves?** Slightly. L19 and L20 run 1.8 s past VO-Q, so L20 overlaps the first 1.7 s of the 7.2 s pull-back; 5.5 s of the pull-back stays unnarrated.
- **Wording change?** No for the select. Take 2's "the kind of game I grew up wishing I could make" is a callback to the opening; it needs a fluent rerecord if you want it.
- *Alternate, take 1* (6:35.620–6:39.760, 4.14 s): Fast (3.6 words/s), reads "the kind of A game", and rolls straight into the last line.
- *Alternate, take 2* (6:47.690–6:54.810, 7.12 s): Alternative wording: "...the kind of game I grew up wishing I could make". A lovely callback to the opening, but halting (0.5-1.0 s gaps). Rerecord only if you want that wording.
- *Measured:* -23.5 LUFS, true peak -7.3 dBTP, 3.39 words/s, 4.89 syll/s, pitch range 9.1 st, final pitch slope -4.8 st/s, clip gain +0.0 dB.

### L21: "And now you can play it."

- **Selected wording:** "And now everyone can play it." ("you" becomes "everyone" (spoken in takes 2 and 3))
- **Source:** 7:07.600 → 7:10.060 (427.600–430.060 s) · **take 3** · **2.46 s**
- **Why it won:** The only read that lands: the pitch falls to a full stop (-5.0 st/s), with a breath of space after "And now". The spontaneous "everyone" reads warmer than "you".
- **Pauses:** Natural: keep the 0.74 s beat after "And now"; it is the last line.
- **Existing picture window:** None. New placement, proposed on the s36 end card (SHOOT THE MOON / PLAY IT IN YOUR BROWSER).
- **Picture moves?** Yes. It moves onto the end card, 0.3 s after the card cuts in, with 3.2 s of held lockup after it.
- **Wording change?** Yes: "you" becomes "everyone" (spoken in takes 2 and 3). Update the script and `youtube-film.json` to match the take.
- *Alternate, take 1* (6:42.770–6:44.100, 1.33 s): Script wording ("you can play it"), but rushed (4.5 words/s) and the ending rises: it was read as a run-on after L20 take 1.
- *Alternate, take 2* (6:56.300–6:57.810, 1.51 s): "Now everyone can play it" without "And"; the ending rises.
- *Measured:* -26.0 LUFS, true peak -7.1 dBTP, 2.44 words/s, 4.37 syll/s, pitch range 5.2 st, final pitch slope -5.0 st/s, clip gain +0.0 dB.

## 5. Fitting the picture

**The main finding: the revised narration does not fit 2:31.20.** No choice of takes changes that. The script grew from 260 to 317 words, and nearly all of the growth is in the SYSTEMS act, which has 43.2 s of picture and now carries about 77 s of narration with natural gaps.

| Act | Picture now | Narration needed (best takes, natural gaps) | With the fastest clean takes and tight gaps |
|---|---|---|---|
| WORLD | 18.6 s | 7.2 s of speech (L01–L03); fits its existing windows | — |
| ESCALATION | 25.2 s | fits, with impacts silent (L04–L05) | — |
| SYSTEMS | 43.2 s | **≈ 77.4 s** (L06–L14) | ≈ 71 s, still 28 s over |
| BUILD | 44.4 s | ≈ 31.0 s (L15–L18); **13 s spare** | — |
| PAYOFF | 19.8 s | L19–L20 need 8.1 s where VO-Q had 6.3 s; L21 goes on the end card | — |

The voice isn't the cause. Your pace is conversational (median 2.7 words/s); the old windows were written for 260 words. Two ways to make it fit:

### Option A (recommended): keep every line, run 2:55.20 (73 bars)

- SYSTEMS +15 bars (+36.0 s): 43.80-123.00 s (was 43.80-87.00 s)
- BUILD -5 bars (-12.0 s): 123.00-155.40 s (was 87.00-131.40 s); take it from the s28 iteration board
- PAYOFF unchanged in length; moves to 155.40-175.20 s
- WORLD and ESCALATION unchanged
- The line-to-picture pairings stay the same: each line keeps the shot it was written for, and the sections get longer around it. Act boundaries stay on bar lines at 100 BPM, so the music grid survives.
- That is +24.0 s overall: inside the brief's 2:30–3:15 range, but more than the "small timing change" you allowed for. **This needs your decision.**

| Line | Film placement (A) | | Line | Film placement (A) |
|---|---|---|---|---|
| L01 | 0:03.90–0:07.13 (f234–427) | | L12 | 1:40.93–1:43.79 (f6055–6227) |
| L02 | 0:13.70–0:14.65 (f822–878) | | L13 | 1:44.29–1:48.21 (f6257–6492) |
| L03 | 0:15.35–0:18.35 (f920–1100) | | L14 | 1:49.11–2:01.33 (f6546–7279) |
| L04 | 0:33.70–0:35.12 (f2022–2107) | | L15 | 2:03.30–2:08.09 (f7398–7685) |
| L05 | 0:38.60–0:42.71 (f2316–2562) | | L16 | 2:08.99–2:13.82 (f7739–8029) |
| L06 | 0:44.10–0:53.17 (f2645–3190) | | L17 | 2:14.72–2:23.87 (f8083–8632) |
| L07 | 0:53.77–1:04.49 (f3226–3869) | | L18 | 2:24.77–2:33.39 (f8686–9203) |
| L08 | 1:05.39–1:12.99 (f3923–4379) | | L19 | 2:35.60–2:38.93 (f9336–9535) |
| L09 | 1:13.79–1:18.49 (f4427–4709) | | L20 | 2:39.53–2:43.66 (f9571–9819) |
| L10 | 1:19.49–1:25.58 (f4769–5134) | | L21 | 2:49.50–2:51.96 (f10170–10317) |
| L11 | 1:26.08–1:39.93 (f5164–5995) | |  |  |

Picture that option A needs (all of it is decided in the next pass, not here):

- **L07 (≈ 11.6 s of new picture).** "Shoot the Moon became my version of all of that" fits a longer hold on the title-screen capture (it shows the SHOOT THE MOON lockup). The list "territory, machines, escalation" needs real footage. Pre-existing candidates that need no new capture: the phone-viewport recordings in `artifacts/recordings/` (rival-signal reveal 48.1 s, first-strike launch-to-ending 39.8 s, counterstrike-failure 42.2 s), shown in the existing phone board, and the `artifacts/release-candidate/final/` stills (03-extractor, 14-landscape, 15-restored).
- **L10–L11 (+6.4 s).** A longer route board. `first-strike-launch-to-ending.webm` is a real recording of the flight path and its camera, made for "design camera moves I probably would have never even tried".
- **L14 (≈ 13 s): the hard one.** The only mass-driver picture in any source is c22 (reel 2448–2555, 1.8 s, the slug fires near the end), and the payoff already uses it. Reusing it would repeat a shot. The Helios Spire stills in `artifacts/screenshots/` are UI-heavy portrait captures and won't carry 13 s. The clean answer is a **fourth capture** of the existing manifest shot *Helios Spire — mass-driver fire* (`capture/manifest.ts:1647`). That breaks the three-capture budget, so it is your call. Without it, L14 has to play over the monument material.
- **L21 on the end card** is new and, I think, right: "And now everyone can play it" lands as SHOOT THE MOON / PLAY IT IN YOUR BROWSER comes up.
- **AI is now mentioned earlier.** "frontier models" (L10) arrives at 1:19.49 in option A (1:08.17 in option B), not 1:27.3. The treatment's "AI is not mentioned until 1:27.3" line needs updating. This follows from the script, not the takes.

### Option B (fallback): keep 2:31.20 by dropping L07 and L14

- SYSTEMS +5 bars (+12.0 s): 43.80-99.00 s
- BUILD -5 bars (-12.0 s): 99.00-131.40 s
- PAYOFF unchanged
- WORLD and ESCALATION unchanged
- 98.11 s of narration. L07 and L14 are the two lines with no matching picture, which is the only reason they're the ones to drop. Dropping them loses the personal bridge ("Shoot the Moon became my version of all of that") and your favourite machine, which is most of what the revision added. I don't recommend it unless the runtime is fixed.

In both options, no line sits on the protected First Strike or Counterstrike impacts, the first 3.9 s stay silent, and the 317-word total is inside the film's 260–360 limit.

## 6. Lines that need rerecording

**None.** Every line has at least one clean, complete, correctly worded take.

Three pickups are needed **only if you choose wording that exists solely in a weaker take**:

- **L20 "…the kind of game I grew up wishing I could make"**: one fluent read, if you prefer it to "I used to imagine making" (take 2 has 0.5–1.0 s gaps).
- **L14 "It started as a crazy idea in my head"**: only if "in" turns out to be swallowed in take 2 when you listen.
- **L21 "And now *you* can play it"**: only if you want "you" back; the one take with it is rushed and rises.

## 7. Picture sections that need timing changes

WORLD and ESCALATION need no change: every line there fits its existing window. The changes all follow from option A or B (section 5):

- **SYSTEMS:** +36.0 s (A) or +12.0 s (B). New picture for L07 and L14 (A only); longer route board, code excerpt and mining capture; s20 held about 0.5 s longer.
- **BUILD:** −12.0 s, taken from the s28 iteration board (19.2 s now). The QA board (s30) gets about 1 s more for L18.
- **PAYOFF:** no length change. L20 overlaps the first 1.7 s of the c25 pull-back; L21 moves onto the end card.
- **Downstream of any re-time:** music markers, the title cue sheet, act boundaries, the treatment tables and the picture lock all re-time together.

## 8. Wording that sounded unnatural when spoken

The best evidence is where you changed the words yourself on a later take, or stumbled on the scripted phrase:

| Script | What you said instead | Evidence | Recommendation |
|---|---|---|---|
| "I probably wouldn't have attempted before" (L11) | "I probably would have never even tried" | Take 1 stumbles exactly here ("would- wouldn't"); take 3 rephrases it smoothly | **Adopt** (selected) |
| "One of the moments that changed the project" (L10) | "One of the *key* moments…" | Added on take 2, which also has the better ending | **Adopt** (selected) |
| "…are built in code" (L13) | "…are *all* built in code" | Added on takes 2 and 3 | **Adopt** (selected). The claim stays true: the repo has no imported model files |
| "And now you can play it." (L21) | "(And) now *everyone* can play it." | Used on takes 2 and 3; only the "everyone" read lands | **Adopt** (selected) |
| "…the kind of game I used to imagine making" (L20) | "…the kind of game I grew up wishing I could make" | Take 2, delivered haltingly | Keep the script; consider a pickup (section 6) |
| "I already knew the game I wanted to make" (L15) | "I already knew *exactly* the game…" | Take 2 | Keep the script (take 2's ending rises) |
| "It started as an idea in my head" (L14) | "It started as a *crazy* idea in my head" | Take 2 | Keep the script; optional |

Also worth knowing: the number phrase in L11 ("a hundred-and-thirty-two-degree route at two thousand and forty-eight points") is dense. Take 1 lost "eight" in it, while takes 2 and 3 are fine, so keep the numbers exactly as recorded.

## 9. Strongest beats in the performance

These are the moments where the measurements show the most life: the widest pitch movement and the firmest endings. Confirm them by ear.

1. **L19 "What I'm proudest of…" (take 2).** 11 semitones of pitch movement, matched only by L12 take 2, with a big lift on "proudest".
2. **L20 "…the kind of game I used to imagine making" (take 3).** It has the natural half-second beat before "I used to imagine making". Together with L21 this is the emotional landing.
3. **L08 "And none of this is a cutscene…" (take 1).** Twice the pitch movement of take 2 (9.4 vs 4.5 st), with a firm falling ending.
4. **L11's spontaneous ending, "I probably would have never even tried".** You rephrased it on the fly, and it is more conversational than the scripted line.
5. **L21 "And now… everyone can play it" (take 3).** The only reading of the last line whose pitch falls to a full stop.

Also strong: L06 (more pitch movement than its other take), L12 take 2 (a clear lift into the visual section), and L18's three-beat rhythm.

## 10. Instructions for Codex: assemble the selected narration

Do this only after the four close calls in section 1 are confirmed and option A or B is chosen. Until then the picture stays exactly as it is.

1. **Inputs.** Use the session file at its sha256 (`670b7a1f7602907d4cdbc99f11fd3a451edff990ddb095615e237644b3b97e51`) and `capture/youtube/vo-selects.json`. Refuse to run if the hash differs.
2. **Cut by sample.** For each line, in order L01–L21, read `select.keep[]` and extract every `fromSample`–`toSample` range from the 44.1 kHz source (decode the FLAC to 32-bit float; no resampling yet). Join a line's keep ranges with a 15 ms equal-power crossfade. Each join sits in silence (≤ −59 dBFS), so it is inaudible.
3. **Edges.** Apply a 10 ms fade-in and a 30 ms fade-out at each line's in and out points. Do not move an in point earlier: L15 and L20 start just after a mouth click on purpose.
4. **Gain.** Apply `clipGainDb` per line. That is the only level change per line.
5. **Filter.** Apply one 80 Hz high-pass (12 dB/octave) to the whole narration stem, room tone included. No noise reduction, de-essing, EQ, time-stretch, pitch shift, word repair or synthetic audio.
6. **Room tone.** Loop `roomTone` (166.00–169.85 s) with 200 ms crossfades. Lay it at 0 dB under the stem from 0.5 s before the first line to 0.5 s after the last, so gaps never drop to digital silence.
7. **Place.** Put each line at `placements.<A|B>.placement[id].startS` on a 48 kHz timeline (resample with soxr at very high quality). Lines must not overlap, and none may touch s10 or s15.
8. **Write only into `capture-final/youtube/audio/` (gitignored):** `vo-stem-48k.wav` (24-bit, mono, unity gain after clip gain; no loudness normalisation, since final loudness is set at the mix with music) and `vo-stringout-48k.wav` (the 21 lines back to back with 0.6 s gaps, for audition). Write a manifest with source sha256, every keep range, output sha256 and measured LUFS / true peak per line.
9. **Film spec, after approval only.**
   - Replace `youtube-film.json voiceover[]` (VO-A…VO-Q) with L01–L21, using `selectedText`, `words` and the chosen placement's frames.
   - Update the treatment's §5 and the "AI is not mentioned until 1:27.3" line.
   - `validateFilm`'s 2.9 words/s ceiling was written for an unrecorded script. Seven selects are naturally faster on their own audio (L01 3.10, L03 3.00, L06 2.98, L08 3.16, L10 3.28, L15 3.55, L20 3.39). Do not pad windows to pass it: propose measuring recorded lines by their real audio (every select is ≤ 5.6 syllables/s) and get sign-off.
10. **Picture, after approval only.** Re-time per section 5: act boundaries on bars, the line-to-picture pairings in section 4, then re-time the music markers and the title cue sheet, re-render titles and the picture lock, and re-run full QA.
    - The master is silent today (`-an`). When the narration joins it, add AAC-LC 48 kHz using the existing `aacArgs` in `capture/ci/assembly.ts`.
11. **Audio QA.**
    - Hash-check every extracted range against the source.
    - Confirm no clipping (selects reach −4.4 dBTP true peak before gain, −3.8 dBTP after) and no line over an impact.
    - Produce a stringout for a human listen, with the four close calls flagged.
    - Do not commit or push until the cut with narration has been watched and approved.
