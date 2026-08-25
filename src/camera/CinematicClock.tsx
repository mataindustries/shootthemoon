import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils } from 'three'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'

const APPROACH_DURATION_SECONDS = 6.2
const RETURN_DURATION_SECONDS = 2.4

interface CinematicClockValue {
  readonly progressRef: MutableRefObject<number>
}

const CinematicClockContext = createContext<CinematicClockValue | null>(null)

interface CinematicProgressEventDetail {
  readonly progress: number | null
}

interface CinematicClockProviderProps {
  readonly phase: ExperiencePhase
  readonly onLandingComplete: () => void
  readonly onReturnComplete: () => void
  readonly children: ReactNode
}

export function CinematicClockProvider({
  phase,
  onLandingComplete,
  onReturnComplete,
  children,
}: CinematicClockProviderProps) {
  const invalidate = useThree((state) => state.invalidate)
  const startedAtRef = useRef(performance.now())
  const pausedAtRef = useRef<number | null>(null)
  const progressRef = useRef(phase === 'landed' ? 1 : 0)
  const fixedProgressRef = useRef<number | null>(null)
  const completionSentRef = useRef(false)
  const prefersReducedMotionRef = useRef(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    startedAtRef.current = performance.now()
    progressRef.current = phase === 'landed' ? 1 : 0
    fixedProgressRef.current = null
    completionSentRef.current = false
    invalidate()
  }, [invalidate, phase])

  useEffect(() => {
    const handleVisibilityChange = () => {
      const now = performance.now()

      if (document.visibilityState === 'hidden') {
        pausedAtRef.current = now
        return
      }

      if (pausedAtRef.current !== null) {
        startedAtRef.current += now - pausedAtRef.current
        pausedAtRef.current = null
        invalidate()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [invalidate])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('e2e')) {
      return
    }

    const setProgress = (event: Event) => {
      const detail = (event as CustomEvent<CinematicProgressEventDetail>).detail
      fixedProgressRef.current =
        detail.progress === null
          ? null
          : MathUtils.clamp(detail.progress, 0, 1)
      invalidate()
    }

    window.addEventListener('moon-core:set-cinematic-progress', setProgress)
    return () =>
      window.removeEventListener(
        'moon-core:set-cinematic-progress',
        setProgress,
      )
  }, [invalidate])

  useFrame((state) => {
    if (phase !== 'approach' && phase !== 'returning') {
      return
    }

    const duration = prefersReducedMotionRef.current
      ? phase === 'approach'
        ? 1.25
        : 0.8
      : phase === 'approach'
        ? APPROACH_DURATION_SECONDS
        : RETURN_DURATION_SECONDS
    const elapsedSeconds = (performance.now() - startedAtRef.current) / 1_000
    progressRef.current =
      fixedProgressRef.current ?? Math.min(1, elapsedSeconds / duration)

    if (progressRef.current < 1) {
      state.invalidate()
      return
    }

    if (!completionSentRef.current) {
      completionSentRef.current = true

      if (phase === 'approach') {
        onLandingComplete()
      } else {
        onReturnComplete()
      }
    }
  }, -10)

  const value = useMemo(() => ({ progressRef }), [])

  return (
    <CinematicClockContext.Provider value={value}>
      {children}
    </CinematicClockContext.Provider>
  )
}

export function useCinematicProgress(): MutableRefObject<number> {
  const value = useContext(CinematicClockContext)

  if (value === null) {
    throw new Error('useCinematicProgress must be used inside its provider.')
  }

  return value.progressRef
}
