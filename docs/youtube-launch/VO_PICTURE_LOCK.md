# Shoot the Moon: Option A VO / picture-lock implementation

**Approval state:** the author approved the 2:55.20 VO / picture lock on 2026-10-06 and authorized committing and pushing its implementation on `youtube-launch-vo-lock`. No PR or merge is authorized. Implementation base: `668c724039f7d0e17f31df21060444d1738a836c`.

Watch [the review MP4](../../capture-final/youtube/shoot-the-moon-vo-picture-lock-review.mp4) or [the high-quality master](../../capture-final/youtube/shoot-the-moon-vo-picture-lock.mp4). Both are **2:55.20 / 10,512 frames** and contain only the selected real narration. All media remains gitignored.

## Runtime and narration

Picture: **2:55.20**, **10,512 frames**, 1920×1080 at 60 fps; 73 whole bars at 100 BPM.
Edited recorded narration: **121.009916667 s** / **5,808,476 samples at 48kHz**. Kept source samples total **121.054988662 s** before three internal pause crossfades. Both selected and processed WAVs are conformed to the **175.2 s** film timeline. The first line starts at 3.9 s; the closing finishes at 171.96 s.

## Original recording

`capture-final/youtube/audio/source/shoot-the-moon-vo-session-01.wav` remains read-only.

SHA-256: `b1f9519450c98ab8792f63e355028476b21e16c065e278cb3aa8ad64209b96d8`.
Decoded PCM SHA-256: `eeed8974af6775fc2d83535ae353f1015300676e7347a6faf93e3755f61d76b8`.
19,128,516 source samples, **433.753197279 s**, mono 44.1kHz 16-bit PCM; measured peak **−4.23946 dBFS**, zero clipped samples. The unchanged selects pin the earlier FLAC container; this pass pins the explicitly supplied original WAV and hashes every retained PCM range.

## Selected takes and provenance

All 21 takes use Option A. Time ranges are original WAV seconds; sample endpoints are half-open. Exact source/film sample mappings, range hashes and intermediate hashes are in `capture-final/youtube/audio/narration-manifest.json`.

| Line | Take | Original source range(s), s | Source sample range(s) | Film interval, s | Gain, dB |
|---|---:|---|---|---|---:|
| L01 | 2 | 12.110000–15.340000 | 534051–676494 | 3.900000–7.130000 | -1.7 |
| L02 | 1 | 8.570000–9.520000 | 377937–419832 | 13.700000–14.650000 | +3.0 |
| L03 | 1 | 19.240000–22.240000 | 848484–980784 | 15.350000–18.350000 | -2.5 |
| L04 | 2 | 31.580000–33.000000 | 1392678–1455300 | 33.700000–35.120000 | +1.8 |
| L05 | 2 | 43.410000–47.520000 | 1914381–2095632 | 38.600000–42.710000 | -3.0 |
| L06 | 1 | 54.000000–63.070000 | 2381400–2781387 | 44.100000–53.170000 | +0.0 |
| L07 | 2 | 93.260000–96.235000; 96.735000–104.480000 | 4112766–4243964; 4266014–4607568 | 53.770000–64.474979 | +0.0 |
| L08 | 1 | 107.650000–115.250000 | 4747365–5082525 | 65.390000–72.990000 | +0.0 |
| L09 | 1 | 134.370000–139.070000 | 5925717–6132987 | 73.790000–78.490000 | +0.0 |
| L10 | 2 | 159.830000–165.920000 | 7048503–7317072 | 79.490000–85.580000 | +0.0 |
| L11 | 3 | 207.190000–216.320000; 216.940000–221.660000 | 9137079–9539712; 9567054–9775206 | 86.080000–99.914979 | +0.0 |
| L12 | 2 | 228.580000–231.440000 | 10080378–10206504 | 100.930000–103.790000 | +0.0 |
| L13 | 2 | 240.210000–244.130000 | 10593261–10766133 | 104.290000–108.210000 | +0.0 |
| L14 | 1 | 262.970000–275.190000 | 11596977–12135879 | 109.110000–121.330000 | +0.0 |
| L15 | 1 | 297.090000–299.510000; 299.990000–302.360000 | 13101669–13208391; 13229559–13334076 | 123.300000–128.074979 | +0.0 |
| L16 | 1 | 313.510000–318.340000 | 13825791–14038794 | 128.990000–133.820000 | +2.6 |
| L17 | 2 | 344.050000–353.200000 | 15172605–15576120 | 134.720000–143.870000 | +0.0 |
| L18 | 2 | 371.380000–380.000000 | 16377858–16758000 | 144.770000–153.390000 | +1.7 |
| L19 | 2 | 384.270000–387.600000 | 16946307–17093160 | 155.600000–158.930000 | -1.6 |
| L20 | 3 | 422.675000–426.810000 | 18639968–18822321 | 159.530000–163.664979 | +0.0 |
| L21 | 3 | 427.600000–430.060000 | 18857160–18965646 | 169.500000–171.960000 | +0.0 |

