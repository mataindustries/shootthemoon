import { describe, expect, it } from 'vitest'
import { DEPOSIT_BLUEPRINTS } from '../domain/outpost.ts'
import {
  FULL_SAFE_AREA,
  framingNarrowness,
  laserContactPosition,
  solveMiningFraming,
  type MiningFraming,
  type SurfaceSafeArea,
} from './miningFraming.ts'

const DESKTOP = { aspect: 1440 / 900, fovDeg: 38 }
const WIDE = { aspect: 1920 / 1080, fovDeg: 38 }
const PORTRAIT = { aspect: 390 / 844, fovDeg: 49 }

const DESKTOP_SAFE: SurfaceSafeArea = { top: 0.14, bottom: 0 }
const PORTRAIT_SAFE: SurfaceSafeArea = { top: 0.14, bottom: 0.16 }

/** Mirrors the parked pose the simulation resolves to for a mining job. */
function parkedRover(blueprintIndex: number) {
  const blueprint = DEPOSIT_BLUEPRINTS[blueprintIndex]!
  const deltaX = blueprint.position.xM - blueprint.routeControl.xM
  const deltaZ = blueprint.position.zM - blueprint.routeControl.zM
  const length = Math.max(0.001, Math.hypot(deltaX, deltaZ))
  const miner = {
    xM: blueprint.position.xM - (deltaX / length) * 2.75,
    zM: blueprint.position.zM - (deltaZ / length) * 2.75,
  }
  const headingRad = Math.atan2(
    2 * (miner.xM - blueprint.routeControl.xM),
    2 * (miner.zM - blueprint.routeControl.zM),
  )
  return { miner, deposit: blueprint.position, headingRad }
}

/**
 * Projects an anchor the way the renderer will, so the assertions below are
 * about where things actually land on the canvas.
 */
function projectAnchor(
  framing: MiningFraming,
  anchor: { xM: number; yM: number; zM: number },
  aspect: number,
  fovDeg: number,
): { ndcX: number; ndcY: number } {
  const camX = framing.focusXM + framing.offsetXM
  const camY = framing.targetLiftM + framing.offsetYM
  const camZ = framing.focusZM + framing.offsetZM
  const forward = [
    framing.focusXM - camX,
    framing.targetLiftM - camY,
    framing.focusZM - camZ,
  ]
  const forwardLength = Math.hypot(...forward)
  const f = forward.map((value) => value / forwardLength) as [
    number,
    number,
    number,
  ]
  // three.js lookAt: right = cross(forward, worldUp), up = cross(right, forward)
  const rightRaw: [number, number, number] = [-f[2], 0, f[0]]
  const rightLength = Math.hypot(...rightRaw)
  const r = rightRaw.map((value) => value / rightLength) as [
    number,
    number,
    number,
  ]
  const u: [number, number, number] = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ]
  const d: [number, number, number] = [
    anchor.xM - camX,
    anchor.yM - camY,
    anchor.zM - camZ,
  ]
  const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]
  const rightComponent = d[0] * r[0] + d[1] * r[1] + d[2] * r[2]
  const upComponent = d[0] * u[0] + d[1] * u[1] + d[2] * u[2]
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360)

  return {
    ndcX: rightComponent / (depth * tanHalfFov * aspect),
    ndcY: upComponent / (depth * tanHalfFov),
  }
}

function frameHero(
  blueprintIndex: number,
  viewport: { aspect: number; fovDeg: number },
  safeArea: SurfaceSafeArea,
) {
  const { miner, deposit, headingRad } = parkedRover(blueprintIndex)
  const framing = solveMiningFraming({
    miner,
    deposit,
    headingRad,
    safeArea,
    ...viewport,
  })
  const contact = laserContactPosition(miner, headingRad)
  const project = (anchor: { xM: number; yM: number; zM: number }) =>
    projectAnchor(framing, anchor, viewport.aspect, viewport.fovDeg)

  return {
    framing,
    miner,
    deposit,
    // The anchors the solver composes against: silhouette tops and the beam
    // contact on the ground.
    minerNdc: project({ xM: miner.xM, yM: 1.42, zM: miner.zM }),
    depositNdc: project({ xM: deposit.xM, yM: 2.35, zM: deposit.zM }),
    contactNdc: project({ xM: contact.xM, yM: 0.12, zM: contact.zM }),
    // Body centres, which must also stay on the canvas.
    minerBodyNdc: project({ xM: miner.xM, yM: 0.7, zM: miner.zM }),
    depositBodyNdc: project({ xM: deposit.xM, yM: 1.1, zM: deposit.zM }),
  }
}

/** Cosine between the camera's ground track and the miner -> ore axis. */
function viewAlignmentWithBeam(hero: ReturnType<typeof frameHero>): number {
  const { framing, miner, deposit } = hero
  const viewLength = Math.hypot(framing.offsetXM, framing.offsetZM)
  const beamX = deposit.xM - miner.xM
  const beamZ = deposit.zM - miner.zM
  const beamLength = Math.hypot(beamX, beamZ)

  return Math.abs(
    (framing.offsetXM * beamX + framing.offsetZM * beamZ) /
      (viewLength * beamLength),
  )
}

