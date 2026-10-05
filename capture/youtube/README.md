# YouTube launch film (first cut)

A reproducible derivative of the clean reel. It is a 2:31.20 film (9,072 frames, 1920×1080, 60 fps) with the ORBITAL RECORD graphics re-rendered at film frames.

The creative plan, the full timeline, the voiceover and the music brief are in [docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md](../../docs/youtube-launch/YOUTUBE_FILM_TREATMENT.md).

**Status:** first cut for review. Not approved.

```
capture/youtube/
  media-sources.json        which files are footage (clean) and which are reference (titled), by sha256
  mediaPriority.ts          clean-source resolution and the timeline source gate (checkTimelineSources)
  youtube-film.json         THE EDIT DECISION: timeline, assets, picture boards, voiceover, music markers, claims, thumbnails
  youtubeFilm.ts            types + validateFilm(): clean sources only, no retiming, baked transitions only with their
                            reel neighbours, VO pace/placement, graphics off protected frames, at most 3 new captures
  youtubeTitles.cues.json   the film's graphics: a reel-titles/1 cue sheet (resolved by capture/titles/titles.ts sceneAt)
                            plus boards[] (phone outline, route diagram, workflow connectors, capture ticks)
  filmScene.ts              film frame -> draw ops: route tokens/anchors from the game code, boards, then sceneAt()
  routeDiagram.ts           the First Strike route board computed from src/ (fixture site, deriveRivalSite, createStrikeRoute)
  renderYoutubeTitles.mjs   Chromium -> transparent titles-track.mov (qtrle argb, 9,072 frames) + manifest;
                            --determinism, --preview, --thumbnails
  assembleYoutubeFilm.mjs   picture segments (lossless) -> clean picture lock + first cut + VO script + music cue sheet
  validateYoutubeFilm.mjs   QA over the delivered files (format, fidelity, cuts, alpha, safe frame, range, provenance)
  captures/                 the three new captures (existing manifest shots, run unmodified) + captures.json
  *.test.ts                 node --test suites (pure; no ffmpeg or browser)
```

## Rules it enforces

- **Clean sources only.** Every reel frame the picture reads is checked by `mediaPriority.ts checkTimelineSources`. Titled media are rejected, so new graphics can never sit on baked ORBITAL RECORD graphics.
- **The clean loop is never cut.** Every loop shot is taken from the clean reel at full rate.
- **No retiming.** A reel segment plays exactly its source frames. Holds repeat one clean frame and may take a new perspective push, never `zoompan`. Every pushed picture is clamped to BT.709 legal range afterwards, because resampling rings on thin UI text.
- **Baked transitions.** A reel flash, dip or fade survives only where the film keeps the same two shots adjacent.
- **Protected frames carry zero graphics.** These are impacts, flashes, dips, the hero flight and native game UI. The validator checks the cue sheet, and QA checks the decoded alpha.
- **Graphics reuse the approved system.** They are the reel's own `overlay.html`, `titles.ts` and fonts, unmodified. The release pin (`titlesRelease.json`) is untouched, so the reel and loop pipelines are unaffected.
- **Every on-screen number comes from code or a capture.** The route board's coordinates, 132°, 760 km, 24 km and 2,048 are computed at render time from `src/`. The code excerpt is checked against the source file.

## Running it

Two inputs are not in the repository:

- the clean reel: `reel-57s-1080-clean.mp4`, sha256 `f1150945…80d0`
- the titled reel, which only QA reads, to prove the film contains none of it: `reel-57s-1080.mp4`, sha256 `a523e35c…b188`

```sh
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium   # only where the pinned Playwright browser is absent

# 1. Pure checks (no ffmpeg/browser)
node --experimental-strip-types --experimental-transform-types --test \
  capture/youtube/youtubeFilm.test.ts capture/youtube/mediaPriority.test.ts

# 2. Graphics: the title track, plus a determinism proof
node --experimental-strip-types --experimental-transform-types capture/youtube/renderYoutubeTitles.mjs \
  --out=capture-final/youtube/titles --jobs=4
node --experimental-strip-types --experimental-transform-types capture/youtube/renderYoutubeTitles.mjs \
  --determinism=60,540,1500,2384,3072,3872,4632,4830,6044,6284,7298,7780,8300,9071 --out=capture-final/youtube/qa/determinism

# 3. Picture lock, first cut, VO script, music cue sheet, temporary VO reference
node --experimental-strip-types --experimental-transform-types capture/youtube/assembleYoutubeFilm.mjs \
  --clean=<reel-57s-1080-clean.mp4> --titles=capture-final/youtube/titles/titles-track.mov --out=capture-final/youtube

# 4. Thumbnails (1280x720)
node --experimental-strip-types --experimental-transform-types capture/youtube/renderYoutubeTitles.mjs \
  --thumbnails --clean=<reel-57s-1080-clean.mp4> --out=capture-final/youtube

# 5. QA over the delivered files
node --experimental-strip-types --experimental-transform-types capture/youtube/validateYoutubeFilm.mjs \
  --clean=<reel-57s-1080-clean.mp4> --titled=<reel-57s-1080.mp4> --out=capture-final/youtube
```

`--preview=f1,f2,...` renders graphics over an approximate plate for layout checks. Picture boards are not composed in the preview.

The three captures were made with:

```sh
npx playwright test --config=capture/playwright.capture.config.ts capture/capture.spec.ts \
  -g "title-screen|landing-site-panel|mining-laser-closeup"
```

The PNGs are pinned in the repository (`captures/captures.json`), so a rebuild does not depend on recapturing.

## Outputs (`capture-final/youtube/`, gitignored)

| File | What |
|---|---|
| `shoot-the-moon-youtube-first-cut.mp4` | Picture plus graphics. H.264 High 4.2, CRF 16, yuv420p, BT.709 limited range, closed 1 s GOP, faststart, **silent** (no verified audio exists). |
| `clean-picture-lock.mp4` | The same picture with no graphics, for recording narration and for review. |
| `voiceover-script.txt` | The narration with its timed windows. |
| `music-cue-sheet.json` | 100 BPM markers, hard sync points and the narration windows. |
| `thumbnail-01..03.jpg` | 1280×720 candidates. |
| `assembly-manifest.json` | Every source and output hash, tools and segment plan. |
| `titles/` | The title track and its manifest (inputs, browser, per-frame hashes). |
| `qa/` | `qa-report.json`, `contact-sheet.jpg`, `readability-480.jpg`, `readability-1080/`, `timeline.md`, `determinism/`, and `vo-reference-960.mp4`. That last file has **temporary** burned-in narration captions and is never a master. |
