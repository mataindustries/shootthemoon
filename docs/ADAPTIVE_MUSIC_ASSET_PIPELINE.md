# SHOOT THE MOON — ADAPTIVE MUSIC ASSET PIPELINE

**What it is:** the Shoot the Moon side of handoff section 9 ([ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md](ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md)). It takes Astra's canonical DaemonV12 V0.5 renders and turns them into the browser package: five guarded loops, seven guarded stingers and a manifest. Before it writes a single shipped byte, it proves every hard asset requirement.

**What it is not:**
- It does not compose, normalize, fade, crossfade, pad, truncate or resample anything to make a check pass. Every failure goes back to the composer.
- It is not the Web Audio runtime (section 10 of the handoff).

**Code:** `scripts/music/`.
- `build-web-music.mjs` is the CLI.
- The decision logic lives in typed, unit-tested modules beside it.

**Requirements:**
- Node with `--experimental-strip-types` (22.6+; the repo uses 24).
- FFmpeg with `libmp3lame` and `ebur128`.

The pipeline runs on the asset builder's machine, not in CI.

---

## 1. Commands

```sh
# 1. Validate the canonical package. Writes nothing except the optional report.
npm run music:validate -- --input capture-final/game-audio/canonical \
  --report capture-final/game-audio/reports/validate.json --require-provenance

# 2. Build the shipped package. public/music changes only if every check passes.
npm run music:build -- --input capture-final/game-audio/canonical --output public/music \
  --archive capture-final/game-audio/loops \
  --report capture-final/game-audio/reports/build.json --require-provenance

# 3. Local A–E review mixes (never shipped)
npm run music:auditions -- --input capture-final/game-audio/canonical \
  --output capture-final/game-audio/auditions

# Synthetic stand-in package with the exact contract lengths, for dry runs
npm run music:fixtures -- --output capture-final/game-audio/synthetic/canonical
npm run music:build -- --input capture-final/game-audio/synthetic/canonical \
  --output capture-final/game-audio/synthetic/package --allow-synthetic

# Pipeline test suite: typecheck and node:test, about 3 minutes on 2 cores
npm run music:test
```

Exit codes:
- `0` pass;
- `1` an asset check failed (every problem is listed, then `FAIL:` lines);
- `2` a usage or path error.

Options:

| Option | Commands | Meaning |
|---|---|---|
| `--input <dir>` | validate, build, auditions | canonical package (required; no default path) |
| `--output <dir>` | build, auditions, fixtures | output directory (required) |
| `--manifest <file.json>` | build | manifest location (default `<output>/manifest.json`) |
| `--archive <dir>` | build | also write the cropped canonical loops `<id>.loop.wav` (PCM16 stereo, 1,693,440 frames) |
| `--report <file.json>` | validate, build | full metrics report |
| `--url-base /music/` | build | root-relative URL prefix written into the manifest |
| `--require-provenance` | validate, build | a missing `<name>.render.json` fails instead of warning. Use it for the real package. |
| `--allow-synthetic` | validate, build, auditions | accept a `fixtures` package (refused without it) |
| `--concurrency <n>` | validate, build, auditions | parallel FFmpeg measurements |

## 2. Canonical input layout

For each asset, the pipeline looks for exactly one of these:
- `<input>/<name>.wav`
- `<input>/<id>/<name>.wav`

`<name>` is the DaemonV12 project name from handoff 8.1/8.2:
- loops: `stm-loop-bed`, `stm-loop-engine`, `stm-loop-pressure`, `stm-loop-assault`, `stm-loop-claim`;
- stingers: `stm-sting-vesper-arrival`, `stm-sting-first-strike`, `stm-sting-vesper-retaliation`, `stm-sting-divider-contact`, `stm-sting-outcome-hold`, `stm-sting-outcome-breach`, `stm-sting-territory-claimed`.

These `daemonv12_render` companions are optional and used when present beside the WAV:
- `<name>.render.json` for provenance and hash verification;
- `<name>.stems/*.wav` for per-track periodicity diagnostics.

Other files are ignored. Two candidates for one asset is an error.

## 3. Loops

Every canonical loop WAV must be RIFF PCM16, 44,100 Hz, 2 channels and **exactly 5,080,320 frames**, which is 48 bars or 115.2 s at 100 BPM. Anything else is rejected and never padded or truncated. Float, 24-bit, RF64 and truncated files are rejected by the parser.

Frame ranges are pure integer frame addressing and use no timestamps:

| Region | Frames |
|---|---|
| cycle 2: the production loop | [1,693,440, 3,386,880), 1,693,440 frames = 38.4 s |
| cycle 3: the proof cycle | [3,386,880, 5,080,320) |
| pre-guard: the last 0.2 s of cycle 1 | [1,684,620, 1,693,440) |
| its proof: the last 0.2 s of cycle 2 | [3,378,060, 3,386,880) |
| post-guard: the first 0.2 s of cycle 3 | [3,386,880, 3,395,700) |
| guarded web master | [1,684,620, 3,395,700), **1,711,080 frames = 38.8 s** |

The guards are **real neighboring-cycle audio**, not silence. Decoder priming and resampling edges therefore land outside the runtime loop region [0.2 s, 38.6 s), which is frames [8,820, 1,702,260). After building each master, the pipeline re-verifies it:
- the inner 1,693,440 frames are cycle 2 bit for bit;
- each guard matches the crop's own tail or head within the periodicity tolerance.

### 3.1 Periodicity proof

Cycle 2 is compared with cycle 3, and the pre-guard with its proof, on every sample of both channels.

- **Pass:** max |Δ| ≤ **1 LSB** (PCM16) in both comparisons, per handoff 9.1 step 2. Bit-identical PCM is reported as `identical: true`.
- **The tolerance is deterministic.** DaemonV12 renders are byte-reproducible (FluidSynth with reverb and chorus off, one core, block-periodic length). The single LSB only absorbs a rounding tie.
- **Metrics in the report:**
  - max |Δ| and the frame where it occurs, as a cycle-relative `bar:beat +frames`, an absolute source frame and a channel;
  - RMS Δ (LSB and dBFS);
  - the count of differing samples;
  - the first and last differing frames;
  - max |Δ| per bar (16 values).
- **Seam metrics around the cycle 2 → cycle 3 boundary:**
  - the render's own step there;
  - the step the runtime loop produces when it wraps;
  - the difference between those two (0 means the wrap is indistinguishable from the continuous render);
  - the largest step within ±0.2 s, for scale.
- **On failure** the message names:
  - the bar, beat and frame of the largest Δ;
  - every bar over tolerance;
  - when `.stems/` exist, each stem's own cycle Δ, so Astra can see which track's tail or effect state outlasts a cycle.

Nothing is crossfaded to hide non-periodicity.

### 3.2 Levels (locked targets, handoff 2.1)

Levels are measured on the canonical stereo crop with FFmpeg `ebur128=peak=true` (BS.1770 integrated loudness, 4× oversampled true peak). Mono layers are measured on their dual-mono stereo crop, which is how they are heard.

| Layer | Integrated | True peak | Ships |
|---|---|---|---|
| bed | −26 ± 1 LUFS | ≤ −14 dBTP | stereo 160 kbps |
| engine | −27 ± 1 | ≤ −12 | mono 96 kbps |
| pressure | −25 ± 1 | ≤ −12 | mono 96 kbps |
| assault | −20 ± 1 | ≤ −7 | mono 96 kbps |
| claim | −23 ± 1 | ≤ −10 | stereo 160 kbps |

Tolerances are inclusive at FFmpeg's printed precision (0.1). Nothing is normalized.

### 3.3 Mono fold-down (engine, pressure, assault)

- **Gate:** L/R Pearson correlation ≥ 0.90, and the loudness change of the fold (measured as heard, [M, M]) within ±1 LU. Otherwise the build fails. The composer centers the patch, or the layer ships stereo after a memory re-check.
- **Rule:** `M = (L + R) / 2`, rounded half to even to PCM16, with no dither. It is exact for dual-mono content and can never leave the int16 range. No channel is ever dropped.

## 4. Stingers

| Stinger | Frames | Ch | Sync | TP ceiling |
|---|---:|---|---|---:|
| vesper-arrival | 211,680 | 1 | `1:1` (0 s) | −9 |
| first-strike | 529,200 | 2 | `2:4+1/6` (4.6 s = 202,860 frames) | −2 |
| vesper-retaliation | 105,840 | 1 | `1:1` | −9 |
| divider-contact | 105,840 | 1 | `1:1` | −11 |
| outcome-hold | 105,840 | 1 | `1:1` | −9 |
| outcome-breach | 211,680 | 1 | `1:1` | −6 |
| territory-claimed | 423,360 | 2 | `1:1` | −5 |

Checks:
- canonical stereo PCM16 at 44.1 kHz, with **exactly** `bars × 105,840` frames;
- final 100 ms (4,410 frames) RMS ≤ **−60 dBFS**, where RMS runs over all samples relative to 32,768 (a full-scale sine reads −3.01). This is compared unrounded, so −59.996 fails, and digital silence passes;
- true peak at or under the ceiling;
- the same mono fold gate as loops.

