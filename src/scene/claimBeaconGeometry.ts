import { BufferGeometry, Float32BufferAttribute } from 'three'

/**
 * A compact, camera-facing claim beacon: a bracketed ring with a centre pip,
 * a short leader line, and a small faction glyph cap. The ring's outer radius
 * is exactly 0.5, so scaling the mesh by a world size sets the ring diameter
 * directly and the screen-space rules in `orbitalClaimMarker.ts` stay honest.
 *
 * Authored in the XY plane and billboarded by the owning marker, which is why
 * the leader always rises towards screen up.
 */
export const CLAIM_BEACON_LAYOUT = Object.freeze({
  ringOuterRadius: 0.5,
  ringInnerRadius: 0.385,
  /** Half-width of the gaps left at screen top and bottom. */
  ringGapRad: 0.3,
  ringSegments: 16,
  pipRadius: 0.078,
  pipSegments: 8,
  leaderBaseY: 0.16,
  leaderTipY: 0.86,
  leaderHalfWidth: 0.017,
  glyphHalfWidth: 0.1,
  glyphBaseY: 0.88,
  glyphTipY: 1.04,
})

export type ClaimBeaconGlyph = 'block' | 'spear'

function pushVertex(
  positions: number[],
  x: number,
  y: number,
): number {
  positions.push(x, y, 0)
  return positions.length / 3 - 1
}

function pushTriangle(
  indices: number[],
  a: number,
  b: number,
  c: number,
): void {
  indices.push(a, b, c)
}

function pushQuad(
  positions: number[],
  indices: number[],
  points: readonly (readonly [number, number])[],
): void {
  const [first, second, third, fourth] = points as readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ]
  const a = pushVertex(positions, first[0], first[1])
  const b = pushVertex(positions, second[0], second[1])
  const c = pushVertex(positions, third[0], third[1])
  const d = pushVertex(positions, fourth[0], fourth[1])
  pushTriangle(indices, a, b, c)
  pushTriangle(indices, a, c, d)
}

function pushArc(
  positions: number[],
  indices: number[],
  startRad: number,
  sweepRad: number,
): void {
  const { ringInnerRadius, ringOuterRadius, ringSegments } =
    CLAIM_BEACON_LAYOUT
  let previousInner = -1
  let previousOuter = -1

  for (let step = 0; step <= ringSegments; step += 1) {
    const angle = startRad + (sweepRad * step) / ringSegments
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const inner = pushVertex(
      positions,
      cos * ringInnerRadius,
      sin * ringInnerRadius,
    )
    const outer = pushVertex(
      positions,
      cos * ringOuterRadius,
      sin * ringOuterRadius,
    )

    if (step > 0) {
      pushTriangle(indices, previousInner, previousOuter, outer)
      pushTriangle(indices, previousInner, outer, inner)
    }

    previousInner = inner
    previousOuter = outer
  }
}

function pushPip(positions: number[], indices: number[]): void {
  const { pipRadius, pipSegments } = CLAIM_BEACON_LAYOUT
  const centre = pushVertex(positions, 0, 0)
  const rim: number[] = []

  for (let step = 0; step < pipSegments; step += 1) {
    const angle = (step / pipSegments) * Math.PI * 2
    rim.push(
      pushVertex(
        positions,
        Math.cos(angle) * pipRadius,
        Math.sin(angle) * pipRadius,
      ),
    )
  }

  for (let step = 0; step < pipSegments; step += 1) {
    pushTriangle(
      indices,
      centre,
      rim[step]!,
      rim[(step + 1) % pipSegments]!,
    )
  }
}

function pushGlyph(
  positions: number[],
  indices: number[],
  glyph: ClaimBeaconGlyph,
): void {
  const { glyphHalfWidth, glyphBaseY, glyphTipY } = CLAIM_BEACON_LAYOUT

  if (glyph === 'spear') {
    const left = pushVertex(positions, -glyphHalfWidth, glyphBaseY)
    const right = pushVertex(positions, glyphHalfWidth, glyphBaseY)
    const apex = pushVertex(positions, 0, glyphTipY)
    pushTriangle(indices, left, right, apex)
    return
  }

  const top = glyphBaseY + (glyphTipY - glyphBaseY) * 0.55
  pushQuad(positions, indices, [
    [-glyphHalfWidth, glyphBaseY],
    [glyphHalfWidth, glyphBaseY],
    [glyphHalfWidth, top],
    [-glyphHalfWidth, top],
  ])
}

export function createClaimBeaconGeometry(
  glyph: ClaimBeaconGlyph,
): BufferGeometry {
  const { ringGapRad, leaderBaseY, leaderTipY, leaderHalfWidth } =
    CLAIM_BEACON_LAYOUT
  const positions: number[] = []
  const indices: number[] = []
  const halfPi = Math.PI / 2
  const sweep = Math.PI - ringGapRad * 2

  // Two side arcs, leaving deliberate gaps at screen top and bottom.
  pushArc(positions, indices, -halfPi + ringGapRad, sweep)
  pushArc(positions, indices, halfPi + ringGapRad, sweep)
  pushPip(positions, indices)
  pushQuad(positions, indices, [
    [-leaderHalfWidth, leaderBaseY],
    [leaderHalfWidth, leaderBaseY],
    [leaderHalfWidth, leaderTipY],
    [-leaderHalfWidth, leaderTipY],
  ])
  pushGlyph(positions, indices, glyph)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  return geometry
}
