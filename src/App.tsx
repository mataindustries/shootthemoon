import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { Canvas } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'
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

function WebGLFallback() {
  return (
    <p className="webgl-fallback" role="alert">
      Moon Core requires a browser with WebGL 2 enabled.
    </p>
  )
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
  'ending',
]

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

function App() {
  const [restoredPrototype] = useState(() =>
    loadPrototypeSave(window.localStorage),
  )
  const restoredOutpost = restoredPrototype?.outpost ?? null
  const restoredFirstStrike = restoredPrototype?.firstStrike ?? null
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
  const [rivalPresentation, setRivalPresentation] =
    useState<RivalPresentationState>(() => createRivalPresentation())
  const [firstStrikePresentation, setFirstStrikePresentation] =
    useState<FirstStrikePresentationState>(() =>
      createFirstStrikePresentation(),
    )
  const [strikeConfirmationOpen, setStrikeConfirmationOpen] = useState(false)
  const [previewRivalStage, setPreviewRivalStage] =
    useState<RivalStage | null>(null)
  const [selectedDepositId, setSelectedDepositId] = useState<string | null>(
    null,
  )
  const saveEnabledRef = useRef(true)
  const restoredSessionRef = useRef(restoredPrototype !== null)
  const advanceRivalPresentationRef = useRef<() => void>(() => undefined)
  const advanceFirstStrikePresentationRef = useRef<() => void>(() => undefined)
  const firstStrikeManualControlRef = useRef(false)
  const simulationPausedRef = useRef(false)
  const transitionsPausedRef = useRef(false)
  const rivalHiddenAtRef = useRef<number | null>(null)
  const [rivalClockRunning, setRivalClockRunning] = useState(
    () => document.visibilityState !== 'hidden',
  )
  const [sceneReady, setSceneReady] = useState(false)
  const quality = useMemo(() => detectQualitySettings(), [])
  const [dpr, setDpr] = useState(() =>
    calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
  )
  const continuousRendering =
    state.phase === 'approach' ||
    state.phase === 'returning' ||
    (outpost !== null &&
      (isRobotTransient(outpost.robot.state) ||
        outpost.extractor?.status === 'constructing')) ||
    rivalPresentationNeedsContinuousFrames(rivalPresentation.phase)
    || firstStrikeNeedsContinuousFrames(firstStrikePresentation.phase)

  useEffect(() => {
    const updateDpr = () =>
      setDpr(
        calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
      )

    window.addEventListener('resize', updateDpr)
    return () => window.removeEventListener('resize', updateDpr)
  }, [quality.maxDpr])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        rivalHiddenAtRef.current = performance.now()
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
          current.phase === 'ending' ||
          current.progressOverride !== null
            ? current
            : {
                ...current,
                startedAtMs: current.startedAtMs + hiddenDurationMs,
              },
        )
      }

      setRivalClockRunning(true)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('e2e')) {
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
        }>
      ).detail

      if (!isFirstStrikePresentationPhase(detail.phase)) {
        return
      }

      firstStrikeManualControlRef.current = true
      setFirstStrikePresentation(
        createFirstStrikePresentation(
          detail.phase,
          performance.now(),
          typeof detail.progress === 'number' ? detail.progress : null,
        ),
      )
    }
    const advanceFirstStrikePresentationForTest = () => {
      advanceFirstStrikePresentationRef.current()
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
    }
  }, [])

  useEffect(() => {
    if (
      outpost !== null &&
      rival !== null &&
      firstStrike !== null &&
      saveEnabledRef.current
    ) {
      writePrototypeSave(window.localStorage, { outpost, rival, firstStrike })
    }
  }, [firstStrike, outpost, rival])

  useEffect(() => {
    if (phaseIsAwayFromSurface(state.phase)) {
      setSelectedDepositId(null)
    }
  }, [state.phase])

  useEffect(() => {
    if (state.phase !== 'landed' || outpost === null) {
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
  }, [outpost, state.phase])

  const beginRivalReveal = useCallback(() => {
    if (
      rival === null ||
      rival.revealStatus !== 'QUEUED' ||
      rivalPresentation.phase !== 'idle'
    ) {
      return
    }

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
      rival?.revealStatus === 'AWAITING_SAFE_MOMENT' &&
      state.phase === 'orbit'
    ) {
      dispatchRival({ type: 'safeMomentReached', nowMs: Date.now() })
    }
  }, [rival?.revealStatus, state.phase])

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
    const attemptReveal = () => {
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
      !rivalClockRunning ||
      durationMs === null ||
      rivalPresentation.progressOverride !== null
    ) {
      return
    }

    const elapsedMs = performance.now() - rivalPresentation.startedAtMs
    const timer = window.setTimeout(() => {
      // The visibility state changes synchronously, while React may defer this
      // effect's cleanup under load. Never let an already-queued phase timer
      // consume a cinematic while the page is hidden.
      if (document.visibilityState !== 'hidden') {
        advanceRivalPresentation()
      }
    }, Math.max(0, durationMs - elapsedMs))
    return () => window.clearTimeout(timer)
  }, [advanceRivalPresentation, rivalClockRunning, rivalPresentation])

  const advanceFirstStrikePresentation = useCallback(() => {
    const currentPhase = firstStrikePresentation.phase
    const nextPhase = getNextAutomaticFirstStrikePhase(currentPhase)

    if (nextPhase === null) {
      return
    }

    const nowMs = Date.now()

    if (currentPhase === 'launch') {
      dispatchFirstStrike({ type: 'completeLaunch', nowMs })
    }

    if (currentPhase === 'vesper-transmission') {
      dispatchFirstStrike({ type: 'completeFinalTransmission', nowMs })
    }

    if (currentPhase === 'impact-flash' && rival !== null) {
      dispatchFirstStrike({
        type: 'completeImpact',
        rivalSite: rival.site,
        nowMs,
      })
    }

    if (currentPhase === 'orbital-pullback') {
      dispatchFirstStrike({ type: 'completeEnding', nowMs })
    }

    setFirstStrikePresentation(
      createFirstStrikePresentation(nextPhase, performance.now()),
    )
  }, [firstStrikePresentation.phase, rival])

  useEffect(() => {
    advanceFirstStrikePresentationRef.current =
      advanceFirstStrikePresentation
  }, [advanceFirstStrikePresentation])

  useEffect(() => {
    const durationMs = getFirstStrikePresentationDurationMs(
      firstStrikePresentation.phase,
    )

    if (
      !rivalClockRunning ||
      firstStrikeManualControlRef.current ||
      durationMs === null ||
      firstStrikePresentation.progressOverride !== null
    ) {
      return
    }

    const elapsedMs = performance.now() - firstStrikePresentation.startedAtMs
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        advanceFirstStrikePresentation()
      }
    }, Math.max(0, durationMs - elapsedMs))

    return () => window.clearTimeout(timer)
  }, [
    advanceFirstStrikePresentation,
    firstStrikePresentation,
    rivalClockRunning,
  ])

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

    setRivalPresentation(createRivalPresentation('scanning'))
  }, [rival, rivalPresentation.phase])

  const handleReturnFromRival = useCallback(() => {
    const phase = rival?.scanCompleted ? 'contested' : 'dual-sites'
    setRivalPresentation(createRivalPresentation(phase))
  }, [rival?.scanCompleted])

  const handleReplayRival = useCallback(() => {
    if (rival?.replayEligible) {
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

    setRivalPresentation(createRivalPresentation())
  }, [rival?.skipEligible, rivalPresentation.replay])

  const handleDeploy = useCallback(() => {
    dispatchOutpost({ type: 'deploy', nowMs: Date.now() })
  }, [])

  const handleMine = useCallback(() => {
    if (selectedDepositId !== null) {
      dispatchOutpost({
        type: 'mine',
        depositId: selectedDepositId,
        nowMs: Date.now(),
      })
    }
  }, [selectedDepositId])

  const handleConstruct = useCallback(() => {
    if (selectedDepositId !== null) {
      dispatchOutpost({
        type: 'constructExtractor',
        depositId: selectedDepositId,
        nowMs: Date.now(),
      })
    }
  }, [selectedDepositId])

  const handleArmFirstStrike = useCallback(() => {
    if (firstStrike?.status !== 'READY') {
      return
    }

    dispatchFirstStrike({ type: 'arm', nowMs: Date.now() })
    setStrikeConfirmationOpen(true)
  }, [firstStrike?.status])

  const handleOpenStrikeConfirmation = useCallback(() => {
    if (firstStrike?.status === 'ARMED') {
      setStrikeConfirmationOpen(true)
    }
  }, [firstStrike?.status])

  const handleCancelStrike = useCallback(() => {
    setStrikeConfirmationOpen(false)
    dispatchFirstStrike({ type: 'cancelLaunchConfirmation' })
  }, [])

  const handleFireFirstStrike = useCallback(() => {
    if (
      firstStrike?.status !== 'ARMED' ||
      outpost === null ||
      rival === null
    ) {
      return
    }

    setStrikeConfirmationOpen(false)
    setSelectedDepositId(null)
    setRivalPresentation(createRivalPresentation())
    dispatchFirstStrike({ type: 'fire', nowMs: Date.now() })
    setFirstStrikePresentation(createFirstStrikePresentation('arming'))

    if (state.phase !== 'orbit') {
      dispatch({ type: 'returnToOrbit' })
    }
  }, [firstStrike?.status, outpost, rival, state.phase])

  const handleExploreScar = useCallback(() => {
    setFirstStrikePresentation(createFirstStrikePresentation())
  }, [])

  const handleResetPrototype = useCallback(() => {
    const confirmed = window.confirm(
      'Reset the Shoot the Moon prototype? This erases the complete local run.',
    )

    if (!confirmed) {
      return
    }

    saveEnabledRef.current = false
    restoredSessionRef.current = false
    firstStrikeManualControlRef.current = false
    resetPrototypeSave(window.localStorage)
    setSelectedDepositId(null)
    setPreviewRivalStage(null)
    setRivalPresentation(createRivalPresentation())
    setFirstStrikePresentation(createFirstStrikePresentation())
    setStrikeConfirmationOpen(false)
    dispatchOutpost({ type: 'reset' })
    dispatchRival({ type: 'reset' })
    dispatchFirstStrike({ type: 'reset' })
    dispatch({ type: 'resetPrototype' })
  }, [])

  const handleCreated = useCallback(({ gl }: { gl: WebGLRenderer }) => {
    gl.toneMappingExposure = 1.08
    gl.domElement.dataset.renderer = 'webgl2'
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
        <SceneRoot
          phase={state.phase}
          landingSite={state.landingSite}
          outpost={outpost}
          rival={renderedRival}
          rivalPresentation={rivalPresentation}
          firstStrike={firstStrike}
          firstStrikePresentation={firstStrikePresentation}
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
        onClaim={() => dispatch({ type: 'claim' })}
        onClear={() => dispatch({ type: 'clearSite' })}
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
          firstStrikePresentation.phase === 'idle'
        }
        onAdvance={advanceRivalPresentation}
        onReturnToOrbit={handleReturnFromRival}
        onScan={handleScanRival}
        onReplay={handleReplayRival}
        onSkip={handleSkipRival}
        firstStrikeAvailable={firstStrike?.available ?? false}
        rivalDamaged={firstStrike?.rivalFootholdDamaged ?? false}
      />
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
        onPlayAgain={handleResetPrototype}
      />
    </main>
  )
}

function phaseIsAwayFromSurface(phase: string): boolean {
  return phase === 'orbit' || phase === 'selected' || phase === 'returning'
}

export default App
