#!/usr/bin/env node --experimental-strip-types --experimental-transform-types
/**
 * CLI entry point for the final-render pipeline. Parses
 * --clip=/--act=/--profile=/--all (+ --proof, --force) via the typed,
 * unit-tested parser in capture/finalRender/cliArgs.ts, then spawns the real
 * Playwright runner with matching env vars — execution itself always stays
 * inside Playwright's own test runner (single worker, SwiftShader,
 * reporting), exactly like every other entry point in this directory.
 *
 * Usage:
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --proof --all                # proof-frame gate, every selected clip
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --proof --clip=c07            # proof-frame gate, one clip
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --act=FIRST_STRIKE            # full render, one act
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --profile=PLATE               # full render, one profile
 *   node --experimental-strip-types --experimental-transform-types \
 *     capture/finalRender.mjs --all                         # full render, every selected clip (the ~6h run)
 *   ... --force                                              # re-render even already-complete clips
 *
 * The full (non --proof) render additionally requires passing the storage
 * preflight; it is skipped instantly if that check fails or if invoked any
 * other way than through this script (see CAPTURE_FINAL_CONFIRM in
 * capture/finalRender.spec.ts).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFinalRenderArgs } from './finalRender/cliArgs.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')

function main() {
  const selection = parseFinalRenderArgs(process.argv.slice(2))
  const specFile = selection.proof ? 'finalRenderProof.spec.ts' : 'finalRender.spec.ts'

  const env = { ...process.env }
  if (selection.clip !== null) env.CAPTURE_FINAL_CLIP = selection.clip
  if (selection.act !== null) env.CAPTURE_FINAL_ACT = selection.act
  if (selection.profile !== null) env.CAPTURE_FINAL_PROFILE = selection.profile
  if (selection.force) env.CAPTURE_FINAL_FORCE = '1'
  if (!selection.proof) env.CAPTURE_FINAL_CONFIRM = 'RUN_FULL_RENDER'

  const args = ['playwright', 'test', '--config=capture/playwright.capture.config.ts', `capture/${specFile}`]
  console.log(`[finalRender] npx ${args.join(' ')}  (${selection.proof ? 'proof' : 'full'} mode)`)

  const child = spawn('npx', args, { cwd: REPO_ROOT, stdio: 'inherit', env })
  child.on('exit', (code) => process.exitCode = code ?? 1)
  child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
}

main()
