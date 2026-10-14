import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PianoKeyboard from '../PianoKeyboard'
import { totalWhiteKeys, NUM_KEYS } from '../../lib/noteMath'

function renderKeyboard(activeNotes: Set<number> = new Set()) {
  return render(
    <PianoKeyboard activeNotes={activeNotes} onNoteOn={vi.fn()} onNoteOff={vi.fn()} />,
  )
}

function styleOf(label: string) {
  const el = screen.getByLabelText(label)
  return {
    left: parseFloat(el.style.left),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  }
}

describe('PianoKeyboard', () => {
  it('renderiza 61 teclas (36 brancas + 25 pretas)', () => {
    renderKeyboard()
    const keys = screen.getAllByRole('button')
    expect(keys).toHaveLength(NUM_KEYS)
    expect(totalWhiteKeys()).toBe(36)
  })

  it('acende tecla ativa', () => {
    renderKeyboard(new Set([60]))
    const key = screen.getByLabelText('Tecla 60')
    expect(key.className).toContain('bg-sky-300')
  })

  it('não acende tecla inativa', () => {
    renderKeyboard()
    const key = screen.getByLabelText('Tecla 60')
    expect(key.className).toContain('bg-white')
  })

  it('chama onNoteOn no pointer down e onNoteOff no pointer up', () => {
    const onNoteOn = vi.fn()
    const onNoteOff = vi.fn()
    render(<PianoKeyboard activeNotes={new Set()} onNoteOn={onNoteOn} onNoteOff={onNoteOff} />)
    const key = screen.getByLabelText('Tecla 60')
    fireEvent.pointerDown(key)
    expect(onNoteOn).toHaveBeenCalledWith(60)
    fireEvent.pointerUp(key)
    expect(onNoteOff).toHaveBeenCalledWith(60)
  })

  it('chama onNoteOff no pointer leave', () => {
    const onNoteOff = vi.fn()
    render(
      <PianoKeyboard activeNotes={new Set()} onNoteOn={vi.fn()} onNoteOff={onNoteOff} />,
    )
    const key = screen.getByLabelText('Tecla 60')
    fireEvent.pointerLeave(key)
    expect(onNoteOff).toHaveBeenCalledWith(60)
  })

  it('insere gap entre o fim de uma oitava (B) e o início da próxima (C)', () => {
    renderKeyboard()
    const b2 = styleOf('Tecla 47') // B2
    const c3 = styleOf('Tecla 48') // C3
    // C3 começa depois do fim de B2 → existe gap
    expect(c3.left).toBeGreaterThan(b2.left + b2.width)
  })

  it('não insere gap entre brancas da mesma oitava', () => {
    renderKeyboard()
    const c2 = styleOf('Tecla 36') // C2
    const d2 = styleOf('Tecla 38') // D2
    // D2 começa exatamente no fim de C2 (sem gap dentro da oitava)
    expect(d2.left).toBeCloseTo(c2.left + c2.width)
  })

  it('centraliza a preta na fronteira entre as 2 brancas corretas', () => {
    renderKeyboard()
    const c2 = styleOf('Tecla 36') // C2
    const d2 = styleOf('Tecla 38') // D2
    const cs2 = styleOf('Tecla 37') // C#2
    const boundary = c2.left + c2.width
    const center = cs2.left + cs2.width / 2
    expect(center).toBeCloseTo(boundary)
    // C#2 fica entre C2 e D2 (na fronteira, que é o início de D2)
    expect(center).toBeGreaterThan(c2.left)
    expect(center).toBeLessThanOrEqual(d2.left)
  })

  it('preta é mais estreita e mais baixa que a branca', () => {
    renderKeyboard()
    const c2 = styleOf('Tecla 36')
    const cs2 = styleOf('Tecla 37')
    expect(cs2.width).toBeLessThan(c2.width)
    expect(cs2.height).toBeLessThan(100)
    expect(cs2.height).toBeGreaterThan(50)
  })
})