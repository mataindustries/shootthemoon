# SHOOT THE MOON — YOUTUBE FILM: SCORE HANDOFF FOR ASTRA

**Implementer:** Astra, through DaemonV12 V0.5 MCP (`daemonv12_project_create / read / validate / patch`, `instruments_list`, `drumkits_list`, `render`, `analyze`, `render_info`).
**Design authority:** [YOUTUBE_SCORE_BIBLE.md](YOUTUBE_SCORE_BIBLE.md): reasons, audit and detail. **Where they differ, this handoff wins.**
**Scope:** compose and render the score only. Do not modify the picture, the voiceover, gameplay or capture code. Do not change tempo or re-time anything.

Units: film time `M:SS.ss`; 0-based frames at 60 fps; positions in DaemonV12 grammar (`48:2+1/8` = an eighth after beat 2 of bar 48). `+Nf` marks non-grid times such as VO boundaries. One beat = 0.6 s; one bar = 2.4 s.

---

## 1. Locked facts and the media verification gate

| Item | Value |
|---|---|
| Picture | `capture-final/youtube/shoot-the-moon-vo-picture-lock.mp4`, SHA-256 `d9166c2906e5cccbaeb922914b361d08cbfd5ebe2365769ce26c56cf3797b1c3`, 1920×1080, 60/1 fps, **10,512 frames, 175.200000 s** |
| VO | `capture-final/youtube/audio/narration-mix.wav`, SHA-256 `b3b34c019eb025160834297d7f7d2ef22a160ca463e13f8299b9962ffa4339f1`, 48 kHz mono 24-bit, **8,409,600 samples**, −25.0 LUFS, ≈ −3.0 dBTP, room tone 0:03.40–2:52.46 |
| Grid | **100 BPM, 4/4, 73 bars = 175.2 s**; authored end `74:1`; DaemonV12 output **7,726,320 frames** at 44.1 kHz |
| Lock records | branch `youtube-launch-vo-lock` @ `732aa45` (`capture/youtube/`, `docs/youtube-launch/`) |

These files were not available when the design was made, so run this gate first. **If any check fails, stop and report; do not compose.**

```sh
# in the shootthemoon checkout that holds capture-final/youtube/
sha256sum capture-final/youtube/shoot-the-moon-vo-picture-lock.mp4 capture-final/youtube/audio/narration-mix.wav
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames -of default=nw=1 capture-final/youtube/shoot-the-moon-vo-picture-lock.mp4
#   expect 1920 / 1080 / 60/1 / 10512
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,duration_ts -of default=nw=1 capture-final/youtube/audio/narration-mix.wav
#   expect pcm_s24le / 48000 / 1 / 8409600
ffmpeg -hide_banner -nostats -i capture-final/youtube/audio/narration-mix.wav -af silencedetect=noise=-48dB:d=0.30 -f null - 2>&1 | grep silence_
#   first silence_end within ±0.06 s of 3.90; last silence_start within ±0.06 s of 171.96;
#   a silence_end within ±0.06 s of 33.70, 44.10, 123.30, 155.60 and 169.50 (L04, L06, L15, L19, L21 starts)
```

**Make the ducking key.** V0.5 reads only 44,100 Hz signed PCM16, so make a converted copy. It is never mixed and the locked VO is never touched. Store it as a regular file (no symlink or hard link) inside the DaemonV12 project's `assets/`:

```sh
ffmpeg -hide_banner -i capture-final/youtube/audio/narration-mix.wav \
  -af "aresample=44100:resampler=soxr:precision=28,apad=whole_len=7726320,atrim=end_sample=7726320" \
  -c:a pcm_s16le <project-dir>/assets/voiceover/stm-vo-key-44k16.wav
# expect pcm_s16le / 44100 / 1 channel / duration_ts 7726320
# re-run the silencedetect line on the key: every boundary within 0.002 s of the 48 kHz file's
```

Record the key's SHA-256, the command and the source hash in your report.

---

## 2. Project settings

