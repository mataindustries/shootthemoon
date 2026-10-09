/**
 * React wiring for the adaptive soundtrack. App builds a memoized
 * MusicSnapshot from its real state; this hook feeds every change to the
 * director and exposes the lifecycle calls App makes from BEGIN / CONTINUE,
 * the visibility handler, the SOUND toggle and NEW GAME.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { audioContextConstructor, createEngineMusicHost, onAudioAlert } from './audioEngine.ts'
import { createMusicDirector, type MusicDebug, type MusicDirector, type MusicMode } from './music/musicDirector.ts'
import { createMusicLoader } from './music/musicLoader.ts'
import { parseMusicManifest } from './music/musicManifest.ts'
import type { MusicSnapshot } from './music/musicState.ts'
import { createNullMusicHost } from './music/nullAudioContext.ts'

/**
 * `?music=0` turns music off (capture). The e2e harness runs `dry` unless
 * `?music=full` asks for the real package. Otherwise music plays in full.
 */
export function resolveMusicMode(search: string, harnessActive: boolean, audioAvailable: boolean): MusicMode {
  const music = new URLSearchParams(search).get('music')
  if (music === '0' || music === 'off') return 'off'
  if (harnessActive && music !== 'full') return 'dry'
  return audioAvailable ? 'full' : 'off'
}

function createAppMusicDirector(mode: MusicMode): MusicDirector {
  return createMusicDirector({
    mode,
    openHost: mode === 'dry' ? () => createNullMusicHost() : createEngineMusicHost,
    openAssets: (host) =>
      createMusicLoader({
        context: host.context,
        // A separate chunk: no music byte, not even the manifest, loads before BEGIN.
        loadManifest: () => import('./music/musicManifest.json').then((module) => parseMusicManifest(module.default)),
        fetch: (url) => fetch(url),
        baseUrl: import.meta.env.BASE_URL,
        onError: (id, reason) => console.warn(`Adaptive music: ${id} unavailable (${reason}).`),
      }),
  })
}

export interface AdaptiveMusicController {
  readonly debug: MusicDebug
  /** Synchronously inside the BEGIN / CONTINUE gesture. */
  readonly unlockAndStart: () => void
  readonly suspend: () => void
  /** Resumes at the next commit, once the game's shifted presentation clocks have rendered. */
  readonly resume: () => void
  /** Synchronously inside the SOUND toggle gesture. */
  readonly setEnabled: (enabled: boolean) => void
  readonly reset: () => void
}

export function useAdaptiveMusic(snapshot: MusicSnapshot, options: { readonly harnessActive: boolean }): AdaptiveMusicController {
  const [director] = useState(() =>
    createAppMusicDirector(resolveMusicMode(window.location.search, options.harnessActive, audioContextConstructor() !== null)),
  )
  const snapshotRef = useRef(snapshot)
  const resumeRequestedRef = useRef(false)
  const [, requestCommit] = useState(0)

  // Every commit: keep the latest snapshot for gesture handlers, and perform a
  // requested resume against it (a hidden tab shifts presentation clocks).
  useLayoutEffect(() => {
    snapshotRef.current = snapshot
    if (resumeRequestedRef.current) {
      resumeRequestedRef.current = false
      director.resume(snapshot)
    }
  })

  useEffect(() => {
    director.update(snapshot)
  }, [director, snapshot])

  useEffect(() => onAudioAlert((cue) => director.notifyAlert(cue)), [director])

  const debug = useSyncExternalStore(
    (listener) => director.subscribe(listener),
    () => director.debug,
  )

  const actions = useMemo(
    () => ({
      // The gate is opening: start from the state BEGIN reveals, not the gate itself.
      unlockAndStart: () => director.unlockAndStart({ ...snapshotRef.current, entryOpen: false }),
      suspend: () => {
        resumeRequestedRef.current = false
        director.suspend()
      },
      resume: () => {
        resumeRequestedRef.current = true
        requestCommit((count) => count + 1)
      },
      setEnabled: (enabled: boolean) => director.setEnabled(enabled, snapshotRef.current),
      reset: () => director.reset(),
    }),
    [director],
  )

  return useMemo(() => ({ debug, ...actions }), [actions, debug])
}
