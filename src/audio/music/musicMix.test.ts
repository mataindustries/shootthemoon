import { describe, expect, it } from 'vitest'
import * as pipeline from '../../../scripts/music/musicSpec.ts'
import { MONUMENT_KINDS, type MonumentKind } from '../../domain/territoryMonument.ts'
import {
  DIVIDER_WAVE_GAIN_DB,
  LAYER_IDS,
  LAYER_SPECS,
  STAGE_CLEAR,
  STINGER_IDS,
  STINGER_SPECS,
  type LayerId,
  type StingerId,
} from './musicConstants.ts'
import {
  ARCS,
  CALM_CUES,
  CUES,
  HEADROOM_CEILING_DBFS,
  MIX_TABLE,
  MONUMENT_FLAVOR_ENGINE_DB,
  SIEGE_ARC_CELLS,
  TIER_CUES,
  applyModifiers,
  arithmeticPeakDbfs,
  linearSumDbfs,
  mixGains,
  rotationGains,
  type Arc,
  type Cue,
  type LayerGains,
  type MixModifiers,
} from './musicMix.ts'
import type { MusicTarget } from './musicState.ts'
import { classifyTransition, envelopePeakDbfs, planCrossfade, type TransitionSpec } from './musicTransitions.ts'

const NEUTRAL: MixModifiers = {
  arc: 'CONTESTED',
  moduleActive: false,
  siegeOperational: false,
  viewAway: false,
  counterstrikeDamaged: false,
  siegeDamaged: false,
  monumentDamaged: false,
  monumentKind: null,
  counterstrikeActive: false,
  engineOff: false,
}

/** Every modifier combination the snapshot can produce, per arc. */
function* modifierGrid(): Generator<MixModifiers> {
  const flags = [false, true]
  for (const arc of ARCS)
    for (const moduleActive of flags)
      for (const siegeOperational of flags)
        for (const viewAway of flags)
          for (const counterstrikeDamaged of flags)
            for (const siegeDamaged of flags)
              for (const monumentDamaged of flags)
                for (const counterstrikeActive of flags)
                  for (const engineOff of flags)
                    for (const monumentKind of [null, ...MONUMENT_KINDS] as (MonumentKind | null)[]) {
                      yield { arc, moduleActive, siegeOperational, viewAway, counterstrikeDamaged, siegeDamaged, monumentDamaged, counterstrikeActive, engineOff, monumentKind }
                    }
}

/** The loudest variant of every reachable mix (only these modifiers can raise a layer). */
function loudestVariants(): { readonly id: string; readonly cue: Cue; readonly arc: Arc; readonly gains: LayerGains }[] {
  const variants: { id: string; cue: Cue; arc: Arc; gains: LayerGains }[] = []
  for (const cue of CUES) {
    const row = MIX_TABLE[cue]
    if (Object.keys(row).length === 0) continue
    const arcs: Arc[] = Object.values(row).includes('arc') ? ['FOOTHOLD', 'CONTESTED', 'CLAIMED'] : ['CONTESTED']
    for (const arc of arcs) {
      const base = mixGains(cue, { ...NEUTRAL, arc })
      variants.push({ id: `${cue}@${arc}`, cue, arc, gains: base })
      if ((TIER_CUES as readonly Cue[]).includes(cue)) {
        variants.push({ id: `${cue}+tier`, cue, arc, gains: mixGains(cue, { ...NEUTRAL, arc, moduleActive: true, siegeOperational: true }) })
      }
      if (cue === 'ASCENDANT') {
        variants.push({ id: 'ASCENDANT+tier+damaged', cue, arc, gains: mixGains(cue, { ...NEUTRAL, arc, moduleActive: true, siegeOperational: true, counterstrikeDamaged: true }) })
      }
      if (cue === 'CLAIMED') {
        variants.push({ id: 'CLAIMED+helios', cue, arc: 'CLAIMED', gains: mixGains(cue, { ...NEUTRAL, arc: 'CLAIMED', monumentKind: 'HELIOS_SPIRE' }) })
      }
    }
  }
  return variants
}

