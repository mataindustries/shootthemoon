/** Original faction: an overconfident surveying cooperative with eight-sided ships. */
export const OCTOGONALS = {
  name: 'THE OCTOGONALS',
  speaker: 'SURVEYOR OCHRE / EIGHTH DESK',
  identity: 'Eight equal sides. Unequal administrative competence.',
  victory: 'Your claim has been filed under “inconveniently real.” We are leaving.',
  failure: 'Inspection complete. Your monument has several additional entrances.',
  waves: [
    { name: 'PLUMB LINE', approach: 'EAST RIDGE', durationMs: 6_000, origin: [1, .35, .3],
      hit: 28, storageLoss: 4, radio: 'Please stop building. We have already measured the empty space.' },
    { name: 'RIGHT OF WAY', approach: 'NORTH LIMB', durationMs: 7_000, origin: [-.25, .5, -1],
      hit: 34, storageLoss: 6, radio: 'Our second objection is arriving in a very straight line.' },
    { name: 'FINAL NOTICE', approach: 'WEST SCARP', durationMs: 8_000, origin: [-1, .25, .4],
      hit: 40, storageLoss: 8, radio: 'Last inspection. The committee has run out of both fuel and stationery.' },
  ],
} as const
