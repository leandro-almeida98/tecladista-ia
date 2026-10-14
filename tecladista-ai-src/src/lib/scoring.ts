/** Judgment windows and scoring rules. */

export type Judgment = 'Perfect' | 'Good' | 'Miss'

export const PERFECT_WINDOW_MS = 50
export const GOOD_WINDOW_MS = 100
export const PERFECT_SCORE = 100
export const GOOD_SCORE = 50

/**
 * Judge a note given the time difference (ms) between the note timestamp and
 * the moment the key was pressed. Returns null when outside both windows.
 */
export function judgeNote(timeDiffMs: number): 'Perfect' | 'Good' | null {
  const abs = Math.abs(timeDiffMs)
  if (abs <= PERFECT_WINDOW_MS) return 'Perfect'
  if (abs <= GOOD_WINDOW_MS) return 'Good'
  return null
}

/** True when the note passed beyond the Good window without being pressed. */
export function isMiss(timeDiffMs: number): boolean {
  return timeDiffMs > GOOD_WINDOW_MS
}

export function scoreForJudgment(j: Judgment): number {
  if (j === 'Perfect') return PERFECT_SCORE
  if (j === 'Good') return GOOD_SCORE
  return 0
}

/** Accuracy percentage (Perfect = 1.0, Good = 0.5, Miss = 0). */
export function computeAccuracy(perfect: number, good: number, miss: number): number {
  const total = perfect + good + miss
  if (total === 0) return 100
  return ((perfect + good * 0.5) / total) * 100
}