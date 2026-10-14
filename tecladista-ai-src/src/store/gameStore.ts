import { create } from 'zustand'
import type { Note } from '../types/midi'
import type { Judgment } from '../lib/scoring'
import { computeAccuracy } from '../lib/scoring'

interface GameState {
  notes: Note[]
  duration: number
  fileName: string | null
  isPlaying: boolean
  score: number
  combo: number
  maxCombo: number
  perfectCount: number
  goodCount: number
  missCount: number
  lastJudgment: Judgment | null
  accuracy: number
  activeNotes: Set<number>
  /** Bumped on load/restart so the canvas resets its per-frame refs. */
  sessionId: number
  loadMidi: (notes: Note[], duration: number, fileName: string) => void
  setPlaying: (playing: boolean) => void
  addActiveNote: (midi: number) => void
  removeActiveNote: (midi: number) => void
  registerJudgment: (judgment: Judgment) => void
  restart: () => void
}

const freshStats = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectCount: 0,
  goodCount: 0,
  missCount: 0,
  lastJudgment: null as Judgment | null,
  accuracy: 100,
}

export const useGameStore = create<GameState>((set) => ({
  notes: [],
  duration: 0,
  fileName: null,
  isPlaying: false,
  ...freshStats,
  activeNotes: new Set<number>(),
  sessionId: 0,

  loadMidi: (notes, duration, fileName) =>
    set((s) => ({
      notes,
      duration,
      fileName,
      isPlaying: false,
      ...freshStats,
      activeNotes: new Set<number>(),
      sessionId: s.sessionId + 1,
    })),

  setPlaying: (playing) => set({ isPlaying: playing }),

  addActiveNote: (midi) =>
    set((s) => {
      if (s.activeNotes.has(midi)) return s
      const next = new Set(s.activeNotes)
      next.add(midi)
      return { activeNotes: next }
    }),

  removeActiveNote: (midi) =>
    set((s) => {
      if (!s.activeNotes.has(midi)) return s
      const next = new Set(s.activeNotes)
      next.delete(midi)
      return { activeNotes: next }
    }),

  registerJudgment: (judgment) =>
    set((s) => {
      if (judgment === 'Miss') {
        const missCount = s.missCount + 1
        return {
          combo: 0,
          missCount,
          lastJudgment: judgment,
          accuracy: computeAccuracy(s.perfectCount, s.goodCount, missCount),
        }
      }
      const gained = judgment === 'Perfect' ? 100 : 50
      const combo = s.combo + 1
      const perfectCount = s.perfectCount + (judgment === 'Perfect' ? 1 : 0)
      const goodCount = s.goodCount + (judgment === 'Good' ? 1 : 0)
      return {
        score: s.score + gained,
        combo,
        maxCombo: Math.max(s.maxCombo, combo),
        perfectCount,
        goodCount,
        lastJudgment: judgment,
        accuracy: computeAccuracy(perfectCount, goodCount, s.missCount),
      }
    }),

  restart: () =>
    set((s) => ({
      isPlaying: false,
      ...freshStats,
      sessionId: s.sessionId + 1,
    })),
}))