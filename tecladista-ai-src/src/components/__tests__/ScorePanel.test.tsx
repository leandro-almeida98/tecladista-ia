import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ScorePanel from '../ScorePanel'
import { useGameStore } from '../../store/gameStore'

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

describe('ScorePanel', () => {
  it('mostra estado inicial', () => {
    render(<ScorePanel />)
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('mostra score, combo, accuracy e julgamentos', () => {
    useGameStore.setState({
      score: 250,
      combo: 3,
      accuracy: 83.3,
      perfectCount: 2,
      goodCount: 1,
      missCount: 1,
      lastJudgment: 'Good',
    })
    render(<ScorePanel />)
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('83.3%')).toBeInTheDocument()
    expect(screen.getByText('2 Perfect')).toBeInTheDocument()
    expect(screen.getByText('1 Good')).toBeInTheDocument()
    expect(screen.getByText('1 Miss')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
  })
})