| Field | Value |
|---|---|
| `bpm` / `timeSignature` / `key` / `bars` | 100 / 4/4 / D minor / **73** |
| `render.duration` | `{"seconds": 175.2}` |
| `render.tail` | `"none"` (the authored end equals the picture end; nothing may cross it) |
| `master.effects` | highpass 30 Hz (portfolio) |
| `master.gainDb` | calibrate to §11 (no normalisation, limiter or master compressor) |
| `master.ducking` | `source` `assets/voiceover/stm-vo-key-44k16.wav`, `amountDb` **6**, `thresholdDb` **−48**, `attackMs` **30**, `releaseMs` **900** |
| Assets | the complete Orbital Foundry pack under the project's `assets/orbital-foundry/` (kit `assets/orbital-foundry/kit.json`); discover names with `instruments_list` / `drumkits_list` |

---

## 3. Track plan (15 tracks = 15 stems)

| # | Track | Instrument | Ordered effects (start values) | Under narration |
|---:|---|---|---|---|
| 1 | `atmos-drone` | sampler `10-dark-drone.wav` | highpass 130, lowpass 1800 | bed level only; plays only 0:00.00–0:43.80 and 1:49.80–2:03.00 |
| 2 | `atmos-air` | sampler `11-air-texture.wav` | highpass 3500 | allowed at bed level |
| 3 | `sub` | drumkit `sub-pulse` | highpass 32 | allowed |
| 4 | `bass-motion` | GM `synth_bass_1` | highpass 85, lowpass 800, compressor (−24 dB, 3:1, 15 / 180 ms) | allowed at bed level |
| 5 | `drive` | drumkit `mechanical-kick`, `industrial-snare` | highpass 48, saturation (4 dB, mix 0.25), compressor (−20 dB, 2.5:1, 10 / 120 ms) | low-velocity kick only; **snare never** |
| 6 | `detail` | drumkit `machine-tick`, `metallic-strike` | highpass 420 | low-velocity ticks only; **steel never** |
| 7 | `impacts` | drumkit `low-boom`, `cinematic-impact` | highpass 35 | soft low boom only; cinematic impact never |
| 8 | `riser` | sampler `08-tension-riser.wav` | highpass 260 | — (one use, VO-free) |
| 9 | `reverse` | sampler `09-reverse-swell.wav` | highpass 300 | ≤ −10 dB until the word ends |
| 10 | `alarm` | sampler `12-alarm-energy-pulse.wav` (pan −0.16) | highpass 380 | **never** |
| 11 | `claim-lead` | GM `lead_1_square` | highpass 260, lowpass 2700, delay 150 ms / 0.18 | pauses only |
| 12 | `claim-bell` | GM `celesta` | highpass 400, delay 300 ms / 0.12, reverb (room 0.55, 1.2 s, wet 0.22) | pauses only |
| 13 | `rival` | GM `pad_6_metallic` | highpass 520, lowpass 6200 | **never** |
| 14 | `harmony` | GM `pad_3_polysynth` | highpass 190, lowpass 2600 | bed level; no attacks on words |
| 15 | `strings` | GM `string_ensemble_1` | highpass 110, lowpass 6500, reverb (room 0.7, 1.8 s, wet 0.25) | soft, sustained, low register |

- Use `celesta`. Use `vibraphone` only if the celesta preset is missing or unusable in the SoundFont, and say so in the report.
- Start from the portfolio project's relative track balance (`examples/shoot-the-moon-locked-score.json`); final levels come from §11.

**Engine facts that the plan depends on:**
- Filters are static.
- Track gain automation is applied **before** track effects, so automation cannot cut a reverb or delay tail. Reverb and delay therefore exist only on tracks 11, 12 and 15, and none of them may sound into 19:2, 52:2 or the end (§8).
- Ducking affects the master only; stems are unducked.

---

## 4. Motifs and hard rules

| Identity | Material (from the portfolio score) | Voices | Lives |
|---|---|---|---|
| **CLAIM** | D–A–E–F. Seed = D–A. Question = ends on minor third F. Orbit = portfolio phrase on the kick cell. Fragments = 1→4 notes (BUILD). Realised = D–A–E → **F♯**, then E–D–A | `claim-lead` = game / player; `claim-bell` = maker; together only from 69:2 | whole film |
| **RIVAL** | E♭–D–A–A♭; reversed A♭–A–D–E♭ | `rival`, one metallic strike at entry | **4:1 → 19:2 only** |
| **THIRD PARTY** | D/A♭ alarm + 3+3+2 accents, eighths → sixteenths | `alarm`, `drive`, `sub`, `detail` | **17:1 → 19:2 only** |
| **MACHINE** | Foundry rhythm; kick cell 1, 2+1/8, 3+1/8, 4+1/8 | `drive`, `detail`, `sub`, `bass-motion` | stops dead at 19:2 and 52:2 |

