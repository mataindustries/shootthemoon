import { describe, expect, it } from 'vitest'
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from 'three'
import {
  createLandingSite,
  createLunarLocation,
} from '../domain/lunarCoordinates.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { EMISSIVE_LIMITS } from '../render/visualSystem.ts'
import { createCraterGeometry } from './PermanentLunarScar.tsx'
import {
  calculateDamagedFoundationVerticalBounds,
  calculateRivalGrounding,
  getRivalStageVisualProfile,
} from './RivalFoothold.tsx'
import { createCitadelGeometry } from './vesperCitadelGeometry.ts'
import {
  CITADEL_WRECK_EMBER_INTENSITY,
  CITADEL_WRECK_FOUNDATION_BOTTOM,
  createCitadelWreckGeometry,
  type CitadelWreckFragment,
} from './vesperCitadelWreckGeometry.ts'

const STAGES = ['LANDED', 'ESTABLISHING', 'FORTIFIED'] as const
const triangles = (geometry: BufferGeometry) =>
  geometry.getAttribute('position').count / 3

describe('Vesper citadel wreck geometry', () => {
  it.each(STAGES)('stays cheaper than the intact %s citadel', (stage) => {
    const profile = getRivalStageVisualProfile(stage)
    const intact = Object.values(createCitadelGeometry(profile))
    const wreck = createCitadelWreckGeometry(profile)

    expect(triangles(wreck.wreck) + triangles(wreck.embers)).toBeLessThan(
      intact.reduce((sum, geometry) => sum + triangles(geometry), 0),
    )
    for (const geometry of [wreck.wreck, wreck.embers]) {
      expect(geometry.getAttribute('uv')).toBeUndefined()
      expect(geometry.getAttribute('color')).toBeDefined()
    }
  })

  it('collapses the keep and crown well below the intact silhouette', () => {
    const profile = getRivalStageVisualProfile('FORTIFIED')
    const intact = createCitadelGeometry(profile)
    const wreck = createCitadelWreckGeometry(profile)
    // The crown sits on its pivot 8.75 above the model origin.
    const intactTop = Math.max(
      intact.architecture.boundingBox!.max.y,
      8.75 + intact.crown.boundingBox!.max.y,
    )

    expect(wreck.wreck.boundingBox!.max.y).toBeLessThan(intactTop * 0.7)
    const names = wreck.fragments.map((fragment) => fragment.name)
    for (const name of ['keep', 'keep-roof', 'knife-blade', 'crown', 'crown-tine', 'array']) {
      expect(names).toContain(name)
    }
  })

  it('leaves the signal core dark apart from two faint remnants', () => {
    const wreck = createCitadelWreckGeometry(getRivalStageVisualProfile('FORTIFIED'))

    expect(triangles(wreck.embers)).toBeLessThanOrEqual(24)
    expect(CITADEL_WRECK_EMBER_INTENSITY).toBeLessThan(EMISSIVE_LIMITS.panel / 2)
  })
})

function overlaps(a: CitadelWreckFragment, b: CitadelWreckFragment): boolean {
  return [0, 1, 2].every(
    (axis) => a.min[axis]! <= b.max[axis]! + 0.05 && b.min[axis]! <= a.max[axis]! + 0.05,
  )
}

describe('Vesper citadel wreck grounding', () => {
  const { bottom } = calculateDamagedFoundationVerticalBounds(0, false)
  const visualScale = bottom / CITADEL_WRECK_FOUNDATION_BOTTOM
  const raycaster = new Raycaster()
  const down = new Vector3(0, -1, 0)

  it.each([
    { latitudeRad: 0.271, longitudeRad: -2.134, segments: 32 },
    { latitudeRad: -0.61, longitudeRad: 2.08, segments: 96 },
    { latitudeRad: 0.248, longitudeRad: -0.684, segments: 128 },
  ])(
    'seats every fragment in the scar at $latitudeRad, $longitudeRad',
    ({ latitudeRad, longitudeRad, segments }) => {
      const terrain = createSurfaceTerrainProfile(
        createLandingSite(createLunarLocation(latitudeRad, longitudeRad)),
      )
      const floor = calculateRivalGrounding(terrain, segments, 'scarred').attachmentHeight

      for (const stage of STAGES) {
        const wreck = createCitadelWreckGeometry(getRivalStageVisualProfile(stage))
        const byName = new Map(wreck.fragments.map((fragment) => [fragment.name, fragment]))

        for (const fragment of wreck.fragments) {
          if (fragment.restsOn === 'ground') continue
          const support = byName.get(fragment.restsOn)
          expect(support, fragment.name).toBeDefined()
          expect(overlaps(fragment, support!), `${fragment.name} on ${fragment.restsOn}`).toBe(true)
        }

        for (const seed of [0x51a7c4a3, 0x0c3f_1e27]) {
          const crater = new Mesh(
            createCraterGeometry(seed, floor),
            new MeshBasicMaterial({ side: DoubleSide }),
          )
          for (const heading of [0, 1.3, 2.9, -2]) {
            const cos = Math.cos(heading)
            const sin = Math.sin(heading)
            const toSite = ([x, y, z]: readonly number[]) =>
              new Vector3(
                (x! * cos + z! * sin) * visualScale,
                floor + y! * visualScale,
                (-x! * sin + z! * cos) * visualScale,
              )
            const surfaceBelow = (point: Vector3) => {
              raycaster.set(new Vector3(point.x, 1, point.z), down)
              return raycaster.intersectObject(crater)[0]!.point.y
            }

            for (const fragment of wreck.fragments) {
              if (fragment.restsOn !== 'ground') continue
              for (const foot of fragment.footing) {
                const point = toSite(foot)
                expect(point.y, `${fragment.name} footing`).toBeLessThan(surfaceBelow(point))
              }
              const crest = toSite([
                (fragment.min[0] + fragment.max[0]) / 2,
                fragment.max[1],
                (fragment.min[2] + fragment.max[2]) / 2,
              ])
              expect(crest.y, `${fragment.name} crest`).toBeGreaterThan(surfaceBelow(crest))
            }
          }
          crater.geometry.dispose()
        }
      }
    },
  )
})
