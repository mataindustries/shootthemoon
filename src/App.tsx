import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
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

function WebGLFallback() {
  return (
    <p className="webgl-fallback" role="alert">
      Moon Core requires a browser with WebGL 2 enabled.
    </p>
  )
}

function App() {
  const [state, dispatch] = useReducer(
    moonCoreReducer,
    INITIAL_MOON_CORE_STATE,
  )
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

  const handleSelect = useCallback((landingSite: LandingSite) => {
    dispatch({ type: 'select', landingSite })
  }, [])

  const handleLandingComplete = useCallback(() => {
    dispatch({ type: 'landingComplete' })
  }, [])

  const handleReady = useCallback(() => {
    setSceneReady(true)
  }, [])

  const handleReturnComplete = useCallback(() => {
    dispatch({ type: 'returnComplete' })
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
          quality={quality}
          onLandingComplete={handleLandingComplete}
          onReady={handleReady}
          onReturnComplete={handleReturnComplete}
          onSelect={handleSelect}
        />
      </Canvas>
      <CinematicHud
        phase={state.phase}
        site={state.landingSite}
        onClaim={() => dispatch({ type: 'claim' })}
        onClear={() => dispatch({ type: 'clearSite' })}
        onReturn={() => dispatch({ type: 'returnToOrbit' })}
      />
    </main>
  )
}

export default App