**Harmony:** portfolio D-minor language to 19:2. Then:
- open fifth only under L06;
- B♭ lydian at 26:3–28:1;
- orbit bass D–C–B♭–A in whole notes from 34:1, resolving on 39:3;
- a C-colour lift after "Then" (43:1);
- D minor + E♭ at the mass driver;
- B♭ / G warmth over a D pedal in BUILD;
- **B♭(add9) 65:4 → G sus/add9 66:3 → A sus 67:2 (held) → D, third withheld, 69:2 → D(add9) with F♯ 70:1**, sustained to the end.

**Hard rules:**
1. **No F♯ in any track before 70:1 (2:45.60).**
2. Under any VO word: no `alarm`, `rival`, snare, metallic strike, cinematic impact, riser, claim note, or `reverse` above −10 dB. Claim notes go only in the pauses listed in §6 and must not sustain into the next word.
3. `riser` is used once (onset 10:1+1/12, ends 11:4). `cinematic-impact` is used twice (12:1 full, 16:1 reduced).
4. **No pulse, drone or percussion under L06** (0:44.10–0:53.17).
5. No melodic note and no accent inside the author's pauses at 2:36.74–2:37.21, 2:41.66–2:42.22 and 2:49.98–2:50.72. Sustained harmony continues through them; the G sus change on the 66:3 cut (2:37.20) is allowed because it closes the first pause.
6. Every picture event not listed in §6 goes unhit: route values, workflow nodes, iteration swaps, monument titles, end-card builds, FIRE NOW / tap.
7. The First Strike (12:1) is the loudest moment; the Counterstrike (16:1) stays below it.
8. The portfolio's claim-secured chord is **not** played at 19:2. It is played once, at 65:4.

---

## 5. Cue list

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

Per-cue instructions are in the bible §11. The bar map below is binding.

---

## 6. Key cue points

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

**Pauses used for musical responses** (word-aligned, ±0.05 s):

| Pause | Use |
|---|---|
| 0:14.61–0:15.39 | claim-lead E 7:1+1/8, F 7:2 |
| 0:40.48–0:41.04 | volley accent at 18:1 |
| 0:48.14–0:48.57 / 0:49.38–0:49.82 | claim-bell D 21:1+1/8 / A 21:3+1/8 |
| 0:53.07–0:53.81 | claim-bell E 23:1+1/8, F 23:2 |
| 0:59.22–0:59.80 | first machine ticks from 25:4 |
| 1:00.76–1:01.55 | B♭ strings enter 26:3 |
| 1:04.44–1:05.43 | bloom peak 28:1 |
| 1:32.21–1:32.59 | resolve on 39:3 |
| 1:39.83–1:40.97 | claim-lead orbit fragment |
| 1:41.35–1:41.91 | harmonic lift |
| 1:58.19–1:58.80 | metallic strike |
| 2:05.42–2:06.00 | warm chord + process pulse at 53:2 |
| 2:08.04–2:09.03 | claim-bell D |
| 2:13.78–2:14.76 | claim-bell D–A |
| 2:17.66–2:18.37 | claim-bell D–A–E |
| 2:21.53–2:22.31 | claim-bell D–A–E (tighter) |
| 2:26.93–2:27.75 | claim-bell D–A–E–F |
| 2:29.62–2:30.30 | two ticks + soft steel |
| 2:38.89–2:39.54 | A sus at 67:2 (harmony only) |

---

## 7. 73-bar map

