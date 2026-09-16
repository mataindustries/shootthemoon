import type { OutpostModuleKind } from '../domain/outpost.ts'
import { SOLAR_WING_SLOT } from './solarWingLayout.ts'

export interface ModuleSocket {
  readonly xM: number
  readonly zM: number
  readonly heightM: number
  readonly headingRad: number
  readonly clearanceRadiusM: number
}

// Render-only sockets in the canonical site frame. Radii enclose the entire
// structure, including construction rotation; couplers bridge the empty gap.
export const MODULE_SOCKETS: Readonly<Record<OutpostModuleKind, ModuleSocket>> = Object.freeze({
  SOLAR_WING: Object.freeze({ ...SOLAR_WING_SLOT, heightM: 0, clearanceRadiusM: 9.2 }),
  STORAGE_SILO: Object.freeze({ xM: -5, zM: 13.5, heightM: -0.1, headingRad: -0.65, clearanceRadiusM: 3.55 }),
  // The cradle sits in the back service lane, inside the normal portrait
  // frame and clear of the lander, extractor pads and all three miner routes.
  REPAIR_GANTRY: Object.freeze({ xM: -5, zM: -22, heightM: 0, headingRad: 0, clearanceRadiusM: 5.2 }),
})
export const LANDER_CLEARANCE_RADIUS_M = 3.65
