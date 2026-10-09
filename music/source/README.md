# Shoot the Moon adaptive soundtrack: Package 1 sources

This directory holds the small files needed to reproduce the shipped game music
in `public/music/`. It covers handoff section 8.3 step 2 in
[ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md](../../docs/ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md).

| Path | Contents |
|---|---|
| `daemonv12/*.json` | The 12 DaemonV12 V0.5 projects, exactly as rendered: 5 loops (48 bars, cycle 2 is the loop) and 7 stingers |
| `renders/*.render.json` | The `daemonv12_render` provenance manifest for each canonical WAV |
| `renders/*.analysis.json` | The `daemonv12_analyze` report for each canonical WAV |
| `orbital-foundry-verification.json` | SHA-256 check of the 12 Orbital Foundry samples against the DaemonV12 catalog (all match; CC0-1.0) |

The canonical WAV masters are **not** in git. They are 44.1 kHz PCM16 stereo
renders, about 85 MB for the loops alone. They live in the ignored asset-builder
workspace:

- `capture-final/game-audio/canonical/<id>/<name>.wav` holds the renders, with stems and MIDI beside them.
- `capture-final/game-audio/loops/<id>.loop.wav` holds the cropped production loops.

The hashes below identify them exactly.

## Toolchain

- **DaemonV12 0.5.0**, local checkout `e84a62e679c1fdf037dac9b0ccc4e994e1064455` (recorded in the Part A report).
  - The render manifests record the engine version but not the commit, so the shipped manifest's `daemonv12.commit` is `null`.
- **Renderer:** `daemonv12-production` 2.
- **GM:** FluidSynth 2.3.7 with `FluidR3_GM.sf2` (`74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0`).
- **Audio tool:** FFmpeg 6.1.1. No normalization, dither, master compressor or limiter.
- **Samples:** the Orbital Foundry pack, CC0-1.0, hashes in `orbital-foundry-verification.json`.

Every hash in the chain was re-verified when the package was built into `public/music/`:
project JSON → render manifest → canonical WAV → loop crop → shipped MP3.
The rebuilt MP3s and manifest are byte-identical to the package Astra auditioned.

## Canonical masters

| Asset | DaemonV12 project (seed) | Canonical WAV SHA-256 | Frames |
|---|---|---|---:|
| `bed` | [`stm-loop-bed.json`](daemonv12/stm-loop-bed.json) (1001601) | `935747a7e1c88256ff684c5f296951b27d40e61907810c9f364e21ba4db54b88` | 5,080,320 |
| `engine` | [`stm-loop-engine.json`](daemonv12/stm-loop-engine.json) (1001602) | `9bc3599b1301081d998b14309929bee74fd3afa6b7c6c17af4f60211399f4f82` | 5,080,320 |
| `pressure` | [`stm-loop-pressure.json`](daemonv12/stm-loop-pressure.json) (1001603) | `48e76a7bdbb13a1542eb34714173a23621f7cd15dc859a7c58d8be58f8e0bccf` | 5,080,320 |
| `assault` | [`stm-loop-assault.json`](daemonv12/stm-loop-assault.json) (1001604) | `7e4fd5697f2e31e88c3dd1811dd736f683d84b779a370bf97f5a00515c2f6629` | 5,080,320 |
| `claim` | [`stm-loop-claim.json`](daemonv12/stm-loop-claim.json) (1001605) | `518399e02b02d6df402e5ff2f7ab2b5ce6efd757ef8225881290dd5c7944c757` | 5,080,320 |
| `vesper-arrival` | [`stm-sting-vesper-arrival.json`](daemonv12/stm-sting-vesper-arrival.json) (1001700) | `9f1f06554c35d7ac1ab424293b73669145a23673f040113ea2d772667ffcd23f` | 211,680 |
| `first-strike` | [`stm-sting-first-strike.json`](daemonv12/stm-sting-first-strike.json) (1001705) | `0c17c7dd4a70bba58840c8d3e895c59e2fed90a2bc6a07309ae17253f1cf51cf` | 529,200 |
| `vesper-retaliation` | [`stm-sting-vesper-retaliation.json`](daemonv12/stm-sting-vesper-retaliation.json) (1001701) | `5dccfbc0e7d73c91fee7a6050413bdbac8c30572c285a03d3ee25f893733bdb3` | 105,840 |
| `divider-contact` | [`stm-sting-divider-contact.json`](daemonv12/stm-sting-divider-contact.json) (1001702) | `6ccb4ad64de9e7294f98ca8a65661581eb25a800b2185edc4d572077006cbad2` | 105,840 |
| `outcome-hold` | [`stm-sting-outcome-hold.json`](daemonv12/stm-sting-outcome-hold.json) (1001703) | `4575c36a252d2ed03abb49dac413e387e7afadae2cb92b2495d98366d21883b7` | 105,840 |
| `outcome-breach` | [`stm-sting-outcome-breach.json`](daemonv12/stm-sting-outcome-breach.json) (1001704) | `f434e35d03bba0845e8f2064b621ef480b5659a96379c802898727f1451d089b` | 211,680 |
| `territory-claimed` | [`stm-sting-territory-claimed.json`](daemonv12/stm-sting-territory-claimed.json) (1001706) | `14a086740cbd13bdc52e376b396fdaed0ce95db1491c461461e62b55f9f15908` | 423,360 |

