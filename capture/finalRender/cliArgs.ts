/**
 * Pure CLI-argument parsing + job selection for capture/finalRender.mjs.
 * Supports the four selection modes Phase C asks for: one clip, one act, one
 * profile, or all selected clips — plus --proof (cheap gate mode) and
 * --force (re-render even an already-complete clip).
 */
import type { FinalRenderJob, JobAct } from './plan.ts'
import type { CaptureProfileId } from '../profiles.ts'

export interface FinalRenderSelection {
  readonly clip: string | null
  readonly act: JobAct | null
  readonly profile: CaptureProfileId | null
  readonly all: boolean
  readonly proof: boolean
  readonly force: boolean
}

const KNOWN_FLAGS = new Set(['--all', '--proof', '--force'])
const KNOWN_PREFIXES = ['--clip=', '--act=', '--profile='] as const

export function parseFinalRenderArgs(argv: readonly string[]): FinalRenderSelection {
  let clip: string | null = null
  let act: string | null = null
  let profile: string | null = null
  let all = false
  let proof = false
  let force = false

  for (const arg of argv) {
    if (arg === '--all') all = true
    else if (arg === '--proof') proof = true
    else if (arg === '--force') force = true
    else if (arg.startsWith('--clip=')) clip = arg.slice('--clip='.length)
    else if (arg.startsWith('--act=')) act = arg.slice('--act='.length)
    else if (arg.startsWith('--profile=')) profile = arg.slice('--profile='.length)
    else {
      throw new Error(
        `Unknown final-render argument "${arg}". Expected one of: ${[...KNOWN_FLAGS, ...KNOWN_PREFIXES.map((p) => `${p}<value>`)].join(', ')}`,
      )
    }
  }

  const selectorCount = [clip !== null, act !== null, profile !== null, all].filter(Boolean).length
  if (selectorCount === 0) {
    throw new Error('Specify exactly one of --clip=<id>, --act=<ACT>, --profile=<PLATE|HUD|PORT>, or --all.')
  }
  if (selectorCount > 1) {
    throw new Error('Specify only one of --clip, --act, --profile, --all at a time.')
  }

  return {
    clip,
    act: act as JobAct | null,
    profile: profile as CaptureProfileId | null,
    all,
    proof,
    force,
  }
}

export function selectJobs(jobs: readonly FinalRenderJob[], selection: FinalRenderSelection): FinalRenderJob[] {
  if (selection.clip !== null) return jobs.filter((job) => job.jobId === selection.clip)
  if (selection.act !== null) return jobs.filter((job) => job.act === selection.act)
  if (selection.profile !== null) return jobs.filter((job) => job.profile === selection.profile)
  return [...jobs]
}
