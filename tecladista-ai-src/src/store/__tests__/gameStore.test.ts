import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../gameStore'
import type { Note } from '../../types/midi'

const note = (midi: number, time = 0): Note => ({
  midi,
  time,
  duration: 0.5,
  velocity: 100,
  channel: 0,
})

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

describe('loadMidi', () => {
  it('carrega notas, zera estatísticas e incrementa sessionId', () => {
    const s = useGameStore.getState()
    s.loadMidi([note(60)], 2, 'song.mid')
    const next = useGameStore.getState()
    expect(next.notes).toHaveLength(1)
    expect(next.duration).toBe(2)
    expect(next.fileName).toBe('song.mid')
    expect(next.isPlaying).toBe(false)
    expect(next.score).toBe(0)
    expect(next.sessionId).toBe(1)
  })
})

describe('setPlaying', () => {
  it('alterna isPlaying', () => {
    useGameStore.getState().setPlaying(true)
    expect(useGameStore.getState().isPlaying).toBe(true)
    useGameStore.getState().setPlaying(false)
    expect(useGameStore.getState().isPlaying).toBe(false)
  })
})

describe('activeNotes', () => {
  it('adiciona e remove notas', () => {
    useGameStore.getState().addActiveNote(60)
    expect(useGameStore.getState().activeNotes.has(60)).toBe(true)
    useGameStore.getState().addActiveNote(60) // idempotente
    expect(useGameStore.getState().activeNotes.size).toBe(1)
    useGameStore.getState().removeActiveNote(60)
    expect(useGameStore.getState().activeNotes.has(60)).toBe(false)
    useGameStore.getState().removeActiveNote(60) // idempotente
    expect(useGameStore.getState().activeNotes.size).toBe(0)
  })
})

describe('registerJudgment', () => {
  it('Perfect soma 100 e incrementa combo', () => {
    useGameStore.getState().registerJudgment('Perfect')
    const s = useGameStore.getState()
    expect(s.score).toBe(100)
    expect(s.combo).toBe(1)
    expect(s.maxCombo).toBe(1)
    expect(s.perfectCount).toBe(1)
    expect(s.lastJudgment).toBe('Perfect')
    expect(s.accuracy).toBe(100)
  })

  it('Good soma 50 e incrementa combo', () => {
    useGameStore.getState().registerJudgment('Good')
    const s = useGameStore.getState()
    expect(s.score).toBe(50)
    expect(s.combo).toBe(1)
    expect(s.goodCount).toBe(1)
    expect(s.accuracy).toBe(50)
  })

  it('Miss zera combo e conta miss', () => {
    useGameStore.getState().registerJudgment('Perfect')
    useGameStore.getState().registerJudgment('Miss')
    const s = useGameStore.getState()
    expect(s.combo).toBe(0)
    expect(s.missCount).toBe(1)
    expect(s.score).toBe(100) // miss não soma
    expect(s.accuracy).toBe(50)
  })

  it('acumula combo e maxCombo', () => {
    useGameStore.getState().registerJudgment('Perfect')
    useGameStore.getState().registerJudgment('Perfect')
    useGameStore.getState().registerJudgment('Good')
    const s = useGameStore.getState()
    expect(s.combo).toBe(3)
    expect(s.maxCombo).toBe(3)
    expect(s.score).toBe(250)
  })
})

describe('restart', () => {
  it('zera estatísticas e incrementa sessionId', () => {
    useGameStore.getState().loadMidi([note(60)], 2, 'song.mid')
    useGameStore.getState().registerJudgment('Perfect')
    useGameStore.getState().setPlaying(true)
    const before = useGameStore.getState()
    useGameStore.getState().restart()
    const s = useGameStore.getState()
    expect(s.isPlaying).toBe(false)
    expect(s.score).toBe(0)
    expect(s.combo).toBe(0)
    expect(s.sessionId).toBe(before.sessionId + 1)
    expect(s.notes).toHaveLength(1) // mantém a música
  })
})