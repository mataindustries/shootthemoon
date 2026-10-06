import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { FinalEdit } from '../finalEdit.ts'
import { validateCues } from '../titles/titles.ts'
import { drawnFilmFrames, filmSceneAt, resolveFilmCues, type FilmCues } from './filmScene.ts'
import type { MediaSources } from './mediaPriority.ts'
import { CANONICAL_FIXTURE_SITE, routeBoard } from './routeDiagram.ts'
import { countWords, sourceRequests, validateFilm, type Film, type Segment } from './youtubeFilm.ts'
import type { VoSelects } from './narration.ts'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const json = <T>(path: string) => JSON.parse(read(path)) as T
const film = json<Film>('capture/youtube/youtube-film.json')
const sources = json<MediaSources>('capture/youtube/media-sources.json')
const edit = json<FinalEdit>('capture/finalEdit.json')
const cues = json<FilmCues>('capture/youtube/youtubeTitles.cues.json')
const selects = json<VoSelects>('capture/youtube/vo-selects.json')
const validate = (value: Film, graphics = cues) => validateFilm(value, sources, edit, graphics, selects)
const mutable = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T
const withSegment = (id: string, patch: Partial<Segment>): Film => {
  const next = mutable<{ timeline: Segment[] }>(film)
  next.timeline = next.timeline.map((s) => (s.id === id ? { ...s, ...patch } : s))
  return next as unknown as Film
}

test('Option A is valid: 10,512 frames at 60 fps, 73 bars at 100 BPM', () => {
  assert.deepEqual(validate(film), [])
  assert.equal(film.output.frames, 10512)
  assert.equal(film.output.durationS, 175.2)
  assert.equal(film.output.frames % 144, 0)
  assert.deepEqual(film.acts.map((a) => [a.id, a.from, a.to]), [['WORLD', 0, 1115], ['ESCALATION', 1116, 2627], ['SYSTEMS', 2628, 7379], ['BUILD', 7380, 9323], ['PAYOFF', 9324, 10511]])
})

test('every reel frame is clean: titled media are rejected wherever they appear', () => {
  for (const request of sourceRequests(film)) assert.equal(request.media, 'reel-clean')
  const titled = withSegment('s07', { source: { media: 'reel-titled', from: 864, to: 1007 } })
  assert.ok(validate(titled).some((p) => p.includes('reel-titled is creative reference')))
  const loopHold = withSegment('s03', { source: { media: 'loop-titled', frame: 10 } })
  assert.ok(validate(loopHold).some((p) => p.includes('loop-titled is creative reference')))
})

test('a baked flash or dip is kept only with its reel neighbour', () => {
  // c09 ends in the white flash into c10; putting c11 after it would strand half a flash.
  const next = mutable<{ timeline: Segment[] }>(film)
  const c10 = next.timeline.find((s) => s.id === 's10')!
  next.timeline = next.timeline.map((s) => (s.id === 's10' ? { ...c10, source: { media: 'reel-clean', from: 1440, to: 1583 } } : s))
  assert.ok(validate(next as unknown as Film).some((p) => p.includes('s09: ends inside the baked white transition')))
})

test('no retiming: a reel segment plays exactly its source frames', () => {
  const slow = withSegment('s08', { source: { media: 'reel-clean', from: 1008, to: 1100 } })
  assert.ok(validate(slow).some((p) => p.includes('no retiming')))
})

test('continuous Helios footage stays at natural rate and its declared crop remains inside the source', () => {
  const wrongLength = withSegment('s25a', { frames: 793 })
  assert.ok(validate(wrongLength).some((p) => p.includes('full-rate asset')))
  for (const sourceCrop of [[240, 60, 1440, 812], [800, 60, 1440, 810], [241, 60, 1440, 810]] as const) {
    assert.ok(validate(withSegment('s25a', { sourceCrop })).some((p) => p.includes('video crop must be even')))
  }
})

test('graphics stay off every protected frame: impacts, flashes, dips, native UI', () => {
  const resolved = resolveFilmCues(cues)
  assert.deepEqual(validateCues(resolved), [])
  const drawn = new Set(drawnFilmFrames(resolved))
  for (const range of film.protected) for (let f = range.from; f <= range.to; f++) assert.ok(!drawn.has(f), `frame ${f} (${range.why})`)
  for (const id of ['s07', 's10', 's11', 's15', 's17', 's18']) {
    const seg = film.timeline.find((s) => s.id === id)!
    for (let f = seg.from; f <= seg.to; f++) assert.equal(filmSceneAt(resolved, f).length, 0, `${id} frame ${f}`)
  }
  const bad = mutable<{ events: Array<{ id: string; from: number; to: number; elements: unknown[] }> }>(cues)
  const e1 = bad.events.find((e) => e.id === 'E1')!
  e1.to = 1600
  ;(e1.elements as Array<{ out?: { f: number } }>).forEach((el) => { if (el.out) el.out = { f: 1593 } })
  assert.ok(validate(film, bad as unknown as FilmCues).some((p) => p.includes('forbidden')))
})

