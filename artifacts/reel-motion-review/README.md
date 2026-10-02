# Reel motion review — ORBITAL RECORD titled reel

Review copy of the titled reel built by `capture/titles/` (see `capture/README.md`,
Phase 7). Not a release deliverable: the release path is
`capture/ci/assembleFinalReel.mjs --titles=… --titles-cues=…` on the verified render
intermediates.

| file | what |
|---|---|
| `reel-57s-1080-titled.mp4` | titled reel: 1920x1080, 60 fps, 3,456 frames, 57.600 s, H.264 High yuv420p BT.709, silent. sha256 `7be8b4f8e896a0c639b3aad3be3a71e6c0be2a6fd09b6c9e9a0e408f9083c5fb` |
| `contact-sheet.jpg` | 33 cue frames (entrances, swaps, exits, countdown, E9, end-card build, f3455) |
| `readability-480x270.png` | nine title frames at 480x270 |
| `c12-before-after.jpg` | FIRST STRIKE COMPLETE: released still (LaunchGate ghosting) vs the re-capture used here |
| `qa-report.json` | protected-interval, title-safe, push-transform and push-smoothness measurements |
| `push-smoothness-lossless.txt` | consecutive-frame motion of each plate push before encoding |
| `titled-manifest.json` | finishing-pass record: inputs, sha256s, changed-frame classes, undeclared-frame fidelity |

How it was made: the run #6 intermediates were not reachable from the build
environment, so the titled reel was finished over the released clean reel
(`reel-57s-1080.mp4`, sha256 `34c2e6ade470d025cb4dd8ca39f49b1ce4c3c245b8ff6d1c986eded098525e2f`)
with `capture/titles/finishTitledReel.mjs`, the titles track from
`capture/titles/renderTitles.mjs` (sha256 `6c49ee0bc02278c925a3f5fe448b1b2b6cbe23e977e74c53b0258881b0f95d81`),
and `--replace=c12:` the re-captured FIRST STRIKE COMPLETE still. Every frame outside
the declared titles / plate-push / end-card / c12 frames matches the clean reel
within 0.21 levels (64x36 luma; tolerance 3). No title alpha on any of the 150
protected flash, dip and fade frames.
