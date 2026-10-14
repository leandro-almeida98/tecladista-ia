import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import FallingNotesCanvas from '../FallingNotesCanvas'
import { useGameStore } from '../../store/gameStore'
import type { Note } from '../../types/midi'

let loopCb: ((dt: number) => void) | null = null

vi.mock('../../hooks/useGameLoop', () => ({
  useGameLoop: (cb: (dt: number) => void) => {
    loopCb = cb
  },
}))

function makeCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  }
}

let ctxMock: ReturnType<typeof makeCtx>

const note = (midi: number, time: number): Note => ({
  midi,
  time,
  duration: 0.5,
  velocity: 100,
  channel: 0,
})

beforeEach(() => {
  ctxMock = makeCtx()
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctxMock,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 720,
    height: 400,
    top: 0,
    left: 0,
    right: 720,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }))
  loopCb = null
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
})

describe('FallingNotesCanvas', () => {
  it('renderiza o canvas', () => {
    render(<FallingNotesCanvas />)
    expect(screen.getByTestId('falling-notes-canvas')).toBeInTheDocument()
  })

  it('registra Miss quando nota passa sem tecla pressionada', () => {
    useGameStore.setState({ notes: [note(60, 0)], isPlaying: true })
    render(<FallingNotesCanvas />)
    expect(loopCb).not.toBeNull()
    // avança o relógio além da janela Good (100ms)
    loopCb?.(0.05)
    loopCb?.(0.2)
    expect(useGameStore.getState().missCount).toBe(1)
    expect(useGameStore.getState().combo).toBe(0)
  })

  it('registra Perfect quando tecla está ativa na janela', () => {
    useGameStore.setState({
      notes: [note(60, 0)],
      isPlaying: true,
      activeNotes: new Set([60]),
    })
    render(<FallingNotesCanvas />)
    loopCb?.(0.01) // 10ms → Perfect
    expect(useGameStore.getState().score).toBe(100)
    expect(useGameStore.getState().perfectCount).toBe(1)
  })

  it('não avança o relógio quando pausado', () => {
    useGameStore.setState({ notes: [note(60, 0)], isPlaying: false })
    render(<FallingNotesCanvas />)
    loopCb?.(0.05)
    loopCb?.(0.05)
    // pausado → currentTime não avança → sem julgamento
    expect(useGameStore.getState().missCount).toBe(0)
  })

  it('desenha notas e glow de teclas ativas', () => {
    useGameStore.setState({
      notes: [note(60, 0.5)],
      isPlaying: true,
      activeNotes: new Set([64]),
    })
    render(<FallingNotesCanvas />)
    loopCb?.(0.1)
    expect(ctxMock.clearRect).toHaveBeenCalled()
    expect(ctxMock.fill).toHaveBeenCalled()
    expect(ctxMock.fillRect).toHaveBeenCalled()
  })

  it('não julga nem desenha notas muito no futuro (break + off-screen)', () => {
    useGameStore.setState({ notes: [note(60, 10)], isPlaying: true })
    render(<FallingNotesCanvas />)
    loopCb?.(0.1)
    // nota no futuro → break no loop de julgamento → sem miss
    expect(useGameStore.getState().missCount).toBe(0)
    // nota fora da tela → não desenha
    expect(ctxMock.fill).not.toHaveBeenCalled()
  })

  it('não julga quando tecla ativa mas fora da janela', () => {
    useGameStore.setState({
      notes: [note(60, 0)],
      isPlaying: true,
      activeNotes: new Set([60]),
    })
    render(<FallingNotesCanvas />)
    loopCb?.(0.3) // 300ms → fora da janela Good → judgeNote retorna null
    expect(useGameStore.getState().score).toBe(0)
    expect(useGameStore.getState().missCount).toBe(0)
  })

  it('não quebra quando getContext retorna null', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext
    useGameStore.setState({ notes: [note(60, 0)], isPlaying: true })
    render(<FallingNotesCanvas />)
    expect(() => loopCb?.(0.1)).not.toThrow()
  })

  it('não quebra quando o canvas é desmontado', () => {
    useGameStore.setState({ notes: [note(60, 0)], isPlaying: true })
    const { unmount } = render(<FallingNotesCanvas />)
    unmount()
    expect(() => loopCb?.(0.1)).not.toThrow()
  })
})