Approved variants are unchanged: “One of the key moments…”, “…I probably would have never even tried”, “The monuments, machines, and animations are all built in code”, and the selected closing “And now everyone can play it.” Nothing is synthesized.

## Every picture timing change from the first cut

WORLD and ESCALATION are unchanged. SYSTEMS grows **36 s** (43.8–123.0); BUILD contracts **12 s** (123.0–155.4); PAYOFF shifts **24 s** and retains its full **19.8 s**. The narrative order is unchanged.

| Segment | First cut | Option A | Length change | Picture / reason |
|---|---|---|---:|---|
| s01 | 0:00.00–0:04.20 (252 f) | 0:00.00–0:04.20 (252 f) | +0.00 s | The Moon swells out of black (the reel's own head fade, entered halfway). |
| s02 | 0:04.20–0:06.60 (144 f) | 0:04.20–0:06.60 (144 f) | +0.00 s | Touchdown: the amber ring blooms around your lander, then dips toward black. |
| s03 | 0:06.60–0:09.60 (180 f) | 0:06.60–0:09.60 (180 f) | +0.00 s | The Vesper Citadel, held on c03#143 (the reel's own hold frame), new slow push. |
| s04 | 0:09.60–0:13.20 (216 f) | 0:09.60–0:13.20 (216 f) | +0.00 s | Vesper's transmission card over the Citadel (native UI): "First is not ownership. Remove your extractor from my Moon." |
| s05 | 0:13.20–0:18.60 (324 f) | 0:13.20–0:18.60 (324 f) | +0.00 s | Launch authority dialog (native UI): LAUNCH AT NULL MERIDIAN? [CANCEL] [FIRE]. |
| s06 | 0:18.60–0:19.20 (36 f) | 0:18.60–0:19.20 (36 f) | +0.00 s | Liftoff: the warhead punches up into frame. |
| s07 | 0:19.20–0:21.60 (144 f) | 0:19.20–0:21.60 (144 f) | +0.00 s | HERO: the warhead crosses the lit limb. |
| s08 | 0:21.60–0:24.00 (144 f) | 0:21.60–0:24.00 (144 f) | +0.00 s | Second angle: nose-down along the limb. |
| s09 | 0:24.00–0:26.40 (144 f) | 0:24.00–0:26.40 (144 f) | +0.00 s | Terminal approach over the dark limb; the last 600 ms in silence. |
| s10 | 0:26.40–0:28.80 (144 f) | 0:26.40–0:28.80 (144 f) | +0.00 s | FIRST STRIKE IMPACT: amber dome over the shattered crater. |
| s11 | 0:28.80–0:31.80 (180 f) | 0:28.80–0:31.80 (180 f) | +0.00 s | Ejecta and shock ring; the crater darkens to debris. |
| s12 | 0:31.80–0:33.60 (108 f) | 0:31.80–0:33.60 (108 f) | +0.00 s | FIRST STRIKE COMPLETE · THE MOON REMEMBERS (native card), fading to black. |
| s13 | 0:33.60–0:34.80 (72 f) | 0:33.60–0:34.80 (72 f) | +0.00 s | VESPER COUNTERSTRIKE · FIRE NOW (native UI; c13 plus its c14 cover, one 1.2 s still). |
| s14 | 0:34.80–0:36.00 (72 f) | 0:34.80–0:36.00 (72 f) | +0.00 s | The cyan-exhaust warhead dives onto your lander. |
| s15 | 0:36.00–0:38.40 (144 f) | 0:36.00–0:38.40 (144 f) | +0.00 s | COUNTERSTRIKE CONTACT: fireball, shock ring, debris rain. |
| s16 | 0:38.40–0:40.80 (144 f) | 0:38.40–0:40.80 (144 f) | +0.00 s | The Octogonal lead locked in the game's reticle (c17 plus its c18 cover). |
| s17 | 0:40.80–0:42.60 (108 f) | 0:40.80–0:42.60 (108 f) | +0.00 s | Violet volley onto the Signal Array. |
| s18 | 0:42.60–0:43.80 (72 f) | 0:42.60–0:43.80 (72 f) | +0.00 s | Your cyan defense beam lands; the lead breaks apart. |
| s19 | 0:43.80–0:46.20 (144 f) | 0:43.80–0:46.20 (144 f) | +0.00 s | Chapter card on black. |
| s20 | 0:46.20–0:52.80 (396 f) | 0:46.20–0:53.40 (432 f) | +0.60 s | NEW CAPTURE 1: the live launch gate (current build, 1920x1080 HUD profile): SHOOT THE MOON · BEGIN INVASION · CLICK · DRAG · SCROLL TO ZOOM. |
| s20a | new | 0:53.40–0:57.60 (252 f) | +4.20 s | Crater Crown: clean reel frame 2690, restrained push over machinery on the claimed scar. |
| s20b | new | 0:57.60–1:00.00 (144 f) | +2.40 s | Helios Spire: clean reel frame 2490, restrained push over the mass-driver mechanism. |
| s20c | new | 1:00.00–1:05.40 (324 f) | +5.40 s | Large Moon globe: clean reel frame 200, restrained push and breathing room before live input. |
| s21 | 0:52.80–1:01.20 (504 f) | 1:05.40–1:13.20 (468 f) | -0.60 s | Real phone-viewport recording (repo verification artifact): TRACKING → FIRE NOW → tap → INTERCEPTED. |
| s22 | 1:01.20–1:07.20 (360 f) | 1:13.20–1:19.20 (360 f) | +0.00 s | NEW CAPTURE 2: orbit view, SELECTED LANDING SITE panel: LATITUDE 5.490° N · LONGITUDE 16.040° W · MEAN SPHERE · ALT 0 M. |
| s23 | 1:07.20–1:18.00 (648 f) | 1:19.20–1:32.40 (792 f) | +2.40 s | Route diagram on black, computed from the game's own route code. |
| s24 | 1:18.00–1:21.60 (216 f) | 1:32.40–1:36.00 (216 f) | +0.00 s | One code excerpt: STRIKE_ROUTE_SAFETY. |
| s24a | new | 1:36.00–1:40.80 (288 f) | +4.80 s | Existing verified flight recording moves as the author describes ambitious camera work. |
| s25 | 1:21.60–1:27.00 (324 f) | 1:40.80–1:49.80 (540 f) | +3.60 s | NEW CAPTURE 3: the mining robot's laser on deposit beta, with the live outpost HUD (ore, energy, robots). |
| s25a | new | 1:49.80–2:03.00 (792 f) | +13.20 s | Helios Spire: actual reveal, charging rings, mass-driver firing and recovery. A continuous capture; no replay. |
| s26 | 1:27.00–1:29.40 (144 f) | 2:03.00–2:05.40 (144 f) | +0.00 s | Chapter card on black. |
| s27 | 1:29.40–1:36.60 (432 f) | 2:05.40–2:12.60 (432 f) | +0.00 s | Build-record diagram on black. |
| s28 | 1:36.60–1:55.80 (1152 f) | 2:12.60–2:19.80 (432 f) | -12.00 s | Release-candidate evidence, baseline vs final, four pairs (rival close, missile follow, impact, ejecta). |
| s29 | 1:55.80–2:03.00 (432 f) | 2:19.80–2:24.60 (288 f) | -2.40 s | Contact grid of 24 clean reel shots. |
| s30 | 2:03.00–2:11.40 (504 f) | 2:24.60–2:35.40 (648 f) | +2.40 s | QA before/after of the c12 capture (title screen ghosting, then recaptured). |
| s31 | 2:11.40–2:13.20 (108 f) | 2:35.40–2:37.20 (108 f) | +0.00 s | Push into the Signal Array status card: TERRITORY CLAIMED · PERMANENT (native UI). |
| s32 | 2:13.20–2:15.00 (108 f) | 2:37.20–2:39.00 (108 f) | +0.00 s | Helios Spire; the mass driver fires. |
| s33 | 2:15.00–2:16.20 (72 f) | 2:39.00–2:40.20 (72 f) | +0.00 s | Signal Array vanes at full deployment. |
| s34 | 2:16.20–2:18.00 (108 f) | 2:40.20–2:42.00 (108 f) | +0.00 s | Crater Crown seated in the First Strike scar. |
| s35 | 2:18.00–2:25.20 (432 f) | 2:42.00–2:49.20 (432 f) | +0.00 s | One continuous pull-back from the Bastion Ziggurat to the claimed Moon. |
| s36 | 2:25.20–2:31.20 (360 f) | 2:49.20–2:55.20 (360 f) | +0.00 s | End card on black: SHOOT THE MOON lockup. |

The existing route diagram is extended, followed by its existing source-code proof and a short existing flight recording. No extra telemetry or graphic event is added. The personal material uses full-frame approved clean game imagery with restrained 2.5% pushes; no outside IP, stock or nostalgia imagery. The first-strike flight recording plays inside the existing phone-board framing at its own cadence.

The iteration board still shows all four genuine before/after pairs, now at 1.8 s per pair. The capture grid is 4.8 s and the actual ghosting/corrected-recapture board is 10.8 s. This trades repeated process holds for the recorded QA story.

The 7.2 s final Moon pull-back is unchanged in length: **5.535020833 s** remains without narration. The end card remains 6 s, with **3.24 s** after the selected closing finishes. All existing impact protection and graphics remain in place at their corresponding frames.

## Clean-source recovery

The separately supplied clean reel was absent locally. The existing approved assembler was run against verified run-6 artifacts into `capture-final/youtube/sources/reel-recovered/`, with bounded decoder concurrency and the release's six x264 threads. It reproduced the registered clean reel **byte for byte**: `f1150945eb5356f4260351622201edc14d982ac1baaab804091ab1d8c74680d0`, 24,633,560 bytes / 3,456 frames. The reproduced loop also exactly matches `9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864`, 988,015 bytes / 414 frames.

The unmodified assembler's complete QA passed: 25 locked inputs, corrected c12, all four hold/cover intervals, exact timing, full decode, every reel/loop frame, and still-image formats. Reel mean/max luma difference from its approved plan: 0.098 / 1.928 levels; loop: 1.041 / 1.844. The source run is 36346715980, source commit `d3301b4f01c3a27a42525b0876f3039ea66c55d9`. Evidence: `qa/source-recovery-report.json`, `qa/reel-recovered-final.log`, and the recovered source `manifest.json` / `SHA256SUMS`. All original media pins and approved media files remain unchanged.

The original supplied titled reference was also absent. The existing repository finish `artifacts/reel-motion-review/reel-57s-1080-titled.mp4` is separately registered by its verified hash `7be8b4f8e896a0c639b3aad3be3a71e6c0be2a6fd09b6c9e9a0e408f9083c5fb` as **creative reference only**. It is read by QA to prove absence of titled pixels; the assembler never uses it as footage. `mediaPriority.ts` and its clean-source gate remain unchanged.

## Conservative audio processing

- Extraction from original mono 16-bit PCM at exact 44.1kHz keep samples. No source edits.
- Only the selected per-line gains in the table above. No additional output gain.
- Linear line-edge fades: 441 samples / 10 ms in, 1,323 samples / 30 ms out at 44.1kHz.
- L07, L11 and L15 alone: 662-source-sample equal-power crossfade per selected pause edit (15.011338 ms). Natural pauses remain intact elsewhere.
- Resample 44.1→48kHz using libsoxr precision 33, without time stretching.
- Original room tone from 166.000–169.850 s, unity gain, 200 ms equal-power looping; placed from 3.4–172.46 s, with 10/30 ms outer fades.
- One whole-stem 80Hz two-pole high-pass, 12 dB/octave, including room tone.
- 48kHz mono 24-bit PCM intermediates. Master AAC-LC uses the existing pipeline helper at nominal 192 kb/s. No music/game audio, dynamics, limiter, denoise, gate, auto-leveling, enhancement, de-reverb, pitch correction or synthetic content.

The mix has **−3.13020 dBFS sample peak**, approximately **−3.0 dBFS true peak** and **−25.0 LUFS integrated**, without loudness normalization. Final loudness is deferred to the music mix.

## Recorded-delivery validation change

The old 2.9 words/s cap estimated an unrecorded script. Seven approved recorded takes naturally exceed it, so applying it to this performance would reject the selected delivery or encourage false padding. Recorded VO now validates exact chosen wording/take, unpadded source-derived sample windows, original order, no overlap and measured syllable rate ≤5.6/s. The script-only 2.9 words/s rule and the existing impact/total-word constraints remain. Missing selects fail closed.

## Fourth capture

The existing Helios Spire mass-driver shot was captured successfully in **one uninterrupted 792-frame / 13.2 s session**, source +300 to +13,483.333 ms from reveal-open, through the existing exact-clock infrastructure. No gameplay or camera code changed. First fire: +4,200 ms; next fire: +16,200 ms, beyond this window. No titles or audio in the source. The film uses a declared 960×540 source crop at x=500, y=80, scaled to 1920×1080 (2×), retaining the native 16:9 ratio and every frame. Phone-size comparison showed the mechanism shrinking too far under the initial wider crop; the tighter framing keeps its firing behavior visible. The clean source remains full frame.

- Source: `capture-final/youtube/captures/helios-mass-driver/helios-mass-driver-clean.mkv`, **102,588,016 bytes**. SHA-256: `6be1d788984cabbc7e4411622eb7cb23feddf232b93f69a99c8be010e74a3033`.
- Full provenance: `capture.json`, SHA-256 `15a9ba4802bc7d475262ba92e82ef3e12918fc7f09364a82980c8b7e46a9c4f4`; 792 original PNG hashes and source times. Sequence hash: `f2a6a49c65fbe61ac99f7c8dfc3a294da5d95d8b041f9e30fd7bc3103da2e733`.
- Captured 2026-10-06 04:13:06–04:39:39 UTC using pinned Playwright 1.62.1 / Chromium 151.0.7922.34, existing ANGLE SwiftShader configuration. CSS viewport 1280×720, DPR 1.5, actual buffer 1920×1080; existing hidden-HUD policy and `MON_HELIOS_SPIRE` fixture.
- **All eight capture checks passed.** All 792 PNGs are distinct; no retries, page errors or console errors. Worst clock error remains below the unchanged 1 ms guard. Twelve capture/game input hashes and the built game bundle hash match.
- The tracked capture index retains its original three entries verbatim and pins this fourth source/provenance. Incomplete diagnostic attempts remain under ignored QA directories and are excluded from the film. No frames are spliced across sessions.

## Pickup candidates

No selected line requires a pickup to complete this pass. `VO_SELECTS.md` flags L21’s final “it” as soft; judge it by listening and protect it when music is added. A new “And now you can play it” is an optional later pickup if that wording is wanted; this review retains “everyone.” L20’s alternate “grew up wishing I could make” also requires a fluent pickup only if that alternate wording is chosen. The selected L14 take 1 uses the approved wording and does not need the alternate take’s “crazy idea” pickup.

## Delivered-file QA and regressions

**All completed audits passed:** 16/16 delivered-film checks, 36/36 narration checks, 8/8 fourth-capture checks, and 13/13 final workspace/provenance checks. The separate review encode passed its format, size, timestamp and identical-AAC-packet checks. No validation threshold was lowered.

- Original WAV/range provenance, all selected takes and exact placements, no line overlap or padding, no clipping, continuous original room tone, and edit-boundary PCM steps. Maximum boundary step: **0.000604 amplitude** (about −64.38 dBFS).
- **576/576 app unit tests** across 63 files, with the suite's original assertions and timeouts; serial worker execution on this two-CPU machine. The earlier parallel attempt timed out under rendering load; the complete serial rerun passed without changing test rigor.
- **119/119 existing capture/reel-plan regressions**.
- **57/57 existing reel-title, loop-title, FFmpeg and assembly regression tests**. Two existing opt-in synthetic assembly tests remain skipped under the ordinary command; the unmodified real-source assembler's complete delivered-media QA passed separately above.
- **23/23 YouTube-film, narration and media-priority tests**, rerun after registering the complete fourth capture and final picture selections; no skipped tests.
- App typecheck, capture TypeScript typecheck and lint passed. The capture's harness build passed as well.
- The authorized continuous capture test passed; **8/8 capture audit checks** passed.
- Graphics rendered at all 10,512 frame positions. **20/20 fresh-page determinism probes** and **20/20 cached-render pixel-equivalence probes** passed. Full alpha/safe-frame checks passed for every frame.

The final audit reconfirmed all **203 protected baseline hashes**, the original three capture records, unchanged VO selects and original WAV, unchanged HEAD, empty staging area and changes confined to `capture/youtube/` and `docs/youtube-launch/`. Evidence: `qa/vo-lock-final-audit.json` and `qa/regression-test-results.json`.

| Required validation | Result / evidence |
|---|---|
| 1. Original voice hash/provenance | Original WAV and PCM hashes above; unchanged after delivery. |
| 2. Every VO range resolves to original recording | All 24 keep ranges across 21 selected lines match original WAV PCM; take/range/sample hashes in the narration manifest. |
| 3. No overlapping narration | All exact sample placements validate, with no overlap or padded windows. |
| 4. No digital cuts/clicks | Exact line/pause-edit PCM boundaries pass; largest adjacent step 0.000604 (−64.38 dBFS). Playback remains the performance judgment. |
| 5. No clipping | Zero source, mixed-PCM and decoded-AAC clipped samples. AAC true peak −3.1 dBFS. |
| 6. No titled reel/loop as footage | Clean source pinned to `f115…80d0`; 1,039 titled-difference probes, zero frames closer to the titled reference. |
| 7. Approved reel unchanged | Baseline hashes intact; recovered canonical reel byte-identical; original reel-plan/title/assembly regressions and real-source QA passed. |
| 8. Approved loop unchanged | Baseline hashes intact; recovered canonical loop byte-identical; loop regressions and real-source QA passed. |
| 9. Protected impacts clear | Alpha exactly zero on every protected frame; undeclared frames also clear. |
| 10. No accidental repeated cut frames | Every non-black cut changes picture under the original threshold; intentional black-card boundaries retained. |
| 11–15. Video format | Master and review: 10,512 frames, 1920×1080, exact 60/1 fps, H.264 High, yuv420p, BT.709 tv, faststart. Every frame timestamp verified. |
| 16. A/V alignment | Both video and AAC streams start at zero and declare 175.200000 s. |
| 17. Final narration rate | 48kHz mono AAC-LC; both WAVs 48kHz mono 24-bit PCM. |
| 18. No music/audio additions | One narration stream; decoded AAC/mix correlation **0.999932879**. Review carries the master's exact 8,214 AAC packet payloads. |
| 19. No unexpected gameplay/code changes | All 203 protected hashes unchanged; only authorized YouTube/docs paths changed. |
| 20. Fourth capture provenance | All 792 source frame hashes/times, source MKV, capture manifest, build inputs and capture index verified; 8/8 checks passed. |

The Helios segment's worst mean source/picture luma difference is **0.261** at 192×108, below the unchanged 1.5 limit. Where title alpha is zero, the composite/picture worst mean difference is **0.282**, below the unchanged 1.0 limit. All generated/pushed frames stay within Y=16–235; untouched reel frames preserve their source's approved excursions exactly.

Graphic proof extraction now batches all 19 exact frame selections into one decode, retaining the original 480p YUV atlas path. This removes repeated full-film decoding without skipping checks. Independent timestamp extractions of frames **206, 5525 and 10511** match the batched RGB pixels exactly. Evidence: `qa/graphic-extraction-equivalence.json`; all 23 YouTube/VO tests and lint passed again after this QA-only change.

## Visual inspection

The complete master was inspected chronologically through six 480p section strips and the full-film 1 fps contact sheet, supplemented by the 2 fps Helios sequence, source/framing checks and all 19 graphic hold-frame proofs. This is frame inspection, **not a claim of real-time listening/playback**. The author must judge spoken delivery and pacing by watching the MP4.

- Personal history stays over three clean game/Moon shots with restrained pushes, then returns to live phone input. This is a calm stretch; the 5.4 s Moon hold is a playback review point.
- The route's 13.2 s builds the arc and verified values progressively, then moves to source code and flight. No accidental freeze or extra telemetry was found.
- Helios shows one continuous native sequence, with the real launch followed by recovery. Its later seconds are quieter visually; judge that against the selected 12.22 s line. No replay or source splice was added.
- The 7.2 s collaboration diagram remains subordinate to the project. All four genuine iteration pairs survive; the grid and actual ghosting/corrected-recapture pair support iterative engineering.
- No clear implementation defect appeared in the full chronological inspection. Deliberate holds, diagram reading time and mechanical recovery remain author playback decisions.
- Primary headings, chapter cards, route values and final lockup are legible at 480×270. Existing source citations, tool names and native UI detail remain small supporting evidence. ORBITAL RECORD and the existing 19 graphic events are preserved; no full captions or new graphic event is added.
- The full 19.8 s payoff, 7.2 s Moon pull-back and 6 s end card remain. The unnarrated pull-back/end breathing room above is intact.

Evidence: `qa/visual-review-report.json`, `qa/visual-review/`, `qa/vo-lock-contact-sheet.jpg`, `qa/readability-480.jpg`, and `qa/readability-1080/`.

## Outputs and workspace state

| Output under `capture-final/youtube/` | Exact bytes | MiB | SHA-256 |
|---|---:|---:|---|
| `shoot-the-moon-vo-picture-lock.mp4` | 51,342,891 | 48.964396 | `d9166c2906e5cccbaeb922914b361d08cbfd5ebe2365769ce26c56cf3797b1c3` |
| `shoot-the-moon-vo-picture-lock-review.mp4` | 31,382,163 | 29.928363 | `c144f67401e724622a0fed4b9894a4c50f0546f692946c47333258f14ff8f249` |
| `audio/narration-selected.wav` | 25,228,902 | 24.060156 | `ac1b4898f535357cdd80f7095f1092e23bbdcb488bab1e8c8ba28ad788f1bb4c` |
| `audio/narration-mix.wav` | 25,228,902 | 24.060156 | `b3b34c019eb025160834297d7f7d2ef22a160ca463e13f8299b9962ffa4339f1` |
| `clean-picture-lock.mp4` (silent intermediate) | 45,252,849 | 43.156480 | `ea0f1eaac05659f8179856ef1db84355e9daa395bc1a4a15a7ee25e9a8ef43a7` |

The review is a separate two-pass H.264 High derivative at **1,240 kb/s video**, leaving 75,117 bytes below the 30 MiB ceiling. Its runtime/frame timestamps/format match the master and its narration packets are copied unchanged. The master is preserved at the original hero encode settings. Both narration WAVs are exactly **175.2 s / 8,409,600 samples**; edited spoken material totals **121.009916667 s**.

Additional generated files/bundles: `assembly-manifest.json`, `audio/narration-manifest.json` and per-line WAVs, `voiceover-script.txt`, `music-cue-sheet.json` (future markers only), `titles/`, `sources/reel-recovered/`, the completed Helios capture with its 792 PNGs/manifest/hash list, `work/` lossless/cache intermediates, and `qa/` reports/contact sheets/proofs/logs. All remain ignored. Diagnostic interrupted attempts are excluded from the film. `qa/file-inventory.json` lists the complete current output tree, including inputs and diagnostic caches, by path and size.

Implementation files (working-tree state at the initial review handoff):

- `capture/youtube/README.md`
- `capture/youtube/assembleYoutubeFilm.mjs`
- `capture/youtube/captures/captures.json`
- `capture/youtube/media-sources.json`
- `capture/youtube/mediaPriority.test.ts`
- `capture/youtube/renderYoutubeTitles.mjs`
- `capture/youtube/validateYoutubeFilm.mjs`
- `capture/youtube/youtube-film.json`
- `capture/youtube/youtubeFilm.test.ts`
- `capture/youtube/youtubeFilm.ts`
- `capture/youtube/youtubeTitles.cues.json`
- `docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md`

New, untracked implementation/report files:

- `capture/youtube/assembleNarration.mjs`
- `capture/youtube/captureMassDriver.spec.ts`
- `capture/youtube/createReviewEncode.mjs`
- `capture/youtube/narration.test.ts`
- `capture/youtube/narration.ts`
- `capture/youtube/playwright.youtube.config.ts`
- `capture/youtube/rebuildCleanSource.mjs`
- `capture/youtube/validateMassDriver.mjs`
- `capture/youtube/validateNarration.mjs`
- `docs/youtube-launch/VO_PICTURE_LOCK.md`

`VO_SELECTS.md`, `vo-selects.json`, `mediaPriority.ts`, `finalEdit.json`, gameplay and the approved reel/loop/title implementation remain unchanged. The original WAV remains in its original ignored source location.

Initial review handoff `git diff --stat` (before the approval documentation update; untracked files are listed separately above):

```text
 capture/youtube/README.md                     | 161 +++----
 capture/youtube/assembleYoutubeFilm.mjs       |  50 ++-
 capture/youtube/captures/captures.json        |  49 ++-
 capture/youtube/media-sources.json            |  13 +
 capture/youtube/mediaPriority.test.ts         |  11 +-
 capture/youtube/renderYoutubeTitles.mjs       |  19 +-
 capture/youtube/validateYoutubeFilm.mjs       |  66 ++-
 capture/youtube/youtube-film.json             | 582 ++++++++++++++++++--------
 capture/youtube/youtubeFilm.test.ts           |  57 ++-
 capture/youtube/youtubeFilm.ts                |  45 +-
 capture/youtube/youtubeTitles.cues.json       | 531 ++++++++++++-----------
 docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md | 136 +++---
 12 files changed, 1090 insertions(+), 630 deletions(-)
```

Initial review handoff `git status --short --branch`:

```text
## youtube-launch-vo-lock...origin/claude/media-priority-youtube-agl98m
 M capture/youtube/README.md
 M capture/youtube/assembleYoutubeFilm.mjs
 M capture/youtube/captures/captures.json
 M capture/youtube/media-sources.json
 M capture/youtube/mediaPriority.test.ts
 M capture/youtube/renderYoutubeTitles.mjs
 M capture/youtube/validateYoutubeFilm.mjs
 M capture/youtube/youtube-film.json
 M capture/youtube/youtubeFilm.test.ts
 M capture/youtube/youtubeFilm.ts
 M capture/youtube/youtubeTitles.cues.json
 M docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md
?? capture/youtube/assembleNarration.mjs
?? capture/youtube/captureMassDriver.spec.ts
?? capture/youtube/createReviewEncode.mjs
?? capture/youtube/narration.test.ts
?? capture/youtube/narration.ts
?? capture/youtube/playwright.youtube.config.ts
?? capture/youtube/rebuildCleanSource.mjs
?? capture/youtube/validateMassDriver.mjs
?? capture/youtube/validateNarration.mjs
?? docs/youtube-launch/VO_PICTURE_LOCK.md
```

At that initial handoff, no changes were staged and no commit, push or PR had been performed; `git diff --check` passed. The subsequent author approval authorizes preserving the implementation in a commit and pushing the branch. All `capture-final/` media remains ignored and excluded.

## Before MUSIC LOCK

The author has approved the performance, story flow and timing. Decide whether any optional pickup is wanted before fitting music. Compose/select music against the retimed 100 BPM markers, protect narration and impacts, then set final mix loudness and run final delivery QA. This approved VO / picture lock contains no music.
