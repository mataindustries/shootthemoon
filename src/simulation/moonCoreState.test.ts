import { describe, expect, it } from 'vitest'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import {
  INITIAL_MOON_CORE_STATE,
  moonCoreReducer,
  type MoonCoreState,
} from './moonCoreState.ts'

const FIRST_SITE = createLandingSite(createLunarLocation(0.25, -0.5))
const SECOND_SITE = createLandingSite(createLunarLocation(-0.4, 1.2))

describe('moonCoreReducer repeatable landing loop', () => {
  it('resets after landing so a different site can be claimed', () => {
    let state: MoonCoreState = INITIAL_MOON_CORE_STATE

    state = moonCoreReducer(state, {
      type: 'select',
      landingSite: FIRST_SITE,
    })
    state = moonCoreReducer(state, { type: 'claim' })
    state = moonCoreReducer(state, { type: 'landingComplete' })
    state = moonCoreReducer(state, { type: 'returnToOrbit' })
    state = moonCoreReducer(state, { type: 'returnComplete' })

    expect(state).toEqual(INITIAL_MOON_CORE_STATE)

    state = moonCoreReducer(state, {
      type: 'select',
      landingSite: SECOND_SITE,
    })
    state = moonCoreReducer(state, { type: 'claim' })

    expect(state).toEqual({ phase: 'approach', landingSite: SECOND_SITE })
  })

  it('clears a candidate site immediately without starting a return journey', () => {
    const selected = moonCoreReducer(INITIAL_MOON_CORE_STATE, {
      type: 'select',
      landingSite: FIRST_SITE,
    })

    expect(moonCoreReducer(selected, { type: 'clearSite' })).toEqual(
      INITIAL_MOON_CORE_STATE,
    )
  })
})
