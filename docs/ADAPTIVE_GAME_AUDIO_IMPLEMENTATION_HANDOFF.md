# SHOOT THE MOON — ADAPTIVE GAME AUDIO: IMPLEMENTATION HANDOFF

**Implementers:**
- **Part A (composition and render):** Astra, through DaemonV12 V0.5 MCP.
- **Part B (asset build, runtime, tests):** Codex.

**Design authority:** [ADAPTIVE_GAME_AUDIO_BIBLE.md](ADAPTIVE_GAME_AUDIO_BIBLE.md). **Where they differ, this handoff wins.**

**Do not:**
- change gameplay rules, timers or reducers;
- modify DaemonV12;
- add an audio framework (Howler, Tone.js, …);
- play layers through `<audio>` / HTMLMediaElement;
- close the AudioContext on NEW GAME;
- put F♯, B♮, C♯ or the alarm sample in any loop;
- restart a loop while a session is running.

---

## 1. Locked choices

| Item | Value |
|---|---|
| Tempo / meter / center | **100 BPM, 4/4, D.** Minor-modal; **F♯ reserved for `territory-claimed`** |
| Grid | beat 0.6 s · bar 2.4 s · phrase 4 bars = 9.6 s |
| Loop | **16 bars = 38.4 s = 61,440 ticks = 1,693,440 frames @ 44.1 kHz** (1,843,200 @ 48 kHz) |
| Harmonic skeleton | P1 (bars 1–4) D · P2 (5–8) B♭ · P3 (9–12) G · P4 (13–16) A → seam to D |
| Layers | `bed` (stereo), `engine` (mono), `pressure` (mono), `assault` (mono), `claim` (stereo) |
| Stingers | `vesper-arrival`, `first-strike`, `vesper-retaliation`, `divider-contact`, `outcome-hold`, `outcome-breach`, `territory-claimed` |
| Canonical renders | DaemonV12 V0.5 (engine 0.5.0, `main` @ `e84a62e` or a later 0.5.x), 44.1 kHz PCM16 stereo WAV. Loops render **48 bars**; **cycle 2 is the loop** |
| Web format | MP3 CBR 44.1 kHz: stereo 160 kbps, mono 96 kbps. **0.2 s guard on both sides** (8,820 frames) |
| Playback | one shared AudioContext; one `AudioBufferSourceNode` per layer, `loop` over [0.2 s, 38.6 s); all layers on one epoch; transitions are gain automation only |
| Quantization | IMMEDIATE (now + 0.10 s) · BEAT · BAR · PHRASE · EXACT (a presentation-anchored game time mapped by A(t), section 6.3) |
| Headroom | every state, every state + stinger, and every crossfade ≤ −1 dBFS worst-case (arithmetic sum of true-peak ceilings) |
| Memory | decoded ≤ 61.4 MiB at 48 kHz with everything resident. Budget: 48 MiB typical, 64 MiB hard |
| Download | ≈ 3.6 MB, after BEGIN only |

---

## 2. Asset list

### 2.1 Loops

| ID | Ch | Unity LUFS | TP ceiling | Canonical frames | Guarded frames | MP3 |
|---|---|---:|---:|---:|---:|---|
| `bed` | 2 | −26 ± 1 | −14 dBTP | 1,693,440 | 1,711,080 | 160 kbps stereo |
| `engine` | 1 | −27 ± 1 | −12 dBTP | 1,693,440 | 1,711,080 | 96 kbps mono |
| `pressure` | 1 | −25 ± 1 | −12 dBTP | 1,693,440 | 1,711,080 | 96 kbps mono |
| `assault` | 1 | −20 ± 1 | −7 dBTP | 1,693,440 | 1,711,080 | 96 kbps mono |
| `claim` | 2 | −23 ± 1 | −10 dBTP | 1,693,440 | 1,711,080 | 160 kbps stereo |

Measure mono layers on their stereo (dual-mono) DaemonV12 crop, which is how they are heard.

### 2.2 Stingers

| ID | Bars (frames) | Ch | Sync position (content) | Timing | TP ceiling | Duck on layers | Priority |
|---|---|---|---|---|---:|---|---:|
| `vesper-arrival` | 2 (211,680) | 1 | `1:1` (0 s) | BEAT | −9 | −3 dB, 2 bars | 70 |
| `first-strike` | 5 (529,200) | 2 | `2:4+1/6` (4.6 s, impact) | EXACT | −2 | vacuum (section 4.2) | 100 |
| `vesper-retaliation` | 1 (105,840) | 1 | `1:1` | BEAT | −9 | −3 dB, 1 bar | 70 |
| `divider-contact` | 1 (105,840) | 1 | `1:1` | BEAT | −11 (+0 / +1 / +2 dB for waves 1 / 2 / 3) | −4 dB, 1 bar | 50 |
| `outcome-hold` | 1 (105,840) | 1 | `1:1` | BEAT | −9 | −8 dB, 1 bar | 60 |
| `outcome-breach` | 2 (211,680) | 1 | `1:1` (hit) | EXACT / IMMEDIATE | −6 | −8 dB, 2 bars | 80 |
| `territory-claimed` | 4 (423,360) | 2 | `1:1` (arrival) | EXACT | −5 | stage clear (section 4.2) | 90 |

Rules for every stinger:
- Guarded web file = 8,820 zero frames + stinger + 8,820 zero frames.
- The content must be ≤ −60 dBFS RMS over its last 100 ms.
- EXACT and IMMEDIATE stingers contain **no metric pulse after the sync point**.

---

## 3. Game state → music state

### 3.1 Snapshot (built in `App.tsx`, pure, memoized)