| Bar | Time | Cue | VO | E | Instruction |
|---:|---|---|---|---|---|
| 1 | 0:00.00 | 1M1 | — | 1 | Drone + air from frame 0; claim seed D at 1:3. |
| 2 | 0:02.40 | 1M1 | L01 | 1 | Claim A at 2:2 completes the open fifth; touchdown: soft low boom at 2:4 under L01. |
| 3 | 0:04.80 | 1M1/1M2 | L01 | 2 | Hold under L01; colder shade (E♭ against D) at the Citadel cut 3:4 — no transient. |
| 4 | 0:07.20 | 1M2 | — | 2 | Vesper motif E♭–D–A–A♭ + one metallic strike at 4:1 (after L01). |
| 5 | 0:09.60 | 1M2 | — | 1 | Transmission card: percussion absent, atmosphere −6 dB, sparse D/E♭. |
| 6 | 0:12.00 | 1M2/1M3 | L02 | 2 | Launch dialog at 6:3: sub heartbeat begins. No sting after "It doesn't." |
| 7 | 0:14.40 | 1M3 | L02/L03 | 2 | Claim E–F in the L02/L03 gap (7:1+1/8, 7:2); heartbeat continues. |
| 8 | 0:16.80 | 1M3/2M1 | L03 | 3 | Reverse swell 7:4+1/6 → 8:4 (held low under L03); liftoff hit at 8:4; tick accelerando. |
| 9 | 0:19.20 | 2M1 | — | 4 | Orbit groove opens at 9:1 (kick cell, snare 2 & 4, bass D–C–B♭–A, claim orbit phrase). |
| 10 | 0:21.60 | 2M1 | — | 4 | Groove continues; riser onset 10:1+1/12. |
| 11 | 0:24.00 | 2M1/2M2 | — | 4→0 | Sixteenth ticks from 11:1; riser ends 11:4; vacuum 11:4–12:1. |
| 12 | 0:26.40 | 2M3 | — | 5 | FIRST STRIKE at 12:1 — the loudest moment. |
| 13 | 0:28.80 | 2M3 | — | 3 | Ejecta: restrained boom, spaced steel/ticks, descending claim E→D. |
| 14 | 0:31.20 | 2M3 | — | 1 | Breath from 14:2 (air + A/E), fading with the picture to near-silence. |
| 15 | 0:33.60 | 2M4 | L04 | 3 | Low jolt at 15:1; L04; reversed rival after "turn"; reverse swell to 16:1. |
| 16 | 0:36.00 | 2M4 | — | 4 | COUNTERSTRIKE at 16:1 (secondary, brighter); debris. |
| 17 | 0:38.40 | 2M5 | L05 | 3 | Octogonal 3+3+2 in kick/sub/ticks under L05; no tones under words. |
| 18 | 0:40.80 | 2M5 | L05 | 4 | Volley in the L05 breath at 18:1; double-time; beam 18:4 / steel 18:4+1/16. |
| 19 | 0:43.20 | 2M5/3M1 | L06 | 4→0 | Last burst to 19:2, then HARD CUT to silence; L06 begins. |
| 20 | 0:45.60 | 3M1 | L06 | 1 | Open fifth D–A fades in at 20:2 with the title screen; air sheen. |
| 21 | 0:48.00 | 3M1 | L06 | 1 | Claim-bell D (21:1+1/8) and A (21:3+1/8) in L06's two list pauses. |
| 22 | 0:50.40 | 3M1 | L06 | 1 | Hold the open fifth; nothing new under "searching the library". |
| 23 | 0:52.80 | 3M1/3M2 | L06/L07 | 1→2 | Claim-bell E (23:1+1/8) after "space", F on the Crater Crown cut (23:2). |
| 24 | 0:55.20 | 3M2 | L07 | 2 | Harmony moves under "became my version of all of that". |
| 25 | 0:57.60 | 3M2 | L07 | 2 | First machine ticks enter in the pause after "machines". |
| 26 | 1:00.00 | 3M2 | L07 | 2 | Full-Moon hold at 26:1; B♭ (strings, low) enters at 26:3 in the gap after "escalation". |
| 27 | 1:02.40 | 3M2 | L07 | 3 | B♭ lydian bloom swells under "…a Moon that actually feels enormous". |
| 28 | 1:04.80 | 3M2/3M3 | L08 | 3 | Bloom peaks at 28:1 in the gap; machine pulse returns at 28:2 (phone board). |
| 29 | 1:07.20 | 3M3 | L08 | 3 | Live pulse steady; bass pedal D enters. FIRE NOW / tap not hit. |
| 30 | 1:09.60 | 3M3 | L08 | 3 | Pulse continues; small lift for "built for a phone as much as a desktop". |
| 31 | 1:12.00 | 3M3 | L08/L09 | 2 | Landing-site panel at 31:3: thin to soft sixteenth ticks, bass out. |
| 32 | 1:14.40 | 3M3 | L09 | 2 | Precision bed under L09. |
| 33 | 1:16.80 | 3M3 | L09 | 2 | Precision bed; prepare the route (low D in strings). |
| 34 | 1:19.20 | 3M4 | L10 | 3 | Route board at 34:1: orbit bass as whole notes; strings enter low. |
| 35 | 1:21.60 | 3M4 | L10 | 3 | Lift continues through the draw-on (ends 1:23.70). |
| 36 | 1:24.00 | 3M4 | L10/L11 | 3 | Hold; values appear (132° at 1:24.90) — not hit. |
| 37 | 1:26.40 | 3M4 | L11 | 3 | Hold; 760 KM / 24 KM / 2,048 appear — not hit. |
| 38 | 1:28.80 | 3M4 | L11 | 3 | Thin under the spoken numbers (ticks + sustained bass only). |
| 39 | 1:31.20 | 3M4 | L11 | 3→2 | Code cut at 39:3 inside the gap after "route": resolve there; hold for reading. |
| 40 | 1:33.60 | 3M4 | L11 | 2 | Minimal under "two thousand and forty-eight points". |
| 41 | 1:36.00 | 3M4 | L11 | 3 | Flight board at 41:1: soft orbit kick cell (kick body + sub). |
| 42 | 1:38.40 | 3M4 | L11 | 3 | Claim-lead orbit fragment in the 1:39.84–1:40.97 gap. |
| 43 | 1:40.80 | 3M5 | L12 | 3 | Mining capture at 43:1; lift in the gap after "Then". |
| 44 | 1:43.20 | 3M5 | L12/L13 | 3 | Mechanical detail grows under L13. |
| 45 | 1:45.60 | 3M5 | L13 | 3 | Hold under "…all built in code". |
| 46 | 1:48.00 | 3M5/3M6 | L13/L14 | 3 | Helios at 46:4: dark drone (machinery) enters; sub quarters. |
| 47 | 1:50.40 | 3M6 | L14 | 4 | Charge: tick accelerando, sub doubling. |
| 48 | 1:52.80 | 3M6 | L14 | 4 | Sled at 48:1; LAUNCH at 48:2+1/8: low boom, ticks rest one beat. |
| 49 | 1:55.20 | 3M6 | L14 | 3 | Recovery: machine bass eighths (low), D minor + E♭ colour. |
| 50 | 1:57.60 | 3M6 | L14 | 3 | Metallic strike in the gap after "mechanical thing". |
| 51 | 2:00.00 | 3M6 | L14 | 4 | Machine opens to full at 51:3+1/16 (2:01.35), right after L14. |
| 52 | 2:02.40 | 3M6/4M1 | L15 | 4→0 | Full to 52:2, then HARD CUT to silence; L15 begins. |
| 53 | 2:04.80 | 4M1 | L15 | 1 | Warm low chord + process pulse at 53:2, as L15's pause begins. |
| 54 | 2:07.20 | 4M1 | L15/L16 | 2 | Claim-bell D (one note) after "…wanted to make". |
| 55 | 2:09.60 | 4M1 | L16 | 2 | Process pulse; warm harmony (B♭, G) under L16. |
| 56 | 2:12.00 | 4M1/4M2 | L16 | 2 | Bass half notes at 56:2; claim-bell D–A after "challenge". |
| 57 | 2:14.40 | 4M2 | L17 | 2 | Steady; iteration pair swaps (every 3 beats) not hit. |
| 58 | 2:16.80 | 4M2 | L17 | 2 | Claim-bell D–A–E after "expected". |
| 59 | 2:19.20 | 4M2 | L17 | 3 | Capture grid; verification-tick mirror 59:3 → 60:3. |
| 60 | 2:21.60 | 4M2 | L17 | 3 | Claim-bell D–A–E after "testing"; strings begin to rise. |
| 61 | 2:24.00 | 4M2/4M3 | L18 | 3 | QA board at 61:2: kick body on 1, sub quarters, strings low. |
| 62 | 2:26.40 | 4M3 | L18 | 3 | Answer 1 after "recaptured": claim-bell D–A–E–F (complete). |
| 63 | 2:28.80 | 4M3 | L18 | 3 | Answer 2 after "reproduced": two machine ticks + soft steel. |
| 64 | 2:31.20 | 4M3 | L18 | 3 | Reverse swell from 64:4+1/6 as "rebuilt" ends. |
| 65 | 2:33.60 | 4M3/5M1 | L19 | 4 | Arrival at 65:4: B♭(add9) + short claim chord + soft boom. |
| 66 | 2:36.00 | 5M1 | L19 | 3 | G sus at 66:3 (c22 cut); soft boom callback at 66:4+1/8. |
| 67 | 2:38.40 | 5M1 | L19/L20 | 3→4 | A sus at 67:2 inside the L19/L20 gap; soft orbit kick cell. |
| 68 | 2:40.80 | 5M1/5M2 | L20 | 4 | Hold A sus under "…I used to imagine making"; pull-back from 68:3. |
| 69 | 2:43.20 | 5M2 | L20 | 4→5 | Resolve to D at 69:2 (third withheld); motif rises. |
| 70 | 2:45.60 | 5M2 | — | 5 | F♯ at 70:1 — the raised third; full bloom. |
| 71 | 2:48.00 | 5M2/5M3 | L21 | 5→2 | Release at the dip 71:2; end card 71:3 without a transient; L21. |
| 72 | 2:50.40 | 5M3 | L21 | 2 | Sustain under L21; no note in its pause; staged releases after 2:51.96. |
| 73 | 2:52.80 | 5M3 | — | 1→0 | One soft claim-bell D at 73:1; ring-out to ≤ −60 dBFS by 2:55.10. |

