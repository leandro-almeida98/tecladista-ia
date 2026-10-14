import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGameLoop } from '../useGameLoop'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useGameLoop', () => {
  it('chama o callback com delta time em segundos', () => {
    const cb = vi.fn()
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    renderHook(() => useGameLoop(cb))
    const loop = raf.mock.calls[0][0] as (t: number) => void
    // primeiro frame: last = 0 → dt = 0
    loop(1000)
    expect(cb).toHaveBeenLastCalledWith(0)
    // segundo frame: dt = (2000 - 1000) / 1000 = 1
    loop(2000)
    expect(cb).toHaveBeenLastCalledWith(1)
  })

  it('cancela o rAF no unmount', () => {
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { unmount } = renderHook(() => useGameLoop(() => {}))
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})