```ts
export interface MusicSnapshot {
  readonly entryOpen: boolean                            // entryOpen
  readonly phase: ExperiencePhase                        // state.phase
  readonly monumentView: boolean                         // monumentView
  readonly outpost: null | {
    readonly extractorActive: boolean                    // outpost.extractor?.status === 'active'
    readonly moduleActive: boolean                       // outpost.module?.status === 'active'
    readonly siege: OrbitalSiegeSnapshot | null          // outpost.orbitalSiege
    readonly monument: TerritoryMonumentSnapshot | null  // outpost.monument
  }
  readonly rivalRevealStatus: RivalRevealStatus | null   // rival?.revealStatus
  readonly rivalPhase: RivalPresentationPhase            // rivalPresentation.phase
  readonly firstStrikeStatus: FirstStrikeStatus | null   // firstStrike?.status
  readonly strikePhase: FirstStrikePresentationPhase     // firstStrikePresentation.phase
  readonly strikePhaseStartedAtMs: number                // firstStrikePresentation.startedAtMs (performance.now)
  readonly strikeConfirmationOpen: boolean               // strikeConfirmationOpen
  readonly acceptedOutcome: CounterstrikeOutcome | null  // counterstrike?.acceptedOutcome ?? null
  readonly counterstrikeDamaged: boolean                 // counterstrike?.outpostDamageState === 'DAMAGED'
  readonly csStatus: CounterstrikeRunStatus              // counterstrikeRun.status
  readonly csPhaseStartedAtMs: number                    // counterstrikeRun.phaseStartedAtMs (performance.now)
  readonly platformDefenseWave: number | null            // platformDefense?.wavesResolved ?? null
  readonly monumentRevealAtMs: number | null             // monumentRevealAtMs (performance.now)
}
```

Derived helpers:
- `presentationsIdle` = `rivalPhase === 'idle' && strikePhase === 'idle' && (csStatus === 'dormant' || csStatus === 'resolved')`.
- `siegeAdvancing` = `siegeIsActive(siege) && (phase === 'landed' || monumentView) && presentationsIdle`.
  - This mirrors the tick effect, `App.tsx` 832–882.

### 3.2 Arc (first match wins)

```ts
if (outpost === null) return 'RECON'
if (outpost.monument?.status === 'complete') return 'CLAIMED'
if (firstStrikeStatus === 'COMPLETE' && acceptedOutcome === null) return 'RETALIATION'
if (acceptedOutcome !== null) return 'ASCENDANT'
if (rivalRevealStatus === 'REVEALED') return 'CONTESTED'
return 'FOOTHOLD'
```

Arc calm cue:
- `RECON` → `RECON`
- `FOOTHOLD` → `FOOTHOLD_WORKS` if `extractorActive`, else `FOOTHOLD`
- every other arc → the cue of the same name

### 3.3 Cue (first match wins)

1. `entryOpen` or music not started → `SILENT`.
2. `strikePhase`:
   - arming, launch, orbital-flight, target-approach → `FS_FLIGHT`
   - vesper-transmission → `FS_TRANSMISSION`
   - impact-flash, ejecta → `FS_VACUUM`
   - crater-reveal, orbital-pullback, ending → `FS_BREATH`
3. `csStatus`:
   - command, command-confirmed → `CS_ALERT`
   - warning → `CS_WARNING`
   - tracking, intercept-ready, interceptor-launched, missed → `CS_COMBAT`
   - impact → `CS_IMPACT`
   - success → `CS_SUCCESS`
4. `monumentRevealAtMs !== null && monumentView` → `MONUMENT_REVEAL`.
5. `rivalPhase`:
   - warning, orbital-transition, capsule-approach → `REVEAL_APPROACH`
   - impact → `REVEAL_IMPACT`
   - intro-transmission → `REVEAL_TRANSMISSION`
   - dual-sites → `REVEAL_SETTLE`
   - rival-focus, rival-focused, scanning, contested → `RIVAL_FOCUS`
   - scan-response → `RIVAL_TRANSMISSION`
6. `siegeAdvancing`:
   - constructing → `SIEGE_BUILD`
   - command → `SIEGE_ALERT`
   - waves → `SIEGE_COMBAT`
   - repairing → `SIEGE_REPAIR`
7. `monumentView`:
   - `monument === null` → `MONUMENT_CHOICES`
   - constructing → `MONUMENT_BUILD`
   - command → `MONUMENT_ALERT`
   - wave → `MONUMENT_COMBAT`
   - activating → `MONUMENT_ACTIVATING`
   - damaged, repairing → `MONUMENT_DAMAGED`
   - complete → arc calm cue
8. `strikeConfirmationOpen` → `STRIKE_DECISION`.
9. `strikePhase === 'scar-explore'` → arc calm cue with ENGINE off.
10. Arc calm cue.

### 3.4 Mix table (dB; blank = off)

