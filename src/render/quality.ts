export type RenderQuality = 'high' | 'medium' | 'low'

interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number
}

export interface QualitySettings {
  readonly tier: RenderQuality
  readonly moonWidthSegments: number
  readonly moonHeightSegments: number
  readonly patchSegments: number
  readonly starCount: number
  readonly maxDpr: number
}

export function detectQualitySettings(): QualitySettings {
  const navigatorWithMemory = navigator as NavigatorWithMemory
  const memory = navigatorWithMemory.deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency || 8

  if (memory <= 4 || cores <= 4) {
    return {
      tier: 'low',
      moonWidthSegments: 128,
      moonHeightSegments: 64,
      patchSegments: 96,
      starCount: 480,
      maxDpr: 1,
    }
  }

  if (memory <= 6 || cores <= 8) {
    return {
      tier: 'medium',
      moonWidthSegments: 160,
      moonHeightSegments: 80,
      patchSegments: 112,
      starCount: 640,
      maxDpr: 1.25,
    }
  }

  return {
    tier: 'high',
    moonWidthSegments: 192,
    moonHeightSegments: 96,
    patchSegments: 128,
    starCount: 800,
    maxDpr: 1.5,
  }
}

export function calculateDpr(
  width: number,
  height: number,
  maxDpr: number,
): number {
  const cssPixelCount = Math.max(1, width * height)
  const pixelCapDpr = Math.sqrt(1_000_000 / cssPixelCount)

  return Math.max(
    0.75,
    Math.min(window.devicePixelRatio || 1, maxDpr, pixelCapDpr),
  )
}