A ringing tail is reported, not faded.

Web derivative: **8,820 zero frames + canonical content + 8,820 zero frames**. Stinger guards are intentionally silence, unlike loop guards. The manifest keeps the exact sync metadata:
- `syncPosition`, `syncSeconds` and `syncFrames`, relative to the content;
- `contentStartSeconds` = 0.2;
- `timing`, `priority`, `duck` and, for divider-contact, `waveGainDb`.

## 5. MP3 delivery

One encoder for every file, using handoff 9.1 step 7 verbatim (plus non-interactive flags):

```sh
ffmpeg -hide_banner -nostdin -loglevel error -y -i in.wav -map_metadata -1 -c:a libmp3lame -ar 44100 -ac 2 -b:a 160k out.mp3
# mono: -ac 1 -b:a 96k
```

Checks on every encoded file:
- **CBR:** every MPEG frame header is walked, and every frame must be MPEG-1 Layer III at the one expected bitrate, 44.1 kHz, with the expected channel mode;
- **ffprobe** must agree;
- **decode:** FFmpeg-decoded frames must fall in [guarded, guarded + 3,000]. LAME's gapless header makes FFmpeg 6.1 decode exactly 1,711,080.

The file is named `<id>.<first 10 hex of sha256>.mp3`. MP3s are delivery artifacts only. Canonical provenance stays tied to the WAVs through `renderWavSha256` and `loopWavSha256`.

## 6. Analysis captured

For every canonical asset, crop and shipped file, the report and manifest record:
- channels, sample rate and exact frames;
- duration;
- integrated LUFS;
- true peak;
- sample peak;
- full-scale (clipped) sample count;
- SHA-256.

For loops they also record periodicity metrics. For stingers they record tail RMS. Mono assets get correlation and fold delta.

Shipped mono MP3s are measured up-mixed to [M, M] (`pan=stereo|c0=c0|c1=c0`), so their loudness compares directly with the canonical figure.

## 7. Headroom: measured combination audit vs. arithmetic bound

This step is part of `validate` and `build`. A failure stops the build (handoff 9.3, acceptance C).

- **Measured sums.**
  - **Layer mixes:** the canonical crops are summed sample by sample in float, without clamping, at the handoff 3.4 gains. The 3.5 modifiers that can *raise* a layer are applied at their maxima:
    - ENGINE +2 dB in the tier cues;
    - `ASCENDANT` with the wound (ENGINE −5, PRESSURE −14);
    - `CLAIMED` with the Helios flavor (ENGINE −4).

    Each siege cue is measured with its arc cells absent, with CONTESTED (PRESSURE −12) and with CLAIMED (CLAIM −10). That gives 48 layer mixes.
  - **Stinger pairs:** each stinger is summed at **16 evenly spaced loop offsets** (every bar line) over every mix it can sound in. Those mixes are read from the edge table (4.1), taking both sides of each edge, which gives 95 pairs in total. Each stinger's duck is applied as follows:
    - **duck:** dB-linear over 0.4 s *starting at the stinger start*, which is conservative at the hit; held for the duck length, then released;
    - **vacuum:** layers off 0.6 s before the first-strike impact (40 ms ramp);
    - **stage clear:** bed to −12 dB and the other layers off over 0.3 s; from +8.4 s the loudest `CLAIMED` mix is assumed fully back.
  - **Gate:** FFmpeg true peak ≤ **−2 dBTP** for every mix and pair. Integrated LUFS is reported per mix.