| Cue | bed | engine | pressure | assault | claim |
|---|---:|---:|---:|---:|---:|
| `SILENT` | | | | | |
| `RECON` | −3 | | | | |
| `FOOTHOLD` | 0 | −12 | | | |
| `FOOTHOLD_WORKS` | 0 | −4 | | | |
| `CONTESTED` | 0 | −4 | −10 | | |
| `RETALIATION` | 0 | −6 | −5 | | |
| `ASCENDANT` | 0 | −4 | | | |
| `CLAIMED` | 0 | −8 | | | 0 |
| `REVEAL_APPROACH` | −2 | −10 | −6 | | |
| `REVEAL_IMPACT` | −2 | −10 | −3 | | |
| `REVEAL_TRANSMISSION` | −6 | | −9 | | |
| `REVEAL_SETTLE` | −2 | −8 | −8 | | |
| `RIVAL_FOCUS` | −2 | −10 | −4 | | |
| `RIVAL_TRANSMISSION` | −5 | −12 | −7 | | |
| `STRIKE_DECISION` | −2 | −8 | −6 | | |
| `FS_FLIGHT` | −4 | −8 | −10 | −1 | |
| `FS_TRANSMISSION` | −4 | −8 | −3 | −3 | |
| `FS_VACUUM` | | | | | |
| `FS_BREATH` | −8 | | | | |
| `CS_ALERT` | −3 | −8 | −2 | −14 | |
| `CS_WARNING` | −3 | −8 | −2 | −6 | |
| `CS_COMBAT` | −4 | −10 | −2 | 0 | |
| `CS_IMPACT` | −6 | | −4 | −10 | |
| `CS_SUCCESS` | −2 | −4 | −12 | −10 | |
| `SIEGE_BUILD` | 0 | 0 | arc | | arc |
| `SIEGE_ALERT` | −2 | −4 | arc | −10 | arc |
| `SIEGE_COMBAT` | −4 | −8 | arc | 0 | arc |
| `SIEGE_REPAIR` | 0 | −2 | arc | | arc |
| `MONUMENT_CHOICES` | 0 | −3 | | | −10 |
| `MONUMENT_BUILD` | 0 | −3 | | | −8 |
| `MONUMENT_ALERT` | −2 | −6 | | −12 | −6 |
| `MONUMENT_ALERT_DWELL` | −2 | −6 | | | −8 |
| `MONUMENT_COMBAT` | −4 | −10 | | 0 | −5 |
| `MONUMENT_ACTIVATING` | 0 | −4 | | | −2 |
| `MONUMENT_DAMAGED` | 0 | −6 | | | −12 |
| `MONUMENT_REVEAL` | −4 | | | | −6 |

**Siege "arc" cells:** `CONTESTED` → pressure −12; `CLAIMED` → claim −10; otherwise off.

### 3.5 Modifiers (in order) and invariants

1. **Tier** (cues `FOOTHOLD_WORKS`, `CONTESTED`, `RETALIATION`, `ASCENDANT`): engine +1 dB if `moduleActive`, +1 dB if the siege is `operational`.
2. **View** (calm cues): engine −4 dB when `phase` is orbit, selected or returning. Ramp over the camera journey (6.2 s down, 2.4 s up).
3. **Damage** (calm cues): engine −3 dB if `counterstrikeDamaged`, or the siege is `damaged`, or the monument is `damaged`. In `ASCENDANT` with `counterstrikeDamaged`, pressure is −14 dB.
4. **Monument flavor** (`CLAIMED`): engine is *set to* −4 (HELIOS_SPIRE), −6 (BASTION_OBELISK), −10 (CRATER_CROWN) or −12 (SIGNAL_ARRAY).
5. **Operating-mode tilt:** off in package 1.

**Invariants** (assert after modifiers):
- **I1** If `csStatus` is not dormant or resolved → claim off. Otherwise, if claim is above off → pressure off.
- **I2** No layer above 0 dB.
- **I3** H1: Σ 10^((TP + gain)/20) ≤ 10^(−1/20) for every reachable mix.

### 3.6 Pitch-class contract (Astra; every loop)

| Phrase | bed | engine | pressure | assault | claim |
|---|---|---|---|---|---|
| P1 (D) | D, A | D pedal (+A) | D, E♭, F, A♭ | D octaves; E♭ short neighbor; C passing | D, A |
| P2 (B♭) | B♭, D | D pedal | B♭, D, F, A♭ | B♭ octaves; C passing | B♭, C, D, E, F, A |
| P3 (G) | G, D | D pedal | G, B♭, D, E♭, A♭ | G octaves; D; F passing | G, A, C, D |
| P4 (A) | A, D | D pedal (+A) | A, A♭, C, E♭ | A octaves; C passing | A, D, E |

Never in loops: **F♯, B♮, C♯, `12-alarm-energy-pulse`**.

### 3.7 Dwell, rotation, rests (audio clock)

- **Dwell:** after 2 phrases with no state change:
  - `MONUMENT_ALERT` → `MONUMENT_ALERT_DWELL`
  - `STRIKE_DECISION` → arc calm
  - `RIVAL_FOCUS` while `rivalPhase === 'rival-focused'` → arc calm
- **Rotation:** count whole loops in the same calm cue. Every 4th loop is thinned (engine off, pressure −6, claim −4). The 9th loop is a rest (all layers off), then the count restarts. Windows start and end on **bar 9 (P3)** boundaries. `RECON` never rests. Any non-calm cue cancels a rest at the next bar.

---

## 4. Events → stingers and exact schedules

### 4.1 Edges

Diff consecutive snapshots while playing. **The first snapshot after start, resume or SOUND ON is a baseline and fires nothing.**

| Edge (prev → next) | Fires |
|---|---|
| `rivalPhase` ≠ warning → `warning` | `vesper-arrival` (BEAT) |
| `strikePhase` ≠ arming → `arming` | `first-strike` schedule (4.2) |
| `csStatus` ∈ {dormant, resolved} → `command` | `vesper-retaliation` (BEAT) |
| `siege.status` → `command` while `siegeAdvancing` | `divider-contact`, gain +0 dB |
| `platformDefenseWave` null or i−1 → i | `divider-contact`, gain +i dB |
| `monument.status` → `command` with `wavesResolved === 0` (monument view open) | `divider-contact` |
| `monument.status` → `wave` | `divider-contact`, gain +`wavesResolved` dB |
| `csStatus` → `success` | `outcome-hold` (BEAT) |
| siege `waves` → `operational`; siege `repairing` → `operational`; monument `wave` → `activating` | `outcome-hold` (BEAT) |
| `csStatus` → `impact` | `outcome-breach` EXACT, sync at A(`csPhaseStartedAtMs` + 1,500) |
| siege `waves` → `damaged`; monument `wave` → `damaged` | `outcome-breach` IMMEDIATE |
| `monumentRevealAtMs` null → set | `territory-claimed` EXACT, sync at A(`monumentRevealAtMs`) |

