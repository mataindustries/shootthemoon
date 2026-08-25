import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color } from 'three'

interface StarfieldProps {
  readonly count: number
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

export function Starfield({ count }: StarfieldProps) {
  const geometry = useMemo(() => {
    const random = createRandom(0x51a7f13d)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const cold = new Color('#a9bfd8')
    const neutral = new Color('#e2e5e9')

    for (let index = 0; index < count; index += 1) {
      const longitude = random() * Math.PI * 2
      const cosineLatitude = random() * 2 - 1
      const sineLatitude = Math.sqrt(1 - cosineLatitude * cosineLatitude)
      const radius = 22 + random() * 38
      const color = cold.clone().lerp(neutral, random() * 0.75)
      const offset = index * 3

      positions[offset] = radius * sineLatitude * Math.cos(longitude)
      positions[offset + 1] = radius * cosineLatitude
      positions[offset + 2] = radius * sineLatitude * Math.sin(longitude)
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
    }

    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(positions, 3))
    result.setAttribute('color', new BufferAttribute(colors, 3))

    return result
  }, [count])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={-10}>
      <pointsMaterial
        color="#b7c4d4"
        depthWrite={false}
        opacity={0.72}
        size={0.026}
        sizeAttenuation
        transparent
        vertexColors
      />
    </points>
  )
}

