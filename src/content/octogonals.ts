/** Original faction: an automated surveying authority that enforces its map with eight-sided DIVIDER craft. */
export const OCTOGONALS = {
  name: 'THE OCTOGONALS',
  speaker: 'EIGHTH DESK · AUTOMATED NOTICE',
  identity: 'Eight equal sides. Unequal administrative competence.',
  victory: 'Structure confirmed permanent. Survey amended.',
  failure: 'Correction applied. Survey closed.',
  waves: [
    { name: 'PLUMB LINE', approach: 'EAST RIDGE', durationMs: 6_000, origin: [1, .35, .3],
      hit: 28, storageLoss: 4, radio: 'Unregistered structure detected. Correction dispatched.' },
    { name: 'RIGHT OF WAY', approach: 'NORTH LIMB', durationMs: 7_000, origin: [-.25, .5, -1],
      hit: 34, storageLoss: 6, radio: 'Structure persists. Correction escalated.' },
    { name: 'FINAL NOTICE', approach: 'WEST SCARP', durationMs: 8_000, origin: [-1, .25, .4],
      hit: 40, storageLoss: 8, radio: 'Structure still present. Removing from survey.' },
  ],
} as const
