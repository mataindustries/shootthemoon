import { TerritoryMonument, SurfaceDetail } from './TerritoryMonument.tsx'
import type { WaveDefenseView } from '../domain/waveDefense.ts'
import { territoryMonumentSite } from './monumentPresentation.ts'
import { monumentIsActive } from '../domain/territoryMonument.ts'
import { OrbitalPlatform } from './OrbitalPlatform.tsx'
import { createCounterstrikeRoute } from '../camera/counterstrikeRoute.ts'
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
import type { CounterstrikeSnapshot } from '../domain/counterstrike.ts'
import { deriveSecondaryImpactSite } from '../domain/counterstrike.ts'
import {
  counterstrikeNeedsContinuousFrames,
  type CounterstrikeRunState,
} from '../simulation/counterstrikeSimulation.ts'
import { CounterstrikeMissileSystem } from './CounterstrikeMissileSystem.tsx'
import {
  InterceptedThreatRecord,
  OrbitalInterceptEffects,
} from './OrbitalInterceptEffects.tsx'
import { CounterstrikeDamage } from './CounterstrikeDamage.tsx'
import { OperationalRobotFleet } from './OperationalRobotFleet.tsx'
import { OutpostModule } from './OutpostModule.tsx'
import { calculateOutpostOperations } from '../simulation/outpostOperations.ts'

const CLEAR_COLOR = VISUAL_PALETTE.space

