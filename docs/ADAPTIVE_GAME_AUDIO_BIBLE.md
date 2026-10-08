# SHOOT THE MOON — ADAPTIVE GAME AUDIO BIBLE

**Status:** design only. No music has been composed or rendered, no game audio code has changed, and DaemonV12 has not been modified.
**Scope:** the in-game adaptive soundtrack for the browser game: what plays, when, why, how it is authored in DaemonV12 V0.5, and how the browser plays it.
**Roles:** Opus designs (this document). Astra composes and renders through DaemonV12 V0.5 MCP. Codex builds the web assets and the runtime.
**Implementation contract:** [ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md](ADAPTIVE_GAME_AUDIO_IMPLEMENTATION_HANDOFF.md). It repeats only what is needed to build. **Where the two differ, the handoff wins.**
**Related:** [YOUTUBE_SCORE_BIBLE.md](YOUTUBE_SCORE_BIBLE.md) (the narrated film score). The game soundtrack inherits that score's language; it does not reuse its cues.

Notation:
- **Positions** use DaemonV12 grammar, `BAR:BEAT+fraction` (whole-note fractions). At 100 BPM one beat is 0.6 s, one bar 2.4 s, one phrase (4 bars) 9.6 s, one loop (16 bars) 38.4 s.
- **P1–P4** are the four 4-bar phrases of the 16-bar loop (bars 1–4, 5–8, 9–12, 13–16).
- **Epoch** is the AudioContext time at which loop position 0 (bar 1 beat 1) plays. All quantization is measured from it.
- Gains are in dB relative to each layer's **unity** level (section 15). `off` means the layer's gain node is at −60 dB, then 0.
- "**Current**" describes code as it exists at the audited commit. "**Proposed**" describes this design.

---

## 0. Audit basis

| Source | Revision | Read for |
|---|---|---|
| shootthemoon `adaptive-game-audio-audit` | `cc8104f` | everything below |
| `README.md`, `ARCHITECTURE.md`, `PLAN.md`, `PERFORMANCE_BUDGET.md`, `ASSETS.md`, `VISUAL_DIRECTION.md` | same | product scope, state separation, budgets, asset provenance |
| `docs/YOUTUBE_SCORE_BIBLE.md`, `docs/YOUTUBE_SCORE_ASTRA_HANDOFF.md` | same | the D-minor / Claim identity, V0.5 usage precedent |
| `src/App.tsx` (2,207 lines) | same | the real orchestration: every reducer, presentation clock, timer, audio cue, visibility rule and reset path |
| `src/simulation/*`, `src/domain/*`, `src/content/*` | same | outpost, operations, rival, First Strike, Counterstrike, Orbital Siege, Territory Monuments, Octogonals |
| `src/app/*Presentation.ts`, `src/app/*Hud.tsx` | same | presentation phases, durations, what the player reads and decides |
| `src/audio/useCinematicAudio.ts` | same | the existing synthesized SFX layer |
| `src/persistence/outpostSave.ts` | same | what survives refresh and how transient states normalize |
| `src/scene/heliosReactorModel.ts`, `signalArrayModel.ts`, `craterCrownModel.ts`, `TerritoryMonument.tsx`, `interceptorFlight.ts` | same | monument reveal choreography, Divider attack timing |
| `src/camera/CinematicClock.tsx`, `src/render/quality.ts` | same | journey durations, device tiers |
| `e2e/*.spec.ts`, `capture/*` | same | real campaign flows; the capture pipeline runs with `--mute-audio` |
| DaemonV12 `main` | `e84a62e` (engine 0.5.0) | `docs/V0_5_TIMELINE_DYNAMICS.md`, `V0_3_AUDIO.md`, `V0_2_SAMPLES.md`, `ROADMAP.md`, `src/timing/render-plan.ts`, `src/render/fluidsynth.ts`, `src/project/validate.ts`, `src/project/gm-programs.ts`, Orbital Foundry README and catalog, `examples/shoot-the-moon-locked-score.json`, `examples/v05-loop-demo.json`, `reports/shoot-the-moon/REPORT.md` |

**Implementation over plans.** `PLAN.md` still describes the First Strike-era product boundary ("Explicitly excluded are … combat … territory systems"). The code has moved far past it: Outpost Operations, a Command Phase, Counterstrike, Orbital Siege, Octogonal wave defense and Territory Monuments are implemented and tested. This design follows the code.

All arithmetic in this document (frame counts, memory, file sizes, loudness sums, peak sums, crossfade envelopes) was computed by script and is repeated in the verification record (section 24).

---

## 1. Executive concept

**The Moon has one engine room, and the soundtrack is its sound.** Five synchronized layers in D, at 100 BPM, run on a single 38.4-second clock from the moment the player presses BEGIN until they reset. Gameplay never starts or stops a track. It opens and closes valves: the outpost's industry, Vesper's pressure, the war machine, and finally the claim. Seven one-shot stingers mark the moments that deserve punctuation, and the existing synthesized effects keep everything physical.

Five rules carry the design:

1. **One clock, never restarted.** Every looping layer has exactly 1,693,440 frames at 44.1 kHz. All layers start together, stay phase-locked for the whole session, and change only by gain. Transitions are quantized to beat, bar or phrase of that one clock.
2. **Identity by ownership.** The player owns the Claim motif (D–A–E–F) and the machine's kick cell. Commander Vesper owns the semitone collapse (E♭–D–A–A♭) and her beacon's two-pulse rhythm. The Octogonals own the D/A♭ tritone alarm and the 3+3+2 cell. A faction is heard only when that faction acts.
3. **From darkness to dominion.** Harmony brightens with the campaign: Phrygian and Locrian colors for conflict, open fifths for the foothold, B♭-lydian and suspended colors for the claim. The major third F♯ is spent once, when the territory is claimed.
4. **Combat is bigger by arrangement.** The war-machine layer adds density, low-end weight and register. Combat is about 6 LU louder than calm because more is playing, not because anything is pushed into a ceiling. Every reachable combination stays under the same peak ceiling.
5. **Silence is a state.** The First Strike's vacuum, transmission pull-backs, breaths after impacts, and rests in long calm stretches are part of the score.

---

## 2. The game as audited

### 2.1 Clocks, ownership and pausing (current)

| Fact | Where | Consequence for music |
|---|---|---|
| Persistent facts live in pure reducers: `moonCoreReducer`, `outpostReducer`, `rivalSignalReducer`, `firstStrikeReducer`, `counterstrikeFactsReducer` | `src/simulation/*`, wired in `App.tsx` 239–262 | Music state must be **derived** from these snapshots, never stored separately. |
| Transient presentations run on `performance.now()` with fixed phase durations: rival reveal, First Strike, Counterstrike run, monument reveal | `rivalPresentation.ts`, `firstStrikePresentation.ts`, `counterstrikeSimulation.ts`, `App.tsx` 1083–1380 | Their future event times are known in advance and can be scheduled exactly. |
| Simulation time is `Date.now()` (`simulationNowMs`), ticked every 80 ms (transient work) or 400 ms (production) only while the surface or monument view is open | `App.tsx` 832–882 | Siege and monument progress are observed with up to ~80 ms latency. |
| Siege and monument advance **only** while `phase === 'landed'` or the monument view is open, and only while no rival/strike/counterstrike presentation runs; otherwise the tick calls `resumeSurface` | `App.tsx` 832–882, `outpostSimulation.ts` 635 | A siege left behind in orbit is frozen, not fighting. Music must not treat it as combat. |
| Tab hidden: presentation clocks stop (start times shifted by the hidden duration on return), counterstrike clock shifted, simulation ticks gated, `audio.stopAll()` | `App.tsx` 365–415 | Music must pause with the game: suspend the AudioContext, resume on return, re-derive scheduled events. |
| Restore normalizes transient states (robot → idle, interrupted launch → ARMED, rival CINEMATIC → QUEUED); siege and monument snapshots are persisted and resume | `outpostSave.ts` 448–523, `rivalSimulation.ts` 109, `firstStrikeSimulation.ts` 107 | A restored session starts directly in its derived state with **no** stingers for past events. |
| Audio exists only as synthesized SFX behind a user gesture, master gain 0.16, toggled by SOUND ON/OFF (suspend/resume), closed on NEW GAME | `src/audio/useCinematicAudio.ts` | One AudioContext must be shared by music and SFX. Reset semantics must change (section 16). |
| `entryOpen` launch gate; BEGIN / CONTINUE calls `audio.unlock()` | `App.tsx` 1778–1794 | This tap is the only guaranteed user activation before play. Music starts here. |
| Capture/reel pipeline runs Chromium with `--mute-audio` | `capture/playwright.capture.config.ts` 55 | Music must not affect capture determinism; it must be disableable by query flag. |

### 2.2 The campaign as it actually plays

Canonical path, with real timers:

1. **Launch gate** → BEGIN INVASION.
2. **Orbital reconnaissance**: select a site, CLAIM, 6.2 s descent (`APPROACH_DURATION_SECONDS`, `CinematicClock.tsx` 18).
3. **First Outpost**: deploy the miner (1.7 s), mine (travel ≥ 1.05 s, mining 2.8 s, return, unload 0.7 s), two cargo returns reach the 60-ore extractor cost, extractor construction 2.6 s.
4. **The extractor wakes Vesper.** Activation queues the rival reveal (`queueReveal`, `rivalSimulation.ts` 128) and it begins 2.2 s later (`App.tsx` 1013). The reveal forces a return to orbit and runs 26.3 s: warning 2.6, orbital transition 5.8, capsule approach 4.8, impact 2.6, intro transmission 7.0 (skippable with IGNORE HER), dual sites 3.5.
5. **Contested orbit**: focus and scan Null Meridian (focus 2.6 s, waiting panel, scanning 4.0 s ÷ scan speed, response transmission 8.0 s, contested card 4.0 s). First Strike becomes READY.
6. **First Strike**: ARM → confirmation dialog → FIRE → a fixed 26.1 s cinematic (arming 2.4, launch 3.2, orbital flight 3.8, Vesper transmission 3.2, target approach 2.2, impact flash 1.3, ejecta 3.4, crater reveal 2.6, orbital pull-back 4.0) → FIRST STRIKE COMPLETE · THE MOON REMEMBERS.
7. **Counterstrike** auto-begins 3.6 s later (`COUNTERSTRIKE_ENDING_HOLD_MS`, `App.tsx` 186, 1238–1273): one order under a 5 s visible countdown (auto HARDEN OUTPOST), confirmation 1.05 s, warning 3.2 s, tracking 5.8 s (5.32 s prioritized), FIRE NOW window 2.4 s (3.36 s prioritized), interceptor flight, success 6.4 s or miss 1.8 s and a second attempt, impact 4.4 s with contact at 1.5 s. Maximum automatic run: 29.61 s (`COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS`).
8. **Outcome accepted**: outpost secure, or damaged at −30% (−15% if hardened) until a Repair Gantry recovers it.
9. **Territory Monuments** unlock (`monumentsUnlocked`: siege operational **or** First Strike complete) and the panel auto-opens once per session when safe (`App.tsx` 1353–1364). **One monument per campaign.**
10. **Monument**: 4 s foundation, then three Octogonal waves (PLUMB LINE 6 s, RIGHT OF WAY 7 s, FINAL NOTICE 8 s), each started only by the player's order; the command state between waves **waits indefinitely**. Then activating (remaining labor), damaged (repair 30 s work) or complete → a 6 s orbital reveal → TERRITORY CLAIMED · PERMANENT.
11. **Claimed Moon**: the game continues indefinitely (operations, revisits, replays).

**Branches that matter to music:**
- **Orbital Siege is available any time after the extractor** (`canStartOrbitalSiege`: active extractor, idle miner, 60 ore, ≥ 8 kW). It needs neither the rival nor the First Strike. An operational platform unlocks monuments, so a player can **claim the Moon while Vesper's foothold still stands** and fire the First Strike afterwards.
- **Replays** (REVIEW SIGNAL, REPLAY STRIKE, REPLAY COUNTERSTRIKE with accept/keep, paid REPLAY ORBITAL SIEGE, REPLAY ORBITAL REVEAL) re-run set pieces without rewriting campaign facts.
- **Failures** are recoverable everywhere: counterstrike damage (Repair Gantry), siege breach (repair 15 s), monument damage (repair 30 s).

### 2.3 State and event audit