A(t) maps a `performance.now()` time to audio time, including `SYNC_VISUAL_OFFSET_MS` (section 6.3).

### 4.2 Scheduled set pieces

**First Strike.** The `arming` edge arms a plan. Its steps are anchored to the strike phase they fall in, not to the arming time:
- Each phase starts at `performance.now()` when the previous phase's timer fires (`App.tsx` 1150), so real starts drift late from the nominal sums.
- A hidden tab shifts only the current phase's `startedAtMs`.
- On every strike-phase edge (and on resume), recompute each step that has not started from the **current** `strikePhaseStartedAtMs` plus the remaining nominal durations in `FIRST_STRIKE_PRESENTATION_DURATIONS_MS`.

| Step | Anchor | Nominal from arming |
|---|---|---:|
| `first-strike` starts (its impact is content 4.6 s) | vesper-transmission start + 800 ms | 10,200 ms |
| **Vacuum:** every layer to off, 40 ms ramp ending at | target-approach start + 1,600 ms | 14,200 ms |
| Impact = flash | impact-flash start | 14,800 ms |
| **Breath:** bed to −8 dB over 2 s | the crater-reveal edge, IMMEDIATE | 19,500 ms |

- Once the stinger starts, its impact is fixed. It can lead the flash by the lateness of the last two phase timers, typically under one frame each.
- From the vacuum until the breath, the plan owns the layer lanes. Re-derived `FS_FLIGHT` / `FS_VACUUM` targets do not raise them.
- Cancel anything not yet started if `strikePhase` becomes idle or scar-explore first, or on reset.

**Territory claimed.**
- On the stinger start: bed to −12 dB, every other layer off (0.3 s).
- At the first phrase boundary ≥ sync + 8.4 s: `CLAIMED` mix with a 1-bar swell.

### 4.3 Concurrency

- At most 2 stingers at once.
- A higher priority cuts a lower one (50 ms fade).
- The same ID is ignored while it is still playing.
- Ducks never raise a layer.

---

## 5. Transitions

Boundary formula: `B = epoch + ceil((now + 0.10 − epoch) / unit) × unit`, then rounded to a whole frame.

Fades:
- **swell:** dB-linear, ends on B.
- **hard:** 20 ms, starts on B.
- **release:** dB-linear, starts on B.
- **duck:** 0.4 s.
- **vacuum:** 40 ms ending at the exact time.

**Sequencing:** falls start at T; rises start at T + fall/2.

| Change | Quantize | Fade |
|---|---|---|
| start | epoch = now + 0.15 s | bed swell 1 bar; others join at the next bar |
| calm → calm (arc change) | PHRASE | 2 bars |
| calm → tension | BAR | 1 bar |
| tension or calm → combat | BAR | assault hard; others 1 beat |
| FIRE (`FS_FLIGHT`) | BEAT | assault hard |
| set-piece steps (`REVEAL_*`, `RIVAL_*` except transmissions, `FS_FLIGHT` ⇄ `FS_TRANSMISSION`) | BEAT | 1 beat |
| `REVEAL_TRANSMISSION`, `RIVAL_TRANSMISSION` | IMMEDIATE | duck |
| combat → aftermath (`CS_SUCCESS`, `CS_IMPACT`, outcome cues) | BEAT | 1 beat |
| aftermath or tension → calm; dwell decay | PHRASE | release 1 bar (dwell: 2 bars) |
| rotation | bar-9 boundary | 1 bar |
| view change | IMMEDIATE | journey length |
| late-decoded layer joins | BAR | swell 1 bar |
| SOUND OFF / NEW GAME | IMMEDIATE | 0.15 s / 0.5 s |

**Alert duck:** when SFX `threat-warning`, `target-lock` or `fire-window` plays, apply musicBus −4 dB (20 ms attack, 0.4 s hold, 0.6 s release).

---

## 6. Integration architecture

### 6.1 Graph

`masterGain (−0.6 dB) → safetyLimiter (DynamicsCompressorNode: threshold −1, knee 0, ratio 20, attack 0.003, release 0.25) → destination`
- `sfxBus` → `masterGain`
- `musicBus` (alert duck) → `masterGain`
  - `layersBus` (stinger ducks) ← five layer `GainNode`s ← looping sources
  - `stingerBus` ← one-shot sources

The −0.6 dB master compensates the limiter's automatic makeup at these settings (per the Web Audio spec formula). Verify it in Chrome.

### 6.2 Lifecycle

**States:** `idle` → `unlocked` (context created or resumed **inside** the BEGIN/CONTINUE handler, before any `await`) → `loading` (bed first) → `playing` ⇄ `suspended` → `stopped` (NEW GAME: fade, stop sources, clear schedules, **keep the context and decoded buffers**) → next BEGIN starts a new epoch.

**Suspend and resume:**
- **Hidden:** `context.suspend()` at once.
- **SOUND OFF:** fade 0.15 s, then `context.suspend()`.
- **Return** (visible or SOUND ON): `resume()`, take a new baseline and re-derive targets. Then fade out (20 ms) and stop every stinger source still playing. Restart each EXACT stinger whose sync point is still ahead at its re-anchored offset (6.3), with a 20 ms fade-in. Reschedule unstarted EXACT steps. Nothing else replays.
- **Why restart rather than continue:** SOUND OFF does not pause the game, and a resumed context can come back 100 ms or more late on Android. A paused stinger would land late either way.

**Side states:** `error` (a layer failed validation and is skipped) · `disabled` (`?music=0`, or SOUND OFF at BEGIN: no fetch or decode) · `dry` (state machine and scheduling against a null sink, no network; default whenever `shouldEnableE2eHarness(...)` is true, unless `music=full`).

### 6.3 Playback math

