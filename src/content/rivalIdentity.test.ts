import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RIVAL_IDENTITY_ID,
  VESPER_RIVAL_IDENTITY,
  getRivalIdentity,
} from './rivalIdentity.ts'

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).length
}

describe('rival identity content', () => {
  it('looks up Vesper by the persisted identity id', () => {
    expect(getRivalIdentity(DEFAULT_RIVAL_IDENTITY_ID)).toBe(
      VESPER_RIVAL_IDENTITY,
    )
    expect(VESPER_RIVAL_IDENTITY.id).toBe('vesper')
    expect(VESPER_RIVAL_IDENTITY.callsign).toBe('VESPER')
    expect(VESPER_RIVAL_IDENTITY.faction).toBe('NULL MERIDIAN')
  })

  it('falls back to Vesper for missing or unknown identity ids', () => {
    expect(getRivalIdentity(null)).toBe(VESPER_RIVAL_IDENTITY)
    expect(getRivalIdentity(undefined)).toBe(VESPER_RIVAL_IDENTITY)
    expect(getRivalIdentity('unknown-rival')).toBe(VESPER_RIVAL_IDENTITY)
  })

  it('keeps authored content immutable at runtime', () => {
    expect(Object.isFrozen(VESPER_RIVAL_IDENTITY)).toBe(true)
    expect(Object.isFrozen(VESPER_RIVAL_IDENTITY.palette)).toBe(true)
    expect(Object.isFrozen(VESPER_RIVAL_IDENTITY.beaconRhythm)).toBe(true)
    expect(
      Object.isFrozen(VESPER_RIVAL_IDENTITY.beaconRhythm.pulseStartsMs),
    ).toBe(true)
    expect(Object.isFrozen(VESPER_RIVAL_IDENTITY.strategicLabels)).toBe(true)
  })

  it('preserves the selected authored dialogue exactly', () => {
    expect(VESPER_RIVAL_IDENTITY.introTransmission).toBe(
      'Your extractor broke the silence. At last. Commander Vesper, Null Meridian. Keep building. I prefer a rival with something to lose.',
    )
    expect(VESPER_RIVAL_IDENTITY.scanResponse).toBe(
      'You found me. Good. Memorize the site; you will not see it unfinished again.',
    )
    expect(VESPER_RIVAL_IDENTITY.territorialThreat).toBe(
      'The Moon has room for two claims. I do not.',
    )
  })

  it('keeps every transmission concise enough for a phone', () => {
    expect(wordCount(VESPER_RIVAL_IDENTITY.introTransmission)).toBeLessThanOrEqual(
      24,
    )
    expect(wordCount(VESPER_RIVAL_IDENTITY.scanResponse)).toBeLessThanOrEqual(
      18,
    )
    expect(
      wordCount(VESPER_RIVAL_IDENTITY.territorialThreat),
    ).toBeLessThanOrEqual(12)

    expect(VESPER_RIVAL_IDENTITY.introTransmission.length).toBeLessThanOrEqual(
      140,
    )

    for (const label of Object.values(
      VESPER_RIVAL_IDENTITY.strategicLabels,
    )) {
      expect(label.length).toBeLessThanOrEqual(40)
    }
  })
})
