import { describe, it, expect } from 'vitest'
import {
  judgeNote,
  isMiss,
  scoreForJudgment,
  computeAccuracy,
  PERFECT_WINDOW_MS,
  GOOD_WINDOW_MS,
  PERFECT_SCORE,
  GOOD_SCORE,
} from '../scoring'

describe('judgeNote', () => {
  it('julga Perfect dentro de ±50ms', () => {
    expect(judgeNote(0)).toBe('Perfect')
    expect(judgeNote(PERFECT_WINDOW_MS)).toBe('Perfect')
    expect(judgeNote(-PERFECT_WINDOW_MS)).toBe('Perfect')
  })

  it('julga Good entre 50ms e 100ms', () => {
    expect(judgeNote(60)).toBe('Good')
    expect(judgeNote(-60)).toBe('Good')
    expect(judgeNote(GOOD_WINDOW_MS)).toBe('Good')
    expect(judgeNote(-GOOD_WINDOW_MS)).toBe('Good')
  })

  it('retorna null fora das janelas', () => {
    expect(judgeNote(101)).toBeNull()
    expect(judgeNote(-101)).toBeNull()
    expect(judgeNote(500)).toBeNull()
  })
})

describe('isMiss', () => {
  it('true quando passa além da janela Good', () => {
    expect(isMiss(GOOD_WINDOW_MS + 1)).toBe(true)
    expect(isMiss(200)).toBe(true)
  })

  it('false dentro da janela ou antes', () => {
    expect(isMiss(0)).toBe(false)
    expect(isMiss(-100)).toBe(false)
    expect(isMiss(GOOD_WINDOW_MS)).toBe(false)
  })
})

describe('scoreForJudgment', () => {
  it('retorna pontuação por julgamento', () => {
    expect(scoreForJudgment('Perfect')).toBe(PERFECT_SCORE)
    expect(scoreForJudgment('Good')).toBe(GOOD_SCORE)
    expect(scoreForJudgment('Miss')).toBe(0)
  })
})

describe('computeAccuracy', () => {
  it('100% sem notas julgadas', () => {
    expect(computeAccuracy(0, 0, 0)).toBe(100)
  })

  it('calcula peso Perfect=1, Good=0.5, Miss=0', () => {
    expect(computeAccuracy(1, 0, 0)).toBe(100)
    expect(computeAccuracy(0, 1, 0)).toBe(50)
    expect(computeAccuracy(0, 0, 1)).toBe(0)
    expect(computeAccuracy(1, 1, 0)).toBe(75)
    expect(computeAccuracy(1, 0, 1)).toBe(50)
  })
})