import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, MeshStandardMaterial, Object3D, TorusGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { EMISSIVE_LIMITS, MATERIAL_RESPONSE as R, VISUAL_PALETTE as P } from './visualSystem.ts'

type Triple = readonly [number, number, number]
const finishes = {
  ceramic: [P.miningCeramic, R.monumentCeramic.roughness, R.monumentCeramic.metalness, .025, 0],
  carbon: [P.miningCarbon, R.playerComposite.roughness, R.playerComposite.metalness, .025, 1],
  rubber: [P.contactDark, R.contact.roughness, R.contact.metalness, 0, 0],
  steel: [P.neutralMachinery, R.playerSteel.roughness, R.playerSteel.metalness, .015, 0],
  gold: [P.monumentGold, R.monumentTrim.roughness, R.monumentTrim.metalness, .035, 0],
  amber: [P.monumentAmber, .4, .2, EMISSIVE_LIMITS.panel, 0],
  cyan: [P.monumentCyan, .45, .15, EMISSIVE_LIMITS.panel, 0],
  basalt: [P.miningBasalt, .94, .06, 0, 0],
  mineral: [P.miningMineral, .48, .32, .045, 0],
  vein: [P.miningVein, .4, .3, .14, 0],
} as const
export type MiningFinish = keyof typeof finishes

/** One opaque draw per moving assembly. Finish attributes retain ceramic,
 * carbon, brass and tiny LEDs without separate material/shadow passes. */
export function createMiningMaterial() {
  const material = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, metalness: 1, emissive: '#ffffff', emissiveIntensity: 1 })
  material.customProgramCacheKey = () => 'octogonal-mining-v1'
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 miningFinish; varying vec4 vMiningFinish; varying vec2 vMiningUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMiningFinish = miningFinish; vMiningUv = uv;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vMiningFinish; varying vec2 vMiningUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 weaveUv = vec2(vMiningUv.x + vMiningUv.y, vMiningUv.x - vMiningUv.y) * 48.0;
        vec2 aa = max(fwidth(weaveUv), vec2(0.001));
        vec2 strand = 1.0 - smoothstep(vec2(0.18) - aa, vec2(0.18) + aa, abs(fract(weaveUv) - 0.5));
        float resolved = 1.0 - smoothstep(0.3, 1.1, max(aa.x, aa.y));
        float weave = mix(1.0, 0.84 + 0.28 * (strand.x * 0.65 + strand.y * 0.35), resolved);
        diffuseColor.rgb *= mix(1.0, weave, vMiningFinish.w);
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMiningFinish.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMiningFinish.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * vMiningFinish.z;')
  }
  return material
}

export function createMiningKit() {
  // Opposed faces for inlaid trim: its sub-pixel edge walls are not useful
  // geometry on a phone. Keep the same opaque, depth-tested material.
  const panel = new BoxGeometry(1, 1, 1)
  panel.setIndex(Array.from(panel.index!.array).slice(24))
  panel.clearGroups()
  const bevel = new CylinderGeometry(1, 1, 1, 8, 2, false, Math.PI / 8)
  const positions = bevel.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i)
    const inset = Math.abs(y) > .49 ? .84 : 1
    positions.setXYZ(i, positions.getX(i) * inset, y, positions.getZ(i) * inset)
  }
  bevel.computeVertexNormals()
  return {
    shapes: { box: new BoxGeometry(1, 1, 1), panel, bevel, tube: new CylinderGeometry(1, 1, 1, 6), taper: new CylinderGeometry(.16, 1, 1, 6), ring: new TorusGeometry(1, .045, 3, 8) },
    material: createMiningMaterial(),
  }
}
export type MiningKit = ReturnType<typeof createMiningKit>
export type AddMiningPart = (shape: keyof MiningKit['shapes'] | BufferGeometry, finish: MiningFinish, position: Triple, scale: Triple, rotation?: Triple) => void

export function batchMiningModel(kit: MiningKit, author: (add: AddMiningPart) => void) {
  const parts: BufferGeometry[] = []
  const transform = new Object3D()
  author((shape, finish, position, scale, rotation = [0, 0, 0]) => {
    transform.position.fromArray(position)
    transform.scale.fromArray(scale)
    transform.rotation.set(...rotation)
    transform.updateMatrix()
    let source = typeof shape === 'string' ? kit.shapes[shape] : shape
    const thin = shape === 'box' && ['gold', 'amber', 'cyan', 'rubber'].includes(finish) && Math.min(...scale) < .081
    if (thin) {
      source = kit.shapes.panel.clone()
      const axis = scale.indexOf(Math.min(...scale))
      if (axis === 0) source.rotateY(Math.PI / 2)
      if (axis === 1) source.rotateX(Math.PI / 2)
    }
    const geometry = (source.index ? source.toNonIndexed() : source.clone()).applyMatrix4(transform.matrix)
    if (thin) source.dispose()
    geometry.computeVertexNormals()
    const count = geometry.getAttribute('position').count
    const [hex, roughness, metalness, emission, carbon] = finishes[finish]
    const color = new Color(hex)
    const colors = new Float32Array(count * 3)
    const surface = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      color.toArray(colors, i * 3)
      surface.set([roughness, metalness, emission, carbon], i * 4)
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setAttribute('miningFinish', new BufferAttribute(surface, 4))
    if (!geometry.hasAttribute('uv')) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
    parts.push(geometry)
  })
  const geometry = mergeGeometries(parts)!
  parts.forEach(part => part.dispose())
  geometry.computeBoundingSphere()
  return geometry
}

export function disposeMiningKit(kit: MiningKit) {
  Object.values(kit.shapes).forEach(shape => shape.dispose())
  kit.material.dispose()
}
