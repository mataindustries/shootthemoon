import { BoxGeometry, BufferGeometry, CylinderGeometry, MeshStandardMaterial, Object3D, RingGeometry, TorusGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { EMISSIVE_LIMITS, MATERIAL_RESPONSE as R, VISUAL_PALETTE as P } from './visualSystem.ts'

/** Four opaque finishes, shared by every part of an installation and its fleet. */
export function createOctagonalKit() {
  const cylinder = new CylinderGeometry(1, 1, 1, 8, 3, false, Math.PI / 8)
  const positions = cylinder.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i)
    const end = Math.abs(y) > .49
    positions.setXYZ(i, positions.getX(i) * (end ? .84 : 1), end ? y : Math.sign(y) * .32, positions.getZ(i) * (end ? .84 : 1))
  }
  const bevel = cylinder.toNonIndexed()
  bevel.computeVertexNormals()
  cylinder.dispose()
  const flat = (geometry: BufferGeometry) => {
    const result = geometry.toNonIndexed()
    result.computeVertexNormals()
    geometry.dispose()
    return result
  }
  return {
    shapes: {
      bevel,
      box: flat(new BoxGeometry(1, 1, 1)),
      taper: flat(new CylinderGeometry(.16, 1, 1, 8, 1, false, Math.PI / 8)),
      ring: flat(new TorusGeometry(1, .045, 4, 8)),
      scar: flat(new RingGeometry(1.4, 3.8, 12)),
    },
    materials: {
      dark: new MeshStandardMaterial({ color: P.monumentObsidian, ...R.monumentCeramic,
        emissive: P.playerComposite, emissiveIntensity: .14 }),
      gold: new MeshStandardMaterial({ color: P.monumentGold, ...R.monumentTrim,
        emissive: P.monumentGold, emissiveIntensity: .08 }),
      amber: new MeshStandardMaterial({ color: P.monumentAmber, emissive: P.monumentAmber,
        emissiveIntensity: EMISSIVE_LIMITS.panel, metalness: .2, roughness: .4 }),
      cyan: new MeshStandardMaterial({ color: P.monumentCyan, emissive: P.monumentCyan,
        emissiveIntensity: EMISSIVE_LIMITS.panel, metalness: .15, roughness: .45 }),
    },
  }
}

export type OctagonalKit = ReturnType<typeof createOctagonalKit>
export type Finish = keyof OctagonalKit['materials']
type Triple = [number, number, number]
export type AddPart = (shape: keyof OctagonalKit['shapes'], finish: Finish, position: Triple, scale: Triple, rotation?: Triple) => void
export type ModelBatch = { finish: Finish; geometry: BufferGeometry }

/** Merge only within one moving/culling boundary: at most four draws per model. */
export function batchOctagonalModel(kit: OctagonalKit, author: (add: AddPart) => void): ModelBatch[] {
  const parts: Partial<Record<Finish, BufferGeometry[]>> = {}
  const transform = new Object3D()
  author((shape, finish, position, scale, rotation = [0, 0, 0]) => {
    transform.position.fromArray(position)
    transform.scale.fromArray(scale)
    transform.rotation.set(...rotation)
    transform.updateMatrix()
    const geometry = kit.shapes[shape].clone().applyMatrix4(transform.matrix)
    ;(parts[finish] ??= []).push(geometry)
  })
  return (Object.keys(parts) as Finish[]).map(finish => {
    const sources = parts[finish]!
    const geometry = mergeGeometries(sources)!
    sources.forEach(source => source.dispose())
    geometry.computeBoundingSphere()
    return { finish, geometry }
  })
}

export function disposeOctagonalKit(kit: OctagonalKit) {
  Object.values(kit.shapes).forEach(shape => shape.dispose())
  Object.values(kit.materials).forEach(material => material.dispose())
}
