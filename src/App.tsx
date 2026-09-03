import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three'
import type { LandingSite } from './domain/lunarCoordinates.ts'
import {
  INITIAL_MOON_CORE_STATE,
  moonCoreReducer,
} from './simulation/moonCoreState.ts'
import {
  calculateDpr,
  detectQualitySettings,
} from './render/quality.ts'
import { CinematicHud } from './app/CinematicHud.tsx'
import { SceneRoot } from './scene/SceneRoot.tsx'
import {
  isRobotTransient,
  outpostReducer,
} from './simulation/outpostSimulation.ts'
import {
  loadPrototypeSave,
  resetPrototypeSave,
  writePrototypeSave,
} from './persistence/outpostSave.ts'
import { setSimulationTimePaused } from './simulation/simulationTime.ts'
import { RivalHud } from './app/RivalHud.tsx'
import type { RivalStage } from './domain/rival.ts'
import { rivalSignalReducer } from './simulation/rivalSimulation.ts'
import {
  createRivalPresentation,
  getNextAutomaticRivalPhase,
  getRivalPresentationDurationMs,
  rivalPresentationNeedsContinuousFrames,
  type RivalPresentationPhase,
  type RivalPresentationState,
} from './app/rivalPresentation.ts'
import {
  firstStrikeReducer,
} from './simulation/firstStrikeSimulation.ts'
import {
  createFirstStrikePresentation,
  firstStrikeNeedsContinuousFrames,
  getFirstStrikePresentationDurationMs,
  getNextAutomaticFirstStrikePhase,
  type FirstStrikePresentationPhase,
  type FirstStrikePresentationState,
} from './app/firstStrikePresentation.ts'
import { FirstStrikeHud } from './app/FirstStrikeHud.tsx'
import { RENDER_EXPOSURE } from './render/visualSystem.ts'
import { LaunchGate } from './app/LaunchGate.tsx'
import { useCinematicAudio } from './audio/useCinematicAudio.ts'
import {
  COUNTERSTRIKE_TIMING,
  counterstrikeFactsReducer,
  counterstrikeNeedsContinuousFrames,
  counterstrikeRunReducer,
  createCounterstrikeRunState,
  getCounterstrikeRunDurationMs,
  type CounterstrikeRunState,
  type CounterstrikeRunStatus,
  type InterceptionJudgement,
} from './simulation/counterstrikeSimulation.ts'
import { CounterstrikeHud } from './app/CounterstrikeHud.tsx'
import {
  E2E_HARNESS_BUILD_ENABLED,
  shouldEnableE2eHarness,
} from './testing/e2eHarness.ts'

function WebGLFallback() {
  return (
    <p className="webgl-fallback" role="alert">
      Moon Core requires a browser with WebGL 2 enabled.
    </p>
  )
}

function configureRenderer(gl: WebGLRenderer): void {
  gl.outputColorSpace = SRGBColorSpace
  gl.toneMapping = ACESFilmicToneMapping
  gl.toneMappingExposure = RENDER_EXPOSURE
  gl.domElement.dataset.renderer = 'webgl2'
}

function WebGlContextRecovery() {
  const { gl, invalidate } = useThree()

  useEffect(() => {
    let restorationFrame: number | null = null

    const handleContextRestored = () => {
      configureRenderer(gl)

      if (restorationFrame !== null) {
        window.cancelAnimationFrame(restorationFrame)
      }

      restorationFrame = window.requestAnimationFrame(() => {
        restorationFrame = null
        invalidate()
      })
    }

    gl.domElement.addEventListener('webglcontextrestored', handleContextRestored)

    return () => {
      gl.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored,
      )

      if (restorationFrame !== null) {
        window.cancelAnimationFrame(restorationFrame)
      }
    }
  }, [gl, invalidate])

  return null
}

const RIVAL_PRESENTATION_PHASES: readonly RivalPresentationPhase[] = [
  'idle',
  'warning',
  'orbital-transition',
  'capsule-approach',
  'impact',
  'intro-transmission',
  'dual-sites',
  'rival-focus',
  'rival-focused',
  'scanning',
  'scan-response',
  'contested',
]

const FIRST_STRIKE_PRESENTATION_PHASES: readonly FirstStrikePresentationPhase[] = [
  'idle',
  'arming',
  'launch',
  'orbital-flight',
  'vesper-transmission',
  'target-approach',
  'impact-flash',
  'ejecta',
  'crater-reveal',
  'orbital-pullback',
  'scar-explore',
  'ending',
]

const COUNTERSTRIKE_RUN_STATUSES: readonly CounterstrikeRunStatus[] = [
  'dormant',
  'warning',
  'tracking',
  'intercept-ready',
  'interceptor-launched',
  'success',
  'missed',
  'impact',
  'resolved',
]

const COUNTERSTRIKE_ENDING_HOLD_MS = 3_600

function requestHaptic(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Haptics are an optional enhancement and must never block presentation.
  }
}

function stopHaptics(): void {
  try {
    navigator.vibrate?.(0)
  } catch {
    // Some browsers expose vibration but reject cancellation outside a gesture.
  }
}

function isRivalPresentationPhase(
  value: unknown,
): value is RivalPresentationPhase {
  return RIVAL_PRESENTATION_PHASES.includes(value as RivalPresentationPhase)
}

function isFirstStrikePresentationPhase(
  value: unknown,
): value is FirstStrikePresentationPhase {
  return FIRST_STRIKE_PRESENTATION_PHASES.includes(
    value as FirstStrikePresentationPhase,
  )
}

function isCounterstrikeRunStatus(
  value: unknown,
): value is CounterstrikeRunStatus {
  return COUNTERSTRIKE_RUN_STATUSES.includes(value as CounterstrikeRunStatus)
}

