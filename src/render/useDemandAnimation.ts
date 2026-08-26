import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { isSimulationTimePaused } from '../simulation/simulationTime.ts'

export function useDemandAnimation(active: boolean): void {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    if (!active) {
      return
    }

    let animationFrame = 0
    const animate = () => {
      if (!isSimulationTimePaused()) {
        invalidate()
      }

      animationFrame = window.requestAnimationFrame(animate)
    }

    animate()
    return () => window.cancelAnimationFrame(animationFrame)
  }, [active, invalidate])
}