- **Arithmetic bound, reported beside each measurement, never instead of it.** Σ 10^((TP + gain)/20) is computed twice: once with the locked ceilings (the handoff's H1/H2 model) and once with the measured per-asset true peaks.
  - With the ceilings it reproduces the bible's verification record: worst layer mix `CS_COMBAT` −1.40 dBFS, and worst pair `MONUMENT_COMBAT` + third-wave `divider-contact` −1.13 dBFS.
  - The runtime's own H1–H3 unit tests remain the runtime phase's job.

## 8. Manifest

The default path is `public/music/manifest.json`, the shipped package directory. The handoff's typed-import location `src/audio/music/musicManifest.json` is available through `--manifest`, so the runtime phase can choose.

The manifest is deterministic:
- no timestamps and no host paths (enforced: any absolute or Windows path aborts the build);
- fixed key order and fixed asset order;
- measured values exactly as FFmpeg prints them.

Rebuilding the same renders with the same toolchain yields byte-identical JSON and MP3s. This is tested.

```jsonc
{
  "schema": 1,
  // "synthetic": true only for fixture packages
  "bpm": 100, "meter": "4/4", "beatsPerBar": 4, "loopBars": 16, "loopFrames": 1693440, "loopSeconds": 38.4,
  "canonicalSampleRate": 44100, "guardSeconds": 0.2, "guardFrames": 8820,
  "encoding": { "codec": "mp3", "encoder": "libmp3lame", "bitrateMode": "cbr", "sampleRate": 44100, "stereoBitrateKbps": 160, "monoBitrateKbps": 96 },
  "toolchain": { "ffmpeg": "6.1.1-3ubuntu5" },
  "daemonv12": { "engineVersion": "0.5.0", "commit": null },   // a value only when every render manifest records the same one
  "loops": [{
    "id": "engine", "kind": "loop", "url": "/music/engine.0ae8405cf9.mp3", "file": "engine.0ae8405cf9.mp3",
    "sha256": "…", "bytes": 466487, "channels": 1, "sampleRate": 44100, "codec": "mp3", "bitrateMode": "cbr", "bitrateKbps": 96,
    "frames": 1711080, "durationSeconds": 38.8, "guardFrames": 8820, "contentStartSeconds": 0.2, "contentEndSeconds": 38.6,
    "guardedWavSha256": "…", "decodedFrames": 1711080, "integratedLufs": -27, "truePeakDbtp": -22.7, "samplePeakDbfs": -23.11,
    "guard": "neighbor-cycle", "loopStartSeconds": 0.2, "loopEndSeconds": 38.6,
    "canonical": { "file": "stm-loop-engine.wav", "renderWavSha256": "…", "loopWavSha256": "…", "sourceFrames": 5080320,
                   "cycleStartFrame": 1693440, "frames": 1693440, "samplePeakDbfs": -22.67, "fullScaleSamples": 0 },
    "provenance": null,                                  // or the render-manifest summary, see section 9
    "periodicity": { "maxAbsDeltaLsb": 0, "preGuardMaxAbsDeltaLsb": 0, "identical": true },
    "unity": { "integratedLufs": -27, "truePeakDbtp": -22.7, "targetLufs": -27, "toleranceLu": 1, "truePeakCeilingDbtp": -12 },
    "foldDown": { "rule": "(L+R)/2, round half to even, PCM16, no dither", "correlation": 1, "loudnessDeltaLu": 0 }
  }],
  "stingers": [{
    "id": "first-strike", "kind": "stinger", /* the same shipped-file fields */ "guard": "zero",
    "bars": 5, "contentFrames": 529200, "contentSeconds": 12, "syncPosition": "2:4+1/6", "syncSeconds": 4.6, "syncFrames": 202860,
    "timing": ["exact"], "priority": 100, "duck": { "kind": "vacuum", "leadSeconds": 0.6, "rampSeconds": 0.04 }, "waveGainDb": null,
    "canonical": { … }, "provenance": null,
    "unity": { "integratedLufs": -35.1, "truePeakDbtp": -14, "truePeakCeilingDbtp": -2, "tailRmsDbfs": null }, "foldDown": null
  }]
}
```

The `duck` field takes one of three kinds:
- `{ "kind": "duck", "gainDb", "bars", "fadeSeconds" }`
- `{ "kind": "vacuum", … }`
- `{ "kind": "stage-clear", "bedGainDb": -12, "fadeSeconds": 0.3, "resumeAfterSeconds": 8.4, "resumeCue": "CLAIMED", "resumeSwellBars": 1 }`

The runtime should validate `decodedFrames`, `contentStartSeconds`/`contentEndSeconds` and the decode tolerance from handoff 6.3 against the context it actually decodes in.

## 9. Provenance

When `<name>.render.json` is present, the pipeline enforces:
- `wav.sha256` must equal the canonical WAV's SHA-256;
- the engine must be `daemonv12` 0.5.x;
- `wav.frames`, `sampleRate`, `channels`, `bitsPerSample`, `timeline.duration.bars` and `timeline.tail: "none"` must match the contract.

These fields are carried into the manifest **only if recorded**: engine (name, version, commit), project (file name, SHA-256, seed), renderer, GM renderer, SoundFont (file name, SHA-256) and audio tool versions, plus the render manifest's own SHA-256.

- Missing values stay `null`. Nothing is invented.
- Paths are reduced to file names.
- A missing render manifest is a warning, or a failure with `--require-provenance`.

## 10. Auditions

`music:auditions` writes two consecutive cycles (76.8 s, so the seam is audible) of each review mix as PCM16 stereo WAV, plus `auditions.json`. The gains are the handoff 3.4 cue values, unmodified:

| Mix | Layers | Cue gains |
|---|---|---|
| A | bed | `RECON` bed −3 |
| B | bed + engine | `FOOTHOLD_WORKS` 0 / −4 |
| C | bed + engine + pressure | `CONTESTED` 0 / −4 / −10 |
| D | bed + engine + pressure + assault | `CS_COMBAT` −4 / −10 / −2 / 0 |
| E | bed + engine + claim | `CLAIMED` 0 / −8 / 0 |

Each mix records:
- LUFS;
- true peak and sample peak, measured on the unclamped float sum;
- overs before quantization;
- samples clamped in the WAV.

Auditions:
- are written under `capture-final/` only (`public/` is refused);
- never change any source;
- need only structurally valid loops, so level or periodicity problems appear as warnings and you can still listen.

## 11. Safety and Git policy

- **Atomic build.** Encoding happens in a temporary staging directory. `--output` is touched only after every check passes. A failed build leaves it exactly as it was (tested).
- **Owned files only.** In the output, only files matching `<asset id>.<10 hex>.mp3` are replaced or removed as stale. Other files are never touched.
- **Refused write targets:**
  - the filesystem root, the home directory and the repository root;
  - anything inside the canonical input, or anything containing it;
  - `public/` for synthetic packages, auditions, archives and reports.
- **Synthetic packages are marked.** They carry `SYNTHETIC_FIXTURE.json`, need `--allow-synthetic`, and stamp `"synthetic": true` into their manifest.
- **What stays out of Git.** Canonical WAVs, archives, reports and auditions live under the ignored `capture-final/`. Tests generate their fixtures in the OS temp directory and delete them. No audio fixtures are committed.
- **No placeholder music in `public/music/`.** Until the real package is built, `public/music/` does not exist, so the repository never implies music exists. The runtime must tolerate an absent manifest.

## 12. Tests

`npm run music:test` runs these files with `node:test`:

| File | Covers |
|---|---|
| `musicSpec.test.ts` | the frame math (48 bars, cycle 2/3 ranges, guards, integer frames at every context rate), the seven stinger lengths, sync positions, channels, bitrates and targets |
| `pcm.test.ts` | WAV codec acceptance and rejection; cycle 2 and 3 extraction; periodicity pass, 1-LSB pass, a known failure with its location, pre-guard failure and seam metrics; mono fold rounding and losslessness; correlation; stereo preservation; neighbor-cycle loop guards; zero stinger guards; tail RMS; clipping |
| `combinations.test.ts` | the mix variants and invariants I1/I2; H1/H2 arithmetic reproducing the bible's −1.40 / −1.13 dBFS; stinger contexts; duck, vacuum and stage-clear envelopes; window rendering; auditions |
| `manifest.test.ts` | manifest key order, determinism and portability; managed-file cleanup; provenance carry-forward and rejection; the MP3 command and CBR frame-walk; CLI parsing; write-target safety |
| `pipeline.test.ts` | **FFmpeg:** full synthetic build (12 MP3s, ffprobe, hashes, decoded frames, manifest values, archive hashes, report); byte-identical rerun with stale cleanup; auditions; refusal of synthetic input and of public/ output; one failing package covering wrong duration, wrong sample rate, non-periodic cycle, decorrelated mono, off-target loudness, wrong stinger length, ringing tail, stinger over its TP ceiling and a render-manifest hash mismatch, with the output left untouched; the measured audit catching coincident peaks that pass alone |

`pipeline.test.ts` skips itself when FFmpeg with libmp3lame is missing. Ordinary CI (`npm run check`) needs no soundtrack files.

## 13. Boundary with the runtime phase

**Done here:**
- everything in handoff 9.1–9.4 except the manifest's runtime location choice;
- the canonical half of the 9.5 placeholder package (`music:fixtures`).

**Left to the runtime phase:**
- AudioContext and buses;
- snapshot, arc and cue derivation, the mix table code and modifiers;
- the director, playback epoch and scheduling;
- stinger triggering and ducks at runtime;
- autoplay, suspend, resume and reset;
- the loader, decode validation and residency;
- SFX re-leveling and the alert duck;
- `musicManifest.ts` typing;
- the H1–H3 unit tests;
- browser decode checks (acceptance E);
- the e2e `dry` campaign.

For the browser click test (acceptance E), the runtime phase decides where a synthetic package is served from. This pipeline refuses to place one in `public/`.