interface SceneRootProps {
  readonly platformDefense: WaveDefenseView | null
  readonly monumentView: boolean
  readonly monumentRevealAtMs: number | null
  readonly onFocusMonument: () => void
  readonly active: boolean
  readonly phase: ExperiencePhase
  readonly landingSite: LandingSite | null
  readonly outpost: OutpostSnapshot | null
  readonly rival: RivalSignalSnapshot | null
  readonly rivalPresentation: RivalPresentationState
  readonly firstStrike: FirstStrikeSnapshot | null
  readonly firstStrikePresentation: FirstStrikePresentationState
  readonly counterstrike: CounterstrikeSnapshot | null
  readonly counterstrikeRun: CounterstrikeRunState
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
  platformDefense,
  monumentView,
  monumentRevealAtMs,
  onFocusMonument,
  active,
  phase,
  landingSite,
  outpost,
  rival,
  rivalPresentation,
  firstStrike,
  firstStrikePresentation,
  counterstrike,
  counterstrikeRun,
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
  const monumentSite = outpost === null ? null : territoryMonumentSite(outpost, firstStrike)
  const monumentOrbitalView = outpost?.monument?.status === 'complete' &&
    (phase === 'orbit' || phase === 'selected' || phase === 'returning')
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
  const counterstrikeTerrain = useMemo(
    () =>
      outpost === null ? null : createSurfaceTerrainProfile(outpost.site),
    [outpost?.site],
  )
  const secondaryImpactSite = useMemo(
    () => (outpost === null ? null : deriveSecondaryImpactSite(outpost)),
    // Economic ticks do not move this anchor. A new object here would reset
    // CameraRig's surface pose and interrupt every drag/zoom during production.
    [outpost?.site, outpost?.extractor?.position],
  )
  const orbitalInterceptPosition = useMemo(() =>
    outpost === null || rival === null || secondaryImpactSite === null ? null :
      createCounterstrikeRoute(outpost.site, rival.site, secondaryImpactSite)
        .getRenderPoint(counterstrikeRun.interceptRouteProgress ?? 0.7),
    [outpost?.site, rival?.site, secondaryImpactSite, counterstrikeRun.interceptRouteProgress],
  )
  const rivalTerrainSegments = Math.min(quality.patchSegments, 32)
  const playerSurfaceHeight =
    terrain === null
      ? undefined
      : sampleRenderedSurface(terrain, quality.patchSegments, 0, 0).y
  const counterstrikeSurfaceHeight =
    counterstrikeTerrain === null
      ? undefined
      : sampleRenderedSurface(
          counterstrikeTerrain,
          quality.patchSegments,
          outpost?.extractor?.position.xM ?? 0,
          outpost?.extractor?.position.zM ?? 0,
        ).y
  const operationsMetrics =
    outpost?.extractor?.status === 'active'
      ? calculateOutpostOperations(
          outpost,
          counterstrike?.outpostDamageState ?? 'INTACT',
          counterstrikeRun.status === 'resolved' ||
            counterstrikeRun.status === 'dormant'
            ? counterstrike?.acceptedOrder ?? counterstrikeRun.order
            : counterstrikeRun.order,
          counterstrikeRun.status === 'command-confirmed' ||
            counterstrikeRun.status === 'warning',
        )
      : null
  const rivalSurfaceHeight =
    rivalTerrain === null
      ? undefined
      : sampleRenderedSurface(rivalTerrain, rivalTerrainSegments, 0, 0).y
  const outpostAnimationActive =
    phase === 'landed' &&
    outpost !== null &&
    (isRobotTransient(outpost.robot.state) ||
      outpost.extractor?.status === 'constructing' ||
      outpost.module?.status === 'constructing' ||
      (outpost.module?.kind === 'REPAIR_GANTRY' &&
        outpost.module.status === 'active' &&
        outpost.module.repairProgress < 1 &&
        counterstrike?.outpostDamageState === 'DAMAGED'))
  const rivalAnimationActive = rivalPresentationNeedsContinuousFrames(
    rivalPresentation.phase,
  )
  const strikeAnimationActive = firstStrikeNeedsContinuousFrames(
    firstStrikePresentation.phase,
  )
  const counterstrikeAnimationActive = counterstrikeNeedsContinuousFrames(
    counterstrikeRun.status,
  )
  const counterstrikePresentationActive =
    counterstrikeRun.status !== 'dormant'
  const counterstrikeLaunchVisible =
    counterstrikeRun.status === 'command' ||
    counterstrikeRun.status === 'command-confirmed' ||
    counterstrikeRun.status === 'warning'
  const persistentOutpostDamage =
    !counterstrikePresentationActive &&
    counterstrike?.outpostDamageState === 'DAMAGED'
  const counterstrikeVisualOutcome =
    counterstrikeRun.status === 'impact'
      ? 'FAILURE'
      : counterstrikeRun.status === 'success'
        ? 'SUCCESS'
        : counterstrikeRun.status === 'resolved'
          ? counterstrikeRun.outcome
          : counterstrikeRun.replay
            ? null
            : counterstrike?.acceptedOutcome ?? null
  const counterstrikeFailureVisible =
    counterstrikeVisualOutcome === 'FAILURE' &&
    (counterstrikeRun.status === 'impact' ||
      counterstrikeRun.status === 'resolved')
  const counterstrikeSuccessVisible =
    counterstrikeVisualOutcome === 'SUCCESS' &&
    counterstrikeRun.status === 'resolved'
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
    !counterstrikePresentationActive &&
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
    !counterstrikePresentationActive &&
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
      ((monumentView && (monumentRevealAtMs !== null || (monumentIsActive(outpost?.monument ?? null) && outpost?.monument?.status !== 'command'))) ||
        platformDefense !== null || outpostAnimationActive ||
        rivalAnimationActive ||
        strikeAnimationActive ||
        counterstrikeAnimationActive),
  )
  useLowFrequencyDemandAnimation(active && (orbitalSignalHeartbeat || (outpost?.monument?.status === 'complete' && (phase === 'orbit' || monumentView))), 400)

  return (
    <CinematicClockProvider
      phase={phase}
      onLandingComplete={onLandingComplete}
      onReturnComplete={onReturnComplete}
    >
      <color attach="background" args={[CLEAR_COLOR]} />
      <CameraRig
        monumentFocusSite={monumentView ? monumentSite : null}
        monumentCompleted={outpost?.monument?.status === 'complete'}
        monumentRevealAtMs={monumentRevealAtMs}
        phase={phase}
        landingSite={landingSite}
        orbitalFocusSite={
          counterstrikePresentationActive || strikePresentationActive
            ? outpost?.site ?? null
            : outpost?.monument?.status === 'complete' ? monumentSite
            : counterstrike?.acceptedOutcome != null
            ? outpost?.site ?? null
            : firstStrike?.status === 'COMPLETE' && firstStrike.scar !== null
            ? firstStrike.scar.site
            : outpost?.site ?? null
        }
        outpost={outpost}
        terrain={terrain}
        terrainSegments={quality.patchSegments}
        rivalSite={rival?.site ?? null}
        dualOrbitPreferred={outpost?.monument?.status !== 'complete' && rival?.stage !== null}
        rivalPresentation={rivalPresentation}
        firstStrikePresentation={firstStrikePresentation}
        counterstrikeRun={counterstrikeRun}
        counterstrikeSecondaryImpactSite={secondaryImpactSite}
      />
      <LightingRig
        monumentReadability={(monumentView || monumentOrbitalView) && !strikePresentationActive && !counterstrikePresentationActive}
        counterstrikeRun={counterstrikeRun}
        orbitalInterceptPosition={orbitalInterceptPosition}
        landingSite={landingSite}
        strategicFocusSite={
          counterstrikePresentationActive
            ? counterstrikeFailureVisible
              ? outpost?.site ?? null
              : null
            : strikePresentationActive
            ? strikeAtPlayer
              ? outpost?.site ?? null
              : rival?.site ?? null
            : monumentView || monumentOrbitalView
              ? monumentSite
            : rivalFocused
              ? rival?.site ?? null
              : completedScarOrbit
                ? firstStrike?.scar?.site ?? null
                : null
        }
        cinematicReadability={
          cinematicReadability || counterstrikePresentationActive
        }
        enableSurfaceShadows={
          quality.tier !== 'low' && !counterstrikePresentationActive
        }
        closeViewShadows={
          counterstrikeFailureVisible ||
          (closeViewShadows &&
            !completedScarOrbit &&
            !counterstrikePresentationActive)
        }
        closeReadLightColor={
          counterstrikeFailureVisible
            ? VISUAL_PALETTE.damageEmber
            : undefined
        }
        firstStrikePresentation={firstStrikePresentation}
        residualScarLight={completedScarOrbit}
        surfaceHeight={
          strikePresentationActive
            ? strikeAtPlayer
              ? playerSurfaceHeight
              : rivalSurfaceHeight
            : counterstrikeFailureVisible
              ? counterstrikeSurfaceHeight
              : rivalFocused || completedScarOrbit
              ? rivalSurfaceHeight
              : playerSurfaceHeight
        }
      />
      {counterstrikeLaunchVisible ? (
        <ambientLight color="#b6c5d6" intensity={0.9} />
      ) : null}
      {outpost?.monument && monumentSite !== null && !strikePresentationActive && !counterstrikePresentationActive ? <TerritoryMonument
        monument={outpost.monument} site={monumentSite} onFocus={onFocusMonument}
        terrain={counterstrikeTerrain} segments={quality.patchSegments}
        sampledAtMs={outpost.operations.lastUpdatedAtMs} running={active && monumentView}
      /> : null}
      {outpost?.monument?.kind === 'CRATER_CROWN' && outpost.monument.anchor === 'outpost' && counterstrikeTerrain !== null && (monumentView || phase === 'orbit' || monumentOrbitalView) ? <SurfacePatch
        site={outpost.site} phase="landed" terrain={counterstrikeTerrain} segments={quality.patchSegments} maximumOpacity={.8}
      /> : null}
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
        <LandingMarker active={active} site={landingSite} />
      ) : null}

      {outpost !== null &&
      (phase === 'orbit' || phase === 'selected') &&
      !strikePresentationActive &&
      (!counterstrikePresentationActive || counterstrikeRun.status === 'interceptor-launched' || counterstrikeRun.status === 'success' || counterstrikeSuccessVisible) &&
      !rivalCloseFocus ? (
        outpost.monument?.status === 'complete' || monumentView ? null : <OutpostSignal
          outpost={outpost}
          focused={phase === 'selected'}
          interactive={!counterstrikePresentationActive}
          onFocus={onFocusOutpost}
        />
      ) : null}

      {rivalSignalVisible && rival !== null && !monumentView && outpost?.monument?.status !== 'complete' ? (
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

      {outpost !== null &&
      rival !== null &&
      secondaryImpactSite !== null &&
      counterstrikePresentationActive &&
      counterstrikeRun.status !== 'resolved' &&
      counterstrikeRun.status !== 'success' ? (
        <CounterstrikeMissileSystem
          key={counterstrikeRun.status === 'impact' ? 'terminal' : 'orbital'}
          playerSite={outpost.site}
          rivalSite={rival.site}
          secondaryImpactSite={secondaryImpactSite}
          run={counterstrikeRun}
        />
      ) : null}

      {outpost !== null &&
      rival !== null &&
      secondaryImpactSite !== null &&
      counterstrikeRun.status === 'success' ? (
        <OrbitalInterceptEffects
          playerSite={outpost.site}
          rivalSite={rival.site}
          secondaryImpactSite={secondaryImpactSite}
          run={counterstrikeRun}
        />
      ) : null}

      {outpost !== null &&
      rival !== null &&
      secondaryImpactSite !== null &&
      counterstrikeSuccessVisible ? (
        <InterceptedThreatRecord
          playerSite={outpost.site}
          rivalSite={rival.site}
          secondaryImpactSite={secondaryImpactSite}
          interceptProgress={counterstrikeRun.interceptRouteProgress ?? 0.7}
        />
      ) : null}

      {rivalFootholdVisible && rival !== null && rivalTerrain !== null ? (
        <SurfaceDetail name="rival-base-detail"><RivalFoothold
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
        /></SurfaceDetail>
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
      !counterstrikeFailureVisible &&
      (phase === 'orbit' ||
        phase === 'selected' ||
        firstStrikePresentation.phase !== 'idle' || monumentView) ? (
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

      {showLandingScene && terrain !== null && !monumentView ? (
        <SurfaceDetail name="player-base-detail">
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
                damaged={counterstrikeFailureVisible || persistentOutpostDamage || (outpost.orbitalSiege?.outpostDamage ?? 0) > 0}
                damageSequence={counterstrikeRun}
                operations={operationsMetrics ?? undefined}
              />
              {outpost.orbitalSiege !== null ? <OrbitalPlatform outpost={outpost} terrain={terrain} segments={quality.patchSegments} defense={platformDefense} /> : null}
              <OutpostModule
                outpost={outpost}
                damageState={counterstrike?.outpostDamageState ?? 'INTACT'}
                terrain={terrain}
                segments={quality.patchSegments}
              />
              {operationsMetrics !== null ? (
                <OperationalRobotFleet
                  damaged={persistentOutpostDamage || counterstrikeFailureVisible}
                  outpost={outpost}
                  operations={operationsMetrics}
                  terrain={terrain}
                  segments={quality.patchSegments}
                />
              ) : null}
              {persistentOutpostDamage ? (
                <CounterstrikeDamage
                  outpost={outpost}
                  terrain={terrain}
                  segments={quality.patchSegments}
                  run={counterstrikeRun}
                  transientImpact={false}
                  permanent
                />
              ) : null}
            </>
          ) : null}
        </SurfaceDetail>
      ) : null}

      {counterstrikeFailureVisible &&
      counterstrikeTerrain !== null &&
      outpost !== null ? (
        <>
          <SurfacePatch
            site={outpost.site}
            phase="landed"
            segments={quality.patchSegments}
            terrain={counterstrikeTerrain}
            maximumOpacity={0.9}
          />
          {!showLandingScene ? (
            <>
              <InvasionCapsule
                site={outpost.site}
                phase="landed"
                outpost={outpost}
                terrain={counterstrikeTerrain}
                segments={quality.patchSegments}
                compact
              />
              <MinerRobot
                outpost={outpost}
                terrain={counterstrikeTerrain}
                segments={quality.patchSegments}
                compact
              />
              <Extractor
                outpost={outpost}
                terrain={counterstrikeTerrain}
                segments={quality.patchSegments}
                damaged
                compact
                damageSequence={counterstrikeRun}
                operations={operationsMetrics ?? undefined}
              />
              <OutpostModule
                outpost={outpost}
                damageState={counterstrike?.outpostDamageState ?? 'INTACT'}
                terrain={counterstrikeTerrain}
                segments={quality.patchSegments}
              />
            </>
          ) : null}
          <CounterstrikeDamage
            outpost={outpost}
            terrain={counterstrikeTerrain}
            segments={quality.patchSegments}
            run={counterstrikeRun}
            transientImpact={counterstrikeRun.status === 'impact'}
            permanent={
              counterstrikeRun.status === 'impact' ||
              counterstrikeRun.status === 'resolved'
            }
          />
        </>
      ) : null}

      <SceneMetrics />
    </CinematicClockProvider>
  )
}
