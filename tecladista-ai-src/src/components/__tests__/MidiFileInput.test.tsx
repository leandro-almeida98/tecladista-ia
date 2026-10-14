import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MidiFileInput from '../MidiFileInput'
import { useGameStore } from '../../store/gameStore'
import { parseMidi } from '../../lib/midiParser'
import type { Note } from '../../types/midi'

vi.mock('../../lib/midiParser', () => ({
  parseMidi: vi.fn(),
}))

const parseMidiMock = parseMidi as ReturnType<typeof vi.fn>

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
  parseMidiMock.mockReset()
})

describe('MidiFileInput', () => {
  it('carrega .mid válido e mostra info', async () => {
    const user = userEvent.setup()
    parseMidiMock.mockReturnValue({ notes: [note], duration: 2, ticksPerBeat: 480, bpm: 120 })
    render(<MidiFileInput />)
    const file = new File(['fake'], 'song.mid', { type: 'audio/midi' })
    await user.upload(screen.getByTestId('midi-file-input'), file)
    expect(parseMidiMock).toHaveBeenCalled()
    expect(useGameStore.getState().fileName).toBe('song.mid')
    expect(useGameStore.getState().notes).toHaveLength(1)
    expect(screen.getByTestId('midi-file-info')).toHaveTextContent('song.mid')
    expect(screen.getByTestId('midi-file-info')).toHaveTextContent('1 notas')
  })

  it('mostra erro quando não há notas no range', async () => {
    const user = userEvent.setup()
    parseMidiMock.mockReturnValue({ notes: [], duration: 2, ticksPerBeat: 480, bpm: 120 })
    render(<MidiFileInput />)
    const file = new File(['fake'], 'empty.mid', { type: 'audio/midi' })
    await user.upload(screen.getByTestId('midi-file-input'), file)
    expect(screen.getByRole('alert')).toHaveTextContent('Nenhuma nota no range')
    expect(useGameStore.getState().fileName).toBeNull()
  })

  it('mostra erro para .mid inválido', async () => {
    const user = userEvent.setup()
    parseMidiMock.mockImplementation(() => {
      throw new Error('bad midi')
    })
    render(<MidiFileInput />)
    const file = new File(['bad'], 'bad.mid', { type: 'audio/midi' })
    await user.upload(screen.getByTestId('midi-file-input'), file)
    expect(screen.getByRole('alert')).toHaveTextContent('Arquivo .mid inválido')
  })

  it('não faz nada sem arquivo selecionado', async () => {
    const user = userEvent.setup()
    render(<MidiFileInput />)
    await user.upload(screen.getByTestId('midi-file-input'), [])
    expect(parseMidiMock).not.toHaveBeenCalled()
  })
})