test('narration: 260-360 words, a natural pace, silent cold open, never over an impact', () => {
  const words = film.voiceover.reduce((n, l) => n + l.words, 0)
  assert.ok(words >= 260 && words <= 360, `${words} words`)
  for (const line of film.voiceover) assert.equal(line.words, countWords(line.text), line.id)
  assert.ok(film.voiceover[0]!.from >= 180)
  assert.ok(!film.voiceover[0]!.text.startsWith('I built'))
  for (const banned of [/leverag/i, /revolution/i, /game-chang/i]) assert.ok(!film.voiceover.some((l) => banned.test(l.text)), String(banned))
  const rushed = mutable<{ voiceover: Array<{ to: number; from: number }> }>(film)
  rushed.voiceover[2]!.to = rushed.voiceover[2]!.from + 30
  assert.ok(validate(rushed as unknown as Film).some((p) => p.includes('rushed')))
  const overImpact = mutable<{ voiceover: Array<{ id: string; from: number; to: number }> }>(film)
  overImpact.voiceover[2]!.to = 2200
  assert.ok(validate(overImpact as unknown as Film).some((p) => p.includes('narration over s15')))
})

test('the route board is the game\'s own route: fixture site, derived rival, tested clearance', () => {
  const fixture = read('e2e/firstStrikeFixtures.ts')
  assert.ok(fixture.includes(`createLunarLocation(${CANONICAL_FIXTURE_SITE.latitudeRad}, ${CANONICAL_FIXTURE_SITE.longitudeRad}, ${CANONICAL_FIXTURE_SITE.heightM})`))
  const route = routeBoard([700, 640], 300)
  assert.equal(route.tokens.playerCoords, '14.209° N  39.190° W')
  assert.equal(route.tokens.rivalCoords, '40.608° S  94.607° E')
  assert.deepEqual([route.tokens.separationDeg, route.tokens.peakKm, route.tokens.minKm, route.tokens.samples], ['132', '760', '24', '2,048'])
  assert.ok(Math.abs(route.sampledMinimumClearanceKm - route.minimumClearanceKm) < 1e-6)
  assert.equal(route.datumRadiusKm, 1737.4)
  // Rendered text carries the computed values, not typed ones.
  const resolved = resolveFilmCues(cues)
  const s23 = film.timeline.find((s) => s.id === 's23')!
  const texts = filmSceneAt(resolved, s23.to - 30).flatMap((op) => (op.op === 'text' ? [op.text] : []))
  for (const t of ['132°', '760 KM', '24 KM', '2,048', '14.209° N  39.190° W', '40.608° S  94.607° E']) assert.ok(texts.includes(t), t)
})

test('the code excerpt is verbatim from the source file', () => {
  const s5 = cues.events.find((e) => e.id === 'S5') as unknown as { excerpt: { file: string; firstLine: number; lines: string[] } }
  const source = read(s5.excerpt.file).split('\n')
  assert.deepEqual(s5.excerpt.lines, source.slice(s5.excerpt.firstLine - 1, s5.excerpt.firstLine - 1 + s5.excerpt.lines.length))
})

test('four new captures at most, with only the explicitly authorized Helios exception, each pinned by hash', () => {
  const captures = json<{ captures: Array<{ id: string; file: string; sha256: string; capture: { pageErrors: unknown[]; consoleErrors: unknown[] } }> }>('capture/youtube/captures/captures.json')
  assert.ok(captures.captures.length <= 4)
  assert.equal(captures.captures.length, film.newCaptures.used, 'every declared capture must have completed provenance')
  assert.deepEqual(captures.captures.map((c) => c.id), ['title-screen', 'landing-site-panel', 'mining-laser-closeup', 'helios-mechanical-peak'])
  for (const c of captures.captures) {
    const asset = Object.values(film.assets).find((a) => a.file === c.file)
    assert.equal(asset?.sha256, c.sha256)
    assert.match(c.sha256, /^[a-f0-9]{64}$/)
    assert.deepEqual([c.capture.pageErrors, c.capture.consoleErrors], [[], []])
  }
  const fifth = mutable<{ assets: Record<string, unknown>; newCaptures: { used: number; limit: number } }>(film)
  fifth.assets.extra = { kind: 'new-capture', manifestShot: 'extra-gameplay' }
  fifth.newCaptures.used = 5
  fifth.newCaptures.limit = 5
  assert.ok(validate(fifth as unknown as Film).some((p) => p.includes('new captures (limit 4)')))
})

test('recorded wording and duration are authoritative; missing selects and padded windows fail', () => {
  assert.ok(validateFilm(film, sources, edit, cues).some((p) => p.includes('requires the authoritative')))
  const changed = mutable<{ voiceover: Array<{ text: string; to: number }> }>(film)
  changed.voiceover[20]!.text = 'And now you can play it.'
  assert.ok(validate(changed as unknown as Film).some((p) => p.includes('recorded select/wording/timing differs')))
  changed.voiceover[20]!.text = film.voiceover[20]!.text
  changed.voiceover[0]!.to += 30
  assert.ok(validate(changed as unknown as Film).some((p) => p.includes('padded windows')))
})
