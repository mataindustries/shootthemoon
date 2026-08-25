import { Canvas } from '@react-three/fiber'
import { SceneRoot } from './scene/SceneRoot.tsx'

function WebGLFallback() {
  return (
    <p className="webgl-fallback" role="alert">
      Moon Core requires a browser with WebGL 2 enabled.
    </p>
  )
}

function App() {
  return (
    <main className="app-shell" aria-label="Shoot the Moon technical prototype">
      <Canvas
        aria-label="Moon Core 3D viewport"
        camera={{
          far: 1_000,
          fov: 45,
          near: 0.1,
          position: [0, 0, 5],
        }}
        dpr={[1, 1.5]}
        fallback={<WebGLFallback />}
        frameloop="demand"
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
      >
        <SceneRoot />
      </Canvas>
    </main>
  )
}

export default App

