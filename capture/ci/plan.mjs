#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Emits the Actions render matrix for .github/workflows/final-render.yml.
 *
 *   --mode=smoke --clip=c07       one group with one clip (Stage 1)
 *   --mode=full                   every progress-event clip in a runner job of
 *                                 its own, the cheap clips (stills, fast
 *                                 elapsed-ms) grouped per act (Stage 2)
 *   --mode=repair --clips=c01,..  the listed clips, one runner job each
 *                                 (default: run #4's failures)
 *   --mode=final-preflight        the four cheap preflight checks
 *                                 (reelCi.ts PREFLIGHT_PARTS), in parallel
 *
 * Prints a human-readable table, and — when $GITHUB_OUTPUT is set — writes
 * `matrix` (JSON for strategy.matrix; each row's `kind` is render or
 * preflight), `expected_clips` (comma-separated; empty for final-preflight,
 * which verifies inside each part instead of assembling a reel) for the
 * downstream jobs.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinalRenderJobs } from '../finalRender/plan.ts'
import { SHOTS } from '../manifest.ts'
import {
  JOB_CEILING_MINUTES,
  MEASURED_COST_MODEL,
  RUN4_REPAIR_CLIPS,
  partitionForCi,
  preflightMatrix,
  repairGroups,
  smokeGroup,
  timelineJobs,
} from './reelCi.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  }),
)
const mode = args.mode || 'smoke'

const edit = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/finalEdit.json'), 'utf8'))
const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const jobs = timelineJobs(edit, buildFinalRenderJobs(edit, shotIndex))

let matrix
let expectedClips
if (mode === 'final-preflight') {
  matrix = preflightMatrix()
  expectedClips = []
  console.log(`mode=final-preflight  ${matrix.include.length} parallel job(s)`)
  for (const row of matrix.include) console.log(`  ${row.group.padEnd(26)} ~${String(row.estimated_minutes).padStart(3)} min  ${row.clips}`)
} else {
  let groups
  if (mode === 'smoke') groups = [smokeGroup(jobs, args.clip || 'c07')]
  else if (mode === 'full') groups = partitionForCi(jobs)
  else if (mode === 'repair') {
    const clipIds = (args.clips || RUN4_REPAIR_CLIPS.join(',')).split(/[,\s]+/).filter(Boolean)
    groups = repairGroups(jobs, clipIds)
  } else throw new Error(`--mode must be smoke, full, repair or final-preflight, got ${mode}`)

  const longest = Math.max(...groups.map((group) => group.estimatedMinutes))
  console.log(
    `mode=${mode}  ${groups.length} job(s)  ceiling ${JOB_CEILING_MINUTES} min  cost model: ${MEASURED_COST_MODEL.provenance} ` +
      `(x${MEASURED_COST_MODEL.safetyFactor} safety)`,
  )
  for (const group of groups) {
    console.log(`  ${group.id.padEnd(26)} ${String(group.sourceFrames).padStart(4)} frames  ~${String(group.estimatedMinutes).padStart(3)} min  ${group.clipIds.join(',')}`)
  }
  console.log(`  longest job estimate: ${longest} min`)
  expectedClips = groups.flatMap((group) => group.clipIds)
  matrix = {
    include: groups.map((group) => ({
      group: group.id,
      label: group.label,
      clips: group.clipIds.join(','),
      estimated_minutes: group.estimatedMinutes,
      kind: 'render',
    })),
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nexpected_clips=${expectedClips.join(',')}\n`)
}