---

## 8. Automation plan

**Section levels:** set with track `gainDb` automation so that the **ducked** master meets the §11 relationship windows. Use ramps (linear, ≥ 150 ms) between sections, not steps, except at the hard cuts.

**Hard cuts.** At each of the moments below, every track still sounding at the cut (including sample tails and GM releases) gets a linear ramp to −60 dB over the 15 ms ending on the cut. It holds −60 until its next entrance; ramp back in at least 50 ms before that entrance.

| Cut | Ramp | Silence until | Extra rule |
|---|---|---|---|
| 19:2 | 0:43.785 → 0:43.800 | 20:2 (0:46.20) | no `claim-lead` note after 0:43.50 (its 150 ms echo would cross the cut) |
| 52:2 | 2:02.985 → 2:03.000 | 53:2 (2:05.40) | — |
| 11:4 | 0:25.785 → 0:25.800 | 12:1 (0:26.40) | the vacuum |

**Transitions:**

| Element | Placement | Automation |
|---|---|---|
| `riser` | onset 10:1+1/12 (0:21.80), ends 11:4 (0:25.80) | — |
| `reverse` 1 | 7:4+1/6 → 8:4 (0:16.60 → 0:18.60) | −10 dB, ramp to 0 dB over 0:18.24 → 0:18.45 |
| `reverse` 2 | 15:1+1/6 → 16:1 (0:34.00 → 0:36.00) | −10 dB, ramp to 0 dB over 0:35.08 → 0:35.30 |
| `reverse` 3 | 64:4+1/6 → 65:4 (2:33.40 → 2:35.40) | full level |

