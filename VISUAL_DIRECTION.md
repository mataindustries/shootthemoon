# FIRST STRIKE release-candidate visual direction

The Moon is the brightest large surface in frame, but it must retain texture
and shadow detail. Space is near-black. Sunlight is hard and fixed in the lunar
frame; camera movement must not drag the key light with it.

Player technology uses a shared villain-industrial kit: blackened armor,
warm dark steel, heat wear, chunky contact hardware, rectangular panels,
braces, vents, pipes, and small amber/red internal lights. Amber is an accent,
not a luminous shell.

Null Meridian is distinct: a mostly dark asymmetric skeleton, narrow surgical
panels, a broken-crown command silhouette, and controlled cyan-white sensor
elements. At least two thirds of the silhouette remains dark under direct
light. White is reserved for small facets and never used as a structural base.

Lunar damage is physical and irregular: a concave charred floor, raised broken
rim, patchy radial ejecta, embedded dark wreckage, and a few cooling thermal
points. Perfect discs, torus outlines, evenly spaced rays, atmospheric clouds,
and large untone-mapped additive layers are excluded.

Materials remain opaque unless they represent dust, exhaust, or a very small
flash. World effects stay tone mapped. Emissive intensity is normally below
0.65; only tiny LEDs may briefly reach 0.82. Geometry and shared materials are
preferred over post-processing.

## Implementation contract

`src/render/visualSystem.ts` is the integration authority for renderer color
space, tone mapping, exposure, palette, and material responses. Scene modules
consume those shared values instead of inventing independent faction whites,
emissive ranges, or metal/roughness conventions. New visual work must preserve
that ownership boundary.

Hard sunlight remains fixed in the global lunar frame through every camera cut.
The close-view shadow camera may follow launch, reveal, impact, and scar
exploration for useful contact shadows, but it must never imply that the Sun
rotates with the viewer. Uniform ambient fill exists only to retain readable
OLED shadow detail.

Local structures attach to the final sampled terrain height plus a small,
documented contact clearance. Player landing feet, the intact and damaged rival
foothold, crater, ejecta, and wreckage must not reuse a prior flat-plane height.
Canonical latitude, longitude, altitude, and local tangent transforms remain
domain authority; render meshes never enter persistent state.

Animated effects own only their active presentation phase. Once a scene reaches
idle, ending, or interactive scar exploration, effect invalidators, timers,
particles, audio schedulers, and continuous frame requests must be absent or
demand-idle. Replay is transient presentation and must not duplicate or rewrite
the persisted scar.

The automated release-candidate gate and final evidence inspection passed on
2026-08-31. Physical Android acceptance remains separate; this document stays
the governing visual contract for any later release-pass correction.
