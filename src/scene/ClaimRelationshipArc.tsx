import { useEffect, useMemo, useRef } from 'react'
import {
  CatmullRomCurve3,
  Mesh,
  MeshBasicMaterial,
  TubeGeometry,
  Vector3,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { landingSiteToRenderTransform } from '../render/renderCoordinates.ts'
import { slerpUnitDirections } from '../camera/orbitalCameraPath.ts'
import {
  CLAIM_RELATIONSHIP_ARC,
  claimRelationshipArcOpacity,
} from '../render/orbitalClaimMarker.ts'
import {
  getRivalPresentationProgress,
  type RivalPresentationState,
} from '../app/rivalPresentation.ts'
import { VISUAL_PALETTE } from '../render/visualSystem.ts'

const CONTROL_POINTS = 24

interface ClaimRelationshipArcProps {
  readonly playerSite: LandingSite
  readonly rivalSite: LandingSite
  readonly presentation: RivalPresentationState
}

/**
 * A neutral hairline drawn over the near side during TWO CLAIMS DETECTED, so
 * the two claims read as one contested composition rather than two specks.
 * It is derived from the saved sites and owns no state of its own.
 */
export function ClaimRelationshipArc({
  playerSite,
  rivalSite,
  presentation,
}: ClaimRelationshipArcProps) {
  const meshRef = useRef<Mesh>(null)
  const geometry = useMemo(() => {
    const player = landingSiteToRenderTransform(playerSite).position
      .clone()
      .normalize()
    const rival = landingSiteToRenderTransform(rivalSite).position
      .clone()
      .normalize()
    const points: Vector3[] = []

    for (let index = 0; index <= CONTROL_POINTS; index += 1) {
      const progress = index / CONTROL_POINTS
      const radius =
        CLAIM_RELATIONSHIP_ARC.baseRadius +
        CLAIM_RELATIONSHIP_ARC.midpointLift * Math.sin(Math.PI * progress)
      points.push(
        slerpUnitDirections(player, rival, progress).multiplyScalar(radius),
      )
    }

    return new TubeGeometry(
      new CatmullRomCurve3(points),
      CLAIM_RELATIONSHIP_ARC.tubularSegments,
      CLAIM_RELATIONSHIP_ARC.tubeRadius,
      CLAIM_RELATIONSHIP_ARC.radialSegments,
      false,
    )
  }, [playerSite, rivalSite])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: VISUAL_PALETTE.rivalSurgical,
        depthWrite: false,
        opacity: 0,
        toneMapped: true,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    const mesh = meshRef.current

    if (mesh === null) {
      return
    }

    const opacity = claimRelationshipArcOpacity(
      getRivalPresentationProgress(presentation, performance.now()),
    )
    mesh.visible = opacity > 0.01
    material.opacity = opacity
  })

  return (
    <mesh
      ref={meshRef}
      name="claim-relationship-arc"
      geometry={geometry}
      material={material}
      visible={false}
    />
  )
}