describe('framingNarrowness', () => {
  it('separates landscape from portrait and saturates at both ends', () => {
    expect(framingNarrowness(1920 / 1080)).toBe(0)
    expect(framingNarrowness(1440 / 900)).toBe(0)
    expect(framingNarrowness(390 / 844)).toBe(1)
    expect(framingNarrowness(0.9)).toBeGreaterThan(0)
    expect(framingNarrowness(0.9)).toBeLessThan(1)
  })
})

describe('solveMiningFraming', () => {
  for (const [index, blueprint] of DEPOSIT_BLUEPRINTS.entries()) {
    for (const [label, viewport, safeArea] of [
      ['desktop', DESKTOP, DESKTOP_SAFE],
      ['wide', WIDE, DESKTOP_SAFE],
      ['portrait', PORTRAIT, PORTRAIT_SAFE],
    ] as const) {
      it(`keeps the ${blueprint.id} hero triad inside the safe area on ${label}`, () => {
        const hero = frameHero(index, viewport, safeArea)
        const { framing } = hero
        const usableTop = 1 - 2 * safeArea.top
        const usableBottom = -1 + 2 * safeArea.bottom

        for (const [name, ndc] of [
          ['miner', hero.minerNdc],
          ['deposit', hero.depositNdc],
          ['contact', hero.contactNdc],
          ['miner body', hero.minerBodyNdc],
          ['deposit body', hero.depositBodyNdc],
        ] as const) {
          expect(Math.abs(ndc.ndcX), `${name} horizontal`).toBeLessThan(0.82)
          expect(ndc.ndcY, `${name} below usable top`).toBeLessThan(usableTop)
          expect(ndc.ndcY, `${name} above usable bottom`).toBeGreaterThan(
            usableBottom,
          )
        }

        expect(framing.distanceM).toBeGreaterThanOrEqual(11)
        expect(framing.distanceM).toBeLessThanOrEqual(24)
      })

      it(`centres the ${blueprint.id} hero in the usable band on ${label}`, () => {
        const { minerNdc, depositNdc, contactNdc } = frameHero(
          index,
          viewport,
          safeArea,
        )
        const heights = [minerNdc.ndcY, depositNdc.ndcY, contactNdc.ndcY]
        const centre = (Math.max(...heights) + Math.min(...heights)) / 2
        const usableCentre = safeArea.bottom - safeArea.top

        // The former pose parked the triad near the top of the frame; the
        // solved one sits on the centre of whatever the HUD leaves free.
        expect(Math.abs(centre - usableCentre)).toBeLessThan(0.12)
      })
    }
  }

  it('does not pin the miner and deposit to opposite edges on portrait', () => {
    const { minerNdc, depositNdc } = frameHero(0, PORTRAIT, PORTRAIT_SAFE)

    expect(Math.abs(minerNdc.ndcX - depositNdc.ndcX)).toBeLessThan(1.35)
  })

  it('swings the portrait view toward the beam axis to shorten the pair', () => {
    const wide = viewAlignmentWithBeam(frameHero(0, WIDE, DESKTOP_SAFE))
    const portrait = viewAlignmentWithBeam(
      frameHero(0, PORTRAIT, PORTRAIT_SAFE),
    )

    // Portrait looks more along the miner -> ore axis, so the pair foreshortens
    // into the narrow frame instead of spanning it.
    expect(portrait).toBeGreaterThan(wide)
    // ...but never so far around that the shot becomes a rear view through the
    // chassis, which would bury the muzzle and the contact.
    expect(portrait).toBeLessThan(0.72)
  })

  it('keeps the shot spatial rather than collapsing onto the subject', () => {
    for (const [viewport, safeArea] of [
      [DESKTOP, DESKTOP_SAFE],
      [PORTRAIT, PORTRAIT_SAFE],
    ] as const) {
      const { framing } = frameHero(0, viewport, safeArea)
      // Visible ground across the frame, in local metres.
      const visibleWidth =
        2 *
        framing.distanceM *
        Math.tan((viewport.fovDeg * Math.PI) / 360) *
        viewport.aspect

      expect(visibleWidth).toBeGreaterThan(5)
    }
  })

  it('reacts to bottom chrome by lifting the framed point', () => {
    const withoutPanel = frameHero(0, PORTRAIT, { top: 0.14, bottom: 0 })
    const withPanel = frameHero(0, PORTRAIT, { top: 0.14, bottom: 0.3 })

    expect(withPanel.framing.targetLiftM).toBeLessThan(
      withoutPanel.framing.targetLiftM,
    )
    expect(withPanel.contactNdc.ndcY).toBeGreaterThan(
      withoutPanel.contactNdc.ndcY,
    )
  })

  it('tolerates a missing safe area', () => {
    const { framing } = frameHero(0, DESKTOP, FULL_SAFE_AREA)

    expect(Number.isFinite(framing.distanceM)).toBe(true)
    expect(Number.isFinite(framing.targetLiftM)).toBe(true)
  })
})
