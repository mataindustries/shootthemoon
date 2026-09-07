import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { MODULE_MODEL_SCALE, SOLAR_PANEL, SOLAR_WING_SLOT } from './solarWingLayout.ts'
import { LOCAL_METRES_TO_RENDER_UNITS } from '../render/localSurface.ts'

it('keeps both tilted panel volumes outside the lander footprint throughout construction', () => {
  // Capsule landing pads extend 1.28 model units at 0.00029 scale.
  // Site orientation rotates both objects rigidly; viewport cannot change clearance.
  const landerHalfWidthM = 1.28 * 0.00029 / LOCAL_METRES_TO_RENDER_UNITS
  for (let step = 0; step <= 100; step++) {
    const t = step / 100
    const eased = t * t * (3 - 2 * t)
    const scaleM = MODULE_MODEL_SCALE / LOCAL_METRES_TO_RENDER_UNITS * (0.15 + eased * 0.85)
    for (const side of [-1, 1]) for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new Vector3(x * SOLAR_PANEL.width / 2, y * SOLAR_PANEL.height / 2, z * SOLAR_PANEL.depth / 2)
        .applyAxisAngle(new Vector3(0, 0, 1), -side * SOLAR_PANEL.tilt)
        .add(new Vector3(side * SOLAR_PANEL.offsetX, 1.02, 0))
        .multiplyScalar(scaleM)
        .applyAxisAngle(new Vector3(0, 1, 0), SOLAR_WING_SLOT.headingRad - (1 - eased) * 0.18)
      expect(corner.x + SOLAR_WING_SLOT.xM).toBeLessThan(-landerHalfWidthM - 0.5)
    }
  }
})
