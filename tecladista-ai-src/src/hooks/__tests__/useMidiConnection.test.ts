import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMidiConnection } from '../useMidiConnection'
import { useGameStore } from '../../store/gameStore'

interface FakeInput {
  name: string | null
  onmidimessage: ((e: { data: Uint8Array }) => void) | null
}

interface FakeAccess {
  inputs: { values: () => IterableIterator<FakeInput> }
  onstatechange: (() => void) | null
}

function makeInput(name: string | null): FakeInput {
  return { name, onmidimessage: null }
}

function makeAccess(inputs: FakeInput[]): FakeAccess {
  return { inputs: { values: () => inputs[Symbol.iterator]() }, onstatechange: null }
}

let requestMidiMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  useGameStore.setState({
    notes: [],
    duration: 0,
    fileName: null,
    isPlaying: false,
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfectCount: 0,
    goodCount: 0,
    missCount: 0,
    lastJudgment: null,
    accuracy: 100,
    activeNotes: new Set<number>(),
    sessionId: 0,
  })
  requestMidiMock = vi.fn()
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    value: requestMidiMock,
    configurable: true,
  })
})

describe('useMidiConnection', () => {
  it('status unsupported quando Web MIDI não existe', async () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true })
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
  })

  it('status denied quando requestMIDIAccess rejeita', async () => {
    requestMidiMock.mockRejectedValue(new Error('denied'))
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('denied'))
  })

  it('status no-device quando não há inputs', async () => {
    requestMidiMock.mockResolvedValue(makeAccess([]))
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('no-device'))
  })

  it('prefere input CT-S300', async () => {
    const cts300 = makeInput('Casio CT-S300')
    const other = makeInput('Other Keyboard')
    requestMidiMock.mockResolvedValue(makeAccess([other, cts300]))
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.inputs).toEqual(['Other Keyboard', 'Casio CT-S300'])
    expect(result.current.connectedDeviceName).toBe('Casio CT-S300')
    expect(cts300.onmidimessage).not.toBeNull()
    expect(other.onmidimessage).toBeNull()
  })

  it('connectedDeviceName é null quando não há device', async () => {
    requestMidiMock.mockResolvedValue(makeAccess([]))
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('no-device'))
    expect(result.current.connectedDeviceName).toBeNull()
  })

  it('faz fallback para o primeiro input quando não há CT-S300', async () => {
    const first = makeInput('Generic MIDI')
    requestMidiMock.mockResolvedValue(makeAccess([first]))
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.connectedDeviceName).toBe('Generic MIDI')
    expect(first.onmidimessage).not.toBeNull()
  })

  it('processa noteon e noteoff atualizando activeNotes', async () => {
    const input = makeInput('Casio CT-S300')
    requestMidiMock.mockResolvedValue(makeAccess([input]))
    renderHook(() => useMidiConnection())
    await waitFor(() => expect(input.onmidimessage).not.toBeNull())

    const msg = (data: number[]) => input.onmidimessage!({ data: new Uint8Array(data) })
    act(() => msg([0x90, 60, 100]))
    expect(useGameStore.getState().activeNotes.has(60)).toBe(true)

    act(() => msg([0x90, 60, 0])) // noteon com velocity 0 = release
    expect(useGameStore.getState().activeNotes.has(60)).toBe(false)

    act(() => msg([0x90, 64, 100]))
    act(() => msg([0x80, 64, 0])) // noteoff
    expect(useGameStore.getState().activeNotes.has(64)).toBe(false)
  })

  it('ignora mensagens malformadas', async () => {
    const input = makeInput('Casio CT-S300')
    requestMidiMock.mockResolvedValue(makeAccess([input]))
    renderHook(() => useMidiConnection())
    await waitFor(() => expect(input.onmidimessage).not.toBeNull())
    act(() => input.onmidimessage!({ data: new Uint8Array([0x90]) }))
    expect(useGameStore.getState().activeNotes.size).toBe(0)
  })

  it('reconfigura em onstatechange', async () => {
    const input = makeInput('Casio CT-S300')
    const access = makeAccess([input])
    requestMidiMock.mockResolvedValue(access)
    const { result } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('connected'))

    // dispositivo removido
    act(() => {
      access.inputs = { values: () => [][Symbol.iterator]() }
      access.onstatechange?.()
    })
    await waitFor(() => expect(result.current.status).toBe('no-device'))
    expect(result.current.connectedDeviceName).toBeNull()

    // dispositivo reconectado
    const input2 = makeInput('Casio CT-S300')
    act(() => {
      access.inputs = { values: () => [input2][Symbol.iterator]() }
      access.onstatechange?.()
    })
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.connectedDeviceName).toBe('Casio CT-S300')
    expect(input2.onmidimessage).not.toBeNull()
  })

  it('limpa handlers no unmount', async () => {
    const input = makeInput('Casio CT-S300')
    const access = makeAccess([input])
    requestMidiMock.mockResolvedValue(access)
    const { result, unmount } = renderHook(() => useMidiConnection())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(input.onmidimessage).not.toBeNull()
    expect(access.onstatechange).not.toBeNull()

    unmount()

    expect(input.onmidimessage).toBeNull()
    expect(access.onstatechange).toBeNull()
  })
})