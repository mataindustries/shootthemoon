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
import type { OutpostSnapshot } from './domain/outpost.ts'
import {
  isRobotTransient,
  outpostReducer,
} from './simulation/outpostSimulation.ts'
import {
  loadOutpostSave,
  resetPrototypeSave,
  writeOutpostSave,
} from './persistence/outpostSave.ts'
import { setSimulationTimePaused } from './simulation/simulationTime.ts'

function WebGLFallback() {
  return (
    <p className="webgl-fallback" role="alert">
      Moon Core requires a browser with WebGL 2 enabled.
    </p>
  )
}

function App() {
  const [restoredOutpost] = useState<OutpostSnapshot | null>(() =>
    loadOutpostSave(window.localStorage),
  )
  const [state, dispatch] = useReducer(
    moonCoreReducer,
    restoredOutpost === null
      ? INITIAL_MOON_CORE_STATE
      : { phase: 'landed', landingSite: restoredOutpost.site },
  )
  const [outpost, dispatchOutpost] = useReducer(
    outpostReducer,
    restoredOutpost,
  )
  const [selectedDepositId, setSelectedDepositId] = useState<string | null>(
    null,
  )
  const saveEnabledRef = useRef(true)
  const simulationPausedRef = useRef(false)
  const [sceneReady, setSceneReady] = useState(false)
  const quality = useMemo(() => detectQualitySettings(), [])
  const [dpr, setDpr] = useState(() =>
    calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
  )

  useEffect(() => {
    const updateDpr = () =>
      setDpr(
        calculateDpr(window.innerWidth, window.innerHeight, quality.maxDpr),
      )

    window.addEventListener('resize', updateDpr)
    return () => window.removeEventListener('resize', updateDpr)
  }, [quality.maxDpr])

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

    window.addEventListener('first-outpost:set-simulation-paused', setPaused)
    return () =>
      window.removeEventListener('first-outpost:set-simulation-paused', setPaused)
  }, [])

  useEffect(() => {
    if (outpost !== null && saveEnabledRef.current) {
      writeOutpostSave(window.localStorage, outpost)
    }
  }, [outpost])

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
      if (!simulationPausedRef.current) {
        dispatchOutpost({ type: 'tick', nowMs: Date.now() })
      }
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [outpost, state.phase])

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
    if (outpost !== null && state.phase === 'orbit') {
      dispatch({ type: 'revisit', landingSite: outpost.site })
    }
  }, [outpost, state.phase])

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

  const handleResetPrototype = useCallback(() => {
    const confirmed = window.confirm(
      'Reset the First Outpost prototype? This erases the local outpost save.',
    )

    if (!confirmed) {
      return
    }

    saveEnabledRef.current = false
    resetPrototypeSave(window.localStorage)
    setSelectedDepositId(null)
    dispatchOutpost({ type: 'reset' })
    dispatch({ type: 'resetPrototype' })
  }, [])

  const handleCreated = useCallback(({ gl }: { gl: WebGLRenderer }) => {
    gl.toneMappingExposure = 1.08
    gl.domElement.dataset.renderer = 'webgl2'
  }, [])

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
          selectedDepositId={selectedDepositId}
          quality={quality}
          onLandingComplete={handleLandingComplete}
          onReady={handleReady}
          onReturnComplete={handleReturnComplete}
          onSelect={handleSelect}
          onSelectDeposit={setSelectedDepositId}
          onFocusOutpost={handleFocusOutpost}
        />
      </Canvas>
      <CinematicHud
        phase={state.phase}
        site={state.landingSite}
        outpost={outpost}
        selectedDepositId={selectedDepositId}
        targetingOutpost={outpost !== null && state.phase === 'selected'}
        onClaim={() => dispatch({ type: 'claim' })}
        onClear={() => dispatch({ type: 'clearSite' })}
        onReturn={() => dispatch({ type: 'returnToOrbit' })}
        onDeploy={handleDeploy}
        onMine={handleMine}
        onConstruct={handleConstruct}
        onResetPrototype={handleResetPrototype}
      />
    </main>
  )
}

function phaseIsAwayFromSurface(phase: string): boolean {
  return phase === 'orbit' || phase === 'selected' || phase === 'returning'
}

export default App
