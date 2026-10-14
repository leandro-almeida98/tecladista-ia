import { useEffect, useRef } from 'react'

/**
 * requestAnimationFrame loop that always runs. The callback receives the
 * delta time in seconds since the previous frame. Pausing is handled by the
 * caller (e.g. the canvas only advances its clock while playing).
 */
export function useGameLoop(callback: (dt: number) => void): void {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      const dt = last ? (t - last) / 1000 : 0
      last = t
      cbRef.current(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}