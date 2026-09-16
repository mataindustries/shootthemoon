# Mining repair validation

Uncommitted repair on `f372838`. The pre-existing mining asset pass is retained; [starting status](validation/starting-status.txt) records it. No commit or push.

## Evidence reviewed

Enumerated all five MP4s and the JPG in `/tmp/shootmoon-evidence` before changing gameplay code. Decoded the four intact videos end to end and reviewed chronological filmstrips across their full durations, with quarter-second detail around worker motion. Retained [review sheets and decoding counts](review/).

| File | Reviewed interval / relevant evidence |
| --- | --- |
| `2026_09_15_20_25_58.mp4` | Truncated: missing `moov` index and final media bytes. Recovered all 2,778 complete H.264 frames using the matching codec configuration from the next clip. Frames 450–750 show approach/landing; 780–1770 show deployment, mining and return; 1800–1950 extractor construction; remainder rival reveal. Original timestamps and missing ending cannot be recovered. |
| `2026_09_15_20_27_34.mp4` | 0–32.77 s. Workers stay near the extractor instead of reaching capsule service; inspected 1–11 s at quarter-second intervals. Manual miner departure/mining/return at 26–32.77 s provides preservation reference. |
| `2026_09_15_20_28_37.mp4` | 0–26.79 s. Launch confirmation at 3–5.2 s; launch, flight and impact thereafter. |
| `2026_09_15_20_30_05.mp4` | 0–77.73 s. Gantry construction at 3–6 s; irregular worker motion through 6–23 s inspected in detail. Platform defense windows around 44–46, 52–55 and 60–63 s. Manual mining again at 73–77.73 s. |
| `2026_09_15_20_32_12.mp4` | 0–62.95 s. Monument defense windows at 6–10, 14–19 and 24–29 s; visible laser at about 29 s. Completion/reveal/orbit through the ending. |
| `Screenshot_2026-09-15-20-29-47-321.jpg` | Damaged extractor/crater and structural-damage outcome; corroborates the damage state. |

The local baseline reproduced a **4.3 m worker jump between 100 ms samples** during gradual repair ([raw positions](before/repair-motion.json)). Its cause was recomputing phase from epoch time divided by a changing production-dependent cycle. Normal baseline samples moved at most 0.509 m over the same interval.

## Repair

- Replaced epoch-based shuttle sampling with bounded, persistent presentation navigation. Cached paths avoid capsule/lander, deposits, module footprints, structural couplings and the impact area. Future build slots and impact area stay clear before they appear; repair percentages never reset route progress.
- Added `capsule-service-dock` under the actual lander. Its surface-projected berth is 5.3 m from the capsule origin, leaving 0.5 m between conservative chassis/landing-leg envelopes. Workers service it in turn while others work at the extractor. Narrow-route ownership and parked-worker clearance prevent head-on deadlocks and overlap.
- Kept the manual miner’s existing routes/camera targets. Worker traffic leaves its departure area clear and yields on a commanded mining job, then resumes its previous task. Wheel contact still uses rendered terrain; wheel rotation follows traveled distance.
- The exact launch confirmation copy, platform active defense and repaired landing camera were already present. Removed the remaining “Prototype complete” accessibility label from the strike ending; preserved cancel/fire, defense and camera behavior. Strengthened exact launch-copy/reopen coverage and added one shared browser test exercising both construction paths and single wave resolution.
- Compared landing against `94a28a0`/`551daff` camera history and existing touchdown/settled artifacts. Existing coverage protects bowed descent, contact, 0.62 s hold, exact settled pose, projection, input handoff and surface clearance.

Simulation/resource/allocation/storage/damage-effect/wave-resolution/save/persistence/monument code, asset geometry/materials, mobile controls and unrelated cameras are untouched by this repair.

## Verification

- `npm test -- --maxWorkers=2`: **45 files / 328 tests passed**, including 17 navigation/docking cases. These exercise all three deposits, all module layouts, gradual repair, recovery, clock discontinuities, allocation changes and actual manual-miner routes.
- `npm run lint` and `npm run typecheck`: passed.
- Harness production build and the two focused worker browser tests: passed. Final browser samples moved at most **0.310 m per 232 ms sample**, with stable route revisions during gradual repair; [metrics](validation/navigation-summary.json). The fixed-step unit limit is 0.12 m per 50 ms.
- `npm run build`: passed (ordinary production bundle; existing chunk-size advisory). The existing manual-mining/cargo-return browser regression also passed. **All six production browser cases passed**: shared platform/monument defense parity; monument hit/miss/hit, save and replay; platform three-wave outcomes; small-phone controls; exact nuke copy, reopen, cancel and fire; landing descent, touchdown, hold and settled framing. Nine browser tests passed across the three final runs.
- `git diff --check`: passed. No unrelated files were changed by this repair; pre-existing dirty files remain. [Scope audit](validation/scope-audit.json) distinguishes pre-existing work from this repair.

Logs are in [validation](validation/). [Before](before/) and [after](after/) captures retain the HUD; `-assets.png` supplements hide only DOM panels for inspection of the same camera view.

## Limits

The first uploaded video is incomplete, so its original timestamps and missing tail could not be reviewed. Browser evidence uses headless Chromium/SwiftShader with mobile touch emulation; physical Android frame pacing is not measured. An initial normal-state browser run timed out at scene startup while the full unit suite was running; isolated reruns are recorded separately. Existing large HUD panels obscure parts of the surface; this repair does not redesign them.
