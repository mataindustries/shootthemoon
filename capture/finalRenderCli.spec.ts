/**
 * CLI-filter tests (Phase C): --clip / --act / --profile / --all, plus
 * --proof and --force, and that selectJobs actually narrows the job list
 * the way each flag promises. No browser.
 */
import { expect, test } from '@playwright/test'
import type { FinalRenderJob } from './finalRender/plan.ts'
import { parseFinalRenderArgs, selectJobs } from './finalRender/cliArgs.ts'

const JOBS: FinalRenderJob[] = [
  {
    jobId: 'c01',
    shotId: 'descent-touchdown',
    profile: 'PLATE',
    act: 'ARRIVAL',
    source: { clock: 'still' },
    frames: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    cropEnd: { x: 0, y: 0, w: 1, h: 1 },
    order: 0,
  },
  {
    jobId: 'c05',
    shotId: 'first-strike-arm-dialog',
    profile: 'HUD',
    act: 'FIRST_STRIKE',
    source: { clock: 'still' },
    frames: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    cropEnd: { x: 0, y: 0, w: 1, h: 1 },
    order: 1,
  },
  {
    jobId: 'c14',
    shotId: 'counterstrike-fire-now-port',
    profile: 'PORT',
    act: 'COUNTERSTRIKE',
    source: { clock: 'still' },
    frames: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    cropEnd: { x: 0, y: 0, w: 1, h: 1 },
    order: 2,
  },
]

test.describe('CLI argument parsing', () => {
  test('--clip=<id> selects exactly one clip', () => {
    const selection = parseFinalRenderArgs(['--clip=c05'])
    expect(selection).toMatchObject({ clip: 'c05', act: null, profile: null, all: false })
    expect(selectJobs(JOBS, selection).map((job) => job.jobId)).toEqual(['c05'])
  })

  test('--act=<ACT> selects every clip in that act', () => {
    const selection = parseFinalRenderArgs(['--act=FIRST_STRIKE'])
    expect(selectJobs(JOBS, selection).map((job) => job.jobId)).toEqual(['c05'])
  })

  test('--profile=<PROFILE> selects every clip captured under that profile', () => {
    const selection = parseFinalRenderArgs(['--profile=PORT'])
    expect(selectJobs(JOBS, selection).map((job) => job.jobId)).toEqual(['c14'])
  })

  test('--all selects every clip', () => {
    const selection = parseFinalRenderArgs(['--all'])
    expect(selectJobs(JOBS, selection).map((job) => job.jobId)).toEqual(['c01', 'c05', 'c14'])
  })

  test('--proof and --force are independent boolean flags', () => {
    expect(parseFinalRenderArgs(['--all', '--proof'])).toMatchObject({ proof: true, force: false })
    expect(parseFinalRenderArgs(['--all', '--force'])).toMatchObject({ proof: false, force: true })
    expect(parseFinalRenderArgs(['--all', '--proof', '--force'])).toMatchObject({ proof: true, force: true })
  })

  test('requires exactly one of --clip/--act/--profile/--all', () => {
    expect(() => parseFinalRenderArgs([])).toThrow(/Specify exactly one of/)
    expect(() => parseFinalRenderArgs(['--clip=c01', '--act=ARRIVAL'])).toThrow(/only one of/)
  })

  test('rejects an unknown flag rather than silently ignoring it', () => {
    expect(() => parseFinalRenderArgs(['--bogus'])).toThrow(/Unknown final-render argument/)
  })

  test('a selection matching no clip returns an empty list, not an error', () => {
    const selection = parseFinalRenderArgs(['--clip=does-not-exist'])
    expect(selectJobs(JOBS, selection)).toEqual([])
  })
})
