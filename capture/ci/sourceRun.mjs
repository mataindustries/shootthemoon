#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * Locates the pinned "Final reel render" run (capture/ci/reelRelease.json)
 * through the GitHub REST API, validates it against the pin (assembly.ts
 * validateSourceRun: run number, id, workflow, success, branch, SHA, the
 * exact artifact set with ids and digests, none expired), then downloads
 * its existing artifacts — each zip checked against its pinned sha256
 * digest — into --out, one directory per artifact (the same layout the
 * render workflow's verify job saw). Read-only against GitHub; never
 * renders, never picks "the latest" run, never falls back to another run.
 *
 *   GITHUB_TOKEN=<token with actions:read> \
 *   node --experimental-strip-types --experimental-transform-types capture/ci/sourceRun.mjs \
 *     --run-number=6 --out=capture-final/run-6
 *
 * Writes <out>/source-run.json (the validated run + artifact provenance)
 * for assembleFinalReel.mjs --source.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { selectSourceRun, validateSourceRun } from './assembly.ts'
import { runOrThrow } from './io.ts'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pin = JSON.parse(readFileSync(path.join(REPO_ROOT, 'capture/ci/reelRelease.json'), 'utf8'))

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1], match[2]]
  }),
)
const runNumber = Number(args['run-number'] ?? pin.runNumber)
const out = args.out ?? `capture-final/run-${runNumber}`
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const repository = process.env.GITHUB_REPOSITORY ?? pin.repository
const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com'

function stop(title, problems) {
  console.error(`STOP — ${title} (${problems.length}):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

if (!Number.isInteger(runNumber) || runNumber <= 0) stop('arguments', [`--run-number must be a positive integer, got ${args['run-number']}`])
if (!token) stop('credentials', ['GITHUB_TOKEN (or GH_TOKEN) with actions:read is required'])
if (repository !== pin.repository) stop('repository', [`running in ${repository}, the release pin is for ${pin.repository}`])

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'user-agent': 'shootthemoon-reel-assembly',
  'x-github-api-version': '2022-11-28',
}

async function api(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, { headers })
  if (!response.ok) throw new Error(`GET ${pathname}: ${response.status} ${(await response.text()).slice(0, 300)}`)
  return response.json()
}

/** Streams one artifact zip to disk and returns its "sha256:<hex>" digest.
 * The API answers with a redirect to short-lived blob storage; that URL is
 * already signed, so the GitHub token is never sent to it. */
async function downloadZip(artifact, target) {
  const response = await fetch(`${apiBase}/repos/${repository}/actions/artifacts/${artifact.id}/zip`, { headers, redirect: 'manual' })
  let body = response.body
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) throw new Error(`${artifact.name}: redirect without a location`)
    const blob = await fetch(location)
    if (!blob.ok) throw new Error(`${artifact.name}: blob download ${blob.status}`)
    body = blob.body
  } else if (!response.ok) {
    throw new Error(`${artifact.name}: download ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(body), tap, createWriteStream(target))
  return `sha256:${hash.digest('hex')}`
}

async function main() {
  // Every run of the render workflow, then exactly the requested number.
  const workflowFile = path.basename(pin.workflowPath)
  const runs = []
  for (let page = 1; ; page += 1) {
    const { workflow_runs: batch } = await api(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=100&page=${page}`)
    runs.push(...batch)
    if (batch.length < 100 || runs.some((candidate) => candidate.run_number === runNumber)) break
  }
  let run
  try {
    run = selectSourceRun(runs, runNumber)
  } catch (error) {
    stop('source run', [error.message])
  }
  const { artifacts } = await api(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`)

  console.log(`source run: ${run.name} #${run.run_number} — database id ${run.id}, ${run.event} on ${run.head_branch} @ ${run.head_sha}, ${run.status}/${run.conclusion}`)
  console.log(`${run.html_url ?? ''}`)
  for (const artifact of [...artifacts].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${artifact.name.padEnd(34)} id ${artifact.id}  ${String(artifact.size_in_bytes).padStart(9)} B  expires ${artifact.expires_at}${artifact.expired ? '  EXPIRED' : ''}`)
  }
  const problems = validateSourceRun(pin, runNumber, run, artifacts)
  if (problems.length > 0) stop('source run does not match the pinned release source', problems)
  console.log('source run matches capture/ci/reelRelease.json')

  if ((await readdir(out).catch(() => [])).length > 0) stop('output', [`${out} is not empty`])
  const zips = path.join(out, '.zips')
  await mkdir(zips, { recursive: true })
  const downloaded = []
  for (const pinned of pin.artifacts) {
    const artifact = artifacts.find((candidate) => candidate.name === pinned.name)
    const zip = path.join(zips, `${pinned.name}.zip`)
    const digest = await downloadZip(artifact, zip)
    if (digest !== pinned.digest) stop('artifact digest', [`${pinned.name}: downloaded ${digest}, pinned ${pinned.digest}`])
    // -n: never overwrite; unzip also refuses absolute and ../ member paths.
    await runOrThrow('unzip', ['-q', '-n', zip, '-d', path.join(out, pinned.name)])
    downloaded.push({ name: pinned.name, id: artifact.id, digest, sizeInBytes: artifact.size_in_bytes, expiresAt: artifact.expires_at })
    console.log(`  downloaded ${pinned.name} (${digest})`)
  }
  await rm(zips, { recursive: true, force: true })

  const record = {
    schema: 'shootthemoon.reel-source-run/1',
    repository,
    workflowName: run.name,
    workflowPath: run.path,
    runId: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
    artifacts: downloaded,
    downloadedAtIso: new Date().toISOString(),
  }
  await writeFile(path.join(out, 'source-run.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(`${downloaded.length} artifacts downloaded and digest-verified into ${out}`)
}

await main()
