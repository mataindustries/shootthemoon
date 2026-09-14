import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createTouchdownCameraTransition, landingCameraBeat, sampleTouchdownCamera } from './touchdownCameraPlan.ts'
import { getSurfaceCameraPose } from './touchdownCameraPlan.ts'
import { createLandingSite, createLunarLocation } from '../domain/lunarCoordinates.ts'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'

const site = createLandingSite(createLunarLocation(.24, -.68))
const end = getSurfaceCameraPose(site, createSurfaceTerrainProfile(site), 32)
const sample = () => [new Vector3(), new Vector3(), new Vector3()] as const

describe('single touchdown camera transition', () => {
  it('restores the earlier bowed descent, then holds the exact settled pose before handing back control', () => {
    const transition = createTouchdownCameraTransition({ position: end.position.clone().setLength(4.7),
      target: new Vector3(), up: new Vector3(0, 1, 0) }, end, 58, 54)
    expect(transition.descent).not.toBeNull()
    const pose = sample()
    sampleTouchdownCamera(transition, .8, ...pose)
    expect(pose[0].distanceTo(end.position)).toBeLessThan(.02)
    for (const p of [.9, .94, .99, 1]) {
      expect(sampleTouchdownCamera(transition, p, ...pose)).toBe(54)
      expect(pose[0].distanceTo(end.position)).toBeLessThan(1e-12)
      expect(pose[1].distanceTo(end.target)).toBeLessThan(1e-12)
      expect(landingCameraBeat(p)).toBe('hold')
    }
    expect(landingCameraBeat(.85)).toBe('descent')
    expect(landingCameraBeat(.87)).toBe('touchdown')
  })
  it('snapshots targets, ignores stale orbit mutations and lands exactly at the normal outpost pose', () => {
    const start = { position: new Vector3(3, .3, 1), target: new Vector3(), up: new Vector3(0, 1, 0) }
    const transition = createTouchdownCameraTransition(start, end, 58, 54)
    const before = sample()
    sampleTouchdownCamera(transition, .6, ...before)
    start.position.set(-4, 1, -2)
    start.target.set(4, 4, 4)
    const after = sample()
    sampleTouchdownCamera(transition, .6, ...after)
    expect(after).toEqual(before)
    expect(sampleTouchdownCamera(transition, 1, ...after)).toBe(54)
    expect(after[0].distanceTo(end.position)).toBeLessThan(1e-12)
    expect(after[1].distanceTo(end.target)).toBeLessThan(1e-12)
    expect(after[2].distanceTo(end.up)).toBeLessThan(1e-12)
  })

  it('keeps the camera above the Moon and avoids a projection snap at touchdown', () => {
    const transition = createTouchdownCameraTransition({ position: end.position.clone().negate().setLength(4.7),
      target: new Vector3(), up: new Vector3(0, 1, 0) }, end, 58, 54)
    const pose = sample()
    let previousFov = 58
    for (let i = 0; i <= 1000; i++) {
      const fov = sampleTouchdownCamera(transition, i / 1000, ...pose)
      expect(pose[0].length()).toBeGreaterThan(MOON_RENDER_RADIUS)
      expect(Math.abs(fov - previousFov)).toBeLessThan(.02)
      previousFov = fov
    }
  })
})
