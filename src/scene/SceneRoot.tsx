import { Suspense, useMemo } from 'react'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { OutpostSnapshot } from '../domain/outpost.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import { isRobotTransient } from '../simulation/outpostSimulation.ts'
import type { QualitySettings } from '../render/quality.ts'
import {
  useDemandAnimation,
  useLowFrequencyDemandAnimation,
} from '../render/useDemandAnimation.ts'
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
import {
  rivalPresentationNeedsContinuousFrames,
  rivalPresentationShowsFoothold,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { RivalSignal } from './RivalSignal.tsx'
import { RivalFoothold } from './RivalFoothold.tsx'
import { RivalRevealEffects } from './RivalRevealEffects.tsx'
import { RivalScanSweep } from './RivalScanSweep.tsx'
import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import {
  firstStrikeNeedsContinuousFrames,
  firstStrikeShowsImpactEffects,
  firstStrikeShowsWarhead,
  type FirstStrikePresentationState,
} from '../app/firstStrikePresentation.ts'
import { LunarWarheadSystem } from './LunarWarheadSystem.tsx'
import { StrikeWarhead } from './StrikeWarhead.tsx'
import { LunarImpactEffects } from './LunarImpactEffects.tsx'
import { PermanentLunarScar } from './PermanentLunarScar.tsx'

const CLEAR_COLOR = '#020308'

interface SceneRootProps {
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
  readonly outpost: OutpostSnapshot | null
  readonly rival: RivalSignalSnapshot | null
  readonly rivalPresentation: RivalPresentationState
  readonly firstStrike: FirstStrikeSnapshot | null
  readonly firstStrikePresentation: FirstStrikePresentationState
  readonly selectedDepositId: string | null
  readonly quality: QualitySettings
  readonly onSelect: (site: LandingSite) => void
  readonly onLandingComplete: () => void
  readonly onReturnComplete: () => void
  readonly onReady: () => void
  readonly onSelectDeposit: (depositId: string) => void
  readonly onFocusOutpost: () => void
  readonly onFocusRival: () => void
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
  rival,
  rivalPresentation,
  firstStrike,
  firstStrikePresentation,
  selectedDepositId,
  quality,
  onSelect,
  onLandingComplete,
  onReturnComplete,
  onReady,
  onSelectDeposit,
  onFocusOutpost,
  onFocusRival,
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
  const rivalAnimationActive = rivalPresentationNeedsContinuousFrames(
    rivalPresentation.phase,
  )
  const strikeAnimationActive = firstStrikeNeedsContinuousFrames(
    firstStrikePresentation.phase,
  )
  const strikeCinematic = firstStrikePresentation.phase !== 'idle'
  const completedScarOrbit =
    firstStrike?.status === 'COMPLETE' &&
    firstStrike.scar !== null &&
    firstStrikePresentation.phase === 'idle' &&
    (phase === 'orbit' || phase === 'selected')
  const strikeAtPlayer =
    firstStrikePresentation.phase === 'arming' ||
    firstStrikePresentation.phase === 'launch'
  const rivalFocused =
    rivalPresentation.phase === 'capsule-approach' ||
    rivalPresentation.phase === 'impact' ||
    rivalPresentation.phase === 'intro-transmission' ||
    rivalPresentation.phase === 'rival-focus' ||
    rivalPresentation.phase === 'rival-focused' ||
    rivalPresentation.phase === 'scanning' ||
    rivalPresentation.phase === 'scan-response'
  const rivalCloseFocus =
    rivalPresentation.phase === 'impact' ||
    rivalPresentation.phase === 'intro-transmission' ||
    rivalPresentation.phase === 'rival-focus' ||
    rivalPresentation.phase === 'rival-focused' ||
    rivalPresentation.phase === 'scanning' ||
    rivalPresentation.phase === 'scan-response'
  const rivalFootholdVisible =
    rival !== null &&
    (phase === 'orbit' ||
      phase === 'selected' ||
      phase === 'returning' ||
      rivalFocused) &&
    (rival.stage !== null ||
      rivalPresentationShowsFoothold(rivalPresentation.phase))
  const rivalSignalVisible =
    rival !== null &&
    !firstStrike?.rivalFootholdDamaged &&
    !rivalCloseFocus &&
    (phase === 'orbit' || phase === 'selected') &&
    (rival.stage !== null ||
      rivalPresentation.phase === 'dual-sites')
  const revealEffectsVisible =
    rival !== null &&
    outpost !== null &&
    (rivalPresentation.phase === 'warning' ||
      rivalPresentation.phase === 'orbital-transition' ||
      rivalPresentation.phase === 'capsule-approach' ||
      rivalPresentation.phase === 'impact' ||
      rivalPresentation.phase === 'intro-transmission')
  const cinematicReadability =
    strikeCinematic ||
    completedScarOrbit ||
    rivalPresentation.phase === 'orbital-transition' ||
    rivalPresentation.phase === 'capsule-approach' ||
    rivalPresentation.phase === 'impact' ||
    rivalPresentation.phase === 'intro-transmission' ||
    rivalPresentation.phase === 'dual-sites' ||
    rivalPresentation.phase === 'rival-focus' ||
    rivalPresentation.phase === 'scanning' ||
    rivalPresentation.phase === 'scan-response' ||
    rivalPresentation.phase === 'contested'
  const followCameraForReadability =
    completedScarOrbit ||
    firstStrikePresentation.phase === 'orbital-flight' ||
    firstStrikePresentation.phase === 'vesper-transmission' ||
    firstStrikePresentation.phase === 'orbital-pullback' ||
    rivalPresentation.phase === 'orbital-transition' ||
    rivalPresentation.phase === 'dual-sites' ||
    rivalPresentation.phase === 'contested'
  const orbitalSignalHeartbeat =
    outpost !== null &&
    (phase === 'orbit' || phase === 'selected') &&
    !rivalAnimationActive &&
    !strikeAnimationActive &&
    !firstStrike?.rivalFootholdDamaged
  useDemandAnimation(
    outpostAnimationActive || rivalAnimationActive || strikeAnimationActive,
  )
  useLowFrequencyDemandAnimation(orbitalSignalHeartbeat)

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
        orbitalFocusSite={
          firstStrike?.status === 'COMPLETE' && firstStrike.scar !== null
            ? firstStrike.scar.site
            : outpost?.site ?? null
        }
        outpost={outpost}
        terrain={terrain}
        rivalSite={rival?.site ?? null}
        dualOrbitPreferred={rival?.stage !== null}
        rivalPresentation={rivalPresentation}
        firstStrikePresentation={firstStrikePresentation}
      />
      <LightingRig
        phase={phase}
        landingSite={landingSite}
        strategicFocusSite={
          strikeCinematic
            ? strikeAtPlayer
              ? outpost?.site ?? null
              : rival?.site ?? null
            : rivalFocused
              ? rival?.site ?? null
              : completedScarOrbit
                ? firstStrike?.scar?.site ?? null
                : null
        }
        cinematicReadability={cinematicReadability}
        followCameraForReadability={followCameraForReadability}
        enableSurfaceShadows={quality.tier !== 'low' && !completedScarOrbit}
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

      {rivalSignalVisible && rival !== null ? (
        <RivalSignal
          rival={rival}
          presentation={rivalPresentation}
          focused={rivalFocused}
          interactive={
            phase === 'orbit' && rivalPresentation.phase === 'idle'
          }
          onFocus={onFocusRival}
        />
      ) : null}

      {rivalFootholdVisible && rival !== null ? (
        <RivalFoothold
          rival={rival}
          presentation={rivalPresentation}
          focused={rivalFocused}
          damaged={firstStrike?.rivalFootholdDamaged ?? false}
        />
      ) : null}

      {firstStrike?.scar !== null &&
      firstStrike?.scar !== undefined &&
      (phase === 'orbit' ||
        phase === 'selected' ||
        firstStrikePresentation.phase !== 'idle') ? (
        <PermanentLunarScar
          scar={firstStrike.scar}
          focused={
            firstStrikePresentation.phase === 'impact-flash' ||
            firstStrikePresentation.phase === 'ejecta' ||
            firstStrikePresentation.phase === 'crater-reveal'
          }
        />
      ) : null}

      {firstStrike !== null &&
      outpost !== null &&
      firstStrike.available &&
      firstStrike.status !== 'READY' &&
      !firstStrike.impactCompleted &&
      (phase === 'orbit' || firstStrikePresentation.phase !== 'idle') ? (
        <LunarWarheadSystem
          playerSite={outpost.site}
          strike={firstStrike}
          presentation={firstStrikePresentation}
        />
      ) : null}

      {outpost !== null &&
      rival !== null &&
      firstStrikeShowsWarhead(firstStrikePresentation.phase) ? (
        <StrikeWarhead
          playerSite={outpost.site}
          rivalSite={rival.site}
          presentation={firstStrikePresentation}
        />
      ) : null}

      {rival !== null &&
      firstStrikeShowsImpactEffects(firstStrikePresentation.phase) ? (
        <LunarImpactEffects
          rivalSite={rival.site}
          presentation={firstStrikePresentation}
        />
      ) : null}

      {revealEffectsVisible && rival !== null && outpost !== null ? (
        <RivalRevealEffects
          playerSite={outpost.site}
          rival={rival}
          presentation={rivalPresentation}
        />
      ) : null}

      {rival !== null && rivalPresentation.phase === 'scanning' ? (
        <RivalScanSweep
          rival={rival}
          presentation={rivalPresentation}
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
              <Extractor
                outpost={outpost}
                terrain={terrain}
                signalInterrupted={rivalPresentation.phase === 'warning'}
              />
            </>
          ) : null}
        </>
      ) : null}

      <SceneMetrics />
    </CinematicClockProvider>
  )
}
