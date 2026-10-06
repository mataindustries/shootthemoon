/** Local source recovery only: reuse the approved reel assembler and all of
 * its input/fidelity checks. No browser, new footage, or alternate renderer.
 * Bound decoder concurrency to avoid opening 29 parallel decoder pools.
 * Six x264 threads reproduce the existing release's recorded encoder setting.
 */
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('capture-final/youtube/sources')
const bin = path.join(root, 'bounded-tools')
mkdirSync(bin, { recursive: true })
const approved = JSON.parse(readFileSync('capture-final/approved-deliverables/manifest.json', 'utf8'))
writeFileSync(path.join(root, 'run-6-source.json'), JSON.stringify(approved.source, null, 2) + '\n')
const executable = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()
const wrapper = path.join(bin, 'ffmpeg')
writeFileSync(wrapper, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const input = process.argv.slice(2);
const args = ['-filter_threads', '2', '-filter_complex_threads', '2'];
for (const arg of input.slice(0, -1)) {
  if (arg === '-i') args.push('-threads', '1');
  args.push(arg);
}
if (input.at(-1)?.endsWith('.mp4')) args.push('-threads', '6');
args.push(input.at(-1));
const result = spawnSync(${JSON.stringify(executable)}, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`)
chmodSync(wrapper, 0o755)
const command = [
  '--experimental-strip-types', '--experimental-transform-types', 'capture/ci/assembleFinalReel.mjs',
  '--dir=capture-final/run-6', '--source=capture-final/youtube/sources/run-6-source.json',
  '--end-card=capture/ci/end-card-1920x1080.png',
  '--out=capture-final/youtube/sources/reel-recovered', '--work=capture-final/youtube/sources/reel-recovered-work',
]
const child = spawn(process.execPath, command, { stdio: 'inherit', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
const progress = setInterval(() => {
  const file = path.join(root, 'reel-recovered/reel-57s-1080.mp4')
  let bytes = 0
  try { bytes = statSync(file).size } catch { /* input verification has not reached encoding */ }
  console.log(`source recovery running: ${bytes} encoded bytes; original assembler QA still required`)
}, 30_000)
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code) => resolve(code ?? 1)) })
clearInterval(progress)
process.exit(code)
