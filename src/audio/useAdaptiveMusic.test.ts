import { describe, expect, it } from 'vitest'
import { resolveMusicMode } from './useAdaptiveMusic.ts'

describe('music mode', () => {
  it('plays in full by default, dry inside the e2e harness, off for ?music=0', () => {
    expect(resolveMusicMode('', false, true)).toBe('full')
    expect(resolveMusicMode('?e2e', true, true)).toBe('dry')
    expect(resolveMusicMode('?e2e&music=full', true, true)).toBe('full')
    expect(resolveMusicMode('?music=0', false, true)).toBe('off')
    expect(resolveMusicMode('?e2e&music=0', true, true)).toBe('off')
    expect(resolveMusicMode('?music=off', false, true)).toBe('off')
    // ?e2e alone in an ordinary build is not the harness: the caller decides that.
    expect(resolveMusicMode('?e2e', false, true)).toBe('full')
    expect(resolveMusicMode('', false, false)).toBe('off')
    expect(resolveMusicMode('?e2e', true, false)).toBe('dry')
  })
})
