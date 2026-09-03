import { describe, expect, it } from 'vitest'
import { shouldEnableE2eHarness } from './e2eHarness.ts'

describe('browser E2E harness gate', () => {
  it('cannot be enabled in an ordinary production build by a public URL', () => {
    expect(shouldEnableE2eHarness(false, '')).toBe(false)
    expect(shouldEnableE2eHarness(false, '?e2e')).toBe(false)
    expect(shouldEnableE2eHarness(false, '?e2e=1&testHarness=true')).toBe(false)
  })

  it('requires both the explicit harness build and explicit test URL', () => {
    expect(shouldEnableE2eHarness(true, '')).toBe(false)
    expect(shouldEnableE2eHarness(true, '?restoredSave=e2e')).toBe(false)
    expect(shouldEnableE2eHarness(true, '?e2e')).toBe(true)
  })
})