**Pull-backs:**
- 5:1 (0:09.60): drone and air −6 dB over 0.3 s; percussion absent until 6:3.
- 14:2–15:1: everything except air and the A/E suspension reaches −60 by 14:4 (0:33.00); air and suspension reach −60 at 0:33.58.
- 31:3: `bass-motion` to −60 over 0.3 s; `detail` −3 dB.
- Bars 38–40: `harmony` and `strings` −3 dB.

**Entrances:**
- `harmony` 20:2 from −60 dB over 1.2 s.
- `atmos-air` 20:2, 10–12 dB below its 1:1 level.
- `strings` 34:3, rising to 35:4.
- `atmos-drone` 46:4 over 0.6 s.
- `strings` 53:2 over 0.4 s.
- At 51:3+1/16, `drive` and `detail` +6 dB over 0.15 s.

**Duck compensation:**

| Where | Change |
|---|---|
| Counterstrike | `impacts` +2 dB 0:36.00–0:37.20 |
| Volley | accent notes in 0:40.80–0:41.04 +3 dB (`alarm`, `detail`, `drive`) |
| Beam | the 18:4+1/16 steel +4 dB |
| "Enormous" bloom | `strings` +4 dB ramp 1:04.44 → 1:04.80, back by 1:05.40 |

**Ending:**
- 71:2 (2:48.60): `drive`, `sub`, `impacts`, `claim-lead`, `bass-motion` release to −60 over 0.6 s.
- 71:3: re-voice the sustained D(add9) with no transient.
- `harmony` and `strings` release across 73:1–73:3.
- `atmos-air` fades 2:53.40 → 2:54.60.
- **Every dry signal at −60 dB by 2:54.60.**
- Reverb residue on `strings` / `claim-bell` must be ≤ −60 dBFS RMS in 2:55.10–2:55.20. Use a shorter `strings` decay if needed.

