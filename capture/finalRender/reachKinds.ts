/**
 * Declares, per shot id, which native clock kind (capture/finalEdit.ts's
 * SourceWindow['clock']) that shot's final-render reach function drives.
 * Pure data — no browser — so capture/finalRenderPlan.spec.ts can statically
 * cross-check every job capture/finalRender/plan.ts produces against the
 * kind its capture/finalRender/reach.ts implementation actually returns,
 * without launching a page.
 */
import type { SourceWindow } from '../finalEdit.ts'

export const REACH_KIND: Readonly<Record<string, SourceWindow['clock']>> = Object.freeze({
  'descent-touchdown': 'progress',
  'touchdown-dust': 'progress',
  'vesper-citadel-reveal': 'progress',
  'vesper-transmission': 'progress',
  'first-strike-arm-dialog': 'still',
  'first-strike-liftoff': 'progress',
  'first-strike-orbital-flight': 'progress',
  'first-strike-target-approach': 'progress',
  'first-strike-impact-flash': 'progress',
  'first-strike-ejecta': 'progress',
  'first-strike-ending-text': 'still',
  'counterstrike-fire-now': 'still',
  'counterstrike-fire-now-port': 'still',
  'counterstrike-terminal-dive': 'progress',
  'counterstrike-impact-contact': 'progress',
  'divider-incoming-formation': 'elapsed-ms',
  'divider-fire-defense-port': 'still',
  'divider-weapon-volley': 'elapsed-ms',
  'divider-defense-interaction': 'elapsed-ms',
  'divider-monument-survives': 'still',
  'helios-mechanical-peak': 'elapsed-ms',
  'signal-array-mechanical-peak': 'elapsed-ms',
  'crater-crown-early-reveal': 'elapsed-ms',
  'bastion-held-hero': 'elapsed-ms',
  'monument-selection-port': 'still',
})
