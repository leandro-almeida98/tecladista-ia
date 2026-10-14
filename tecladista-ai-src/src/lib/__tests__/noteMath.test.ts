import { describe, it, expect } from 'vitest'
import {
  LOWEST_MIDI,
  HIGHEST_MIDI,
  NUM_KEYS,
  isBlackKey,
  midiToKeyIndex,
  whiteKeyIndex,
  totalWhiteKeys,
  numOctaveGaps,
  whiteKeyWidth,
  whiteKeyX,
  blackKeyX,
  blackKeyWidth,
  keyX,
  keyWidth,
  noteY,
  OCTAVE_GAP_RATIO,
  BLACK_KEY_WIDTH_RATIO,
  WHITE_KEYS_PER_OCTAVE,
} from '../noteMath'

describe('isBlackKey', () => {
  it('retorna true para teclas pretas', () => {
    expect(isBlackKey(37)).toBe(true) // C#2
    expect(isBlackKey(39)).toBe(true) // D#2
    expect(isBlackKey(42)).toBe(true) // F#2
    expect(isBlackKey(44)).toBe(true) // G#2
    expect(isBlackKey(46)).toBe(true) // A#2
  })

  it('retorna false para teclas brancas', () => {
    expect(isBlackKey(36)).toBe(false) // C2
    expect(isBlackKey(40)).toBe(false) // E2
    expect(isBlackKey(41)).toBe(false) // F2
    expect(isBlackKey(48)).toBe(false) // C3
  })
})

describe('midiToKeyIndex', () => {
  it('mapeia C2 (36) para 0 e C7 (96) para 60', () => {
    expect(midiToKeyIndex(LOWEST_MIDI)).toBe(0)
    expect(midiToKeyIndex(HIGHEST_MIDI)).toBe(60)
    expect(midiToKeyIndex(60)).toBe(24)
  })
})

describe('whiteKeyIndex', () => {
  it('conta teclas brancas abaixo da nota', () => {
    expect(whiteKeyIndex(36)).toBe(0) // C2
    expect(whiteKeyIndex(37)).toBe(1) // C#2 (1 branca abaixo)
    expect(whiteKeyIndex(48)).toBe(7) // C3
    expect(whiteKeyIndex(60)).toBe(14) // C4
  })
})

describe('totalWhiteKeys / numOctaveGaps', () => {
  it('tem 36 brancas, 25 pretas e 5 gaps de oitava no range de 61', () => {
    expect(totalWhiteKeys()).toBe(36)
    expect(NUM_KEYS).toBe(61)
    expect(numOctaveGaps()).toBe(5)
  })
})

describe('whiteKeyWidth', () => {
  it('distribui a largura entre brancas + gaps de oitava', () => {
    // 36 brancas + 5 gaps * 0.15 → divisor 36.75
    expect(whiteKeyWidth(720)).toBeCloseTo(720 / (36 + 5 * OCTAVE_GAP_RATIO))
  })
})

describe('whiteKeyX', () => {
  it('não insere gap dentro da primeira oitava (C2–B2)', () => {
    const ww = whiteKeyWidth(720)
    expect(whiteKeyX(0, 720)).toBeCloseTo(0) // C2
    expect(whiteKeyX(6, 720)).toBeCloseTo(6 * ww) // B2
  })

  it('insere um gap antes de cada nova oitava (C3, C4, …)', () => {
    const ww = whiteKeyWidth(720)
    const gap = OCTAVE_GAP_RATIO * ww
    expect(whiteKeyX(7, 720)).toBeCloseTo(7 * ww + gap) // C3
    expect(whiteKeyX(14, 720)).toBeCloseTo(14 * ww + 2 * gap) // C4
    expect(whiteKeyX(35, 720)).toBeCloseTo(35 * ww + 5 * gap) // C7
  })
})

describe('blackKeyX', () => {
  it('centraliza cada preta na fronteira das 2 brancas corretas da oitava', () => {
    // C#2 (37) entre C2(0)–D2(1) → fronteira em whiteKeyX(1)
    expect(blackKeyX(37, 720)).toBeCloseTo(whiteKeyX(1, 720))
    // D#2 (39) entre D2(1)–E2(2)
    expect(blackKeyX(39, 720)).toBeCloseTo(whiteKeyX(2, 720))
    // F#2 (42) entre F2(3)–G2(4)
    expect(blackKeyX(42, 720)).toBeCloseTo(whiteKeyX(4, 720))
    // G#2 (44) entre G2(4)–A2(5)
    expect(blackKeyX(44, 720)).toBeCloseTo(whiteKeyX(5, 720))
    // A#2 (46) entre A2(5)–B2(6)
    expect(blackKeyX(46, 720)).toBeCloseTo(whiteKeyX(6, 720))
  })

  it('não cruza o gap de oitava (nenhuma preta entre B e C)', () => {
    // A#2 (46) fica dentro da oitava 2, não no gap para C3
    const ww = whiteKeyWidth(720)
    const gap = OCTAVE_GAP_RATIO * ww
    expect(blackKeyX(46, 720)).toBeLessThan(whiteKeyX(7, 720) - gap / 2)
  })
})

describe('blackKeyWidth', () => {
  it('preta é 60% da branca', () => {
    expect(blackKeyWidth(720)).toBeCloseTo(whiteKeyWidth(720) * BLACK_KEY_WIDTH_RATIO)
  })
})

describe('keyX', () => {
  it('centraliza tecla branca no slot da tecla branca (com gap de oitava)', () => {
    const ww = whiteKeyWidth(720)
    // C2 é a primeira branca → centro = whiteKeyX(0) + ww/2
    expect(keyX(36, 720)).toBeCloseTo(whiteKeyX(0, 720) + ww / 2)
    // C3 é a 8ª branca → centro = whiteKeyX(7) + ww/2
    expect(keyX(48, 720)).toBeCloseTo(whiteKeyX(7, 720) + ww / 2)
  })

  it('centraliza tecla preta na fronteira entre brancas', () => {
    // C#2 (37) fica entre a 1ª e 2ª branca → fronteira em whiteKeyX(1)
    expect(keyX(37, 720)).toBeCloseTo(whiteKeyX(1, 720))
  })
})

describe('keyWidth', () => {
  it('tecla preta é 60% da branca', () => {
    expect(keyWidth(36, 720)).toBeCloseTo(whiteKeyWidth(720))
    expect(keyWidth(37, 720)).toBeCloseTo(blackKeyWidth(720))
  })
})

describe('noteY', () => {
  it('nota chega à linha de hit exatamente no timestamp', () => {
    const hitLineY = 300
    const pxPerSec = 100
    // no tempo da nota → y = hitLineY
    expect(noteY(2, 2, hitLineY, pxPerSec)).toBe(hitLineY)
    // 1s antes → 100px acima
    expect(noteY(2, 1, hitLineY, pxPerSec)).toBe(hitLineY - 100)
    // 1s depois → 100px abaixo
    expect(noteY(2, 3, hitLineY, pxPerSec)).toBe(hitLineY + 100)
  })
})

describe('constantes de layout', () => {
  it('define proporções realistas de piano', () => {
    expect(WHITE_KEYS_PER_OCTAVE).toBe(7)
    expect(OCTAVE_GAP_RATIO).toBeGreaterThan(0)
    expect(BLACK_KEY_WIDTH_RATIO).toBeCloseTo(0.6)
  })
})