- **Epoch:** `round((ctx.currentTime + 0.15) × sr) / sr`.
- **Layer start at t:**
  ```js
  src.loop = true
  src.loopStart = 0.2
  src.loopEnd = 38.6
  src.start(t, 0.2 + mod(t − epoch, 38.4))
  ```
  The same formula serves late joins.
- **A(perfMs):**
  ```js
  const ts = ctx.getOutputTimestamp()
  const T = ts.contextTime + (perfMs + SYNC_VISUAL_OFFSET_MS − ts.performanceTime) / 1000
  ```
  - Fallback: `ctx.currentTime + (perfMs + SYNC_VISUAL_OFFSET_MS − performance.now()) / 1000`.
  - `SYNC_VISUAL_OFFSET_MS` = 40; tune it within 0–80 for acceptance criterion E.
  - Why: game timestamps mark the state change, and the frame that shows it reaches the screen one to three frames later. Sound that leads the picture is the more noticeable error.
- **Stinger:** for BEAT stingers, `sync` is the first beat boundary with `sync − syncSeconds ≥ now + 0.10`. For EXACT stingers, `sync` is the scheduled game time.
  ```js
  start = sync − syncSeconds
  if (start < now) src.start(now, 0.2 + (now − start))
  else src.start(start, 0.2)
  ```
- **Automation:**
  ```js
  cancelScheduledValues(T)
  setValueAtTime(model(T), T)
  exponentialRampToValueAtTime(target or 0.001, …)
  // off: setValueAtTime(0) at the ramp end
  ```
  The director models every lane itself; never read future values from `AudioParam`.
- **Decode validation:**
  - `buffer.duration` ∈ [content + 0.4 − 0.005, content + 0.4 + 0.08] s.
  - `buffer.sampleRate === ctx.sampleRate`.
  - Otherwise mark that asset as an error and continue.

### 6.4 Director API

```ts
interface MusicDirector {
  unlockAndStart(snapshot: MusicSnapshot): void   // call synchronously in BEGIN/CONTINUE
  update(snapshot: MusicSnapshot): void            // on every memoized snapshot change
  suspend(): void
  resume(snapshot: MusicSnapshot): void
  setEnabled(enabled: boolean, snapshot: MusicSnapshot): void
  notifyAlert(cue: 'threat-warning' | 'target-lock' | 'fire-window'): void
  reset(): void
  readonly debug: {
    status: string
    arc: string
    cue: string
    lastStinger: string | null
    stingerCount: number
  }
}
```

### 6.5 Attributes on `<main>`

`data-music-status`, `data-music-arc`, `data-music-cue`, `data-music-last-stinger`, `data-music-stingers` (count).

---

## 7. Files

**Create:**

| File | Contents |
|---|---|
| `src/audio/audioEngine.ts` | singleton context, buses, limiter, unlock / suspend / resume / reset |
| `src/audio/music/musicConstants.ts` | BPM, grid, loop, guard, unity targets, TP ceilings, `SYNC_VISUAL_OFFSET_MS` |
| `src/audio/music/musicManifest.json` + `musicManifest.ts` | typed manifest (generated) |
| `src/audio/music/musicState.ts` | `MusicSnapshot`, `deriveArc`, `deriveCue`, `deriveMusicTarget`, `deriveMusicEvents` (pure) |
| `src/audio/music/musicMix.ts` | mix table, modifiers, invariants, headroom helpers |
| `src/audio/music/musicClock.ts` | boundaries, offsets, frame rounding, A(perfMs) |
| `src/audio/music/musicDirector.ts` | scheduler (injected `AudioContextLike`) |
| `src/audio/music/musicLoader.ts` | fetch, decode, validate, residency groups |
| `src/audio/useAdaptiveMusic.ts` | React wiring |
| `src/audio/music/testing/fakeAudioContext.ts` | recording fake for tests |
| `src/audio/music/*.test.ts` | the tests in section 11 |
| `scripts/music/build-web-music.mjs` | asset build (Part B); needs Node and FFmpeg; run by the asset builder, not in CI |
| `music/source/README.md`, `music/source/daemonv12/*.json`, `music/source/renders/*.render.json`, `*.analysis.json` | provenance from Part A |
| `public/music/<id>.<sha10>.mp3` | the 12 web files |
| `e2e/adaptive-music.spec.ts` | the `dry`-mode campaign assertions |

**Modify:**

| File | Change |
|---|---|
| `src/audio/useCinematicAudio.ts` | use the shared engine and `sfxBus`; NEW GAME stops voices instead of closing the context; report alert cues to the director; retune or replace `rival` when music is on; remove the doubled sub in `impact` when music is on |
| `src/App.tsx` | build `MusicSnapshot`; call `useAdaptiveMusic`; start music in `handleBeginExperience`; suspend and resume in the visibility handler; route the SOUND toggle; reset in `handleResetPrototype`; add `data-music-*` |
| `PERFORMANCE_BUDGET.md` | add a "Decoded audio: 48 MiB typical / 64 MiB hard" line |
| `ASSETS.md` | record the music assets: Orbital Foundry CC0, DaemonV12 version, manifest hashes |

---

## 8. Part A — DaemonV12 composition deliverables (Astra)

**Workspace:** an MCP root containing `assets/orbital-foundry/` (the complete pack copied from DaemonV12 `examples/assets/orbital-foundry/`, hashes checked against `examples/orbital-foundry.catalog.json`). Use only the nine existing MCP tools. Validate with zero diagnostics before every render.

### 8.1 Loop projects

`stm-loop-bed.json`, `stm-loop-engine.json`, `stm-loop-pressure.json`, `stm-loop-assault.json`, `stm-loop-claim.json`.

```json
{ "formatVersion": 1, "title": "STM loop — <ID>", "bpm": 100, "timeSignature": "4/4", "key": "D minor",
  "bars": 48, "seed": <fixed>,
  "render": { "duration": { "bars": 48 }, "tail": "none" },
  "master": { "gainDb": <calibration>, "effects": [ { "type": "highpass", "frequencyHz": 30 } ] } }
```

