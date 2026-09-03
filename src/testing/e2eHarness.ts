export const E2E_HARNESS_BUILD_ENABLED =
  import.meta.env.VITE_E2E_HARNESS === '1'

export function shouldEnableE2eHarness(
  buildEnabled: boolean,
  search: string,
): boolean {
  return buildEnabled && new URLSearchParams(search).has('e2e')
}
