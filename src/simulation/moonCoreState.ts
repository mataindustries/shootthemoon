import type { LandingSite } from '../domain/lunarCoordinates.ts'

export type ExperiencePhase =
  | 'orbit'
  | 'selected'
  | 'approach'
  | 'landed'
  | 'returning'

export interface MoonCoreState {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
}

export type MoonCoreAction =
  | { readonly type: 'select'; readonly landingSite: LandingSite }
  | { readonly type: 'revisit'; readonly landingSite: LandingSite }
  | { readonly type: 'clearSite' }
  | { readonly type: 'claim' }
  | { readonly type: 'landingComplete' }
  | { readonly type: 'returnToOrbit' }
  | { readonly type: 'returnComplete' }
  | { readonly type: 'resetPrototype' }

export const INITIAL_MOON_CORE_STATE: MoonCoreState = Object.freeze({
  phase: 'orbit',
  landingSite: null,
})

export function moonCoreReducer(
  state: MoonCoreState,
  action: MoonCoreAction,
): MoonCoreState {
  switch (action.type) {
    case 'select':
      if (state.phase !== 'orbit' && state.phase !== 'selected') {
        return state
      }

      return {
        phase: 'selected',
        landingSite: action.landingSite,
      }

    case 'revisit':
      if (state.phase !== 'orbit') {
        return state
      }

      return {
        phase: 'selected',
        landingSite: action.landingSite,
      }

    case 'claim':
      if (state.phase !== 'selected' || state.landingSite === null) {
        return state
      }

      return {
        ...state,
        phase: 'approach',
      }

    case 'clearSite':
      if (state.phase !== 'selected') {
        return state
      }

      return INITIAL_MOON_CORE_STATE

    case 'landingComplete':
      if (state.phase !== 'approach') {
        return state
      }

      return {
        ...state,
        phase: 'landed',
      }

    case 'returnToOrbit':
      if (
        state.phase !== 'selected' &&
        state.phase !== 'approach' &&
        state.phase !== 'landed'
      ) {
        return state
      }

      return {
        ...state,
        phase: 'returning',
      }

    case 'returnComplete':
      if (state.phase !== 'returning') {
        return state
      }

      return INITIAL_MOON_CORE_STATE

    case 'resetPrototype':
      return INITIAL_MOON_CORE_STATE
  }
}