1. ≤ 15 tracks. Author one 16-bar cycle (one 16-bar pattern, or phrase patterns) and place the **identical clip layout at bars 1, 17 and 33**. Automation, if used, is repeated per cycle at absolute positions.
2. No master compressor, limiter or ducking.
3. Each sound must be shorter than 8 s including reverb or delay decay (the drone and air are 8 s gestures: fine).
4. Seam: P4 (A) resolves to P1 (D). No crash or boom on 1:1. No total silence at 16:4 in bed, engine, pressure or claim. Pickups may cross the seam.
5. Obey the pitch contract (section 3.6) and these layer recipes (bible section 7):
   - **bed:** `10-dark-drone` and `11-air-texture` gestures overlapping at irregular 6–7.2 s spacing, one crossing the seam; GM `pad_3_polysynth` or `synth_strings_1` D pedal plus phrase dyad, 2-bar sustains; no percussion.
   - **engine** (mono): tracks centered, no reverb. `machine-tick` clockwork (velocity 0.30–0.55); sparse `sub-pulse`; `mechanical-kick` ≤ 0.5 on beat 1 of alternate bars; GM `synth_bass_1` short D pulses interlocked with the kicks.
   - **pressure** (mono): GM `pad_6_metallic` (high-pass 520 Hz, low-pass 6.2 kHz) playing the collapse cells; `sub-pulse` heartbeat in Vesper's beacon rhythm (two pulses an eighth apart, 3-beat cycle, five cycles plus one silent beat per phrase); a low semitone grind.
   - **assault** (mono):
     - kick + snare (saturation 6 dB / 0.35, compressor −18 dB 3:1);
     - syncopated sub;
     - GM `synth_bass_2` or `lead_8_bass_lead` octave riff (saturation ≈ 12 dB / 0.6);
     - optional `distortion_guitar` doubling 12 dB under it, never exposed;
     - steel dotted-quarter polyrhythm in P3;
     - booms only at 5:1 and 13:1;
     - phrase plan: half-time P1 → drive P2 → double-time P3 with a full stop at 12:4 → re-launch P4 → ordinary fill into the seam.
   - **claim:** GM `lead_1_square` (high-pass 260 Hz, low-pass 2.7 kHz, delay 150 ms / 0.18) playing D–A–E–F over B♭ lydian in P2 and D–A–E in P4; GM `string_ensemble_1` (reverb 0.7 / 1.8 s / 0.25) for open D, B♭(add9 ♯11), G sus, A sus4; `low-boom` at 9:1 only; soft half-time kick in P3–P4.
6. Calibrate track gains and master gain so the cycle-2 crop meets the unity targets (section 2.1).

### 8.2 Stinger projects

`stm-sting-<id>.json`, with `bars` = stinger length and `render: {"duration":{"bars":N},"tail":"none"}`.

- **`vesper-arrival`:** `pad_6_metallic` E♭5–D5–A4–A♭4 at 1:1, 1:2, 1:3, 1:3+3/16 + `metallic-strike` 1:1 + two `sub-pulse` beacon hits; decays in bar 2.
- **`first-strike`:**
  - `08-tension-riser` at 1:1 (ends 4.0 s);
  - nothing in 4.0–4.6 s;
  - at `2:4+1/6`: `07-cinematic-impact` (velocity ≈ 0.95) + `low-boom` + `mechanical-kick` + GM D3 A3 E♭4 field;
  - spaced steel and tick debris;
  - silent by 12.0 s.
- **`vesper-retaliation`:** A♭–A–D–E♭ sixteenths from 1:1 over `metallic-strike` + a low grind.
- **`divider-contact`:** `12-alarm-energy-pulse` at 1:1 + kick and ticks accenting 1:1, 1:2+1/8, 1:4 (3+3+2).
- **`outcome-hold`:** `lead_1_square` D–A (no third) + bright `metallic-strike` + soft `low-boom`.
- **`outcome-breach`:** `07-cinematic-impact` velocity ≈ 0.45 + `pad_6_metallic` cluster D–E♭–A♭ at 1:1 + `low-boom` at `1:1+1/16`; arrhythmic decay.
- **`territory-claimed`:** `low-boom` + strings arrival at 1:1; `lead_1_square` + strings D–A–E–**F♯** with F♯ at `2:3`; D(add9) bloom with `11-air-texture`; silent by 9.6 s.

### 8.3 Render and report

1. Render each project with `daemonv12_render` (`stems: true`, `format: "wav"`), then run `daemonv12_analyze`.
2. Deliver the project JSONs, render manifests and analysis JSONs to `music/source/`. Canonical WAVs go to an archive outside git, with SHA-256 values in `music/source/README.md`.
3. Report:
   - per-track, per-phrase pitch classes (contract self-check);
   - unity measurements;
   - any deviation and the weakest moments to audition first.

---

## 9. Part B — asset build (`scripts/music/build-web-music.mjs`)

> **Implemented.** Commands: `npm run music:validate`, `music:build`, `music:auditions`, `music:fixtures`, `music:test`. Usage, thresholds and the manifest schema are in [ADAPTIVE_MUSIC_ASSET_PIPELINE.md](ADAPTIVE_MUSIC_ASSET_PIPELINE.md). The manifest is written to `<output>/manifest.json` (`public/music/manifest.json`) by default; `--manifest src/audio/music/musicManifest.json` selects the location in 9.4.

### 9.1 Per loop

1. Assert RIFF PCM16, 44,100 Hz, 2 ch, **5,080,320 frames**, and a SHA-256 equal to the render manifest.
2. **Periodicity:**
   - max |cycle 2 − cycle 3| ≤ 1 LSB, comparing frames [1,693,440, 3,386,880) and [3,386,880, 5,080,320);
   - pre-guard [1,684,620, 1,693,440) ≡ [3,378,060, 3,386,880) within 1 LSB.
   - Any failure stops the build, reporting each track's maximum delta.
