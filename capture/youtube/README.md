# YouTube launch film: approved VO / picture lock

The active edit is **Option A**, 2:55.20: **10,512 frames at 1920×1080, 60 fps**, or 73 bars at 100 BPM. It contains the author's selected recording and the existing ORBITAL RECORD graphics. There is no music, game audio, synthetic narration, or burned-in caption track. The author approved this VO / picture lock on 2026-10-06.

The original [treatment](../../docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md) retains the first-cut picture tables for comparison. [VO_SELECTS.md](../../docs/youtube-launch/VO_SELECTS.md) and `vo-selects.json` remain unchanged; their Option A selections and start times are authoritative. The implementation report is [VO_PICTURE_LOCK.md](../../docs/youtube-launch/VO_PICTURE_LOCK.md).

```text
capture/youtube/
  media-sources.json          hash-pinned clean footage and reference-only titled releases
  mediaPriority.ts            unchanged clean-source resolution and timeline source gate
  youtube-film.json           active timeline, assets, picture boards, recorded VO and future music markers
  youtubeFilm.ts              validates clean sources, natural playback, protected frames, exact VO placement,
                              code-grounded claims, original three captures plus the authorized Helios capture
  vo-selects.json             authoritative selected takes and half-open 44.1kHz source-sample ranges
  narration.ts                sample plan, selected-pause crossfades and recorded-delivery validation
  assembleNarration.mjs       original WAV -> selected intermediate + conservative 48kHz narration mix
  validateNarration.mjs       source/range hashes, overlap, PCM edges, clipping, tone and delivered AAC fidelity
  youtubeTitles.cues.json     existing film graphics, retimed to Option A
  filmScene.ts / routeDiagram.ts
                              existing graphics and route geometry computed from game code
  renderYoutubeTitles.mjs     existing Chromium renderer; identical static draw states are cached
  assembleYoutubeFilm.mjs     existing lossless-segment renderer -> silent picture + narrated review master
  validateYoutubeFilm.mjs     delivered-file frame fidelity, cuts, alpha, range, format, timing and provenance
  captureMassDriver.spec.ts   one continuous, exact-clock capture through the existing final-render engine
  playwright.youtube.config.ts
                              capture-only adapter; approved reel edit and gameplay stay untouched
  validateMassDriver.mjs      all source frames, exact clock, input hashes and clean-source validation
  rebuildCleanSource.mjs      optional local recovery through the approved reel assembler, bounded decoders
  createReviewEncode.mjs      separate two-pass review MP4 below 30 MiB, preserving master and AAC
  captures/captures.json      original three pinned captures plus provenance for the fourth
  *.test.ts                  pure film, narration and media-priority regression suites
```

## Constraints

- **Clean sources only.** Titled releases remain reference-only and are rejected as timeline sources. QA reads a pinned titled reference to prove its absence from the picture. The repository's verified titled finish is a separately registered reference when the originally supplied titled file is unavailable; the original release pins remain intact.
- **Natural rate.** Reel and Helios video segments retain every source frame at 60 fps. Existing phone recordings retain their own cadence, duplicated to 60 fps inside the existing phone board. No narration is stretched.
- **Protected graphics.** Impacts, flashes, dips, the hero flight and native game UI keep their protected intervals. QA decodes the complete title alpha track and checks the 40 px safe frame.
- **Approved reel and loop remain unchanged.** `finalEdit.json`, shot manifest, game code, reel/loop cue sheets, fonts, core title renderer and release pins are not edited. Any source reconstruction runs the existing reel assembler into a separate ignored directory.
- **No new graphic events.** Existing graphics are retimed. Personal history is carried by the recording and Shoot the Moon imagery. The existing route diagram reads verified geometry and sample count from game code.
- **Exact recording provenance.** Every keep range has an original PCM hash and source-to-film sample mapping. The earlier FLAC container hash stays in the unchanged selects; this pass separately pins the user-specified original WAV.
- **Recorded pace.** The 2.9 words/s estimate remains for unrecorded scripts. Recorded lines require the exact chosen sample duration, wording and take, no overlap or padded window, and the selects' measured maximum of 5.6 syllables/s. Seven approved natural reads exceed the old word estimate; adding empty time would conceal that fact.

## Reproduce

Requires repository dependencies, pinned Playwright Chromium, and FFmpeg with libsoxr/libx264. Set `PLAYWRIGHT_CHROMIUM_PATH` only when the pinned browser is absent. All generated media goes under gitignored `capture-final/youtube/`.

The read-only WAV must already exist at `capture-final/youtube/audio/source/shoot-the-moon-vo-session-01.wav`. SHA-256: `b1f9519450c98ab8792f63e355028476b21e16c065e278cb3aa8ad64209b96d8`.

