import { useRef } from 'react'
import { Vector2 } from 'three'
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
      pendingRef.current = false
    })
  })

  return null
}
