import { MeshStandardMaterial } from 'three'
import { MATERIAL_RESPONSE, VISUAL_PALETTE } from './visualSystem.ts'

/** Filtered procedural diamond weave under ceramic plates: no maps or extra draws. */
export function createPlayerCompositeMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: VISUAL_PALETTE.playerComposite,
    ...MATERIAL_RESPONSE.playerComposite,
    emissive: VISUAL_PALETTE.playerAmberEmissive,
    emissiveIntensity: 0.12,
  })
  material.customProgramCacheKey = () => 'player-composite-v1'
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCompositeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCompositeUv = uv;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCompositeUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 weaveUv = vec2(vCompositeUv.x + vCompositeUv.y, vCompositeUv.x - vCompositeUv.y) * 64.0;
        vec2 aa = max(fwidth(weaveUv), vec2(0.001));
        vec2 strand = abs(fract(weaveUv) - 0.5);
        vec2 weave = 1.0 - smoothstep(vec2(0.20) - aa, vec2(0.20) + aa, strand);
        float resolved = 1.0 - smoothstep(0.3, 1.1, max(aa.x, aa.y));
        float grain = mix(0.5, weave.x * 0.65 + weave.y * 0.35, resolved);
        vec2 panelUv = vCompositeUv * vec2(12.0, 4.0);
        vec2 edge = min(fract(panelUv), 1.0 - fract(panelUv));
        vec2 panelAA = max(fwidth(panelUv), vec2(0.001));
        float seam = 1.0 - smoothstep(0.018, 0.018 + panelAA.x, edge.x);
        float band = 1.0 - smoothstep(0.028, 0.028 + panelAA.y, edge.y);
        diffuseColor.rgb *= mix(0.77, 1.25, grain) * (1.0 - 0.35 * max(seam, band));
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (grain - 0.5) * 0.16, 0.3, 0.85);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= seam * (0.14 + band * 0.35);')
  }
  return material
}
