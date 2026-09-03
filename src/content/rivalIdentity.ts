export const DEFAULT_RIVAL_IDENTITY_ID = 'vesper' as const

export type RivalIdentityId = typeof DEFAULT_RIVAL_IDENTITY_ID

export interface RivalPalette {
  readonly signal: string
  readonly highlight: string
  readonly structure: string
  readonly shadow: string
}

export interface RivalBeaconRhythm {
  readonly descriptor: string
  readonly cycleDurationMs: number
  readonly pulseDurationMs: number
  readonly pulseStartsMs: readonly number[]
}

export interface RivalStrategicLabels {
  readonly signalStrength: string
  readonly threatAssessment: string
  readonly contestedStatus: string
  readonly lockedObjective: string
}

export interface RivalIdentityContent {
  readonly id: RivalIdentityId
  readonly callsign: string
  readonly commander: string
  readonly faction: string
  readonly visualDescriptor: string
  readonly palette: RivalPalette
  readonly beaconRhythm: RivalBeaconRhythm
  readonly introTransmission: string
  readonly scanResponse: string
  readonly finalStrikeTransmission: string
  readonly counterstrikeDefeatedTransmission: string
  readonly counterstrikeDamageTransmission: string
  readonly territorialThreat: string
  readonly strategicLabels: RivalStrategicLabels
}

const VESPER_PALETTE: RivalPalette = Object.freeze({
  signal: '#6fdde7',
  highlight: '#efffff',
  structure: '#12202a',
  shadow: '#060b10',
})

const VESPER_PULSE_STARTS_MS: readonly number[] = Object.freeze([0, 280])

const VESPER_BEACON_RHYTHM: RivalBeaconRhythm = Object.freeze({
  descriptor: 'Two crisp beats followed by a long, watchful pause.',
  cycleDurationMs: 1_800,
  pulseDurationMs: 110,
  pulseStartsMs: VESPER_PULSE_STARTS_MS,
})

const VESPER_STRATEGIC_LABELS: RivalStrategicLabels = Object.freeze({
  signalStrength: 'STRONG',
  threatAssessment: 'RAPID FORTIFICATION',
  contestedStatus: 'LUNAR CONTROL: CONTESTED',
  lockedObjective: 'FIRST STRIKE PROTOCOL — LOCKED',
})

export const VESPER_RIVAL_IDENTITY: RivalIdentityContent = Object.freeze({
  id: DEFAULT_RIVAL_IDENTITY_ID,
  callsign: 'VESPER',
  commander: 'COMMANDER VESPER',
  faction: 'NULL MERIDIAN',
  visualDescriptor:
    'Cold, surgical insertion technology: a spear-like capsule planted nose-down beneath three offset blade pylons that form a broken crown; paired shutters counter-rotate.',
  palette: VESPER_PALETTE,
  beaconRhythm: VESPER_BEACON_RHYTHM,
  introTransmission:
    'Your extractor broke the silence. At last. Commander Vesper, Null Meridian. Keep building. I prefer a rival with something to lose.',
  scanResponse:
    'You found me. Good. Memorize the site; you will not see it unfinished again.',
  finalStrikeTransmission:
    'You found one foothold. Null Meridian survives—and I remember who fired.',
  counterstrikeDefeatedTransmission:
    'Clean interception. Keep watching the dark; Null Meridian does not repeat itself.',
  counterstrikeDamageTransmission:
    'Still standing. Good. Count what survived before you count what is yours.',
  territorialThreat: 'The Moon has room for two claims. I do not.',
  strategicLabels: VESPER_STRATEGIC_LABELS,
})

const RIVAL_IDENTITIES: Readonly<Record<string, RivalIdentityContent>> =
  Object.freeze({
    [VESPER_RIVAL_IDENTITY.id]: VESPER_RIVAL_IDENTITY,
  })

export function getRivalIdentity(
  identityId: string | null | undefined,
): RivalIdentityContent {
  return RIVAL_IDENTITIES[identityId ?? ''] ?? VESPER_RIVAL_IDENTITY
}
