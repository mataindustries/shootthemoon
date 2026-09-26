/**
 * Capture profile definitions.
 *
 * This module is pure (no Playwright, no DOM) so its math can be checked by a
 * plain assertion without a browser. It intentionally mirrors, but does not
 * import, the production DPR formula in `../src/render/quality.ts`:
 *
 *   pixelCapDpr = sqrt(1_000_000 / (cssWidth * cssHeight))
 *   dpr = max(0.75, min(devicePixelRatio, maxDpr, pixelCapDpr))
 *
 * `maxDpr` tops out at 1.5 for the forced "high" quality tier (see
 * `detectQualitySettings` in that same file). For a full HD/4K CSS viewport,
 * `pixelCapDpr` alone would resolve well under 1, because the production
 * renderer intentionally caps around one megapixel. PLATE and HUD want the
 * *real* 3D renderer driven at a high backing-buffer resolution anyway, so we
 * feed `calculateDpr` a fake, tiny `(width, height)` pair through a
 * Playwright init-time browser-property override (see `initCapture.ts`).
 * That override affects only the two numbers `calculateDpr` reads
 * (`window.innerWidth` / `window.innerHeight` — confirmed to have no other
 * production call site) and never touches actual CSS layout, so HUD
 * safe-area measurement (`src/camera/surfaceSafeArea.ts`, which reads real
 * `getBoundingClientRect()` boxes) is unaffected.
 *
 * PORT is different on purpose: it exists to prove genuine mobile behavior,
 * including the real megapixel cap, so it never applies the override.
 */

export type CaptureProfileId = 'PLATE' | 'HUD' | 'PORT'

/** Matches the forced "high" tier's maxDpr in src/render/quality.ts. */
export const FORCED_QUALITY_TIER_MAX_DPR = 1.5

/** Mirrors calculateDpr's megapixel ceiling term. Exported for self-checks. */
export function pixelCapDpr(cssWidth: number, cssHeight: number): number {
  const cssPixelCount = Math.max(1, cssWidth * cssHeight)
  return Math.sqrt(1_000_000 / cssPixelCount)
}

/** Mirrors calculateDpr's full formula, with devicePixelRatio as a parameter
 * instead of a `window` read, so it can run outside a browser. Used only to
 * verify our override math on paper; the live assertion against the real
 * production function happens in capture/integrity.spec.ts against a real
 * page. */
export function mirrorCalculateDpr(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr: number = FORCED_QUALITY_TIER_MAX_DPR,
): number {
  return Math.max(
    0.75,
    Math.min(devicePixelRatio, maxDpr, pixelCapDpr(cssWidth, cssHeight)),
  )
}

export interface DprOverride {
  /** Fake window.innerWidth/innerHeight fed only to calculateDpr's call
   * sites, chosen so pixelCapDpr no longer binds below the target DPR. */
  readonly fakeInnerWidth: number
  readonly fakeInnerHeight: number
}

export interface CaptureProfile {
  readonly id: CaptureProfileId
  readonly description: string
  readonly cssWidth: number
  readonly cssHeight: number
  readonly deviceScaleFactor: number
  readonly isMobile: boolean
  readonly hasTouch: boolean
  readonly userAgent?: string
  /** When set, initCapture applies the window.innerWidth/innerHeight
   * override so calculateDpr resolves to `deviceScaleFactor`. When absent
   * (PORT), production DPR math runs completely untouched. */
  readonly dprOverride: DprOverride | null
}

/** A synthetic 16:9 pair small enough that pixelCapDpr clears 1.5 with
 * margin (sqrt(1_000_000 / (640*360)) ≈ 2.08), used for both PLATE and HUD
 * since the override target is the same maxDpr ceiling for both. */
const HIGH_RES_DPR_OVERRIDE: DprOverride = {
  fakeInnerWidth: 640,
  fakeInnerHeight: 360,
}

export const PROFILES: Readonly<Record<CaptureProfileId, CaptureProfile>> = Object.freeze({
  PLATE: Object.freeze({
    id: 'PLATE',
    description:
      'Clean cinematic footage, HUD hidden via opacity while its layout stays active.',
    cssWidth: 2560,
    cssHeight: 1440,
    deviceScaleFactor: 1.5,
    isMobile: false,
    hasTouch: false,
    dprOverride: HIGH_RES_DPR_OVERRIDE,
  }),
  HUD: Object.freeze({
    id: 'HUD',
    description: '16:9 footage where the game UI stays readable.',
    cssWidth: 1280,
    cssHeight: 720,
    deviceScaleFactor: 1.5,
    isMobile: false,
    hasTouch: false,
    dprOverride: HIGH_RES_DPR_OVERRIDE,
  }),
  PORT: Object.freeze({
    id: 'PORT',
    description:
      'Real mobile proof: genuine touch/mobile viewport, unmodified production DPR math (including its real megapixel cap).',
    cssWidth: 390,
    cssHeight: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    dprOverride: null,
  }),
})

/** The exact WebGL backing-buffer size a profile should produce, given the
 * forced-high-tier maxDpr. Used both to pick the override and to assert the
 * live `data-buffer-width`/`data-buffer-height` canvas dataset afterwards. */
export function expectedCanvasBufferSize(profile: CaptureProfile): {
  readonly width: number
  readonly height: number
  readonly dpr: number
} {
  const dpr = profile.dprOverride
    ? mirrorCalculateDpr(
        profile.dprOverride.fakeInnerWidth,
        profile.dprOverride.fakeInnerHeight,
        profile.deviceScaleFactor,
      )
    : mirrorCalculateDpr(profile.cssWidth, profile.cssHeight, profile.deviceScaleFactor)

  return {
    width: Math.round(profile.cssWidth * dpr),
    height: Math.round(profile.cssHeight * dpr),
    dpr,
  }
}