3. Crop the canonical loop [1,693,440, 3,386,880) (1,693,440 frames), hash it and archive it.
4. Measure the crop: FFmpeg `ebur128=peak=true` gives integrated LUFS and true peak. Check against section 2.1.
5. **Mono layers:**
   - L/R correlation ≥ 0.90 and fold-down loudness change ≤ 1 LU;
   - fold (L+R)/2 → round to PCM16, no dither;
   - otherwise stop and report (the composer fixes the patch, or the layer ships stereo after a memory re-check).
6. Guarded source = frames [1,684,620, 3,395,700) (**1,711,080 frames**).
7. Encode:
   ```sh
   ffmpeg -hide_banner -i in.wav -map_metadata -1 -c:a libmp3lame -ar 44100 -ac 2 -b:a 160k out.mp3
   # mono files: -ac 1 -b:a 96k
   ```
8. Decode check: FFmpeg-decoded frames ∈ [1,711,080, 1,711,080 + 3,000].
9. Name `public/music/<id>.<first 10 hex of sha256>.mp3`.

### 9.2 Per stinger

1. Assert frames = bars × 105,840.
2. Last 100 ms ≤ −60 dBFS RMS.
3. True peak ≤ ceiling.
4. Mono fold as above (where mono).
5. Guard with 8,820 zero frames on each side.
6. Encode as above.

### 9.3 Combination audit (measured, not arithmetic)

1. Sum the canonical crops at each cue's gains (section 3.4, after modifiers), plus each allowed stinger at 16 evenly spaced loop offsets.
2. Every true peak must be ≤ −2 dBTP. Report integrated LUFS per cue.
3. Optional: render the same sums inside DaemonV12 as a sampler project of the crops, for native analysis and provenance.

### 9.4 Manifest

Write `src/audio/music/musicManifest.json`:

```json
{ "schema": 1, "bpm": 100, "beatsPerBar": 4, "loopBars": 16, "loopSeconds": 38.4, "guardSeconds": 0.2,
  "canonicalSampleRate": 44100, "daemonv12": { "engineVersion": "0.5.0", "commit": "<sha>" },
  "loops": [ { "id": "bed", "url": "/music/bed.<sha10>.mp3", "sha256": "…", "channels": 2, "bitrateKbps": 160,
      "canonical": { "project": "music/source/daemonv12/stm-loop-bed.json", "renderManifestSha256": "…",
                     "renderWavSha256": "…", "loopWavSha256": "…", "frames": 1693440 },
      "periodicity": { "maxAbsDeltaLsb": 0 }, "unity": { "integratedLufs": -26.0, "truePeakDbtp": -14.5 },
      "foldDown": null } ],
  "stingers": [ { "id": "first-strike", "url": "…", "sha256": "…", "channels": 2, "bars": 5,
      "contentSeconds": 12.0, "syncSeconds": 4.6, "timing": "exact", "priority": 100,
      "duck": "vacuum", "unity": { "truePeakDbtp": -2.3 } } ] }
```

### 9.5 Placeholder package

Before composition lands, generate synthetic assets of the exact lengths: each loop is a different tone with a click on every bar line, and each stinger is a click at its sync point. This exercises the build, manifest, decoding, phase-lock (clicks must not flam) and scheduling end to end.

---

## 10. Runtime deliverables

1. **Shared AudioEngine.** `useCinematicAudio` keeps its cue API.
2. **The director:** derivation, mix, transitions, stingers, ducks, dwell and rotation, lifecycle and modes.
3. **Loader and residency:**
   - Nothing is fetched before BEGIN / CONTINUE.
   - bed (first, to set the epoch) + engine at start;
   - pressure, assault, `vesper-arrival`, `vesper-retaliation`, `divider-contact`, `outcome-hold` and `outcome-breach` as soon as `extractorActive` (the reveal follows 2.2 s later; a siege becomes possible) or the rival is past DORMANT;
   - `first-strike` from READY;
   - claim + `territory-claimed` once monuments unlock.
   - Nothing is released within a session.
   - Peak resident: 21.3 / 38.9 / 43.5 / 61.4 MiB at 48 kHz.
4. **App wiring** and `data-music-*` attributes.
5. **SFX re-level:** raise `sfxBus` ≈ 9–12 dB from the current 0.16 master equivalent, validated by measurement (acceptance criterion G).

---

## 11. Tests

Vitest (`src/**/*.test.ts`):

