import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import type { CounterstrikeRunState } from '../simulation/counterstrikeSimulation.ts'
import {
  COUNTERSTRIKE_TIMING,
  getCounterstrikeAttemptElapsedMs,
  getCounterstrikeRunProgress,
  getCounterstrikeThreatProgress,
} from '../simulation/counterstrikeSimulation.ts'
import {
  createCounterstrikeRoute,
  createInterceptorRoute,
} from '../camera/counterstrikeRoute.ts'
import {
  EMISSIVE_LIMITS,
  MATERIAL_RESPONSE,
  VISUAL_PALETTE,
} from '../render/visualSystem.ts'
import {
  landingSiteToLocalSurfaceRenderPoint,
  landingSiteToRenderTransform,
} from '../render/renderCoordinates.ts'
import { LOCAL_SURFACE_RENDER_OFFSET } from '../render/localSurface.ts'

interface CounterstrikeMissileSystemProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly secondaryImpactSite: LandingSite
  readonly run: CounterstrikeRunState
}

const MODEL_UP = new Vector3(0, 1, 0)
const THREAT_FIN_COUNT = 3
const RETICLE_TICK_COUNT = 4
const IMPACT_TERMINAL_ROUTE_START = 0.9

function createCorridorGeometry(
  route: ReturnType<typeof createCounterstrikeRoute>,
): BufferGeometry {
  const segmentCount = 36
  const positions = new Float32Array(segmentCount * 2 * 3)
  const first = new Vector3()
  const second = new Vector3()

  for (let index = 0; index < segmentCount; index += 1) {
    const start = 0.06 + (index / segmentCount) * 0.92
    const end = 0.06 + ((index + 0.58) / segmentCount) * 0.92
    route.getRenderPoint(start, first)
    route.getRenderPoint(end, second)
    positions.set(first.toArray(), index * 6)
    positions.set(second.toArray(), index * 6 + 3)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function smoothstep(value: number): number {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

export function CounterstrikeMissileSystem({
  playerSite,
  rivalSite,
  secondaryImpactSite,
  run,
}: CounterstrikeMissileSystemProps) {
  const hostileRef = useRef<Group>(null)
  const hostileModelRef = useRef<Group>(null)
  const interceptorRef = useRef<Group>(null)
  const interceptorFlameRef = useRef<Group>(null)
  const reticleRef = useRef<Group>(null)
  const threatFinsRef = useRef<InstancedMesh>(null)
  const reticleTicksRef = useRef<InstancedMesh>(null)
  const dummyRef = useRef(new Object3D())
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const route = useMemo(
    () => createCounterstrikeRoute(playerSite, rivalSite, secondaryImpactSite),
    [playerSite, rivalSite, secondaryImpactSite],
  )
  const terminalVisualOffset = useMemo(() => {
    const player = landingSiteToRenderTransform(playerSite)
    const expandedImpact = landingSiteToLocalSurfaceRenderPoint(
      playerSite,
      secondaryImpactSite,
    ).addScaledVector(player.up, LOCAL_SURFACE_RENDER_OFFSET)
    return expandedImpact.sub(
      landingSiteToRenderTransform(secondaryImpactSite).position,
    )
  }, [playerSite, secondaryImpactSite])
  const interceptorRoute = useMemo(
    () =>
      run.interceptRouteProgress === null
        ? null
        : createInterceptorRoute(
            playerSite,
            route,
            run.interceptRouteProgress,
          ),
    [playerSite, route, run.interceptRouteProgress],
  )
  const currentPosition = useRef(new Vector3())
  const previousPosition = useRef(new Vector3())
  const nextPosition = useRef(new Vector3())
  const direction = useRef(new Vector3())
  const orientation = useRef(new Quaternion())
  const missSide = useRef(new Vector3())
  const corridorGeometry = useMemo(() => createCorridorGeometry(route), [route])
  const threatBodyGeometry = useMemo(
    () => new CylinderGeometry(0.42, 0.62, 5.8, 9),
    [],
  )
  const threatNoseGeometry = useMemo(() => new ConeGeometry(0.44, 2.4, 9), [])
  const threatForkGeometry = useMemo(() => new BoxGeometry(0.18, 2.2, 0.46), [])
  const threatFinGeometry = useMemo(() => new BoxGeometry(0.12, 1.8, 1.28), [])
  const threatCoreGeometry = useMemo(
    () => new CylinderGeometry(0.26, 0.3, 0.3, 8),
    [],
  )
  const interceptorBodyGeometry = useMemo(
    () => new CylinderGeometry(0.34, 0.5, 3.4, 9),
    [],
  )
  const interceptorNoseGeometry = useMemo(
    () => new ConeGeometry(0.35, 1.45, 9),
    [],
  )
  const interceptorFinGeometry = useMemo(() => new BoxGeometry(1.5, 1.2, 0.12), [])
  const flameGeometry = useMemo(() => new ConeGeometry(0.42, 2.4, 8), [])
  const reticleGeometry = useMemo(() => new TorusGeometry(1, 0.075, 6, 32), [])
  const reticleTickGeometry = useMemo(() => new BoxGeometry(0.16, 0.62, 0.08), [])
  const rivalArmorMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalSkeleton,
        ...MATERIAL_RESPONSE.rivalSkeleton,
      }),
    [],
  )
  const rivalPanelMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.rivalCyanPanel,
        emissive: VISUAL_PALETTE.rivalCyanEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.panel,
        ...MATERIAL_RESPONSE.rivalPanel,
      }),
    [],
  )
  const playerMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerArmor,
        ...MATERIAL_RESPONSE.playerArmor,
      }),
    [],
  )
  const playerAccentMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VISUAL_PALETTE.playerAmberPanel,
        emissive: VISUAL_PALETTE.playerAmberEmissive,
        emissiveIntensity: EMISSIVE_LIMITS.activePanel,
        metalness: 0.28,
        roughness: 0.46,
      }),
    [],
  )
  const flameMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ff9a4d',
        depthWrite: false,
        opacity: 0.68,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )
  const corridorMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        opacity: 0.24,
        transparent: true,
        toneMapped: true,
      }),
    [],
  )
  const reticleMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalCyanEmissive,
        depthTest: true,
        depthWrite: false,
        opacity: 0.72,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )

  useLayoutEffect(() => {
    const fins = threatFinsRef.current
    const ticks = reticleTicksRef.current
    if (fins === null || ticks === null) return
    const dummy = dummyRef.current

    for (let index = 0; index < THREAT_FIN_COUNT; index += 1) {
      const angle = (index / THREAT_FIN_COUNT) * Math.PI * 2
      dummy.position.set(Math.sin(angle) * 0.56, -2.15, Math.cos(angle) * 0.56)
      dummy.rotation.set(0, angle, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      fins.setMatrixAt(index, dummy.matrix)
    }
    fins.instanceMatrix.needsUpdate = true

    for (let index = 0; index < RETICLE_TICK_COUNT; index += 1) {
      const angle = index * (Math.PI / 2)
      dummy.position.set(Math.sin(angle) * 1.42, Math.cos(angle) * 1.42, 0)
      dummy.rotation.set(0, 0, -angle)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      ticks.setMatrixAt(index, dummy.matrix)
    }
    ticks.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(
    () => () => {
      corridorGeometry.dispose()
      threatBodyGeometry.dispose()
      threatNoseGeometry.dispose()
      threatForkGeometry.dispose()
      threatFinGeometry.dispose()
      threatCoreGeometry.dispose()
      interceptorBodyGeometry.dispose()
      interceptorNoseGeometry.dispose()
      interceptorFinGeometry.dispose()
      flameGeometry.dispose()
      reticleGeometry.dispose()
      reticleTickGeometry.dispose()
      rivalArmorMaterial.dispose()
      rivalPanelMaterial.dispose()
      playerMaterial.dispose()
      playerAccentMaterial.dispose()
      flameMaterial.dispose()
      corridorMaterial.dispose()
      reticleMaterial.dispose()
      delete gl.domElement.dataset.counterstrikeThreats
      delete gl.domElement.dataset.counterstrikeInterceptors
      delete gl.domElement.dataset.counterstrikeRouteProgress
      delete gl.domElement.dataset.counterstrikeThreatRadius
      delete gl.domElement.dataset.counterstrikeReticle
    }, [
      corridorGeometry,
      corridorMaterial,
      flameGeometry,
      flameMaterial,
      gl,
      interceptorBodyGeometry,
      interceptorFinGeometry,
      interceptorNoseGeometry,
      playerAccentMaterial,
      playerMaterial,
      reticleGeometry,
      reticleMaterial,
      reticleTickGeometry,
      rivalArmorMaterial,
      rivalPanelMaterial,
      threatBodyGeometry,
      threatCoreGeometry,
      threatFinGeometry,
      threatForkGeometry,
      threatNoseGeometry,
    ],
  )

  useFrame((state) => {
    const hostile = hostileRef.current
    const hostileModel = hostileModelRef.current
    const interceptor = interceptorRef.current
    const flame = interceptorFlameRef.current
    const reticle = reticleRef.current
    if (
      hostile === null ||
      hostileModel === null ||
      interceptor === null ||
      flame === null ||
      reticle === null
    ) {
      return
    }

    const clockMs = performance.now()
    const phaseProgress = getCounterstrikeRunProgress(run, clockMs)
    const threatProgress = getCounterstrikeThreatProgress(run, clockMs)
    const impactContactProgress =
      COUNTERSTRIKE_TIMING.impactContactMs /
      COUNTERSTRIKE_TIMING.impactMs
    const threatVisible =
      run.status !== 'success' &&
      run.status !== 'resolved' &&
      !(run.status === 'impact' && phaseProgress >= impactContactProgress)

    if (run.status === 'impact') {
      const terminalProgress = MathUtils.lerp(
        IMPACT_TERMINAL_ROUTE_START,
        1,
        MathUtils.clamp(phaseProgress / impactContactProgress, 0, 1),
      )
      route.getTerminalRenderPoint(terminalProgress, currentPosition.current)
      route.getTerminalRenderPoint(
        Math.max(IMPACT_TERMINAL_ROUTE_START, terminalProgress - 0.0005),
        previousPosition.current,
      )
      route.getTerminalRenderPoint(
        Math.min(1, terminalProgress + 0.0005),
        nextPosition.current,
      )
      currentPosition.current.add(terminalVisualOffset)
      previousPosition.current.add(terminalVisualOffset)
      nextPosition.current.add(terminalVisualOffset)
    } else {
      route.getRenderPoint(threatProgress, currentPosition.current)
      route.getRenderPoint(
        Math.max(0, threatProgress - 0.002),
        previousPosition.current,
      )
      route.getRenderPoint(
        Math.min(1, threatProgress + 0.002),
        nextPosition.current,
      )
    }
    direction.current.copy(nextPosition.current).sub(previousPosition.current).normalize()
    orientation.current.setFromUnitVectors(MODEL_UP, direction.current)
    hostile.visible = threatVisible
    hostile.position.copy(currentPosition.current)
    hostile.quaternion.copy(orientation.current)
    // The orbital silhouette is intentionally exaggerated at lunar scale. Once
    // it enters the surface sequence, restore a readable ~10 m physical scale
    // so the missile establishes the shot without swallowing the outpost.
    hostile.scale.setScalar(run.status === 'impact' ? 0.00014 : 0.0062)
    const threatRadius = currentPosition.current.length()
    hostileModel.rotation.y = Math.sin(state.clock.elapsedTime * 2.1) * 0.035
    rivalPanelMaterial.emissiveIntensity = Math.min(
      EMISSIVE_LIMITS.tinyLed,
      EMISSIVE_LIMITS.panel + Math.sin(state.clock.elapsedTime * 9.4) * 0.1,
    )

    const targetZoneProgress = Math.min(0.94, threatProgress + 0.075)
    route.getRenderPoint(targetZoneProgress, reticle.position)
    reticle.quaternion.copy(camera.quaternion)
    const attemptElapsed = getCounterstrikeAttemptElapsedMs(run, clockMs) ?? 0
    const inValidWindow =
      attemptElapsed >= COUNTERSTRIKE_TIMING.validWindowStartMs &&
      attemptElapsed <= COUNTERSTRIKE_TIMING.validWindowEndMs
    const late = attemptElapsed > COUNTERSTRIKE_TIMING.validWindowEndMs
    const trackingConvergence = MathUtils.clamp(
      attemptElapsed / COUNTERSTRIKE_TIMING.validWindowStartMs,
      0,
      1,
    )
    const windowProgress = MathUtils.clamp(
      (attemptElapsed - COUNTERSTRIKE_TIMING.validWindowStartMs) /
        COUNTERSTRIKE_TIMING.validWindowMs,
      0,
      1,
    )
    const convergence = late
      ? 1.28
      : inValidWindow
        ? 1 + Math.sin(windowProgress * Math.PI * 6) * 0.055
        : 1.78 - smoothstep(trackingConvergence) * 0.72
    reticle.scale.setScalar(0.064 * convergence)
    reticle.rotation.z =
      (inValidWindow ? -1 : 0.38) * state.clock.elapsedTime * 0.72
    reticle.visible =
      run.status === 'tracking' || run.status === 'intercept-ready'
    reticleMaterial.color.set(
      late
        ? VISUAL_PALETTE.playerWarningRed
        : inValidWindow
          ? VISUAL_PALETTE.playerAmberEmissive
          : VISUAL_PALETTE.rivalCyanEmissive,
    )
    reticleMaterial.opacity = inValidWindow
      ? 0.88 + Math.sin(windowProgress * Math.PI * 6) * 0.1
      : late
        ? 0.82
        : 0.58 + trackingConvergence * 0.18
    corridorMaterial.color.set(
      late
        ? VISUAL_PALETTE.playerWarningRed
        : inValidWindow
          ? VISUAL_PALETTE.playerAmberEmissive
          : VISUAL_PALETTE.rivalCyanEmissive,
    )
    corridorMaterial.opacity = inValidWindow ? 0.46 : late ? 0.34 : 0.24

    const interceptorVisible =
      run.status === 'interceptor-launched' && interceptorRoute !== null
    interceptor.visible = interceptorVisible
    if (interceptorVisible && interceptorRoute !== null) {
      const interceptorProgress = smoothstep(phaseProgress)
      interceptorRoute.getRenderPoint(interceptorProgress, currentPosition.current)
      interceptorRoute.getRenderPoint(
        Math.max(0, interceptorProgress - 0.004),
        previousPosition.current,
      )
      interceptorRoute.getRenderPoint(
        Math.min(1, interceptorProgress + 0.004),
        nextPosition.current,
      )
      direction.current.copy(nextPosition.current).sub(previousPosition.current).normalize()
      if (run.judgement !== 'VALID') {
        missSide.current.copy(direction.current).cross(COUNTERSTRIKE_CAMERA_ARC)
        if (missSide.current.lengthSq() < 1e-10) missSide.current.set(1, 0, 0)
        currentPosition.current.addScaledVector(
          missSide.current.normalize(),
          0.024 * smoothstep(interceptorProgress),
        )
      }
      orientation.current.setFromUnitVectors(MODEL_UP, direction.current)
      interceptor.position.copy(currentPosition.current)
      interceptor.quaternion.copy(orientation.current)
      interceptor.scale.setScalar(0.0046)
      const flicker = 0.84 + Math.sin(state.clock.elapsedTime * 38) * 0.13
      flame.scale.set(1, 0.72 + flicker * 0.4, 1)
      flameMaterial.opacity = 0.5 + flicker * 0.2
    }

    gl.domElement.dataset.counterstrikeThreats = threatVisible ? '1' : '0'
    gl.domElement.dataset.counterstrikeInterceptors = interceptorVisible ? '1' : '0'
    gl.domElement.dataset.counterstrikeRouteProgress = threatProgress.toFixed(6)
    gl.domElement.dataset.counterstrikeThreatRadius = threatRadius.toFixed(6)
    gl.domElement.dataset.counterstrikeReticle = reticle.visible
      ? inValidWindow
        ? 'ready'
        : late
          ? 'late'
          : 'tracking'
      : 'hidden'
  })

  const corridorVisible =
    run.status === 'warning' ||
    run.status === 'tracking' ||
    run.status === 'intercept-ready' ||
    run.status === 'interceptor-launched' ||
    run.status === 'missed'

  return (
    <group name="counterstrike-orbital-system">
      <lineSegments
        geometry={corridorGeometry}
        material={corridorMaterial}
        visible={corridorVisible}
        frustumCulled={false}
      />
      <group ref={reticleRef}>
        <mesh geometry={reticleGeometry} material={reticleMaterial} />
        <instancedMesh
          ref={reticleTicksRef}
          args={[reticleTickGeometry, reticleMaterial, RETICLE_TICK_COUNT]}
        />
      </group>
      <group ref={hostileRef} name="null-meridian-counterstrike-missile">
        <group ref={hostileModelRef}>
          <mesh geometry={threatBodyGeometry} material={rivalArmorMaterial} />
          <mesh
            geometry={threatNoseGeometry}
            material={rivalPanelMaterial}
            position-y={4.05}
          />
          <mesh
            geometry={threatForkGeometry}
            material={rivalArmorMaterial}
            position={[-0.44, 2.9, 0]}
            rotation-z={-0.16}
          />
          <mesh
            geometry={threatForkGeometry}
            material={rivalArmorMaterial}
            position={[0.44, 2.9, 0]}
            rotation-z={0.16}
          />
          <mesh
            geometry={threatCoreGeometry}
            material={rivalPanelMaterial}
            position-y={-3.05}
          />
          <instancedMesh
            ref={threatFinsRef}
            args={[threatFinGeometry, rivalArmorMaterial, THREAT_FIN_COUNT]}
          />
        </group>
      </group>
      <group ref={interceptorRef} name="player-orbital-interceptor" visible={false}>
        <mesh geometry={interceptorBodyGeometry} material={playerMaterial} />
        <mesh
          geometry={interceptorNoseGeometry}
          material={playerAccentMaterial}
          position-y={2.42}
        />
        <mesh geometry={interceptorFinGeometry} material={playerMaterial} position-y={-1.35} />
        <group ref={interceptorFlameRef} position-y={-2.65} rotation-z={Math.PI}>
          <mesh geometry={flameGeometry} material={flameMaterial} />
        </group>
      </group>
    </group>
  )
}

const COUNTERSTRIKE_CAMERA_ARC = new Vector3(-0.42, 0.76, 0.5).normalize()