Columns: **Det.** = deterministic timing once started. **Rep.** = can repeat. **Urg.** = urgency (L/M/H/X = low/medium/high/maximum). Music cue and stinger IDs are defined in sections 4 and 8.

| # | State / event (code name) | Source | Condition / trigger | Starts → ends | Overlap | Det. | Rep. | Duration | Urg. | Musical consequence |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | Launch gate `entryOpen` | `App.tsx` 278, `LaunchGate.tsx` | first load; after NEW GAME | load → BEGIN/CONTINUE (`handleBeginExperience`) | exclusive | — | after each reset | player | L | `SILENT`. The tap unlocks audio and starts the music clock. |
| 2 | Orbital reconnaissance (`phase` orbit/selected, outpost `null`) | `moonCoreReducer` | no outpost | BEGIN → CLAIM | — | — | once per campaign | 10–60 s | L | `RECON` (bed only). |
| 3 | Descent / return journeys (`phase` approach/returning) | `CinematicClock.tsx` 18–19 | CLAIM, revisit, return | 6.2 s / 2.4 s | with any arc | yes | many | 6.2 / 2.4 s | L | View tilt only (ENGINE −4 dB in orbit); no stinger. Touchdown is SFX. |
| 4 | Outpost established | `handleLandingComplete` → `establish` | first landing | approach end | — | yes | once | instant | M | `RECON` → `FOOTHOLD` at the next phrase. |
| 5 | Robot cycle `robot.state` stored → deploying → idle → traveling → mining → returning → unloading | `advanceRobot`, `getRobotStateDurationMs` (`outpostSimulation.ts` 290, 530) | DEPLOY / MINE commands | 1.7 / ≥1.05 / 2.8 / ≥1.05 / 0.7 s | under any calm state | yes | many | ~6–10 s per trip | L | **SFX only** (existing `capsule`, `miner`, `drill`, `ui-confirm`). |
| 6 | Extractor construction → `stage 'extractor-active'` | `constructExtractor` 389, `advanceExtractor` 555 | 60 ore, idle miner | +2.6 s | — | yes | once | 2.6 s | M | ENGINE enters (`FOOTHOLD_WORKS`) at the next bar. This is also the trigger for Vesper. |
| 7 | Rival queued `revealStatus` QUEUED / AWAITING_SAFE_MOMENT | `queueReveal` 128, `App.tsx` 909–1022 | extractor active, rival DORMANT | 2.2 s later on the surface, or on the next orbit for restored sessions | — | yes | once | 2.2 s (or until orbit) | M | No stinger; the reveal itself is the event. "Signal held" sessions stay `FOOTHOLD_WORKS`. |
| 8 | Rival reveal `rivalPresentation` warning → orbital-transition → capsule-approach → impact → intro-transmission → dual-sites | `RIVAL_PRESENTATION_DURATIONS_MS` | QUEUED and idle | 26.3 s (≥ 19.3 s if the transmission is skipped) | exclusive; forces orbit; locks camera | yes | REVIEW SIGNAL replay | 26.3 s | H | `vesper-arrival` on warning; `REVEAL_*` cues per phase; arc becomes `CONTESTED`. Capsule landing impact is SFX. |
| 9 | Rival focus / scan: rival-focus → rival-focused → scanning → scan-response → contested | same | REVEALED rival, orbit, idle | 2.6 s / waits / 4.0 s ÷ scan speed / 8.0 s (skippable) / 4.0 s | exclusive | mostly | focus repeatable; scan once | ~20 s | M | `RIVAL_FOCUS`, `RIVAL_TRANSMISSION`; the waiting panel decays after 2 phrases. |
| 10 | Lunar control CONTESTED (`scanResponseCompleted`) | `data-lunar-control`, `App.tsx` 2020–2026 | — | persistent | — | — | — | minutes | L | Arc `CONTESTED`: PRESSURE as a low undertow. |
| 11 | Rival stage FORTIFIED | `fortifyRivalSignal` 265 | test/dev only | — | — | — | never in play | — | — | No treatment. |
| 12 | First Strike READY / ARMED and confirmation dialog | `unlock`, `arm`, `strikeConfirmationOpen` | scan response done | until FIRE / CANCEL | — | — | once | indefinite | M | Dialog open → `STRIKE_DECISION` (heartbeat), decays after 2 phrases. |
| 13 | First Strike cinematic arming → … → orbital-pullback | `FIRST_STRIKE_PRESENTATION_DURATIONS_MS` | FIRE (ARMED → LAUNCHING) | 26.1 s | exclusive; forces orbit | **yes**: impact at +14.8 s nominal, anchored per phase | REPLAY STRIKE | 26.1 s | X | `FS_FLIGHT`, `FS_TRANSMISSION`, exact vacuum 0.6 s before impact, `first-strike` stinger (impact on the flash), `FS_BREATH`. |
| 14 | Strike `ending` / `scar-explore` | `FirstStrikeHud.tsx` | after pull-back | ending: 3.6 s until the Counterstrike auto-begins; scar: player | — | yes | — | 3.6 s / any | M / L | `FS_BREATH` continues; scar exploration drops ENGINE (we are at Vesper's ruin). |
| 15 | Retaliation pending: counterstrike available, not accepted, run `dormant` ("SHE ANSWERED · TRACK COUNTERSTRIKE") | `canUnlockCounterstrike`, `CounterstrikeHud.tsx` 252–264 | restored sessions (live play auto-begins) | until TRACK | — | — | once | indefinite | M | Arc `RETALIATION`: PRESSURE raised. |
| 16 | Counterstrike `command` | `CommandPanel`, `ORDER_COUNTDOWN_MS` | auto-begin or TRACK; replay | order or 5 s visible auto-HARDEN | exclusive | yes | REPLAY COUNTERSTRIKE | ≤ 5 s | H | `CS_ALERT` + `vesper-retaliation`. |
| 17 | `command-confirmed` → `warning` | `COUNTERSTRIKE_TIMING` | order | 1.05 s + 3.2 s | — | yes | — | 4.25 s | H | `CS_WARNING`: the war machine rises at the next bar. |
| 18 | `tracking` → `intercept-ready` → `interceptor-launched` → `missed` → attempt 2 | `advanceRun`, `fireInterceptor` | — | 5.8 / 2.4 / ≤4.6 or 2.4 / 1.8 s per attempt | — | yes; judgement from the tap | 2 attempts | ~10–20 s | X | `CS_COMBAT`. FIRE NOW is a gameplay alert (SFX) and briefly ducks the music. |
| 19 | `success` | `contact` action | valid shot contacts | 6.4 s → resolved | — | yes | — | 6.4 s | relief | `CS_SUCCESS` + `outcome-hold`. |
| 20 | `impact` (contact at 1.5 s) | `advanceRun` | two misses | 4.4 s → resolved | — | yes | — | 4.4 s | X | `CS_IMPACT` + `outcome-breach` exactly at contact. |
| 21 | Outcome accepted `acceptedOutcome`, `outpostDamageState` | `acceptOutcome` (`App.tsx` 1331–1351) | resolved, not replay | persistent | — | — | replay may replace | — | — | Arc `ASCENDANT`; damage modifier while DAMAGED. |
| 22 | Damage and Repair Gantry recovery | `REPAIR_GANTRY_RECOVERY_DURATION_MS` 12 s, `completeRepairs` | FAILURE, gantry built | until progress 1 | under calm | yes | once | ≥ 12 s at full power | L | ENGINE −3 dB; Vesper's PRESSURE lingers at −14 dB until repaired. |
| 23 | Operations: modes, module slot, storage, energy | `outpostOperations.ts` | extractor active | persistent | under calm | yes | — | minutes | L | Arc calm cue; ENGINE grows by tier (module, siege operational). Optional mode tilt. |
| 24 | Orbital Siege `constructing` | `startOrbitalSiege`, `SIEGE_ALERT_MS` | 60 ore, ≥ 8 kW, idle miner | 0–6 s | — | yes | paid replay | 6 s | M | `SIEGE_BUILD`. |
| 25 | Siege `command` ("DIVIDER RAID DETECTED") | `SIEGE_COMMAND_END_MS` | — | 6–11 s (auto HARDEN) | — | yes | — | ≤ 5 s | H | `SIEGE_ALERT` + `divider-contact`. |
| 26 | Siege `waves`: hits at 18 / 26 / 34 s, defense windows 3.6 s before each | `SIEGE_WAVE_TIMES`, `platformDefenseView` | order (advances only while the surface or monument view is open) | to 34 s | — | yes | — | ≤ 28 s | X | `SIEGE_COMBAT` + `divider-contact` as each defense window opens. |
| 27 | Siege outcome `operational` / `damaged` | `advanceOrbitalSiege` 79–90 | health ≥ 40 / < 40 | at 34 s | — | yes | per replay | instant | relief / failure | `outcome-hold` / `outcome-breach`; back to the arc calm cue. |
| 28 | Siege `repairing` | `PLATFORM_REPAIR_MS` | damaged + REPAIR | 15 s | — | yes | — | 15 s | L | `SIEGE_REPAIR`; `outcome-hold` when operational. |
| 29 | Monument panel (choices) | `TerritoryMonumentHud.tsx`, `monumentView` | unlocked | while open | — | — | once-per-session auto-open | player | M | `MONUMENT_CHOICES`: the CLAIM layer previews. |
| 30 | Monument `constructing` | `MONUMENT_FOUNDATION_MS` | ore 80–100, ≥ 6 kW | 4 s | — | yes | one monument per campaign | 4 s | M | `MONUMENT_BUILD`. |
| 31 | Monument `command` (×3) | `advanceTerritoryMonument` 62 ("A command waits indefinitely") | foundation or wave end | until the player's order | — | — | ×3 | indefinite | H, decaying | `MONUMENT_ALERT` (+ `divider-contact` before wave 1); decays to `MONUMENT_ALERT_DWELL` after 2 phrases. |
| 32 | Monument `wave` (PLUMB LINE / RIGHT OF WAY / FINAL NOTICE) | `OCTOGONALS.waves` 6 / 7 / 8 s; attack run at strike − 1 s (`interceptorFlight.ts` 55–120) | order | 6–8 s | — | yes; shot timing is the player's | ×3 | 6–8 s | X | `MONUMENT_COMBAT` + `divider-contact` (louder each wave). |
| 33 | Monument `activating` | `complete` / `activating` branch | 3 waves, health ≥ 40, labor left | until labor done | — | yes | once | depends on builders and power | M | `MONUMENT_ACTIVATING` + `outcome-hold`. |
| 34 | Monument `damaged` / `repairing` | same | health < 40 | repair 30 s of work | — | yes | once | ≥ 15 s at full power | failure | `MONUMENT_DAMAGED` + `outcome-breach`. |
| 35 | Monument complete + reveal | `MONUMENT_REVEAL_MS` 6 s; `monumentRevealAtMs` (`App.tsx` 1366–1380) | complete, not yet seen, in view; REPLAY ORBITAL REVEAL | 6 s | exclusive | yes | replay | 6 s | X (payoff) | `territory-claimed` (the only F♯); `MONUMENT_REVEAL`; arc becomes `CLAIMED`. |
| 36 | Claimed Moon (`monument.status 'complete'`) | `data-territory-claimed` | — | persistent | — | — | — | indefinite | L | `CLAIMED`, with rotation and rests. |
| 37 | Helios mass-driver loop (12 s, launch at 7.9 s, up to 36 s) | `heliosReactorModel.ts` | Helios view | visual loop | — | yes | 3 cycles | 36 s | L | **SFX** (launch thump). Not music. |
| 38 | Tab hidden | `visibilitychange` | — | until visible | pauses everything | — | — | — | — | Suspend the context; resume and re-derive. |
| 39 | SOUND toggle | `useCinematicAudio.toggle` | tap | — | — | — | — | — | — | Fade the music bus 150 ms, then suspend. The game keeps running, so resume restores derived targets and restarts exact stingers that are still ahead; nothing past replays. |
| 40 | NEW GAME | `handleResetPrototype` 1806–1850 | confirmed | → gate | — | — | — | — | — | Fade out 0.5 s, stop, clear; next BEGIN starts a new epoch. |
| 41 | Refresh / CONTINUE | `deserializePrototypeSave` → `normalize*` | — | — | — | — | — | — | — | Start directly in the derived cue. No stingers for past events. |

### 2.4 Findings that shape the design

1. **The extractor summons Vesper.** The moment the base becomes an industry (extractor active), the rival reveal is queued and starts 2.2 s later. The industry layer (ENGINE) therefore enters seconds before Vesper's arrival. Her first line is "Remove your extractor from my Moon." The music makes that causal link audible.
2. **Exactly one monument per campaign** (`outpost.monument` is a single snapshot; the panel says "One monument. One territory."). Monuments cannot accumulate, so the clutter risk is avoided by construction.
3. **The third party is real and appears in two systems.** The Octogonals (eight-sided DIVIDER craft) attack the Orbital Siege platform (three waves) and the monument (three waves). Their identity must work in both and must never leak into Vesper's Counterstrike.
4. **Some tension states wait forever.** The monument command state, the strike confirmation dialog, the rival focus panel and the TRACK COUNTERSTRIKE prompt wait on the player. Music cannot hold full tension indefinitely, so dwell decay is required (section 4.7).
5. **Siege and monuments only advance in view.** A siege left in orbit is frozen. Combat music follows advancement, not mere existence.
6. **Set pieces have fixed durations, but their wall-clock times drift.**
   - Nominally, the First Strike impact is 14.8 s after FIRE and the rival lands 13.2 s after the warning.
   - Each presentation phase starts at `performance.now()` when the previous phase's timer fires (`App.tsx` 1150 for the strike), so real starts accumulate timer lateness. A hidden tab shifts only the current phase's start.
   - Exact sync therefore anchors each step on the phase it falls in (section 9).
   - The counterstrike contact is 1.5 s after `impact` begins, and the monument reveal is stamped once (`monumentRevealAtMs`). Each needs only one anchor.
   - None of this needs polling.
7. **Useful 100 BPM coincidences.** Return journey 2.4 s = 1 bar; strike arming 2.4 s = 1 bar; FIRE NOW window 2.4 s = 1 bar; miss 1.8 s = 3 beats; Vesper's beacon cycle 1.8 s = 3 beats; defense window 3.6 s = 6 beats; siege alert and monument reveal 6.0 s = 10 beats; Helios loop 12 s = 5 bars. Sequence starts are player taps and are not grid-aligned, so these help phrasing, not sync.
8. **The existing SFX are quiet and partly pitched.** A single voice peaks at most 0.48 × master 0.16 ≈ −22 dBFS, and even the densest cue (`impact`, three voices) stays below about −15 dBFS. Music at the targets in section 15 would bury them, so re-leveling the SFX bus is a required integration step. Most cues are glides and are harmonically neutral. `rival` (E4/E5 glides) collides with Vesper's E♭ motif.
9. **The reference phone is a 'low' tier device.** `navigator.deviceMemory` rounds down to a power of two, so a 6 GB Pixel 6a reports 4 and lands in the low tier of `detectQualitySettings()`. Decoded audio memory must be budgeted for it.
10. **The capture pipeline mutes audio** and drives fake clocks. Music must be switchable off for capture and must never feed back into game timing.

---

## 3. What is music and what is not

| Class | Contents | Rule |
|---|---|---|
| **A. Continuous synchronized layers** | BED, ENGINE, PRESSURE, ASSAULT, CLAIM | Always running once started; changed only by gain. |
| **B. Quantized transitions** | arc changes, entering and leaving tension and combat, set-piece steps, dwell decay, rotation and rests | Gain moves scheduled on beat, bar or phrase boundaries of the shared clock. |
| **C. One-shot stingers** | `vesper-arrival`, `first-strike`, `vesper-retaliation`, `divider-contact`, `outcome-hold`, `outcome-breach`, `territory-claimed` | Edge-triggered once per event; beat-quantized or exactly synced. |
| **D. Sound effects (not music)** | robot deploy/travel/drill/unload, construction, UI confirm/cancel, capsule touchdown, rival capsule landing, ignition, warhead flight, interceptor launch, near miss, orbital interception, structural impact crack, FIRE NOW, target lock, threat warning, defense laser shots and hits, Divider bolts, Helios launches, Signal Array lighting | Diegetic or gameplay-critical. They stay in the SFX layer, and the music leaves room for them (section 14). |

Rejected as music:
- **Rival capsule landing, First Strike ignition, interceptor fire:** physical events. A musical hit on top of an SFX hit doubles the low end.
- **Each Divider bolt or defense shot:** 70 ms pulses (`interceptorFlight.ts`). Too fine for music.
- **Wave results (HIT · 4 HULL SAVED):** text feedback. Only the encounter outcome gets music.
- **Helios launches every 12 s:** a visual loop whose origin is set by the view, not the music clock.

---

## 4. Adaptive state model

### 4.1 Overview

The proposed model has two axes, plus modifiers and events:

- **Arc** (slow, persistent): where the campaign stands. It is derived only from saved facts.
- **Cue** (fast, transient): what is happening now. It is derived from presentations, run states, siege and monument status, and the view.
- **Modifiers**: view, infrastructure tier, damage, monument kind.
- **Events**: edges between successive snapshots fire stingers and scheduled automation (vacuums).

`deriveMusicTarget(snapshot)` is a pure function: snapshot → (arc, cue, mix). `deriveMusicEvents(previous, next)` is a pure function: two snapshots → events. Neither owns any flag, so a combat cue ends when the game state ends it. Nothing in the music system can latch combat.

### 4.2 Arc

Evaluated in order; the first match wins.

| Arc | Condition (code facts) | Meaning |
|---|---|---|
| `RECON` | `outpost === null` | First reconnaissance and descent. |
| `CLAIMED` | `outpost.monument?.status === 'complete'` | Territory claimed. Takes precedence over everything below. |
| `RETALIATION` | `firstStrike.status === 'COMPLETE'` and `counterstrike.acceptedOutcome === null` | Vesper's foothold is gone; she has answered. |
| `ASCENDANT` | `counterstrike.acceptedOutcome !== null` | The rival conflict is resolved; the Moon is the player's to build on. |
| `CONTESTED` | `rival.revealStatus === 'REVEALED'` | Vesper is present and her foothold stands. |
| `FOOTHOLD` | otherwise | Outpost exists; no rival yet. Sub-state "works" when `extractor.status === 'active'`. |

The branch "claimed while Vesper stands" resolves to `CLAIMED`. A later First Strike or Counterstrike still produces its set-piece cues, because cues outrank the arc.

### 4.3 Cue

Evaluated in priority order; the first match wins.

1. **SILENT**: music not started (`entryOpen`) or stopping.
2. **First Strike** (`firstStrikePresentation.phase`, including replay): arming, launch, orbital-flight, target-approach → `FS_FLIGHT`; vesper-transmission → `FS_TRANSMISSION`; impact-flash, ejecta → `FS_VACUUM` (the vacuum itself is scheduled exactly from 0.6 s before impact; section 9); crater-reveal, orbital-pullback, ending → `FS_BREATH`.
3. **Counterstrike** (`counterstrikeRun.status` not dormant or resolved): command, command-confirmed → `CS_ALERT`; warning → `CS_WARNING`; tracking, intercept-ready, interceptor-launched, missed → `CS_COMBAT`; impact → `CS_IMPACT`; success → `CS_SUCCESS`.
4. **Monument reveal**: `monumentRevealAtMs !== null` with the monument view open → `MONUMENT_REVEAL`.
5. **Rival presentation** (`rivalPresentation.phase` not idle): warning, orbital-transition, capsule-approach → `REVEAL_APPROACH`; impact → `REVEAL_IMPACT`; intro-transmission → `REVEAL_TRANSMISSION`; dual-sites → `REVEAL_SETTLE`; rival-focus, rival-focused, scanning, contested → `RIVAL_FOCUS`; scan-response → `RIVAL_TRANSMISSION`.
6. **Siege advancing**: `siegeIsActive(siege)` and (`phase === 'landed'` or the monument view is open) and no rival, strike or counterstrike presentation is running: constructing → `SIEGE_BUILD`; command → `SIEGE_ALERT`; waves → `SIEGE_COMBAT`; repairing → `SIEGE_REPAIR`.
7. **Monument view**: `monument === null` → `MONUMENT_CHOICES`; constructing → `MONUMENT_BUILD`; command → `MONUMENT_ALERT`; wave → `MONUMENT_COMBAT`; activating → `MONUMENT_ACTIVATING`; damaged or repairing → `MONUMENT_DAMAGED`; complete → the arc calm cue.
8. **Strike decision**: `strikeConfirmationOpen` → `STRIKE_DECISION`.
9. **Scar exploration**: `firstStrikePresentation.phase === 'scar-explore'` → the arc calm cue with ENGINE off.
10. **Calm**: the arc's calm cue: `RECON`, `FOOTHOLD`, `FOOTHOLD_WORKS`, `CONTESTED`, `RETALIATION`, `ASCENDANT` or `CLAIMED`.

Siege outranks the monument panel because the siege keeps advancing while the panel is open (the tick runs whenever `phase === 'landed' || monumentView`). A siege and an active monument cannot coexist (`canStartOrbitalSiege` and `canStartMonument` exclude each other).

### 4.4 Mix table (dB relative to unity; blank = off)

| Cue | BED | ENGINE | PRESSURE | ASSAULT | CLAIM | ≈ LUFS | worst peak dBFS |
|---|---:|---:|---:|---:|---:|---:|---:|
| `SILENT` | | | | | | — | — |
| `RECON` | −3 | | | | | −29.0 | −17.0 |
| `FOOTHOLD` | 0 | −12 | | | | −25.8 | −11.6 |
| `FOOTHOLD_WORKS` | 0 | −4 | | | | −24.8 | −8.9 |
| `CONTESTED` | 0 | −4 | −10 | | | −24.4 | −7.2 |
| `RETALIATION` | 0 | −6 | −5 | | | −24.0 | −6.6 |
| `ASCENDANT` | 0 | −4 | | | | −24.8 | −8.9 |
| `CLAIMED` | 0 | −8 | | | 0 | −21.1 | −4.2 |
| `REVEAL_APPROACH` | −2 | −10 | −6 | | | −25.9 | −8.8 |
| `REVEAL_IMPACT` | −2 | −10 | −3 | | | −24.7 | −7.6 |
| `REVEAL_TRANSMISSION` | −6 | | −9 | | | −29.9 | −14.5 |
| `REVEAL_SETTLE` | −2 | −8 | −8 | | | −26.2 | −8.9 |
| `RIVAL_FOCUS` | −2 | −10 | −4 | | | −25.2 | −8.0 |
| `RIVAL_TRANSMISSION` | −5 | −12 | −7 | | | −28.1 | −10.8 |
| `STRIKE_DECISION` | −2 | −8 | −6 | | | −25.7 | −8.3 |
| `FS_FLIGHT` | −4 | −8 | −10 | −1 | | −20.2 | −3.1 |
| `FS_TRANSMISSION` | −4 | −8 | −3 | −3 | | −21.0 | −2.9 |
| `FS_VACUUM` | | | | | | — | — |
| `FS_BREATH` | −8 | | | | | −34.0 | −22.0 |
| `CS_ALERT` | −3 | −8 | −2 | −14 | | −24.0 | −5.5 |
| `CS_WARNING` | −3 | −8 | −2 | −6 | | −22.2 | −3.6 |
| `CS_COMBAT` | −4 | −10 | −2 | 0 | | −18.8 | −1.4 |
| `CS_IMPACT` | −6 | | −4 | −10 | | −25.4 | −8.0 |
| `CS_SUCCESS` | −2 | −4 | −12 | −10 | | −24.5 | −5.7 |
| `SIEGE_BUILD` | 0 | 0 | arc | | arc | −23.5 | −6.9 |
| `SIEGE_ALERT` | −2 | −4 | arc | −10 | arc | −24.7 | −6.8 |
| `SIEGE_COMBAT` | −4 | −8 | arc | 0 | arc | −19.5 | −3.5 |
| `SIEGE_REPAIR` | 0 | −2 | arc | | arc | −24.2 | −8.0 |
| `MONUMENT_CHOICES` | 0 | −3 | | | −10 | −24.0 | −6.4 |
| `MONUMENT_BUILD` | 0 | −3 | | | −8 | −23.7 | −6.0 |
| `MONUMENT_ALERT` | −2 | −6 | | −12 | −6 | −24.0 | −5.1 |
| `MONUMENT_ALERT_DWELL` | −2 | −6 | | | −8 | −25.4 | −7.7 |
| `MONUMENT_COMBAT` | −4 | −10 | | 0 | −5 | −18.9 | −1.6 |
| `MONUMENT_ACTIVATING` | 0 | −4 | | | −2 | −21.9 | −4.3 |
| `MONUMENT_DAMAGED` | 0 | −6 | | | −12 | −24.8 | −7.9 |
| `MONUMENT_REVEAL` | −4 | | | | −6 | −26.5 | −10.9 |

"arc" in the siege rows carries the arc's identity layer: `CONTESTED` adds PRESSURE −12; `CLAIMED` adds CLAIM −10; other arcs add nothing. With those additions, `SIEGE_COMBAT` reaches −19.3 LUFS and a worst-case peak of −2.2 dBFS.

LUFS figures assume uncorrelated layers at their unity loudness (section 15). Worst-case peak figures are the arithmetic sum of every layer's true-peak ceiling as if all peaks coincided. That is a bound, not a measurement.

### 4.5 Modifiers (applied in this order)

1. **Infrastructure tier** (calm cues `FOOTHOLD_WORKS`, `CONTESTED`, `RETALIATION`, `ASCENDANT`): ENGINE +1 dB when the module slot is active and +1 dB when the siege is operational (maximum +2). The base audibly grows.
2. **View** (calm cues only): in orbit, selected or returning, ENGINE −4 dB. On the surface the machines are close; from orbit the Moon is enormous. Ramps run over the camera journey (6.2 s down, 2.4 s up).
3. **Damage** (calm cues): ENGINE −3 dB while the Counterstrike damage is unrepaired or the siege or monument is damaged. In `ASCENDANT`, an unrepaired Counterstrike wound also brings PRESSURE in at −14 dB: Vesper's mark lingers until the Repair Gantry finishes.
4. **Monument flavor** (`CLAIMED` only; replaces the cue's ENGINE level of −8): Helios Spire −4 (the mass driver hums), Bastion Ziggurat −6, Crater Crown −10, Signal Array −12 (air and signal). Free, memory-neutral identity.
5. **Optional operating-mode tilt** (calm, surface; off in package 1): ENGINE +1 (OVERDRIVE), −2 (CONSERVE), −4 (STORAGE FULL, robots stopped).

### 4.6 Invariants (enforced by the mixer, unit-tested)

1. **CLAIM and PRESSURE never sound together.** If a Counterstrike run is active, CLAIM is off. Otherwise, if CLAIM is above off, PRESSURE is off. They carry incompatible thirds and belong to opposite narratives.
2. **No modifier raises a layer above 0 dB.**
3. **The alarm sample never appears in a loop** (it would read as a gameplay warning).
4. **Every reachable mix, every stinger with its duck, and every crossfade envelope stays at or below −1 dBFS worst-case** (section 15).
5. **Loops are never restarted** while the session runs. Only NEW GAME (or closing the page) ends the epoch.

### 4.7 Dwell decay, rotation and rests

**Dwell decay.** Tension that waits on the player decays after **2 phrases (19.2 s)** with no state change. A change of the underlying state resets the timer.
- `MONUMENT_ALERT` → `MONUMENT_ALERT_DWELL`
- `STRIKE_DECISION` → the arc calm cue
- `RIVAL_FOCUS` while `rival-focused` → the arc calm cue
- `RETALIATION` is already calm-level, so it needs no decay.

**Rotation in long calm.** Count whole loops spent continuously in the same calm cue. Every fourth loop is **thinned**: ENGINE off, PRESSURE −6 dB extra, CLAIM −4 dB extra. The ninth loop is a **rest**: all layers fade out over one bar and stay out for one loop, then return with a two-bar swell, and the count restarts. The pattern is N N N T N N N T R, so the first rest comes after about 5.1 minutes of uninterrupted calm. Thinned and rest windows begin and end at **P3 boundaries (bar 9)**, never at the loop seam, so they never mark the loop. `RECON` never rests. Any non-calm cue cancels a rest at the next bar.

### 4.8 Why not SURFACE / THREAT / COMBAT / CLAIM

| Provisional | Replaced by | Reason from the code |
|---|---|---|
| SURFACE | **BED + ENGINE** | The game's main growth axis is infrastructure (extractor → module → platform), and the extractor is what summons Vesper. Industry needs its own valve, separate from atmosphere. Orbit and surface also need different machine levels. |
| THREAT | **PRESSURE** | The threat that can sit in the background for minutes is specifically Vesper's. The Octogonals never hover; they arrive in timed waves. A generic THREAT layer would put Vesper's color under Octogonal raids. |
| COMBAT | **ASSAULT** | Combat music must serve both Vesper's Counterstrike and the Octogonal raids. ASSAULT is the faction-neutral war machine (the player's kick cell and the Moon's machinery). Faction color comes from PRESSURE (Vesper) or `divider-contact` (Octogonals). |
| CLAIM | **CLAIM** | Kept. It plays during monument construction and waves (building the claim under fire) and owns the claimed state. |

---

## 5. Musical identity

### 5.1 Continuity decision

**Reuse and expand the portfolio identity.** D minor, 100 BPM and 4/4 are shared with the portfolio cue "Shoot the Moon — The Claim" (`examples/shoot-the-moon-locked-score.json`) and with the YouTube film score. So are the motifs: Claim D–A–E–F, Vesper E♭–D–A–A♭, the Divider D/A♭ tritone with 3+3+2, and the machine's kick cell (1, 2+, 3+, 4+). Reasons:

1. **A recognizable world across reel, film and game.** A player arriving from the video hears the same Moon.
2. **The Orbital Foundry alarm is a fixed D4/A♭4 tritone.** D is the only center in which it is native.
3. **The Foundry's tuned low content fits D.** The sub pulse's 49 Hz fundamental sits on G1 with 98/147 Hz harmonics (G2, ≈D3). The 68 Hz kick body sits between C2 and C♯2, just under D2 (73.4 Hz), and works as a percussive pitch if bass notes interlock with it rather than sustain against it.
4. **100 BPM is the right speed for heavy industrial music.** Heavy is slow, and density comes from subdivision (section 12).

What changes for the game: the film's maker voice (celesta) is not used, and the raised third becomes a once-per-campaign payoff (section 5.2).

### 5.2 Tonal system: a modal arc in D

| Campaign color | Modes and colors | Owned by |
|---|---|---|
| Foothold, industry | open fifths over a D pedal; no third | BED, ENGINE |
| Vesper, conflict | Phrygian ♭2 (E♭), minor third (F), Locrian ♭5 (A♭) | PRESSURE, vesper stingers |
| Octogonals | D/A♭ tritone, fixed pitch | `divider-contact` |
| War machine | roots in octaves; ♭2 neighbor (E♭) only in P1; ♭7 passing (C) | ASSAULT |
| Dominion | B♭ lydian (E over B♭), G and A suspensions, open D | CLAIM |
| **The claim realized** | **F♯ (major third of D), D(add9)** | **`territory-claimed` only** |

**The major third exists once.** No loop contains F♯, so the payoff cannot be spent by layering. It sounds only when a territory is claimed (and when the player replays that reveal).

### 5.3 Harmonic skeleton and pitch-class contract

All five loops share one 16-bar skeleton: **D (P1) → B♭ (P2) → G (P3) → A (P4) → D (seam)**. This is the portfolio's resolution progression with D first. The seam is an A-to-D arrival, so the loop boundary feels like a phrase landing rather than a reset.

Each layer may use only these pitch classes in each phrase. With these sets, **every combination the mixer can reach is consonant or intentionally dissonant by construction.**

| Phrase | Root | BED (neutral) | ENGINE | PRESSURE (Vesper) | ASSAULT | CLAIM |
|---|---|---|---|---|---|---|
| P1 bars 1–4 | D | D, A | D pedal (+A) | D, E♭, F, A♭ | D in octaves; E♭ short neighbor; C passing | D, A |
| P2 bars 5–8 | B♭ | B♭, D | D pedal | B♭, D, F, A♭ | B♭ in octaves; C passing | B♭, C, D, E, F, A |
| P3 bars 9–12 | G | G, D | D pedal | G, B♭, D, E♭, A♭ | G in octaves; D; F passing | G, A, C, D |
| P4 bars 13–16 | A | A, D | D pedal (+A) | A, A♭, C, E♭ | A in octaves; C passing | A, D, E |

Never in any loop: **F♯** (reserved), **B♮** and **C♯** (they would contradict B♭ and C in co-playing layers), and **the alarm sample**. E never appears in BED or ASSAULT, E♭ never in CLAIM, and A♭ only in PRESSURE.

Checks of the combinations the mixer allows:
- BED + ENGINE + PRESSURE (+ ASSAULT): Vesper's E♭ / A♭ against the D and A roots are the designed dissonances (the film's "colder shade").
- BED + ENGINE + ASSAULT + CLAIM (monument waves): ASSAULT's only non-chord tones are a short E♭ in P1 (a passing ♭9 against D–A), C (♭7 of D, 9th of B♭, 11th of G, minor third of A) and F over G (♭7). None sustains against a CLAIM tone a semitone away.
- ENGINE's D pedal under B♭, G and A gives B♭/D, G/D and A/D, the same suspended colors CLAIM uses.

Stingers that land on any phrase follow the same logic. Vesper and Octogonal stingers are dissonant by identity. `outcome-hold` uses only D and A, which fit all four fields. `territory-claimed` clears the stage before it sounds (section 8).

### 5.4 Motifs and factions

| Identity | Pitch | Rhythm | Timbre | Lives in | Never in |
|---|---|---|---|---|---|
| **Player / Claim** | D–A–E–F. Seed D–A; question ends on F; answer D–A–E–F♯ | the machine kick cell 1, 2+, 3+, 4+ | GM `lead_1_square` (portfolio voice), `string_ensemble_1` | CLAIM (D–A–E–F in P2 over B♭ lydian; D–A–E in P4), `outcome-hold` (seed), `territory-claimed` (answer) | PRESSURE |
| **Machine / industry** | unpitched; D pedal | the kick cell; steady clockwork | Foundry kick, sub, ticks | ENGINE (sparse), ASSAULT (full) | — |
| **Vesper** | E♭–D–A–A♭ (♭2 collapses to 1, then 5 to ♭5); reversed A♭–A–D–E♭ for retaliation | her beacon: two pulses an eighth apart, then a long watchful pause, in a 3-beat cycle (`VESPER_BEACON_RHYTHM`: 0 and 280 ms in 1,800 ms) | GM `pad_6_metallic`, metallic strike, sub-pulse heartbeat | PRESSURE, `vesper-arrival`, `vesper-retaliation` | ASSAULT, CLAIM, any Octogonal encounter as a foreground voice |
| **Octogonals (Divider)** | D4/A♭4 tritone (fixed alarm sample) | 3+3+2 eighths (eight units: an octagon), doubling to sixteenths as raids escalate | Foundry alarm + kick + ticks | `divider-contact` only | every loop |
| **Monuments** | the answer D–A–E–F♯ plus D(add9) | arrival, then bloom | strings, square lead, low boom, air | `territory-claimed` (package 2: one variant per monument) | loops |

**Vesper's beacon in 4/4.** At 100 BPM the 1.8 s beacon cycle is exactly three beats, a 3-against-4 hemiola. For the loop to close, the cycle **restarts on every phrase**: five cycles (15 beats), then one silent beat. Each phrase ends on her watchful pause, and the loop seam is a cycle boundary.

### 5.5 Rhythmic language

- **The kick cell** (1, 2+, 3+, 4+) is the player's. It appears thinly in ENGINE and fully in ASSAULT. Its asymmetric offbeats make the machine sound purposeful rather than dance-like.
- **Subdivision is the intensity control, not tempo.** Quarters (calm) → eighths (works) → sixteenths (pressure) → sextuplets and 32nd bursts (combat peaks).
- **The Octogonals count to eight**: 3+3+2 at eighths, then at sixteenths in the third raid.
- **Rhythmic silence** is a weapon: ASSAULT's breakdown and its one-beat stops live inside the loop (end of P3), not at the seam.

---

## 6. Tempo, meter and loop architecture

**Locked: 100 BPM, 4/4, D, 16-bar loops (38.4 s).**

| Loop length | Seconds | Verdict |
|---|---:|---|
| 8 bars | 19.2 | Repeats about 3 times a minute in calm states that last many minutes. Too short. |
| 12 bars | 28.8 | Workable, but three phrases cannot carry the four-chord resolution progression the identity rests on. |
| **16 bars** | **38.4** | **Chosen.** Four phrases carry D → B♭ → G → A. Longer than any single combat encounter (Counterstrike ≤ 29.6 s automatic, siege waves ≤ 28 s, monument waves 6–8 s), so combat material rarely repeats within a fight. Long calm stretches are handled by texture, rotation and rests. |
| 32 bars | 76.8 | Better against fatigue, but doubles decoded memory (about 28 MiB per stereo layer at 48 kHz) on a 'low' tier reference phone. Not justified when rotation and rests exist. |

Responsiveness does not depend on loop length: transitions quantize to beats (0.6 s), bars (2.4 s) or phrases (9.6 s).

**Frame arithmetic** (DaemonV12 rounds ticks to frames once, and 100 BPM gives 27.5625 frames per tick):

| Quantity | Value |
|---|---|
| 16 bars | 61,440 ticks = **1,693,440 frames @ 44.1 kHz** = 1,843,200 @ 48 kHz (exact) |
| Three-cycle render (section 10) | 48 bars = 184,320 ticks = 5,080,320 frames = 115.2 s |
| Web guard | 0.2 s = 8,820 frames @ 44.1 kHz = 9,600 @ 48 kHz |
| Integer at every common context rate | 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2 and 96 kHz: loop and guard are whole frames |
| FluidSynth 64-frame blocks | 1,693,440 = 64 × 26,460, so block quantization is periodic too |

---

## 7. Layer design

All loops share the settings in section 10.3: per-layer DaemonV12 project, 48 bars rendered, cycle 2 kept. "Unity" means gain 0 dB in the runtime mixer.

### 7.1 BED — atmosphere and harmonic floor

- **Role:** the Moon's presence. Always on once music starts (except vacuums, rests and the claim reveal).
- **Channels:** stereo. This is where the soundtrack's width lives.
- **Content:**
  - `atmos-drone`: Foundry `10-dark-drone` (high-pass 110 Hz, low-pass 1.8 kHz). Overlapping 8 s gestures at irregular 6–7.2 s spacing, one of them crossing the seam.
  - `atmos-air`: Foundry `11-air-texture` (high-pass 2.5 kHz), offset from the drone.
  - `floor`: GM `pad_3_polysynth` or `synth_strings_1` (high-pass 150 Hz, low-pass 2.6 kHz, reverb room 0.6 / 1.6 s / wet 0.2). A low D pedal with the phrase dyad above it (D–A, B♭–D, G–D, A–D), 2-bar sustains, no attacks on downbeats.
- **Never:** percussion, booms, thirds, anything that announces bar 1.
- **Unity:** −26 LUFS integrated, ≤ −14 dBTP.

### 7.2 ENGINE — the outpost's industry

- **Role:** growing infrastructure. Enters when the extractor goes active, grows with tiers, recedes in orbit.
- **Channels:** mono (all tracks centered, no reverb).
- **Content:**
  - `engine-tick`: Foundry `machine-tick` clockwork at low velocity (0.30–0.55): quarters in P1, eighths in P2–P3, thinning in P4.
  - `engine-pulse`: `sub-pulse` on a sparse subset of the kick cell.
  - `engine-stroke`: `mechanical-kick` at 0.40–0.50 on beat 1 of alternate bars ("the extractor stroke").
  - `engine-bass`: GM `synth_bass_1` (high-pass 60 Hz, low-pass 700 Hz, compressor). Short D1/D2 pulses on the kick cell's offbeats, interlocking with kicks, never sustained under them.
  - Optional: one distant `metallic-strike` per phrase at ≤ 0.35.
- **Unity:** −27 LUFS measured as dual-mono stereo, ≤ −12 dBTP.

### 7.3 PRESSURE — Vesper

- **Role:** the rival's presence: an undertow in contested calm, the voice of the reveal, the threat in her Counterstrike.
- **Channels:** mono.
- **Content:**
  - `vesper-voice`: GM `pad_6_metallic` (high-pass 520 Hz, low-pass 6.2 kHz). The collapse cells: E♭→D in P1, A♭ color over B♭ and G, A→A♭ in P4. Played in the beacon rhythm.
  - `vesper-heart`: `sub-pulse` in the beacon rhythm (two pulses, pause), restarting each phrase.
  - `vesper-grind`: GM `synth_bass_1` or `cello` (high-pass 70 Hz, low-pass 900 Hz). Slow semitone grinds above the D pedal (E♭/D, A♭/G, A♭/A).
  - Optional: one `09-reverse-swell` per loop into P4.
- **Never:** CLAIM material; alarm; snare.
- **Unity:** −25 LUFS (dual-mono), ≤ −12 dBTP.

### 7.4 ASSAULT — the war machine

- **Role:** combat for every faction: the player's kick cell and the Moon's machinery at full weight.
- **Channels:** mono (width comes from BED and the stereo stingers; mono also survives phone speakers).
- **Content:**
  - `drive`: `mechanical-kick` + `industrial-snare` (high-pass 40 Hz, saturation drive 6 dB / mix 0.35, compressor −18 dB 3:1 8/120 ms).
  - `sub`: `sub-pulse` syncopated between kicks.
  - `riff`: GM `synth_bass_2` or `lead_8_bass_lead` in octaves (saturation 12 dB / mix 0.6, high-pass 45 Hz, low-pass 3.2 kHz, compressor).
  - `riff-grit` (optional): GM `distortion_guitar` doubling the riff 12 dB under it, high-pass 120 Hz, low-pass 2.5 kHz, never exposed.
  - `steel`: `metallic-strike` (high-pass 600 Hz).
  - `ticks`: `machine-tick`.
  - `boom`: `low-boom` once each at the P2 and P4 downbeats, never at bar 1.
- **Phrase plan:**
  - P1: half-time weight (snare on 3), riff on D with E♭ neighbors.
  - P2: straight drive (kick cell, snare 2 & 4, sixteenth ticks), riff on B♭.
  - P3: double-time pressure (sixteenth kick bursts, steel dotted-quarter polyrhythm, sextuplet ticks), riff on G, ending with the loop's biggest stop (one beat of silence at 12:4).
  - P4: re-launch on A, building into an ordinary fill at bar 16. The seam is continuous drive, not a drop.
- **Unity:** −20 LUFS (dual-mono), ≤ −7 dBTP.

### 7.5 CLAIM — dominion

- **Role:** building the claim (monument construction and waves) and owning the claimed Moon.
- **Channels:** stereo.
- **Content:**
  - `claim-lead`: GM `lead_1_square` (high-pass 260 Hz, low-pass 2.7 kHz, delay 150 ms / wet 0.18: the portfolio voice). The motif D–A–E–F over B♭ lydian in P2, and D–A–E over A sus in P4.
  - `claim-strings`: GM `string_ensemble_1` (high-pass 110 Hz, low-pass 6.5 kHz, reverb room 0.7 / 1.8 s / wet 0.25). Open D, B♭(add9 ♯11), G sus2/4, A sus4.
  - `claim-weight`: `low-boom` at the P3 downbeat (bar 9) only.
  - `claim-gravity`: `mechanical-kick` half-time at ≤ 0.5 in P3–P4.
- **Never:** F♯, a D minor triad, E♭, A♭.
- **Unity:** −23 LUFS, ≤ −10 dBTP.

---

## 8. Stinger design

Every stinger is a separate DaemonV12 project rendered to an exact bar length with `tail: "none"`, decaying to ≤ −60 dBFS RMS in its last 100 ms. **Quantized** stingers may contain a pulse aligned to the grid. **Exactly synced** stingers (impacts, the claim) must be arrhythmic after their sync point, because they land off the grid.

| ID | Trigger (snapshot edge) | Timing | Sync point | Length / ch | Content | Unity TP | Duck on layers | Priority |
|---|---|---|---|---|---|---:|---|---:|
| `vesper-arrival` | `rivalPresentation.phase` → `warning` (also REVIEW SIGNAL) | next beat | content 0 | 2 bars / mono | Vesper motif E♭–D–A–A♭ at 1:1, 1:2, 1:3, 1:3+3/16 (portfolio rhythm) + one metallic strike + heartbeat pair; pad tail | −9 | −3 dB, 2 bars | 70 |
| `first-strike` | strike phase → `arming` (also REPLAY STRIKE) | **exact**: starts 0.8 s into vesper-transmission (nominally arming + 10.2 s) | impact at content 4.6 s (`2:4+1/6`) = impact-flash start (nominally arming + 14.8 s) | 5 bars / stereo | Foundry tension riser 0–4.0 s; true silence 4.0–4.6 s; at 4.6 s: cinematic impact (full velocity) + low boom + mechanical kick + dissonant D field (D3 A3 E♭4); spaced steel and tick debris; decays by 12.0 s | −2 | vacuum: all layers off 1.6 s into target-approach (0.6 s before impact); BED returns on the crater-reveal edge | 100 |
| `vesper-retaliation` | `counterstrikeRun.status` → `command` (also replay) | next beat | content 0 | 1 bar / mono | Reversed motif A♭–A–D–E♭ in sixteenths over a metallic strike and low grind: "she answered" | −9 | −3 dB, 1 bar | 70 |
| `divider-contact` | siege → `command`; `platformDefenseView` opens wave *i*; monument `command` with 0 waves resolved; monument → `wave` | next beat | content 0 | 1 bar / mono | Alarm D/A♭ at 1:1 + kick and ticks accenting 3+3+2 eighths (1:1, 1:2+1/8, 1:4) | −11 (+1 dB wave 2, +2 dB wave 3) | −4 dB, 1 bar | 50 |
| `outcome-hold` | counterstrike → `success`; siege waves → `operational`; siege repairing → `operational`; monument wave → `activating` | next beat | content 0 | 1 bar / mono | The claim seed D–A (square lead) + bright metallic strike + soft low boom. Only D and A, so it fits every phrase | −9 | −8 dB, 1 bar | 60 |
| `outcome-breach` | counterstrike → `impact` (scheduled at contact = phase start + 1.5 s); siege → `damaged`; monument → `damaged` | **exact** (Counterstrike) / immediate | hit at content 0; low boom at `1:1+1/16` (+0.15 s, the portfolio's offset so it does not stack on the SFX crack) | 2 bars / mono | Reduced cinematic impact (velocity ≈ 0.45) + cluster D–E♭–A♭ + low boom; arrhythmic decay | −6 | −8 dB, 2 bars | 80 |
| `territory-claimed` | `monumentRevealAtMs` null → set (also REPLAY ORBITAL REVEAL) | **exact**: reveal start | arrival at content 0 | 4 bars / stereo | Arrival (low boom + strings), the answer D–A–E–**F♯** with F♯ at `2:3` (3.6 s), D(add9) bloom 3.6–8.4 s with air, decay by 9.6 s. **The only F♯ in the soundtrack.** | −5 | stage clear: BED −12 dB, every other layer off until the first phrase boundary ≥ +8.4 s, then `CLAIMED` with a 1-bar swell | 90 |

Concurrency:
- At most **two** stingers sound at once.
- A higher-priority stinger cuts a lower one with a 50 ms fade.
- The same ID cannot retrigger while it is still playing.
- Stinger ducks stack with the cue's mix but never raise anything.

---

## 9. Transition rules

**The four timings evaluated:**
- **Immediate** is right for physical sync (impacts, the claim reveal) and for reading pull-backs. It is wrong for anything rhythmic: an ungridded entrance smears the groove.
- **Next beat** (≤ 0.6 s) is right for stingers that are musical punctuation of a gameplay event (Vesper, Divider, outcomes) and for steps inside set pieces.
- **Next bar** (≤ 2.4 s) is right for escalation, and it lands entrances on downbeats. Timed threats give enough warning: the Counterstrike `warning` phase alone is 3.2 s. Where a fight starts on the player's tap (monument waves), the alert mix already carries ASSAULT at −12 dB, and a beat-quantized `divider-contact` marks the start within 0.6 s.
- **Next phrase** (≤ 9.6 s) is right for de-escalation and arc changes. Releases that wait for a phrase sound composed rather than switched off.

The smallest musical system is therefore four units plus exact scheduling for the few deterministic hits.

**Units** are measured from the epoch: **BEAT** 0.6 s, **BAR** 2.4 s, **PHRASE** 9.6 s. **IMMEDIATE** means now + 0.10 s lookahead. All times are rounded to whole frames of the context rate.

**EXACT** means a game time taken from the presentation phase the event falls in:
- Anchors come from the current snapshot (`firstStrikePresentation.startedAtMs`, `counterstrikeRun.phaseStartedAtMs`, `monumentRevealAtMs`), plus nominal durations.
- Steps that have not started are recomputed on every phase edge and on resume. Timer lateness and hidden-tab shifts therefore never accumulate (finding 6).
- The game time is mapped to the audio clock (section 16.3) with `SYNC_VISUAL_OFFSET_MS` (40 ms default) added. The game stamps a state change before the frame that shows it reaches the screen, and sound that leads the picture is the more noticeable error.
- The `first-strike` stinger is committed 4.6 s before its impact, so it can still lead the flash by the lateness of the last two phase timers, typically under one frame each.

**Fade classes:**
- **swell**: dB-linear ramp that *ends* on the boundary.
- **hard**: 20 ms ramp *starting* on the boundary (ASSAULT and ENGINE entrances: the drop lands on the downbeat).
- **release**: dB-linear ramp *starting* on the boundary.
- **duck**: 0.4 s.
- **vacuum**: 40 ms ramp ending exactly at the scheduled time.

**Sequencing:** in every move, falling layers start at T and rising layers start at T + half the fall time. This keeps every crossfade envelope under the peak ceiling (section 15).

| From → to | Quantize | Fade |
|---|---|---|
| start of music (BEGIN / CONTINUE) | epoch = now + 0.15 s | BED swell 1 bar from silence; other layers join at the next bar |
| calm → calm (arc change) | PHRASE | 2-bar crossfade |
| calm → tension | BAR | 1 bar |
| tension → combat | BAR | hard ASSAULT entry; others 1 beat |
| set-piece steps (`REVEAL_*`, `RIVAL_*`, `FS_FLIGHT` ⇄ `FS_TRANSMISSION`) | BEAT | 1 beat |
| FIRE (→ `FS_FLIGHT`) | BEAT | hard ASSAULT entry: the commit lands on the next beat |
| strike vacuum | EXACT target-approach + 1.6 s (nominally arming + 14.2 s) | vacuum; the plan holds every layer off until the breath |
| strike breath | IMMEDIATE on the crater-reveal edge (nominally arming + 19.5 s) | BED rises over 2 s to −8 dB |
| transmission pull-backs (`REVEAL_TRANSMISSION`, `RIVAL_TRANSMISSION`) | IMMEDIATE | duck 0.4 s |
| combat → aftermath (`CS_SUCCESS`, `CS_IMPACT`, outcomes) | BEAT | 1 beat |
| aftermath / tension → calm | PHRASE | release 1 bar ending on the phrase |
| dwell decay | PHRASE | 2 bars |
| rotation (thin / rest) | P3 boundary (bar 9) | 1 bar |
| view orbit ⇄ surface | IMMEDIATE | over the journey (6.2 s / 2.4 s) |
| a layer finishes decoding late | BAR | swell 1 bar to its current target |
| SOUND OFF | IMMEDIATE | music bus 150 ms, then suspend |
| NEW GAME | IMMEDIATE | 0.5 s, then stop |

**Responsiveness check against real timers:**
- Counterstrike: `warning` lasts 3.2 s, so ASSAULT is at −6 dB within ≤ 2.4 s, before tracking begins. Tracking then brings it to 0 at the next bar, well before the FIRE NOW window (≥ 5.3 s).
- Siege: the command lasts up to 5 s, so the bar-quantized alert is in place with time to spare.
- Monument: waves start on the player's tap, so ASSAULT enters within 2.4 s and the per-wave `divider-contact` within 0.6 s. The defense window runs 3.6 s, with targeting from 0.5 to 2.6 s.

**Re-targeting:** when a new target arrives mid-ramp, cancel and continue from the director's *modeled* value at the new start time. Never read `AudioParam.value` for future times.

---

## 10. Seamless loops

### 10.1 What DaemonV12 V0.5 guarantees

- Exact output length (`render.duration.bars`); identical frame counts for master and stems.
- Deterministic tick → frame placement with a single rounding rule (ties to the later frame).
- `tail: "none"`: a hard cut at the authored end.
- Deterministic WAV in the same environment (FluidSynth runs with reverb and chorus off, one core, fixed gain).
- Track automation and ordered effects; provenance hashes; integrated loudness, LRA and true-peak analysis.

### 10.2 What it does not guarantee

The V0.5 contract says so explicitly: "Exact length does not guarantee perceptually seamless looping." In a single-cycle render:
- notes and sample tails crossing the end are **cut**, and nothing wraps to the start;
- reverb, delay and compressor states start **cold** at frame 0 and are warm at the end;
- the Foundry drone and air are finite 8 s gestures ("not seamless loops"). An overlapping bed dips at a cut boundary.

A single-cycle 16-bar render of a continuous bed therefore audibly breathes or clicks at every seam.

### 10.3 The method: steady-state cycle extraction (no crossfade)

1. Author each loop as **one 16-bar pattern placed three times**: clips at bars 1, 17 and 33 of a **48-bar** project. Automation, if any, is repeated per cycle at absolute positions.
2. Render with `render: { duration: { bars: 48 }, tail: "none" }`: exactly 5,080,320 frames.
3. Keep **cycle 2**: frames [1,693,440, 3,386,880). Cycle 1 warmed every effect and supplied the tails that cross into cycle 2's start. Cycle 2's own tails run past its end and are cut there, but their identical counterparts from cycle 1 are already present at cycle 2's start. Looping cycle 2 therefore reproduces the infinite steady-state signal.
4. **Prove it.** Cycle 2 must equal cycle 3 ([3,386,880, 5,080,320)) within ±1 LSB on every sample. The pre-guard region [1,684,620, 1,693,440) must equal [3,378,060, 3,386,880). If any sound outlasted a cycle or any process were time-variant, this test fails.
5. **Web derivative.** Take frames [1,684,620, 3,395,700): the last 0.2 s of a cycle, the full cycle, then the first 0.2 s of the next. That is 1,711,080 frames, every sample real rendered audio. Encode it. The runtime loops the inner region (section 16.4).

This is a lossless crop with a mathematical proof, not a crossfade. Nothing is synthesized after DaemonV12.

### 10.4 What composers must still author correctly

1. **Every sound must be shorter than a cycle minus the guard** (≤ 8 s in practice: drone, air, reverb ≤ 2 s).
2. **The seam is a cadence, not an ending.** P4 (A) resolves to P1 (D). No final-sounding stop, no total silence at bar 16:4 in calm layers, no unique event at bar 1 that never recurs (no crash or boom on 1:1).
3. **Distribute accents.** The biggest arrangement contrast belongs inside the loop (ASSAULT's stop at 12:4; the CLAIM weight at bar 9).
4. **Pickups may cross the seam.** Reverse swells ending on 1:1, fills, sustains and tails are all welcome; the steady-state crop makes them seamless.
5. **Obey the pitch-class contract** (section 5.3) and per-layer unity targets (section 15).
6. **Mono layers must be mono-compatible:** all tracks centered and no stereo reverb. The fold-down check is in the handoff.
7. **Stingers:** declare the sync position; decay to silence before the end; arrhythmic after the sync point if exactly synced.

---

## 11. Orbital Foundry mapping

| Sound | Continuous layers | Stingers | Never |
|---|---|---|---|
| `01-sub-pulse` (49 Hz) | ENGINE (sparse cell), PRESSURE (beacon heartbeat), ASSAULT (syncopation) | first-strike, divider-contact | sustained under a held bass |
| `02-mechanical-kick` (68 Hz body) | ENGINE (extractor stroke ≤ 0.5), ASSAULT (kick cell), CLAIM (half-time gravity) | first-strike, divider-contact, outcome-hold | coinciding with a sustained D2 bass |
| `03-metallic-strike` | ASSAULT (polyrhythm, phrase accents), ENGINE (≤ 1 distant hit per phrase), PRESSURE (optional) | vesper-arrival, vesper-retaliation, outcome-hold, outcome-breach, first-strike debris | dense repetition in calm |
| `04-machine-tick` | ENGINE (clockwork), ASSAULT (sixteenths, sextuplets, 32nd bursts) | divider-contact, first-strike debris | — |
| `05-industrial-snare` | ASSAULT only | divider-contact | calm layers |
| `06-low-boom` | ASSAULT (P2 and P4 downbeats), CLAIM (bar 9) | first-strike, outcome-breach (+0.15 s), outcome-hold (soft), territory-claimed | bar 1 of any loop; every downbeat |
| `07-cinematic-impact` | — | **first-strike (full)**, outcome-breach (≈ 0.45) | all loops; any other stinger (the impact hierarchy) |
| `08-tension-riser` (4.0 s) | — | **first-strike only** (ends at the vacuum) | anywhere else |
| `09-reverse-swell` (2.0 s) | PRESSURE (into P4, optional), ASSAULT (one pickup into P1, optional) | — | under transmissions at full level |
| `10-dark-drone` (8 s) | BED | — | sub reinforcement |
| `11-air-texture` (8 s) | BED, CLAIM (optional width) | territory-claimed bloom | unfiltered below 2.5 kHz |
| `12-alarm-energy-pulse` (D4/A♭4) | — | **divider-contact only** | every loop (false-alarm risk) |

**Gap assessment for the pack:**
- **Material constraint: no pitched heavy voice.** A riff instrument must come from GM through saturation. This limits how "metal" combat can sound (section 12). It does not block the design.
- **Not constraining:** the riser and swell are fixed lengths but placed by endpoint; the drone and air are finite but the steady-state crop makes them continuous.
- **No new pack is requested for package 1.**

---

## 12. Industrial heaviness without imitation

Combat must hit harder than the portfolio cue. The strategies below are all available in V0.5 today:

1. **Weight from interlock, not stacking.** The kick (68 Hz) takes the beat, the sub pulse (49 Hz) the sixteenth before or after, and the saturated octave riff the offbeats. Low notes never sustain against kicks, which avoids the 5 Hz beating between a 68 Hz kick and D2 (73.4 Hz).
2. **Saturated synth bass as the heavy voice.** GM `synth_bass_2` or `lead_8_bass_lead` through V0.5 saturation (drive ≈ 12 dB, mix ≈ 0.6), then a compressor. The industrial answer to the guitar wall.
3. **The ♭2.** E♭ against D in P1 is the darkest interval in the system, used as a short neighbor, never a drone.
4. **Subdivision ladder.** Half-time (P1) → straight (P2) → double-time sixteenths with sextuplet ticks (P3). Perceived speed rises with no tempo change.
5. **Metallic polyrhythm.** Steel in dotted quarters (3 against 4) through P3.
6. **Rhythmic silence.** A full-band one-beat stop at 12:4 before P4 re-launches. The heaviest moment is a gap.
7. **Restraint elsewhere.** No snare in calm, no boom on bar 1, and the cinematic impact reserved for two moments. Because calm is restrained, combat is big.

**Distorted guitar, honestly:** GM `distortion_guitar` and `overdriven_guitar` in FluidR3 GM are single sampled notes with no palm-mute articulation, no double-tracking and unconvincing chord voicings. Through saturation they add grit as a **doubling 12 dB under the synth riff**. They are **not** production-quality metal guitar and must never be exposed or carry the riff. If guitar-like heaviness becomes a requirement, the path is a small synthesized **riff kit** (distorted power-stab one-shots at the handful of pitches the contract uses: D, E♭, F, G, A, B♭, C), mapped as a drum kit. That is an asset task, not an engine change (section 19).

**Originality:** no specific soundtrack, composer or song is a model. The identity comes from this project's own motifs, the Foundry's synthesized sounds and the game's code-defined rhythms (Vesper's beacon, the octagon's eight).

---

## 13. Monument treatment

| Monument | Code facts | Treatment |
|---|---|---|
| Helios Spire | Fusion reactor + mass driver; reveal launches the slug at +4.2 s (`HELIOS_REVEAL_LAUNCH_MS`, exactly bar 2 beat 4 at 100 BPM); 12 s visual loop afterwards | Shared `territory-claimed` (package 1). Package 2 variant lands its weight on the +4.2 s launch. `CLAIMED` flavor: ENGINE −4. Recurring launches are SFX. |
| Crater Crown | Built into the First Strike scar when one exists (`anchor 'impact-scar'`); glow flare holds 2.2–3.4 s | Shared stinger; package 2 variant quotes the First Strike debris texture. ENGINE −10. |
| Bastion Ziggurat | Fortified terraces; no special reveal choreography beyond the 6 s pull-back | Shared stinger; package 2 variant uses half-time kick and walls of steel. ENGINE −6. |
| Signal Array | Vanes deploy; seven segments light 1.95–2.5 s; emitter peaks 2.5–2.75 s; held 4.4 s | Shared stinger; package 2 variant places bright ticks on the lighting. ENGINE −12 (air and signal). |

Decisions:
- **No permanent per-monument layer.** Only one monument can exist, and a fifth or sixth loop would cost 7–14 MiB for one variant.
- **No variation inside the CLAIM layer.** The claim is the player's identity, not the building's.
- **Identity per monument comes from** the unlock stinger (package 2) and the `CLAIMED` mix flavor (package 1, free).

---

## 14. Music versus sound effects

**Spectral and density allocation:**

| Band | Owner in calm | Owner in combat | Rule |
|---|---|---|---|
| 20–60 Hz | music (sparse sub, booms) | shared | At big impacts one source owns the sub: the music stinger at the First Strike; the SFX crack plus the stinger's delayed boom (+0.15 s) at the Counterstrike impact. Retune the SFX `impact` cue's 36→28 Hz sine when music is on. |
| 60–250 Hz | SFX machinery (capsule 48–64 Hz, drill 66–76 Hz, miner 96–118 Hz) | music (kick, riff) | ENGINE bass is short and interlocked; calm music never sustains here. |
| 250 Hz–2 kHz | SFX UI and alerts (target-lock 240–760 Hz, fire-window 430–920 Hz, threat-warning 116–148 Hz) | music (riff harmonics) | Calm music is soft and sustained here, never attacks. Gameplay-critical alerts **duck the music bus 4 dB** (20 ms attack, 0.4 s hold, 0.6 s release). |
| 2–6 kHz | music detail (ticks, steel) | shared with lasers and debris | Ticks at low velocity in calm; steel is sparse. |
| 6–16 kHz | music air | — | Air is filtered, never dense. |

**Density:**
- Calm layers leave whole beats empty.
- Nothing in any loop imitates an alert pattern: no repeated beeps, no rising triplet, no alarm.

**Required integration changes:**
- **Re-level the SFX bus.** Current single SFX voices peak near −22 dBFS (dense cues near −15 dBFS). With music at the section 15 targets, raise the SFX bus about 9–12 dB so impacts peak 6–10 dB above the music's short-term level at that moment. Confirm by measurement and listening.
- **Pitched cues** should use D-compatible pitches when music is on. Most cues are glides and are fine. `rival` (E4/E5 glides) overlaps Vesper's motif: retune it to E♭/D or let `vesper-arrival` replace it. `complete` (A–E fifths) and `threat-warning` (D→B♭) already fit.

---

## 15. Loudness and headroom

**Per-layer unity targets** (measured on the canonical loop crop; mono layers measured as the dual-mono stereo DaemonV12 renders them, which is how they are heard):

| Layer | Integrated LUFS | True-peak ceiling |
|---|---:|---:|
| BED | −26 ± 1 | −14 dBTP |
| ENGINE | −27 ± 1 | −12 dBTP |
| PRESSURE | −25 ± 1 | −12 dBTP |
| ASSAULT | −20 ± 1 | −7 dBTP |
| CLAIM | −23 ± 1 | −10 dBTP |

**Stingers** (true-peak ceilings): first-strike −2, territory-claimed −5, outcome-breach −6, vesper-arrival −9, vesper-retaliation −9, outcome-hold −9, divider-contact −11 dBTP.

**Resulting music-only levels** (computed, section 4.4):

| State | Level |
|---|---|
| calm (foothold, contested, ascendant) | −24 to −26 LUFS |
| claimed | −21 LUFS |
| First Strike flight | −20 LUFS |
| combat | −18.8 to −19.5 LUFS |
| reading pull-backs | −28 to −30 LUFS |
| breath | −34 LUFS |
| First Strike impact | stinger only, ≤ −2 dBTP |

Combat is about 6 LU above calm because ASSAULT adds density. Peak ceilings do not move.

**Headroom rules** (all verified, section 24):
- **H1:** every reachable mix, including modifiers: Σ 10^((TP_layer + gain)/20) ≤ −1 dBFS. Worst: `CS_COMBAT` −1.40 dBFS.
- **H2:** every mix with each stinger that can fire in it, after the stinger's duck: ≤ −1 dBFS. Worst: `MONUMENT_COMBAT` with the third-wave `divider-contact` at −1.13 dBFS.
- **H3:** every crossfade envelope, with sequenced rises: ≤ −1 dBFS. Worst over all ordered pairs: −1.39 dBFS.

These are arithmetic worst cases (every peak coincident), so real peaks are several dB lower. The asset build also measures real sums (handoff).

**Master:**
- The music bus has no compressor.
- The final master carries a **safety limiter** (`DynamicsCompressorNode`: threshold −1 dB, knee 0, ratio 20, attack 3 ms, release 250 ms) for music + SFX sums. It is expected never to engage. Its fixed automatic makeup (+0.57 dB at these settings) is compensated by master gain −0.6 dB.
- No normalization anywhere.

**Whole-game reference:** music + SFX should average about −18 to −16 LUFS over a session on phone speakers, true peak ≤ −1 dBTP.

---

## 16. Browser audio architecture

### 16.1 Graph

```text
AudioContext (one per page, shared)
  masterGain ──► safetyLimiter ──► destination
    ├─ sfxBus (existing synthesized cues; re-leveled)
    └─ musicBus ◄─ alertDuck (gain automation driven by alert SFX)
         ├─ layersBus (stinger ducks) ◄─┬─ BED gain      ◄─ AudioBufferSourceNode (loop, stereo)
         │                              ├─ ENGINE gain   ◄─ source (loop, mono → up-mixed)
         │                              ├─ PRESSURE gain ◄─ source (loop, mono)
         │                              ├─ ASSAULT gain  ◄─ source (loop, mono)
         │                              └─ CLAIM gain    ◄─ source (loop, stereo)
         └─ stingerBus ◄─ one AudioBufferSourceNode per playing stinger (≤ 2)
```

### 16.2 Lifecycle

| State | Entry | Exit |
|---|---|---|
| `idle` | page load | BEGIN / CONTINUE with SOUND ON |
| `unlocked` | context created or resumed **synchronously inside the tap** | start loading |
| `loading` | fetch + `decodeAudioData` (BED first) | BED decoded |
| `playing` | epoch set, all decoded loops started | hidden, SOUND OFF, NEW GAME |
| `suspended` | `document.visibilityState === 'hidden'` (at once) or SOUND OFF (after a 150 ms fade) → `context.suspend()` | visible / SOUND ON → `resume()`, re-derive, restart exact stingers still ahead (section 16.3) |
| `stopped` | NEW GAME: fade 0.5 s, stop sources, clear schedules (decoded buffers kept) | next BEGIN (new epoch) |
| `error` | decode or validation failure of a layer | that layer is skipped; others play |
| `disabled` | `?music=0` (capture), SOUND OFF at BEGIN | — |

**Autoplay:**
- Nothing is created **or fetched** before the BEGIN / CONTINUE tap. The player commits before any music bytes are spent.
- BED downloads and decodes first (776 KB), so music can begin within about 1–2 s on 4G while the gate fades. Every other asset follows in residency order.
- iOS `interrupted` contexts resume on the next tap.

**Reset semantics change (proposed):** NEW GAME currently closes the AudioContext (`useCinematicAudio.reset`). With music it should stop voices and reset the director, but keep the context and the decoded buffers. AudioBuffers are not bound to a context, so the next BEGIN reuses them without re-downloading or re-decoding.

**React StrictMode:** the engine is a module-level singleton and the director is idempotent. Double effects must not create a second source per layer (tested).

### 16.3 Scheduling

- **Epoch:** `round((ctx.currentTime + 0.15) × sr) / sr` at start.
- **A layer starting at time t:** `loop = true`, `loopStart = G`, `loopEnd = G + 38.4`, `start(t, G + mod(t − epoch, 38.4))`. This is the same formula for the initial start and for layers that finish decoding later, so every source shares one playhead.
- **Quantized boundary:** `B = epoch + ceil((now + 0.10 − epoch) / unit) × unit`.
- **Game time → audio time** for exact events: from `ctx.getOutputTimestamp()`, `T = contextTime + (perfMs + SYNC_VISUAL_OFFSET_MS − performanceTime)/1000`. This targets when sound is *heard*, slightly after the frame is shown (section 9). Fall back to `currentTime + (perfMs + SYNC_VISUAL_OFFSET_MS − performance.now())/1000` when unavailable.
- **Stingers:** `start = syncTime − syncOffset`. If that is already past, start now with `offset = elapsed` so the sync point stays on time.
- **Resume (visible or SOUND ON):** the director re-derives targets from the current snapshot and reschedules every exact step that has not started.
  - On a hidden tab, the game shifts presentation start times by the hidden duration. SOUND OFF does not pause the game at all.
  - A resumed context can also come back 100 ms or more late on Android.
  - So a stinger paused mid-play would land late either way. On resume, the director fades out (20 ms) and stops every playing stinger, and restarts each exact stinger whose sync point is still ahead at its re-anchored offset. Nothing else replays.
- **Automation:** `cancelScheduledValues(T)`, `setValueAtTime(modelValue(T), T)`, then `exponentialRampToValueAtTime` (linear in dB) toward a 0.001 floor, then `setValueAtTime(0)` for off. The director keeps its own model of every lane.

### 16.4 Why guard bands, and what they buy

- Browsers decode MP3 into AudioBuffers at the context rate (often 48 kHz). They may or may not trim encoder priming and padding, and resampling filters disturb the first and last few milliseconds.
- With 0.2 s of real neighboring audio on both sides (section 10.3), all of that lands in guards. The runtime loops [0.2 s, 38.6 s).
- If a decoder leaves a priming delay D (≈ 25 ms for MP3), the looped region is still exactly one cycle, rotated by D. Every music file uses the same encoder, so every layer and stinger shifts by the same D: they stay mutually locked, and the whole score sits ≤ 25 ms later relative to the picture. That is inaudible for this game.
- 38.4 s and 0.2 s are whole frames at every common context rate, so loop points never interpolate.

### 16.5 Modes

| Mode | Behavior | Use |
|---|---|---|
| `full` | load, decode, play | production |
| `dry` | full state machine and scheduling against a null sink; no fetch or decode; `data-music-*` attributes still update | e2e and capture |
| `off` | nothing | SOUND OFF, `?music=0` |

---

## 17. Performance and file size

**Decoded PCM (float32) per resident asset**, including guards:

| Asset | Channels | Seconds | MiB @ 44.1 kHz | MiB @ 48 kHz |
|---|---|---:|---:|---:|
| BED, CLAIM (each) | 2 | 38.8 | 13.05 | 14.21 |
| ENGINE, PRESSURE, ASSAULT (each) | 1 | 38.8 | 6.53 | 7.10 |
| **All five loops** | | | **45.69** | **49.73** |
| first-strike | 2 | 12.4 | 4.17 | 4.54 |
| territory-claimed | 2 | 10.0 | 3.36 | 3.66 |
| vesper-arrival, outcome-breach (each) | 1 | 5.2 | 0.87 | 0.95 |
| vesper-retaliation, divider-contact, outcome-hold (each) | 1 | 2.8 | 0.47 | 0.51 |
| **All seven stingers** | | | **10.70** | **11.65** |
| **Everything resident** | | | **56.39** | **61.38** |

**Residency by reachability** (48 kHz):

| Phase of play | Resident | MiB |
|---|---|---:|
| Start | BED + ENGINE | 21.3 |
| From extractor activation (the reveal follows 2.2 s later) | + PRESSURE, ASSAULT, vesper-arrival, vesper-retaliation, divider-contact, outcome-hold, outcome-breach | 38.9 |
| From First Strike READY | + first-strike | 43.5 |
| Once monuments unlock | + CLAIM and territory-claimed | 61.4 |

Nothing is released during a session (simplicity and replays).

**Budget (proposed addition to `PERFORMANCE_BUDGET.md`):** decoded audio 48 MiB typical, 64 MiB hard ceiling, counted toward the 180 / 240 MiB tab footprint. Measure the tab footprint with and without music on the reference phone.

**Mitigation if measurement fails:** decode BED, CLAIM and PRESSURE (all content below 8 kHz) at 24 kHz through an `OfflineAudioContext`. Loops drop to 32.0 MiB. Loop points stay exact (921,600 frames at 24 kHz), and the browser resamples during playback. Do not do this by default.

**Download (MP3, 44.1 kHz, CBR):**
- Stereo 160 kbps: 776 KB per loop.
- Mono 96 kbps: 466 KB per loop.
- Total package 1: **≈ 3.6 MB**. It loads after BEGIN and never blocks first play.
- The current first-playable payload is about 0.94 MB (JS and textures), so the "all first-playable assets" target (8 MiB) still holds even if music were counted.

**Formats:**
- Canonical masters are DaemonV12 WAVs (44.1 kHz PCM16 stereo): the three-cycle render is 20.3 MB per loop, and the cropped loop 6.77 MB. They stay **outside** git and are reproducible from committed project files and render manifests with hashes.
- The game ships guard-banded MP3 (universally decodable by `decodeAudioData`) under `public/music/`, with a manifest tying every file back to its canonical render.

**CPU:** five looping sources, two stingers, a few gain ramps and one limiter. Negligible; no AudioWorklet. Suspending on hidden and on SOUND OFF saves battery.

---

## 18. Failure, recovery and reset

| Situation | Music | Owner of the truth |
|---|---|---|
| First Strike impact | exact vacuum → impact stinger → breath → retaliation | `firstStrikePresentation` phases |
| Counterstrike success / failure | `CS_SUCCESS` + hold / `CS_IMPACT` + breach at contact → arc calm at the next phrase | `counterstrikeRun.status` |
| Outpost damaged | ENGINE −3 dB; PRESSURE −14 dB in `ASCENDANT` until repaired | `counterstrike.outpostDamageState`, `repairsRequired` |
| Repair Gantry completes | modifiers lift at the next phrase (no stinger) | `completeRepairs` effect (`App.tsx` 884–893) |
| Siege breached / repaired | breach; calm with damage modifier; hold when operational | `outpost.orbitalSiege.status` |
| Monument damaged / repaired | `MONUMENT_DAMAGED` + breach; repair completes into the claim reveal | `outpost.monument.status` |
| Combat ends | the cue derivation stops returning a combat cue; release at the next phrase | the reducers, not the music |
| Player idles in a tension state | dwell decay after 2 phrases | director timer (audio clock) |
| Tab hidden mid-set-piece | suspend; on resume, re-anchor on the shifted phase start and restart exact stingers still ahead | `visibilitychange`, presentation `startedAtMs` |
| Refresh mid-encounter | start in the restored state; no stingers for past events | `outpostSave` normalization |
| NEW GAME | fade, stop, clear; gate is silent; BEGIN starts a new epoch | `handleResetPrototype` |

**How "stuck at maximum combat" is prevented:**
1. **No music-owned state.** Combat is a function of `counterstrikeRun.status`, siege and monument status plus advancement, and presentation phases. Each of those has a terminal state owned by tested reducers: `resolved`, `operational` / `damaged`, `activating` / `complete` / `damaged`, `idle`.
2. **Advancement, not existence.** A frozen siege (player in orbit) is not combat.
3. **Dwell decay** covers the states that legitimately wait forever.
4. **The first snapshot after start is a baseline.** Events fire only on edges observed while playing.
5. **Unit tests walk every reducer fixture** through `deriveMusicTarget` and assert that terminal states map to calm cues.

---

## 19. DaemonV12 V0.5 capability and gap assessment

**Verdict: DaemonV12 V0.5 can produce this soundtrack cleanly today, with no engine change.** It needs:
- one project per layer and per stinger;
- three-cycle loop rendering;
- a small deterministic crop, periodicity proof and guard-band encode step that lives in Shoot the Moon's asset build.

| Need | V0.5 status | Class |
|---|---|---|
| Exact loop length, aligned stems | `render.duration.bars`, `tail: "none"`, identical frames | NOT NEEDED (supported) |
| Periodic sample placement | tick → frame rounding is exact; 16 bars = 1,693,440 frames | NOT NEEDED |
| Seam continuity (tails, effect state across the boundary) | not native; single-cycle renders cut tails and start effects cold | **NICE TO HAVE**: native cycle extraction with a periodicity report would bring step 3–4 of section 10.3 inside DaemonV12 provenance. The three-cycle workaround is complete and deterministic. |
| Mono deliverables | stereo PCM16 only | NICE TO HAVE (fold-down in the asset build is lossless for centered content) |
| Stinger sync metadata | not emitted | NOT NEEDED (sync positions are authored musical positions; frames follow the same rounding) |
| Filter automation | static filters only | NOT NEEDED (runtime does ducks; layers need no sweeps) |
| Pitched heavy instrument | samplers are unpitched one-shots; GM via FluidR3 + saturation | NICE TO HAVE: a riff kit is an **asset** task (drum-kit mapping), not an engine feature |
| Momentary / short-term loudness | integrated, LRA, true peak only | NICE TO HAVE (the asset build can measure windows with FFmpeg) |
| 15 tracks per project | enforced | NOT NEEDED (one project per layer, ≤ 15 tracks each) |
| 600 s render limit | enforced | NOT NEEDED (three cycles = 115.2 s) |
| Determinism | byte-identical in the same environment; versions recorded | NOT NEEDED |
| Tempo map, meter change | V1 roadmap | NOT NEEDED (constant 100 BPM) |
| MP3 gaplessness | MP3 is a delivery artifact | NOT NEEDED (web derivatives are built separately with guards) |
| Master ducking | VO reference only | NOT NEEDED (no VO in the game) |
| Real-time synthesis | none, by design | NOT NEEDED (offline renders only) |

**BLOCKER:** none. **NEEDED SOON:** none for DaemonV12. The work that is needed soon is on the Shoot the Moon side: the asset build and the runtime.

Known quality ceilings (not blockers):
- The portfolio report notes the square-lead Claim "may still reveal its GM origin" and that Vesper's metallic-pad articulation is less distinctive than its contour. Mitigations: filtering, short articulation, Foundry-forward arrangement. The V1 roadmap's curated voices are the long-term answer.

---

## 20. Responsibility boundary

| DaemonV12 (Astra, offline) | Shoot the Moon (Codex) |
|---|---|
| Compose each layer and stinger as its own V0.5 project | Snapshot → arc / cue / mix derivation (pure) |
| Render three-cycle loops and exact-length stingers, with stems and analysis | Asset build: crop, periodicity proof, mono fold, guard, MP3, manifest |
| Report loudness, true peak, clipping and provenance | Preload, decode, phase-locked playback |
| Hit unity targets and the pitch-class contract | Quantized gain transitions, stingers, ducks, dwell, rotation |
| Never: runtime logic, game state, browser code | Pause, resume, reset, autoplay; tests; SFX re-leveling |

DaemonV12 never runs at play time, and no DAW is involved at any stage.

---

## 21. Deliverable packages

**Package 1 (minimal, complete):**

| Path (logical id → shipped file through the manifest) | Kind | Channels | Length |
|---|---|---|---|
| `bed` | loop | stereo | 16 bars |
| `engine` | loop | mono | 16 bars |
| `pressure` | loop | mono | 16 bars |
| `assault` | loop | mono | 16 bars |
| `claim` | loop | stereo | 16 bars |
| `vesper-arrival` | stinger | mono | 2 bars |
| `first-strike` | stinger | stereo | 5 bars |
| `vesper-retaliation` | stinger | mono | 1 bar |
| `divider-contact` | stinger | mono | 1 bar |
| `outcome-hold` | stinger | mono | 1 bar |
| `outcome-breach` | stinger | mono | 2 bars |
| `territory-claimed` | stinger | stereo | 4 bars |

Twelve files and ≈ 3.6 MB. Every one maps to code-grounded events in section 2.3.

**Package 2 (after package 1 is measured in play):**
- `claimed-helios`, `claimed-crown`, `claimed-bastion` and `claimed-signal` reveal variants synced to each monument's choreography (section 13).
- An optional `divider-final` double-time variant for FINAL NOTICE.
- An optional riff kit and ASSAULT revision.
- Separate MUSIC and SFX volume controls.

---

## 22. Testability (summary)

The handoff lists every test. They cover:
- identical layer durations and sample-exact loop lengths (manifest and decoded);
- the periodicity proof;
- deterministic state mapping from reducer fixtures;
- edge-triggered stingers with no duplicates and no restore stingers;
- gain targets and invariants, and the H1–H3 headroom rules over all states, stingers and transitions;
- quantization and scheduling math against a fake AudioContext;
- stinger overlap and priority;
- autoplay gating;
- visibility suspend, resume, per-phase re-anchoring and stinger restart;
- SOUND toggle;
- NEW GAME reset;
- StrictMode idempotence;
- end-to-end `data-music-*` assertions in the existing campaign specs.

---

## 23. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decoded memory on 'low' tier phones (61 MiB at 48 kHz) | medium | tab pressure, reloads | residency by reachability; measure on device; 24 kHz decode fallback |
| GM tracks not bit-periodic across cycles | low (reverb/chorus off, block-periodic length) | seams | the periodicity proof fails loudly; fallback: report per-track Δ and fix the content |
| Pitch-class contract violated in composition | medium | clashes in untested combinations | the contract table, combination renders (handoff), listening pass |
| Fatigue in long calm stretches | medium | players mute music | textures, tiered ENGINE, rotation, rests, monument flavors |
| Music buries quiet SFX | high (current −22 dBFS peaks) | lost gameplay cues | SFX re-leveling and alert ducking are acceptance criteria |
| Mobile audio lifecycle quirks (iOS interruption, Android backgrounding) | medium | silence or stuck audio | explicit lifecycle, resume on gesture, tests |
| MP3 decoder delay differs by browser | high | ≤ 25 ms global offset | guard bands keep layers locked; same encoder for all files |
| GM timbre reveals itself | medium | cheaper feel | filtering, Foundry-forward arrangement, package 2 riff kit |
| Visibility / suspend skew vs presentation clock | low | slightly late exact hits | re-anchor on resume; restart exact stingers still ahead |
| Phase-timer lateness before the strike impact | medium on busy phones | the hit leads the flash by up to two timers' lateness | per-phase anchors; `SYNC_VISUAL_OFFSET_MS`, tuned on the reference phone |
| Over-scoring set pieces (music + SFX doubling) | medium | mud at impacts | per-event sub ownership (section 14) |
| E2E / capture slowed or made nondeterministic | medium | CI time | `dry` mode for harness builds, `?music=0` for capture |
| +3.6 MB on cellular | low | data cost | load after BEGIN; skip when SOUND OFF |

---

## 24. Verification record

Computed by script during this audit (Python `fractions` for exact time math):
- 16 bars at 100 BPM = 61,440 ticks = 1,693,440 frames @ 44.1 kHz (27.5625 frames per tick); 48 bars = 5,080,320 frames.
- Loop (38.4 s) and guard (0.2 s) are integer frames at 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2 and 96 kHz.
- Memory, residency and MP3 sizes as in section 17.
- First Strike timeline from `FIRST_STRIKE_PRESENTATION_DURATIONS_MS`: impact-flash begins at 14.8 s, crater-reveal at 19.5 s, ending at 26.1 s. These are nominal: `advanceFirstStrikePresentation` stamps each new phase with `performance.now()` when its timer fires (`App.tsx` 1150), and the visibility handler shifts only the current phase (`App.tsx` 376–407).
- Rival reveal from `RIVAL_PRESENTATION_DURATIONS_MS`: 26.3 s total; impact phase at 13.2 s.
- `COUNTERSTRIKE_MAXIMUM_AUTOMATIC_DURATION_MS` = 1,050 + 3,200 + (5,320 + 3,360 + 1,800) × 2 + 4,400 = 29,610 ms.
- Mix table: 44 state/modifier combinations; layers-only worst case ≤ −1.40 dBFS; with stingers and ducks ≤ −1.13 dBFS; sequenced crossfade envelope over every ordered pair ≤ −1.39 dBFS.

Not done here, because no audio exists yet: listening, real measured loudness and peaks, on-device memory, and browser decode behavior. The handoff's acceptance criteria cover each one.
