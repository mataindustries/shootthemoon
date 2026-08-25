import { Suspense } from 'react'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import type { QualitySettings } from '../render/quality.ts'
import { CinematicClockProvider } from '../camera/CinematicClock.tsx'
import { CameraRig } from '../camera/CameraRig.tsx'
import { SceneMetrics } from '../instrumentation/SceneMetrics.tsx'
import { Starfield } from './Starfield.tsx'
import { Moon } from './Moon.tsx'
import { LightingRig } from './LightingRig.tsx'
import { LandingMarker } from './LandingMarker.tsx'
import { SurfacePatch } from './SurfacePatch.tsx'
import { InvasionCapsule } from './InvasionCapsule.tsx'
import { ImpactEffects } from './ImpactEffects.tsx'

const CLEAR_COLOR = '#020308'

interface SceneRootProps {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
  readonly quality: QualitySettings
  readonly onSelect: (site: LandingSite) => void
  readonly onLandingComplete: () => void
  readonly onReturnComplete: () => void
  readonly onReady: () => void
}

function MoonFallback() {
  return (
    <mesh>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial color="#6f7378" roughness={1} />
    </mesh>
  )
}

export function SceneRoot({
  phase,
  landingSite,
  quality,
  onSelect,
  onLandingComplete,
  onReturnComplete,
  onReady,
}: SceneRootProps) {
  const showLandingScene =
    landingSite !== null &&
    (phase === 'approach' || phase === 'landed' || phase === 'returning')

  return (
    <CinematicClockProvider
      phase={phase}
      onLandingComplete={onLandingComplete}
      onReturnComplete={onReturnComplete}
    >
      <color attach="background" args={[CLEAR_COLOR]} />
      <CameraRig phase={phase} landingSite={landingSite} />
      <LightingRig
        phase={phase}
        landingSite={landingSite}
        enableSurfaceShadows={quality.tier !== 'low'}
      />
      <Starfield count={quality.starCount} />

      <Suspense fallback={<MoonFallback />}>
        <Moon
          widthSegments={quality.moonWidthSegments}
          heightSegments={quality.moonHeightSegments}
          phase={phase}
          onReady={onReady}
          onSelect={onSelect}
        />
      </Suspense>

      {landingSite !== null && phase === 'selected' ? (
        <LandingMarker site={landingSite} />
      ) : null}

      {showLandingScene ? (
        <>
          <SurfacePatch
            site={landingSite}
            phase={phase}
            segments={quality.patchSegments}
          />
          <InvasionCapsule site={landingSite} phase={phase} />
          <ImpactEffects site={landingSite} phase={phase} />
        </>
      ) : null}

      <SceneMetrics />
    </CinematicClockProvider>
  )
}
