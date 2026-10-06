import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { lockedShotClips, planLoop, planReel, RELEASE_INTERVAL_OVERRIDES, intervalKind } from '../ci/assembly.ts'
import type { FinalEdit } from '../finalEdit.ts'
import type { Cues } from '../titles/titles.ts'
import { bakedTransitions, checkTimelineSources, identifyMedia, loopToReelFrames, MEDIA_SOURCES_SCHEMA, mediaById, resolveCleanSource, titledAlterations, type FrameRange, type MediaSources } from './mediaPriority.ts'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const sources = JSON.parse(read('capture/youtube/media-sources.json')) as MediaSources
const edit = JSON.parse(read('capture/finalEdit.json')) as FinalEdit
const cuesFor = (path: string) => JSON.parse(read(path)) as Cues
const reelCues = cuesFor('capture/titles/reel-titles.cues.json')
const loopCues = cuesFor('capture/titles/loop-titles.cues.json')
const covered = (ranges: readonly FrameRange[], f: number) => ranges.some((r) => f >= r.from && f <= r.to)

// Where each titled deliverable differs from its clean counterpart, measured on the
// supplied files (decoded luma, |diff| > 24 levels; loop text inside the title envelope).
const MEASURED_REEL = [[36, 137], [432, 575], [579, 719], [731, 863], [1152, 1289], [1623, 1724], [1730, 1859], [2016, 2159], [2448, 2837], [2952, 3089], [3168, 3455]] as const
const MEASURED_LOOP = [[81, 123], [216, 239], [333, 377], [339, 413]] as const

test('original release pins retained; repository reference is separately identified and never footage', () => {
  assert.equal(sources.schema, MEDIA_SOURCES_SCHEMA)
  assert.deepEqual(sources.media.map((m) => [m.id, m.role]), [['reel-clean', 'primary-clean'], ['loop-clean', 'primary-clean'], ['reel-titled', 'creative-reference'], ['loop-titled', 'creative-reference'], ['reel-titled-repo', 'creative-reference']])
  assert.equal(new Set(sources.media.map((m) => m.sha256)).size, 5)
  assert.equal(mediaById(sources, 'reel-clean').sha256, 'f1150945eb5356f4260351622201edc14d982ac1baaab804091ab1d8c74680d0')
  assert.equal(mediaById(sources, 'reel-titled').sha256, 'a523e35c53b76043bbad9bfd277f666a99c0ecbab4c79c4acdbe98500ee7b188')
  const alternate = mediaById(sources, 'reel-titled-repo')
  assert.equal(alternate.sha256, '7be8b4f8e896a0c639b3aad3be3a71e6c0be2a6fd09b6c9e9a0e408f9083c5fb')
  assert.equal(checkTimelineSources(sources, [{ media: alternate.id, from: 0, to: 59 }]).length, 1)
  for (const m of sources.media) assert.match(m.sha256, /^[0-9a-f]{64}$/)
  // Both loops were supplied under the same name; only the hash tells them apart.
  assert.equal(identifyMedia(sources, '9ad3f69823d74d1826d624cef0555a46fcac9becbf7a5fe914e3e61f9e134864')?.id, 'loop-clean')
  assert.equal(identifyMedia(sources, 'F83D2B82C5EF3F41DE226DA0F30F1588B46A439443C073D8410FF73E01C3A1A4')?.id, 'loop-titled')
  assert.equal(identifyMedia(sources, '0'.repeat(64)), null)
  // loop-clean is the file the loop treatment audited and the titled-loop assembly pins.
  assert.ok(read('capture/titles/assembleTitledLoop.mjs').includes(mediaById(sources, 'loop-clean').sha256))
})

test('each titled reference matches its clean counterpart and the cue sheet that built it', () => {
  const reel = mediaById(sources, 'reel-clean')
  const loop = mediaById(sources, 'loop-clean')
  assert.deepEqual([reel.width, reel.height, reel.fps, reel.frames], [edit.output.width, edit.output.height, edit.output.fps, planReel(edit).frames])
  assert.deepEqual([loop.fps, loop.frames, loop.derivedFrom], [edit.derivatives.loop.fps, planLoop(edit).frames, 'reel-clean'])
  for (const m of sources.media.filter((entry) => entry.role === 'creative-reference')) {
    const clean = mediaById(sources, m.cleanCounterpart!)
    assert.equal(clean.role, 'primary-clean')
    assert.deepEqual([m.width, m.height, m.fps, m.frames], [clean.width, clean.height, clean.fps, clean.frames])
    const { source } = cuesFor(m.cues!)
    assert.deepEqual([source.width, source.height, source.fps, source.frames], [m.width, m.height, m.fps, m.frames])
  }
})

