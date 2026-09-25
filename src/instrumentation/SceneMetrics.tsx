import { E2E_HARNESS_BUILD_ENABLED, shouldEnableE2eHarness } from '../testing/e2eHarness.ts'
import { useRef } from 'react'
import { Vector2, Vector3 } from 'three'
import { useFrame } from '@react-three/fiber'

export function SceneMetrics() {
  const pendingRef = useRef(false)
  const frameCountRef = useRef(0)
  const drawingBufferSizeRef = useRef(new Vector2())

  useFrame((state) => {
    frameCountRef.current += 1

    if (pendingRef.current) {
      return
    }

    pendingRef.current = true

    queueMicrotask(() => {
      const renderer = state.gl
      const canvas = renderer.domElement
      const info = renderer.info
      const size = renderer.getDrawingBufferSize(drawingBufferSizeRef.current)

      canvas.dataset.drawCalls = String(info.render.calls)
      canvas.dataset.triangles = String(info.render.triangles)
      canvas.dataset.points = String(info.render.points)
      canvas.dataset.geometries = String(info.memory.geometries)
      canvas.dataset.textures = String(info.memory.textures)
      canvas.dataset.programs = String(info.programs?.length ?? 0)
      canvas.dataset.frameCount = String(frameCountRef.current)
      canvas.dataset.bufferWidth = String(Math.round(size.x))
      canvas.dataset.bufferHeight = String(Math.round(size.y))
      const visible = (name: string) => {
        const object = state.scene.getObjectByName(name)
        let shown = object?.visible ?? false
        object?.traverseAncestors(parent => { shown = shown && parent.visible })
        return shown
      }
      canvas.dataset.baseDetailsVisible = String(visible('player-base-detail') || visible('rival-base-detail'))
      canvas.dataset.monumentVisible = String(visible('territory-monument'))
      canvas.dataset.monumentDetailVisible = String(visible('monument-detail'))
      canvas.dataset.platformVisible = String(visible('orbital-platform'))
      canvas.dataset.claimSignalVisible = String(visible('territory-claim-signal'))
      canvas.dataset.scarVisible = String(visible('permanent-lunar-scar'))
      canvas.dataset.octogonalsVisible = String(visible('octogonal-approach'))
      canvas.dataset.octogonalThrustVisible = String(visible('octogonal-thrust'))
      canvas.dataset.octogonalFireVisible = String(visible('octogonal-fire'))
      canvas.dataset.octogonalImpactVisible = String(visible('octogonal-impact'))
      canvas.dataset.defenseBurstVisible = String(visible('octogonal-destruction'))
      canvas.dataset.defenseBeamVisible = String(visible('defense-beam'))
      const defenseFraming: Record<string, number[]> = {}
      for (const name of ['defense-turret', 'defense-target', 'octogonal-destruction']) {
        const object = state.scene.getObjectByName(name)
        if (object && visible(name)) defenseFraming[name] = object.getWorldPosition(new Vector3()).project(state.camera).toArray()
      }
      canvas.dataset.defenseFraming = JSON.stringify(defenseFraming)
      const lander = state.scene.getObjectByName('player-lander')
      canvas.dataset.landerFraming = JSON.stringify(lander && visible('player-lander')
        ? lander.getWorldPosition(new Vector3()).project(state.camera).toArray() : null)
      if (shouldEnableE2eHarness(E2E_HARNESS_BUILD_ENABLED, window.location.search)) {
        const objects: Record<string, number[]> = {}
        for (const name of ['null-meridian-counterstrike-missile', 'player-orbital-interceptor', 'counterstrike-orbital-breakup', 'player-lander', 'orbital-outpost-signal', 'mining-laser-beam', 'mining-contact-glow']) {
          const object = state.scene.getObjectByName(name)
          let visible = object?.visible ?? false
          object?.traverseAncestors(parent => { visible = visible && parent.visible })
          if (object !== undefined && visible) {
            const point = object.getWorldPosition(new Vector3()).project(state.camera)
            objects[name] = point.toArray()
          }
        }
        canvas.dataset.heroFraming = JSON.stringify(objects)
      }
      pendingRef.current = false
    })
  })

  return null
}
