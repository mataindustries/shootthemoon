/** Verify the single-session, exact-clock fourth capture and every source PNG. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('capture-final/youtube/captures/helios-mass-driver')
const manifestFile = path.join(root, 'capture.json')
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const film = JSON.parse(readFileSync('capture/youtube/youtube-film.json', 'utf8'))
const captureIndex = JSON.parse(readFileSync('capture/youtube/captures/captures.json', 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fileHash = (file) => hash(readFileSync(file))
const report = { schema: 'shootthemoon.youtube-mass-driver-qa/1', checks: {}, failures: [] }
function check(name, ok, detail = {}) {
  report.checks[name] = { ok, ...detail }
  if (!ok) report.failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}
const frames = manifest.frames
const source = manifest.source
const segment = film.timeline.find((s) => s.kind === 'video' && s.shot === 'helios-mechanical-peak')
const asset = film.assets[segment?.source?.asset]
const indexed = captureIndex.captures.find((c) => c.id === 'helios-mechanical-peak')
check('fourth capture is the existing Helios shot, with hidden HUD and no errors',
  captureIndex.captures.length === 4 && manifest.shotId === 'helios-mechanical-peak' &&
  manifest.fixture === 'MON_HELIOS_SPIRE' && manifest.hud.mode === 'hidden' &&
  manifest.pageErrors.length === 0 && manifest.consoleErrors.length === 0,
  { shot: manifest.shotId, fixture: manifest.fixture, pageErrors: manifest.pageErrors, consoleErrors: manifest.consoleErrors })
const badInputs = Object.entries(manifest.inputs).filter(([file, sha]) => fileHash(file) !== sha)
check('capture infrastructure and gameplay inputs match their provenance hashes', badInputs.length === 0, { changed: badInputs })
const badBuild = Object.entries(manifest.harnessBuild).filter(([file, sha]) => fileHash(file) !== sha)
check('captured game build matches its recorded hashes', badBuild.length === 0, { changed: badBuild, browser: manifest.browser })
const badHashes = frames.filter((f) => fileHash(path.join(root, 'frames', f.filename)) !== f.sha256)
const actualNames = readdirSync(path.join(root, 'frames')).filter((n) => n.endsWith('.png')).sort()
check('all 792 source frames exist exactly once and retain their hashes',
  frames.length === 792 && actualNames.length === 792 && frames.every((f, i) => f.index === i && f.filename === `${String(i).padStart(6, '0')}.png` && actualNames[i] === f.filename) && badHashes.length === 0 &&
  readFileSync(path.join(root, 'frames.sha256'), 'utf8') === frames.map((f) => `${f.sha256}  frames/${f.filename}`).join('\n') + '\n',
  { frames: frames.length, files: actualNames.length, hashMismatches: badHashes.map((f) => f.index) })
check('one uninterrupted exact-clock sequence, without accidental duplicate PNGs',
  frames.every((f, i) => Math.abs(f.requestedSource - (300 + i * 1000 / 60)) < 1e-7 && Math.abs(f.renderedSourceMs - f.requestedSource) < 1) &&
  new Set(frames.map((f) => f.sha256)).size === frames.length &&
  hash(frames.map((f) => f.sha256).join('\n')) === manifest.sequenceSha256,
  { sourceInMs: frames[0].requestedSource, sourceLastMs: frames.at(-1).requestedSource, worstClockErrorMs: Math.max(...frames.map((f) => Math.abs(f.renderedSourceMs - f.requestedSource))), uniqueFrames: new Set(frames.map((f) => f.sha256)).size, sequenceSha256: manifest.sequenceSha256 })
check('source window includes the first fire and ends before the next',
  frames[0].requestedSource < 4200 && frames.at(-1).requestedSource > 4200 && frames.at(-1).requestedSource < 16200,
  { firstFireMs: 4200, nextFireMs: 16200, note: 'Existing src/scene/heliosReactorModel.ts timing; no artificial replay.' })
const sourceFile = path.resolve(source.file)
const encodedHash = fileHash(sourceFile)
check('source, film asset and capture index pin the same clean footage',
  encodedHash === source.sha256 && asset?.sha256 === encodedHash &&
  indexed?.sha256 === encodedHash && indexed?.provenance?.sha256 === fileHash(manifestFile) &&
  indexed?.provenance?.frameHashesSha256 === fileHash(path.join(root, 'frames.sha256')) &&
  segment?.frames === 792 && segment?.kind === 'video',
  { source: source.file, sha256: encodedHash, provenanceSha256: fileHash(manifestFile) })
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', sourceFile], { encoding: 'utf8' }))
const video = probe.streams.find((s) => s.codec_type === 'video')
check('clean source is 1080p60, 792 frames, BT.709 yuv420p, with no audio',
  probe.streams.length === 1 && video.codec_name === 'h264' && video.width === 1920 && video.height === 1080 &&
  video.r_frame_rate === '60/1' && video.avg_frame_rate === '60/1' && Number(video.nb_read_frames) === 792 &&
  video.pix_fmt === 'yuv420p' && video.color_space === 'bt709' && video.color_primaries === 'bt709' && video.color_transfer === 'bt709' && video.color_range === 'tv' &&
  Math.abs(Number(probe.format.duration) - 13.2) < .002 && source.bakedTitles === false && source.audio === false,
  { stream: video, durationS: Number(probe.format.duration) })
report.ok = report.failures.length === 0
writeFileSync('capture-final/youtube/qa/mass-driver-qa-report.json', JSON.stringify(report, null, 2) + '\n')
process.exit(report.ok ? 0 : 1)
