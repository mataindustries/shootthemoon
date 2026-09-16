import { BufferAttribute, BufferGeometry, OctahedronGeometry } from 'three'
import { batchMiningModel, type AddMiningPart, type MiningKit } from '../render/miningKit.ts'

/** Unequal pentagonal faces and an offset termination, with a broad buried
 * root. This is a volumetric crystal, not a stretched double pyramid. */
export function createLunarCrystal() {
  const vertices: number[] = []
  const ring = (i: number, y: number, radius: number) => {
    const a = i * Math.PI * 2 / 5
    const irregular = 1 + Math.sin(i * 4.7) * .18
    return [Math.cos(a) * radius * irregular + y * .08, y, Math.sin(a) * radius * irregular]
  }
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5
    const a = ring(i, 0, .42), b = ring(next, 0, .42)
    const c = ring(i, .86 + (i % 2) * .14, .34), d = ring(next, .86 + (next % 2) * .14, .34)
    vertices.push(...a, ...c, ...b, ...b, ...c, ...d, ...c, .19, 1.32, -.07, ...d, ...b, 0, 0, 0, ...a)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.computeVertexNormals()
  return geometry
}

export function createOreCluster(kit: MiningKit) {
  const crystal = createLunarCrystal()
  const rock = new OctahedronGeometry(1)
  const geometry = batchMiningModel(kit, add => {
    for (let i = 0; i < 6; i++) {
      const a = i * 2.399
      add(rock, 'basalt', [Math.sin(a) * .44, .08, Math.cos(a) * .44], [.48, .2 + (i % 3) * .055, .4], [.12, a, .14])
    }
    const crystals = [
      { p: [-.1, .03, -.08], s: [.95, 1.32, .92], r: [.08, .4, -.14] },
      { p: [.36, .06, .14], s: [.64, .88, .7], r: [.23, 1.3, -.24] },
      { p: [-.4, .02, .25], s: [.57, .66, .74], r: [-.18, 2.4, .28] },
      { p: [.07, .03, -.43], s: [.66, 1.02, .6], r: [-.22, 3.5, .09] },
    ] as const
    crystals.forEach((part, i) => {
      add(crystal, i === 3 ? 'vein' : 'mineral', part.p, part.s, part.r)
      // Narrow mineral inclusions intersect the host faces rather than float
      // above them; only their exposed edge receives a low emissive finish.
      add(crystal, i % 2 ? 'vein' : 'amber', [part.p[0] + .16, part.p[1] + .02, part.p[2]], [.035, part.s[1] * .76, .31], part.r)
    })
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5
      add(rock, i % 2 ? 'vein' : 'mineral', [Math.sin(a) * .74, .018, Math.cos(a) * .74], [.18, .035, .14], [0, a, 0])
    }
  })
  crystal.dispose()
  rock.dispose()
  return geometry
}

export function authorMinerBody(add: AddMiningPart, worker = false) {
  if (worker) {
    add('bevel', 'carbon', [0, .2, .04], [.62, .46, .78])
    for (const side of [-1, 1]) {
      add('box', 'ceramic', [side * .65, .14, 0], [.18, .16, 1.38])
      add('box', 'gold', [side * .49, .4, .13], [.035, .026, .72])
      add('box', 'amber', [side * .45, .26, .66], [.13, .065, .025])
      add('box', 'carbon', [side * .4, .52, -.53], [.09, .26, .52])
    }
    add('box', 'ceramic', [0, .52, -.8], [.83, .26, .06])
    add('tube', 'steel', [-.22, .77, -.18], [.045, .5, .045])
    add('box', 'cyan', [.51, .37, .12], [.03, .05, .16])
    return
  }
  add('bevel', 'carbon', [0, .18, 0], [.65, .46, .82])
  add('bevel', 'ceramic', [0, .43, .15], [.5, .28, .52])
  add('box', 'steel', [0, -.08, 0], [1.44, .14, 1.02])
  for (const side of [-1, 1]) {
    add('box', 'gold', [side * .5, .35, .12], [.04, .035, .88])
    add('box', 'ceramic', [side * .65, .11, 0], [.18, .17, 1.42])
    add('box', 'amber', [side * .46, .25, .65], [.14, .075, .06])
    add('box', 'gold', [side * .42, .48, -.57], [.055, .035, .5])
    add('box', 'carbon', [side * .43, .56, -.61], [.08, .3, .6])
  }
  add('box', 'carbon', [0, .46, -.61], [.86, .09, .58])
  add('box', 'ceramic', [0, .56, -.91], [.88, .3, .06])
  add('tube', 'steel', [0, .79, -.18], [.045, .52, .045])
  add('box', 'cyan', [.51, .41, -.1], [.035, .06, .24])
  for (let i = 0; i < 3; i++) add('box', 'rubber', [0, .589, -.12 + i * .11], [.4, .015, .045])
}

