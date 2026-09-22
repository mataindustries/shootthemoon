import { FULL_SAFE_AREA, type SurfaceSafeArea } from './miningFraming.ts'

/**
 * How much of the canvas the landed HUD is actually covering.
 *
 * The bottom chrome is width-dependent: `.command-deck` and `.operations-panel`
 * are capped at 25-28rem and move to a left gutter above 900px, so on desktop
 * they sit beside the shot while on a 390px phone they span it. Measuring beats
 * restating those breakpoints in the camera.
 */

export interface PanelRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** Only bottom chrome crossing this centre band pushes the subject upward. */
const CENTRE_BAND = 0.34
/** Never surrender more than this much of the frame to either edge. */
const MAXIMUM_INSET = 0.34

const TOP_PANELS = ['.hud-header', '.surface-status'] as const
const BOTTOM_PANELS = ['.command-deck', '.operations-panel'] as const

function overlapsCentre(panel: PanelRect, canvas: PanelRect): boolean {
  const width = canvas.right - canvas.left

  if (width <= 0) {
    return false
  }

  const bandLeft = canvas.left + width * (0.5 - CENTRE_BAND / 2)
  const bandRight = canvas.left + width * (0.5 + CENTRE_BAND / 2)
  return panel.right > bandLeft && panel.left < bandRight
}

export function computeSurfaceSafeArea(
  canvas: PanelRect,
  topPanels: readonly PanelRect[],
  bottomPanels: readonly PanelRect[],
): SurfaceSafeArea {
  const height = canvas.bottom - canvas.top

  if (height <= 0) {
    return FULL_SAFE_AREA
  }

  let top = 0
  let bottom = 0

  for (const panel of topPanels) {
    // Top chrome spans the full width in every layout, so it always counts.
    top = Math.max(top, (panel.bottom - canvas.top) / height)
  }

  for (const panel of bottomPanels) {
    if (!overlapsCentre(panel, canvas)) {
      continue
    }

    bottom = Math.max(bottom, (canvas.bottom - panel.top) / height)
  }

  return {
    top: Math.max(0, Math.min(MAXIMUM_INSET, top)),
    bottom: Math.max(0, Math.min(MAXIMUM_INSET, bottom)),
  }
}

function readRects(selectors: readonly string[]): PanelRect[] {
  const rects: PanelRect[] = []

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect()

      if (rect.width > 0 && rect.height > 0) {
        rects.push(rect)
      }
    }
  }

  return rects
}

/** Measures the live HUD. Callers throttle this; it forces a layout read. */
export function measureSurfaceSafeArea(canvas: HTMLCanvasElement): SurfaceSafeArea {
  return computeSurfaceSafeArea(
    canvas.getBoundingClientRect(),
    readRects(TOP_PANELS),
    readRects(BOTTOM_PANELS),
  )
}