| File | Asserts |
|---|---|
| `musicClock.test.ts` | BEAT, BAR and PHRASE boundaries with lookahead; frame rounding; late-join offset = `0.2 + mod(t − epoch, 38.4)`; loop and guard are integer frames at 8 / 11.025 / 16 / 22.05 / 24 / 32 / 44.1 / 48 / 88.2 / 96 kHz; A(perfMs) with and without `getOutputTimestamp` |
| `musicManifest.test.ts` | every loop is 1,693,440 canonical frames with identical bpm, bars and guard; channels and bitrates per section 2; stinger bars and sync; every URL exists under `public/music/` and its SHA-256 matches; periodicity ≤ 1 LSB recorded; unity values within targets |
| `musicState.arc.test.ts` | each arc from reducer-built fixtures, including **claimed while Vesper stands** and the restored TRACK COUNTERSTRIKE state |
| `musicState.cue.test.ts` | every `counterstrikeRun.status`, rival phase and strike phase; siege status × {landed, orbit, monument view} × {presentations idle, busy}; monument status × view; confirmation dialog; scar; reveal; terminal states (`resolved`, `operational`, `damaged`, `complete`) map to calm cues |
| `musicMix.test.ts` | modifiers and order; invariants I1–I3 for every cue × modifier combination; H2 for every allowed (cue, stinger) pair with ducks and wave gains; H3 envelopes for every ordered cue pair with sequenced rises (sample 200 points; all ≤ −1 dBFS) |
| `musicEvents.test.ts` | each edge fires exactly once; identical snapshots fire nothing; the baseline fires nothing (restoring a `CLAIMED` save does not fire `territory-claimed`); replays fire; reset clears pending events |
| `musicDirector.test.ts` (fake context) | (a) no context or source before unlock; (b) start creates exactly 5 sources, `loop`, `loopStart` 0.2, `loopEnd` 38.6, one shared `when`, offset 0.2; (c) StrictMode-style double start or update creates no duplicates; (d) each transition class scheduled at the right boundary with the right ramp; (e) First Strike: with nominal phase starts, stinger +10.2 s, vacuum ending +14.2 s and breath +19.5 s from arming; a late or hidden-shifted phase start moves every unstarted step by the same amount; cancelled by idle or reset; (f) breach sync = phase start + 1.5 s; every EXACT time includes `SYNC_VISUAL_OFFSET_MS`; (g) stinger priority, preemption, ≤ 2 concurrent, same-ID ignore; (h) suspend and resume: `context.suspend` / `resume` called; new baseline; a stinger paused mid-riser restarts at its re-anchored offset; one past its sync point is stopped, not replayed; unstarted EXACT steps rescheduled; (i) SOUND OFF fades and suspends, ON resumes to current targets with the same stinger rule; (j) reset stops every source, clears schedules, keeps buffers, and the next start uses a new epoch; (k) `dry` mode never fetches or decodes; `disabled` does nothing |
| `musicDwell.test.ts` | dwell after 2 phrases; rotation pattern N N N T N N N T R aligned to bar 9; rests cancelled by non-calm cues |
| `buildMusicSnapshot.test.ts` | the App snapshot builder from fixture state |

Playwright `e2e/adaptive-music.spec.ts` (harness build, `?e2e`, `dry` mode):
- `data-music-status` is `idle` before BEGIN and active after it.
- Using the existing fixtures (`e2e/rivalFixtures.ts`, `e2e/firstStrikeFixtures.ts`), assert `data-music-arc` and `data-music-cue` through:
  - RECON → FOOTHOLD → FOOTHOLD_WORKS;
  - the reveal phases → CONTESTED;
  - the FS cues → CS cues → ASCENDANT;
  - siege cues (orbital-siege flow);
  - monument cues → CLAIMED.
- `data-music-stingers` increments once per event.
- Hidden tab → `suspended`; visible → resumes.
- NEW GAME → `stopped`, then the gate.
- Production smoke: **no request to `/music/` before BEGIN**; after BEGIN with SOUND ON, bed and engine are requested.

---

## 12. Acceptance criteria

| | Criterion |
|---|---|
| **A. Exactness** | 5 loops × 1,693,440 canonical frames; periodicity ≤ 1 LSB; guarded MP3s decode within tolerance; manifest hashes verified |
| **B. Levels** | loop unity within ±1 LU and under TP ceilings; stinger TP ceilings met; stinger tails silent |
| **C. Headroom** | H1–H3 unit tests pass; combination audit true peak ≤ −2 dBTP everywhere |
| **D. Harmony** | pitch-contract report clean; no F♯ / B♮ / C♯ in loops; the alarm only in `divider-contact`; F♯ only in `territory-claimed` |
| **E. Sync** | in Chrome, decoded loop region = 38.4 s × context rate exactly; placeholder clicks never flam after 10 minutes; First Strike impact audibly on the flash; claim stinger on reveal start; `SYNC_VISUAL_OFFSET_MS` tuned on desktop and on the reference phone, with the value recorded |
| **F. Behavior** | mappings per section 3; combat always releases when reducers reach terminal states; dwell works; no audio before BEGIN; hidden suspends; SOUND toggle works; NEW GAME stops cleanly and restarts on BEGIN; restored sessions fire no past stingers |
| **G. Mix** | SFX re-leveled; alert duck active; impact and alert SFX peak ≥ 6 dB above the music's short-term level at the same moment |
| **H. Memory** | decoded audio ≤ 64 MiB (≈ 61.4 MiB expected at 48 kHz); no growth across 5 NEW GAME cycles; tab footprint measured on the reference phone and recorded in `PERFORMANCE_BUDGET.md` |
| **I. Gates** | `npm run check` passes; the full e2e suite passes; capture output unchanged (harness `dry`) |
| **J. Listening** | one documented playthrough, fresh → claimed, noting seams, clashes, fatigue and stinger timing |

---

## 13. Implementation order

1. **(Codex)** Shared AudioEngine refactor with no audible change, plus tests.
2. **(Codex)** Pure state, mix, events and invariants with unit tests; App snapshot builder and `data-music-*` in `dry` mode; the e2e `dry` spec. **This locks the contract Astra composes against.**
3. **(Codex)** Clock and director against the fake context; lifecycle, visibility, toggle and reset.
4. **(Codex)** `build-web-music.mjs`, manifest and placeholder package; the real decode and playback path in the browser (acceptance criterion E with clicks).
5. **(Astra, from step 2)** Package 1 projects → renders → report (Part A).
6. **(Codex)** Build web assets from the canonical renders; replace placeholders; acceptance criteria A–D.
7. **(Codex)** SFX re-level and alert duck; memory on device; listening pass; acceptance criteria F–J.
8. **Package 2 (later):**
   - per-monument `claimed-*` variants: Helios weight at +4.2 s, Signal Array ticks at 1.95–2.75 s, Crown debris quote, Bastion walls;
   - optional `divider-final`;
   - optional riff kit;
   - MUSIC / SFX volume controls.
