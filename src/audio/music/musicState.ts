/**
 * Game state → music state (handoff section 3) and snapshot edges → events
 * (handoff 4.1). Pure functions of the game's own snapshots: the music system
 * owns no campaign state, so a combat cue ends exactly when the reducers end it.
 */
import type { FirstStrikePresentationPhase } from '../../app/firstStrikePresentation.ts'
import type { RivalPresentationPhase } from '../../app/rivalPresentation.ts'
import type { CounterstrikeOutcome } from '../../domain/counterstrike.ts'
import type { FirstStrikeStatus } from '../../domain/firstStrike.ts'
import { siegeIsActive, type OrbitalSiegeSnapshot } from '../../domain/orbitalSiege.ts'
import type { RivalRevealStatus } from '../../domain/rival.ts'
import type { TerritoryMonumentSnapshot } from '../../domain/territoryMonument.ts'
import type { CounterstrikeRunStatus } from '../../simulation/counterstrikeSimulation.ts'
import type { ExperiencePhase } from '../../simulation/moonCoreState.ts'
import { COUNTERSTRIKE_CONTACT_MS, DIVIDER_WAVE_GAIN_DB, type StingerId } from './musicConstants.ts'
import { isCalmCue, mixGains, type Arc, type CalmCue, type Cue, type LayerGains } from './musicMix.ts'

export interface MusicSnapshot {
  readonly entryOpen: boolean
  readonly phase: ExperiencePhase
  readonly monumentView: boolean
  readonly outpost: null | {
    readonly extractorActive: boolean
    readonly moduleActive: boolean
    readonly siege: OrbitalSiegeSnapshot | null
    readonly monument: TerritoryMonumentSnapshot | null
  }
  readonly rivalRevealStatus: RivalRevealStatus | null
  readonly rivalPhase: RivalPresentationPhase
  readonly firstStrikeStatus: FirstStrikeStatus | null
  readonly strikePhase: FirstStrikePresentationPhase
  /** performance.now() when the current strike phase began. */
  readonly strikePhaseStartedAtMs: number
  readonly strikeConfirmationOpen: boolean
  readonly acceptedOutcome: CounterstrikeOutcome | null
  readonly counterstrikeDamaged: boolean
  readonly csStatus: CounterstrikeRunStatus
  /** performance.now() when the current Counterstrike phase began. */
  readonly csPhaseStartedAtMs: number
  readonly platformDefenseWave: number | null
  /** performance.now() when the monument reveal began. */
  readonly monumentRevealAtMs: number | null
}

export function counterstrikeIdle(status: CounterstrikeRunStatus): boolean {
  return status === 'dormant' || status === 'resolved'
}

export function presentationsIdle(s: MusicSnapshot): boolean {
  return s.rivalPhase === 'idle' && s.strikePhase === 'idle' && counterstrikeIdle(s.csStatus)
}

/** Mirrors the App tick effect: a siege advances only on the surface or in the monument view, between presentations. */
export function siegeAdvancing(s: MusicSnapshot): boolean {
  return siegeIsActive(s.outpost?.siege ?? null) && (s.phase === 'landed' || s.monumentView) && presentationsIdle(s)
}

export function deriveArc(s: MusicSnapshot): Arc {
  if (s.outpost === null) return 'RECON'
  if (s.outpost.monument?.status === 'complete') return 'CLAIMED'
  if (s.firstStrikeStatus === 'COMPLETE' && s.acceptedOutcome === null) return 'RETALIATION'
  if (s.acceptedOutcome !== null) return 'ASCENDANT'
  if (s.rivalRevealStatus === 'REVEALED') return 'CONTESTED'
  return 'FOOTHOLD'
}

export function arcCalmCue(arc: Arc, s: MusicSnapshot): CalmCue {
  if (arc === 'FOOTHOLD') return s.outpost?.extractorActive === true ? 'FOOTHOLD_WORKS' : 'FOOTHOLD'
  return arc
}

const STRIKE_CUES: Readonly<Partial<Record<FirstStrikePresentationPhase, Cue>>> = {
  arming: 'FS_FLIGHT',
  launch: 'FS_FLIGHT',
  'orbital-flight': 'FS_FLIGHT',
  'target-approach': 'FS_FLIGHT',
  'vesper-transmission': 'FS_TRANSMISSION',
  'impact-flash': 'FS_VACUUM',
  ejecta: 'FS_VACUUM',
  'crater-reveal': 'FS_BREATH',
  'orbital-pullback': 'FS_BREATH',
  ending: 'FS_BREATH',
}

const COUNTERSTRIKE_CUES: Readonly<Partial<Record<CounterstrikeRunStatus, Cue>>> = {
  command: 'CS_ALERT',
  'command-confirmed': 'CS_ALERT',
  warning: 'CS_WARNING',
  tracking: 'CS_COMBAT',
  'intercept-ready': 'CS_COMBAT',
  'interceptor-launched': 'CS_COMBAT',
  missed: 'CS_COMBAT',
  impact: 'CS_IMPACT',
  success: 'CS_SUCCESS',
}

