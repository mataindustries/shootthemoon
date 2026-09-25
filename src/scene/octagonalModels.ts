import type { MonumentKind } from '../domain/territoryMonument.ts'
import type { AddPart } from '../render/octagonalKit.ts'
import { authorBastionZiggurat } from './bastionZigguratModel.ts'

const H = Math.PI / 2
const EIGHT = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)

/** Model-space metres are visual only; no mesh dimension enters campaign state. */
export function authorPlatform(add: AddPart) {
  add('bevel', 'dark', [0, 0, 0], [3, 1.5, 3])
  add('bevel', 'dark', [0, .9, 0], [2.2, .5, 2.2])
  add('ring', 'gold', [0, .63, 0], [2.78, 2.78, .85], [H, 0, 0])
  add('ring', 'dark', [0, -.25, 0], [5.85, 5.85, 3.4], [H, 0, 0])
  add('ring', 'gold', [0, -.04, 0], [5.85, 5.85, .7], [H, 0, 0])
  add('ring', 'dark', [0, -1.05, 0], [4.5, 4.5, 2.1], [H, 0, 0])
  add('bevel', 'dark', [0, 1.7, 0], [.95, 1.25, .95])
  add('bevel', 'gold', [0, 2.2, 0], [.8, .22, .8])
  add('bevel', 'amber', [0, 2.37, 0], [.48, .16, .48])
  for (const angle of EIGHT) {
    const s = Math.sin(angle), c = Math.cos(angle)
    add('bevel', 'dark', [s * 4.1, .02, c * 4.1], [.42, .55, 2], [0, angle, 0])
    add('box', 'gold', [s * 4.3, .32, c * 4.3], [.11, .055, 1.85], [0, angle, 0])
    add('bevel', 'dark', [s * 5.85, .15, c * 5.85], [.63, .8, .7], [0, angle, 0])
    add('box', 'cyan', [s * 6.46, .2, c * 6.46], [.35, .12, .08], [0, angle, 0])
    add('box', 'amber', [s * 2.8, .12, c * 2.8], [.74, .14, .08], [0, angle, 0])
  }
}

export function authorMonument(kind: MonumentKind, add: AddPart) {
  // The Ziggurat's own terraces are its foundation; only spire-type monuments keep the round plinth.
  if (kind === 'HELIOS_SPIRE' || kind === 'SIGNAL_ARRAY') {
    add('bevel', 'dark', [0, 2, 0], [17, 4, 17])
    add('ring', 'gold', [0, 3.5, 0], [15.8, 15.8, 6], [H, 0, 0])
    for (const angle of EIGHT.filter((_, i) => i % 2 === 0)) {
      add('box', 'amber', [Math.sin(angle) * 15.5, 3, Math.cos(angle) * 15.5], [3, .6, .6], [0, angle, 0])
    }
  }
  if (kind === 'HELIOS_SPIRE') {
    add('taper', 'dark', [0, 32, 0], [9, 56, 9])
    for (const angle of EIGHT.filter((_, i) => i % 2 === 0)) {
      const s = Math.sin(angle), c = Math.cos(angle)
      add('taper', 'dark', [s * 7.3, 23, c * 7.3], [3.2, 38, 4], [0, angle, -.1])
      add('taper', 'gold', [s * 5.3, 34, c * 5.3], [1.15, 49, 1.4], [0, angle, 0])
      add('box', 'amber', [s * 3, 49, c * 3], [.75, 19, .75], [0, angle, 0])
      add('taper', 'dark', [s * 3.9, 67, c * 3.9], [1.6, 17, 1.6], [0, angle, 0])
      add('bevel', 'gold', [s * 3.9, 74, c * 3.9], [1.1, 2.8, 1.1])
    }
    add('bevel', 'gold', [0, 60, 0], [5, 2.1, 5])
    add('bevel', 'amber', [0, 67, 0], [2, 10, 2])
    add('taper', 'dark', [0, 78, 0], [2.6, 9, 2.6])
    add('bevel', 'cyan', [0, 82.2, 0], [.85, 1, .85])
  }
  if (kind === 'CRATER_CROWN') {
    for (const [i, angle] of EIGHT.entries()) {
      const s = Math.sin(angle), c = Math.cos(angle)
      const y = 1.6 // Curved lunar datum at r=43, plus clearance above the scar rim.
      const tall = i % 2 === 0 ? 4 : 0
      add('bevel', 'dark', [s * 43, y + 3, c * 43], [6, 8, 7], [0, angle, 0])
      add('taper', 'dark', [s * 43, y + 11 + tall / 2, c * 43], [5.4, 15 + tall, 6.4], [0, angle, 0])
      add('bevel', 'gold', [s * 43, y + 15 + tall, c * 43], [3.8, 3, 4.8], [0, angle, 0])
      add('box', 'amber', [s * 47, y + 14 + tall, c * 47], [3, 1.2, .8], [0, angle, 0])
      add('bevel', 'cyan', [s * 43, y + 18.5 + tall, c * 43], [.7, 1, .7])
      const mid = angle + Math.PI / 8
      add('box', 'dark', [Math.sin(mid) * 39.8, 4, Math.cos(mid) * 39.8], [32.9, 3, 3], [0, mid, 0])
      add('box', 'gold', [Math.sin(mid) * 39.8, 5.65, Math.cos(mid) * 39.8], [29, .4, .6], [0, mid, 0])
    }
  }
  if (kind === 'BASTION_OBELISK') authorBastionZiggurat(add)
  if (kind === 'SIGNAL_ARRAY') {
    add('taper', 'dark', [0, 20, 0], [7.5, 32, 7.5])
    add('bevel', 'gold', [0, 28, 0], [4.8, 2, 4.8])
    // Two offset, open octagonal trusses. The aperture stays dark and see-through.
    add('ring', 'dark', [0, 43, 0], [24, 24, 32], [-.25, 0, 0])
    add('ring', 'gold', [0, 43, 1.7], [23.5, 23.5, 9], [-.25, 0, 0])
    add('ring', 'dark', [0, 43, -3], [18.8, 18.8, 16], [-.25, 0, 0])
    for (const [i, angle] of EIGHT.entries()) {
      const x = Math.sin(angle) * 23.5, y = Math.cos(angle) * 23.5
      if (i % 2 === 0) {
        add('box', 'dark', [x / 2, 43 + y / 2, -.5 - y * .12], [1.5, 24, 1.8], [-.25, 0, -angle])
        add('bevel', 'dark', [x, 43 + y, -y * .25], [3.4, 5.5, 3.4], [0, 0, -angle])
      }
      add('bevel', i % 2 ? 'amber' : 'cyan', [x, 43 + y, 2.5 - y * .25], [1.05, 2.4, 1.05], [0, 0, -angle])
    }
    add('bevel', 'dark', [0, 43, 0], [5.5, 4, 5.5], [H, 0, 0])
    add('ring', 'gold', [0, 43, 2.2], [4.4, 4.4, 5])
    add('bevel', 'cyan', [0, 43, 2.7], [2, 1, 2], [H, 0, 0])
  }
}
