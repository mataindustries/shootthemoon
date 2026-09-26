/**
 * END CARD source material — verified project facts only.
 *
 * This is deliberately NOT a Shot: the approved plan is explicit that the
 * final end card is not designed in this phase ("Do not bake these into
 * footage yet"). This module just records the facts that were fact-checked
 * against the live repo at the commit noted below, so whoever builds the
 * end card later doesn't have to re-derive them from scratch — and so any
 * claim that later goes stale is easy to re-verify against the same checks.
 *
 * Re-verification commands (run from the repo root):
 *   - test count:    npx vitest run 2>&1 | tail -5
 *   - bundle size:   npm run build 2>&1 | grep gzip
 *   - dependencies:  the "dependencies"/"devDependencies" block of package.json
 *   - zero models:   find . -iname '*.glb' -o -iname '*.gltf' -o -iname '*.obj' \
 *                       -o -iname '*.fbx' | grep -v node_modules
 */

export interface EndCardFact {
  readonly claim: string
  readonly verified: boolean
  readonly evidence: string
}

export const END_CARD_VERIFICATION_COMMIT = 'b3c965d43b817f179cacf54db6a964b124ec6f29'
export const END_CARD_VERIFIED_AT_ISO = '2026-09-26'

export const END_CARD_FACTS: readonly EndCardFact[] = [
  {
    claim: 'Built with React, TypeScript, Three.js, and React Three Fiber',
    verified: true,
    evidence:
      'package.json: react ^19.2.8, typescript ~6.0.2, three ^0.185.1, ' +
      '@react-three/fiber ^9.7.0',
  },
  {
    claim: 'Deterministic simulation',
    verified: true,
    evidence:
      'All game state derives from pure reducers under src/simulation/** and ' +
      'src/domain/**; capture/e2e both drive real gameplay purely through ' +
      'these reducers plus a fake Playwright clock, with zero non-deterministic ' +
      'inputs (RNG is seeded or absent in the paths exercised).',
  },
  {
    claim: 'Browser game',
    verified: true,
    evidence: 'Vite + React SPA, no native shell; runs entirely client-side in a WebGL2 canvas.',
  },
  {
    claim: 'Mobile-first',
    verified: true,
    evidence:
      'src/styles.css is authored mobile-first with desktop breakpoints layered on ' +
      'top (e.g. @media (min-width:720px) in the Counterstrike HUD); the capture ' +
      'harness’s PORT profile proves real 390x844 touch/mobile behavior end to ' +
      'end for FIRE NOW, FIRE DEFENSE, and the monument-selection UI.',
  },
  {
    claim: 'Code-authored 3D — zero external model files',
    verified: true,
    evidence:
      'Repo-wide search for .glb/.gltf/.obj/.fbx outside node_modules returns zero ' +
      'results; every mesh (Helios Spire, Signal Array, Crater Crown, Bastion ' +
      'Ziggurat, the miner robot, missiles, etc.) is authored procedurally in ' +
      'TypeScript under src/scene/*Model.ts.',
  },
  {
    claim: 'Unit test count',
    verified: true,
    evidence: '576 tests passing across 63 files (`npx vitest run`, run at the commit above).',
  },
  {
    claim: 'Compressed bundle size',
    verified: true,
    evidence:
      'Production build gzip sizes at the commit above: JS 433.01 kB, CSS 12.89 kB, ' +
      'HTML 0.36 kB — total ≈ 446.3 kB gzip. This is commit-dependent and MUST be ' +
      're-verified (`npm run build 2>&1 | grep gzip`) before it appears on the actual ' +
      'end card, since it will drift as the game changes.',
  },
] as const