const RIVAL_CUES: Readonly<Partial<Record<RivalPresentationPhase, Cue>>> = {
  warning: 'REVEAL_APPROACH',
  'orbital-transition': 'REVEAL_APPROACH',
  'capsule-approach': 'REVEAL_APPROACH',
  impact: 'REVEAL_IMPACT',
  'intro-transmission': 'REVEAL_TRANSMISSION',
  'dual-sites': 'REVEAL_SETTLE',
  'rival-focus': 'RIVAL_FOCUS',
  'rival-focused': 'RIVAL_FOCUS',
  scanning: 'RIVAL_FOCUS',
  contested: 'RIVAL_FOCUS',
  'scan-response': 'RIVAL_TRANSMISSION',
}

const SIEGE_CUES: Readonly<Record<'constructing' | 'command' | 'waves' | 'repairing', Cue>> = {
  constructing: 'SIEGE_BUILD',
  command: 'SIEGE_ALERT',
  waves: 'SIEGE_COMBAT',
  repairing: 'SIEGE_REPAIR',
}

interface CueDecision {
  readonly cue: Cue
  /** Rule 9: scar exploration plays the arc calm cue with ENGINE off. */
  readonly engineOff: boolean
}

/** Handoff 3.3, first match wins. "Music not started" is the director's rule 1. */
function decideCue(s: MusicSnapshot): CueDecision {
  if (s.entryOpen) return { cue: 'SILENT', engineOff: false }
  const strikeCue = STRIKE_CUES[s.strikePhase]
  if (strikeCue !== undefined) return { cue: strikeCue, engineOff: false }
  const counterstrikeCue = COUNTERSTRIKE_CUES[s.csStatus]
  if (counterstrikeCue !== undefined) return { cue: counterstrikeCue, engineOff: false }
  if (s.monumentRevealAtMs !== null && s.monumentView) return { cue: 'MONUMENT_REVEAL', engineOff: false }
  const rivalCue = RIVAL_CUES[s.rivalPhase]
  if (rivalCue !== undefined) return { cue: rivalCue, engineOff: false }
  const siege = s.outpost?.siege ?? null
  if (siege !== null && siegeAdvancing(s) && siege.status in SIEGE_CUES) {
    return { cue: SIEGE_CUES[siege.status as keyof typeof SIEGE_CUES], engineOff: false }
  }
  const calm = arcCalmCue(deriveArc(s), s)
  if (s.monumentView) {
    const monument = s.outpost?.monument ?? null
    switch (monument?.status) {
      case undefined: return { cue: 'MONUMENT_CHOICES', engineOff: false }
      case 'constructing': return { cue: 'MONUMENT_BUILD', engineOff: false }
      case 'command': return { cue: 'MONUMENT_ALERT', engineOff: false }
      case 'wave': return { cue: 'MONUMENT_COMBAT', engineOff: false }
      case 'activating': return { cue: 'MONUMENT_ACTIVATING', engineOff: false }
      case 'damaged':
      case 'repairing': return { cue: 'MONUMENT_DAMAGED', engineOff: false }
      case 'complete': return { cue: calm, engineOff: false }
    }
  }
  if (s.strikeConfirmationOpen) return { cue: 'STRIKE_DECISION', engineOff: false }
  if (s.strikePhase === 'scar-explore') return { cue: calm, engineOff: true }
  return { cue: calm, engineOff: false }
}

export function deriveCue(s: MusicSnapshot): Cue {
  return decideCue(s).cue
}

/**
 * Tension that waits on the player (handoff 3.7). A non-null key means the
 * cue decays after two phrases without a change of key.
 */
export function dwellKey(s: MusicSnapshot, cue: Cue): string | null {
  if (cue === 'MONUMENT_ALERT') return `MONUMENT_ALERT:${s.outpost?.monument?.wavesResolved ?? 0}`
  if (cue === 'STRIKE_DECISION') return 'STRIKE_DECISION'
  if (cue === 'RIVAL_FOCUS' && s.rivalPhase === 'rival-focused') return 'RIVAL_FOCUSED'
  return null
}

export interface MusicTarget {
  readonly arc: Arc
  readonly cue: Cue
  readonly gains: LayerGains
  readonly dwellKey: string | null
  readonly viewAway: boolean
}

export interface TargetOptions {
  /** The dwell timer for this snapshot's dwell key has expired. */
  readonly decayed?: boolean
}

export function viewIsAway(phase: ExperiencePhase): boolean {
  return phase === 'orbit' || phase === 'selected' || phase === 'returning'
}

/** The mix of `cue` under this snapshot's modifiers (the Territory Claimed plan swells to CLAIMED). */
export function targetForCue(s: MusicSnapshot, cue: Cue, engineOff = false): MusicTarget {
  const arc = deriveArc(s)
  const siege = s.outpost?.siege ?? null
  const monument = s.outpost?.monument ?? null
  const viewAway = viewIsAway(s.phase)
  const gains = mixGains(cue, {
    arc,
    moduleActive: s.outpost?.moduleActive ?? false,
    siegeOperational: siege?.status === 'operational',
    viewAway,
    counterstrikeDamaged: s.counterstrikeDamaged,
    siegeDamaged: siege?.status === 'damaged',
    monumentDamaged: monument?.status === 'damaged',
    monumentKind: monument?.status === 'complete' ? monument.kind : null,
    counterstrikeActive: !counterstrikeIdle(s.csStatus),
    engineOff: engineOff && isCalmCue(cue),
  })
  return { arc, cue, gains, dwellKey: dwellKey(s, cue), viewAway }
}