```sh
# 1. Pure checks and exact narration assembly.
node --experimental-strip-types --experimental-transform-types --test capture/youtube/narration.test.ts capture/youtube/youtubeFilm.test.ts capture/youtube/mediaPriority.test.ts
node --experimental-strip-types --experimental-transform-types capture/youtube/assembleNarration.mjs
node --experimental-strip-types --experimental-transform-types capture/youtube/validateNarration.mjs

# 2. Only if the pinned fourth source is unavailable: capture the existing Helios shot.
npx playwright test --config=capture/youtube/playwright.youtube.config.ts
# Register successful source/capture.json hashes in the film and capture index.
# Never use partial footage or splice elapsed-clock frames across page sessions.
node --experimental-strip-types --experimental-transform-types capture/youtube/validateMassDriver.mjs

# 3. Retimed graphics and fresh-page determinism.
node --experimental-strip-types --experimental-transform-types capture/youtube/renderYoutubeTitles.mjs --out=capture-final/youtube/titles --jobs=2
node --experimental-strip-types --experimental-transform-types capture/youtube/renderYoutubeTitles.mjs --determinism=60,540,1500,2384,2856,3059,4500,4800,5268,5483,5772,7470,7836,8052,8268,8520,9000,9810,10272,10511 --out=capture-final/youtube/qa/determinism

# 4. Assemble using the hash-pinned clean reel; all input hashes are checked.
# If the supplied clean reel is absent and verified run-6 artifacts are local:
# node capture/youtube/rebuildCleanSource.mjs
node --experimental-strip-types --experimental-transform-types capture/youtube/assembleYoutubeFilm.mjs --clean=<verified-clean-reel.mp4> --titles=capture-final/youtube/titles/titles-track.mov --out=capture-final/youtube

# 5. Delivered-picture and delivered-audio QA. Keep work/picture.mkv.
node --experimental-strip-types --experimental-transform-types capture/youtube/validateYoutubeFilm.mjs --clean=<verified-clean-reel.mp4> --titled=artifacts/reel-motion-review/reel-57s-1080-titled.mp4 --out=capture-final/youtube
node --experimental-strip-types --experimental-transform-types capture/youtube/validateNarration.mjs

# 6. Separate review encode, only when master exceeds 30 MiB.
node --experimental-strip-types --experimental-transform-types capture/youtube/createReviewEncode.mjs

# 7. Repository and approved reel/loop checks.
npm test -- --maxWorkers=1
npm run typecheck
npx tsc -p capture/tsconfig.json --noEmit
npm run lint
node --experimental-strip-types --experimental-transform-types --test capture/titles/titles.test.ts capture/titles/loopTitles.test.ts capture/titles/titlesFfmpeg.test.ts capture/ci/assembly.test.ts capture/ci/assemblySynthetic.test.ts
```

The first three captures are pinned repository PNGs. The fourth is an ignored lossless video with a tracked provenance index; keep it with the review media. A recapture must be rehashed and revalidated before use. The clean reel input must match its registered hash; rebuilding it from verified run-6 artifacts uses `capture/ci/assembleFinalReel.mjs` in a separate directory and retains the original release plan and its full QA.

## Outputs (`capture-final/youtube/`, gitignored)

| File | Purpose |
|---|---|
| `shoot-the-moon-vo-picture-lock.mp4` | High-quality picture plus ORBITAL RECORD graphics and one AAC-LC 48kHz mono narration stream. H.264 High 4.2, CRF 16, yuv420p, BT.709 limited range, faststart. |
| `shoot-the-moon-vo-picture-lock-review.mp4` | Separate 1080p60 two-pass H.264 review below 30 MiB when needed. Exact master runtime/frame count; same AAC narration packets. |
| `audio/narration-selected.wav` | Unprocessed keep ranges conformed to the 175.2 s film timeline; 48kHz mono 24-bit PCM. |
| `audio/narration-mix.wav` | Conservative gains, fades, three selected-pause joins, original room tone and one 80Hz high-pass; same format/timeline. |
| `audio/narration-manifest.json` | Original WAV/PCM hashes, every selected range and mapping, processing and output hashes. |
| `captures/helios-mass-driver/` | Continuous clean 13.2 s capture, 792 source PNGs, exact clock evidence, hashes and `capture.json`. |
| `clean-picture-lock.mp4` | Silent picture without graphics, retained for source-fidelity QA. |
| `assembly-manifest.json` | Source/output hashes, tools, segment plan and narration provenance. |
| `titles/` | Transparent graphics track and input/per-frame hash manifest. |
| `qa/` | Film/VO/capture/review QA, full contact sheet, phone-size proofs, first-cut timing comparison and test logs. |
| `voiceover-script.txt`, `music-cue-sheet.json` | Recorded wording and retimed handoff markers. No music is generated or mixed. |

Closing: **“And now everyone can play it.”** The Moon pull-back retains about 5.54 s without narration, followed by an end card with 3.24 s after the last line. Music and final loudness decisions are the next pass. The author authorized committing and pushing this approved implementation on `youtube-launch-vo-lock`; no PR or merge is authorized.
