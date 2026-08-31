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
import { VISUAL_PALETTE } from '../render/visualSystem.ts'
import { sampleRenderedSurface } from '../render/renderedSurface.ts'

const CLEAR_COLOR = VISUAL_PALETTE.space

interface SceneRootProps {
  readonly active: boolean
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
  active,
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
  const rivalTerrain = useMemo(
    () =>
      rival === null ? null : createSurfaceTerrainProfile(rival.site),
    [rival],
  )
  const scarTerrain = useMemo(
    () =>
      firstStrike?.scar === null || firstStrike?.scar === undefined
        ? null
        : createSurfaceTerrainProfile(firstStrike.scar.site),
    [firstStrike?.scar],
  )
  const rivalTerrainSegments = Math.min(quality.patchSegments, 32)
  const playerSurfaceHeight =
    terrain === null
      ? undefined
      : sampleRenderedSurface(terrain, quality.patchSegments, 0, 0).y
  const rivalSurfaceHeight =
    rivalTerrain === null
      ? undefined
      : sampleRenderedSurface(rivalTerrain, rivalTerrainSegments, 0, 0).y
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
  const strikePresentationActive = firstStrikePresentation.phase !== 'idle'
  const replayBeforeDamage =
    firstStrikePresentation.replay &&
    (firstStrikePresentation.phase === 'arming' ||
      firstStrikePresentation.phase === 'launch' ||
      firstStrikePresentation.phase === 'orbital-flight' ||
      firstStrikePresentation.phase === 'vesper-transmission' ||
      firstStrikePresentation.phase === 'target-approach' ||
      firstStrikePresentation.phase === 'impact-flash')
  const rivalDamagedForPresentation =
    (firstStrike?.rivalFootholdDamaged ?? false) && !replayBeforeDamage
  const scarVisibleForPresentation =
    !firstStrikePresentation.replay ||
    firstStrikePresentation.phase === 'ejecta' ||
    firstStrikePresentation.phase === 'crater-reveal' ||
    firstStrikePresentation.phase === 'orbital-pullback' ||
    firstStrikePresentation.phase === 'scar-explore' ||
    firstStrikePresentation.phase === 'ending'
  const scarReplacesRivalSurface =
    firstStrike?.scar !== null &&
    firstStrike?.scar !== undefined &&
    scarVisibleForPresentation
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
    !rivalDamagedForPresentation &&
    !strikePresentationActive &&
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
    strikePresentationActive ||
    completedScarOrbit ||
    rivalPresentation.phase === 'orbital-transition' ||
    rivalPresentation.phase === 'capsule-approach' ||
    rivalPresentation.phase === 'impact' ||
    rivalPresentation.phase === 'intro-transmission' ||
    rivalPresentation.phase === 'dual-sites' ||
    rivalPresentation.phase === 'rival-focus' ||
    rivalPresentation.phase === 'rival-focused' ||
    rivalPresentation.phase === 'scanning' ||
    rivalPresentation.phase === 'scan-response' ||
    rivalPresentation.phase === 'contested'
  const rivalSurfaceContextVisible =
    rivalTerrain !== null &&
    !scarReplacesRivalSurface &&
    (rivalCloseFocus ||
      firstStrikePresentation.phase === 'target-approach' ||
      firstStrikePresentation.phase === 'impact-flash' ||
      firstStrikePresentation.phase === 'ejecta' ||
      firstStrikePresentation.phase === 'crater-reveal' ||
      firstStrikePresentation.phase === 'scar-explore')
  const playerStrikeSurfaceVisible =
    landingSite !== null &&
    terrain !== null &&
    strikeAtPlayer &&
    !showLandingScene
  const orbitalSignalHeartbeat =
    outpost !== null &&
    (phase === 'orbit' || phase === 'selected') &&
    !rivalAnimationActive &&
    !strikeAnimationActive &&
    !rivalDamagedForPresentation
  const closeViewShadows =
    showLandingScene ||
    rivalCloseFocus ||
    firstStrikePresentation.phase === 'arming' ||
    firstStrikePresentation.phase === 'launch' ||
    firstStrikePresentation.phase === 'target-approach' ||
    firstStrikePresentation.phase === 'impact-flash' ||
    firstStrikePresentation.phase === 'ejecta' ||
    firstStrikePresentation.phase === 'crater-reveal' ||
    firstStrikePresentation.phase === 'scar-explore'
  useDemandAnimation(
    active &&
      (outpostAnimationActive || rivalAnimationActive || strikeAnimationActive),
  )
  useLowFrequencyDemandAnimation(active && orbitalSignalHeartbeat)

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
          strikePresentationActive
            ? outpost?.site ?? null
            : firstStrike?.status === 'COMPLETE' && firstStrike.scar !== null
            ? firstStrike.scar.site
            : outpost?.site ?? null
        }
        outpost={outpost}
        terrain={terrain}
        terrainSegments={quality.patchSegments}
        rivalSite={rival?.site ?? null}
        dualOrbitPreferred={rival?.stage !== null}
        rivalPresentation={rivalPresentation}
        firstStrikePresentation={firstStrikePresentation}
      />
      <LightingRig
        landingSite={landingSite}
        strategicFocusSite={
          strikePresentationActive
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
        enableSurfaceShadows={quality.tier !== 'low'}
        closeViewShadows={closeViewShadows && !completedScarOrbit}
        firstStrikePresentation={firstStrikePresentation}
        residualScarLight={completedScarOrbit}
        surfaceHeight={
          strikePresentationActive
            ? strikeAtPlayer
              ? playerSurfaceHeight
              : rivalSurfaceHeight
            : rivalFocused || completedScarOrbit
              ? rivalSurfaceHeight
              : playerSurfaceHeight
        }
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

      {outpost !== null &&
      (phase === 'orbit' || phase === 'selected') &&
      !strikePresentationActive &&
      !rivalCloseFocus ? (
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

      {rivalFootholdVisible && rival !== null && rivalTerrain !== null ? (
        <RivalFoothold
          rival={rival}
          presentation={rivalPresentation}
          focused={rivalFocused}
          terrain={rivalTerrain}
          segments={rivalTerrainSegments}
          closeViewShadows={
            rivalCloseFocus ||
            firstStrikePresentation.phase === 'target-approach' ||
            firstStrikePresentation.phase === 'impact-flash' ||
            firstStrikePresentation.phase === 'ejecta' ||
            firstStrikePresentation.phase === 'crater-reveal' ||
            firstStrikePresentation.phase === 'scar-explore'
          }
          damaged={rivalDamagedForPresentation}
          groundingMode={rivalDamagedForPresentation ? 'scarred' : 'terrain'}
        />
      ) : null}

      {rivalSurfaceContextVisible && rival !== null && rivalTerrain !== null ? (
        <SurfacePatch
          site={rival.site}
          phase="landed"
          segments={rivalTerrainSegments}
          terrain={rivalTerrain}
          maximumOpacity={0.58}
        />
      ) : null}

      {playerStrikeSurfaceVisible && landingSite !== null && terrain !== null ? (
        <SurfacePatch
          site={landingSite}
          phase="landed"
          segments={quality.patchSegments}
          terrain={terrain}
        />
      ) : null}

      {firstStrike?.scar !== null &&
      firstStrike?.scar !== undefined &&
      scarTerrain !== null &&
      scarVisibleForPresentation &&
      (phase === 'orbit' ||
        phase === 'selected' ||
        firstStrikePresentation.phase !== 'idle') ? (
        <PermanentLunarScar
          scar={firstStrike.scar}
          terrain={scarTerrain}
          terrainSegments={rivalTerrainSegments}
          focused={
            firstStrikePresentation.phase === 'impact-flash' ||
            firstStrikePresentation.phase === 'ejecta' ||
            firstStrikePresentation.phase === 'crater-reveal' ||
            firstStrikePresentation.phase === 'scar-explore'
          }
        />
      ) : null}

      {firstStrike !== null &&
      outpost !== null &&
      terrain !== null &&
      firstStrike.available &&
      firstStrike.status !== 'READY' &&
      (!firstStrike.impactCompleted || replayBeforeDamage) &&
      (phase === 'orbit' || firstStrikePresentation.phase !== 'idle') ? (
        <LunarWarheadSystem
          playerSite={outpost.site}
          strike={firstStrike}
          presentation={firstStrikePresentation}
          terrain={terrain}
          segments={quality.patchSegments}
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
      rivalTerrain !== null &&
      firstStrikeShowsImpactEffects(firstStrikePresentation.phase) ? (
        <LunarImpactEffects
          rivalSite={rival.site}
          presentation={firstStrikePresentation}
          terrain={rivalTerrain}
          segments={rivalTerrainSegments}
        />
      ) : null}

      {revealEffectsVisible &&
      rival !== null &&
      outpost !== null &&
      terrain !== null &&
      rivalTerrain !== null ? (
        <RivalRevealEffects
          playerSite={outpost.site}
          rival={rival}
          presentation={rivalPresentation}
          playerTerrain={terrain}
          playerTerrainSegments={quality.patchSegments}
          rivalTerrain={rivalTerrain}
          rivalTerrainSegments={rivalTerrainSegments}
        />
      ) : null}

      {rival !== null &&
      rivalTerrain !== null &&
      rivalPresentation.phase === 'scanning' ? (
        <RivalScanSweep
          rival={rival}
          presentation={rivalPresentation}
          terrain={rivalTerrain}
          segments={rivalTerrainSegments}
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
            segments={quality.patchSegments}
            rockCount={quality.surfaceRockCount}
          />
          <InvasionCapsule
            site={landingSite}
            phase={phase}
            outpost={outpost}
            terrain={terrain}
            segments={quality.patchSegments}
          />
          {outpost === null ? (
            <ImpactEffects
              site={landingSite}
              phase={phase}
              terrain={terrain}
              segments={quality.patchSegments}
            />
          ) : null}
          {outpost !== null ? (
            <>
              <MineralDeposits
                outpost={outpost}
                terrain={terrain}
                segments={quality.patchSegments}
                selectedDepositId={selectedDepositId}
                interactive={phase === 'landed'}
                active={active}
                onSelect={onSelectDeposit}
              />
              <MinerRobot
                outpost={outpost}
                terrain={terrain}
                segments={quality.patchSegments}
              />
              <Extractor
                outpost={outpost}
                terrain={terrain}
                segments={quality.patchSegments}
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
