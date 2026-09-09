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
