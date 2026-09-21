import { useEffect, useState } from 'react'

function readCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

/** Desktop/mouse sessions get accurate control copy instead of the touch hint. */
export function useCoarsePointer(): boolean {
  const [coarsePointer, setCoarsePointer] = useState(readCoarsePointer)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarsePointer(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return coarsePointer
}