export function deriveMusicTarget(s: MusicSnapshot, options: TargetOptions = {}): MusicTarget {
  const decision = decideCue(s)
  const key = dwellKey(s, decision.cue)
  if (options.decayed === true && key !== null) {
    const decayed = decision.cue === 'MONUMENT_ALERT' ? 'MONUMENT_ALERT_DWELL' : arcCalmCue(deriveArc(s), s)
    return { ...targetForCue(s, decayed), dwellKey: key }
  }
  return targetForCue(s, decision.cue, decision.engineOff)
}

// ---------------------------------------------------------------------------
// Events (handoff 4.1)
// ---------------------------------------------------------------------------

export type MusicEvent =
  | {
      readonly kind: 'stinger'
      readonly id: StingerId
      readonly timing: 'beat' | 'immediate'
      readonly gainDb: number
    }
  | {
      readonly kind: 'stinger'
      readonly id: StingerId
      readonly timing: 'exact'
      readonly gainDb: number
      /** performance.now() time of the sync point (mapped to audio time by A()). */
      readonly syncPerfMs: number
    }
  /** The `arming` edge arms the First Strike plan (handoff 4.2). */
  | { readonly kind: 'first-strike' }

function beat(id: StingerId, gainDb = 0): MusicEvent {
  return { kind: 'stinger', id, timing: 'beat', gainDb }
}

function waveGainDb(wave: number): number {
  return DIVIDER_WAVE_GAIN_DB[Math.max(0, Math.min(DIVIDER_WAVE_GAIN_DB.length - 1, wave))] ?? 0
}

/**
 * Diffs two consecutive snapshots observed while playing. Identical snapshots
 * fire nothing. The first snapshot after start, resume or SOUND ON is a
 * baseline: the director never calls this across that boundary.
 */
export function deriveMusicEvents(prev: MusicSnapshot, next: MusicSnapshot): MusicEvent[] {
  const events: MusicEvent[] = []

  if (prev.rivalPhase !== 'warning' && next.rivalPhase === 'warning') events.push(beat('vesper-arrival'))
  if (prev.strikePhase !== 'arming' && next.strikePhase === 'arming') events.push({ kind: 'first-strike' })
  if (counterstrikeIdle(prev.csStatus) && next.csStatus === 'command') events.push(beat('vesper-retaliation'))
  if (prev.csStatus !== 'success' && next.csStatus === 'success') events.push(beat('outcome-hold'))
  if (prev.csStatus !== 'impact' && next.csStatus === 'impact') {
    events.push({
      kind: 'stinger',
      id: 'outcome-breach',
      timing: 'exact',
      gainDb: 0,
      syncPerfMs: next.csPhaseStartedAtMs + COUNTERSTRIKE_CONTACT_MS,
    })
  }

  const prevSiege = prev.outpost?.siege?.status ?? null
  const nextSiege = next.outpost?.siege?.status ?? null
  if (prevSiege !== 'command' && nextSiege === 'command' && siegeAdvancing(next)) {
    events.push(beat('divider-contact', waveGainDb(0)))
  }
  if (nextSiege === 'operational' && (prevSiege === 'waves' || prevSiege === 'repairing')) events.push(beat('outcome-hold'))
  if (prevSiege === 'waves' && nextSiege === 'damaged') {
    events.push({ kind: 'stinger', id: 'outcome-breach', timing: 'immediate', gainDb: 0 })
  }

  const wave = next.platformDefenseWave
  if (wave !== null && (prev.platformDefenseWave === null || prev.platformDefenseWave === wave - 1)) {
    events.push(beat('divider-contact', waveGainDb(wave)))
  }

  const prevMonument = prev.outpost?.monument ?? null
  const nextMonument = next.outpost?.monument ?? null
  if (nextMonument !== null && prevMonument?.status !== nextMonument.status) {
    if (nextMonument.status === 'command' && nextMonument.wavesResolved === 0 && next.monumentView) {
      events.push(beat('divider-contact', waveGainDb(0)))
    }
    if (nextMonument.status === 'wave') events.push(beat('divider-contact', waveGainDb(nextMonument.wavesResolved)))
    if (prevMonument?.status === 'wave' && nextMonument.status === 'activating') events.push(beat('outcome-hold'))
    if (prevMonument?.status === 'wave' && nextMonument.status === 'damaged') {
      events.push({ kind: 'stinger', id: 'outcome-breach', timing: 'immediate', gainDb: 0 })
    }
  }

  if (prev.monumentRevealAtMs === null && next.monumentRevealAtMs !== null) {
    events.push({
      kind: 'stinger',
      id: 'territory-claimed',
      timing: 'exact',
      gainDb: 0,
      syncPerfMs: next.monumentRevealAtMs,
    })
  }

  return events
}