describe('music mix: the table the asset build audited', () => {
  it('matches the pipeline transcription exactly', () => {
    expect(MIX_TABLE).toEqual(pipeline.MIX_TABLE)
    expect([...CALM_CUES]).toEqual([...pipeline.CALM_CUES])
    expect([...TIER_CUES]).toEqual([...pipeline.TIER_CUES])
    expect(SIEGE_ARC_CELLS).toEqual(pipeline.SIEGE_ARC_CELLS)
    expect(MONUMENT_FLAVOR_ENGINE_DB.HELIOS_SPIRE).toBe(pipeline.CLAIMED_LOUDEST_FLAVOR_ENGINE_DB)
    for (const spec of pipeline.LOOP_SPECS) {
      expect(LAYER_SPECS[spec.id]).toEqual({ channels: spec.channels, unityLufs: spec.unityLufs, truePeakCeilingDbtp: spec.truePeakCeilingDbtp })
    }
    for (const spec of pipeline.STINGER_SPECS) {
      const runtime = STINGER_SPECS[spec.id]
      expect([runtime.bars, runtime.channels, runtime.priority, runtime.truePeakCeilingDbtp]).toEqual([spec.bars, spec.channels, spec.priority, spec.truePeakCeilingDbtp])
      expect(runtime.syncSeconds).toBeCloseTo(pipeline.positionToFrames(spec.syncPosition) / pipeline.CANONICAL_SAMPLE_RATE, 9)
      expect([...runtime.timing]).toEqual([...spec.timing])
      if (spec.duck.kind === 'duck') expect(runtime.duck).toEqual({ kind: 'duck', gainDb: spec.duck.gainDb, bars: spec.duck.bars })
      else expect(runtime.duck.kind).toBe(spec.duck.kind)
      if (spec.waveGainDb !== null) expect([...DIVIDER_WAVE_GAIN_DB]).toEqual([...spec.waveGainDb])
    }
    expect(STAGE_CLEAR).toMatchObject({ bedGainDb: -12, fadeSeconds: 0.3, resumeAfterSeconds: 8.4, resumeSwellBars: 1 })
  })
})

describe('music mix: modifiers', () => {
  it('applies tier, view, damage and monument flavor in order', () => {
    // Tier: +1 dB for the module, +1 dB for an operational siege, only in the tier cues.
    expect(mixGains('FOOTHOLD_WORKS', { ...NEUTRAL, arc: 'FOOTHOLD', moduleActive: true, siegeOperational: true }).engine).toBe(-2)
    expect(mixGains('FOOTHOLD', { ...NEUTRAL, arc: 'FOOTHOLD', moduleActive: true }).engine).toBe(-12)
    expect(mixGains('CS_ALERT', { ...NEUTRAL, moduleActive: true, viewAway: true, counterstrikeActive: true }).engine).toBe(-8)
    // View: ENGINE −4 dB away from the surface, calm cues only.
    expect(mixGains('CONTESTED', { ...NEUTRAL, viewAway: true }).engine).toBe(-8)
    expect(mixGains('REVEAL_SETTLE', { ...NEUTRAL, viewAway: true }).engine).toBe(-8)
    // Damage: ENGINE −3 dB; in ASCENDANT the counterstrike wound brings PRESSURE in at −14 dB.
    expect(mixGains('ASCENDANT', { ...NEUTRAL, arc: 'ASCENDANT', counterstrikeDamaged: true })).toEqual({ bed: 0, engine: -7, pressure: -14 })
    expect(mixGains('ASCENDANT', { ...NEUTRAL, arc: 'ASCENDANT', siegeDamaged: true })).toEqual({ bed: 0, engine: -7 })
    expect(mixGains('RETALIATION', { ...NEUTRAL, arc: 'RETALIATION', monumentDamaged: true, viewAway: true, moduleActive: true })).toEqual({ bed: 0, engine: -12, pressure: -5 })
    // Monument flavor sets CLAIMED's ENGINE, after the other modifiers.
    for (const kind of MONUMENT_KINDS) {
      expect(mixGains('CLAIMED', { ...NEUTRAL, arc: 'CLAIMED', monumentKind: kind, viewAway: true, counterstrikeDamaged: true }).engine).toBe(MONUMENT_FLAVOR_ENGINE_DB[kind])
    }
    expect(MONUMENT_FLAVOR_ENGINE_DB).toEqual({ HELIOS_SPIRE: -4, BASTION_OBELISK: -6, CRATER_CROWN: -10, SIGNAL_ARRAY: -12 })
    // Order matters: tier before view before damage, all on top of the table value.
    expect(applyModifiers('CONTESTED', { bed: 0, engine: -4, pressure: -10 }, { ...NEUTRAL, moduleActive: true, viewAway: true, siegeDamaged: true }).engine).toBe(-4 + 1 - 4 - 3)
  })

  it('resolves the siege arc cells: CONTESTED → PRESSURE −12, CLAIMED → CLAIM −10, otherwise off', () => {
    expect(mixGains('SIEGE_COMBAT', { ...NEUTRAL, arc: 'CONTESTED' })).toEqual({ bed: -4, engine: -8, pressure: -12, assault: 0 })
    expect(mixGains('SIEGE_COMBAT', { ...NEUTRAL, arc: 'CLAIMED' })).toEqual({ bed: -4, engine: -8, assault: 0, claim: -10 })
    expect(mixGains('SIEGE_BUILD', { ...NEUTRAL, arc: 'FOOTHOLD' })).toEqual({ bed: 0, engine: 0 })
    expect(mixGains('SIEGE_REPAIR', { ...NEUTRAL, arc: 'ASCENDANT' })).toEqual({ bed: 0, engine: -2 })
  })

  it('turns ENGINE off for scar exploration and thins / rests by rotation', () => {
    expect(mixGains('RETALIATION', { ...NEUTRAL, arc: 'RETALIATION', engineOff: true })).toEqual({ bed: 0, pressure: -5 })
    expect(rotationGains({ bed: 0, engine: -4, pressure: -10 }, 'thin')).toEqual({ bed: 0, pressure: -16 })
    expect(rotationGains({ bed: 0, engine: -8, claim: 0 }, 'thin')).toEqual({ bed: 0, claim: -4 })
    expect(rotationGains({ bed: 0, engine: -8, claim: 0 }, 'rest')).toEqual({})
  })
})

