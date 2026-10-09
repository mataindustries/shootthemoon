#!/usr/bin/env node
/**
 * Shoot the Moon adaptive soundtrack asset pipeline (handoff section 9).
 * Turns canonical DaemonV12 V0.5 renders into the guarded, browser-ready MP3
 * package plus manifest, after proving every hard asset requirement. All
 * decision logic lives in the typed modules beside this file; this entry
 * point only parses arguments, resolves paths and sets the exit code.
 *
 *   node --experimental-strip-types scripts/music/build-web-music.mjs validate  --input <canonical dir>
 *   node --experimental-strip-types scripts/music/build-web-music.mjs build     --input <canonical dir> --output public/music
 *   node --experimental-strip-types scripts/music/build-web-music.mjs auditions --input <canonical dir> --output <review dir>
 *   node --experimental-strip-types scripts/music/build-web-music.mjs fixtures  --output <empty dir>
 *
 * See docs/ADAPTIVE_MUSIC_ASSET_PIPELINE.md. Needs Node and FFmpeg (libmp3lame).
 */
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkWriteTarget, CliError, parseCliArgs } from './cliArgs.ts'
import { SYNTHETIC_MARKER, writeSyntheticPackage } from './fixtures.ts'
import { PipelineError, runPipeline } from './pipeline.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const resolve = (value) => (value === null ? null : path.resolve(process.cwd(), value))

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.command === 'fixtures') {
    const output = resolve(options.output)
    checkWriteTarget(output, 'output', { repoRoot: REPO_ROOT, homeDir: process.env.HOME ?? '/', input: null, synthetic: true })
    const written = await writeSyntheticPackage(output)
    console.log(`wrote ${written.length} synthetic canonical renders + ${SYNTHETIC_MARKER} to ${path.relative(process.cwd(), output) || '.'}`)
    return 0
  }
  const result = await runPipeline({
    mode: options.command,
    input: resolve(options.input),
    output: resolve(options.output),
    manifest: resolve(options.manifest),
    archive: resolve(options.archive),
    report: resolve(options.report),
    urlBase: options.urlBase,
    allowSynthetic: options.allowSynthetic,
    requireProvenance: options.requireProvenance,
    concurrency: options.concurrency ?? Math.min(8, availableParallelism()),
    combinationAudit: true,
    repoRoot: REPO_ROOT,
    log: (line) => console.log(line),
  })
  for (const warning of result.warnings) console.warn(`warning: ${warning}`)
  for (const failure of result.failures) console.error(`FAIL: ${failure}`)
  console.log(result.ok ? `music ${options.command}: PASS` : `music ${options.command}: FAILED (${result.failures.length} problem(s))`)
  return result.ok ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof CliError || error instanceof PipelineError ? error.message : error)
    process.exitCode = 2
  },
)
