/**
 * Capture-only fixture wrappers.
 *
 * These reuse the existing e2e fixture/save-building architecture
 * (`e2e/firstStrikeFixtures.ts`, `e2e/rivalFixtures.ts`, the real reducers
 * under `src/simulation/**`, and `src/persistence/outpostSave.ts`) instead
 * of hand-writing save JSON. Only the monument-completion wrapper below
 * fabricates a JSON patch, and it does so the same way
 * `e2e/helios-reactor.spec.ts` already does for its own Helios fixture; we
 * generalize that exact pattern across all four monument kinds and validate
 * the result with the real `parseTerritoryMonument` guard.
 *
 * Definitions (from the Opus 5.5 reel audit):
 *   FRESH      — no save.
 *   EXTRACTOR  — existing active-extractor fixture, ~40 ore.
 *   READY      — existing strike-ready fixture.
 *   STRUCK     — completed First Strike fixture.
 *   CLAIM      — accepted Counterstrike fixture, enough ore for monument work.
 *   MON(kind)  — CLAIM plus a completed selected monument, revealSeen false.
 */
import {
  createAcceptedCounterstrikeSave,
  createCompletedStrikeSave,
  createStrikeReadySave,
} from '../e2e/firstStrikeFixtures.ts'
import { createLegacyActiveExtractorSave } from '../e2e/rivalFixtures.ts'
import {
  MONUMENT_KINDS,
  MONUMENTS,
  parseTerritoryMonument,
  type MonumentKind,
  type TerritoryMonumentSnapshot,
} from '../src/domain/territoryMonument.ts'

export type FixtureId =
  | 'FRESH'
  | 'EXTRACTOR'
  | 'READY'
  | 'STRUCK'
  | 'CLAIM'
  | 'CLAIM_RICH'
  | 'DIVIDER_SURVIVED'
  | `MON_${MonumentKind}`

export { MONUMENT_KINDS }
export type { MonumentKind }

/** null means "no save" (FRESH): the caller must not seed localStorage. */
export function buildFixtureSave(fixture: FixtureId, nowMs = Date.now()): string | null {
  if (fixture === 'FRESH') return null
  if (fixture === 'EXTRACTOR') return createLegacyActiveExtractorSave(nowMs)
  if (fixture === 'READY') return createStrikeReadySave(nowMs)
  if (fixture === 'STRUCK') return createCompletedStrikeSave(nowMs)
  if (fixture === 'CLAIM') return createAcceptedCounterstrikeSave('SUCCESS', nowMs)
  if (fixture === 'CLAIM_RICH') return buildClaimRichSave(nowMs)
  if (fixture === 'DIVIDER_SURVIVED') return buildDividerSurvivedSave(nowMs)

  const kind = fixture.slice('MON_'.length) as MonumentKind
  if (!MONUMENT_KINDS.includes(kind)) {
    throw new Error(`Unknown monument kind in fixture id: ${fixture}`)
  }
  return buildMonumentClaimSave(kind, false, nowMs)
}

/**
 * CLAIM with lunarOre patched up to comfortably cover any monument's ore
 * cost (highest is BASTION_OBELISK at 100) — the same direct-JSON-ore-patch
 * precedent already used by e2e/wave-defense-feedback.spec.ts (`raw.outpost.
 * lunarOre = 230`) and e2e/territory-monuments.spec.ts (`= 230`). Needed for
 * shots that actually walk the monument-construction/DIVIDER-wave-defense
 * flow (not just the kind-choice panel, which CLAIM alone already renders).
 */
function buildClaimRichSave(nowMs: number): string {
  const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS', nowMs)) as {
    outpost: { lunarOre: number }
  }
  raw.outpost.lunarOre = 230
  return JSON.stringify(raw)
}

/**
 * CLAIM plus a completed `kind` monument with the given `revealSeen`.
 * Mirrors `heliosSave()` in e2e/helios-reactor.spec.ts, generalized across
 * every monument kind, then validated with the real domain parser so a
 * hand-patched fixture can never silently drift from what the game accepts.
 */
export function buildMonumentClaimSave(
  kind: MonumentKind,
  revealSeen: boolean,
  nowMs = Date.now(),
): string {
  const raw = JSON.parse(createAcceptedCounterstrikeSave('SUCCESS', nowMs)) as {
    outpost: { monument: unknown }
  }

  const monument: TerritoryMonumentSnapshot = {
    kind,
    anchor: kind === 'CRATER_CROWN' ? 'impact-scar' : 'outpost',
    status: 'complete',
    phaseElapsedMs: 0,
    workMs: MONUMENTS[kind].laborMs,
    repairWorkMs: 0,
    health: 100,
    wavesResolved: 3,
    orders: ['DEFEND', 'DEFEND', 'DEFEND'],
    productionPenalty: 0,
    energyLoss: 0,
    oreLost: 0,
    completedAtMs: nowMs - 1_000,
    revealSeen,
  }

  if (parseTerritoryMonument(monument) === undefined) {
    throw new Error(
      `Fabricated ${kind} monument fixture failed the real domain validator.`,
    )
  }

  raw.outpost.monument = monument
  return JSON.stringify(raw)
}

/**
 * A deliberately seeded equivalent of `divider-monument-survives`'s live
 * end state: CLAIM_RICH, the SIGNAL_ARRAY monument (the manifest's own
 * DIVIDER_DEMO_KIND), played through all three DIVIDER waves with a
 * successful DEFEND each time. Reuses `buildMonumentClaimSave` exactly —
 * the same domain shape (wavesResolved: 3, health 100, all DEFEND, no
 * losses/penalty) already proven by the existing MON_<KIND> Act VI
 * reveal-shot fixtures — with one difference: `revealSeen: true`, so
 * dismissing the launch gate auto-opens the monument view directly onto
 * the settled "complete" camera pose (progress=1; see the `!revealSeen`
 * gate on the reveal-cinematic timer in src/App.tsx) instead of a reveal
 * sweep or the live construction/combat flow.
 *
 * The point: the "held wide of the completed, undamaged monument" pose the
 * live 3-wave capture ends on is a pure function of this same domain state
 * (status/wavesResolved/etc.), not of how that state was reached. Loading
 * it fresh — the same thing every MON_<KIND> Act VI shot already does at
 * PLATE/4K without issue — skips the three waves' worth of accumulated
 * live wave-defense VFX (missile fire, defense beams, debris) that made
 * the original capture too expensive for a SwiftShader 4K readback,
 * without changing the state being photographed at all.
 */
export function buildDividerSurvivedSave(nowMs = Date.now()): string {
  return buildMonumentClaimSave('SIGNAL_ARRAY', true, nowMs)
}
