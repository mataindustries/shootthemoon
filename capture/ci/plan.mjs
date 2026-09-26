#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Emits the Actions render matrix for .github/workflows/final-render.yml.
 *
 *   --mode=smoke --clip=c07   one group with one clip (Stage 1)
 *   --mode=full               one group per act, split by clip only if an
 *                             act's safety-factored estimate exceeds the
 *                             4.5h ceiling (Stage 2)
 *
 * Prints a human-readable table, and — when $GITHUB_OUTPUT is set — writes
 * `matrix` (JSON for strategy.matrix), `expected_clips` (comma-separated)
 * and `groups` for the downstream jobs.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinalRenderJobs } from '../finalRender/plan.ts'
import { SHOTS } from '../manifest.ts'
import { JOB_CEILING_MINUTES, MEASURED_COST_MODEL, partitionByAct, smokeGroup, timelineJobs } from './reelCi.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const mode = args.mode ?? 'smoke'

const edit = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/finalEdit.json'), 'utf8'))
const shotIndex = SHOTS.map((shot) => ({ id: shot.id, profile: shot.profile, hudMode: shot.hud.mode }))
const jobs = timelineJobs(edit, buildFinalRenderJobs(edit, shotIndex))

let groups
if (mode === 'smoke') groups = [smokeGroup(jobs, args.clip ?? 'c07')]
else if (mode === 'full') groups = partitionByAct(jobs)
else throw new Error(`--mode must be smoke or full, got ${mode}`)

const longest = Math.max(...groups.map((group) => group.estimatedMinutes))
console.log(`mode=${mode}  ${groups.length} job(s)  ceiling ${JOB_CEILING_MINUTES} min  cost model: ${MEASURED_COST_MODEL.provenance} (x${MEASURED_COST_MODEL.safetyFactor} safety)`)
for (const group of groups) {
  console.log(`  ${group.id.padEnd(26)} ${String(group.sourceFrames).padStart(4)} frames  ~${String(group.estimatedMinutes).padStart(3)} min  ${group.clipIds.join(',')}`)
}
console.log(`  longest job estimate: ${longest} min`)

const expectedClips = groups.flatMap((group) => group.clipIds)
const matrix = { include: groups.map((group) => ({ group: group.id, label: group.label, clips: group.clipIds.join(','), estimated_minutes: group.estimatedMinutes })) }
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nexpected_clips=${expectedClips.join(',')}\n`)
}