describe('music mix: invariants and headroom', () => {
  it('I1, I2 and I3 hold for every cue × modifier combination', () => {
    let worst = { id: '', dbfs: -Infinity }
    let combinations = 0
    const violations: string[] = []
    for (const modifiers of modifierGrid()) {
      for (const cue of CUES) {
        const gains = mixGains(cue, modifiers)
        combinations += 1
        // I1: CLAIM never during a Counterstrike, never with PRESSURE.
        if (modifiers.counterstrikeActive && gains.claim !== undefined) violations.push(`I1 claim in a Counterstrike: ${cue}`)
        if (gains.claim !== undefined && gains.pressure !== undefined) violations.push(`I1 claim with pressure: ${cue}`)
        // I2: no layer above 0 dB.
        if (LAYER_IDS.some((layer) => (gains[layer] ?? -Infinity) > 0)) violations.push(`I2: ${cue}`)
        // I3 (H1): the coincident-peak sum stays at or below −1 dBFS.
        const peak = arithmeticPeakDbfs(gains)
        if (peak > worst.dbfs) worst = { id: cue, dbfs: peak }
      }
    }
    expect(violations).toEqual([])
    expect(combinations).toBeGreaterThan(100_000)
    expect(worst.dbfs).toBeLessThanOrEqual(HEADROOM_CEILING_DBFS)
    // The bible's verification record: CS_COMBAT at −1.40 dBFS is the loudest mix.
    expect(worst.id).toBe('CS_COMBAT')
    expect(worst.dbfs).toBeCloseTo(-1.4, 2)
  })

  it('H2: every allowed (cue, stinger) pair stays under −1 dBFS after its duck and wave gain', () => {
    const variants = loudestVariants()
    const calm = variants.filter((variant) => (CALM_CUES as readonly Cue[]).includes(variant.cue))
    const of = (...cues: Cue[]) => variants.filter((variant) => cues.includes(variant.cue))
    const contexts: Record<StingerId, { mixes: typeof variants; gains: readonly number[] }[]> = {
      'vesper-arrival': [{ mixes: [...calm, ...of('REVEAL_APPROACH')], gains: [0] }],
      'first-strike': [{ mixes: of('FS_FLIGHT', 'FS_TRANSMISSION'), gains: [0] }],
      'vesper-retaliation': [{ mixes: [...calm, ...of('CS_ALERT')], gains: [0] }],
      'divider-contact': [
        { mixes: of('SIEGE_BUILD', 'SIEGE_ALERT', 'MONUMENT_ALERT', 'MONUMENT_ALERT_DWELL'), gains: [0] },
        { mixes: of('SIEGE_COMBAT', 'MONUMENT_COMBAT'), gains: DIVIDER_WAVE_GAIN_DB },
      ],
      'outcome-hold': [{ mixes: [...calm, ...of('CS_COMBAT', 'CS_SUCCESS', 'SIEGE_COMBAT', 'SIEGE_REPAIR', 'MONUMENT_COMBAT', 'MONUMENT_ACTIVATING')], gains: [0] }],
      'outcome-breach': [{ mixes: [...calm, ...of('CS_COMBAT', 'CS_IMPACT', 'SIEGE_COMBAT', 'MONUMENT_COMBAT', 'MONUMENT_DAMAGED')], gains: [0] }],
      'territory-claimed': [{ mixes: of('MONUMENT_ACTIVATING', 'MONUMENT_REVEAL'), gains: [0] }],
    }
    let worst = { id: '', dbfs: -Infinity }
    let pairs = 0
    for (const id of STINGER_IDS) {
      const spec = STINGER_SPECS[id]
      for (const group of contexts[id]) {
        for (const variant of group.mixes) {
          for (const gain of group.gains) {
            const ducked: Partial<Record<LayerId, number>> = {}
            for (const layer of LAYER_IDS) {
              const value = variant.gains[layer]
              if (value === undefined) continue
              if (spec.duck.kind === 'duck') ducked[layer] = value + spec.duck.gainDb
              else if (spec.duck.kind === 'stage-clear' && layer === 'bed') ducked[layer] = STAGE_CLEAR.bedGainDb
              // vacuum: every layer is off at the impact; stage clear: every non-bed layer is off.
            }
            const peak = arithmeticPeakDbfs(ducked, [spec.truePeakCeilingDbtp + gain])
            pairs += 1
            expect(peak, `${id} over ${variant.id} +${gain} dB`).toBeLessThanOrEqual(HEADROOM_CEILING_DBFS)
            if (peak > worst.dbfs) worst = { id: `${id}|${variant.id}|+${gain}`, dbfs: peak }
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(90)
    // The bible's record: MONUMENT_COMBAT with the third-wave divider-contact, −1.13 dBFS.
    expect(worst.id).toBe('divider-contact|MONUMENT_COMBAT@CONTESTED|+2')
    expect(worst.dbfs).toBeCloseTo(-1.13, 2)
  })

  function target(variant: { cue: Cue; arc: Arc; gains: LayerGains }): MusicTarget {
    return { cue: variant.cue, arc: variant.arc, gains: variant.gains, dwellKey: null, viewAway: false }
  }

  it('H3: every ordered pair of mixes crossfades under −1 dBFS with sequenced rises (200 samples)', () => {
    const variants = [{ id: 'SILENT', cue: 'SILENT' as Cue, arc: 'RECON' as Arc, gains: {} }, ...loudestVariants()]
    const sequenced: TransitionSpec = { unit: 'bar', fadeSeconds: 2.4, hard: false, sequenced: true }
    let worstSequenced = -Infinity
    let worstPlanned = { id: '', dbfs: -Infinity }
    for (const from of variants) {
      for (const to of variants) {
        if (from === to) continue
        const plain = envelopePeakDbfs(from.gains, planCrossfade(from.gains, to.gains, 0, sequenced), 200)
        worstSequenced = Math.max(worstSequenced, plain)
        // The director's own plan for the pair (hard ASSAULT entrances where they stay safe).
        const transition = classifyTransition(target(from), target(to))
        const planned = envelopePeakDbfs(from.gains, planCrossfade(from.gains, to.gains, 0, transition), 200)
        if (planned > worstPlanned.dbfs) worstPlanned = { id: `${from.id}→${to.id}`, dbfs: planned }
      }
    }
    expect(worstSequenced).toBeLessThanOrEqual(HEADROOM_CEILING_DBFS)
    expect(worstSequenced).toBeCloseTo(-1.4, 1)
    expect(worstPlanned.dbfs).toBeLessThanOrEqual(HEADROOM_CEILING_DBFS)
  })

  it('a hard ASSAULT entrance that would break H3 is sequenced instead', () => {
    const from = mixGains('CLAIMED', { ...NEUTRAL, arc: 'CLAIMED', monumentKind: 'HELIOS_SPIRE' })
    const to = mixGains('FS_FLIGHT', { ...NEUTRAL, arc: 'CLAIMED' })
    const hard: TransitionSpec = { unit: 'beat', fadeSeconds: 0.6, hard: true, sequenced: true }
    const moves = planCrossfade(from, to, 0, hard)
    const assault = moves.find((move) => move.layer === 'assault')
    expect(assault?.start).toBeCloseTo(0.3, 9)
    expect(assault?.end).toBeCloseTo(0.9, 9)
    expect(envelopePeakDbfs(from, moves)).toBeLessThanOrEqual(HEADROOM_CEILING_DBFS)
    const warning = mixGains('CS_WARNING', NEUTRAL)
    const combat = mixGains('CS_COMBAT', NEUTRAL)
    expect(planCrossfade(warning, combat, 0, hard).find((move) => move.layer === 'assault')).toMatchObject({ start: 0, end: 0.02 })
  })

  it('sums peaks in dBFS', () => {
    expect(linearSumDbfs([-6.0206, -6.0206])).toBeCloseTo(0, 3)
    expect(linearSumDbfs([])).toBe(-Infinity)
  })
})
