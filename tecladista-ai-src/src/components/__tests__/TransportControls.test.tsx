import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransportControls from '../TransportControls'
import { useGameStore } from '../../store/gameStore'
import type { Note } from '../../types/midi'

const note: Note = { midi: 60, time: 0, duration: 0.5, velocity: 100, channel: 0 }

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
})

describe('TransportControls', () => {
  it('desabilita botões sem música carregada', () => {
    render(<TransportControls />)
    expect(screen.getByRole('button', { name: 'Tocar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reiniciar' })).toBeDisabled()
  })

  it('alterna play/pause', async () => {
    const user = userEvent.setup()
    useGameStore.setState({ notes: [note] })
    render(<TransportControls />)
    await user.click(screen.getByRole('button', { name: 'Tocar' }))
    expect(useGameStore.getState().isPlaying).toBe(true)
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(useGameStore.getState().isPlaying).toBe(false)
  })

  it('reinicia a música', async () => {
    const user = userEvent.setup()
    useGameStore.setState({ notes: [note], score: 100, combo: 2 })
    render(<TransportControls />)
    await user.click(screen.getByRole('button', { name: 'Reiniciar' }))
    const s = useGameStore.getState()
    expect(s.score).toBe(0)
    expect(s.combo).toBe(0)
    expect(s.isPlaying).toBe(false)
  })
})