/**
 * Argument parsing and path-safety rules for scripts/music/build-web-music.mjs.
 * Pure: argv and paths in, decisions out (no filesystem access).
 */
import path from 'node:path'

export type Command = 'validate' | 'build' | 'auditions' | 'fixtures'

export interface CliOptions {
  readonly command: Command
  readonly input: string | null
  readonly output: string | null
  readonly manifest: string | null
  readonly archive: string | null
  readonly report: string | null
  readonly urlBase: string
  readonly allowSynthetic: boolean
  readonly requireProvenance: boolean
  readonly concurrency: number | null
}

export const USAGE = `Usage: node --experimental-strip-types scripts/music/build-web-music.mjs <command> [options]

Commands:
  validate   --input <dir> [--report <file>]
             Verify the canonical DaemonV12 package: formats, exact frames,
             periodicity proof, levels, mono fold, stingers, provenance and the
             measured combination audit. Writes nothing but the report.
  build      --input <dir> --output <dir> [--manifest <file>] [--archive <dir>]
             [--report <file>] [--url-base /music/]
             validate, then build the guarded MP3 package and manifest. The
             output directory is only updated when every check passes.
  auditions  --input <dir> --output <dir>
             Local A–E review mixes of the five loops (never shipped).
  fixtures   --output <dir>
             Generate a synthetic canonical package of the exact contract
             lengths (placeholder tones and bar clicks, for tests and dry runs).

Options:
  --require-provenance   fail when a render manifest (<name>.render.json) is missing
  --allow-synthetic      accept a fixtures package (never into a public/ directory)
  --concurrency <n>      parallel FFmpeg measurements (default: CPU count, max 8)`

export class CliError extends Error {
  override readonly name = 'CliError'
}

const COMMANDS: readonly Command[] = ['validate', 'build', 'auditions', 'fixtures']
const VALUE_OPTIONS = ['input', 'output', 'manifest', 'archive', 'report', 'url-base', 'concurrency'] as const
const FLAG_OPTIONS = ['allow-synthetic', 'require-provenance'] as const

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h') throw new CliError(USAGE)
  if (!(COMMANDS as readonly string[]).includes(command)) throw new CliError(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`)

  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    if (!match) throw new CliError(`unexpected argument ${JSON.stringify(arg)}`)
    const name = match[1] as string
    if ((FLAG_OPTIONS as readonly string[]).includes(name)) {
      if (match[2] !== undefined) throw new CliError(`--${name} takes no value`)
      flags.add(name)
      continue
    }
    if (!(VALUE_OPTIONS as readonly string[]).includes(name)) throw new CliError(`unknown option --${name}`)
    if (values.has(name)) throw new CliError(`--${name} given more than once`)
    const value = match[2] ?? rest[++i]
    if (value === undefined || value === '' || value.startsWith('--')) throw new CliError(`--${name} needs a value`)
    values.set(name, value)
  }

  const allowed: Record<Command, readonly string[]> = {
    validate: ['input', 'report', 'concurrency', 'require-provenance', 'allow-synthetic'],
    build: ['input', 'output', 'manifest', 'archive', 'report', 'url-base', 'concurrency', 'require-provenance', 'allow-synthetic'],
    auditions: ['input', 'output', 'concurrency', 'allow-synthetic'],
    fixtures: ['output'],
  }
  for (const name of [...values.keys(), ...flags]) {
    if (!allowed[command as Command].includes(name)) throw new CliError(`--${name} is not valid for ${command}`)
  }
  const required: Record<Command, readonly string[]> = {
    validate: ['input'],
    build: ['input', 'output'],
    auditions: ['input', 'output'],
    fixtures: ['output'],
  }
  for (const name of required[command as Command]) {
    if (!values.has(name)) throw new CliError(`${command} needs --${name}\n\n${USAGE}`)
  }

  const urlBase = values.get('url-base') ?? '/music/'
  if (!/^\/([A-Za-z0-9._-]+\/)*$/.test(urlBase)) throw new CliError(`--url-base must be a root-relative directory URL such as /music/, got ${urlBase}`)
  const concurrencyText = values.get('concurrency')
  const concurrency = concurrencyText === undefined ? null : Number(concurrencyText)
  if (concurrency !== null && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)) throw new CliError('--concurrency must be an integer 1..64')
  const manifest = values.get('manifest') ?? null
  if (manifest !== null && !manifest.endsWith('.json')) throw new CliError('--manifest must name a .json file')

  return {
    command: command as Command,
    input: values.get('input') ?? null,
    output: values.get('output') ?? null,
    manifest,
    archive: values.get('archive') ?? null,
    report: values.get('report') ?? null,
    urlBase,
    allowSynthetic: flags.has('allow-synthetic'),
    requireProvenance: flags.has('require-provenance'),
    concurrency,
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export interface PathContext {
  readonly repoRoot: string
  readonly homeDir: string
}

/**
 * Where a command may write. All paths must already be absolute.
 * Rejects: the filesystem root, the home directory, the repository root
 * itself, anything inside the canonical input (or containing it), and, when
 * `synthetic` is set (fixture packages and every never-shipped artifact),
 * anything inside the repository's public/ tree.
 */
export function checkWriteTarget(
  target: string,
  role: string,
  options: PathContext & { readonly input: string | null; readonly synthetic: boolean },
): void {
  const resolved = path.resolve(target)
  if (resolved === path.parse(resolved).root) throw new CliError(`${role} cannot be the filesystem root`)
  if (resolved === path.resolve(options.homeDir)) throw new CliError(`${role} cannot be the home directory`)
  if (resolved === path.resolve(options.repoRoot)) throw new CliError(`${role} cannot be the repository root`)
  if (options.input !== null) {
    const input = path.resolve(options.input)
    if (isInside(resolved, input)) throw new CliError(`${role} ${target} is inside the canonical input ${options.input}`)
    if (isInside(input, resolved)) throw new CliError(`${role} ${target} contains the canonical input ${options.input}`)
  }
  if (options.synthetic && isInside(resolved, path.join(options.repoRoot, 'public'))) {
    throw new CliError(`refusing to write the ${role} ${target} into public/: only real, verified shipped music belongs there (synthetic fixtures, auditions, archives and reports never do)`)
  }
}
