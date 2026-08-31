/**
 * Release-candidate visual constants.
 *
 * Colors are authored in sRGB and intentionally shared across the code-built
 * hard-surface kit. Emissive surfaces are accents, never primary structure.
 */
export const VISUAL_PALETTE = Object.freeze({
  space: '#010207',
  lunarShadow: '#20252c',
  lunarMid: '#666a6d',
  lunarSunlit: '#aaa8a1',

  playerArmor: '#13171a',
  playerSteel: '#30363a',
  playerHeatDark: '#382720',
  playerAmberPanel: '#7d351b',
  playerAmberEmissive: '#d95a1f',
  playerWarningRed: '#9b2b1a',
  playerHotMetal: '#a46b43',

  rivalSkeleton: '#071118',
  rivalFrame: '#14242b',
  rivalSurgical: '#87999c',
  rivalCyanPanel: '#2e747a',
  rivalCyanEmissive: '#55c5cc',
  rivalHighlight: '#c5dedf',

  neutralMachinery: '#42494d',
  contactDark: '#0a0c0e',
  warningStripe: '#c0793d',

  damageChar: '#17191b',
  damageFloor: '#303136',
  damageRim: '#6e6962',
  damageHeat: '#54382f',
  damageEmber: '#df6229',
  rivalWreck: '#16343b',
})

export const MATERIAL_RESPONSE = Object.freeze({
  lunar: Object.freeze({ metalness: 0, roughness: 0.98 }),
  playerArmor: Object.freeze({ metalness: 0.38, roughness: 0.68 }),
  playerSteel: Object.freeze({ metalness: 0.46, roughness: 0.56 }),
  playerHeatDark: Object.freeze({ metalness: 0.34, roughness: 0.74 }),
  rivalSkeleton: Object.freeze({ metalness: 0.34, roughness: 0.62 }),
  rivalPanel: Object.freeze({ metalness: 0.18, roughness: 0.52 }),
  neutralMachinery: Object.freeze({ metalness: 0.42, roughness: 0.62 }),
  contact: Object.freeze({ metalness: 0.05, roughness: 0.9 }),
})

export const EMISSIVE_LIMITS = Object.freeze({
  panel: 0.48,
  activePanel: 0.65,
  tinyLed: 0.82,
  residualHeat: 0.32,
})

export const RENDER_EXPOSURE = 0.82