---

## 9. VO ducking

Parameters: §2. The duck is a master-only safety net worth 6 dB. The other half of the separation is arrangement (§3, §4 rule 2, §8 section levels).

Expected residual reduction (model): ≈2.2 dB at 16:1, ≈4.3 dB at 18:1, ≈5.6 dB at 18:4+1/16, ≈4 dB at 28:1, ≈4.1 dB at 69:2, ≈0.6 dB at 70:1 and at 65:4. The typical swell in sub-second pauses is ≈2.9 dB (max ≈4.0).

Measure the real behaviour: render a second time with `amountDb` 0 (or sum the stems and apply master gain + highpass), then compare it with the ducked master at those points. If the swell in any narrated pause audibly pumps a sustained bed, raise `releaseMs` in 100 ms steps up to 1200 and re-check the compensation points. Do not raise `amountDb` above 8.

VO line intervals (sample-exact):

| Line | Interval | Frames | Text |
|---|---|---|---|
| L01 | 0:03.90–0:07.13 | 234–427 | Getting there first feels like it should count for something. |
| L02 | 0:13.70–0:14.65 | 822–878 | It doesn't. |
| L03 | 0:15.35–0:18.35 | 921–1100 | So you decide how far you're willing to go. |
| L04 | 0:33.70–0:35.12 | 2022–2107 | Then it's their turn. |
| L05 | 0:38.60–0:42.71 | 2316–2562 | And while you're busy with each other, someone else shows up. |
| L06 | 0:44.10–0:53.17 | 2646–3190 | I've wanted to make something like this since I was a kid playing StarCraft, reading Dune, and searching the library for anything I could find about space. |
| L07 | 0:53.77–1:04.47 | 3226–3868 | Shoot the Moon became my version of all of that: territory, machines, escalation, and a Moon that actually feels enormous. |
| L08 | 1:05.39–1:12.99 | 3923–4379 | And none of this is a cutscene. It's the game running live in a browser, built for a phone as much as a desktop. |
| L09 | 1:13.79–1:18.49 | 4427–4709 | Every site exists at a real latitude and longitude on a lunar sphere. |
| L10 | 1:19.49–1:25.58 | 4769–5134 | One of the key moments that changed the project was realizing how good the frontier models had become at math. |
| L11 | 1:26.08–1:39.91 | 5164–5994 | We used that to work out flight paths around the Moon, validate a hundred-and-thirty-two-degree route at two thousand and forty-eight points, and design camera moves I probably would have never even tried. |
| L12 | 1:40.93–1:43.79 | 6055–6227 | Then I started pushing the visual side harder. |
| L13 | 1:44.29–1:48.21 | 6257–6492 | The monuments, machines, and animations are all built in code. |
| L14 | 1:49.11–2:01.33 | 6546–7279 | The mass driver is still one of my favorites. It started as an idea in my head and gradually became this huge mechanical thing that actually feels like it belongs on the Moon. |
| L15 | 2:03.30–2:08.07 | 7398–7684 | I didn't ask a model to invent this. I already knew the game I wanted to make. |
| L16 | 2:08.99–2:13.82 | 7739–8029 | Claude and Codex became collaborators I could direct, test, and challenge. |
| L17 | 2:14.72–2:23.87 | 8083–8632 | My background in QA helped more than I expected. I treated every feature like something that had to survive testing, not just look right once. |
| L18 | 2:24.77–2:33.39 | 8686–9203 | Bad captures got recaptured. Bugs got reproduced. Ideas got rejected and rebuilt. |
| L19 | 2:35.60–2:38.93 | 9336–9535 | What I'm proudest of isn't that models wrote code. |
| L20 | 2:39.53–2:43.66 | 9571–9819 | It's that this feels like the kind of game I used to imagine making. |
| L21 | 2:49.50–2:51.96 | 10170–10317 | And now everyone can play it. |

---

## 10. Effects summary

