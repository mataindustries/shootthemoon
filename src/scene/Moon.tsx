import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BackSide,
  Color,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import { selectLandingSiteFromOrbitalRay } from '../render/surfaceSelection.ts'
import { MOON_RENDER_RADIUS } from '../render/renderCoordinates.ts'
import {
  beginTouch,
  canSelectWithTouchGate,
  createTouchSelectionGate,
  endTouch,
  resetTouchSelectionGate,
} from '../interaction/touchSelectionGate.ts'
import { MATERIAL_RESPONSE } from '../render/visualSystem.ts'

const COLOR_TEXTURE_URL = '/assets/moon/lroc_color_2k.jpg'
const BUMP_TEXTURE_URL = '/assets/moon/ldem_3_8bit.jpg'
const TAP_DISTANCE_PX = 8

interface MoonProps {
  readonly widthSegments: number
  readonly heightSegments: number
  readonly phase: ExperiencePhase
  readonly selectionEnabled: boolean
  readonly onSelect: (site: LandingSite) => void
  readonly onReady: () => void
}

function RimGlow({
  widthSegments,
  heightSegments,
  visible,
}: Pick<MoonProps, 'widthSegments' | 'heightSegments'> & {
  readonly visible: boolean
}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          glowColor: { value: new Color('#6d87a8') },
        },
        vertexShader: [
          'varying vec3 vWorldNormal;',
          'varying vec3 vWorldPosition;',
          'void main() {',
          '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
          '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
          '  vWorldPosition = worldPosition.xyz;',
          '  gl_Position = projectionMatrix * viewMatrix * worldPosition;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 glowColor;',
          'varying vec3 vWorldNormal;',
          'varying vec3 vWorldPosition;',
          'void main() {',
          '  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);',
          '  float rim = pow(1.0 - max(dot(viewDirection, vWorldNormal), 0.0), 4.2);',
          '  gl_FragColor = vec4(glowColor, rim * 0.16);',
          '}',
        ].join('\n'),
        blending: AdditiveBlending,
        depthWrite: false,
        side: BackSide,
        transparent: true,
      }),
    [],
  )

  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh material={material} scale={1.014} visible={visible}>
      <sphereGeometry
        args={[
          MOON_RENDER_RADIUS,
          Math.max(64, Math.floor(widthSegments / 2)),
          Math.max(32, Math.floor(heightSegments / 2)),
        ]}
      />
    </mesh>
  )
}

export function Moon({
  widthSegments,
  heightSegments,
  phase,
  selectionEnabled,
  onSelect,
  onReady,
}: MoonProps) {
  const gl = useThree((state) => state.gl)
  const colorTexture = useLoader(TextureLoader, COLOR_TEXTURE_URL)
  const bumpTexture = useLoader(TextureLoader, BUMP_TEXTURE_URL)
  const touchSelectionGate = useMemo(createTouchSelectionGate, [])

  useEffect(() => {
    colorTexture.colorSpace = SRGBColorSpace
    colorTexture.wrapS = RepeatWrapping
    colorTexture.minFilter = LinearMipmapLinearFilter
    colorTexture.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy())
    colorTexture.needsUpdate = true

    bumpTexture.colorSpace = NoColorSpace
    bumpTexture.wrapS = RepeatWrapping
    bumpTexture.minFilter = LinearMipmapLinearFilter
    bumpTexture.anisotropy = Math.min(2, gl.capabilities.getMaxAnisotropy())
    bumpTexture.needsUpdate = true

    onReady()
  }, [bumpTexture, colorTexture, gl, onReady])

  useEffect(() => {
    const canvas = gl.domElement
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        beginTouch(touchSelectionGate, event.pointerId)
      }
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        endTouch(
          touchSelectionGate,
          event.pointerId,
          performance.now(),
        )
      }
    }
    const handleWindowBlur = () => {
      resetTouchSelectionGate(touchSelectionGate)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('lostpointercapture', handlePointerEnd)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('lostpointercapture', handlePointerEnd)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
      window.removeEventListener('blur', handleWindowBlur)
      resetTouchSelectionGate(touchSelectionGate)
    }
  }, [gl, touchSelectionGate])

  useLayoutEffect(() => {
    resetTouchSelectionGate(touchSelectionGate)
  }, [phase, touchSelectionGate])

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (
      (phase !== 'orbit' && phase !== 'selected') ||
      !selectionEnabled ||
      event.delta > TAP_DISTANCE_PX ||
      !canSelectWithTouchGate(touchSelectionGate, performance.now())
    ) {
      return
    }

    const site = selectLandingSiteFromOrbitalRay(
      {
        origin: {
          x: event.ray.origin.x,
          y: event.ray.origin.y,
          z: event.ray.origin.z,
        },
        direction: {
          x: event.ray.direction.x,
          y: event.ray.direction.y,
          z: event.ray.direction.z,
        },
      },
      MOON_RENDER_RADIUS,
    )

    if (site !== null) {
      event.stopPropagation()
      onSelect(site)
    }
  }

  return (
    <group>
      <mesh receiveShadow onClick={handleClick}>
        <sphereGeometry
          args={[MOON_RENDER_RADIUS, widthSegments, heightSegments]}
        />
        <meshStandardMaterial
          bumpMap={bumpTexture}
          bumpScale={0.022}
          color="#aaa8a1"
          map={colorTexture}
          metalness={MATERIAL_RESPONSE.lunar.metalness}
          roughness={MATERIAL_RESPONSE.lunar.roughness}
        />
      </mesh>
      <RimGlow
        widthSegments={widthSegments}
        heightSegments={heightSegments}
        visible={phase === 'orbit' || phase === 'selected'}
      />
    </group>
  )
}