Loop crops (cycle 2, frames [1,693,440, 3,386,880), PCM16 stereo, 1,693,440 frames):

| Loop | Cropped loop WAV SHA-256 |
|---|---|
| `bed` | `61972f066ed70449d0006324a4651dab2a062e3772008ecd44f9e797b61edbe7` |
| `engine` | `a58e92365ec7deb0d467af7fc8885d0dddee22cd7a7a24bd272687cdf29bae31` |
| `pressure` | `586456f08a9145da4abf54b3057c45756555dff7590dafa4214912eaf2e1dffc` |
| `assault` | `f255473e64ea3f5676cc6c4ae7583b4cbeccbf5e194e25224d241a2defc2da16` |
| `claim` | `01e87cede352f160efc95101b40f7eac8e16ad0f741b9bfdcf0a9cfccb46f8d0` |

Render manifests and shipped files:

| Asset | Render manifest SHA-256 | Shipped file |
|---|---|---|
| `bed` | `68174ba1ee206b4a8d522eb572a3784b4e7092e002bd64927b394c0135bf7eff` | `public/music/bed.cf383ebd28.mp3` |
| `engine` | `f9dcccaddc53c4b75e448bdbfced8f16e94f5e53571f5f3e27c4d2fccac9bbc3` | `public/music/engine.bcd23f6b8e.mp3` |
| `pressure` | `1db7e14d401697fa04f30bb6698ad2a7ec87f1e827ffd561f30e8900573f8742` | `public/music/pressure.b0edef154c.mp3` |
| `assault` | `1edb153d7ab5885673785b2ce79ad357cd819648634b22399e0cb1c8d4872b49` | `public/music/assault.96c4d72401.mp3` |
| `claim` | `eee1982601e96ae3346460e2331ff9d8091e312245de702fc8af3572359af2c7` | `public/music/claim.0f08a786e3.mp3` |
| `vesper-arrival` | `43add1ac446839421b693d93de1f4e590e577196b3fa3e37559fd8665781a211` | `public/music/vesper-arrival.74fde37bf2.mp3` |
| `first-strike` | `c7d8a43eac056e584e9e4af58701be19ab9ca7001b5ab1d2d8415dc6a1ffd051` | `public/music/first-strike.822a63fddc.mp3` |
| `vesper-retaliation` | `38286c8556b98d67a5f197006934bae2af545569cddad6cbd06b7d5e3e008161` | `public/music/vesper-retaliation.0a163ee31a.mp3` |
| `divider-contact` | `50fd82ac104a4f90f08cbda39c3e12c2b934252c044c3214bf58d3096371e209` | `public/music/divider-contact.6279e88582.mp3` |
| `outcome-hold` | `fc995f5fdd1d8ea89e72179e131b50471f7e83e73db04ea8cf9836b3576d3f18` | `public/music/outcome-hold.dd892715dc.mp3` |
| `outcome-breach` | `c953611e59d79a4cac6d8601f1428e845a81b02890161f22163357dc58f7fc4e` | `public/music/outcome-breach.1900881342.mp3` |
| `territory-claimed` | `2ad39e23187bf6db4f86152a53ffc742e64a4b93a10cfdb33a75d5956e1126f0` | `public/music/territory-claimed.50efb21db7.mp3` |

## Reproducing the shipped package

1. Render each project in `daemonv12/` with DaemonV12 0.5.x `daemonv12_render` (`stems: true`, `format: "wav"`) in the same environment.
   - Renders are byte-reproducible there, so each WAV must match its SHA-256 above.
2. Lay the renders out as `<dir>/<id>/<name>.wav`, with each `<name>.render.json` beside its WAV.
3. Validate, then build (see [ADAPTIVE_MUSIC_ASSET_PIPELINE.md](../../docs/ADAPTIVE_MUSIC_ASSET_PIPELINE.md)):

   ```sh
   npm run music:validate -- --input <dir> --require-provenance
   npm run music:build -- --input <dir> --output public/music \
     --manifest src/audio/music/musicManifest.json --require-provenance
   ```

4. The build is deterministic. The same renders and toolchain give byte-identical MP3s and `src/audio/music/musicManifest.json`.
   - `src/audio/music/musicManifest.test.ts` re-checks every shipped file's SHA-256 against that manifest.