- **Static filters** as in §3: they form the voice corridor.
- **Compressor** on `bass-motion` (even low end under VO, 2–4 dB gain reduction on the loudest notes) and on `drive` (groove accents ≥ 3 dB under the 12:1 peak).
- **Saturation** on `drive` only (grit and small-speaker translation).
- **Reverb** on `claim-bell` and `strings` only.
- **Delay** on `claim-lead` (portfolio 150 ms) and `claim-bell` (300 ms).
- No master dynamics. No reverb or delay on any track that sounds into 0:43.80, 2:03.00 or 2:55.20.

---

## 11. Acceptance criteria

Measure the master with `daemonv12_analyze`. Measure windows with FFmpeg: trim both the master and the VO key to the window, then compare `ebur128` integrated loudness.

**A. Timeline:**
- master and all 15 stems exactly **7,726,320 frames**, 44.1 kHz, 16-bit, stereo;
- project 100 BPM, 4/4, 73 bars; `render.duration` 175.2 s, `render.tail` `none`.

**B. Levels (ducked master):**
- integrated −33 to −28 LUFS (target ≈ −31);
- loudness range ≥ 10 LU;
- true peak ≤ −6.0 dBTP; sample peak ≤ −6.0 dBFS;
- **zero clipped samples** in the master and every stem.

**C. Silence:**

| Window | Limit |
|---|---|
| 0:25.80–0:26.40 | ≤ −80 dBFS RMS; digital silence from 0:25.90 |
| 0:43.80–0:46.15 and 2:03.00–2:05.35 (the bar after each hard cut) | ≤ −60 dBFS RMS |
| 2:54.60–2:55.20 | ≤ −50 dBFS RMS |
| 2:55.10–2:55.20 | ≤ −60 dBFS RMS |

**D. Hierarchy:**
- the master's highest true peak lies in 0:26.40–0:27.40;
- the 0:36.00–0:37.00 peak is 1.5–4 dB lower;
- no other 1 s window comes within 1 dB of the First Strike peak.

**E. Unnarrated windows (integrated):**

| Window | Target |
|---|---|
| First Strike, 0:26.40–0:28.80 | −22 to −20 LUFS |
| Counterstrike, 0:36.00–0:38.40 | 1–3 dB below the First Strike window |
| Bloom, 2:45.60–2:48.60 | −25 to −21 LUFS, and louder than every narrated window below |

**F. Narrated windows** (score master vs VO key, same interval, integrated):

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

Also: within L21's last word (2:51.55–2:51.92) the music is at least 6 dB under the VO.

**G. Content:** check the resolved note list against the line table.
- no F♯ before 70:1;
- `riser` once; `cinematic-impact` only at 12:1 and 16:1;
- `rival` only in 4:1–19:2; `alarm` only in 15:1–19:2;
- no snare, metallic-strike, alarm, rival or claim onset inside a VO word (pause placements in §6 only);
- no `drive`, `sub`, `impacts`, `alarm`, `rival` or `bass-motion` onset after 71:2;
- no onset at or after 73:1 except the final `claim-bell` D at 73:1.

**H. Ducking provenance:**
- the manifest names `assets/voiceover/stm-vo-key-44k16.wav` with the SHA-256 you recorded;
- activity is 95–120 s of frames;
- maximum reduction is 6 dB.

**I.** Validate with `daemonv12_project_validate` before every render; zero diagnostics.

---

## 12. Expected deliverables

1. The DaemonV12 project file (in the DaemonV12 workspace), validated.
2. Ducked master WAV (7,726,320 frames) and MP3; 15 stems (WAV); analysis JSON; render manifest / provenance.
3. The unducked comparison render (`amountDb` 0), clearly named as a reference.
4. The VO key file and its provenance (source SHA-256, command, key SHA-256, frame count).
5. A review MP4 for the author: the picture-lock video stream copied, with the locked VO and the ducked score (resampled to 48 kHz) summed at unity, e.g. FFmpeg `amix=inputs=2:normalize=0`, as AAC 48 kHz. If the sum clips, lower both by the same amount. Put it under `capture-final/youtube/review/`, label it **unmastered review**, and do not overwrite any locked file.
6. A short report: settings; every acceptance measurement (A–I) with pass/fail; deviations from this handoff with reasons; the weakest moments to audition first. Do not commit or push unless the author asks.