test('the footage pool covers every reel slot once and describes what it shows', () => {
  const segments = planReel(edit).segments
  let start = 0
  const slots = segments.map((s) => {
    const range = [start, start + s.frames - 1]
    start += s.frames
    return [s.id, range]
  })
  assert.deepEqual(sources.footage.map((f) => [f.clip, [...f.reelFrames]]), slots)
  const intervals = new Map(RELEASE_INTERVAL_OVERRIDES.map((i) => [i.original.clipId, i]))
  const clips = new Map(lockedShotClips(edit).map((c) => [c.id, c]))
  for (const entry of sources.footage) {
    const interval = intervals.get(entry.clip)
    const clip = clips.get(entry.clip)
    const expected = entry.clip === 'end' ? 'card' : interval !== undefined ? (intervalKind(interval) === 'hold' ? 'held' : 'duplicate') : clip!.source.clock === 'still' ? 'still' : 'live'
    assert.equal(entry.picture, expected, entry.clip)
    assert.equal(entry.grade === 'none', entry.picture === 'duplicate' || entry.picture === 'card', entry.clip)
    // Native UI follows the clip whose frames are shown: c14 shows c13 (HUD), c18 shows c17 (none).
    const shown = interval === undefined ? clip : clips.get(interval.hold.clipId)
    assert.equal(entry.nativeUi, shown?.hud ?? false, entry.clip)
  }
  assert.deepEqual(sources.footage.filter((f) => f.grade === 'hero').map((f) => f.clip), ['c07', 'c10', 'c16', 'c25'])
})

test('every clean-loop frame is a clean-reel frame, two reel frames apart within a shot', () => {
  const toReel = loopToReelFrames(edit)
  assert.equal(toReel.length, 414)
  const shots = [[0, 864], [72, 1152], [144, 1296], [216, 1800], [252, 1872], [324, 2160], [378, 2268]] as const
  shots.forEach(([loopStart, reelStart], i) => {
    const loopEnd = i + 1 < shots.length ? shots[i + 1]![0] - 1 : 413
    for (let f = loopStart; f <= loopEnd; f++) assert.equal(toReel[f], reelStart + 2 * (f - loopStart), `loop frame ${f}`)
  })
})

// A tail fade's first frame is untouched (amount 0), as in ffmpeg's fade: 414, 1290, 1692, 1866 and 3132 are clean.
test('baked transitions in the clean reel', () => {
  assert.deepEqual(bakedTransitions(edit), [
    { from: 0, to: 71, color: 'black' },
    { from: 415, to: 431, color: 'black' },
    { from: 1291, to: 1301, color: 'white' },
    { from: 1693, to: 1727, color: 'black' },
    { from: 1867, to: 1877, color: 'white' },
    { from: 3133, to: 3203, color: 'black' },
  ])
})

test('titled alterations come from the cue sheets and account for every measured difference', () => {
  const reel = titledAlterations(reelCues)
  assert.deepEqual(reel.map((a) => [a.id, a.kind, a.from, a.to]), [
    ['E1', 'graphics', 36, 142],
    ['E2', 'graphics', 432, 574],
    ['P1', 'plate-push', 432, 575],
    ['P2', 'plate-push', 576, 719],
    ['P3', 'plate-push', 720, 791],
    ['E3', 'graphics', 792, 863],
    ['E4', 'graphics', 1152, 1289],
    ['P4', 'plate-push', 1620, 1727],
    ['P5', 'plate-push', 1728, 1799],
    ['E5', 'graphics', 1800, 1864],
    ['E6', 'graphics', 2016, 2159],
    ['P6', 'plate-push', 2088, 2159],
    ['E7', 'graphics', 2448, 2842],
    ['E9', 'graphics', 2952, 3094],
    ['E8', 'graphics', 3168, 3455],
    ['E8', 'plate-replaced', 3168, 3455],
  ])
  const loop = titledAlterations(loopCues)
  assert.deepEqual(loop.map((a) => [a.id, a.kind, a.from, a.to]), [['L1', 'graphics', 81, 125], ['L2', 'graphics', 216, 242], ['LP1', 'plate-push', 324, 413], ['L3', 'graphics', 333, 377]])
  for (const [measured, alterations] of [[MEASURED_REEL, reel], [MEASURED_LOOP, loop]] as const) {
    for (const [from, to] of measured) for (let f = from; f <= to; f++) assert.ok(covered(alterations, f), `measured difference at frame ${f} has no cue`)
  }
})