export function createMiningRobotModels(kit: MiningKit, worker = false) {
  return {
    body: batchMiningModel(kit, add => authorMinerBody(add, worker)),
    wheel: batchMiningModel(kit, add => {
      add('tube', 'rubber', [0, 0, 0], [.23, .18, .23])
      for (const side of [-1, 1]) {
        add('box', 'gold', [0, side * .096, 0], [.17, .008, .17])
      }
    }),
    sensor: batchMiningModel(kit, add => {
      add('bevel', 'ceramic', [0, .06, 0], [worker ? .25 : .32, .2, .18])
      add('box', 'gold', [0, .17, 0], [.4, .03, .14])
      add('box', 'cyan', [0, .055, .165], [.3, .065, .025])
      add('box', 'amber', [-.2, .06, .11], [.04, .06, .025])
    }),
    arm: batchMiningModel(kit, add => {
      if (worker) {
        add('tube', 'gold', [0, 0, .02], [.1, .26, .1], [0, 0, Math.PI / 2])
        add('box', 'carbon', [0, 0, .2], [.18, .15, .42])
        add('taper', 'steel', [0, 0, .46], [.15, .25, .15], [Math.PI / 2, 0, 0])
        for (const side of [-1, 1]) add('box', 'gold', [side * .15, -.07, .53], [.045, .055, .22], [0, side * -.25, 0])
        add('box', 'amber', [0, .07, .38], [.07, .025, .1])
        return
      }
      add('tube', 'gold', [0, 0, .02], [.105, .3, .105], [0, 0, Math.PI / 2])
      add('box', 'carbon', [0, 0, .2], [.2, .16, .42])
      for (const side of [-1, 1]) add('tube', 'steel', [side * .1, .05, .2], [.025, .38, .025], [Math.PI / 2, 0, 0])
      add('bevel', 'ceramic', [0, 0, .42], [.2, .28, .2], [Math.PI / 2, 0, 0])
      add('tube', 'gold', [0, 0, .55], [.13, .045, .13], [Math.PI / 2, 0, 0])
      add('tube', 'cyan', [0, 0, .58], [.08, .012, .08], [Math.PI / 2, 0, 0])
    }),
    cargo: batchMiningModel(kit, add => {
      add('taper', 'mineral', [0, 0, 0], [.25, .3, .2], [.1, .4, .2])
      add('taper', 'vein', [.17, -.04, .1], [.14, .22, .14], [-.1, 1.1, -.4])
    }),
  }
}

export function createRepairCradle(kit: MiningKit) {
  return {
    frame: batchMiningModel(kit, add => {
      add('bevel', 'ceramic', [0, .16, 0], [1.77, .32, 1.03])
      add('bevel', 'carbon', [0, .34, 0], [1.48, .12, .81])
      for (const side of [-1, 1]) {
        add('bevel', 'ceramic', [side * 1.3, .57, -.1], [.3, .58, .57])
        add('box', 'carbon', [side * 1.34, 1.31, -.26], [.27, 1.48, .37], [0, 0, side * .11])
        add('box', 'gold', [side * 1.21, 1.35, -.04], [.055, 1.38, .045], [0, 0, side * .11])
        add('tube', 'steel', [side * 1.17, .94, .2], [.065, .95, .065], [0, 0, side * -.19])
        add('box', 'carbon', [side * .84, 2.06, -.26], [.99, .28, .36], [0, 0, side * -.34])
        add('tube', 'gold', [side * 1.2, 1.87, -.03], [.15, .1, .15], [Math.PI / 2, 0, 0])
        add('box', 'steel', [side * .82, .44, .03], [.07, .08, 1.38])
        add('box', 'ceramic', [side * .56, .58, -.08], [.24, .27, .54], [0, 0, side * .22])
        add('box', 'gold', [side * .46, .7, -.08], [.04, .05, .45])
        add('box', 'amber', [side * 1.29, 1.91, .145], [.16, .09, .035])
        add('box', 'gold', [side * 1.05, .327, .61], [.7, .025, .05])
        // Routed power cable on the rear of each support.
        add('tube', 'rubber', [side * 1.48, 1.13, -.42], [.05, 1.35, .05])
      }
      add('box', 'carbon', [0, 2.18, -.26], [1.28, .26, .46])
      add('box', 'steel', [0, 1.99, -.04], [2.25, .07, .08])
      add('box', 'gold', [0, 2.32, -.25], [1.22, .035, .31])
      add('box', 'cyan', [-.52, .64, .68], [.23, .12, .03], [-.2, 0, 0])
      for (let i = 0; i < 5; i++) add('box', i % 2 ? 'rubber' : 'gold', [-.3 + i * .15, .315, .81], [.085, .028, .12], [0, -.5, 0])
      add('bevel', 'steel', [0, .47, -.06], [.39, .12, .46])
      add('bevel', 'carbon', [0, .84, -.03], [.3, .64, .36])
      add('box', 'gold', [0, 1.17, .12], [.4, .03, .16])
    }),
    tool: batchMiningModel(kit, add => {
      add('bevel', 'ceramic', [0, 0, 0], [.3, .22, .25])
      add('tube', 'gold', [0, -.24, 0], [.085, .34, .085])
      add('box', 'carbon', [0, -.44, .08], [.21, .26, .34], [-.3, 0, 0])
      add('taper', 'steel', [0, -.65, .14], [.12, .2, .12], [Math.PI, 0, 0])
      add('tube', 'cyan', [0, -.76, .14], [.048, .04, .048])
      add('tube', 'rubber', [.16, -.2, -.05], [.04, .44, .04], [0, 0, -.24])
    }),
  }
}