function App() {
  const audio = useCinematicAudio()
  const e2eHarnessActive = shouldEnableE2eHarness(
    E2E_HARNESS_BUILD_ENABLED,
    window.location.search,
  )
  const [restoredPrototype] = useState(() =>
    loadPrototypeSave(window.localStorage),
  )
  const restoredOutpost = restoredPrototype?.outpost ?? null
  const restoredFirstStrike = restoredPrototype?.firstStrike ?? null
  const restoredCounterstrike = restoredPrototype?.counterstrike ?? null
  const [state, dispatch] = useReducer(
    moonCoreReducer,
    restoredOutpost === null
      ? INITIAL_MOON_CORE_STATE
      : restoredFirstStrike?.status === 'COMPLETE'
        ? INITIAL_MOON_CORE_STATE
        : { phase: 'landed', landingSite: restoredOutpost.site },
  )
  const [outpost, dispatchOutpost] = useReducer(
    outpostReducer,
    restoredOutpost,
  )
  const [rival, dispatchRival] = useReducer(
    rivalSignalReducer,
    restoredPrototype?.rival ?? null,
  )
  const [firstStrike, dispatchFirstStrike] = useReducer(
    firstStrikeReducer,
    restoredFirstStrike,
  )
  const [counterstrike, dispatchCounterstrike] = useReducer(
    counterstrikeFactsReducer,
    restoredCounterstrike,
  )
  const [counterstrikeRun, setCounterstrikeRun] =
    useState<CounterstrikeRunState>(() =>
      createCounterstrikeRunState(restoredCounterstrike, performance.now()),
    )
  const [rivalPresentation, setRivalPresentation] =
    useState<RivalPresentationState>(() => createRivalPresentation())
  const [firstStrikePresentation, setFirstStrikePresentation] =
    useState<FirstStrikePresentationState>(() =>
      createFirstStrikePresentation(),
    )
  const [strikeConfirmationOpen, setStrikeConfirmationOpen] = useState(false)
  const [entryOpen, setEntryOpen] = useState(true)
  const [previewRivalStage, setPreviewRivalStage] =
    useState<RivalStage | null>(null)
  const [selectedDepositId, setSelectedDepositId] = useState<string | null>(
    null,
  )
  const saveEnabledRef = useRef(true)
  const restoredSessionRef = useRef(restoredPrototype !== null)
  const advanceRivalPresentationRef = useRef<() => void>(() => undefined)
  const advanceFirstStrikePresentationRef = useRef<() => void>(() => undefined)
  const advanceCounterstrikeRef = useRef<() => void>(() => undefined)
  const counterstrikeFireElapsedOverrideRef = useRef<number | null>(null)
  const firstStrikeManualControlRef = useRef(false)
  const counterstrikeManualControlRef = useRef(false)
  const simulationPausedRef = useRef(false)
  const transitionsPausedRef = useRef(false)
  const transitionGenerationRef = useRef(0)
  const entryOpenRef = useRef(entryOpen)
  const rivalHiddenAtRef = useRef<number | null>(null)
  const previousRobotStateRef = useRef(outpost?.robot.state ?? null)
  const previousRivalAudioPhaseRef = useRef(rivalPresentation.phase)
  const previousStrikeAudioPhaseRef = useRef(firstStrikePresentation.phase)
  const previousCounterstrikeAudioStateRef = useRef(counterstrikeRun.status)
  const counterstrikeImpactCueFiredRef = useRef(false)
  const [rivalClockRunning, setRivalClockRunning] = useState(
    () => document.visibilityState !== 'hidden',
  )
  const [sceneReady, setSceneReady] = useState(false)
  const quality = useMemo(() => detectQualitySettings(), [])
  const [dpr, setDpr] = useState(() =>
    calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
  )
  entryOpenRef.current = entryOpen
  const continuousRendering =
    !entryOpen &&
    (state.phase === 'approach' ||
      state.phase === 'returning' ||
      (outpost !== null &&
        (isRobotTransient(outpost.robot.state) ||
          outpost.extractor?.status === 'constructing')) ||
      rivalPresentationNeedsContinuousFrames(rivalPresentation.phase) ||
      firstStrikeNeedsContinuousFrames(firstStrikePresentation.phase) ||
      counterstrikeNeedsContinuousFrames(counterstrikeRun.status))

  useEffect(() => {
    const updateDpr = () =>
      setDpr(
        calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
      )

    window.addEventListener('resize', updateDpr)
    return () => window.removeEventListener('resize', updateDpr)
  }, [quality.maxDpr])

  useEffect(() => () => stopHaptics(), [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        transitionGenerationRef.current += 1
        rivalHiddenAtRef.current = performance.now()
        audio.stopAll()
        stopHaptics()
        setRivalClockRunning(false)
        return
      }

      const hiddenAtMs = rivalHiddenAtRef.current
      rivalHiddenAtRef.current = null

      if (hiddenAtMs !== null) {
        const hiddenDurationMs = performance.now() - hiddenAtMs
        setRivalPresentation((current) =>
          current.phase === 'idle' || current.progressOverride !== null
            ? current
            : {
                ...current,
                startedAtMs: current.startedAtMs + hiddenDurationMs,
              },
        )
        setFirstStrikePresentation((current) =>
          current.phase === 'idle' ||
          current.phase === 'scar-explore' ||
          current.progressOverride !== null
            ? current
            : {
                ...current,
                startedAtMs: current.startedAtMs + hiddenDurationMs,
              },
        )
        setCounterstrikeRun((current) =>
          counterstrikeRunReducer(current, {
            type: 'shiftClock',
            durationMs: hiddenDurationMs,
          }),
        )
      }

      setRivalClockRunning(true)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [audio.stopAll])

  useEffect(() => {
    if (!e2eHarnessActive) {
      return
    }

    const setPaused = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly paused: boolean
          readonly visualOffsetMs?: number
        }>
      ).detail
      simulationPausedRef.current = detail.paused
      setSimulationTimePaused(detail.paused, detail.visualOffsetMs ?? 0)
    }
    const setTransitionsPaused = (event: Event) => {
      transitionsPausedRef.current = (
        event as CustomEvent<{ readonly paused: boolean }>
      ).detail.paused
    }
    const setRivalPresentationForTest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly phase: unknown
          readonly progress?: number | null
          readonly replay?: boolean
        }>
      ).detail

      if (!isRivalPresentationPhase(detail.phase)) {
        return
      }

      transitionGenerationRef.current += 1
      setRivalPresentation(
        createRivalPresentation(detail.phase, performance.now(), {
          progressOverride:
            typeof detail.progress === 'number' ? detail.progress : null,
          replay: detail.replay ?? false,
        }),
      )
    }
    const previewRivalStageForTest = (event: Event) => {
      const stage = (
        event as CustomEvent<{ readonly stage: RivalStage | null }>
      ).detail.stage

      if (
        stage === null ||
        stage === 'LANDED' ||
        stage === 'ESTABLISHING' ||
        stage === 'FORTIFIED'
      ) {
        setPreviewRivalStage(stage)
      }
    }
    const advanceRivalPresentationForTest = () => {
      advanceRivalPresentationRef.current()
    }
    const setFirstStrikePresentationForTest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly phase: unknown
          readonly progress?: number | null
          readonly replay?: boolean
        }>
      ).detail

      if (!isFirstStrikePresentationPhase(detail.phase)) {
        return
      }

      transitionGenerationRef.current += 1
      firstStrikeManualControlRef.current = true
      setFirstStrikePresentation(
        createFirstStrikePresentation(
          detail.phase,
          performance.now(),
          typeof detail.progress === 'number' ? detail.progress : null,
          detail.replay ?? false,
        ),
      )
    }
    const advanceFirstStrikePresentationForTest = () => {
      advanceFirstStrikePresentationRef.current()
    }
    const setCounterstrikeRunForTest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly status: unknown
          readonly progress?: number
          readonly attemptNumber?: 0 | 1 | 2
          readonly attemptsUsed?: 0 | 1 | 2
          readonly attemptElapsedMs?: number
          readonly attemptElapsedAtFireMs?: number | null
          readonly judgement?: InterceptionJudgement | null
          readonly outcome?: 'SUCCESS' | 'FAILURE' | null
          readonly replay?: boolean
        }>
      ).detail
      if (!isCounterstrikeRunStatus(detail.status)) return
      const status = detail.status

      transitionGenerationRef.current += 1
      counterstrikeManualControlRef.current = true
      const nowMs = performance.now()
      setCounterstrikeRun((current) => {
        const attemptNumber = detail.attemptNumber ??
          (status === 'tracking' ||
          status === 'intercept-ready' ||
          status === 'interceptor-launched' ||
          status === 'missed'
            ? 1
            : 0)
        const base: CounterstrikeRunState = {
          ...current,
          status,
          phaseStartedAtMs: nowMs,
          attemptStartedAtMs:
            attemptNumber === 0
              ? null
              : typeof detail.attemptElapsedMs === 'number'
                ? nowMs - Math.max(0, detail.attemptElapsedMs)
                : status === 'intercept-ready'
                  ? nowMs - COUNTERSTRIKE_TIMING.trackingMs
                  : nowMs,
          attemptNumber,
          attemptsUsed: detail.attemptsUsed ?? current.attemptsUsed,
          judgement: detail.judgement ?? null,
          attemptElapsedAtFireMs:
            detail.attemptElapsedAtFireMs !== undefined
              ? detail.attemptElapsedAtFireMs
              : current.attemptElapsedAtFireMs,
          outcome: detail.outcome ?? null,
          replay: detail.replay ?? current.replay,
          threatProgressStart:
            attemptNumber === 2 ? 0.66 : status === 'warning' ? 0 : 0.08,
          threatProgressEnd:
            status === 'warning'
              ? 0.08
              : attemptNumber === 2
                ? status === 'intercept-ready'
                  ? 0.91
                  : 0.78
                : status === 'intercept-ready'
                  ? 0.58
                  : 0.4,
          interceptRouteProgress:
            status === 'success' ||
            status === 'resolved' ||
            status === 'interceptor-launched'
              ? current.interceptRouteProgress ?? 0.7
              : null,
        }
        const durationMs = getCounterstrikeRunDurationMs(base)
        const progress = Math.max(0, Math.min(1, detail.progress ?? 0))
        return {
          ...base,
          phaseStartedAtMs:
            durationMs === null ? nowMs : nowMs - durationMs * progress,
        }
      })
    }
    const advanceCounterstrikeForTest = () => {
      advanceCounterstrikeRef.current()
    }
    const setCounterstrikeFireElapsedForTest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly attemptElapsedMs: unknown
          acknowledged?: boolean
        }>
      ).detail
      const attemptElapsedMs = detail.attemptElapsedMs
      if (
        typeof attemptElapsedMs === 'number' &&
        Number.isFinite(attemptElapsedMs) &&
        attemptElapsedMs >= 0
      ) {
        counterstrikeFireElapsedOverrideRef.current = attemptElapsedMs
        detail.acknowledged = true
      }
    }

    window.addEventListener('first-outpost:set-simulation-paused', setPaused)
    window.addEventListener(
      'first-outpost:set-transitions-paused',
      setTransitionsPaused,
    )
    window.addEventListener(
      'rival-signal:set-presentation',
      setRivalPresentationForTest,
    )
    window.addEventListener(
      'rival-signal:preview-stage',
      previewRivalStageForTest,
    )
    window.addEventListener(
      'rival-signal:advance-presentation',
      advanceRivalPresentationForTest,
    )
    window.addEventListener(
      'first-strike:set-presentation',
      setFirstStrikePresentationForTest,
    )
    window.addEventListener(
      'first-strike:advance-presentation',
      advanceFirstStrikePresentationForTest,
    )
    window.addEventListener(
      'counterstrike:set-run',
      setCounterstrikeRunForTest,
    )
    window.addEventListener(
      'counterstrike:advance',
      advanceCounterstrikeForTest,
    )
    window.addEventListener(
      'counterstrike:set-fire-elapsed',
      setCounterstrikeFireElapsedForTest,
    )
    return () => {
      window.removeEventListener('first-outpost:set-simulation-paused', setPaused)
      window.removeEventListener(
        'first-outpost:set-transitions-paused',
        setTransitionsPaused,
      )
      window.removeEventListener(
        'rival-signal:set-presentation',
        setRivalPresentationForTest,
      )
      window.removeEventListener(
        'rival-signal:preview-stage',
        previewRivalStageForTest,
      )
      window.removeEventListener(
        'rival-signal:advance-presentation',
        advanceRivalPresentationForTest,
      )
      window.removeEventListener(
        'first-strike:set-presentation',
        setFirstStrikePresentationForTest,
      )
      window.removeEventListener(
        'first-strike:advance-presentation',
        advanceFirstStrikePresentationForTest,
      )
      window.removeEventListener(
        'counterstrike:set-run',
        setCounterstrikeRunForTest,
      )
      window.removeEventListener(
        'counterstrike:advance',
        advanceCounterstrikeForTest,
      )
      window.removeEventListener(
        'counterstrike:set-fire-elapsed',
        setCounterstrikeFireElapsedForTest,
      )
    }
  }, [e2eHarnessActive])

  useEffect(() => {
    const nextRobotState = outpost?.robot.state ?? null
    const previousRobotState = previousRobotStateRef.current
    previousRobotStateRef.current = nextRobotState

    if (entryOpen || nextRobotState === previousRobotState) return

    if (nextRobotState === 'deploying') audio.play('capsule')
    if (nextRobotState === 'traveling' || nextRobotState === 'returning') {
      audio.play('miner')
    }
    if (nextRobotState === 'mining') audio.play('drill')
    if (nextRobotState === 'unloading') audio.play('ui-confirm')
  }, [audio, entryOpen, outpost?.robot.state])

  useEffect(() => {
    const phase = rivalPresentation.phase
    const previousPhase = previousRivalAudioPhaseRef.current
    previousRivalAudioPhaseRef.current = phase
    if (entryOpen || phase === previousPhase) return

    if (phase === 'warning' || phase === 'intro-transmission') {
      audio.play('rival')
    } else if (phase === 'scanning') {
      audio.play('scan')
    } else if (phase === 'scan-response') {
      audio.play('rival')
    }
  }, [audio, entryOpen, rivalPresentation.phase])

  useEffect(() => {
    const phase = firstStrikePresentation.phase
    const previousPhase = previousStrikeAudioPhaseRef.current
    previousStrikeAudioPhaseRef.current = phase
    if (entryOpen || phase === previousPhase) return

    if (phase === 'arming') audio.play('arm')
    if (phase === 'launch') {
      audio.play('ignition')
      requestHaptic([24, 34, 42])
    }
    if (phase === 'orbital-flight') audio.play('flight')
    if (phase === 'impact-flash') {
      audio.play('impact')
      requestHaptic([42, 28, 64])
    }
    if (phase === 'ending') audio.play('complete')
  }, [audio, entryOpen, firstStrikePresentation.phase])

  useEffect(() => {
    const status = counterstrikeRun.status
    const previousStatus = previousCounterstrikeAudioStateRef.current
    previousCounterstrikeAudioStateRef.current = status
    if (entryOpen || status === previousStatus) return

    if (status === 'warning') {
      audio.stopAll()
      audio.play('threat-warning')
      requestHaptic([28, 46, 28])
    } else if (status === 'tracking') {
      audio.play('target-lock')
    } else if (status === 'intercept-ready') {
      audio.play('fire-window')
      requestHaptic(
        counterstrikeRun.attemptNumber === 2
          ? [18, 12, 32]
          : [14, 20, 18],
      )
    } else if (status === 'interceptor-launched') {
      audio.play('interceptor-launch')
      requestHaptic([22, 20, 38])
    } else if (status === 'missed') {
      audio.play('near-miss')
      requestHaptic([10, 38, 10])
    } else if (status === 'success') {
      audio.play('orbital-interception')
      requestHaptic([28, 22, 34])
    } else if (status === 'impact') {
      counterstrikeImpactCueFiredRef.current = false
    } else if (status === 'resolved') {
      audio.stopAll()
      stopHaptics()
    }
  }, [
    audio,
    counterstrikeRun.attemptNumber,
    counterstrikeRun.status,
    entryOpen,
  ])

  useEffect(() => {
    if (
      entryOpen ||
      !rivalClockRunning ||
      counterstrikeRun.status !== 'impact' ||
      counterstrikeImpactCueFiredRef.current
    ) {
      return
    }

    const elapsedMs = performance.now() - counterstrikeRun.phaseStartedAtMs
    const timer = window.setTimeout(() => {
      if (
        document.visibilityState === 'hidden' ||
        counterstrikeImpactCueFiredRef.current
      ) {
        return
      }

      counterstrikeImpactCueFiredRef.current = true
      audio.play('structural-impact')
      requestHaptic([46, 28, 62])
    }, Math.max(0, COUNTERSTRIKE_TIMING.impactContactMs - elapsedMs))

    return () => window.clearTimeout(timer)
  }, [
    audio,
    counterstrikeRun.phaseStartedAtMs,
    counterstrikeRun.status,
    entryOpen,
    rivalClockRunning,
  ])

  useEffect(() => {
    if (
      outpost !== null &&
      rival !== null &&
      firstStrike !== null &&
      counterstrike !== null &&
      saveEnabledRef.current
    ) {
      writePrototypeSave(window.localStorage, {
        outpost,
        rival,
        firstStrike,
        counterstrike,
      })
    }
  }, [counterstrike, firstStrike, outpost, rival])

  useEffect(() => {
    if (phaseIsAwayFromSurface(state.phase)) {
      setSelectedDepositId(null)
    }
  }, [state.phase])

  useEffect(() => {
    if (entryOpen || state.phase !== 'landed' || outpost === null) {
      return
    }

    const extractorNeedsTicks = outpost.extractor !== null
    const robotNeedsTicks = isRobotTransient(outpost.robot.state)

    if (!extractorNeedsTicks && !robotNeedsTicks) {
      return
    }

    const intervalMs = robotNeedsTicks || outpost.extractor?.status === 'constructing'
      ? 80
      : 400
    const timer = window.setInterval(() => {
      if (!simulationPausedRef.current && !transitionsPausedRef.current) {
        dispatchOutpost({ type: 'tick', nowMs: Date.now() })
      }
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [entryOpen, outpost, state.phase])

  const beginRivalReveal = useCallback(() => {
    if (
      rival === null ||
      rival.revealStatus !== 'QUEUED' ||
      rivalPresentation.phase !== 'idle'
    ) {
      return
    }

    transitionGenerationRef.current += 1
    dispatchRival({ type: 'beginCinematic', nowMs: Date.now() })
    setRivalPresentation(createRivalPresentation('warning'))
  }, [rival, rivalPresentation.phase])

  useEffect(() => {
    if (
      outpost === null ||
      rival === null ||
      rival.revealStatus !== 'DORMANT' ||
      outpost.stage !== 'extractor-active' ||
      outpost.extractor?.status !== 'active'
    ) {
      return
    }

    dispatchRival({
      type: 'extractorActivated',
      outpost,
      nowMs: Date.now(),
    })
  }, [outpost, rival])

  useEffect(() => {
    if (
      !entryOpen &&
      rival?.revealStatus === 'AWAITING_SAFE_MOMENT' &&
      state.phase === 'orbit'
    ) {
      dispatchRival({ type: 'safeMomentReached', nowMs: Date.now() })
    }
  }, [entryOpen, rival?.revealStatus, state.phase])

  useEffect(() => {
    if (
      outpost === null ||
      rival === null ||
      firstStrike === null ||
      firstStrike.status !== 'LOCKED' ||
      !rival.scanResponseCompleted
    ) {
      return
    }

    dispatchFirstStrike({
      type: 'unlock',
      outpost,
      rival,
      nowMs: Date.now(),
    })
  }, [firstStrike, outpost, rival])

  useEffect(() => {
    if (
      counterstrike === null ||
      firstStrike === null ||
      counterstrike.available
    ) {
      return
    }

    dispatchCounterstrike({
      type: 'unlock',
      firstStrike,
      nowMs: Date.now(),
    })
  }, [counterstrike, firstStrike])

  useEffect(() => {
    if (
      entryOpen ||
      rival?.revealStatus !== 'QUEUED' ||
      rivalPresentation.phase !== 'idle' ||
      !rivalClockRunning
    ) {
      return
    }

    if (state.phase === 'orbit') {
      beginRivalReveal()
      return
    }

    if (restoredSessionRef.current || state.phase !== 'landed') {
      return
    }

    let timer = 0
    const transitionGeneration = transitionGenerationRef.current
    const attemptReveal = () => {
      if (
        transitionGeneration !== transitionGenerationRef.current ||
        entryOpenRef.current
      ) {
        return
      }

      if (
        document.visibilityState === 'hidden' ||
        simulationPausedRef.current ||
        transitionsPausedRef.current
      ) {
        timer = window.setTimeout(attemptReveal, 200)
        return
      }

      beginRivalReveal()
    }

    timer = window.setTimeout(attemptReveal, 2_200)
    return () => window.clearTimeout(timer)
  }, [
    beginRivalReveal,
    entryOpen,
    rivalClockRunning,
    rival?.revealStatus,
    rivalPresentation.phase,
    state.phase,
  ])

  const advanceRivalPresentation = useCallback(() => {
    const currentPhase = rivalPresentation.phase
    let nextPhase = getNextAutomaticRivalPhase(currentPhase)

    if (nextPhase === null) {
      return
    }

    transitionGenerationRef.current += 1
    if (currentPhase === 'warning' && state.phase !== 'orbit') {
      dispatch({ type: 'returnToOrbit' })
    }

    if (
      currentPhase === 'impact' &&
      rival?.introTransmissionCompleted &&
      !rivalPresentation.replay
    ) {
      nextPhase = 'dual-sites'
    }

    if (
      currentPhase === 'rival-focus' &&
      rival?.scanCompleted &&
      !rival.scanResponseCompleted
    ) {
      nextPhase = 'scan-response'
    }

    if (currentPhase === 'intro-transmission' && !rivalPresentation.replay) {
      dispatchRival({
        type: 'completeIntroTransmission',
        nowMs: Date.now(),
      })
    }

    if (currentPhase === 'dual-sites' && !rivalPresentation.replay) {
      dispatchRival({ type: 'completeCinematic', nowMs: Date.now() })
    }

    if (currentPhase === 'scanning') {
      dispatchRival({ type: 'completeScan', nowMs: Date.now() })
    }

    if (currentPhase === 'scan-response') {
      dispatchRival({ type: 'completeScanResponse', nowMs: Date.now() })
    }

    setRivalPresentation(
      createRivalPresentation(nextPhase, performance.now(), {
        replay: rivalPresentation.replay,
      }),
    )
  }, [rival, rivalPresentation, state.phase])

  useEffect(() => {
    advanceRivalPresentationRef.current = advanceRivalPresentation
  }, [advanceRivalPresentation])

  useEffect(() => {
    const durationMs = getRivalPresentationDurationMs(
      rivalPresentation.phase,
    )

    if (
      entryOpen ||
      !rivalClockRunning ||
      durationMs === null ||
      rivalPresentation.progressOverride !== null
    ) {
      return
    }

    const elapsedMs = performance.now() - rivalPresentation.startedAtMs
    const transitionGeneration = transitionGenerationRef.current
    const timer = window.setTimeout(() => {
      // The visibility state changes synchronously, while React may defer this
      // effect's cleanup under load. Never let an already-queued phase timer
      // consume a cinematic while the page is hidden.
      if (
        transitionGeneration === transitionGenerationRef.current &&
        !entryOpenRef.current &&
        document.visibilityState !== 'hidden'
      ) {
        advanceRivalPresentation()
      }
    }, Math.max(0, durationMs - elapsedMs))
    return () => window.clearTimeout(timer)
  }, [
    advanceRivalPresentation,
    entryOpen,
    rivalClockRunning,
    rivalPresentation,
  ])

  const advanceFirstStrikePresentation = useCallback(() => {
    const currentPhase = firstStrikePresentation.phase
    const replay = firstStrikePresentation.replay
    const nextPhase = getNextAutomaticFirstStrikePhase(currentPhase)

    if (nextPhase === null) {
      return
    }

    transitionGenerationRef.current += 1
    const nowMs = Date.now()

    if (!replay && currentPhase === 'launch') {
      dispatchFirstStrike({ type: 'completeLaunch', nowMs })
    }

    if (!replay && currentPhase === 'vesper-transmission') {
      dispatchFirstStrike({ type: 'completeFinalTransmission', nowMs })
    }

    if (!replay && currentPhase === 'impact-flash' && rival !== null) {
      dispatchFirstStrike({
        type: 'completeImpact',
        rivalSite: rival.site,
        nowMs,
      })
    }

    if (!replay && currentPhase === 'orbital-pullback') {
      dispatchFirstStrike({ type: 'completeEnding', nowMs })
    }

    setFirstStrikePresentation(
      createFirstStrikePresentation(nextPhase, performance.now(), null, replay),
    )
  }, [firstStrikePresentation.phase, firstStrikePresentation.replay, rival])

  useEffect(() => {
    advanceFirstStrikePresentationRef.current =
      advanceFirstStrikePresentation
  }, [advanceFirstStrikePresentation])

  useEffect(() => {
    const durationMs = getFirstStrikePresentationDurationMs(
      firstStrikePresentation.phase,
    )

    if (
      entryOpen ||
      !rivalClockRunning ||
      firstStrikeManualControlRef.current ||
      durationMs === null ||
      firstStrikePresentation.progressOverride !== null
    ) {
      return
    }

    const elapsedMs = performance.now() - firstStrikePresentation.startedAtMs
    const transitionGeneration = transitionGenerationRef.current
    const timer = window.setTimeout(() => {
      if (
        transitionGeneration === transitionGenerationRef.current &&
        !entryOpenRef.current &&
        document.visibilityState !== 'hidden'
      ) {
        advanceFirstStrikePresentation()
      }
    }, Math.max(0, durationMs - elapsedMs))

    return () => window.clearTimeout(timer)
  }, [
    advanceFirstStrikePresentation,
    entryOpen,
    firstStrikePresentation,
    rivalClockRunning,
  ])

  const beginCounterstrike = useCallback(
    (replay: boolean) => {
      if (
        counterstrike?.available !== true ||
        outpost === null ||
        rival === null ||
        (replay
          ? counterstrikeRun.status !== 'resolved' ||
            !counterstrike.replayEligible
          : counterstrikeRun.status !== 'dormant' ||
            counterstrike.acceptedOutcome !== null)
      ) {
        return
      }

      transitionGenerationRef.current += 1
      audio.stopAll()
      stopHaptics()
      firstStrikeManualControlRef.current = false
      counterstrikeManualControlRef.current = false
      counterstrikeFireElapsedOverrideRef.current = null
      setSelectedDepositId(null)
      setPreviewRivalStage(null)
      setRivalPresentation(createRivalPresentation())
      setFirstStrikePresentation(createFirstStrikePresentation())
      setCounterstrikeRun((current) =>
        counterstrikeRunReducer(current, {
          type: 'begin',
          clockMs: performance.now(),
          replay,
        }),
      )
    },
    [audio, counterstrike, counterstrikeRun.status, outpost, rival],
  )

  useEffect(() => {
    if (
      entryOpen ||
      !rivalClockRunning ||
      firstStrikeManualControlRef.current ||
      firstStrikePresentation.phase !== 'ending' ||
      firstStrikePresentation.replay ||
      counterstrike?.available !== true ||
      counterstrike.acceptedOutcome !== null ||
      counterstrikeRun.status !== 'dormant'
    ) {
      return
    }

    const elapsedMs = performance.now() - firstStrikePresentation.startedAtMs
    const transitionGeneration = transitionGenerationRef.current
    const timer = window.setTimeout(() => {
      if (
        transitionGeneration === transitionGenerationRef.current &&
        !entryOpenRef.current &&
        document.visibilityState !== 'hidden'
      ) {
        beginCounterstrike(false)
      }
    }, Math.max(0, COUNTERSTRIKE_ENDING_HOLD_MS - elapsedMs))

    return () => window.clearTimeout(timer)
  }, [
    beginCounterstrike,
    counterstrike?.acceptedOutcome,
    counterstrike?.available,
    counterstrikeRun.status,
    entryOpen,
    firstStrikePresentation,
    rivalClockRunning,
  ])

  const advanceCounterstrike = useCallback(() => {
    transitionGenerationRef.current += 1
    setCounterstrikeRun((current) =>
      counterstrikeRunReducer(current, {
        type: 'advance',
        clockMs: performance.now(),
      }),
    )
  }, [])

  useEffect(() => {
    advanceCounterstrikeRef.current = advanceCounterstrike
  }, [advanceCounterstrike])

  useEffect(() => {
    const durationMs = getCounterstrikeRunDurationMs(counterstrikeRun)
    if (
      entryOpen ||
      !rivalClockRunning ||
      counterstrikeManualControlRef.current ||
      durationMs === null
    ) {
      return
    }

    const elapsedMs = performance.now() - counterstrikeRun.phaseStartedAtMs
    const transitionGeneration = transitionGenerationRef.current
    const timer = window.setTimeout(() => {
      if (
        transitionGeneration === transitionGenerationRef.current &&
        !entryOpenRef.current &&
        document.visibilityState !== 'hidden'
      ) {
        advanceCounterstrike()
      }
    }, Math.max(0, durationMs - elapsedMs))

    return () => window.clearTimeout(timer)
  }, [
    advanceCounterstrike,
    counterstrikeRun,
    entryOpen,
    rivalClockRunning,
  ])

  useEffect(() => {
    if (
      counterstrikeRun.status !== 'resolved' ||
      counterstrikeRun.replay ||
      counterstrikeRun.outcome === null ||
      counterstrike === null ||
      counterstrike.acceptedOutcome !== null ||
      outpost === null
    ) {
      return
    }

    dispatchCounterstrike({
      type: 'acceptOutcome',
      outcome: counterstrikeRun.outcome,
      outpost,
      nowMs: Date.now(),
    })
  }, [counterstrike, counterstrikeRun, outpost])

  const handleSelect = useCallback((landingSite: LandingSite) => {
    if (outpost === null) {
      dispatch({ type: 'select', landingSite })
    }
  }, [outpost])

  const handleLandingComplete = useCallback(() => {
    const nowMs = Date.now()

    if (outpost === null && state.landingSite !== null) {
      saveEnabledRef.current = true
      dispatchOutpost({
        type: 'establish',
        site: state.landingSite,
        nowMs,
      })
      dispatchRival({
        type: 'establish',
        playerSite: state.landingSite,
        nowMs,
      })
      dispatchFirstStrike({ type: 'establish', nowMs })
      dispatchCounterstrike({ type: 'establish', nowMs })
    } else if (outpost !== null) {
      dispatchOutpost({ type: 'resumeSurface', nowMs })
    }

    dispatch({ type: 'landingComplete' })
  }, [outpost, state.landingSite])

  const handleReady = useCallback(() => {
    setSceneReady(true)
  }, [])

  const handleReturnComplete = useCallback(() => {
    dispatch({ type: 'returnComplete' })
  }, [])

  const handleFocusOutpost = useCallback(() => {
    if (
      outpost !== null &&
      state.phase === 'orbit' &&
      rivalPresentation.phase === 'idle'
    ) {
      transitionGenerationRef.current += 1
      setRivalPresentation(createRivalPresentation())
      dispatch({ type: 'revisit', landingSite: outpost.site })
    }
  }, [outpost, rivalPresentation.phase, state.phase])

  const handleReturnToOrbit = useCallback(() => {
    setSelectedDepositId(null)
    dispatch({ type: 'returnToOrbit' })
  }, [])

  const handleFocusRival = useCallback(() => {
    if (
      rival === null ||
      firstStrike?.rivalFootholdDamaged ||
      rival.revealStatus !== 'REVEALED' ||
      rival.stage === null ||
      state.phase !== 'orbit' ||
      rivalPresentation.phase !== 'idle'
    ) {
      return
    }

    setPreviewRivalStage(null)
    transitionGenerationRef.current += 1
    setRivalPresentation(createRivalPresentation('rival-focus'))
  }, [firstStrike?.rivalFootholdDamaged, rival, rivalPresentation.phase, state.phase])

  const handleScanRival = useCallback(() => {
    if (
      rival === null ||
      rival.scanCompleted ||
      rivalPresentation.phase !== 'rival-focused'
    ) {
      return
    }

    transitionGenerationRef.current += 1
    setRivalPresentation(createRivalPresentation('scanning'))
  }, [rival, rivalPresentation.phase])

  const handleReturnFromRival = useCallback(() => {
    const phase = rival?.scanCompleted ? 'contested' : 'dual-sites'
    transitionGenerationRef.current += 1
    setRivalPresentation(createRivalPresentation(phase))
  }, [rival?.scanCompleted])

  const handleReplayRival = useCallback(() => {
    if (rival?.replayEligible) {
      transitionGenerationRef.current += 1
      setRivalPresentation(
        createRivalPresentation('warning', performance.now(), {
          replay: true,
        }),
      )
    }
  }, [rival?.replayEligible])

  const handleSkipRival = useCallback(() => {
    if (!rival?.skipEligible || !rivalPresentation.replay) {
      return
    }

    transitionGenerationRef.current += 1
    setRivalPresentation(createRivalPresentation())
  }, [rival?.skipEligible, rivalPresentation.replay])

  const handleDeploy = useCallback(() => {
    audio.play('ui-confirm')
    dispatchOutpost({ type: 'deploy', nowMs: Date.now() })
  }, [audio])

  const handleMine = useCallback(() => {
    if (selectedDepositId !== null) {
      audio.play('ui-confirm')
      dispatchOutpost({
        type: 'mine',
        depositId: selectedDepositId,
        nowMs: Date.now(),
      })
    }
  }, [audio, selectedDepositId])

  const handleConstruct = useCallback(() => {
    if (selectedDepositId !== null) {
      audio.play('capsule')
      dispatchOutpost({
        type: 'constructExtractor',
        depositId: selectedDepositId,
        nowMs: Date.now(),
      })
    }
  }, [audio, selectedDepositId])

  const handleArmFirstStrike = useCallback(() => {
    if (firstStrike?.status !== 'READY') {
      return
    }

    dispatchFirstStrike({ type: 'arm', nowMs: Date.now() })
    audio.play('ui-confirm')
    setStrikeConfirmationOpen(true)
  }, [audio, firstStrike?.status])

  const handleOpenStrikeConfirmation = useCallback(() => {
    if (firstStrike?.status === 'ARMED') {
      setStrikeConfirmationOpen(true)
    }
  }, [firstStrike?.status])

  const handleCancelStrike = useCallback(() => {
    audio.play('ui-cancel')
    setStrikeConfirmationOpen(false)
    dispatchFirstStrike({ type: 'cancelLaunchConfirmation' })
  }, [audio])

  const handleFireFirstStrike = useCallback(() => {
    if (
      firstStrike?.status !== 'ARMED' ||
      outpost === null ||
      rival === null
    ) {
      return
    }

    transitionGenerationRef.current += 1
    setStrikeConfirmationOpen(false)
    audio.play('ui-confirm')
    setSelectedDepositId(null)
    setRivalPresentation(createRivalPresentation())
    dispatchFirstStrike({ type: 'fire', nowMs: Date.now() })
    setFirstStrikePresentation(createFirstStrikePresentation('arming'))

    if (state.phase !== 'orbit') {
      dispatch({ type: 'returnToOrbit' })
    }
  }, [audio, firstStrike?.status, outpost, rival, state.phase])

  const handleExploreScar = useCallback(() => {
    transitionGenerationRef.current += 1
    audio.stopAll()
    audio.play('ui-confirm')
    setFirstStrikePresentation(
      createFirstStrikePresentation('scar-explore'),
    )
  }, [audio])

  const handleReturnFromScar = useCallback(() => {
    transitionGenerationRef.current += 1
    audio.stopAll()
    audio.play('ui-cancel')
    setFirstStrikePresentation(createFirstStrikePresentation())
  }, [audio])

  const handleReplayStrike = useCallback(() => {
    if (
      firstStrike?.status !== 'COMPLETE' ||
      outpost === null ||
      rival === null
    ) {
      return
    }

    transitionGenerationRef.current += 1
    audio.stopAll()
    audio.play('ui-confirm')
    firstStrikeManualControlRef.current = false
    setStrikeConfirmationOpen(false)
    setSelectedDepositId(null)
    setRivalPresentation(createRivalPresentation())
    setFirstStrikePresentation(
      createFirstStrikePresentation('arming', performance.now(), null, true),
    )

    if (state.phase !== 'orbit') dispatch({ type: 'returnToOrbit' })
  }, [audio, firstStrike?.status, outpost, rival, state.phase])

  const handleBeginCounterstrike = useCallback(() => {
    beginCounterstrike(false)
    audio.play('ui-confirm')
  }, [audio, beginCounterstrike])

  const handleFireInterceptor = useCallback(() => {
    setCounterstrikeRun((current) => {
      const elapsedOverride = e2eHarnessActive
        ? counterstrikeFireElapsedOverrideRef.current
        : null
      counterstrikeFireElapsedOverrideRef.current = null
      const clockMs =
        elapsedOverride !== null && current.attemptStartedAtMs !== null
          ? current.attemptStartedAtMs + elapsedOverride
          : performance.now()
      return counterstrikeRunReducer(current, {
        type: 'fire',
        clockMs,
      })
    })
  }, [e2eHarnessActive])

  const handleReplayCounterstrike = useCallback(() => {
    beginCounterstrike(true)
    audio.play('ui-confirm')
  }, [audio, beginCounterstrike])

  const handleAcceptCounterstrikePreview = useCallback(() => {
    if (
      counterstrikeRun.status !== 'resolved' ||
      !counterstrikeRun.replay ||
      counterstrikeRun.outcome === null ||
      counterstrike === null ||
      outpost === null
    ) {
      return
    }

    dispatchCounterstrike({
      type: 'acceptOutcome',
      outcome: counterstrikeRun.outcome,
      outpost,
      nowMs: Date.now(),
    })
    setCounterstrikeRun((current) =>
      counterstrikeRunReducer(current, {
        type: 'restoreAccepted',
        outcome: counterstrikeRun.outcome,
        clockMs: performance.now(),
      }),
    )
    audio.play('ui-confirm')
  }, [audio, counterstrike, counterstrikeRun, outpost])

  const handleKeepAcceptedCounterstrike = useCallback(() => {
    if (
      counterstrikeRun.status !== 'resolved' ||
      !counterstrikeRun.replay ||
      counterstrike?.acceptedOutcome === null ||
      counterstrike?.acceptedOutcome === undefined
    ) {
      return
    }

    setCounterstrikeRun((current) =>
      counterstrikeRunReducer(current, {
        type: 'restoreAccepted',
        outcome: counterstrike.acceptedOutcome,
        clockMs: performance.now(),
      }),
    )
    audio.play('ui-cancel')
  }, [audio, counterstrike, counterstrikeRun.replay, counterstrikeRun.status])

  const handleBeginExperience = useCallback(() => {
    entryOpenRef.current = false
    audio.unlock()
    audio.play('enter')
    setEntryOpen(false)
  }, [audio])

  const handleClaim = useCallback(() => {
    audio.play('ui-confirm')
    dispatch({ type: 'claim' })
  }, [audio])

  const handleClearSite = useCallback(() => {
    audio.play('ui-cancel')
    dispatch({ type: 'clearSite' })
  }, [audio])

  const handleResetPrototype = useCallback(() => {
    const confirmed = window.confirm(
      'Reset the Shoot the Moon prototype? This erases the complete local run.',
    )

    if (!confirmed) {
      return
    }

    transitionGenerationRef.current += 1
    entryOpenRef.current = true
    audio.reset()
    stopHaptics()
    saveEnabledRef.current = false
    restoredSessionRef.current = false
    firstStrikeManualControlRef.current = false
    counterstrikeManualControlRef.current = false
    counterstrikeFireElapsedOverrideRef.current = null
    resetPrototypeSave(window.localStorage)
    setSelectedDepositId(null)
    setPreviewRivalStage(null)
    setRivalPresentation(createRivalPresentation())
    setFirstStrikePresentation(createFirstStrikePresentation())
    setCounterstrikeRun((current) =>
      counterstrikeRunReducer(current, {
        type: 'reset',
        clockMs: performance.now(),
      }),
    )
    setStrikeConfirmationOpen(false)
    setEntryOpen(true)
    dispatchOutpost({ type: 'reset' })
    dispatchRival({ type: 'reset' })
    dispatchFirstStrike({ type: 'reset' })
    dispatchCounterstrike({ type: 'reset' })
    dispatch({ type: 'resetPrototype' })
  }, [audio])

  const handleCreated = useCallback(({ gl }: { gl: WebGLRenderer }) => {
    configureRenderer(gl)
  }, [])

  const renderedRival = useMemo(
    () =>
      rival === null || previewRivalStage === null
        ? rival
        : {
            ...rival,
            revealStatus: 'REVEALED' as const,
            stage: previewRivalStage,
          },
    [previewRivalStage, rival],
  )
  const rivalFocused =
    rivalPresentation.phase === 'rival-focus' ||
    rivalPresentation.phase === 'rival-focused' ||
    rivalPresentation.phase === 'scanning' ||
    rivalPresentation.phase === 'scan-response'
  const rivalRevealed =
    rival?.revealStatus === 'REVEALED' && rival.stage !== null
  const rivalSignalHeld =
    rival?.revealStatus === 'AWAITING_SAFE_MOMENT' ||
    (restoredSessionRef.current && rival?.revealStatus === 'QUEUED')

  return (
    <main
      className="app-shell"
      aria-label="Shoot the Moon technical prototype"
      data-phase={state.phase}
      data-quality={quality.tier}
      data-scene-ready={sceneReady}
      data-outpost-stage={outpost?.stage ?? 'none'}
      data-robot-state={outpost?.robot.state ?? 'none'}
      data-lunar-ore={outpost?.lunarOre ?? 0}
      data-selected-deposit={selectedDepositId ?? 'none'}
      data-extractor-status={outpost?.extractor?.status ?? 'none'}
      data-extractor-activation-at={
        outpost?.extractor?.activationTimestampMs ?? 'none'
      }
      data-rival-reveal-state={rival?.revealStatus ?? 'none'}
      data-rival-stage={previewRivalStage ?? rival?.stage ?? 'none'}
      data-rival-presentation={rivalPresentation.phase}
      data-rival-clock-running={rivalClockRunning}
      data-rival-signal-held={rivalSignalHeld}
      data-rival-focus={rivalFocused}
      data-rival-intro-complete={
        rival?.introTransmissionCompleted ?? false
      }
      data-rival-scan-complete={rival?.scanCompleted ?? false}
      data-rival-response-complete={
        rival?.scanResponseCompleted ?? false
      }
      data-first-strike-status={firstStrike?.status ?? 'none'}
      data-first-strike-available={firstStrike?.available ?? false}
      data-first-strike-presentation={firstStrikePresentation.phase}
      data-first-strike-replay={firstStrikePresentation.replay}
      data-entry-open={entryOpen}
      data-launch-complete={firstStrike?.launchCompleted ?? false}
      data-impact-complete={firstStrike?.impactCompleted ?? false}
      data-rival-damaged={firstStrike?.rivalFootholdDamaged ?? false}
      data-scar-created={firstStrike?.permanentScarCreated ?? false}
      data-scar-latitude={
        firstStrike?.scar?.site.location.latitudeRad ?? 'none'
      }
      data-scar-longitude={
        firstStrike?.scar?.site.location.longitudeRad ?? 'none'
      }
      data-ending-complete={firstStrike?.endingCompleted ?? false}
      data-final-vesper-complete={
        firstStrike?.finalVesperTransmissionCompleted ?? false
      }
      data-counterstrike-available={counterstrike?.available ?? false}
      data-counterstrike-state={counterstrikeRun.status}
      data-counterstrike-attempt-number={counterstrikeRun.attemptNumber}
      data-counterstrike-attempts={counterstrikeRun.attemptsUsed}
      data-counterstrike-judgement={counterstrikeRun.judgement ?? 'none'}
      data-counterstrike-attempt-elapsed-ms={
        counterstrikeRun.attemptElapsedAtFireMs ?? 'none'
      }
      data-counterstrike-outcome={counterstrikeRun.outcome ?? 'none'}
      data-counterstrike-replay={counterstrikeRun.replay}
      data-counterstrike-accepted-outcome={
        counterstrike?.acceptedOutcome ?? 'none'
      }
      data-counterstrike-replay-eligible={
        counterstrike?.replayEligible ?? false
      }
      data-outpost-damage-state={
        counterstrike?.outpostDamageState ?? 'INTACT'
      }
      data-repairs-required={counterstrike?.repairsRequired ?? false}
      data-secondary-impact-latitude={
        counterstrike?.secondaryImpactSite?.location.latitudeRad ?? 'none'
      }
      data-secondary-impact-longitude={
        counterstrike?.secondaryImpactSite?.location.longitudeRad ?? 'none'
      }
      data-lunar-control={
        firstStrike?.rivalFootholdDamaged
          ? 'scarred'
          : rival?.scanResponseCompleted
            ? 'contested'
            : 'uncontested'
      }
      data-render-mode={continuousRendering ? 'continuous' : 'demand'}
    >
      <Canvas
        className="scene-canvas"
        aria-label="Moon Core 3D viewport"
        camera={{
          far: 80,
          fov: 42,
          near: 0.01,
          position: [3.2, 0.32, 0.92],
        }}
        dpr={dpr}
        fallback={<WebGLFallback />}
        frameloop="demand"
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        onCreated={handleCreated}
        shadows="basic"
      >
        <WebGlContextRecovery />
        <SceneRoot
          active={!entryOpen}
          phase={state.phase}
          landingSite={state.landingSite}
          outpost={outpost}
          rival={renderedRival}
          rivalPresentation={rivalPresentation}
          firstStrike={firstStrike}
          firstStrikePresentation={firstStrikePresentation}
          counterstrike={counterstrike}
          counterstrikeRun={counterstrikeRun}
          selectedDepositId={selectedDepositId}
          quality={quality}
          onLandingComplete={handleLandingComplete}
          onReady={handleReady}
          onReturnComplete={handleReturnComplete}
          onSelect={handleSelect}
          onSelectDeposit={setSelectedDepositId}
          onFocusOutpost={handleFocusOutpost}
          onFocusRival={handleFocusRival}
        />
      </Canvas>
      <CinematicHud
        phase={state.phase}
        site={state.landingSite}
        outpost={outpost}
        selectedDepositId={selectedDepositId}
        targetingOutpost={outpost !== null && state.phase === 'selected'}
        rivalRevealed={rivalRevealed}
        rivalSignalHeld={rivalSignalHeld}
        lunarControlContested={rival?.scanResponseCompleted ?? false}
        firstStrikeAvailable={firstStrike?.available ?? false}
        firstStrikeComplete={firstStrike?.status === 'COMPLETE'}
        counterstrikeState={counterstrikeRun.status}
        counterstrikeOutcome={counterstrikeRun.outcome}
        soundAvailable={audio.available}
        soundEnabled={audio.enabled}
        onToggleSound={audio.toggle}
        onClaim={handleClaim}
        onClear={handleClearSite}
        onReturn={handleReturnToOrbit}
        onDeploy={handleDeploy}
        onMine={handleMine}
        onConstruct={handleConstruct}
        onResetPrototype={handleResetPrototype}
      />
      <RivalHud
        rival={rival}
        presentation={rivalPresentation}
        showControlStatus={
          (state.phase === 'orbit' || state.phase === 'selected') &&
          firstStrikePresentation.phase === 'idle' &&
          counterstrikeRun.status === 'dormant'
        }
        onAdvance={advanceRivalPresentation}
        onReturnToOrbit={handleReturnFromRival}
        onScan={handleScanRival}
        onReplay={handleReplayRival}
        onSkip={handleSkipRival}
        firstStrikeAvailable={firstStrike?.available ?? false}
        rivalDamaged={firstStrike?.rivalFootholdDamaged ?? false}
      />
      {counterstrikeRun.status === 'dormant' ? (
        <FirstStrikeHud
          strike={firstStrike}
          rival={rival}
          presentation={firstStrikePresentation}
          confirmationOpen={strikeConfirmationOpen}
          showReady={
            state.phase === 'orbit' &&
            (rivalPresentation.phase === 'idle' ||
              rivalPresentation.phase === 'contested')
          }
          onArm={handleArmFirstStrike}
          onOpenConfirmation={handleOpenStrikeConfirmation}
          onCancel={handleCancelStrike}
          onFire={handleFireFirstStrike}
          onExploreScar={handleExploreScar}
          onReturnToOrbit={handleReturnFromScar}
          onReplayStrike={handleReplayStrike}
        />
      ) : null}
      <CounterstrikeHud
        snapshot={counterstrike}
        run={counterstrikeRun}
        rival={rival}
        showReady={
          state.phase === 'orbit' &&
          firstStrikePresentation.phase === 'idle'
        }
        onBegin={handleBeginCounterstrike}
        onFire={handleFireInterceptor}
        onReplay={handleReplayCounterstrike}
        onAcceptPreview={handleAcceptCounterstrikePreview}
        onKeepAccepted={handleKeepAcceptedCounterstrike}
      />
      {entryOpen ? (
        <LaunchGate
          continuing={
            outpost !== null ||
            rival !== null ||
            firstStrike !== null ||
            counterstrike !== null
          }
          soundAvailable={audio.available}
          soundEnabled={audio.enabled}
          onBegin={handleBeginExperience}
          onToggleSound={audio.toggle}
        />
      ) : null}
    </main>
  )
}

function phaseIsAwayFromSurface(phase: string): boolean {
  return phase === 'orbit' || phase === 'selected' || phase === 'returning'
}

export default App