test('a titled span resolves to the same clean frames and names what it leaves behind', () => {
  const countdown = resolveCleanSource(sources, edit, cuesFor, { media: 'reel-titled', from: 1152, to: 1289 })
  assert.deepEqual(countdown, { media: 'reel-clean', ranges: [{ from: 1152, to: 1289, clip: 'c09' }], replaces: [{ id: 'E4', kind: 'graphics', from: 1152, to: 1289 }] })

  const reversal = resolveCleanSource(sources, edit, cuesFor, { media: 'reel-titled', from: 1790, to: 1880 })
  assert.deepEqual(reversal.ranges, [{ from: 1790, to: 1799, clip: 'c14' }, { from: 1800, to: 1871, clip: 'c15' }, { from: 1872, to: 1880, clip: 'c16' }])
  assert.deepEqual(reversal.replaces.map((a) => a.id), ['P5', 'E5'])

  const endCard = resolveCleanSource(sources, edit, cuesFor, { media: 'reel-titled', from: 3168, to: 3455 })
  assert.deepEqual(endCard.replaces.map((a) => a.kind), ['graphics', 'plate-replaced'])
})

test('loop spans resolve to the full-rate clean reel, split at every cut', () => {
  const octogonals = resolveCleanSource(sources, edit, cuesFor, { media: 'loop-titled', from: 333, to: 377 })
  assert.deepEqual(octogonals, {
    media: 'reel-clean',
    ranges: [{ from: 2178, to: 2267, clip: 'c19' }],
    replaces: [{ id: 'LP1', kind: 'plate-push', from: 324, to: 413 }, { id: 'L3', kind: 'graphics', from: 333, to: 377 }],
  })
  const whole = resolveCleanSource(sources, edit, cuesFor, { media: 'loop-clean', from: 0, to: 413 })
  assert.equal(whole.media, 'reel-clean')
  assert.deepEqual(whole.replaces, [])
  assert.deepEqual(whole.ranges, [
    { from: 864, to: 1007, clip: 'c07' },
    { from: 1152, to: 1295, clip: 'c09' },
    { from: 1296, to: 1439, clip: 'c10' },
    { from: 1800, to: 1871, clip: 'c15' },
    { from: 1872, to: 2015, clip: 'c16' },
    { from: 2160, to: 2267, clip: 'c19' },
    { from: 2268, to: 2339, clip: 'c20' },
  ])
  assert.deepEqual(resolveCleanSource(sources, edit, cuesFor, { media: 'reel-clean', from: 864, to: 1007 }).ranges, [{ from: 864, to: 1007, clip: 'c07' }])
  assert.throws(() => resolveCleanSource(sources, edit, cuesFor, { media: 'loop-clean', from: 400, to: 414 }), /outside its 414 frames/)
})

test('a YouTube timeline may cut clean footage only', () => {
  assert.deepEqual(checkTimelineSources(sources, [{ media: 'reel-clean', from: 864, to: 1007 }, { media: 'loop-clean', from: 0, to: 71 }]), [])
  assert.deepEqual(checkTimelineSources(sources, [
    { media: 'reel-titled', from: 1800, to: 1871 },
    { media: 'loop-titled', from: 0, to: 10 },
    { media: 'reel-clean', from: 3400, to: 3456 },
    { media: 'reel-57s-1080.mp4', from: 0, to: 1 },
  ]), [
    'entry 0: reel-titled is creative reference (titled ORBITAL RECORD). Source reel-clean frames instead (resolveCleanSource)',
    'entry 1: loop-titled is creative reference (titled ORBITAL RECORD). Source loop-clean frames instead (resolveCleanSource)',
    'entry 2: reel-clean: [3400, 3456] is outside its 3456 frames',
    'entry 3: unknown media reel-57s-1080.mp4',
  ])
})
