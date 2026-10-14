import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseMidi, dedupeNotes } from '../midiParser'
import type { Note } from '../../types/midi'

interface MockTrackNote {
  midi: number
  time: number
  duration: number
  velocity: number
}

interface MockTrack {
  channel: number | null
  notes: MockTrackNote[]
}

let mockTracks: MockTrack[] = []
let mockDuration = 2
let mockTicksPerBeat = 480
let mockTempos: { bpm: number }[] = [{ bpm: 120 }]

vi.mock('@tonejs/midi', () => ({
  Midi: class {
    tracks = mockTracks
    duration = mockDuration
    header = { ppq: mockTicksPerBeat, tempos: mockTempos }
  },
}))

beforeEach(() => {
  mockTracks = []
  mockDuration = 2
  mockTicksPerBeat = 480
  mockTempos = [{ bpm: 120 }]
})

describe('parseMidi', () => {
  it('achata tracks e retorna notas no range', () => {
    mockTracks = [
      {
        channel: 0,
        notes: [
          { midi: 60, time: 0, duration: 0.5, velocity: 100 },
          { midi: 64, time: 0.5, duration: 0.5, velocity: 90 },
        ],
      },
      {
        channel: 1,
        notes: [{ midi: 67, time: 1, duration: 0.5, velocity: 80 }],
      },
    ]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes).toHaveLength(3)
    expect(result.notes[0]).toEqual({ midi: 60, time: 0, duration: 0.5, velocity: 100, channel: 0 })
    expect(result.notes[2]).toEqual({ midi: 67, time: 1, duration: 0.5, velocity: 80, channel: 1 })
  })

  it('filtra notas fora do range 36–96', () => {
    mockTracks = [
      {
        channel: 0,
        notes: [
          { midi: 30, time: 0, duration: 0.5, velocity: 100 }, // abaixo
          { midi: 60, time: 0, duration: 0.5, velocity: 100 },
          { midi: 120, time: 1, duration: 0.5, velocity: 100 }, // acima
        ],
      },
    ]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].midi).toBe(60)
  })

  it('dedupe notas simultâneas da mesma tecla mantendo a mais longa', () => {
    mockTracks = [
      {
        channel: 0,
        notes: [
          { midi: 60, time: 0, duration: 0.3, velocity: 100 },
          { midi: 60, time: 0, duration: 0.8, velocity: 90 },
        ],
      },
    ]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].duration).toBe(0.8)
  })

  it('ordena notas por tempo', () => {
    mockTracks = [
      {
        channel: 0,
        notes: [
          { midi: 67, time: 1, duration: 0.5, velocity: 100 },
          { midi: 60, time: 0, duration: 0.5, velocity: 100 },
          { midi: 64, time: 0.5, duration: 0.5, velocity: 100 },
        ],
      },
    ]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes.map((n) => n.time)).toEqual([0, 0.5, 1])
  })

  it('retorna duração, ticksPerBeat e bpm', () => {
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.duration).toBe(2)
    expect(result.ticksPerBeat).toBe(480)
    expect(result.bpm).toBe(120)
  })

  it('usa bpm padrão 120 quando não há tempos', () => {
    mockTempos = []
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.bpm).toBe(120)
  })

  it('retorna lista vazia para tracks sem notas', () => {
    mockTracks = [{ channel: 0, notes: [] }]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes).toHaveLength(0)
  })

  it('usa canal 0 quando track não tem canal', () => {
    mockTracks = [
      {
        channel: null,
        notes: [{ midi: 60, time: 0, duration: 0.5, velocity: 100 }],
      },
    ]
    const result = parseMidi(new ArrayBuffer(0))
    expect(result.notes[0].channel).toBe(0)
  })
})

describe('dedupeNotes', () => {
  it('remove duplicatas simultâneas da mesma tecla', () => {
    const notes: Note[] = [
      { midi: 60, time: 0, duration: 0.5, velocity: 100, channel: 0 },
      { midi: 60, time: 0, duration: 0.9, velocity: 90, channel: 0 },
      { midi: 64, time: 0, duration: 0.5, velocity: 100, channel: 0 },
    ]
    const result = dedupeNotes(notes)
    expect(result).toHaveLength(2)
    expect(result.find((n) => n.midi === 60)?.duration).toBe(0.9)
  })

  it('mantém notas de tempos diferentes', () => {
    const notes: Note[] = [
      { midi: 60, time: 0, duration: 0.5, velocity: 100, channel: 0 },
      { midi: 60, time: 1, duration: 0.5, velocity: 100, channel: 0 },
    ]
    expect(dedupeNotes(notes)).toHaveLength(2)
  })
})