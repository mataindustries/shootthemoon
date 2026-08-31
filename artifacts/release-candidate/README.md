# Release-candidate visual evidence

This directory separates the untouched FIRST STRIKE MVP baseline from the
release-candidate captures so production E2E runs cannot overwrite the
before/after comparison set.

- `baseline/` contains the untouched production evidence captured from commit
  `d377cb5` before release-candidate visual source changes. It contains the 14
  named comparison frames and `strike-run.webm`.
- `final/` contains the accepted production-build captures after
  release-candidate verification. It contains 15 named frames and one
  uninterrupted `strike-run.webm` recording that includes arming through the
  ending.
- Working Playwright screenshots outside this directory are disposable test
  output. They are not a substitute for either preserved evidence set.

Required frame sequence:

1. `01-opening.png` — opening title and entry action
2. `02-capsule-miner.png` — landed capsule and deployed miner
3. `03-extractor.png` — active extractor
4. `04-rival-reveal.png` — initial rival escalation
5. `05-rival-close.png` — Null Meridian close view
6. `06-armed.png` — armed warhead and confirmation state
7. `07-ignition.png` — ignition and launcher clearance
8. `08-missile-follow.png` — signature missile-follow framing
9. `09-impact.png` — initial surface impact
10. `10-ejecta.png` — ballistic ejecta and rival destruction
11. `11-scar-close.png` — permanent scar close view
12. `12-scar-orbit.png` — permanent scar from orbit
13. `13-ending.png` — completed ending presentation
14. `14-landscape.png` — 844 × 390 landscape composition
15. `15-restored.png` — completed scar restored after refresh

The primary portrait evidence target is 390 × 844. Comparison review must
inspect structure grounding, silhouette, exposure, shadow continuity, camera
clearance, impact visibility, crater depth and irregularity, mobile type and
touch targets, and the absence of persistent effects after completion.

To inspect the exact production build locally:

    npm run build
    npm run preview -- --host 0.0.0.0

The `final/` set was captured and personally inspected on 2026-08-31. Automated
release gates pass; physical Android acceptance remains deliberately separate.
