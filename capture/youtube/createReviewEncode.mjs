/** A size-bounded review derivative; the high-quality master is never replaced. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const out = path.resolve('capture-final/youtube')
const film = JSON.parse(readFileSync('capture/youtube/youtube-film.json', 'utf8'))
const master = path.join(out, 'shoot-the-moon-vo-picture-lock.mp4')
const maxBytes = 30 * 1024 * 1024
if (statSync(master).size <= maxBytes) { console.log('master fits 30MiB; no review derivative needed'); process.exit(0) }
const review = path.join(out, 'shoot-the-moon-vo-picture-lock-review.mp4')
const work = path.join(out, 'work/review')
const masterHash = createHash('sha256').update(readFileSync(master)).digest('hex')
// Reserve 512KiB for container overhead/bitrate tolerance. Budget the actual
// AAC payload rather than its nominal ceiling, spending the rest on picture.
const audioPackets = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=size,data_hash', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 3_000_000 })).packets
const masterAudio = audioPackets(master)
const audioBytes = masterAudio.reduce((n, p) => n + Number(p.size), 0)
let bitrate = Math.floor((maxBytes - 512 * 1024 - audioBytes) * 8 / film.output.durationS / 1000)
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-progress', 'pipe:1', '-stats_period', '30', ...args], { stdio: 'inherit' })
for (let attempt = 0; attempt < 3; attempt++) {
  const video = ['-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.2', '-b:v', `${bitrate}k`, '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-r', '60', '-fps_mode', 'cfr', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-flags', '+cgop',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-passlogfile', work]
  ffmpeg(['-i', master, '-map', '0:v:0', '-frames:v', String(film.output.frames), ...video, '-pass', '1', '-an', '-f', 'null', '/dev/null'])
  ffmpeg(['-i', master, '-map', '0:v:0', '-map', '0:a:0', '-frames:v', String(film.output.frames), ...video, '-pass', '2', '-c:a', 'copy', '-t', String(film.output.durationS), '-movflags', '+faststart', review])
  if (statSync(review).size < maxBytes) break
  bitrate = Math.floor(bitrate * 0.97)
}
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', review], { encoding: 'utf8' }))
const video = probe.streams.find((s) => s.codec_type === 'video'), audio = probe.streams.filter((s) => s.codec_type === 'audio')
const bytes = statSync(review).size
const problems = []
if (bytes >= maxBytes) problems.push('review exceeds 30MiB')
if (video.nb_read_packets !== String(film.output.frames) || video.width !== 1920 || video.height !== 1080 || video.r_frame_rate !== '60/1' || video.avg_frame_rate !== '60/1' || video.pix_fmt !== 'yuv420p' || video.codec_name !== 'h264' || video.profile !== 'High' || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709' || video.color_range !== 'tv') problems.push('review video format/frame count differs')
if (audio.length !== 1 || audio[0].codec_name !== 'aac' || audio[0].sample_rate !== '48000' || audio[0].channels !== 1 || Math.abs(Number(audio[0].duration) - film.output.durationS) > 0.002 || Math.abs(Number(probe.format.duration) - film.output.durationS) > 0.002) problems.push('review narration/runtime differs')
const b = readFileSync(review)
if (!(b.indexOf('moov') > 0 && b.indexOf('moov') < b.indexOf('mdat'))) problems.push('review missing faststart')
if (createHash('sha256').update(readFileSync(master)).digest('hex') !== masterHash) problems.push('master changed')
const reviewAudio = audioPackets(review)
if (reviewAudio.length !== masterAudio.length || reviewAudio.some((p, i) => p.data_hash !== masterAudio[i].data_hash)) problems.push('review narration packet payloads differ from master')
const pts = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', review], { encoding: 'utf8', maxBuffer: 8_000_000 }))
if (pts.frames.length !== film.output.frames || pts.frames.some((f, i) => Math.abs(Number(f.best_effort_timestamp_time) - i / 60) >= 0.000001)) problems.push('review frame timestamps differ')
const report = { schema: 'shootthemoon.youtube-review-encode/1', ok: problems.length === 0, problems, master: { file: master, sha256: masterHash, bytes: statSync(master).size }, audioPayloadBytes: audioBytes, identicalNarrationPackets: reviewAudio.length === masterAudio.length && reviewAudio.every((p, i) => p.data_hash === masterAudio[i].data_hash), review: { file: review, bytes, sha256: createHash('sha256').update(b).digest('hex'), bitrateKbps: bitrate, probe } }
writeFileSync(path.join(out, 'qa/review-encode-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`${report.ok ? 'PASS' : 'FAIL'} review encode: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(3)}MiB), ${film.output.frames} frames`)
process.exit(report.ok ? 0 : 1)
