import { Suspense, useMemo } from 'react'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { isRobotTransient } from '../simulation/outpostSimulation.ts'
import type { QualitySettings } from '../render/quality.ts'
import { useDemandAnimation } from '../render/useDemandAnimation.ts'
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
import { createSurfaceTerrainProfile } from '../render/surfaceTerrain.ts'
import { SurfaceDressing } from './SurfaceDressing.tsx'
import { MineralDeposits } from './MineralDeposits.tsx'
import { MinerRobot } from './MinerRobot.tsx'
import { Extractor } from './Extractor.tsx'
import { OutpostSignal } from './OutpostSignal.tsx'

const CLEAR_COLOR = '#020308'

interface SceneRootProps {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
  readonly outpost: OutpostSnapshot | null
  readonly selectedDepositId: string | null
  readonly quality: QualitySettings
  readonly onSelect: (site: LandingSite) => void
  readonly onLandingComplete: () => void
  readonly onReturnComplete: () => void
  readonly onReady: () => void
  readonly onSelectDeposit: (depositId: string) => void
  readonly onFocusOutpost: () => void
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
  outpost,
  selectedDepositId,
  quality,
  onSelect,
  onLandingComplete,
  onReturnComplete,
  onReady,
  onSelectDeposit,
  onFocusOutpost,
}: SceneRootProps) {
  const showLandingScene =
    landingSite !== null &&
    (phase === 'approach' || phase === 'landed' || phase === 'returning')
  const terrain = useMemo(
    () =>
      landingSite === null ? null : createSurfaceTerrainProfile(landingSite),
    [landingSite],
  )
  const outpostAnimationActive =
    phase === 'landed' &&
    outpost !== null &&
    (isRobotTransient(outpost.robot.state) ||
      outpost.extractor?.status === 'constructing')
  useDemandAnimation(outpostAnimationActive)

  return (
    <CinematicClockProvider
      phase={phase}
      onLandingComplete={onLandingComplete}
      onReturnComplete={onReturnComplete}
    >
      <color attach="background" args={[CLEAR_COLOR]} />
      <CameraRig
        phase={phase}
        landingSite={landingSite}
        orbitalFocusSite={outpost?.site ?? null}
        outpost={outpost}
        terrain={terrain}
      />
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
          selectionEnabled={outpost === null}
          onReady={onReady}
          onSelect={onSelect}
        />
      </Suspense>

      {landingSite !== null && phase === 'selected' && outpost === null ? (
        <LandingMarker site={landingSite} />
      ) : null}

      {outpost !== null && (phase === 'orbit' || phase === 'selected') ? (
        <OutpostSignal
          outpost={outpost}
          focused={phase === 'selected'}
          onFocus={onFocusOutpost}
        />
      ) : null}

      {showLandingScene && terrain !== null ? (
        <>
          <SurfacePatch
            site={landingSite}
            phase={phase}
            segments={quality.patchSegments}
            terrain={terrain}
          />
          <SurfaceDressing
            site={landingSite}
            terrain={terrain}
            rockCount={quality.surfaceRockCount}
          />
          <InvasionCapsule
            site={landingSite}
            phase={phase}
            outpost={outpost}
          />
          {outpost === null ? (
            <ImpactEffects site={landingSite} phase={phase} />
          ) : null}
          {outpost !== null ? (
            <>
              <MineralDeposits
                outpost={outpost}
                terrain={terrain}
                selectedDepositId={selectedDepositId}
                interactive={phase === 'landed'}
                onSelect={onSelectDeposit}
              />
              <MinerRobot outpost={outpost} terrain={terrain} />
              <Extractor outpost={outpost} terrain={terrain} />
            </>
          ) : null}
        </>
      ) : null}

      <SceneMetrics />
    </CinematicClockProvider>
  )
}
